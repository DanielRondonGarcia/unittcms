import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAutomationExecution,
  createAutomationExecution,
  fetchAutomationArtifacts,
  fetchAutomationDefaultEnvironment,
  fetchAutomationEnvironments,
  fetchAutomationExecution,
  fetchAutomationHistory,
  formatAutomationError,
  formatAutomationExampleLabel,
  formatAutomationDuration,
  isAutomationActive,
  runAutomationBatch,
  saveAutomationDefaultEnvironment,
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

  it.each([
    ['hercules_process_failed', 'A technical failure stopped the execution. Check the environment and retry.'],
    ['functional_failure', 'The scenario did not pass. Review the execution evidence and expected result.'],
    [
      'evidence_secret_detected',
      'The execution could not be verified because required evidence is missing or unsafe. Review the artifacts and retry.',
    ],
    [
      'deadline_exceeded',
      'Hercules exceeded the execution time limit. Review the process output for context, then retry the execution.',
    ],
    ['hercules_cancelled', 'The execution was cancelled before it completed.'],
    ['legacy_internal_code', 'The automation could not be completed. Review the details and try again.'],
  ])('maps %s to translated, actionable feedback', (code, expected) => {
    const messages = {
      automationTechnicalFailure: 'A technical failure stopped the execution. Check the environment and retry.',
      automationFunctionalFailure: 'The scenario did not pass. Review the execution evidence and expected result.',
      automationEvidenceFailure:
        'The execution could not be verified because required evidence is missing or unsafe. Review the artifacts and retry.',
      automationCancelledDetail: 'The execution was cancelled before it completed.',
      automationGenericFailure: 'The automation could not be completed. Review the details and try again.',
      automationTimeoutDetail:
        'Hercules exceeded the execution time limit. Review the process output for context, then retry the execution.',
    };

    expect(formatAutomationError({ code }, messages)).toBe(expected);
  });

  it('does not turn ordinary lifecycle messages into error feedback', () => {
    const messages = {
      automationTechnicalFailure: 'technical',
      automationFunctionalFailure: 'functional',
      automationEvidenceFailure: 'evidence',
      automationCancelledDetail: 'cancelled',
      automationGenericFailure: 'generic',
      automationTimeoutDetail: 'timeout',
    };

    expect(formatAutomationError({ code: 'Execution queued', status: 'queued' }, messages)).toBeUndefined();
  });

  it('formats Example labels with a one-based index and a readable row preview', () => {
    expect(formatAutomationExampleLabel('Example', 0, ['Ada', 'admin'])).toBe('Example 1: Ada · admin');
    expect(formatAutomationExampleLabel('Example', 2)).toBe('Example 3');
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

  it('requests the bounded batch history page when rehydrating by RunCase', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAutomationHistory('jwt', 10, undefined, 12, 100)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/automation/projects/10/executions?page=1&limit=100&runCaseId=12',
      expect.anything()
    );
  });

  it('surfaces authorization failures instead of inventing an execution state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'forbidden' }, false)));

    await expect(fetchAutomationEnvironments('jwt', 999)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('reads and saves the project environment host allowlist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          environment: {
            baseUrl: 'https://app.example.test',
            allowedHosts: ['app.example.test', 'login.example.test'],
            enabled: true,
            isDefault: true,
            captureVideo: false,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          environment: {
            baseUrl: 'https://app.example.test',
            allowedHosts: ['app.example.test', 'login.example.test'],
            enabled: true,
            isDefault: true,
            captureVideo: false,
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAutomationDefaultEnvironment('jwt', 10)).resolves.toMatchObject({
      allowedHosts: ['app.example.test', 'login.example.test'],
    });
    await saveAutomationDefaultEnvironment('jwt', 10, {
      baseUrl: 'https://app.example.test',
      allowedHosts: [' login.example.test ', 'login.example.test'],
      enabled: true,
      captureVideo: false,
    });

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      baseUrl: 'https://app.example.test',
      allowedHosts: [' login.example.test ', 'login.example.test'],
      enabled: true,
      captureVideo: false,
    });
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

  it('keeps each Scenario Outline row independent in batch requests and idempotency keys', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'execution-1', status: 'passed', exampleIndex: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'execution-2', status: 'failed', exampleIndex: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await runAutomationBatch('jwt', {
      projectId: 10,
      runId: 4,
      environmentId: 3,
      batchId: 'batch-examples',
      cases: [
        { caseId: 8, runCaseId: 12, title: 'Outline', exampleIndex: 0 },
        { caseId: 8, runCaseId: 12, title: 'Outline', exampleIndex: 1 },
      ],
    });

    expect(results.map((result) => result.execution?.id)).toEqual(['execution-1', 'execution-2']);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).exampleIndex)).toEqual([0, 1]);
    expect(fetchMock.mock.calls.map((call) => call[1].headers['Idempotency-Key'])).toEqual([
      'run-4-case-12-batch-examples-example-0',
      'run-4-case-12-batch-examples-example-1',
    ]);
  });

  it('continues with later example rows when an earlier row request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_source' }, false))
      .mockResolvedValueOnce(jsonResponse({ id: 'execution-2', status: 'passed', exampleIndex: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await runAutomationBatch('jwt', {
      projectId: 10,
      runId: 4,
      environmentId: 3,
      batchId: 'batch-continue',
      cases: [
        { caseId: 8, runCaseId: 12, title: 'Outline', exampleIndex: 0 },
        { caseId: 8, runCaseId: 12, title: 'Outline', exampleIndex: 1 },
      ],
    });

    expect(results).toEqual([
      { caseId: 8, runCaseId: 12, title: 'Outline', exampleIndex: 0, error: 'invalid_source' },
      {
        caseId: 8,
        runCaseId: 12,
        title: 'Outline',
        exampleIndex: 1,
        execution: { id: 'execution-2', status: 'passed', exampleIndex: 1 },
      },
    ]);
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
