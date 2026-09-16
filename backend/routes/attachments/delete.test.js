import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Sequelize } from 'sequelize';
import fs from 'fs';
import deleteAttachmentRoute from './delete.js';

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
    verifyProjectDeveloperFromAttachmentId: (req, res, next) => {
      if (!developer) return res.status(403).json({ error: 'Forbidden' });
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

describe('DELETE /attachments/:attachmentId', () => {
  let app;
  let sequelize;
  let transaction;
  let attachment;

  beforeAll(() => {
    sequelize = new Sequelize({ dialect: 'sqlite', logging: false });
    app = express();
    app.use('/', deleteAttachmentRoute(sequelize));
  });

  beforeEach(() => {
    signedIn = true;
    developer = true;
    transaction = {
      commit: vi.fn(),
      rollback: vi.fn(),
    };
    attachment = {
      id: 10,
      filename: 'stored.png',
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    mockAttachment.findByPk.mockReset();
    mockAttachment.findByPk.mockResolvedValue(attachment);
    sequelize.transaction = vi.fn().mockResolvedValue(transaction);
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  });

  it('returns 401 without identity and does not mutate storage', async () => {
    signedIn = false;

    const response = await request(app).delete('/10');

    expect(response.status).toBe(401);
    expect(fs.promises.unlink).not.toHaveBeenCalled();
    expect(attachment.destroy).not.toHaveBeenCalled();
  });

  it('returns 403 without project edit access and does not mutate storage', async () => {
    developer = false;

    const response = await request(app).delete('/10');

    expect(response.status).toBe(403);
    expect(fs.promises.unlink).not.toHaveBeenCalled();
    expect(attachment.destroy).not.toHaveBeenCalled();
  });

  it('returns a safe 404 when the attachment record is absent', async () => {
    mockAttachment.findByPk.mockResolvedValue(null);

    const response = await request(app).delete('/10');

    expect(response.status).toBe(404);
    expect(fs.promises.unlink).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('awaits unlink before destroying the record and committing', async () => {
    const response = await request(app).delete('/10');

    expect(response.status).toBe(204);
    expect(fs.promises.unlink).toHaveBeenCalledOnce();
    expect(attachment.destroy).toHaveBeenCalledWith({ transaction });
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(fs.promises.unlink.mock.invocationCallOrder[0]).toBeLessThan(attachment.destroy.mock.invocationCallOrder[0]);
  });

  it('rolls back and retains metadata when unlink fails', async () => {
    fs.promises.unlink.mockRejectedValueOnce(new Error('filesystem failure'));

    const response = await request(app).delete('/10');

    expect(response.status).toBe(500);
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(attachment.destroy).not.toHaveBeenCalled();
    expect(attachment.filename).toBe('stored.png');
  });
});
