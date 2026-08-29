import { Op } from 'sequelize';
import { transitionExecution } from '../domain/index.js';
import { genericExecutionResultSanitizer } from '../compatibility/execution-result-safety.js';
import type { CaseSource } from '../domain/index.js';
import {
  executionEventSequence,
  RUN_CASE_STATUS,
  type AutomationStore,
  type RunCaseSource,
  type RunCaseStatusUpdate,
  type StoredExecution,
  type StoredExecutionEvent,
  type StoredExecutionEventType,
} from '../ports/index.js';

type PlainRecord = Record<string, unknown>;
type ModelInstance = PlainRecord & {
  get?: (options?: { plain?: boolean }) => unknown;
  toJSON?: () => unknown;
  update?: (values: PlainRecord) => Promise<unknown>;
};
type ModelLike = {
  findByPk(id: unknown, options?: PlainRecord): Promise<unknown>;
  findOne(options: PlainRecord): Promise<unknown>;
  findAll(options?: PlainRecord): Promise<unknown[]>;
  count(options?: PlainRecord): Promise<number>;
  create(values: PlainRecord): Promise<unknown>;
  update(values: PlainRecord, options?: PlainRecord): Promise<unknown>;
  destroy?(options?: PlainRecord): Promise<unknown>;
};

export type AutomationModels = {
  Case: ModelLike;
  Step: ModelLike;
  CaseStep: ModelLike;
  Folder: ModelLike;
  Project: ModelLike;
  Member: ModelLike;
  Run: ModelLike;
  RunCase: ModelLike;
  AutomationDefinition: ModelLike;
  AutomationExecution: ModelLike;
  TestEnvironment: ModelLike;
  ExecutionArtifact: ModelLike;
  ExecutionEvent?: ModelLike;
  Organization?: ModelLike;
};

const EXECUTION_FIELDS = [
  'id',
  'definitionId',
  'projectId',
  'caseId',
  'exampleIndex',
  'runCaseId',
  'environmentId',
  'captureVideo',
  'status',
  'attempt',
  'engine',
  'model',
  'queuedAt',
  'startedAt',
  'finishedAt',
  'durationMs',
  'summary',
  'error',
  'errorKind',
  'attemptHistory',
  'lastWorkerEvent',
  'lastAttemptStatus',
  'diagnostics',
  'idempotencyKey',
  'correlationId',
  'createdAt',
  'updatedAt',
] as const;

const EXECUTION_UPDATE_FIELDS = [
  'status',
  'attempt',
  'queuedAt',
  'startedAt',
  'finishedAt',
  'durationMs',
  'summary',
  'error',
  'errorKind',
  'attemptHistory',
  'lastWorkerEvent',
  'lastAttemptStatus',
  'diagnostics',
] as const;

const EXECUTION_STATES = new Set(['queued', 'running', 'passed', 'failed', 'error', 'cancelled']);
const ACTIVE_EXECUTION_STATES = new Set(['queued', 'running']);
const EXECUTION_ERROR_KINDS = new Set(['technical', 'functional', 'cancelled', 'evidence']);
const EXECUTION_EVENT_TYPES = new Set<StoredExecutionEventType>([
  'queued',
  'running',
  'passed',
  'failed',
  'error',
  'cancelled',
  'retrying',
]);
function plain(value: unknown): PlainRecord | null {
  if (!value || typeof value !== 'object') return null;
  const instance = value as ModelInstance;
  const result = typeof instance.get === 'function' ? instance.get({ plain: true }) : (instance.toJSON?.() ?? instance);
  return result && typeof result === 'object' ? (result as PlainRecord) : null;
}

function positiveId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('automation_id_invalid');
  return id;
}

