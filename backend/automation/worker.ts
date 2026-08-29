import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mapExecutorResult, transitionExecution } from './domain/index.js';
import type { ExecutorErrorKind, ExecutorOutcome } from './domain/index.js';
/* prettier-ignore */
import { RUN_CASE_STATUS } from './ports/index.js';
/* prettier-ignore */
import type {
  ArtifactStorage,
  AutomationStore,
  ExecutionJob,
  ExecutionQueue,
  ExecutorArtifact,
  ExecutorRegistry,
  ExecutorResult,
  RunCaseStatusUpdater,
  StoredExecution,
} from './ports/index.js';

const MAX_ATTEMPTS = 2;
const TERMINAL = new Set(['passed', 'failed', 'error', 'cancelled']);
const RETRYABLE = new Set<ExecutorOutcome>(['technical_error', 'timeout', 'abandoned']);
const ARTIFACT_KINDS = new Set(['junit', 'html', 'screenshot', 'video', 'log', 'network', 'planner']);
const ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
type ArtifactPersistenceStage =
  | 'validation'
  | 'storage_put'
  | 'metadata_create'
  | 'metadata_cleanup'
  | 'storage_cleanup';
type ArtifactPersistenceErrorCategory =
  | 'database_busy'
  | 'database_constraint'
  | 'database_readonly'
  | 'storage_missing'
  | 'storage_invalid'
  | 'unknown';
const STORAGE_INVALID_CODES = new Set([
  'ARTIFACT_INVALID',
  'ARTIFACT_MIME_NOT_ALLOWED',
  'ARTIFACT_EXTENSION_NOT_ALLOWED',
  'ARTIFACT_SCOPE_INVALID',
  'ARTIFACT_SIZE_EXCEEDED',
  'ARTIFACT_UNSCANNABLE',
  'ARTIFACT_CONTAINS_SECRET',
  'ARTIFACT_RETENTION_INVALID',
  'ARTIFACT_PATH_INVALID',
  'EACCES',
  'EEXIST',
  'EISDIR',
  'EINVAL',
  'ELOOP',
  'ENAMETOOLONG',
  'ENOTDIR',
  'EPERM',
  'EROFS',
]);
const SAFE_ERROR_MESSAGES = new Set(['ENOENT', ...STORAGE_INVALID_CODES]);
const VALID_OUTCOMES = new Set<ExecutorOutcome>([
  'passed',
  'functional_failure',
  'technical_error',
  'timeout',
  'abandoned',
  'cancelled',
]);
type Limits = { attempts?: number; backoffMs?: number; concurrency?: number; deadlineMs?: number };
export type WorkerJob = ExecutionJob & { jobId?: string; executorKey?: string };
export type WorkerLog = Record<string, string | number | undefined>;
export type WorkerHooks = { log?: (event: WorkerLog) => void; metric?: (name: string, fields: WorkerLog) => void };
// This remains an injected seam so unit tests do not require a live Redis service.
/* prettier-ignore */
export type QueueAdapter = { add(name: string, job: ExecutionJob, options: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number }; removeOnComplete: boolean; removeOnFail: boolean }): Promise<{ id?: string }>; remove(executionId: string): Promise<void>; recoverStalled(): Promise<ExecutionJob[]>; isReady(): Promise<boolean>; close(): Promise<void> };

/* prettier-ignore */
export class WorkerBoundaryError extends Error { constructor(public readonly code: string) { super(code); } }
/* prettier-ignore */
export function jobIdFor(job: Pick<ExecutionJob, 'executionId' | 'attempt'>): string { return `${job.executionId}:attempt:${job.attempt}`; }
/* prettier-ignore */
function emit(hooks: WorkerHooks = {}, event: WorkerLog): void { hooks.log?.(event); if (event.status) hooks.metric?.(`automation.execution.${event.status}`, event); }
/* prettier-ignore */
function limit(value: Limits): Required<Limits> { return { attempts: Math.min(MAX_ATTEMPTS, Math.max(1, value.attempts ?? MAX_ATTEMPTS)), backoffMs: Math.min(60_000, Math.max(1, value.backoffMs ?? 1_000)), concurrency: Math.max(1, value.concurrency ?? 1), deadlineMs: Math.max(1, value.deadlineMs ?? 300_000) }; }

