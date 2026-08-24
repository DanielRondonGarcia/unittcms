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
});
