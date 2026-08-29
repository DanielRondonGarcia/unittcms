import { describe, expect, it, vi } from 'vitest';
import { createAutomationApplication } from '../application/service.js';
import { FakeAutomationExecutor } from '../infrastructure/fake.js';
import { EnvironmentResolver } from '../infrastructure/environment.js';
import type { AutomationStore, ExecutionQueue } from '../ports/index.js';
import { NeutralExecutorRegistry } from '../ports/registry.js';

const source = {
  id: 7,
  projectId: 10,
  title: 'Login',
  Steps: [
    { step: 'the visitor is signed out', caseSteps: { stepNo: 1, keyword: 'given' } },
    { step: 'the login form is visible', caseSteps: { stepNo: 2, keyword: 'when' } },
    { step: 'the dashboard is shown', caseSteps: { stepNo: 3, keyword: 'then' } },
  ],
};

function store(caseSource = source) {
  return {
    findCase: vi.fn(async () => caseSource),
    canAccessProject: vi.fn(async (userId: number, projectId: number) => userId === 1 && projectId === 10),
    findExecutionByIdempotencyKey: vi.fn(async (): Promise<unknown> => null),
    createDefinition: vi.fn(async (value) => ({ id: 4, ...value })),
    createExecution: vi.fn(async (value) => ({ id: 'e1', status: 'queued', attempt: 1, ...value })),
    findExecution: vi.fn(async () => ({ id: 'e1', projectId: 10, caseId: 7, status: 'queued', attempt: 1 })),
    updateExecution: vi.fn(async (id, value) => ({ id, ...value })),
    listExecutions: vi.fn(async (query) => ({ items: [{ id: 'e1', ...query }], total: 1 })),
    findEnvironment: vi.fn(async (id: number) =>
      id === 3
        ? {
            id: 3,
            projectId: 10,
            name: 'QA',
            enabled: true,
            baseUrl: 'https://example.test',
            allowedHosts: ['example.test'],
            secretRefs: [],
          }
        : null
    ),
    findRunCase: vi.fn(async (id: number) => (id === 3 ? { id: 3, caseId: 7, runId: 20, projectId: 10 } : null)),
    listArtifacts: vi.fn(async () => []),
    findArtifact: vi.fn(async () => null),
  };
}

type TestStore = ReturnType<typeof store>;
function makeApplication(data: TestStore, queue: unknown) {
  return createAutomationApplication({
    store: data as unknown as AutomationStore,
    queue: queue as ExecutionQueue,
    registry: new NeutralExecutorRegistry(),
    environmentResolver: new EnvironmentResolver(async () => ({
      baseUrl: 'https://example.test',
      allowedHosts: ['example.test'],
      secretRefs: [],
    })),
  });
}