function stableErrorIdentifiers(error: unknown): string[] {
  const values: unknown[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 1) return;
    const record = value as { code?: unknown; name?: unknown; message?: unknown; parent?: unknown; original?: unknown };
    values.push(record.code, record.name);
    if (typeof record.message === 'string' && SAFE_ERROR_MESSAGES.has(record.message.toUpperCase()))
      values.push(record.message);
    visit(record.parent, depth + 1);
    visit(record.original, depth + 1);
  };
  try {
    visit(error, 0);
  } catch {
    return [];
  }
  return values.filter((value): value is string => typeof value === 'string').map((value) => value.toUpperCase());
}

function classifyArtifactPersistenceError(error: unknown): ArtifactPersistenceErrorCategory {
  const codes = stableErrorIdentifiers(error);
  if (codes.some((code) => code.startsWith('SQLITE_BUSY'))) return 'database_busy';
  if (codes.some((code) => code.startsWith('SQLITE_CONSTRAINT') || code === 'SEQUELIZEUNIQUECONSTRAINTERROR'))
    return 'database_constraint';
  if (codes.some((code) => code.startsWith('SQLITE_READONLY'))) return 'database_readonly';
  if (codes.includes('ENOENT')) return 'storage_missing';
  if (codes.some((code) => STORAGE_INVALID_CODES.has(code))) return 'storage_invalid';
  return 'unknown';
}

function emitArtifactDiagnostic(
  hooks: WorkerHooks | undefined,
  executionId: string,
  attempt: number,
  stage: ArtifactPersistenceStage,
  errorCategory: ArtifactPersistenceErrorCategory
): void {
  try {
    emit(hooks, { executionId, attempt, stage, errorCategory });
  } catch {
    // Diagnostics must not alter fail-closed persistence or cleanup behavior.
  }
}

type ArtifactPersistence = {
  storage: ArtifactStorage;
  store: Pick<AutomationStore, 'createArtifact' | 'deleteArtifacts'>;
};

async function persistArtifacts(
  execution: StoredExecution,
  attempt: number,
  artifacts: ExecutorArtifact[] | undefined,
  persistence: ArtifactPersistence | undefined,
  hooks?: WorkerHooks
): Promise<void> {
  if (!artifacts?.length) return;
  if (!persistence) {
    emitArtifactDiagnostic(hooks, execution.id, attempt, 'validation', 'storage_missing');
    throw new WorkerBoundaryError('artifact_persistence_failed');
  }
  if (artifacts.length > 128) {
    emitArtifactDiagnostic(hooks, execution.id, attempt, 'validation', 'storage_invalid');
    throw new WorkerBoundaryError('artifact_persistence_failed');
  }
  const storageKeys: string[] = [];
  let stage: ArtifactPersistenceStage = 'validation';
  try {
    for (const artifact of artifacts) {
      stage = 'validation';
      if (
        !ARTIFACT_KINDS.has(artifact.kind) ||
        !(artifact.content instanceof Uint8Array) ||
        typeof artifact.mimeType !== 'string' ||
        !artifact.mimeType.trim()
      )
        throw new Error('artifact_invalid');
      const mimeType = artifact.mimeType.split(';', 1)[0].trim().toLowerCase();
      if (!mimeType) throw new Error('artifact_invalid');
      const expiresAt = artifact.expiresAt ?? new Date(Date.now() + ARTIFACT_RETENTION_MS);
      if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) throw new Error('artifact_invalid');
      const sha256 = createHash('sha256').update(artifact.content).digest('hex');
      stage = 'storage_put';
      const stored = await persistence.storage.put({
        executionId: execution.id,
        attempt,
        content: artifact.content,
        mimeType,
        filename: artifact.filename,
        kind: artifact.kind,
        expiresAt,
      });
      const storageKey = stored?.storageKey;
      const storedHash = stored?.hash;
      if (typeof storageKey === 'string' && storageKey) storageKeys.push(storageKey);
      if (
        typeof storageKey !== 'string' ||
        !storageKey ||
        typeof storedHash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(storedHash) ||
        storedHash.toLowerCase() !== sha256
      )
        throw new Error('artifact_invalid');
      stage = 'metadata_create';
      await persistence.store.createArtifact({
        executionId: execution.id,
        projectId: execution.projectId,
        attempt,
        kind: artifact.kind,
        storageKey,
        mimeType,
        size: artifact.content.byteLength,
        sha256,
        expiresAt,
      });
    }
  } catch (error) {
    emitArtifactDiagnostic(hooks, execution.id, attempt, stage, classifyArtifactPersistenceError(error));
    let metadataRemoved = true;
    stage = 'metadata_cleanup';
    try {
      await persistence.store.deleteArtifacts(storageKeys);
    } catch (error) {
      emitArtifactDiagnostic(hooks, execution.id, attempt, stage, classifyArtifactPersistenceError(error));
      metadataRemoved = false;
    }
    const deleteArtifact = persistence.storage.delete?.bind(persistence.storage);
    if (metadataRemoved && deleteArtifact) {
      stage = 'storage_cleanup';
      const cleanupResults = await Promise.allSettled(storageKeys.map((storageKey) => deleteArtifact(storageKey)));
      cleanupResults.forEach((result) => {
        if (result.status === 'rejected')
          emitArtifactDiagnostic(hooks, execution.id, attempt, stage, classifyArtifactPersistenceError(result.reason));
      });
    }
    throw new WorkerBoundaryError('artifact_persistence_failed');
  }
}

