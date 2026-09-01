import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sequelize, DataTypes } from 'sequelize';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualExecutionService } from '../../manual-execution/application/service.js';
import { ManualEvidenceStorage } from '../../manual-execution/infrastructure/storage.js';
import defineManualExecution from '../../models/manualExecutions.js';
import defineManualExecutionEvidence from '../../models/manualExecutionEvidence.js';
import manualExecutionRoute from './index.js';

const verifySignedIn = vi.fn((req: { userId?: number }, _res: unknown, next: () => void) => {
  req.userId = 2;
  next();
});

vi.mock('../../middleware/auth.js', () => ({ default: () => ({ verifySignedIn }) }));

const png = Buffer.from('89504e470d0a1a0a', 'hex');

describe('manual execution runtime flow', () => {
  let sequelize: Sequelize;
  let storage: ManualEvidenceStorage;
  let storageRoot: string;
  let runCaseId: number;
  let app: express.Express;

  beforeEach(async () => {
    sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
    storageRoot = await mkdtemp(join(tmpdir(), 'manual-execution-runtime-'));
    storage = new ManualEvidenceStorage({ rootDir: storageRoot });

    const User = sequelize.define('User', {
      email: DataTypes.STRING,
      password: DataTypes.STRING,
      username: DataTypes.STRING,
      role: DataTypes.INTEGER,
    });
    const Project = sequelize.define('Project', { name: DataTypes.STRING, userId: DataTypes.INTEGER });
    const Folder = sequelize.define('Folder', { name: DataTypes.STRING, projectId: DataTypes.INTEGER });
    const Case = sequelize.define('Case', {
      title: DataTypes.STRING,
      state: DataTypes.INTEGER,
      priority: DataTypes.INTEGER,
      type: DataTypes.INTEGER,
      automationStatus: DataTypes.INTEGER,
      template: DataTypes.INTEGER,
      folderId: DataTypes.INTEGER,
      automationVersion: DataTypes.INTEGER,
    });
    const Run = sequelize.define('Run', { name: DataTypes.STRING, projectId: DataTypes.INTEGER });
    const RunCase = sequelize.define('RunCase', {
      runId: DataTypes.INTEGER,
      caseId: DataTypes.INTEGER,
      status: DataTypes.INTEGER,
      assigneeUserId: DataTypes.INTEGER,
    });
    const Member = sequelize.define('Member', { projectId: DataTypes.INTEGER, userId: DataTypes.INTEGER });
    const ManualExecution = defineManualExecution(sequelize, DataTypes);
    const ManualExecutionEvidence = defineManualExecutionEvidence(sequelize, DataTypes);

    await sequelize.sync({ force: true });
    const owner = await User.create({ email: 'owner@example.com', password: 'x', username: 'owner', role: 1 });
    const actor = await User.create({ email: 'actor@example.com', password: 'x', username: 'actor', role: 1 });
    const project = await Project.create({ name: 'Runtime project', userId: owner.get('id') });
    const folder = await Folder.create({ name: 'Runtime folder', projectId: project.get('id') });
    const testcase = await Case.create({
      title: 'Runtime case',
      state: 0,
      priority: 2,
      type: 4,
      automationStatus: 1,
      template: 0,
      folderId: folder.get('id'),
      automationVersion: 1,
    });
    const run = await Run.create({ name: 'Runtime run', projectId: project.get('id') });
    const runCase = await RunCase.create({
      runId: run.get('id'),
      caseId: testcase.get('id'),
      status: 0,
      assigneeUserId: owner.get('id'),
    });
    await Member.create({ projectId: project.get('id'), userId: actor.get('id') });
    runCaseId = Number(runCase.get('id'));

    const service = new ManualExecutionService({
      sequelize: sequelize as never,
      models: {
        User,
        Project,
        Folder,
        Case,
        Run,
        RunCase,
        Member,
        ManualExecution,
        ManualExecutionEvidence,
      } as never,
      storage,
    });
    app = express();
    app.use(express.json());
    app.use('/manual-executions', manualExecutionRoute(sequelize, { service, storage }));
  });

  afterEach(async () => {
    await sequelize.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('starts, uploads private evidence, and finishes through HTTP', async () => {
    const started = await request(app)
      .post(`/manual-executions/run-cases/${runCaseId}`)
      .set('X-Correlation-Id', 'runtime-start')
      .expect(201);

    expect(started.body).toEqual(
      expect.objectContaining({ status: 'running', actorUserId: 2, assigneeUserId: 1, correlationId: 'runtime-start' })
    );
    const executionId = started.body.id as number;
    const startedRecord = await sequelize.models.ManualExecution.findByPk(executionId);
    expect(startedRecord?.get('actorUserId')).toBe(2);
    expect(startedRecord?.get('status')).toBe('running');
    expect(startedRecord?.get('result')).toBeNull();
    expect(startedRecord?.get('report')).toBeNull();
    expect(startedRecord?.get('finishedAt')).toBeNull();
    expect(startedRecord?.get('caseRevision')).toBe(1);
    expect(startedRecord?.get('caseSnapshotHash')).toBe(started.body.caseSnapshotHash);
    expect(startedRecord?.get('startedAt')).toBeInstanceOf(Date);
    expect(JSON.parse(String(startedRecord?.get('caseSnapshot')))).toMatchObject({
      title: 'Runtime case',
      automationVersion: 1,
    });

    const report = {
      version: 1,
      failureReason: 'The action failed visibly.',
      howToFix: 'Apply the latest release.',
      reproductionSteps: 'Open the case and submit it.',
      browser: 'Chrome 140',
      environment: 'Staging',
    };
    await request(app).patch(`/manual-executions/${executionId}/report`).send({ report }).expect(200);
    expect((await sequelize.models.ManualExecution.findByPk(executionId))?.get('report')).toBe(JSON.stringify(report));

    const uploaded = await request(app)
      .post(`/manual-executions/${executionId}/evidence`)
      .field('sha256', 'invalid')
      .attach('file', png, { filename: 'proof.png', contentType: 'image/png' });

    expect(uploaded.status).toBe(400);
    expect(uploaded.body).toEqual(expect.objectContaining({ error: 'evidence_hash_invalid' }));

    const validUpload = await request(app)
      .post(`/manual-executions/${executionId}/evidence`)
      .attach('file', png, { filename: 'proof.png', contentType: 'image/png' })
      .expect(201);
    const evidenceId = validUpload.body.id as number;

    const downloaded = await request(app).get(`/manual-executions/${executionId}/evidence/${evidenceId}`).expect(200);
    expect(downloaded.headers['content-type']).toMatch(/^image\/png/);
    expect(downloaded.body).toEqual(png);
    expect(JSON.stringify(validUpload.body)).not.toMatch(/storageKey|public|url/i);

    const history = await request(app)
      .get(`/manual-executions/run-cases/${runCaseId}/history?page=1&limit=10`)
      .expect(200);
    expect(history.body).toEqual({
      items: [expect.objectContaining({ id: executionId, status: 'running', result: null })],
      total: 1,
    });

    const finished = await request(app)
      .post(`/manual-executions/${executionId}/finish`)
      .send({ result: 'passed' })
      .expect(200);
    expect(finished.body).toEqual(expect.objectContaining({ status: 'finished', result: 'passed' }));
    expect(finished.body.report).toEqual(report);
    const finishedRecord = await sequelize.models.ManualExecution.findByPk(executionId);
    expect(finishedRecord?.get('actorUserId')).toBe(2);
    expect(finishedRecord?.get('status')).toBe('finished');
    expect(finishedRecord?.get('result')).toBe('passed');
    expect(finishedRecord?.get('finishedAt')).toBeInstanceOf(Date);
    expect(finishedRecord?.get('caseRevision')).toBe(1);
    expect(finishedRecord?.get('caseSnapshotHash')).toBe(started.body.caseSnapshotHash);
    expect(new Date(finished.body.finishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(started.body.startedAt).getTime()
    );
    expect((await sequelize.models.RunCase.findByPk(runCaseId))?.get('status')).toBe(1);
  });

  it('rejects a missing result without changing ManualExecution or RunCase', async () => {
    const started = await request(app).post(`/manual-executions/run-cases/${runCaseId}`).expect(201);
    const executionId = started.body.id as number;
    const beforeExecution = await sequelize.models.ManualExecution.findByPk(executionId);
    const beforeRunCase = await sequelize.models.RunCase.findByPk(runCaseId);
    const before = {
      status: beforeExecution?.get('status'),
      result: beforeExecution?.get('result'),
      startedAt: beforeExecution?.get('startedAt'),
      finishedAt: beforeExecution?.get('finishedAt'),
      caseRevision: beforeExecution?.get('caseRevision'),
      caseSnapshotHash: beforeExecution?.get('caseSnapshotHash'),
      activeExecutionKey: beforeExecution?.get('activeExecutionKey'),
    };

    await request(app).post(`/manual-executions/${executionId}/finish`).send({}).expect(400);

    const afterExecution = await sequelize.models.ManualExecution.findByPk(executionId);
    expect({
      status: afterExecution?.get('status'),
      result: afterExecution?.get('result'),
      startedAt: afterExecution?.get('startedAt'),
      finishedAt: afterExecution?.get('finishedAt'),
      caseRevision: afterExecution?.get('caseRevision'),
      caseSnapshotHash: afterExecution?.get('caseSnapshotHash'),
      activeExecutionKey: afterExecution?.get('activeExecutionKey'),
    }).toEqual(before);
    expect((await sequelize.models.RunCase.findByPk(runCaseId))?.get('status')).toBe(beforeRunCase?.get('status'));
  });
});
