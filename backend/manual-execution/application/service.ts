import { createHash } from 'node:crypto';
import {
  MANUAL_EXECUTION_REPORT_VERSION,
  MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH,
  MAX_MANUAL_EXECUTION_REPORT_LENGTH,
} from '../api/types.js';
import type {
  EvidenceUpload,
  ManualEvidenceView,
  ManualExecutionReport,
  ManualExecutionResult,
  ManualExecutionHistory,
  ManualExecutionServicePort,
  ManualExecutionStatus,
  ManualExecutionView,
} from '../api/types.js';
import { EvidenceStorageError, MAX_EVIDENCE_FILES, ManualEvidenceStorage } from '../infrastructure/storage.js';

type Row = Record<string, unknown> & {
  id?: unknown;
  update?: (values: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Row>;
  destroy?: (options?: Record<string, unknown>) => Promise<unknown>;
  toJSON?: () => unknown;
};
type Model = {
  findByPk: (id: unknown, options?: Record<string, unknown>) => Promise<Row | null>;
  findOne: (options?: Record<string, unknown>) => Promise<Row | null>;
  findAll: (options?: Record<string, unknown>) => Promise<Row[]>;
  create: (values: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Row>;
  update: (values: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  destroy: (options?: Record<string, unknown>) => Promise<unknown>;
};
type Transaction = Record<string, unknown>;
type Database = { transaction: <T>(work: (transaction: Transaction) => Promise<T>) => Promise<T> };

export type ManualExecutionModels = {
  ManualExecution: Model;
  ManualExecutionEvidence: Model;
  RunCase: Model;
  Run: Model;
  Case: Model;
  Folder?: Model;
  Project: Model;
  Member: Model;
};

export type ManualEvidenceStoragePort = Pick<ManualEvidenceStorage, 'put' | 'get' | 'delete'>;

export type ManualExecutionServiceOptions = {
  sequelize: Database;
  models: ManualExecutionModels;
  storage: ManualEvidenceStoragePort;
  now?: () => Date;
};

export class ManualExecutionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'ManualExecutionError';
    this.code = code;
    this.status = status;
  }
}

const RESULT_STATUS: Record<ManualExecutionResult, 1 | 2> = { passed: 1, failed: 2 };
const RUNNING = 'running' as const;
const MAX_HISTORY_LIMIT = 100;

function positiveId(value: unknown, field: string): number {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new ManualExecutionError(`${field}_invalid`);
  return id;
}

function value(row: Row, key: string): unknown {
  return row[key];
}

function plain(row: Row): Row {
  const json = row.toJSON?.();
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Row) : row;
}

function iso(valueToFormat: unknown): string {
  if (valueToFormat instanceof Date) return valueToFormat.toISOString();
  const parsed = new Date(String(valueToFormat));
  return Number.isNaN(parsed.getTime()) ? String(valueToFormat) : parsed.toISOString();
}

function optionalIso(valueToFormat: unknown): string | null {
  return valueToFormat === null || valueToFormat === undefined ? null : iso(valueToFormat);
}

const REPORT_FIELDS = ['failureReason', 'howToFix', 'reproductionSteps', 'browser', 'environment'] as const;

function isPlainRecord(valueToCheck: unknown): valueToCheck is Record<string, unknown> {
  return valueToCheck !== null && typeof valueToCheck === 'object' && !Array.isArray(valueToCheck);
}

function reportText(source: Record<string, unknown>, field: string, fallbackField?: string): string {
  const raw = source[field] ?? (fallbackField ? source[fallbackField] : undefined);
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') throw new ManualExecutionError('report_invalid');
  if (
    Array.from(raw).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || code === 127;
    })
  )
    throw new ManualExecutionError('report_invalid');
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  if (Array.from(normalized).length > MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH)
    throw new ManualExecutionError('report_field_too_long');
  return normalized;
}

