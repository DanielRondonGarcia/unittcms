import { describe, expect, it, vi } from 'vitest';
import type { AutomationModels } from './sequelize-store.js';
import { SequelizeAutomationStore } from './sequelize-store.js';

function record(value: Record<string, unknown>) {
  const state = { ...value };
  return {
    get: () => ({ ...state }),
    update: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(state, patch);
      return record(state);
    }),
  };
}

function model(overrides: Record<string, unknown> = {}) {
  return {
    findByPk: vi.fn(async () => null),
    findOne: vi.fn(async () => null),
    findAll: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    create: vi.fn(async (value: Record<string, unknown>) => record(value)),
    update: vi.fn(async () => [1]),
    destroy: vi.fn(async () => 0),
    ...overrides,
  };
}

function models(overrides: Partial<Record<keyof AutomationModels, Record<string, unknown>>> = {}): AutomationModels {
  return {
    Case: model(overrides.Case),
    Step: model(overrides.Step),
    CaseStep: model(overrides.CaseStep),
    Folder: model(overrides.Folder),
    Project: model(overrides.Project),
    Member: model(overrides.Member),
    Run: model(overrides.Run),
    RunCase: model(overrides.RunCase),
    AutomationDefinition: model(overrides.AutomationDefinition),
    AutomationExecution: model(overrides.AutomationExecution),
    TestEnvironment: model(overrides.TestEnvironment),
    ExecutionArtifact: model(overrides.ExecutionArtifact),
  } as unknown as AutomationModels;
}

