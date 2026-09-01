import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manualExecutionRoute from './index.js';

const verifySignedIn = vi.fn((req: { userId?: number }, _res: unknown, next: () => void) => {
  req.userId = 7;
  next();
});

vi.mock('../../middleware/auth.js', () => ({ default: () => ({ verifySignedIn }) }));

const service = {
  start: vi.fn(),
  get: vi.fn(),
  active: vi.fn(),
  listHistory: vi.fn(),
  finish: vi.fn(),
  updateReport: vi.fn(),
  cancel: vi.fn(),
  listEvidence: vi.fn(),
  uploadEvidence: vi.fn(),
  downloadEvidence: vi.fn(),
  deleteEvidence: vi.fn(),
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/manual-executions', manualExecutionRoute({} as never, { service }));
  return app;
}

describe('manual execution security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated request before the service can read or write', async () => {
    verifySignedIn.mockImplementationOnce(
      (_req, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
        res.status(401).json({ error: 'unauthenticated' });
      }
    );

    const response = await request(makeApp()).get('/manual-executions/1');

    expect(response.status).toBe(401);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.downloadEvidence).not.toHaveBeenCalled();
  });

  it('does not expose a cross-project execution through the route', async () => {
    service.get.mockRejectedValueOnce(
      Object.assign(new Error('membership required'), { code: 'project_membership_required', status: 403 })
    );

    const response = await request(makeApp()).get('/manual-executions/4');

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({ error: 'project_membership_required' }));
    expect(JSON.stringify(response.body)).not.toContain('storageKey');
  });

  it('returns a typed authorization error before attempting an evidence download', async () => {
    service.downloadEvidence.mockRejectedValueOnce(
      Object.assign(new Error('membership required'), { code: 'project_membership_required', status: 403 })
    );

    const response = await request(makeApp()).get('/manual-executions/4/evidence/9');

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({ error: 'project_membership_required' }));
  });

  it('never turns an evidence storage key into a public URL', async () => {
    service.get.mockResolvedValueOnce({ id: 4, projectId: 10, status: 'running', evidence: [] });
    service.listEvidence.mockResolvedValueOnce([
      { id: 9, filename: 'proof.png', mimeType: 'image/png', size: 8, sha256: 'a'.repeat(64) },
    ]);

    const response = await request(makeApp()).get('/manual-executions/4/evidence');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 9, filename: 'proof.png', mimeType: 'image/png', size: 8, sha256: 'a'.repeat(64) },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/url|public|storageKey/i);
  });

  it('rejects invalid IDs without invoking the application service', async () => {
    const response = await request(makeApp()).get('/manual-executions/not-an-id');

    expect(response.status).toBe(400);
    expect(service.get).not.toHaveBeenCalled();
  });

  it('loads run-case history through the authenticated service', async () => {
    service.listHistory.mockResolvedValueOnce({ items: [], total: 0 });

    const response = await request(makeApp()).get('/manual-executions/run-cases/12/history?page=2&limit=5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], total: 0 });
    expect(service.listHistory).toHaveBeenCalledWith(12, 7, 2, 5);
  });

  it('rejects malformed history pagination before invoking the service', async () => {
    const response = await request(makeApp()).get('/manual-executions/run-cases/12/history?page=zero');

    expect(response.status).toBe(400);
    expect(service.listHistory).not.toHaveBeenCalled();
  });

  it('updates a report through the authenticated execution service', async () => {
    const report = {
      version: 1,
      failureReason: 'Observed failure',
      howToFix: 'Deploy the fix',
      reproductionSteps: 'Open the case',
      browser: 'Firefox',
      environment: 'Staging',
    };
    service.updateReport.mockResolvedValueOnce({ id: 4, correlationId: 'report-4' });

    const response = await request(makeApp()).patch('/manual-executions/4/report').send({ report });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 4, correlationId: 'report-4' });
    expect(service.updateReport).toHaveBeenCalledWith(4, 7, report);
  });

  it('includes correlation data when multipart parsing rejects the upload', async () => {
    const response = await request(makeApp())
      .post('/manual-executions/4/evidence')
      .set('X-Correlation-Id', 'upload-parser-1')
      .attach('unexpected', Buffer.from('bytes'), { filename: 'proof.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({ error: 'evidence_upload_invalid', code: 'evidence_upload_invalid' })
    );
    expect(response.body.correlationId).toBe('upload-parser-1');
    expect(service.uploadEvidence).not.toHaveBeenCalled();
  });
});