function normalizeReport(input: unknown): ManualExecutionReport | null {
  if (input === null) return null;
  if (!isPlainRecord(input) || input.version !== MANUAL_EXECUTION_REPORT_VERSION)
    throw new ManualExecutionError('report_version_invalid');

  const report: ManualExecutionReport = {
    version: MANUAL_EXECUTION_REPORT_VERSION,
    failureReason: reportText(input, 'failureReason', 'observedBehavior'),
    howToFix: reportText(input, 'howToFix'),
    reproductionSteps: reportText(input, 'reproductionSteps'),
    browser: reportText(input, 'browser'),
    environment: reportText(input, 'environment'),
  };
  const totalLength = REPORT_FIELDS.reduce((total, field) => total + Array.from(report[field]).length, 0);
  if (totalLength > MAX_MANUAL_EXECUTION_REPORT_LENGTH) throw new ManualExecutionError('report_too_long');
  return REPORT_FIELDS.some((field) => report[field].length > 0) ? report : null;
}

function serializeReport(input: unknown): string | null {
  const report = normalizeReport(input);
  return report ? JSON.stringify(report) : null;
}

function storedReport(input: unknown): ManualExecutionReport | null {
  if (input === null || input === undefined) return null;
  try {
    return normalizeReport(typeof input === 'string' ? JSON.parse(input) : input);
  } catch {
    return null;
  }
}

function errorStatus(code: string): number {
  if (code === 'evidence_size_exceeded') return 413;
  if (code === 'evidence_not_found' || code === 'evidence_expired') return 404;
  if (code === 'evidence_storage_failed' || code === 'evidence_integrity_failed') return 500;
  return 400;
}

function isUnique(error: unknown): boolean {
  const candidate = error as { name?: string; code?: string; parent?: { code?: string } };
  return (
    candidate?.name === 'SequelizeUniqueConstraintError' ||
    candidate?.code === 'SQLITE_CONSTRAINT' ||
    candidate?.parent?.code === 'SQLITE_CONSTRAINT'
  );
}

function isTransactionRace(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; parent?: { code?: string; message?: string } };
  const text = `${candidate?.code ?? ''} ${candidate?.message ?? ''} ${candidate?.parent?.code ?? ''} ${candidate?.parent?.message ?? ''}`;
  return /SQLITE_BUSY|cannot start a transaction within a transaction/i.test(text);
}

function caseSnapshot(caseRecord: Row): { revision: number; serialized: string; hash: string } {
  const source = plain(caseRecord);
  const revisionValue = Number(value(source, 'automationVersion'));
  const revision = Number.isSafeInteger(revisionValue) && revisionValue > 0 ? revisionValue : 1;
  const snapshot: Record<string, unknown> = {
    id: value(source, 'id'),
    title: value(source, 'title'),
    state: value(source, 'state'),
    priority: value(source, 'priority'),
    type: value(source, 'type'),
    automationStatus: value(source, 'automationStatus'),
    description: value(source, 'description'),
    template: value(source, 'template'),
    automationVersion: revision,
    preConditions: value(source, 'preConditions'),
    expectedResults: value(source, 'expectedResults'),
    folderId: value(source, 'folderId'),
    gherkinExamples: value(source, 'gherkinExamples'),
    updatedAt:
      value(source, 'updatedAt') instanceof Date
        ? (value(source, 'updatedAt') as Date).toISOString()
        : value(source, 'updatedAt'),
  };
  const steps = value(source, 'Steps') ?? value(source, 'steps');
  if (steps !== undefined) snapshot.steps = steps;
  const serialized = JSON.stringify(snapshot);
  return { revision, serialized, hash: createHash('sha256').update(serialized).digest('hex') };
}

