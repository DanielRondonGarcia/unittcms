import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Sequelize } from 'sequelize';
import fs from 'fs';
import newAttachmentRoute from './new.js';

let signedIn = true;
let developer = true;

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: (req, res, next) => {
      if (!signedIn) return res.status(401).json({ error: 'Access denied' });
      req.userId = 1;
      return next();
    },
  }),
}));

vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectDeveloperFromParentCaseId: (req, res, next) => {
      if (!developer) return res.status(403).json({ error: 'Forbidden' });
      return next();
    },
  }),
}));

const mockAttachment = {
  bulkCreate: vi.fn(),
};
const mockCaseAttachment = {
  bulkCreate: vi.fn(),
};

vi.mock('../../models/attachments.js', () => ({
  default: () => mockAttachment,
}));

vi.mock('../../models/caseAttachments.js', () => ({
  default: () => mockCaseAttachment,
}));

const validPng = Buffer.from('89504e470d0a1a0a', 'hex');
const validPdf = Buffer.from('%PDF-1.7 test');

describe('POST /attachments', () => {
  let app;
  let transaction;
  let sequelize;

  beforeAll(() => {
    sequelize = new Sequelize({ dialect: 'sqlite', logging: false });
    app = express();
    app.use('/', newAttachmentRoute(sequelize));
  });

  beforeEach(() => {
    signedIn = true;
    developer = true;
    transaction = {
      commit: vi.fn(),
      rollback: vi.fn(),
    };
    sequelize.transaction = vi.fn().mockResolvedValue(transaction);
    mockAttachment.bulkCreate.mockReset();
    mockCaseAttachment.bulkCreate.mockReset();
    mockAttachment.bulkCreate.mockResolvedValue([{ id: 10, title: 'photo.png', filename: 'stored.png' }]);
    mockCaseAttachment.bulkCreate.mockResolvedValue([]);
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  });

  it('returns 401 before accepting files without identity', async () => {
    signedIn = false;

    const response = await request(app)
      .post('/?parentCaseId=42')
      .attach('files', validPng, { filename: 'photo.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(mockAttachment.bulkCreate).not.toHaveBeenCalled();
  });

  it('returns 403 before accepting files without project edit access', async () => {
    developer = false;

    const response = await request(app)
      .post('/?parentCaseId=42')
      .attach('files', validPng, { filename: 'photo.png', contentType: 'image/png' });

    expect(response.status).toBe(403);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(mockAttachment.bulkCreate).not.toHaveBeenCalled();
  });

  it('rejects active content and mismatched signatures without persistence', async () => {
    const activeContent = await request(app)
      .post('/?parentCaseId=42')
      .attach('files', Buffer.from('<script>alert(1)</script>'), {
        filename: 'page.html',
        contentType: 'text/html',
      });

    expect(activeContent.status).toBe(400);

    const badSignature = await request(app)
      .post('/?parentCaseId=42')
      .attach('files', Buffer.from('not a png'), { filename: 'photo.png', contentType: 'image/png' });

    expect(badSignature.status).toBe(400);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(mockAttachment.bulkCreate).not.toHaveBeenCalled();
  });

  it('enforces the 50 MB per-file limit', async () => {
    const oversizedFile = Buffer.alloc(50 * 1024 * 1024 + 1, 0);

    const response = await request(app)
      .post('/?parentCaseId=42')
      .attach('files', oversizedFile, { filename: 'large.zip', contentType: 'application/zip' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('50 MB');
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(mockAttachment.bulkCreate).not.toHaveBeenCalled();
  }, 120_000);

  it('enforces the 10-file request limit', async () => {
    let upload = request(app).post('/?parentCaseId=42');
    for (let index = 0; index < 11; index += 1) {
      upload = upload.attach('files', validPng, { filename: `photo-${index}.png`, contentType: 'image/png' });
    }

    const response = await upload;

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('10 file');
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(mockAttachment.bulkCreate).not.toHaveBeenCalled();
  });

  it('stages valid files and commits attachment records atomically', async () => {
    mockAttachment.bulkCreate.mockResolvedValue([
      { id: 10, title: 'photo.png', filename: 'stored.png' },
      { id: 11, title: 'document.pdf', filename: 'stored.pdf' },
    ]);

    const response = await request(app)
      .post('/?parentCaseId=42')
      .attach('files', validPng, { filename: 'photo.png', contentType: 'image/png' })
      .attach('files', validPdf, { filename: 'document.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(200);
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
    expect(mockAttachment.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: 'photo.png', filename: expect.stringMatching(/\.png$/) }),
        expect.objectContaining({ title: 'document.pdf', filename: expect.stringMatching(/\.pdf$/) }),
      ]),
      { transaction }
    );
    expect(mockCaseAttachment.bulkCreate).toHaveBeenCalledWith(
      [
        { caseId: '42', attachmentId: 10 },
        { caseId: '42', attachmentId: 11 },
      ],
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  it('rolls back database rows and staged files when persistence fails', async () => {
    mockCaseAttachment.bulkCreate.mockRejectedValue(new Error('join insert failed'));

    const response = await request(app)
      .post('/?parentCaseId=42')
      .attach('files', validPng, { filename: 'photo.png', contentType: 'image/png' });

    expect(response.status).toBe(500);
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(fs.promises.unlink).toHaveBeenCalledOnce();
  });
});
