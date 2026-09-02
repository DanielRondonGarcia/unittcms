import { describe, expect, it, vi } from 'vitest';
import { SequelizeReportStore, type ReportModels } from './sequelize-store.js';

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (Array.isArray(expected)) return expected.some((value) => String(value) === String(actual));
    return String(expected) === String(actual);
  });
}

function model(rows: Row[]) {
  return {
    findByPk: vi.fn(async (id: unknown) => rows.find((row) => String(row.id) === String(id)) ?? null),
    findOne: vi.fn(async (options: { where?: Row } = {}) => rows.find((row) => matches(row, options.where)) ?? null),
    findAll: vi.fn(async (options: { where?: Row } = {}) => rows.filter((row) => matches(row, options.where))),
  };
}

function fixture() {
  const users = [
    { id: 1, username: 'owner', email: 'owner@example.test', password: 'do-not-return' },
    { id: 2, username: 'executor', email: 'executor@example.test', password: 'do-not-return' },
    { id: 3, username: 'assignee', email: 'assignee@example.test', password: 'do-not-return' },
  ];
  const projects = [{ id: 10, name: 'Project', detail: 'Details', isPublic: false, userId: 1 }];
  const folders = [
    { id: 2, name: 'zulu', projectId: 10, parentFolderId: null },
    { id: 3, name: 'alpha', projectId: 10, parentFolderId: 2 },
    { id: 4, name: 'alpha', projectId: 10, parentFolderId: null },
  ];
  const cases = [
    {
      id: 20,
      folderId: 3,
      title: 'Current nested title',
      state: 0,
      priority: 1,
      type: 4,
      automationStatus: 0,
      template: 2,
      automationVersion: 3,
      description: 'description',
      preConditions: 'precondition',
      expectedResults: 'expected',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    },
    {
      id: 10,
      folderId: 2,
      title: 'Root title',
      state: 0,
      priority: 2,
      type: 4,
      automationStatus: 1,
      template: 0,
      automationVersion: 1,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    },
    { id: 11, folderId: 4, title: 'Other title', state: 0, priority: 2, type: 4, automationStatus: 1, template: 0 },
  ];
  const steps = [
    { id: 101, step: 'first current step', result: 'first expected result' },
    { id: 102, step: 'second current step', result: 'second expected result' },
  ];
  const caseSteps = [
    { id: 1001, caseId: 20, stepId: 102, stepNo: 2, keyword: 'then', section: 'scenario' },
    { id: 1002, caseId: 20, stepId: 101, stepNo: 1, keyword: 'given', section: 'background' },
  ];
  const runs = [{ id: 99, projectId: 10, name: 'Selected run', description: 'Run description', state: 1 }];
  const runCases = [
    { id: 901, runId: 99, caseId: 20, status: 2, assigneeUserId: 3 },
    { id: 902, runId: 99, caseId: 10, status: 1, assigneeUserId: null },
  ];
  const snapshot = JSON.stringify({
    id: 20,
    title: 'Retained nested snapshot',
    state: 0,
    priority: 1,
    type: 4,
    automationStatus: 0,
    template: 2,
    automationVersion: 2,
    preConditions: 'snapshot precondition',
    expectedResults: 'snapshot expected',
    folderId: 3,
    Steps: [
      {
        id: 201,
        step: 'retained first step',
        result: 'retained first result',
        caseSteps: { stepNo: 1, keyword: 'given' },
      },
      {
        id: 202,
        step: 'retained second step',
        result: 'retained second result',
        caseSteps: { stepNo: 2, keyword: 'then' },
      },
    ],
  });
  const manualExecutions = [
    {
      id: 501,
      projectId: 10,
      runId: 99,
      runCaseId: 901,
      caseId: 20,
      actorUserId: 2,
      assigneeUserId: 3,
      status: 'finished',
      result: 'failed',
      startedAt: '2026-09-01T12:00:00.000Z',
      finishedAt: '2026-09-01T12:05:00.000Z',
      caseRevision: 2,
      caseSnapshot: snapshot,
      caseSnapshotHash: 'snapshot-hash',
      staleRevision: false,
      correlationId: 'manual-correlation',
      report: null,
    },
  ];
  const manualEvidence = [
    {
      id: 601,
      executionId: 501,
      uploaderUserId: 2,
      filename: 'available.png',
      storageKey: 'execution/501/available.png',
      mimeType: 'image/png',
      size: 12,
      sha256: 'a'.repeat(64),
      expiresAt: '2026-09-30T00:00:00.000Z',
      createdAt: '2026-09-01T12:01:00.000Z',
    },
    {
      id: 602,
      executionId: 501,
      uploaderUserId: 2,
      filename: 'expired.png',
      storageKey: 'execution/501/expired.png',
      mimeType: 'image/png',
      size: 12,
      sha256: 'b'.repeat(64),
      expiresAt: '2026-08-30T00:00:00.000Z',
      createdAt: '2026-09-01T12:02:00.000Z',
    },
    {
      id: 603,
      executionId: 501,
      uploaderUserId: 2,
      filename: 'missing.png',
      storageKey: 'execution/501/missing.png',
      mimeType: 'image/png',
      size: 12,
      sha256: 'c'.repeat(64),
      expiresAt: '2026-09-30T00:00:00.000Z',
      createdAt: '2026-09-01T12:03:00.000Z',
    },
    {
      id: 604,
      executionId: 501,
      uploaderUserId: 2,
      filename: 'unavailable.png',
      storageKey: 'execution/501/unavailable.png',
      mimeType: 'image/png',
      size: 12,
      sha256: 'd'.repeat(64),
      expiresAt: '2026-09-30T00:00:00.000Z',
      createdAt: '2026-09-01T12:04:00.000Z',
    },
  ];
  const automationExecutions = [
    {
      id: 'a-1',
      definitionId: 701,
      projectId: 10,
      caseId: 20,
      runCaseId: 901,
      status: 'passed',
      attempt: 1,
      exampleIndex: null,
      engine: 'hercules',
      queuedAt: '2026-09-01T12:10:00.000Z',
      startedAt: '2026-09-01T12:10:01.000Z',
      finishedAt: '2026-09-01T12:10:05.000Z',
      durationMs: 4000,
      summary: 'passed',
      correlationId: 'automation-correlation',
    },
  ];
  const definitions = [
    { id: 701, snapshot: JSON.stringify({ feature: 'Feature: retained automation' }), snapshotHash: 'definition-hash' },
  ];
  const artifacts = [
    {
      id: 801,
      executionId: 'a-1',
      attempt: 1,
      kind: 'screenshot',
      storageKey: 'execution/a-1/shot.png',
      mimeType: 'image/png',
      size: 20,
      sha256: 'e'.repeat(64),
      expiresAt: '2026-09-30T00:00:00.000Z',
    },
  ];

  const data = {
    Project: model(projects),
    Member: model([{ userId: 2, projectId: 10, role: 2 }]),
    Folder: model(folders),
    Case: model(cases),
    Step: model(steps),
    CaseStep: model(caseSteps),
    Run: model(runs),
    RunCase: model(runCases),
    ManualExecution: model(manualExecutions),
    ManualExecutionEvidence: model(manualEvidence),
    User: model(users),
    AutomationExecution: model(automationExecutions),
    AutomationDefinition: model(definitions),
    ExecutionArtifact: model(artifacts),
  } as unknown as ReportModels;
  const sequelize = {
    transaction: vi.fn(async (work: (transaction: object) => Promise<unknown>) => work({ transaction: true })),
  };
  const evidenceProbe = vi.fn(async ({ storageKey }: { storageKey: string }) => {
    if (storageKey.endsWith('/missing.png')) return 'missing' as const;
    if (storageKey.endsWith('/unavailable.png')) return 'unavailable' as const;
    return 'available' as const;
  });
  return { data, sequelize, evidenceProbe };
}