function manualView(row: Row, sourceDeleted: boolean, stale: boolean): ManualExecutionView {
  const source = plain(row);
  const status = String(value(source, 'status')) as ManualExecutionStatus;
  const result = value(source, 'result');
  return {
    id: positiveId(value(source, 'id'), 'executionId'),
    projectId: positiveId(value(source, 'projectId'), 'projectId'),
    runId:
      value(source, 'runId') === null || value(source, 'runId') === undefined
        ? null
        : positiveId(value(source, 'runId'), 'runId'),
    runCaseId:
      value(source, 'runCaseId') === null || value(source, 'runCaseId') === undefined
        ? null
        : positiveId(value(source, 'runCaseId'), 'runCaseId'),
    caseId:
      value(source, 'caseId') === null || value(source, 'caseId') === undefined
        ? null
        : positiveId(value(source, 'caseId'), 'caseId'),
    actorUserId: positiveId(value(source, 'actorUserId'), 'userId'),
    assigneeUserId:
      value(source, 'assigneeUserId') === null || value(source, 'assigneeUserId') === undefined
        ? null
        : positiveId(value(source, 'assigneeUserId'), 'assigneeUserId'),
    status,
    result: result === 'passed' || result === 'failed' ? result : null,
    startedAt: iso(value(source, 'startedAt')),
    finishedAt: optionalIso(value(source, 'finishedAt')),
    caseRevision: positiveId(value(source, 'caseRevision'), 'caseRevision'),
    caseSnapshotHash: String(value(source, 'caseSnapshotHash')),
    stale: Boolean(value(source, 'staleRevision')) || stale,
    historical: sourceDeleted,
    sourceDeleted,
    correlationId: String(value(source, 'correlationId')),
    report: storedReport(value(source, 'report')),
  };
}

function evidenceView(row: Row): ManualEvidenceView {
  const source = plain(row);
  return {
    id: positiveId(value(source, 'id'), 'evidenceId'),
    executionId: positiveId(value(source, 'executionId'), 'executionId'),
    uploaderUserId: positiveId(value(source, 'uploaderUserId'), 'userId'),
    filename: String(value(source, 'filename')),
    mimeType: String(value(source, 'mimeType')),
    size: positiveId(value(source, 'size'), 'evidenceSize'),
    sha256: String(value(source, 'sha256')),
    expiresAt: iso(value(source, 'expiresAt')),
    createdAt: iso(value(source, 'createdAt')),
  };
}

export class ManualExecutionService implements ManualExecutionServicePort {
  private readonly db: Database;
  private readonly models: ManualExecutionModels;
  private readonly storage: ManualEvidenceStoragePort;
  private readonly clock: () => Date;
  private readonly startLocks = new Map<string, Promise<ManualExecutionView>>();

  constructor(options: ManualExecutionServiceOptions) {
    this.db = options.sequelize;
    this.models = options.models;
    this.storage = options.storage;
    this.clock = options.now ?? (() => new Date());
  }

  private async member(projectId: number, userId: number, transaction?: Transaction): Promise<void> {
    const options = transaction ? { transaction } : undefined;
    const project = await this.models.Project.findByPk(projectId, options);
    if (!project) throw new ManualExecutionError('project_not_found', 404);
    if (Number(value(project, 'userId')) === userId) return;
    const member = await this.models.Member.findOne({
      where: { projectId, userId },
      ...(transaction ? { transaction } : {}),
    });
    if (!member) throw new ManualExecutionError('project_membership_required', 403);
  }

  private async liveSource(
    runCaseId: number,
    userId: number,
    transaction: Transaction
  ): Promise<{ runCase: Row; run: Row; caseRecord: Row; projectId: number }> {
    const runCase = await this.models.RunCase.findByPk(runCaseId, { transaction });
    if (!runCase) throw new ManualExecutionError('run_case_not_found', 404);
    const run = await this.models.Run.findByPk(value(runCase, 'runId'), { transaction });
    if (!run) throw new ManualExecutionError('run_not_found', 404);
    const projectId = positiveId(value(run, 'projectId'), 'projectId');
    await this.member(projectId, userId, transaction);
    const caseRecord = await this.models.Case.findByPk(value(runCase, 'caseId'), { transaction });
    if (!caseRecord) throw new ManualExecutionError('case_not_found', 404);
    if (this.models.Folder) {
      const folder = await this.models.Folder.findByPk(value(caseRecord, 'folderId'), { transaction });
      if (!folder || Number(value(folder, 'projectId')) !== projectId)
        throw new ManualExecutionError('run_case_source_invalid', 404);
    }
    return { runCase, run, caseRecord, projectId };
  }

