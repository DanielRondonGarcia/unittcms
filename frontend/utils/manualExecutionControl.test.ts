import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelManualExecution,
  deleteManualEvidence,
  downloadManualEvidence,
  fetchActiveManualExecution,
  fetchManualExecutionHistory,
  fetchManualExecution,
  finishManualExecution,
  listManualEvidence,
  startManualExecution,
  uploadManualEvidence,
  updateManualExecutionReport,
} from './manualExecutionControl';

const execution = (overrides: Record<string, unknown> = {}) => ({
  id: 4,
  projectId: 10,
  runId: 3,
  runCaseId: 12,
  caseId: 8,
  actorUserId: 7,
  assigneeUserId: 9,
  status: 'running',
  result: null,
  startedAt: '2026-08-30T10:00:00.000Z',
  finishedAt: null,
  caseRevision: 2,
  caseSnapshotHash: 'a'.repeat(64),
  stale: false,
  historical: false,
  sourceDeleted: false,
  correlationId: 'manual-4',
  ...overrides,
});

const evidence = {
  id: 6,
  executionId: 4,
  uploaderUserId: 7,
  filename: 'proof.png',
  mimeType: 'image/png',
  size: 8,
  sha256: 'b'.repeat(64),
  expiresAt: '2026-09-29T10:00:00.000Z',
  createdAt: '2026-08-30T10:01:00.000Z',
};

const report = {
  version: 1 as const,
  failureReason: 'The action failed visibly.',
  howToFix: 'Apply the latest release.',
  reproductionSteps: 'Open the case and submit it.',
  browser: 'Chrome 140',
  environment: 'Staging',
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('manual execution frontend API boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the aggregate lifecycle on the authenticated API contract', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(execution()))
      .mockResolvedValueOnce(jsonResponse(execution()))
      .mockResolvedValueOnce(jsonResponse(execution()))
      .mockResolvedValueOnce(
        jsonResponse(execution({ status: 'finished', result: 'passed', finishedAt: '2026-08-30T10:02:00.000Z' }))
      )
      .mockResolvedValueOnce(jsonResponse(execution({ status: 'cancelled', finishedAt: '2026-08-30T10:03:00.000Z' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(startManualExecution('jwt', 12)).resolves.toMatchObject({ ok: true, data: { status: 'running' } });
    await expect(fetchActiveManualExecution('jwt', 12)).resolves.toMatchObject({ ok: true, data: { id: 4 } });
    await expect(fetchManualExecution('jwt', 4)).resolves.toMatchObject({ ok: true, data: { id: 4 } });
    await expect(finishManualExecution('jwt', 4, 'passed')).resolves.toMatchObject({
      ok: true,
      data: { status: 'finished', result: 'passed' },
    });
    await expect(cancelManualExecution('jwt', 4)).resolves.toMatchObject({ ok: true, data: { status: 'cancelled' } });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/manual-executions/run-cases/12',
      '/api/manual-executions/run-cases/12/active',
      '/api/manual-executions/4',
      '/api/manual-executions/4/finish',
      '/api/manual-executions/4/cancel',
    ]);
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ result: 'passed' }) }));
    expect(fetchMock.mock.calls[0][1].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer jwt', 'Content-Type': 'application/json' })
    );
  });

  it('turns an empty active response into data and preserves typed 429 diagnostics', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: 'active_execution_not_found', code: 'active_execution_not_found' }, 404)
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'rate_limited', code: 'rate_limited', correlationId: 'corr-429' }, 429, {
          'X-Correlation-Id': 'corr-429',
          'Retry-After': '45',
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchActiveManualExecution('jwt', 12)).resolves.toEqual({ ok: true, data: null });
    await expect(startManualExecution('jwt', 12)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        status: 429,
        code: 'rate_limited',
        correlationId: 'corr-429',
        retryAfterSeconds: 45,
      }),
    });
  });

  it('fetches paginated manual history with a typed response and bounded query values', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [execution()], total: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchManualExecutionHistory('jwt', 12, 5, 2)).resolves.toEqual({
      ok: true,
      data: { items: [execution()], total: 1 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/manual-executions/run-cases/12/history?page=2&limit=5',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer jwt' } })
    );
  });

  it('accepts backward-compatible views and sends a versioned report through the PATCH endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(execution({ report })))
      .mockResolvedValueOnce(jsonResponse(execution({ report })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchManualExecution('jwt', 4)).resolves.toMatchObject({ ok: true, data: { report } });
    await expect(updateManualExecutionReport('jwt', 4, report)).resolves.toMatchObject({
      ok: true,
      data: { report },
    });

    expect(fetchMock.mock.calls[1][0]).toBe('/api/manual-executions/4/report');
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ report }),
      })
    );
  });

  it('rejects malformed success and unauthorized responses without an absent-payload crash', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 4, status: 'running' }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'project_membership_required', code: 'project_membership_required' }, 403)
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchManualExecution('jwt', 4)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ status: 200, code: 'malformed_response' }),
    });
    await expect(fetchManualExecution('jwt', 4)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ status: 403, code: 'project_membership_required' }),
    });
  });

  it('uploads, lists, downloads, and deletes evidence through authenticated private endpoints', async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(evidence, 201))
      .mockResolvedValueOnce(jsonResponse([evidence]))
      .mockResolvedValueOnce(new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([bytes], 'proof.png', { type: 'image/png' });

    await expect(uploadManualEvidence('jwt', 4, file)).resolves.toMatchObject({ ok: true, data: evidence });
    await expect(listManualEvidence('jwt', 4)).resolves.toEqual({ ok: true, data: [evidence] });
    await expect(downloadManualEvidence('jwt', 4, 6)).resolves.toMatchObject({
      ok: true,
      data: { mimeType: 'image/png' },
    });
    await expect(deleteManualEvidence('jwt', 4, 6)).resolves.toEqual({ ok: true, data: undefined });

    const uploadInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(uploadInit.headers).toEqual({ Authorization: 'Bearer jwt' });
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect((uploadInit.body as FormData).get('file')).toMatchObject({ name: 'proof.png', type: 'image/png', size: 4 });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/manual-executions/4/evidence/6');
  });
});