describe('Sequelize automation store', () => {
  it('returns canonical case input with project and section metadata while omitting unrelated fields', async () => {
    const source = record({
      id: 7,
      title: 'Login',
      template: 2,
      automationVersion: 4,
      gherkinExamples: { headers: ['user'], rows: [['Ada']] },
      secretValue: 'must-not-leak',
      Folder: { Project: { id: 10 } },
      Steps: [
        { step: 'the visitor is signed out', caseSteps: { stepNo: 1, keyword: 'given', section: 'background' } },
        { step: 'the dashboard is shown', caseSteps: { stepNo: 2, keyword: 'then', section: 'scenario' } },
      ],
    });
    const data = models({ Case: { findByPk: vi.fn(async () => source) } });
    const result = await new SequelizeAutomationStore(data).findCase(7);

    expect(result).toMatchObject({
      id: 7,
      projectId: 10,
      title: 'Login',
      gherkinExamples: { headers: ['user'], rows: [['Ada']] },
      Steps: [
        { caseSteps: { stepNo: 1, keyword: 'given', section: 'background' } },
        { caseSteps: { stepNo: 2, keyword: 'then', section: 'scenario' } },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('matches existing visibility policy for public, owner, and member access', async () => {
    const project = record({ id: 10, userId: 2, isPublic: false });
    const member = record({ userId: 1, projectId: 10, role: 1 });
    const findProject = vi.fn(async () => project);
    const data = models({
      Project: { findByPk: findProject },
      Member: {
        findOne: vi.fn(async ({ where }: { where: { userId: number } }) => (where.userId === 1 ? member : null)),
      },
    });
    const store = new SequelizeAutomationStore(data);

    await expect(store.canAccessProject(1, 10)).resolves.toBe(true);
    await expect(store.canAccessProject(3, 10)).resolves.toBe(false);
    findProject.mockResolvedValue(record({ id: 10, userId: 2, isPublic: true }));
    await expect(store.canAccessProject(3, 10)).resolves.toBe(true);
  });

  it('serializes execution metadata and deserializes attempt history and environment arrays', async () => {
    const execution = record({
      id: 12,
      projectId: 10,
      caseId: 7,
      exampleIndex: 1,
      status: 'queued',
      attempt: 1,
      correlationId: 'corr-1',
      attemptHistory: '[]',
    });
    const environment = record({
      id: 3,
      projectId: 10,
      name: 'QA',
      baseUrl: 'https://qa.example.test',
      allowedHosts: '["qa.example.test"]',
      secretRefs: '["secret://qa"]',
      secretValue: 'must-not-leak',
      enabled: true,
    });
    const createExecution = vi.fn(async () => execution);
    const data = models({
      AutomationExecution: { create: createExecution, findByPk: vi.fn(async () => execution) },
      TestEnvironment: { findByPk: vi.fn(async () => environment) },
    });
    const store = new SequelizeAutomationStore(data);
    const created = await store.createExecution({
      definitionId: 2,
      projectId: 10,
      caseId: 7,
      exampleIndex: 1,
      environmentId: 3,
      status: 'queued',
      attempt: 1,
      idempotencyKey: 'key-1',
      correlationId: 'corr-1',
    });
    const resolved = await store.findEnvironment(3);

    expect(created).toMatchObject({ id: '12', projectId: 10, exampleIndex: 1, attemptHistory: [] });
    expect(createExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptHistory: '[]',
        exampleIndex: 1,
        idempotencyKey: 'key-1',
        activeExecutionKey: null,
      })
    );
    expect(resolved).toMatchObject({ allowedHosts: ['qa.example.test'], secretRefs: ['secret://qa'] });
    expect(JSON.stringify(resolved)).not.toContain('must-not-leak');
  });

  it('finds legacy active RunCase executions without a backfilled key and clears the key when terminal', async () => {
    const execution = record({
      id: 'e1',
      projectId: 10,
      caseId: 7,
      runCaseId: 3,
      exampleIndex: 1,
      status: 'running',
      attempt: 1,
      activeExecutionKey: null,
    });
    const findActive = vi.fn(async () => execution);
    const data = models({
      AutomationExecution: {
        findOne: findActive,
        findByPk: vi.fn(async () => execution),
      },
    });
    const store = new SequelizeAutomationStore(data);

    await expect(store.findActiveExecution?.({ runCaseId: 3, exampleIndex: 1 })).resolves.toMatchObject({ id: 'e1' });
    expect(findActive).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runCaseId: 3, exampleIndex: 1 }),
        order: [['id', 'ASC']],
      })
    );
    await store.updateExecution('e1', { status: 'passed' });
    expect(execution.update).toHaveBeenCalledWith(expect.objectContaining({ activeExecutionKey: null }));
  });

  it('turns a unique-key race into the active execution error while checking legacy rows', async () => {
    const active = record({
      id: 'e1',
      projectId: 10,
      caseId: 7,
      runCaseId: 3,
      exampleIndex: 1,
      status: 'queued',
      attempt: 1,
      activeExecutionKey: null,
    });
    const findOne = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(active);
    const data = models({
      AutomationExecution: {
        create: vi.fn(async () => {
          throw { name: 'SequelizeUniqueConstraintError' };
        }),
        findOne,
      },
    });
    const store = new SequelizeAutomationStore(data);

    await expect(
      store.createExecution({
        projectId: 10,
        caseId: 7,
        runCaseId: 3,
        exampleIndex: 1,
        status: 'queued',
        attempt: 1,
        idempotencyKey: 'race-key',
      })
    ).rejects.toThrow('automation_execution_active');
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('supports idempotency, filtered pagination, RunCase ownership, and private artifact metadata', async () => {
    const existing = record({ id: 12, projectId: 10, caseId: 7, status: 'passed', attempt: 1 });
    const artifact = record({
      id: 5,
      executionId: 12,
      attempt: 1,
      kind: 'junit',
      storageKey: 'execution/12/result.xml',
      mimeType: 'application/xml',
      size: 20,
      sha256: 'a'.repeat(64),
      privateValue: 'must-not-leak',
    });
    const data = models({
      AutomationExecution: {
        findOne: vi.fn(async () => existing),
        findByPk: vi.fn(async () => existing),
        findAll: vi.fn(async () => [existing]),
        count: vi.fn(async () => 1),
      },
      RunCase: {
        findByPk: vi.fn(async () => record({ id: 3, caseId: 7, runId: 20 })),
      },
      Run: { findByPk: vi.fn(async () => record({ id: 20, projectId: 10 })) },
      ExecutionArtifact: { findByPk: vi.fn(async () => artifact), findAll: vi.fn(async () => [artifact]) },
    });
    const store = new SequelizeAutomationStore(data);

    await expect(
      store.findExecutionByIdempotencyKey({ projectId: 10, idempotencyKey: 'key-1' })
    ).resolves.toMatchObject({ id: '12' });
    await expect(
      store.listExecutions({ projectId: 10, caseId: 7, runCaseId: 3, offset: 20, limit: 10 })
    ).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: '12' })],
    });
    await expect(store.findRunCase(3)).resolves.toEqual({ id: 3, caseId: 7, runId: 20, projectId: 10 });
    const artifacts = await store.listArtifacts('12');
    expect(artifacts[0]).toMatchObject({ id: '5', projectId: 10, storageKey: 'execution/12/result.xml' });
    expect(JSON.stringify(artifacts)).not.toContain('must-not-leak');

    await store.createArtifact({
      executionId: 12,
      projectId: 10,
      attempt: 1,
      kind: 'video',
      storageKey: 'execution/12/attempt/1/video.webm',
      mimeType: 'video/webm',
      size: 12,
      sha256: 'b'.repeat(64),
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(data.ExecutionArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 12,
        kind: 'video',
        storageKey: 'execution/12/attempt/1/video.webm',
        sha256: 'b'.repeat(64),
      })
    );
    await store.deleteArtifacts(['execution/12/attempt/1/video.webm']);
    expect(data.ExecutionArtifact.destroy).toHaveBeenCalledWith({
      where: { storageKey: ['execution/12/attempt/1/video.webm'] },
    });
  });

  it.each([
    ['failed then passed', ['failed', 'passed']],
    ['passed then failed', ['passed', 'failed']],
  ] as const)('keeps a failed Examples aggregate dominant when rows finish %s', async (_label, statuses) => {
    const executions = statuses.map((status, index) =>
      record({
        id: `e${index + 1}`,
        projectId: 10,
        caseId: 7,
        runCaseId: 3,
        exampleIndex: index,
        status,
        attempt: 1,
      })
    );
    const updateRunCase = vi.fn(async () => [1]);
    const data = models({
      AutomationExecution: {
        findByPk: vi.fn(async () => executions[1]),
        findAll: vi.fn(async () => executions),
      },
      RunCase: {
        findByPk: vi.fn(async () => record({ id: 3, caseId: 7, runId: 20 })),
        update: updateRunCase,
      },
      Run: { findByPk: vi.fn(async () => record({ id: 20, projectId: 10 })) },
    });

    await new SequelizeAutomationStore(data).updateRunCaseStatus({
      runCaseId: 3,
      projectId: 10,
      status: statuses[1] === 'passed' ? 1 : 2,
      executionId: 'e2',
      attempt: 1,
      correlationId: 'corr-2',
    });

    expect(data.AutomationExecution.findAll).toHaveBeenCalledWith({
      where: { runCaseId: 3, projectId: 10 },
    });
    expect(updateRunCase).toHaveBeenCalledWith({ status: 2 }, { where: { id: 3 } });
  });

  it('does not mark an Examples RunCase passed from individual passed rows', async () => {
    const executions = [0, 1].map((index) =>
      record({
        id: `e${index + 1}`,
        projectId: 10,
        caseId: 7,
        runCaseId: 3,
        exampleIndex: index,
        status: 'passed',
        attempt: 1,
      })
    );
    const updateRunCase = vi.fn(async () => [1]);
    const data = models({
      AutomationExecution: {
        findByPk: vi.fn(async () => executions[1]),
        findAll: vi.fn(async () => executions),
      },
      RunCase: {
        findByPk: vi.fn(async () => record({ id: 3, caseId: 7, runId: 20 })),
        update: updateRunCase,
      },
      Run: { findByPk: vi.fn(async () => record({ id: 20, projectId: 10 })) },
    });

    await new SequelizeAutomationStore(data).updateRunCaseStatus({
      runCaseId: 3,
      projectId: 10,
      status: 1,
      executionId: 'e2',
      attempt: 1,
      correlationId: 'corr-2',
    });

    expect(updateRunCase).not.toHaveBeenCalled();
  });

  it('uses the persisted terminal status directly for a non-Examples execution', async () => {
    const updateRunCase = vi.fn(async () => [1]);
    const data = models({
      AutomationExecution: {
        findByPk: vi.fn(async () =>
          record({ id: 'e1', projectId: 10, caseId: 7, runCaseId: 3, exampleIndex: null, status: 'passed', attempt: 1 })
        ),
      },
      RunCase: {
        findByPk: vi.fn(async () => record({ id: 3, caseId: 7, runId: 20 })),
        update: updateRunCase,
      },
      Run: { findByPk: vi.fn(async () => record({ id: 20, projectId: 10 })) },
    });

    await new SequelizeAutomationStore(data).updateRunCaseStatus({
      runCaseId: 3,
      projectId: 10,
      status: 2,
      executionId: 'e1',
      attempt: 1,
      correlationId: 'corr-1',
    });

    expect(data.AutomationExecution.findAll).not.toHaveBeenCalled();
    expect(updateRunCase).toHaveBeenCalledWith({ status: 1 }, { where: { id: 3 } });
  });

  it('marks a previously passed RunCase failed when its execution lacks verifiable evidence', async () => {
    const updateRunCase = vi.fn(async () => [1]);
    const runCase = record({ id: 3, caseId: 7, runId: 20, status: 1 });
    const data = models({
      AutomationExecution: {
        findByPk: vi.fn(async () =>
          record({
            id: 'evidence-error',
            projectId: 10,
            caseId: 7,
            runCaseId: 3,
            exampleIndex: null,
            status: 'error',
            errorKind: 'evidence',
            attempt: 1,
          })
        ),
      },
      RunCase: { findByPk: vi.fn(async () => runCase), update: updateRunCase },
      Run: { findByPk: vi.fn(async () => record({ id: 20, projectId: 10 })) },
    });

    await new SequelizeAutomationStore(data).updateRunCaseStatus({
      runCaseId: 3,
      projectId: 10,
      status: 2,
      executionId: 'evidence-error',
      attempt: 1,
      correlationId: 'corr-evidence',
    });

    expect(runCase.get?.()).toMatchObject({ status: 1 });
    expect(updateRunCase).toHaveBeenCalledWith({ status: 2 }, { where: { id: 3 } });
  });
});
