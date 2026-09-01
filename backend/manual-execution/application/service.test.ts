import { Sequelize, DataTypes } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import defineComment from '../../models/comments.js';
import defineManualExecution from '../../models/manualExecutions.js';
import defineManualExecutionEvidence from '../../models/manualExecutionEvidence.js';
import { ManualExecutionService } from './service.js';

const png = Buffer.from('89504e470d0a1a0a', 'hex');
type TestRecord = { id: number; status?: number; update: (values: Record<string, unknown>) => Promise<unknown> };
type TestModel = {
  create: (values: Record<string, unknown>) => Promise<TestRecord>;
  findByPk: (id: number) => Promise<TestRecord>;
  count: () => Promise<number>;
};

function storageFake() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    put: vi.fn(async (input: { executionId: number; content: Uint8Array; mimeType: 'image/png'; filename: string }) => {
      const storageKey = `execution/${input.executionId}/${files.size}.png`;
      files.set(storageKey, input.content);
      return {
        storageKey,
        mimeType: input.mimeType,
        size: input.content.byteLength,
        sha256: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 1000),
      };
    }),
    get: vi.fn(async (key: string) => files.get(key) ?? new Uint8Array()),
    delete: vi.fn(async (key: string) => void files.delete(key)),
  };
}

async function seed(models: Record<string, TestModel>) {
  const owner = await models.User.create({ email: 'owner@example.com', password: 'x', username: 'owner', role: 1 });
  const actor = await models.User.create({ email: 'actor@example.com', password: 'x', username: 'actor', role: 1 });
  const other = await models.User.create({ email: 'other@example.com', password: 'x', username: 'other', role: 1 });
  const project = await models.Project.create({ name: 'Project', isPublic: false, userId: owner.id });
  const folder = await models.Folder.create({ name: 'Folder', projectId: project.id });
  const testcase = await models.Case.create({
    title: 'Original case',
    state: 0,
    priority: 2,
    type: 4,
    automationStatus: 1,
    template: 0,
    folderId: folder.id,
    automationVersion: 1,
  });
  const run = await models.Run.create({ name: 'Run', projectId: project.id });
  const runCase = await models.RunCase.create({
    runId: run.id,
    caseId: testcase.id,
    status: 0,
    assigneeUserId: other.id,
  });
  await models.Member.create({ projectId: project.id, userId: actor.id, role: 2 });
  await models.Member.create({ projectId: project.id, userId: other.id, role: 2 });
  return { owner, actor, other, project, folder, testcase, run, runCase };
}

