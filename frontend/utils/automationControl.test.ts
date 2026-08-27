import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAutomationExecution,
  createAutomationExecution,
  fetchAutomationArtifacts,
  fetchAutomationEnvironments,
  fetchAutomationExecution,
  fetchAutomationHistory,
  formatAutomationDuration,
  isAutomationActive,
  runAutomationBatch,
} from './automationControl';

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 403, json: vi.fn().mockResolvedValue(body) }) as unknown as Response;

describe('automation frontend boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('distinguishes active lifecycle states from terminal failures', () => {
    expect(isAutomationActive('queued')).toBe(true);
    expect(isAutomationActive('running')).toBe(true);
    expect(isAutomationActive('failed')).toBe(false);
    expect(isAutomationActive('error')).toBe(false);
    expect(formatAutomationDuration(1250)).toBe('1.25s');
    expect(formatAutomationDuration(undefined)).toBe('—');
  });

  it('creates an execution with the selected environment and idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'execution-1', status: 'queued' }));
    vi.stubGlobal('fetch', fetchMock);

    await createAutomationExecution('jwt', {
      projectId: 10,
      caseId: 7,
      environmentId: 3,
      idempotencyKey: 'case-7-run-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/automation/executions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt',
          'Idempotency-Key': 'case-7-run-1',
        }),
        body: JSON.stringify({ projectId: 10, caseId: 7, environmentId: 3 }),
      })
    );
  });

  it('keeps polling, history, evidence, and cancellation on the authenticated boundary', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 3, name: 'QA' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'execution-1', status: 'running' }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'artifact-1', kind: 'junit' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'execution-1', status: 'passed' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'execution-1', status: 'cancelled' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAutomationEnvironments('jwt', 10)).resolves.toEqual([{ id: 3, name: 'QA' }]);
    await expect(fetchAutomationExecution('jwt', 'execution-1')).resolves.toMatchObject({ status: 'running' });
    await expect(fetchAutomationArtifacts('jwt', 'execution-1')).resolves.toEqual([
      { id: 'artifact-1', kind: 'junit' },
    ]);
    await expect(fetchAutomationHistory('jwt', 10, 7)).resolves.toEqual([{ id: 'execution-1', status: 'passed' }]);
    await expect(cancelAutomationExecution('jwt', 'execution-1')).resolves.toMatchObject({ status: 'cancelled' });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/automation/projects/10/environments');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/automation/projects/10/executions?page=1&limit=20&caseId=7');
  });

  it('surfaces authorization failures instead of inventing an execution state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'forbidden' }, false)));

    await expect(fetchAutomationEnvironments('jwt', 999)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('keeps bounded structured validation fields on request failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: 'invalid_source',
            correlationId: 'corr-1',
            fields: [
              { field: 'Steps[0].step', code: 'required', message: 'step text is required' },
              { field: 'secret', message: 'missing code' },
              'not a field',
            ],
          },
          false
        )
      )
    );

    await expect(fetchAutomationEnvironments('jwt', 10)).rejects.toMatchObject({
      code: 'invalid_source',
      correlationId: 'corr-1',
      fields: [{ field: 'Steps[0].step', code: 'required', message: 'step text is required' }],
    });
  });

  it('runs batch cases sequentially and reports each terminal execution', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'execution-1', status: 'passed' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'execution-2', status: 'failed' }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await runAutomationBatch('jwt', {
      projectId: 10,
      runId: 4,
      environmentId: 3,
      batchId: 'batch-1',
      cases: [
        { caseId: 8, runCaseId: 12, title: 'First' },
        { caseId: 7, runCaseId: 11, title: 'Second' },
      ],
    });

    expect(results.map((result) => result.execution?.status)).toEqual(['passed', 'failed']);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).runCaseId)).toEqual([12, 11]);
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe('run-4-case-12-batch-1');
  });

  it('keeps structured request fields in batch failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: 'invalid_source',
            fields: [{ field: 'Steps[0].step', code: 'required', message: 'step text is required' }],
          },
          false
        )
      )
    );

    await expect(
      runAutomationBatch('jwt', {
        projectId: 10,
        runId: 4,
        environmentId: 3,
        batchId: 'batch-2',
        cases: [{ caseId: 8, runCaseId: 12, title: 'First' }],
      })
    ).resolves.toEqual([
      {
        caseId: 8,
        runCaseId: 12,
        title: 'First',
        error: 'invalid_source',
        errorFields: [{ field: 'Steps[0].step', code: 'required', message: 'step text is required' }],
      },
    ]);
  });
});