describe('automation API application boundary', () => {
  it('keeps the executor neutral and fake-specific behavior out of the default registry', async () => {
    const fake = new FakeAutomationExecutor();
    const registry = new NeutralExecutorRegistry();
    registry.register('fake', fake);

    expect(await registry.select('fake')).toBe(fake);
    expect(await fake.execute({ executionId: 'e1', snapshot: 'feature' })).toMatchObject({ outcome: 'passed' });
    expect((await registry.list()).map(({ key }) => key)).toEqual(['fake']);
  });

  it('authorizes the project, validates before enqueue, and makes create idempotent', async () => {
    const invalid = store({ ...source, Steps: [{ step: '', caseSteps: { stepNo: 1, keyword: 'given' } }] });
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };
    const app = makeApplication(invalid, queue);

    await expect(
      app.create({ userId: 1, projectId: 10, caseId: 7, environmentId: 3, idempotencyKey: 'key-1' })
    ).rejects.toMatchObject({ status: 400 });
    expect(queue.enqueue).not.toHaveBeenCalled();

    const otherProject = store({ ...source, projectId: 11 });
    await expect(
      makeApplication(otherProject, queue).create({
        userId: 1,
        projectId: 10,
        caseId: 7,
        environmentId: 3,
        idempotencyKey: 'key-x',
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(queue.enqueue).not.toHaveBeenCalled();

    const authorized = store();
    const existing = { id: 'existing', status: 'queued' };
    authorized.findExecutionByIdempotencyKey.mockResolvedValue(existing);
    const result = await makeApplication(authorized, queue).create({
      userId: 1,
      projectId: 10,
      caseId: 7,
      environmentId: 3,
      idempotencyKey: 'key-1',
    });
    expect(result).toBe(existing);
    expect(queue.enqueue).not.toHaveBeenCalled();

    authorized.findExecutionByIdempotencyKey.mockResolvedValue(null);
    const created = await makeApplication(authorized, queue).create({
      userId: 1,
      projectId: 10,
      caseId: 7,
      environmentId: 3,
      idempotencyKey: 'key-2',
    });
    expect(created).toMatchObject({ status: 'queued', snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(queue.enqueue).toHaveBeenCalledOnce();
    expect(authorized.createExecution).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: expect.any(String) })
    );
  });

  it('keeps an optional RunCase relation on the execution without changing case history', async () => {
    const data = store();
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };

    const created = await makeApplication(data, queue).create({
      userId: 1,
      projectId: 10,
      caseId: 7,
      environmentId: 3,
      runCaseId: 3,
      idempotencyKey: 'run-case-link',
    });

    expect(data.createExecution).toHaveBeenCalledWith(expect.objectContaining({ runCaseId: 3 }));
    expect(data.findRunCase).toHaveBeenCalledWith(3);
    expect(created).toMatchObject({ runCaseId: 3, caseId: 7 });
    expect(data.findCase).toHaveBeenCalledWith(7);
  });

  it('creates one queued execution for the selected Examples row and sends a row-only snapshot', async () => {
    const data = store({
      ...source,
      gherkinExamples: { headers: ['user'], rows: [['Ada'], ['Lin']] },
      Steps: [
        { step: '<user> is signed out', caseSteps: { stepNo: 1, keyword: 'given' } },
        { step: '<user> opens the login form', caseSteps: { stepNo: 2, keyword: 'when' } },
        { step: '<user> sees the dashboard', caseSteps: { stepNo: 3, keyword: 'then' } },
      ],
    });
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };

    const created = await makeApplication(data, queue).create({
      userId: 1,
      projectId: 10,
      caseId: 7,
      environmentId: 3,
      exampleIndex: 1,
      idempotencyKey: 'example-row-1',
    });

    expect(data.createExecution).toHaveBeenCalledWith(expect.objectContaining({ exampleIndex: 1 }));
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.stringContaining('Given Lin is signed out'),
      })
    );
    expect((queue.enqueue.mock.calls[0][0] as { snapshot: string }).snapshot).not.toContain('Examples:');
    expect(created).toMatchObject({ exampleIndex: 1 });
  });

  it('requires a valid row index for Scenario Outline executions', async () => {
    const data = store({
      ...source,
      gherkinExamples: { headers: ['user'], rows: [['Ada']] },
    });
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };
    const app = makeApplication(data, queue);

    await expect(
      app.create({ userId: 1, projectId: 10, caseId: 7, environmentId: 3, idempotencyKey: 'missing-row' })
    ).rejects.toMatchObject({ status: 400, code: 'example_index_required' });
    await expect(
      app.create({
        userId: 1,
        projectId: 10,
        caseId: 7,
        environmentId: 3,
        exampleIndex: 1,
        idempotencyKey: 'unknown-row',
      })
    ).rejects.toMatchObject({ status: 400, code: 'invalid_example_index' });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects another active execution for the same RunCase and Example', async () => {
    const data = store({
      ...source,
      gherkinExamples: { headers: ['user'], rows: [['Ada']] },
      Steps: [
        { step: '<user> is signed out', caseSteps: { stepNo: 1, keyword: 'given' } },
        { step: '<user> opens the login form', caseSteps: { stepNo: 2, keyword: 'when' } },
        { step: '<user> sees the dashboard', caseSteps: { stepNo: 3, keyword: 'then' } },
      ],
    });
    const active = { id: 'active', status: 'running', runCaseId: 3, exampleIndex: 0 };
    const findActiveExecution = vi.fn(async () => active);
    Object.assign(data, { findActiveExecution });
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };

    await expect(
      makeApplication(data, queue).create({
        userId: 1,
        projectId: 10,
        caseId: 7,
        runCaseId: 3,
        exampleIndex: 0,
        environmentId: 3,
        idempotencyKey: 'another-example-run',
      })
    ).rejects.toMatchObject({ status: 409, code: 'automation_execution_active' });
    expect(findActiveExecution).toHaveBeenCalledWith({ runCaseId: 3, exampleIndex: 0 });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an example row on a regular Scenario', async () => {
    const data = store();
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };

    await expect(
      makeApplication(data, queue).create({
        userId: 1,
        projectId: 10,
        caseId: 7,
        environmentId: 3,
        exampleIndex: 0,
        idempotencyKey: 'unexpected-row',
      })
    ).rejects.toMatchObject({ status: 400, code: 'invalid_example_index' });
    expect(data.createDefinition).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a RunCase that does not belong to the requested case and project', async () => {
    const data = store();
    data.findRunCase.mockResolvedValue({ id: 3, caseId: 99, runId: 20, projectId: 10 });
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };

    await expect(
      makeApplication(data, queue).create({
        userId: 1,
        projectId: 10,
        caseId: 7,
        environmentId: 3,
        runCaseId: 3,
        idempotencyKey: 'wrong-run-case',
      })
    ).rejects.toMatchObject({ status: 404, code: 'run_case_not_found' });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('does not leak authorization errors and applies pagination and filters', async () => {
    const data = store();
    data.canAccessProject.mockResolvedValue(false);
    const app = makeApplication(data, { enqueue: vi.fn(), cancel: vi.fn() });

    await expect(app.history({ userId: 2, projectId: 10, page: 2, limit: 10, status: 'failed' })).rejects.toMatchObject(
      { status: 403 }
    );
    expect((await app.safeError({ status: 403, code: 'forbidden' }, 'corr-1')).body).toEqual({
      error: 'forbidden',
      correlationId: 'corr-1',
    });
    expect(
      (
        await app.safeError(
          {
            status: 400,
            code: 'invalid_source',
            details: [
              { field: 'Steps[0].step', code: 'required', message: 'step text is required' },
              { secret: 'must not be returned' },
              'must not be returned',
            ],
          },
          'corr-2'
        )
      ).body
    ).toEqual({
      error: 'invalid_source',
      correlationId: 'corr-2',
      fields: [{ field: 'Steps[0].step', code: 'required', message: 'step text is required' }],
    });

    data.canAccessProject.mockResolvedValue(true);
    await app.history({ userId: 1, projectId: 10, page: 2, limit: 10, status: 'failed' });
    expect(data.listExecutions).toHaveBeenCalledWith({ projectId: 10, offset: 10, limit: 10, status: 'failed' });
  });

  it('cancels an execution once and preserves the cancelled state on repeats', async () => {
    const data = store();
    const queue = { enqueue: vi.fn(), cancel: vi.fn(async () => undefined) };
    const app = makeApplication(data, queue);

    await app.cancel({ userId: 1, executionId: 'e1' });
    data.findExecution.mockResolvedValue({ id: 'e1', projectId: 10, caseId: 7, status: 'cancelled', attempt: 1 });
    await app.cancel({ userId: 1, executionId: 'e1' });
    expect(queue.cancel).toHaveBeenCalledOnce();
  });

  it('returns only enabled project environments and binds the selected environment to a queued execution', async () => {
    const data = store();
    const listEnvironments = vi.fn(async () => [
      { id: 3, projectId: 10, name: 'QA', enabled: true, baseUrl: 'https://qa.example.test' },
      { id: 4, projectId: 10, name: 'Disabled', enabled: false, baseUrl: 'https://disabled.example.test' },
    ]);
    const findEnvironment = vi.fn(async (id: number) =>
      id === 3 ? { id: 3, projectId: 10, name: 'QA', enabled: true } : null
    );
    Object.assign(data, { listEnvironments, findEnvironment });
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };
    const app = makeApplication(data, queue);

    await expect(app.environments({ userId: 1, projectId: 10 })).resolves.toEqual([
      { id: 3, name: 'QA', enabled: true, isDefault: false },
    ]);
    await app.create({
      userId: 1,
      projectId: 10,
      caseId: 7,
      environmentId: 3,
      idempotencyKey: 'environment-run',
    });
    expect(data.createExecution).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 3 }));
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: {
          baseUrl: 'https://example.test/',
          allowedHosts: ['example.test'],
          secretRefs: [],
          captureVideo: false,
        },
      })
    );

    await expect(
      app.create({ userId: 1, projectId: 10, caseId: 7, environmentId: 9, idempotencyKey: 'wrong-environment' })
    ).rejects.toMatchObject({ status: 404, code: 'environment_not_found' });
  });

  it('requires the neutral environment resolver before creating or queueing an execution', async () => {
    const data = store();
    data.findEnvironment.mockResolvedValue({
      id: 3,
      projectId: 10,
      name: 'Unsafe',
      enabled: true,
      baseUrl: 'http://127.0.0.1',
      allowedHosts: ['127.0.0.1'],
      secretRefs: [],
    });
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };
    const resolver = new EnvironmentResolver(async (id) => {
      const value = await data.findEnvironment(id);
      return value as { baseUrl: string; allowedHosts: string[]; secretRefs: string[] };
    });
    const resolve = vi.spyOn(resolver, 'resolve');
    const app = createAutomationApplication({
      store: data as unknown as AutomationStore,
      queue,
      registry: new NeutralExecutorRegistry(),
      environmentResolver: resolver,
    });

    await expect(
      app.create({ userId: 1, projectId: 10, caseId: 7, environmentId: 3, idempotencyKey: 'unsafe-environment' })
    ).rejects.toMatchObject({ status: 400, code: 'environment_invalid' });
    expect(resolve).toHaveBeenCalledWith(3);
    expect(data.createDefinition).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();

    await expect(
      app.create({ userId: 1, projectId: 10, caseId: 7, idempotencyKey: 'missing-environment' } as never)
    ).rejects.toMatchObject({ status: 400, code: 'environment_required' });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