describe('ManualExecutionService', () => {
  let sequelize: Sequelize;
  let models: Record<string, TestModel>;
  let files: ReturnType<typeof storageFake>;
  let data: Awaited<ReturnType<typeof seed>>;
  let service: ManualExecutionService;

  beforeEach(async () => {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
    models = {
      User: sequelize.define('User', {
        email: DataTypes.STRING,
        password: DataTypes.STRING,
        username: DataTypes.STRING,
        role: DataTypes.INTEGER,
      }) as unknown as TestModel,
      Project: sequelize.define('Project', {
        name: DataTypes.STRING,
        isPublic: DataTypes.BOOLEAN,
        userId: DataTypes.INTEGER,
      }) as unknown as TestModel,
      Folder: sequelize.define('Folder', {
        name: DataTypes.STRING,
        projectId: DataTypes.INTEGER,
      }) as unknown as TestModel,
      Case: sequelize.define('Case', {
        title: DataTypes.STRING,
        state: DataTypes.INTEGER,
        priority: DataTypes.INTEGER,
        type: DataTypes.INTEGER,
        automationStatus: DataTypes.INTEGER,
        template: DataTypes.INTEGER,
        folderId: DataTypes.INTEGER,
        automationVersion: DataTypes.INTEGER,
        description: DataTypes.STRING,
        preConditions: DataTypes.STRING,
        expectedResults: DataTypes.STRING,
      }) as unknown as TestModel,
      Run: sequelize.define('Run', { name: DataTypes.STRING, projectId: DataTypes.INTEGER }) as unknown as TestModel,
      RunCase: sequelize.define('RunCase', {
        runId: DataTypes.INTEGER,
        caseId: DataTypes.INTEGER,
        status: DataTypes.INTEGER,
        assigneeUserId: DataTypes.INTEGER,
      }) as unknown as TestModel,
      Member: sequelize.define('Member', {
        projectId: DataTypes.INTEGER,
        userId: DataTypes.INTEGER,
        role: DataTypes.INTEGER,
      }) as unknown as TestModel,
      Comment: defineComment(sequelize, DataTypes) as unknown as TestModel,
      ManualExecution: defineManualExecution(sequelize, DataTypes) as unknown as TestModel,
      ManualExecutionEvidence: defineManualExecutionEvidence(sequelize, DataTypes) as unknown as TestModel,
    };
    await sequelize.sync({ force: true });
    data = await seed(models);
    files = storageFake();
    service = new ManualExecutionService({ sequelize: sequelize as never, models: models as never, storage: files });
  });

  afterEach(async () => {
    await sequelize.close();
  });

  it('starts idempotently and keeps actor separate from the RunCase assignee', async () => {
    const first = await service.start(data.runCase.id, data.actor.id, 'manual-1');
    const duplicate = await service.start(data.runCase.id, data.other.id, 'manual-2');

    expect(first.id).toBe(duplicate.id);
    expect(first.actorUserId).toBe(data.actor.id);
    expect(first.assigneeUserId).toBe(data.other.id);
    expect(await models.ManualExecution.count()).toBe(1);
    expect((await models.RunCase.findByPk(data.runCase.id)).status).toBe(0);
  });

  it('resolves concurrent starts to the same active execution', async () => {
    const executions = await Promise.all([
      service.start(data.runCase.id, data.actor.id, 'race-1'),
      service.start(data.runCase.id, data.other.id, 'race-2'),
    ]);

    expect(new Set(executions.map((execution) => execution.id)).size).toBe(1);
    expect(await models.ManualExecution.count()).toBe(1);
  });

  it('requires project membership and atomically maps passed and failed results', async () => {
    await expect(service.start(data.runCase.id, data.owner.id + 100, 'manual-3')).rejects.toMatchObject({
      code: 'project_membership_required',
      status: 403,
    });
    const execution = await service.start(data.runCase.id, data.actor.id, 'manual-4');
    const finished = await service.finish(execution.id, data.actor.id, 'passed');

    expect(finished.status).toBe('finished');
    expect(finished.result).toBe('passed');
    expect((await models.RunCase.findByPk(data.runCase.id)).status).toBe(1);
    await expect(service.finish(execution.id, data.actor.id, 'failed')).rejects.toMatchObject({
      code: 'execution_result_immutable',
      status: 409,
    });
  });

  it('persists complete timestamps, revision snapshot, result, and RunCase mapping', async () => {
    const startedAt = new Date('2026-08-31T10:00:00.000Z');
    const finishedAt = new Date('2026-08-31T10:05:00.000Z');
    let clockCalls = 0;
    service = new ManualExecutionService({
      sequelize: sequelize as never,
      models: models as never,
      storage: files,
      now: () => (clockCalls++ === 0 ? startedAt : finishedAt),
    });

    const started = await service.start(data.runCase.id, data.actor.id, 'timestamps-1');
    const startedRecord = (await models.ManualExecution.findByPk(started.id)) as unknown as Record<string, unknown>;
    expect(startedRecord).toMatchObject({
      actorUserId: data.actor.id,
      assigneeUserId: data.other.id,
      status: 'running',
      result: null,
      finishedAt: null,
      caseRevision: 1,
      caseSnapshotHash: started.caseSnapshotHash,
      activeExecutionKey: String(data.runCase.id),
    });
    expect(new Date(String(startedRecord.startedAt)).toISOString()).toBe(startedAt.toISOString());
    expect(JSON.parse(String(startedRecord.caseSnapshot))).toMatchObject({
      id: data.testcase.id,
      title: 'Original case',
      automationVersion: 1,
    });

    const finished = await service.finish(started.id, data.actor.id, 'passed');
    const finishedRecord = (await models.ManualExecution.findByPk(started.id)) as unknown as Record<string, unknown>;
    expect(finished).toMatchObject({
      actorUserId: data.actor.id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      caseRevision: 1,
      caseSnapshotHash: started.caseSnapshotHash,
      result: 'passed',
      status: 'finished',
    });
    expect(finishedRecord).toMatchObject({
      actorUserId: data.actor.id,
      status: 'finished',
      result: 'passed',
      caseRevision: 1,
      caseSnapshotHash: started.caseSnapshotHash,
      activeExecutionKey: null,
    });
    expect(new Date(String(finishedRecord.finishedAt)).toISOString()).toBe(finishedAt.toISOString());
    expect((await models.RunCase.findByPk(data.runCase.id)).status).toBe(1);
  });

  it('persists a normalized versioned report and keeps the report nullable', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'report-1');
    const report = {
      version: 1,
      failureReason: 'The save action returned an error.',
      howToFix: 'Retry after deploying the patch.',
      reproductionSteps: '1. Open the case.\n2. Save the form.',
      browser: 'Firefox 140',
      environment: 'Staging / EU',
    };

    const updated = await service.updateReport(execution.id, data.actor.id, report);
    const persisted = (await models.ManualExecution.findByPk(execution.id)) as unknown as Record<string, unknown>;

    expect(updated.report).toEqual(report);
    expect(JSON.parse(String(persisted.report))).toEqual(report);

    await service.updateReport(execution.id, data.actor.id, null);
    expect(
      ((await models.ManualExecution.findByPk(execution.id)) as unknown as Record<string, unknown>).report
    ).toBeNull();
    await expect(service.updateReport(execution.id, data.actor.id, { version: 2 })).rejects.toMatchObject({
      code: 'report_version_invalid',
      status: 400,
    });
    await expect(
      service.updateReport(execution.id, data.actor.id, {
        version: 1,
        failureReason: 'x'.repeat(4_001),
      })
    ).rejects.toMatchObject({ code: 'report_field_too_long', status: 400 });
    await expect(
      service.updateReport(execution.id, data.actor.id, {
        version: 1,
        failureReason: 'a'.repeat(4_000),
        howToFix: 'b'.repeat(4_000),
        reproductionSteps: 'c'.repeat(4_000),
        browser: 'd',
        environment: 'e'.repeat(4_000),
      })
    ).rejects.toMatchObject({ code: 'report_too_long', status: 400 });
    await expect(service.updateReport(execution.id, data.owner.id + 100, report)).rejects.toMatchObject({
      code: 'project_membership_required',
      status: 403,
    });
  });

  it('accepts a report in finish and preserves the old result-only finish contract', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'report-finish-1');
    const report = {
      version: 1,
      failureReason: 'The result was not displayed.',
      howToFix: 'Refresh the page.',
      reproductionSteps: 'Run the case once.',
      browser: 'Chrome',
      environment: 'Local',
    };

    const finished = await service.finish(execution.id, data.actor.id, 'failed', report);
    expect(finished).toMatchObject({ status: 'finished', result: 'failed', report });

    const secondExecution = await service.start(data.runCase.id, data.actor.id, 'report-finish-2');
    const secondFinished = await service.finish(secondExecution.id, data.actor.id, 'passed');
    expect(secondFinished).toMatchObject({ status: 'finished', result: 'passed', report: null });
  });

  it('leaves ManualExecution and RunCase unchanged when finish has no result', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'missing-result-1');
    const beforeExecution = (await models.ManualExecution.findByPk(execution.id)) as unknown as Record<string, unknown>;
    const beforeRunCase = await models.RunCase.findByPk(data.runCase.id);

    await expect(service.finish(execution.id, data.actor.id, undefined)).rejects.toMatchObject({
      code: 'result_required',
      status: 400,
    });

    const afterExecution = (await models.ManualExecution.findByPk(execution.id)) as unknown as Record<string, unknown>;
    expect(afterExecution).toMatchObject({
      status: beforeExecution.status,
      result: beforeExecution.result,
      startedAt: beforeExecution.startedAt,
      finishedAt: beforeExecution.finishedAt,
      caseRevision: beforeExecution.caseRevision,
      caseSnapshot: beforeExecution.caseSnapshot,
      caseSnapshotHash: beforeExecution.caseSnapshotHash,
      activeExecutionKey: beforeExecution.activeExecutionKey,
    });
    expect((await models.RunCase.findByPk(data.runCase.id)).status).toBe(beforeRunCase.status);
  });

  it('resolves concurrent starts and preserves the original revision after a case edit', async () => {
    const executions = await Promise.all([
      service.start(data.runCase.id, data.actor.id, 'race-edit-1'),
      service.start(data.runCase.id, data.other.id, 'race-edit-2'),
    ]);

    expect(new Set(executions.map((execution) => execution.id)).size).toBe(1);
    expect(await models.ManualExecution.count()).toBe(1);
    expect((await service.active(data.runCase.id, data.actor.id))?.id).toBe(executions[0].id);

    await data.testcase.update({ title: 'Edited while execution is active', automationVersion: 2 });
    const finished = await service.finish(executions[0].id, data.actor.id, 'failed');
    const persisted = (await models.ManualExecution.findByPk(executions[0].id)) as unknown as Record<string, unknown>;

    expect(finished).toMatchObject({ status: 'finished', result: 'failed', caseRevision: 1, stale: true });
    expect(persisted.caseRevision).toBe(1);
    expect(JSON.parse(String(persisted.caseSnapshot))).toMatchObject({
      title: 'Original case',
      automationVersion: 1,
    });
  });

  it('rejects unauthorized evidence and storage failures without metadata or leaked bytes', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'evidence-boundary-1');
    const outsiderId = data.owner.id + 100;

    await expect(
      service.uploadEvidence(execution.id, outsiderId, {
        content: png,
        mimeType: 'image/png',
        filename: 'unauthorized.png',
      })
    ).rejects.toMatchObject({ code: 'project_membership_required', status: 403 });
    expect(files.put).not.toHaveBeenCalled();
    expect(await models.ManualExecutionEvidence.count()).toBe(0);
    expect(files.files.size).toBe(0);

    files.put.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      service.uploadEvidence(execution.id, data.actor.id, {
        content: png,
        mimeType: 'image/png',
        filename: 'failed.png',
      })
    ).rejects.toMatchObject({ code: 'evidence_storage_failed', status: 500 });
    expect(await models.ManualExecutionEvidence.count()).toBe(0);
    expect(files.files.size).toBe(0);

    const evidence = await service.uploadEvidence(execution.id, data.actor.id, {
      content: png,
      mimeType: 'image/png',
      filename: 'private.png',
    });
    const getCalls = files.get.mock.calls.length;
    await expect(service.downloadEvidence(execution.id, evidence.id, outsiderId)).rejects.toMatchObject({
      code: 'project_membership_required',
      status: 403,
    });
    expect(files.get).toHaveBeenCalledTimes(getCalls);
    expect(JSON.stringify(evidence)).not.toMatch(/storageKey|public|url/i);
  });

  it('allows stale completion and records an explicit stale indication', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'manual-5');
    await data.testcase.update({ title: 'Edited after start' });

    const finished = await service.finish(execution.id, data.actor.id, 'failed');

    expect(finished.stale).toBe(true);
    expect(finished.result).toBe('failed');
    expect((await models.RunCase.findByPk(data.runCase.id)).status).toBe(2);
  });

  it('supports cancel without allowing a reopen through finish', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'manual-6');
    const cancelled = await service.cancel(execution.id, data.actor.id);

    expect(cancelled.status).toBe('cancelled');
    await expect(service.finish(execution.id, data.actor.id, 'passed')).rejects.toMatchObject({
      code: 'execution_cancelled',
      status: 409,
    });
  });

  it('returns newest manual executions for a RunCase with membership protection and pagination', async () => {
    const first = await service.start(data.runCase.id, data.actor.id, 'history-1');
    await service.finish(first.id, data.actor.id, 'passed');
    const second = await service.start(data.runCase.id, data.other.id, 'history-2');
    await service.cancel(second.id, data.other.id);

    const page = await service.listHistory(data.runCase.id, data.actor.id, 1, 1);
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: second.id, status: 'cancelled' });

    const secondPage = await service.listHistory(data.runCase.id, data.actor.id, 2, 1);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]).toMatchObject({ id: first.id, status: 'finished', result: 'passed' });

    await expect(service.listHistory(data.runCase.id, data.owner.id + 100)).rejects.toMatchObject({
      code: 'project_membership_required',
      status: 403,
    });
  });

  it('keeps evidence private, execution-scoped, uploader-owned, and immutable after finish', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'manual-7');
    const evidence = await service.uploadEvidence(execution.id, data.actor.id, {
      content: png,
      mimeType: 'image/png',
      filename: 'proof.png',
    });

    expect(evidence).not.toHaveProperty('storageKey');
    await expect(service.downloadEvidence(execution.id, evidence.id, data.actor.id)).resolves.toMatchObject({
      bytes: png,
    });
    await expect(service.deleteEvidence(execution.id, evidence.id, data.other.id)).rejects.toMatchObject({
      code: 'evidence_uploader_required',
      status: 403,
    });
    await service.finish(execution.id, data.actor.id, 'passed');
    await expect(service.deleteEvidence(execution.id, evidence.id, data.actor.id)).rejects.toMatchObject({
      code: 'evidence_immutable',
      status: 409,
    });
  });

  it('cleans the object when evidence metadata persistence fails', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'manual-8');
    vi.spyOn(models.ManualExecutionEvidence, 'create').mockRejectedValueOnce(new Error('database failed'));

    await expect(
      service.uploadEvidence(execution.id, data.actor.id, {
        content: png,
        mimeType: 'image/png',
        filename: 'proof.png',
      })
    ).rejects.toMatchObject({
      code: 'evidence_persistence_failed',
      status: 500,
    });
    expect(files.delete).toHaveBeenCalledOnce();
    expect(files.files.size).toBe(0);
  });

  it('preserves the inactive execution error when cancellation wins the upload race', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'manual-8-race');
    const findByPk = models.ManualExecution.findByPk.bind(models.ManualExecution);
    let calls = 0;
    vi.spyOn(models.ManualExecution, 'findByPk').mockImplementation(async (id) => {
      const record = await findByPk(id);
      calls += 1;
      if (calls === 2 && record) (record as unknown as { status: string }).status = 'cancelled';
      return record;
    });

    await expect(
      service.uploadEvidence(execution.id, data.actor.id, {
        content: png,
        mimeType: 'image/png',
        filename: 'cancelled-race.png',
      })
    ).rejects.toMatchObject({ code: 'execution_not_active', status: 409 });
    expect(files.delete).toHaveBeenCalledOnce();
    expect(await models.ManualExecutionEvidence.count()).toBe(0);
  });

  it('limits evidence to ten files per active execution', async () => {
    const execution = await service.start(data.runCase.id, data.actor.id, 'manual-9');

    for (let index = 0; index < 10; index += 1) {
      await service.uploadEvidence(execution.id, data.actor.id, {
        content: png,
        mimeType: 'image/png',
        filename: `proof-${index}.png`,
      });
    }

    await expect(
      service.uploadEvidence(execution.id, data.actor.id, {
        content: png,
        mimeType: 'image/png',
        filename: 'proof-10.png',
      })
    ).rejects.toMatchObject({ code: 'evidence_limit_exceeded', status: 409 });
    expect(await models.ManualExecutionEvidence.count()).toBe(10);
  });

  it('keeps comments and manager assignment unchanged when another member executes', async () => {
    const comment = await models.Comment.create({
      commentableType: 'RunCase',
      commentableId: data.runCase.id,
      userId: data.actor.id,
      content: 'Manager note',
    });
    const execution = await service.start(data.runCase.id, data.actor.id, 'roles-1');
    await service.finish(execution.id, data.actor.id, 'passed');

    const runCase = (await models.RunCase.findByPk(data.runCase.id)) as unknown as Record<string, unknown>;
    const persistedComment = (await models.Comment.findByPk(comment.id)) as unknown as Record<string, unknown>;
    expect(execution.actorUserId).toBe(data.actor.id);
    expect(runCase.assigneeUserId).toBe(data.other.id);
    expect(persistedComment).toMatchObject({
      commentableType: 'RunCase',
      commentableId: data.runCase.id,
      content: 'Manager note',
    });
  });
});
