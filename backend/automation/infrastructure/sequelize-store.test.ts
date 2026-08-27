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
      Member: { findOne: vi.fn(async ({ where }: { where: { userId: number } }) => (where.userId === 1 ? member : null)) },
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
      environmentId: 3,
      status: 'queued',
      attempt: 1,
      idempotencyKey: 'key-1',
      correlationId: 'corr-1',
    });
    const resolved = await store.findEnvironment(3);

    expect(created).toMatchObject({ id: '12', projectId: 10, attemptHistory: [] });
    expect(createExecution).toHaveBeenCalledWith(
      expect.objectContaining({ attemptHistory: '[]', idempotencyKey: 'key-1' })
    );
    expect(resolved).toMatchObject({ allowedHosts: ['qa.example.test'], secretRefs: ['secret://qa'] });
    expect(JSON.stringify(resolved)).not.toContain('must-not-leak');
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

    await expect(store.findExecutionByIdempotencyKey({ projectId: 10, idempotencyKey: 'key-1' })).resolves.toMatchObject({ id: '12' });
    await expect(store.listExecutions({ projectId: 10, caseId: 7, runCaseId: 3, offset: 20, limit: 10 })).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: '12' })],
    });
    await expect(store.findRunCase(3)).resolves.toEqual({ id: 3, caseId: 7, runId: 20, projectId: 10 });
    const artifacts = await store.listArtifacts('12');
    expect(artifacts[0]).toMatchObject({ id: '5', projectId: 10, storageKey: 'execution/12/result.xml' });
    expect(JSON.stringify(artifacts)).not.toContain('must-not-leak');
  });
});