function resultEvent(
  base: { executionId: string; attempt: number; correlationId: string; jobId: string },
  outcome: ExecutorResult
): Extract<WorkerEvent, { phase: 'result' }> {
  return {
    ...base,
    phase: 'result',
    outcome: outcome.outcome,
    ...(outcome.summary !== undefined ? { summary: outcome.summary } : {}),
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    ...(outcome.errorKind !== undefined ? { errorKind: outcome.errorKind } : {}),
  };
}

/* prettier-ignore */
export class BullMqExecutionQueue implements ExecutionQueue {
  readonly config: Required<Limits>;
  constructor(private readonly adapter: QueueAdapter, config: Limits = {}, private readonly hooks: WorkerHooks = {}) { this.config = limit(config); }
  async enqueue(job: ExecutionJob): Promise<string> { const jobId = jobIdFor(job); const added = await this.adapter.add('automation-execution', job, { jobId, attempts: this.config.attempts, backoff: { type: 'exponential', delay: this.config.backoffMs }, removeOnComplete: true, removeOnFail: false }); return added.id ?? jobId; }
  cancel(executionId: string): Promise<void> { return this.adapter.remove(executionId); }
  async reconcile(): Promise<{ ready: boolean; jobs: ExecutionJob[]; errorCategory?: string }> { try { if (!(await this.adapter.isReady())) throw new Error('redis unavailable'); return { ready: true, jobs: await this.adapter.recoverStalled() }; } catch { emit(this.hooks, { status: 'degraded', errorCategory: 'redis_connection' }); return { ready: false, jobs: [], errorCategory: 'redis_connection' }; } }
  async health(): Promise<{ ready: boolean; status: string }> { try { const ready = await this.adapter.isReady(); return { ready, status: ready ? 'ready' : 'not_ready' }; } catch { return { ready: false, status: 'redis_unavailable' }; } }
  shutdown(): Promise<void> { return this.adapter.close(); }
}