function safeArtifactStorageKey(value: string): boolean {
  return !value.startsWith('/') && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function activeExecutionKey(value: PlainRecord): string | null {
  const runCaseId = Number(value.runCaseId);
  const status = String(value.status ?? '');
  if (!Number.isSafeInteger(runCaseId) || runCaseId <= 0 || !ACTIVE_EXECUTION_STATES.has(status)) return null;
  const exampleIndex =
    value.exampleIndex === undefined || value.exampleIndex === null ? 'scenario' : String(value.exampleIndex);
  return `${runCaseId}:${exampleIndex}`;
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringArray(value: unknown): string[] {
  return [
    ...new Set(
      parseArray(value)
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
    ),
  ].filter(Boolean);
}

function secretReferences(value: unknown): string[] {
  return stringArray(value).filter((item) => /^(?:secret|vault|env):\/\//i.test(item));
}

function attemptHistory(value: unknown): unknown[] {
  return genericExecutionResultSanitizer.attemptHistory(value);
}

function safeDiagnostics(value: unknown): Record<string, unknown> | undefined {
  return genericExecutionResultSanitizer.diagnostics(value) as Record<string, unknown> | undefined;
}

function safeEventDetails(value: unknown): Record<string, unknown> | undefined {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const source = candidate as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const diagnostics = safeDiagnostics(source.diagnostics);
  if (diagnostics) result.diagnostics = diagnostics;
  if (Number.isSafeInteger(source.previousAttempt) && Number(source.previousAttempt) >= 1)
    result.previousAttempt = source.previousAttempt;
  if (typeof source.outcome === 'string' && /^[a-z_]{1,64}$/.test(source.outcome)) result.outcome = source.outcome;
  return Object.keys(result).length > 0 ? result : undefined;
}

function safeExecutionEvent(value: unknown): StoredExecutionEvent | null {
  const source = plain(value);
  if (!source) return null;
  const id = String(source.id ?? '');
  const executionId = String(source.executionId ?? '');
  const attempt = Number(source.attempt);
  const sequence = Number(source.sequence);
  const type = String(source.eventType ?? '') as StoredExecutionEventType;
  if (
    !id ||
    !executionId ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !EXECUTION_EVENT_TYPES.has(type)
  )
    return null;
  const details = safeEventDetails(source.details);
  const message =
    typeof source.message === 'string' ? genericExecutionResultSanitizer.eventMessage(source.message)?.trim() : null;
  return {
    id,
    executionId,
    attempt,
    sequence,
    type,
    ...(message ? { message } : {}),
    ...(details ? { details } : {}),
    ...(source.createdAt ? { createdAt: String(source.createdAt) } : {}),
  };
}

function safeEnvironment(value: PlainRecord | null): Record<string, unknown> | null {
  if (!value) return null;
  const id = Number(value.id);
  const projectId = Number(value.projectId);
  if (![id, projectId].every((item) => Number.isInteger(item) && item > 0)) return null;
  return {
    id,
    projectId,
    name: typeof value.name === 'string' ? value.name : '',
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    allowedHosts: stringArray(value.allowedHosts),
    secretRefs: secretReferences(value.secretRefs),
    enabled: value.enabled !== false,
    isDefault: value.isDefault === true,
    captureVideo: value.captureVideo === true,
  };
}

function safeExecution(value: unknown): StoredExecution | null {
  const source = plain(value);
  if (!source) return null;
  const id = String(source.id ?? '');
  const projectId = Number(source.projectId);
  const caseId = Number(source.caseId);
  const attempt = Number(source.attempt);
  const status = String(source.status ?? '');
  if (
    !id ||
    !Number.isInteger(projectId) ||
    !Number.isInteger(caseId) ||
    !Number.isInteger(attempt) ||
    !EXECUTION_STATES.has(status)
  )
    throw new Error('automation_execution_invalid');
  const result: StoredExecution = Object.fromEntries(
    EXECUTION_FIELDS.filter((field) => field in source).map((field) => [field, source[field]])
  ) as StoredExecution;
  result.id = id;
  result.projectId = projectId;
  result.caseId = caseId;
  result.attempt = attempt;
  result.status = status as StoredExecution['status'];
  if ('summary' in source) result.summary = genericExecutionResultSanitizer.text(source.summary);
  if ('error' in source) result.error = genericExecutionResultSanitizer.text(source.error);
  if ('errorKind' in source && source.errorKind !== null && source.errorKind !== undefined) {
    if (typeof source.errorKind === 'string' && EXECUTION_ERROR_KINDS.has(source.errorKind))
      result.errorKind = source.errorKind;
    else delete result.errorKind;
  }
  if ('exampleIndex' in source) {
    if (source.exampleIndex === null || source.exampleIndex === undefined) {
      result.exampleIndex = null;
    } else {
      const exampleIndex = Number(source.exampleIndex);
      if (!Number.isSafeInteger(exampleIndex) || exampleIndex < 0) throw new Error('automation_execution_invalid');
      result.exampleIndex = exampleIndex;
    }
  }
  result.attemptHistory = attemptHistory(source.attemptHistory);
  const definition = plain(source.AutomationDefinition ?? source.definition);
  if (definition?.snapshot !== undefined) {
    try {
      result.snapshot = JSON.parse(String(definition.snapshot));
    } catch {
      result.snapshot = { feature: String(definition.snapshot) };
    }
  }
  if (definition?.snapshotHash !== undefined) result.snapshotHash = String(definition.snapshotHash);
  if ('diagnostics' in source) {
    const diagnostics = safeDiagnostics(source.diagnostics);
    if (diagnostics) result.diagnostics = diagnostics as StoredExecution['diagnostics'];
    else delete result.diagnostics;
  }
  if (status === 'passed') {
    delete result.error;
    delete result.errorKind;
    delete result.lastAttemptStatus;
    delete result.diagnostics;
  }
  return result;
}

function safeCase(value: unknown): CaseSource | null {
  const source = plain(value);
  if (!source) return null;
  const folder = plain(source.Folder);
  const project = plain(folder?.Project);
  const sourceSteps = source.Steps ?? source.steps;
  const steps = Array.isArray(sourceSteps)
    ? sourceSteps.map((step) => {
        const item = plain(step) ?? {};
        const through = plain(item.caseSteps) ?? plain(item.CaseStep) ?? {};
        return {
          step: item.step,
          caseSteps: {
            stepNo: through.stepNo,
            keyword: through.keyword,
            section: through.section,
          },
        };
      })
    : [];
  return {
    id: source.id,
    projectId: source.projectId ?? project?.id,
    title: source.title,
    template: source.template,
    automationVersion: source.automationVersion,
    gherkinExamples: source.gherkinExamples,
    Steps: steps,
    Folder: project ? { Project: { id: project.id } } : undefined,
  } as CaseSource;
}

function isUniqueConstraint(error: unknown): boolean {
  const value = error as { name?: unknown; message?: unknown };
  return (
    String(value?.name ?? '').includes('UniqueConstraint') || /unique constraint/i.test(String(value?.message ?? ''))
  );
}

function createValues(value: PlainRecord): PlainRecord {
  const result: PlainRecord = {};
  for (const field of [
    'definitionId',
    'projectId',
    'caseId',
    'exampleIndex',
    'runCaseId',
    'environmentId',
    'captureVideo',
    'status',
    'attempt',
    'engine',
    'model',
    'queuedAt',
    'startedAt',
    'finishedAt',
    'durationMs',
    'idempotencyKey',
    'correlationId',
    'diagnostics',
  ]) {
    if (field in value && value[field] !== undefined) result[field] = value[field];
  }
  result.summary = genericExecutionResultSanitizer.text(value.summary);
  result.error = genericExecutionResultSanitizer.text(value.error);
  result.errorKind =
    typeof value.errorKind === 'string' && EXECUTION_ERROR_KINDS.has(value.errorKind) ? value.errorKind : null;
  if ('diagnostics' in value) {
    const diagnostics = safeDiagnostics(value.diagnostics);
    result.diagnostics = diagnostics ? JSON.stringify(diagnostics) : null;
  }
  result.attemptHistory = JSON.stringify(attemptHistory(value.attemptHistory));
  result.activeExecutionKey = activeExecutionKey(value);
  return result;
}

function updateValues(value: PlainRecord, current: PlainRecord = {}): PlainRecord {
  const result: PlainRecord = {};
  for (const field of EXECUTION_UPDATE_FIELDS) {
    if (field === 'attemptHistory') continue;
    if (field in value && value[field] !== undefined) {
      if (field === 'summary' || field === 'error') result[field] = genericExecutionResultSanitizer.text(value[field]);
      else if (field === 'errorKind')
        result[field] =
          typeof value[field] === 'string' && EXECUTION_ERROR_KINDS.has(value[field] as string)
            ? value[field]
            : null;
      else result[field] = value[field];
    }
  }
  if ('attemptHistory' in value) result.attemptHistory = JSON.stringify(attemptHistory(value.attemptHistory));
  if ('diagnostics' in value) {
    const diagnostics = safeDiagnostics(value.diagnostics);
    result.diagnostics = diagnostics ? JSON.stringify(diagnostics) : null;
  }
  if (value.status === 'passed') {
    Object.assign(result, { error: null, errorKind: null, diagnostics: null, lastAttemptStatus: null });
  }
  const merged = { ...current, ...value };
  if (ACTIVE_EXECUTION_STATES.has(String(merged.status ?? ''))) result.activeExecutionKey = activeExecutionKey(merged);
  else if (EXECUTION_STATES.has(String(merged.status ?? ''))) result.activeExecutionKey = null;
  if (value.status === 'queued') {
    if (!('startedAt' in value) || value.startedAt === undefined) result.startedAt = null;
    if (!('finishedAt' in value) || value.finishedAt === undefined) result.finishedAt = null;
    if (!('durationMs' in value) || value.durationMs === undefined) result.durationMs = null;
  }
  return result;
}

export class SequelizeAutomationStore implements AutomationStore {
  private readonly models: AutomationModels;

  constructor(models: AutomationModels) {
    this.models = models;
  }

  async findCase(caseId: number): Promise<CaseSource | null> {
    const id = positiveId(caseId);
    let value: unknown;
    try {
      value = await this.models.Case.findByPk(id, {
        include: [
          {
            model: this.models.Folder,
            attributes: ['id', 'projectId'],
            include: [{ model: this.models.Project, attributes: ['id'] }],
          },
          {
            model: this.models.Step,
            attributes: ['id', 'step'],
            through: { attributes: ['stepNo', 'keyword', 'section'] },
          },
        ],
      });
    } catch {
      value = await this.models.Case.findByPk(id);
      const source = plain(value);
      if (source) {
        const steps = await this.models.CaseStep.findAll({
          where: { caseId: id },
          include: [{ model: this.models.Step, attributes: ['step'] }],
        });
        source.Steps = steps.map((step) => {
          const link = plain(step) ?? {};
          const stepRecord = plain(link.Step) ?? {};
          return { step: stepRecord.step, caseSteps: link };
        });
        value = source;
      }
    }
    return safeCase(value);
  }

  async canAccessProject(userId: number, projectId: number): Promise<boolean> {
    const user = positiveId(userId);
    const project = positiveId(projectId);
    const record = plain(await this.models.Project.findByPk(project));
    if (!record) return false;
    if (record.isPublic === true || Number(record.userId) === user) return true;
    return Boolean(await this.models.Member.findOne({ where: { userId: user, projectId: project } }));
  }

  async findExecutionByIdempotencyKey(input: {
    projectId: number;
    idempotencyKey: string;
  }): Promise<StoredExecution | null> {
    const record = await this.models.AutomationExecution.findOne({
      where: { projectId: positiveId(input.projectId), idempotencyKey: String(input.idempotencyKey).trim() },
    });
    return safeExecution(record);
  }

  async findActiveExecution(input: {
    runCaseId: number;
    exampleIndex: number | null;
  }): Promise<StoredExecution | null> {
    const runCaseId = positiveId(input.runCaseId);
    const exampleIndex = input.exampleIndex === null ? null : Number(input.exampleIndex);
    if (exampleIndex !== null && (!Number.isSafeInteger(exampleIndex) || exampleIndex < 0)) return null;
    return safeExecution(
      await this.models.AutomationExecution.findOne({
        where: {
          runCaseId,
          exampleIndex,
          status: { [Op.in]: [...ACTIVE_EXECUTION_STATES] },
        },
        order: [['id', 'ASC']],
      })
    );
  }

  async createDefinition(value: PlainRecord): Promise<PlainRecord> {
    const data = {
      projectId: positiveId(value.projectId),
      caseId: positiveId(value.caseId),
      version: Number(value.version),
      snapshot: String(value.snapshot ?? ''),
      snapshotHash: String(value.snapshotHash ?? ''),
    };
    try {
      return plain(await this.models.AutomationDefinition.create(data)) ?? data;
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const existing = await this.models.AutomationDefinition.findOne({
        where: { projectId: data.projectId, caseId: data.caseId, version: data.version },
      });
      return plain(existing) ?? data;
    }
  }

  async createExecution(value: PlainRecord): Promise<StoredExecution> {
    const data = createValues(value);
    data.queuedAt ??= new Date();
    try {
      const record = await this.models.AutomationExecution.create(data);
      const result = safeExecution(record);
      if (!result) throw new Error('automation_execution_invalid');
      await this.appendExecutionEvent({
        executionId: result.id,
        attempt: result.attempt,
        sequence: executionEventSequence(result.attempt, 'queued'),
        type: 'queued',
        message: 'Execution queued',
      }).catch(() => undefined);
      return result;
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const existing = await this.findExecutionByIdempotencyKey({
        projectId: Number(data.projectId),
        idempotencyKey: String(data.idempotencyKey),
      });
      if (existing) return existing;
      if (data.activeExecutionKey && data.runCaseId !== undefined) {
        const active = await this.findActiveExecution({
          runCaseId: Number(data.runCaseId),
          exampleIndex:
            data.exampleIndex === undefined || data.exampleIndex === null ? null : Number(data.exampleIndex),
        });
        if (active) throw new Error('automation_execution_active');
      }
      throw error;
    }
  }

  async createArtifact(value: PlainRecord): Promise<Record<string, unknown>> {
    const executionId = positiveId(value.executionId);
    const projectId = positiveId(value.projectId);
    const attempt = Number(value.attempt);
    const kind = String(value.kind ?? '').trim();
    const storageKey = String(value.storageKey ?? '').trim();
    const mimeType = String(value.mimeType ?? '')
      .trim()
      .toLowerCase();
    const size = Number(value.size);
    const sha256 = String(value.sha256 ?? '')
      .trim()
      .toLowerCase();
    if (
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      !kind ||
      !storageKey ||
      storageKey.includes('\\') ||
      storageKey.includes('\0') ||
      !safeArtifactStorageKey(storageKey) ||
      !mimeType ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw new Error('automation_artifact_invalid');
    const record = await this.models.ExecutionArtifact.create({
      executionId,
      attempt,
      kind,
      storageKey,
      mimeType,
      size,
      sha256,
      expiresAt: value.expiresAt ?? null,
    });
    return this.safeArtifact(record, projectId);
  }

  async deleteArtifacts(storageKeys: readonly string[]): Promise<void> {
    const keys = [...new Set(storageKeys.map((value) => String(value).trim()).filter(Boolean))];
    if (keys.length === 0) return;
    if (keys.some((key) => !safeArtifactStorageKey(key))) throw new Error('automation_artifact_invalid');
    if (typeof this.models.ExecutionArtifact.destroy !== 'function')
      throw new Error('automation_artifact_delete_unavailable');
    await this.models.ExecutionArtifact.destroy({ where: { storageKey: keys } });
  }

  async findExecution(executionId: string): Promise<StoredExecution | null> {
    const result = safeExecution(
      await this.models.AutomationExecution.findByPk(String(executionId), {
        include: [{ model: this.models.AutomationDefinition, attributes: ['version', 'snapshot', 'snapshotHash'] }],
      })
    );
    if (!result || !this.models.ExecutionEvent) return result;
    result.events = await this.listExecutionEvents(result.id);
    return result;
  }

  async appendExecutionEvent(value: {
    executionId: string;
    attempt: number;
    sequence: number;
    type: StoredExecutionEventType;
    message?: string;
    details?: Record<string, unknown>;
  }): Promise<StoredExecutionEvent> {
    const executionId = String(value.executionId).trim();
    const attempt = Number(value.attempt);
    const sequence = Number(value.sequence);
    const type = String(value.type) as StoredExecutionEventType;
    if (
      !this.models.ExecutionEvent ||
      !executionId ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !EXECUTION_EVENT_TYPES.has(type)
    )
      throw new Error('execution_event_invalid');
    const details = safeEventDetails(value.details);
    const data = {
      executionId,
      attempt,
      sequence,
      eventType: type,
      message: genericExecutionResultSanitizer.eventMessage(value.message),
      details: details ? JSON.stringify(details) : null,
    };
    try {
      const record = await this.models.ExecutionEvent.create(data);
      const result = safeExecutionEvent(record);
      if (!result) throw new Error('execution_event_invalid');
      return result;
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const existing = await this.models.ExecutionEvent.findOne({ where: { executionId, sequence } });
      const result = safeExecutionEvent(existing);
      if (!result) throw new Error('execution_event_invalid');
      return result;
    }
  }

  async listExecutionEvents(executionId: string): Promise<StoredExecutionEvent[]> {
    if (!this.models.ExecutionEvent) return [];
    const records = await this.models.ExecutionEvent.findAll({
      where: { executionId: String(executionId) },
      order: [
        ['sequence', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    return records
      .map((record) => safeExecutionEvent(record))
      .filter((record): record is StoredExecutionEvent => Boolean(record))
      .sort((left, right) => left.sequence - right.sequence || Number(left.id) - Number(right.id));
  }

  async updateExecution(executionId: string, value: PlainRecord): Promise<StoredExecution> {
    const record = (await this.models.AutomationExecution.findByPk(String(executionId))) as ModelInstance | null;
    if (!record || typeof record.update !== 'function') throw new Error('execution_not_found');
    await record.update(updateValues(value, plain(record) ?? {}));
    const result = safeExecution(record);
    if (!result) throw new Error('automation_execution_invalid');
    return result;
  }

  async cancelExecution(executionId: string): Promise<StoredExecution> {
    const current = await this.findExecution(executionId);
    if (!current) throw new Error('execution_not_found');
    if (['passed', 'failed', 'error', 'cancelled'].includes(current.status)) return current;
    const transitioned = transitionExecution(current, 'cancelled');
    await this.models.AutomationExecution.update(updateValues(transitioned, plain(current) ?? {}), {
      where: { id: String(executionId), status: current.status },
    });
    await this.appendExecutionEvent({
      executionId: current.id,
      attempt: current.attempt,
      sequence: executionEventSequence(current.attempt, 'cancelled'),
      type: 'cancelled',
      message: 'Execution cancelled',
    }).catch(() => undefined);
    return (await this.findExecution(executionId)) ?? current;
  }

  async listExecutions(query: PlainRecord): Promise<{ items: StoredExecution[]; total: number }> {
    const where: PlainRecord = { projectId: positiveId(query.projectId) };
    if (query.status !== undefined) where.status = String(query.status);
    if (query.caseId !== undefined) where.caseId = positiveId(query.caseId);
    if (query.runCaseId !== undefined) where.runCaseId = positiveId(query.runCaseId);
    const offset = Math.max(0, Math.floor(Number(query.offset ?? 0)));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit ?? 20))));
    const [items, total] = await Promise.all([
      this.models.AutomationExecution.findAll({
        where,
        order: [
          ['queuedAt', 'DESC'],
          ['id', 'DESC'],
        ],
        offset,
        limit,
      }),
      this.models.AutomationExecution.count({ where }),
    ]);
    const safeItems = items.map((item) => safeExecution(item)).filter((item): item is StoredExecution => Boolean(item));
    if (!this.models.ExecutionEvent) return { items: safeItems, total };
    await Promise.all(
      safeItems.map(async (item) => {
        item.events = await this.listExecutionEvents(item.id);
      })
    );
    return { items: safeItems, total };
  }

  async findHerculesModel(projectId: number): Promise<string | null> {
    if (!this.models.Organization) return null;
    const project = plain(await this.models.Project.findByPk(positiveId(projectId)));
    const projectOwnerUserId = Number(project?.userId);
    if (!Number.isInteger(projectOwnerUserId) || projectOwnerUserId <= 0) return null;
    const organizationId = Number(project?.organizationId);
    if (!Number.isInteger(organizationId) || organizationId <= 0) return null;
    const organization = plain(await this.models.Organization.findByPk(organizationId));
    const organizationOwnerUserId = Number(organization?.ownerUserId);
    if (!Number.isInteger(organizationOwnerUserId) || organizationOwnerUserId !== projectOwnerUserId) return null;
    const model = typeof organization?.herculesModel === 'string' ? organization.herculesModel.trim() : '';
    return model ? model.slice(0, 256) : null;
  }

  async listEnvironments(projectId: number): Promise<Array<Record<string, unknown>>> {
    const items = await this.models.TestEnvironment.findAll({
      where: { projectId: positiveId(projectId) },
      order: [['id', 'ASC']],
    });
    return items
      .map((item) => safeEnvironment(plain(item)))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  async findEnvironment(environmentId: number): Promise<Record<string, unknown> | null> {
    return safeEnvironment(plain(await this.models.TestEnvironment.findByPk(positiveId(environmentId))));
  }

  async findRunCase(runCaseId: number): Promise<RunCaseSource | null> {
    const record = plain(await this.models.RunCase.findByPk(positiveId(runCaseId)));
    if (!record) return null;
    const run = plain(await this.models.Run.findByPk(record.runId));
    if (!run) return null;
    const id = Number(record.id);
    const caseId = Number(record.caseId);
    const runId = Number(record.runId);
    const projectId = Number(run.projectId);
    if (![id, caseId, runId, projectId].every((value) => Number.isInteger(value) && value > 0)) return null;
    return {
      id,
      caseId,
      runId,
      projectId,
    };
  }

  async updateRunCaseStatus(input: RunCaseStatusUpdate): Promise<void> {
    if (![1, 2].includes(input.status)) throw new Error('run_case_status_invalid');
    const runCase = await this.findRunCase(input.runCaseId);
    if (!runCase || runCase.projectId !== positiveId(input.projectId)) throw new Error('run_case_not_found');
    const current = plain(await this.models.AutomationExecution.findByPk(String(input.executionId)));
    if (!current || Number(current.projectId) !== runCase.projectId || Number(current.runCaseId) !== runCase.id)
      throw new Error('run_case_execution_not_found');

    const statusFor = (value: unknown): 1 | 2 | undefined =>
      value === 'passed' ? 1 : value === 'failed' ? 2 : undefined;
    let status = statusFor(current.status);
    const evidenceUnavailable = current.status === 'error' && current.errorKind === 'evidence';
    const isExampleExecution = current.exampleIndex !== undefined && current.exampleIndex !== null;
    if (isExampleExecution) {
      const executions = await this.models.AutomationExecution.findAll({
        where: { runCaseId: runCase.id, projectId: runCase.projectId },
      });
      const statuses = [current, ...executions.map((execution) => plain(execution)).filter(Boolean)].map((execution) =>
        statusFor(execution?.status)
      );
      status = statuses.includes(2) || evidenceUnavailable ? 2 : undefined;
    } else if (evidenceUnavailable) {
      status = RUN_CASE_STATUS.failed;
    }
    if (status === undefined) return;
    await this.models.RunCase.update({ status }, { where: { id: runCase.id } });
  }

  async listArtifacts(executionId: string): Promise<unknown[]> {
    const execution = await this.findExecution(executionId);
    if (!execution) return [];
    const items = await this.models.ExecutionArtifact.findAll({ where: { executionId: String(executionId) } });
    return items.map((item) => this.safeArtifact(item, execution.projectId));
  }

  async findArtifact(artifactId: string): Promise<Record<string, unknown> | null> {
    const item = await this.models.ExecutionArtifact.findByPk(String(artifactId));
    const record = plain(item);
    if (!record) return null;
    const execution = await this.findExecution(String(record.executionId));
    return execution ? this.safeArtifact(record, execution.projectId) : null;
  }

  private safeArtifact(value: unknown, projectId: number): Record<string, unknown> {
    const source = plain(value) ?? {};
    return {
      id: String(source.id),
      executionId: String(source.executionId),
      projectId,
      attempt: Number(source.attempt),
      kind: source.kind,
      filename:
        String(source.storageKey ?? '')
          .split('/')
          .pop() || undefined,
      storageKey: source.storageKey,
      mimeType: source.mimeType,
      size: Number(source.size),
      sha256: source.sha256,
      expiresAt: source.expiresAt,
    };
  }
}