describe('SequelizeReportStore', () => {
  it('builds a stable, snapshot-complete report with source-separated aggregates and safe evidence refs', async () => {
    const { data, sequelize, evidenceProbe } = fixture();
    const store = new SequelizeReportStore({
      sequelize,
      models: data,
      evidenceProbe,
      now: () => new Date('2026-09-01T13:00:00.000Z'),
    });

    const report = await store.build({
      userId: 2,
      projectId: 10,
      runId: 99,
      selection: { mode: 'all' },
      limits: { maxScenarios: 10, maxSelectionIds: 10, maxSerializedBytes: 1_000_000 },
    });

    expect(report.execution).toMatchObject({ id: 99, name: 'Selected run' });
    expect(report.scenarios.map(({ id }) => id)).toEqual([11, 10, 20]);
    const nested = report.scenarios.find(({ id }) => id === 20);
    expect(nested).toMatchObject({
      title: 'Retained nested snapshot',
      pathSegments: ['zulu', 'alpha'],
      stale: true,
      deleted: false,
      runCase: { id: 901, status: 'failed' },
    });
    expect(nested?.steps.map(({ position }) => position)).toEqual([1, 2]);
    expect(nested?.steps.map(({ text }) => text)).toEqual(['retained first step', 'retained second step']);
    expect(nested?.manual).toHaveLength(1);
    expect(nested?.automation).toHaveLength(1);
    expect(report.aggregates.manual).toMatchObject({ total: 3, failed: 1, untested: 2 });
    expect(report.aggregates.automation).toMatchObject({ total: 3, passed: 1, untested: 2 });
    expect(report.aggregates.combined).toBe('unavailable');

    expect(nested?.evidence.map(({ state }) => state)).toEqual([
      'available',
      'expired',
      'missing',
      'unavailable',
      'available',
    ]);
    expect(nested?.evidence[0]).toMatchObject({
      id: 601,
      source: 'manual',
      label: 'available.png',
      href: '/manual-executions/501/evidence/601',
    });
    expect(nested?.evidence.at(-1)).toMatchObject({
      id: 801,
      source: 'automation',
      label: 'shot.png',
      href: '/automation/artifacts/801/download',
    });
    expect(JSON.stringify(report)).not.toContain('storageKey');
    expect(JSON.stringify(report)).not.toContain('do-not-return');
    expect(evidenceProbe).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 2, projectId: 10, executionId: 501, evidenceId: 601 })
    );
    expect(sequelize.transaction).toHaveBeenCalledOnce();
  });

  it('authorizes project members, rejects foreign runs and explicit foreign scenarios, and never writes', async () => {
    const { data, sequelize } = fixture();
    const store = new SequelizeReportStore({ sequelize, models: data });

    await expect(
      store.build({
        userId: 99,
        projectId: 10,
        runId: 99,
        selection: { mode: 'all' },
        limits: { maxScenarios: 10, maxSelectionIds: 10, maxSerializedBytes: 1_000_000 },
      })
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    await expect(
      store.build({
        userId: 2,
        projectId: 10,
        runId: 404,
        selection: { mode: 'all' },
        limits: { maxScenarios: 10, maxSelectionIds: 10, maxSerializedBytes: 1_000_000 },
      })
    ).rejects.toMatchObject({ code: 'execution_not_found', status: 404 });

    await expect(
      store.build({
        userId: 2,
        projectId: 10,
        runId: 99,
        selection: { mode: 'explicit', scenarioIds: [10, 999] },
        limits: { maxScenarios: 10, maxSelectionIds: 10, maxSerializedBytes: 1_000_000 },
      })
    ).rejects.toMatchObject({ code: 'scenario_not_found', status: 404 });

    for (const value of Object.values(data)) {
      expect((value as { create?: unknown }).create).toBeUndefined();
      expect((value as { update?: unknown }).update).toBeUndefined();
      expect((value as { destroy?: unknown }).destroy).toBeUndefined();
    }
  });

  it('rejects an all-scenarios result that exceeds the configured scenario bound', async () => {
    const { data, sequelize } = fixture();
    const store = new SequelizeReportStore({ sequelize, models: data });

    await expect(
      store.build({
        userId: 2,
        projectId: 10,
        runId: 99,
        selection: { mode: 'all' },
        limits: { maxScenarios: 2, maxSelectionIds: 10, maxSerializedBytes: 1_000_000 },
      })
    ).rejects.toMatchObject({ code: 'scenario_limit_exceeded', status: 413 });
  });
});