/* prettier-ignore */
type WorkerEventBase = {
  executionId: string;
  attempt: number;
  correlationId: string;
  jobId: string;
  error?: string;
  errorKind?: ExecutorErrorKind;
  errorCategory?: string;
  recoverable?: boolean;
};
/* prettier-ignore */
export type WorkerEvent = WorkerEventBase & ({ phase: 'running' } | { phase: 'result'; outcome: ExecutorOutcome; summary?: string });
export type SignedWorkerEvent = WorkerEvent & { signature: string };
/* prettier-ignore */
function payload(event: WorkerEvent): string { return JSON.stringify([event.phase, event.executionId, event.attempt, event.correlationId, event.jobId, 'outcome' in event ? event.outcome : undefined, 'summary' in event ? event.summary : undefined, event.error, event.errorKind, event.errorCategory, event.recoverable]); }
/* prettier-ignore */
export function signWorkerEvent(event: WorkerEvent, secret: string): SignedWorkerEvent { if (!secret) throw new WorkerBoundaryError('worker_secret_required'); return { ...event, signature: createHmac('sha256', secret).update(payload(event)).digest('hex') }; }
/* prettier-ignore */
function verify(event: SignedWorkerEvent, secret: string): void { if (!secret || !event.signature) throw new WorkerBoundaryError('invalid_worker_signature'); const expected = createHmac('sha256', secret).update(payload(event)).digest('hex'); const actual = Buffer.from(event.signature); if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) throw new WorkerBoundaryError('invalid_worker_signature'); }
/* prettier-ignore */
export function shouldRetry(result: { outcome: ExecutorOutcome; recoverable?: boolean; errorCategory?: string }): boolean { return result.recoverable === true && RETRYABLE.has(result.outcome) && result.errorCategory !== 'invalid_source'; }

/* prettier-ignore */
export class WorkerResultUpdater {
  constructor(
    private readonly store: Pick<AutomationStore, 'findExecution' | 'updateExecution'>,
    private readonly secret: string,
    private readonly runCaseStatusUpdater?: RunCaseStatusUpdater
  ) {}
  find(executionId: string): Promise<StoredExecution | null> { return this.store.findExecution(executionId); }
  async record(event: SignedWorkerEvent): Promise<StoredExecution> {
    verify(event, this.secret); const current = await this.store.findExecution(event.executionId); if (!current) throw new WorkerBoundaryError('execution_not_found');
    if (event.phase === 'result' && !VALID_OUTCOMES.has(event.outcome)) throw new WorkerBoundaryError('worker_result_invalid');
    const key = `${event.jobId}:${event.phase}:${event.attempt}:${'outcome' in event ? event.outcome : ''}`; if (current.lastWorkerEvent === key) return current;
    if (event.jobId !== jobIdFor(event) || current.attempt !== event.attempt || current.correlationId !== event.correlationId) throw new WorkerBoundaryError('worker_event_mismatch');
    if (event.phase === 'running') { if (current.status === 'running') return current; if (current.status !== 'queued') throw new WorkerBoundaryError('worker_event_state'); return this.store.updateExecution(event.executionId, { ...transitionExecution(current, 'running'), lastWorkerEvent: key }); }
    if (!event.outcome) throw new WorkerBoundaryError('worker_result_missing'); const mapped = mapExecutorResult(event);
    if (TERMINAL.has(current.status)) { if (mapped.status === current.status) return current; throw new WorkerBoundaryError('worker_event_replay'); }
    const base = current.status === 'queued' ? transitionExecution(current, 'running') : current;
    const history = [...(Array.isArray(current.attemptHistory) ? current.attemptHistory : []), { attempt: event.attempt, status: mapped.status, outcome: event.outcome, error: event.error }];
    const patch: Record<string, unknown> = { ...transitionExecution(base, mapped.status), ...mapped, attemptHistory: history, lastWorkerEvent: key };
    if (shouldRetry(event) && event.attempt < MAX_ATTEMPTS) Object.assign(patch, { status: 'queued', attempt: event.attempt + 1, queuedAt: new Date().toISOString(), startedAt: undefined, finishedAt: undefined, durationMs: undefined, lastAttemptStatus: mapped.status });
    const runCaseId = Number(current.runCaseId);
    const projectId = Number(current.projectId);
    const updated = await this.store.updateExecution(event.executionId, patch);
    const runCaseStatus =
      mapped.errorKind === 'evidence'
        ? RUN_CASE_STATUS.failed
        : mapped.status === 'passed' || mapped.status === 'failed'
          ? RUN_CASE_STATUS[mapped.status]
          : undefined;
    if (
      this.runCaseStatusUpdater &&
      runCaseStatus !== undefined &&
      Number.isInteger(runCaseId) &&
      runCaseId > 0 &&
      Number.isInteger(projectId) &&
      projectId > 0
    ) {
      await this.runCaseStatusUpdater({
        runCaseId,
        projectId,
        status: runCaseStatus,
        executionId: current.id,
        attempt: event.attempt,
        correlationId: String(current.correlationId),
      });
    }
    return updated;
  }
}