  private async execution(executionId: number, userId: number, transaction: Transaction): Promise<Row> {
    const record = await this.models.ManualExecution.findByPk(executionId, { transaction });
    if (!record) throw new ManualExecutionError('execution_not_found', 404);
    await this.member(positiveId(value(record, 'projectId'), 'projectId'), userId, transaction);
    return record;
  }

  private async currentCase(record: Row, transaction?: Transaction): Promise<Row | null> {
    const caseId = value(record, 'caseId');
    return caseId === null || caseId === undefined
      ? null
      : this.models.Case.findByPk(caseId, transaction ? { transaction } : undefined);
  }

  private async view(record: Row, transaction?: Transaction): Promise<ManualExecutionView> {
    const current = await this.currentCase(record, transaction);
    const deleted = current === null || value(record, 'runCaseId') === null || value(record, 'runCaseId') === undefined;
    const stale = current ? caseSnapshot(current).hash !== String(value(record, 'caseSnapshotHash')) : false;
    return manualView(record, deleted, stale);
  }

  async start(runCaseIdValue: number, userIdValue: number, correlationId: string): Promise<ManualExecutionView> {
    const runCaseId = positiveId(runCaseIdValue, 'runCaseId');
    const userId = positiveId(userIdValue, 'userId');
    const activeKey = String(runCaseId);
    const previous = this.startLocks.get(activeKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          return await this.db.transaction(async (transaction) => {
            const source = await this.liveSource(runCaseId, userId, transaction);
            const existing = await this.models.ManualExecution.findOne({
              where: { activeExecutionKey: activeKey, status: RUNNING },
              transaction,
            });
            if (existing) return this.view(existing, transaction);
            const snapshot = caseSnapshot(source.caseRecord);
            const created = await this.models.ManualExecution.create(
              {
                projectId: source.projectId,
                runId: value(source.run, 'id'),
                runCaseId,
                caseId: value(source.caseRecord, 'id'),
                actorUserId: userId,
                assigneeUserId: value(source.runCase, 'assigneeUserId') ?? null,
                status: RUNNING,
                result: null,
                startedAt: this.clock(),
                finishedAt: null,
                caseRevision: snapshot.revision,
                caseSnapshot: snapshot.serialized,
                caseSnapshotHash: snapshot.hash,
                staleRevision: false,
                activeExecutionKey: activeKey,
                correlationId: correlationId || 'unknown',
              },
              { transaction }
            );
            return this.view(created, transaction);
          });
        } catch (error) {
          if (!isUnique(error) && !isTransactionRace(error)) throw error;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const existing = await this.models.ManualExecution.findOne({
              where: { activeExecutionKey: activeKey, status: RUNNING },
            });
            if (existing) {
              await this.member(positiveId(value(existing, 'projectId'), 'projectId'), userId);
              return this.view(existing);
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new ManualExecutionError('active_execution_conflict', 409);
        }
      });
    this.startLocks.set(activeKey, current);
    try {
      return await current;
    } finally {
      if (this.startLocks.get(activeKey) === current) this.startLocks.delete(activeKey);
    }
  }

  async get(executionIdValue: number, userIdValue: number): Promise<ManualExecutionView> {
    const executionId = positiveId(executionIdValue, 'executionId');
    const userId = positiveId(userIdValue, 'userId');
    return this.db.transaction(async (transaction) =>
      this.view(await this.execution(executionId, userId, transaction), transaction)
    );
  }

  async active(runCaseIdValue: number, userIdValue: number): Promise<ManualExecutionView | null> {
    const runCaseId = positiveId(runCaseIdValue, 'runCaseId');
    const userId = positiveId(userIdValue, 'userId');
    const active = await this.models.ManualExecution.findOne({
      where: { activeExecutionKey: String(runCaseId), status: RUNNING },
    });
    if (active) {
      await this.member(positiveId(value(active, 'projectId'), 'projectId'), userId);
      return this.view(active);
    }
    try {
      await this.db.transaction(async (transaction) => this.liveSource(runCaseId, userId, transaction));
    } catch (error) {
      if (error instanceof ManualExecutionError && error.code === 'run_case_not_found') return null;
      throw error;
    }
    return null;
  }

  async listHistory(
    runCaseIdValue: number,
    userIdValue: number,
    pageValue = 1,
    limitValue = 20
  ): Promise<ManualExecutionHistory> {
    const runCaseId = positiveId(runCaseIdValue, 'runCaseId');
    const userId = positiveId(userIdValue, 'userId');
    const page = positiveId(pageValue, 'page');
    const limit = Math.min(MAX_HISTORY_LIMIT, positiveId(limitValue, 'limit'));
    return this.db.transaction(async (transaction) => {
      const first = await this.models.ManualExecution.findOne({
        where: { runCaseId },
        order: [['startedAt', 'ASC']],
        transaction,
      });

      if (first) {
        await this.member(positiveId(value(first, 'projectId'), 'projectId'), userId, transaction);
      } else {
        try {
          await this.liveSource(runCaseId, userId, transaction);
        } catch (error) {
          if (error instanceof ManualExecutionError && error.code === 'run_case_not_found')
            return { items: [], total: 0 };
          throw error;
        }
      }

      const records = await this.models.ManualExecution.findAll({
        where: { runCaseId },
        order: [
          ['startedAt', 'DESC'],
          ['id', 'DESC'],
        ],
        transaction,
      });
      const offset = (page - 1) * limit;
      const items = records.slice(offset, offset + limit);
      return {
        items: await Promise.all(items.map((record) => this.view(record, transaction))),
        total: records.length,
      };
    });
  }

  async finish(
    executionIdValue: number,
    userIdValue: number,
    resultValue: unknown,
    reportValue?: unknown
  ): Promise<ManualExecutionView> {
    if (resultValue !== 'passed' && resultValue !== 'failed') throw new ManualExecutionError('result_required');
    const executionId = positiveId(executionIdValue, 'executionId');
    const userId = positiveId(userIdValue, 'userId');
    return this.db.transaction(async (transaction) => {
      const record = await this.execution(executionId, userId, transaction);
      const currentStatus = String(value(record, 'status'));
      if (currentStatus === 'finished') {
        if (value(record, 'result') !== resultValue) throw new ManualExecutionError('execution_result_immutable', 409);
        return this.view(record, transaction);
      }
      if (currentStatus === 'cancelled') throw new ManualExecutionError('execution_cancelled', 409);
      if (currentStatus !== RUNNING) throw new ManualExecutionError('execution_state_invalid', 409);

      const serializedReport = reportValue === undefined ? undefined : serializeReport(reportValue);

      const currentCase = await this.currentCase(record, transaction);
      const stale =
        currentCase === null || caseSnapshot(currentCase).hash !== String(value(record, 'caseSnapshotHash'));
      const runCaseId = value(record, 'runCaseId');
      if (runCaseId !== null && runCaseId !== undefined) {
        const runCase = await this.models.RunCase.findByPk(runCaseId, { transaction });
        if (runCase)
          await this.models.RunCase.update(
            { status: RESULT_STATUS[resultValue] },
            { where: { id: runCaseId }, transaction }
          );
      }
      const patch: Record<string, unknown> = {
        status: 'finished',
        result: resultValue,
        finishedAt: this.clock(),
        activeExecutionKey: null,
        staleRevision: stale,
      };
      if (serializedReport !== undefined) patch.report = serializedReport;
      const updated = record.update ? ((await record.update(patch, { transaction })) ?? record) : record;
      if (!record.update) await this.models.ManualExecution.update(patch, { where: { id: executionId }, transaction });
      return this.view(updated, transaction);
    });
  }

  async updateReport(
    executionIdValue: number,
    userIdValue: number,
    reportValue: unknown
  ): Promise<ManualExecutionView> {
    const executionId = positiveId(executionIdValue, 'executionId');
    const userId = positiveId(userIdValue, 'userId');
    return this.db.transaction(async (transaction) => {
      const record = await this.execution(executionId, userId, transaction);
      if (String(value(record, 'status')) !== RUNNING) throw new ManualExecutionError('execution_not_active', 409);
      const serializedReport = serializeReport(reportValue);
      const patch = { report: serializedReport };
      const updated = record.update ? ((await record.update(patch, { transaction })) ?? record) : record;
      if (!record.update) await this.models.ManualExecution.update(patch, { where: { id: executionId }, transaction });
      return this.view(updated, transaction);
    });
  }

  async cancel(executionIdValue: number, userIdValue: number): Promise<ManualExecutionView> {
    const executionId = positiveId(executionIdValue, 'executionId');
    const userId = positiveId(userIdValue, 'userId');
    return this.db.transaction(async (transaction) => {
      const record = await this.execution(executionId, userId, transaction);
      const currentStatus = String(value(record, 'status'));
      if (currentStatus === 'finished') throw new ManualExecutionError('execution_finished', 409);
      if (currentStatus === 'cancelled') return this.view(record, transaction);
      if (currentStatus !== RUNNING) throw new ManualExecutionError('execution_state_invalid', 409);
      const patch = { status: 'cancelled', finishedAt: this.clock(), activeExecutionKey: null };
      const updated = record.update ? ((await record.update(patch, { transaction })) ?? record) : record;
      if (!record.update) await this.models.ManualExecution.update(patch, { where: { id: executionId }, transaction });
      return this.view(updated, transaction);
    });
  }

  async listEvidence(executionIdValue: number, userIdValue: number): Promise<ManualEvidenceView[]> {
    const executionId = positiveId(executionIdValue, 'executionId');
    const userId = positiveId(userIdValue, 'userId');
    return this.db.transaction(async (transaction) => {
      await this.execution(executionId, userId, transaction);
      const evidence = await this.models.ManualExecutionEvidence.findAll({
        where: { executionId },
        order: [['createdAt', 'ASC']],
        transaction,
      });
      return evidence.map(evidenceView);
    });
  }

  async uploadEvidence(
    executionIdValue: number,
    userIdValue: number,
    input: EvidenceUpload
  ): Promise<ManualEvidenceView> {
    const executionId = positiveId(executionIdValue, 'executionId');
    const userId = positiveId(userIdValue, 'userId');
    let storedKey: string | undefined;
    try {
      const result = await this.db.transaction(async (transaction) => {
        const record = await this.execution(executionId, userId, transaction);
        if (value(record, 'status') !== RUNNING) throw new ManualExecutionError('execution_not_active', 409);
        const existing = await this.models.ManualExecutionEvidence.findAll({
          where: { executionId },
          attributes: ['id'],
          transaction,
        });
        if (existing.length >= MAX_EVIDENCE_FILES) throw new ManualExecutionError('evidence_limit_exceeded', 409);
        let stored;
        try {
          stored = await this.storage.put({
            executionId,
            content: input.content,
            mimeType: input.mimeType,
            filename: input.filename,
            expectedSha256: input.expectedSha256,
          });
        } catch (error) {
          if (error instanceof EvidenceStorageError)
            throw new ManualExecutionError(error.code, errorStatus(error.code));
          throw new ManualExecutionError('evidence_storage_failed', 500);
        }
        storedKey = stored.storageKey;
        try {
          const current = await this.models.ManualExecution.findByPk(executionId, { transaction });
          if (!current || value(current, 'status') !== RUNNING)
            throw new ManualExecutionError('execution_not_active', 409);
          const created = await this.models.ManualExecutionEvidence.create(
            {
              executionId,
              uploaderUserId: userId,
              filename: input.filename,
              storageKey: stored.storageKey,
              mimeType: stored.mimeType,
              size: stored.size,
              sha256: stored.sha256,
              expiresAt: stored.expiresAt,
            },
            { transaction }
          );
          return evidenceView(created);
        } catch (error) {
          if (error instanceof ManualExecutionError) throw error;
          throw new ManualExecutionError('evidence_persistence_failed', 500);
        }
      });
      storedKey = undefined;
      return result;
    } catch (error) {
      if (storedKey) await this.storage.delete(storedKey).catch(() => undefined);
      throw error;
    }
  }

  private async evidence(
    executionId: number,
    evidenceId: number,
    userId: number,
    transaction: Transaction
  ): Promise<{ record: Row; item: Row }> {
    const record = await this.execution(executionId, userId, transaction);
    const item = await this.models.ManualExecutionEvidence.findOne({
      where: { id: evidenceId, executionId },
      transaction,
    });
    if (!item) throw new ManualExecutionError('evidence_not_found', 404);
    return { record, item };
  }

  async downloadEvidence(
    executionIdValue: number,
    evidenceIdValue: number,
    userIdValue: number
  ): Promise<{ bytes: Uint8Array; evidence: ManualEvidenceView }> {
    const executionId = positiveId(executionIdValue, 'executionId');
    const evidenceId = positiveId(evidenceIdValue, 'evidenceId');
    const userId = positiveId(userIdValue, 'userId');
    return this.db.transaction(async (transaction) => {
      const { item } = await this.evidence(executionId, evidenceId, userId, transaction);
      try {
        const expiresAt = new Date(String(value(item, 'expiresAt')));
        const bytes = await this.storage.get(
          String(value(item, 'storageKey')),
          String(value(item, 'sha256')),
          expiresAt
        );
        return { bytes, evidence: evidenceView(item) };
      } catch (error) {
        if (error instanceof EvidenceStorageError) throw new ManualExecutionError(error.code, errorStatus(error.code));
        throw new ManualExecutionError('evidence_storage_failed', 500);
      }
    });
  }

  async deleteEvidence(executionIdValue: number, evidenceIdValue: number, userIdValue: number): Promise<void> {
    const executionId = positiveId(executionIdValue, 'executionId');
    const evidenceId = positiveId(evidenceIdValue, 'evidenceId');
    const userId = positiveId(userIdValue, 'userId');
    await this.db.transaction(async (transaction) => {
      const { record, item } = await this.evidence(executionId, evidenceId, userId, transaction);
      if (value(record, 'status') !== RUNNING) throw new ManualExecutionError('evidence_immutable', 409);
      if (Number(value(item, 'uploaderUserId')) !== userId)
        throw new ManualExecutionError('evidence_uploader_required', 403);
      try {
        await this.storage.delete(String(value(item, 'storageKey')));
      } catch (error) {
        if (error instanceof EvidenceStorageError) throw new ManualExecutionError(error.code, errorStatus(error.code));
        throw new ManualExecutionError('evidence_storage_failed', 500);
      }
      if (item.destroy) await item.destroy({ transaction });
      else await this.models.ManualExecutionEvidence.destroy({ where: { id: evidenceId, executionId }, transaction });
    });
  }

  async cleanupExpiredEvidence(now = this.clock()): Promise<number> {
    const records = await this.models.ManualExecutionEvidence.findAll();
    let removed = 0;
    for (const item of records) {
      const expiresAt = new Date(String(value(item, 'expiresAt')));
      if (Number.isNaN(expiresAt.getTime()) || expiresAt > now) continue;
      await this.storage.delete(String(value(item, 'storageKey')));
      if (item.destroy) await item.destroy();
      else await this.models.ManualExecutionEvidence.destroy({ where: { id: value(item, 'id') } });
      removed += 1;
    }
    return removed;
  }
}

export function createManualExecutionService(options: ManualExecutionServiceOptions): ManualExecutionService {
  return new ManualExecutionService(options);
}
