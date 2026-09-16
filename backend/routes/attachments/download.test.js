import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Sequelize } from 'sequelize';
import fs from 'fs';
import downloadAttachmentRoute from './download.js';

let signedIn = true;
let visible = true;

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: (req, res, next) => {
      if (!signedIn) return res.status(401).json({ error: 'Access denied' });
      req.userId = 1;
      return next();
    },
  }),
}));

vi.mock('../../middleware/verifyVisible.js', () => ({
  default: () => ({
    verifyProjectVisibleFromAttachmentId: (req, res, next) => {
      if (!visible) return res.status(403).json({ error: 'Forbidden' });
      return next();
    },
  }),
}));

const mockAttachment = {
  findByPk: vi.fn(),
};

vi.mock('../../models/attachments.js', () => ({
  default: () => mockAttachment,
}));

describe('GET /attachments/download/:attachmentId', () => {
  let app;

  beforeAll(() => {
    const sequelize = new Sequelize({ dialect: 'sqlite', logging: false });
    app = express();
    app.use('/', downloadAttachmentRoute(sequelize));
  });

  beforeEach(() => {
    signedIn = true;
    visible = true;
    mockAttachment.findByPk.mockReset();
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('attachment bytes'));
  });

  it('returns 404 for the removed historical uploads URL without file bytes', async () => {
    const response = await request(app).get('/uploads/stored.png');

    expect(response.status).toBe(404);
    expect(response.text).not.toContain('attachment bytes');
    expect(mockAttachment.findByPk).not.toHaveBeenCalled();
  });

  it('returns 401 without identity and does not query the attachment', async () => {
    signedIn = false;

    const response = await request(app).get('/download/10');

    expect(response.status).toBe(401);
    expect(mockAttachment.findByPk).not.toHaveBeenCalled();
  });

  it('returns 403 without project visibility and does not query the attachment', async () => {
    visible = false;

    const response = await request(app).get('/download/10');

    expect(response.status).toBe(403);
    expect(mockAttachment.findByPk).not.toHaveBeenCalled();
  });

  it('returns a safe 404 for a missing attachment or backing file', async () => {
    mockAttachment.findByPk.mockResolvedValueOnce(null);
    const missingRecord = await request(app).get('/download/10');
    expect(missingRecord.status).toBe(404);

    mockAttachment.findByPk.mockResolvedValueOnce({ id: 10, title: 'photo.png', filename: 'stored.png' });
    fs.promises.readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const missingFile = await request(app).get('/download/10');
    expect(missingFile.status).toBe(404);
    expect(missingFile.text).not.toContain('stored.png');
  });

  it('serves raster attachments inline with the server MIME and nosniff', async () => {
    mockAttachment.findByPk.mockResolvedValue({ id: 10, title: 'photo.png', filename: 'stored.png' });
    fs.promises.readFile.mockResolvedValue(Buffer.from('png bytes'));

    const response = await request(app).get('/download/10');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toMatch(/^inline;/);
    expect(response.body.toString()).toBe('png bytes');
  });

  it('serves non-raster attachments as downloads with the server MIME', async () => {
    mockAttachment.findByPk.mockResolvedValue({ id: 11, title: 'report.pdf', filename: 'stored.pdf' });
    fs.promises.readFile.mockResolvedValue(Buffer.from('pdf bytes'));

    const response = await request(app).get('/download/11');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('sanitizes the download filename before setting Content-Disposition', async () => {
    mockAttachment.findByPk.mockResolvedValue({
      id: 12,
      title: 'report\r\n"; injected.pdf',
      filename: 'stored.pdf',
    });

    const response = await request(app).get('/download/12');

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).not.toMatch(/[\r\n]/);
    expect(response.headers['content-disposition']).toContain('attachment;');
  });
});