/* prettier-ignore */
type WorkerOptions = Limits & {
  secret: string;
  queue?: BullMqExecutionQueue;
  phase0Ready?: boolean;
  hooks?: WorkerHooks;
  artifactStorage?: ArtifactStorage;
  artifactStore?: Pick<AutomationStore, 'createArtifact' | 'deleteArtifacts'>;
};
/* prettier-ignore */
export type WorkerRuntime = {
  consume(handler: (job: WorkerJob) => Promise<unknown>, options: { concurrency: number }): Promise<void> | void;
  close(): Promise<void>;
  onCancel?(handler: (executionId: string) => Promise<unknown>): void;
};
class DeadlineError extends Error {}
/* prettier-ignore */
async function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError()), deadlineMs); })]); } finally { if (timer) clearTimeout(timer); } }

/* prettier-ignore */
export class ExecutionWorker {
  private readonly config: Required<Pick<WorkerOptions, 'deadlineMs' | 'concurrency' | 'phase0Ready'>> & WorkerOptions;
  private readonly active = new Map<string, { cancel(id: string): Promise<void> }>(); private accepting = true;
  private runtime?: WorkerRuntime;
  private heartbeatAt?: string;
  constructor(private readonly registry: ExecutorRegistry, private readonly updater: WorkerResultUpdater, config: WorkerOptions) { this.config = { ...config, ...limit(config), phase0Ready: config.phase0Ready ?? false }; }
  async process(job: WorkerJob): Promise<StoredExecution | undefined> {
    if (!this.accepting) throw new WorkerBoundaryError('worker_shutdown'); const current = await this.updater.find(job.executionId);
    if (!current?.correlationId) { emit(this.config.hooks, { executionId: job.executionId, jobId: job.jobId ?? jobIdFor(job), status: 'error', errorCategory: 'execution_missing' }); return undefined; }
    const base = { executionId: job.executionId, attempt: job.attempt, correlationId: current.correlationId, jobId: job.jobId ?? jobIdFor(job) };
    await this.updater.record(signWorkerEvent({ ...base, phase: 'running' }, this.config.secret)); const executor = await this.registry.select(job.executorKey);
    if (!executor) return this.updater.record(signWorkerEvent({ ...base, phase: 'result', outcome: 'technical_error', error: 'executor_not_configured', errorCategory: 'configuration' }, this.config.secret));
    this.active.set(job.executionId, executor); const started = Date.now(); let result: Extract<WorkerEvent, { phase: 'result' }>;
    try {
      const artifactPersistence = this.config.artifactStorage && this.config.artifactStore
        ? { storage: this.config.artifactStorage, store: this.config.artifactStore }
        : undefined;
      let artifactsPersisted = false;
      const outcome = await withDeadline(
        executor.execute({
          executionId: job.executionId,
          snapshot: job.snapshot,
          ...(job.environment ? { environment: job.environment } : {}),
          ...(artifactPersistence
            ? {
                artifactSink: async (artifacts) => {
                  if (!artifacts.length) return;
                  await persistArtifacts(current, job.attempt, artifacts, artifactPersistence, this.config.hooks);
                  artifactsPersisted = true;
                },
              }
            : {}),
        }),
        this.config.deadlineMs
      );
      if (!artifactsPersisted)
        await persistArtifacts(current, job.attempt, outcome.artifacts, artifactPersistence, this.config.hooks);
      result = resultEvent(base, outcome);
    } catch (error) {
      if (error instanceof DeadlineError) { try { await executor.cancel(job.executionId); } catch { emit(this.config.hooks, { ...base, status: 'error', errorCategory: 'cancel_failed' }); } result = { ...base, phase: 'result', outcome: 'timeout', error: 'deadline_exceeded', errorCategory: 'timeout' }; }
      else if (error instanceof WorkerBoundaryError && error.code === 'artifact_persistence_failed') result = { ...base, phase: 'result', outcome: 'technical_error', error: error.code, errorCategory: 'artifact' };
      else result = { ...base, phase: 'result', outcome: 'technical_error', error: 'executor_failure', errorCategory: 'technical', recoverable: (error as { recoverable?: unknown })?.recoverable === true };
    } finally { this.active.delete(job.executionId); }
    const updated = await this.updater.record(signWorkerEvent(result, this.config.secret)); if (shouldRetry(result) && updated.status === 'queued' && this.config.queue) await this.config.queue.enqueue({ ...job, attempt: updated.attempt });
    emit(this.config.hooks, { executionId: job.executionId, caseId: current.caseId, runCaseId: current.runCaseId as number | undefined, jobId: base.jobId, status: updated.status, duration: Date.now() - started, errorCategory: result.errorCategory }); return updated;
  }
  async cancel(executionId: string): Promise<StoredExecution | undefined> {
    const active = this.active.get(executionId); if (active) await active.cancel(executionId); const current = await this.updater.find(executionId); if (!current || TERMINAL.has(current.status)) return current ?? undefined;
    return this.updater.record(signWorkerEvent({ phase: 'result', executionId, attempt: current.attempt, correlationId: String(current.correlationId), jobId: jobIdFor({ executionId, attempt: current.attempt }), outcome: 'cancelled', errorCategory: 'cancelled' }, this.config.secret));
  }
  async start(runtime: WorkerRuntime): Promise<void> {
    this.runtime = runtime;
    runtime.onCancel?.((executionId) => this.cancel(executionId));
    this.heartbeatAt = new Date().toISOString();
    if (!this.config.phase0Ready) return;
    await runtime.consume((job) => this.process(job), { concurrency: this.config.concurrency });
  }
  async reconcile(): Promise<{ ready: boolean; jobs: ExecutionJob[]; errorCategory?: string }> { if (!this.config.queue) return { ready: false, jobs: [], errorCategory: 'queue_not_configured' }; const result = await this.config.queue.reconcile(); if (result.ready) for (const job of result.jobs) await this.process(job); return result; }
  async health(): Promise<{ ready: boolean; status: string; heartbeatAt: string; phase0Ready: boolean; executors: unknown[] }> { if (!this.config.phase0Ready) return { ready: false, status: 'phase0_not_ready', heartbeatAt: this.heartbeatAt ?? '', phase0Ready: false, executors: [] }; const queue = this.config.queue ? await this.config.queue.health() : { ready: false, status: 'queue_not_configured' }; const executors = await this.registry.list(); const ready = this.accepting && Boolean(this.heartbeatAt) && queue.ready && executors.some((item) => item.health.ready); return { ready, status: ready ? 'ready' : 'not_ready', heartbeatAt: this.heartbeatAt ?? '', phase0Ready: this.config.phase0Ready, executors }; }
  async shutdown(): Promise<void> { this.accepting = false; this.heartbeatAt = undefined; await Promise.allSettled([...this.active.keys()].map((id) => this.cancel(id))); let failure: unknown; try { if (this.config.queue) await this.config.queue.shutdown(); } catch (error) { failure = error; } finally { if (this.runtime) await this.runtime.close().catch((error) => { failure ??= error; }); } if (failure) throw failure; }
}

/* prettier-ignore */
type SignalSource = { once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown; off(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown };
/* prettier-ignore */
export function installWorkerShutdown(worker: ExecutionWorker, signals: SignalSource = process): () => void { const handler = () => void worker.shutdown(); signals.once('SIGTERM', handler); signals.once('SIGINT', handler); return () => { signals.off('SIGTERM', handler); signals.off('SIGINT', handler); }; }
