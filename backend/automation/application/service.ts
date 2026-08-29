import { randomUUID } from 'node:crypto';
import { composeCanonicalSnapshot, presentExampleSnapshot, transitionExecution } from '../domain/index.js';
// prettier-ignore
import type {
  ArtifactStorage,
  AutomationStore,
  AutomationWorker,
  EnvironmentResolver,
  ExecutionQueue,
  ExecutorRegistry,
  StoredExecution,
} from '../ports/index.js';

export class AutomationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(code);
  }
}

// prettier-ignore
type Dependencies = {
  store?: AutomationStore;
  queue?: ExecutionQueue;
  worker?: AutomationWorker;
  registry: ExecutorRegistry;
  environmentResolver?: EnvironmentResolver;
  artifactStorage?: ArtifactStorage;
};
type CreateInput = {
  userId: number;
  projectId: number;
  caseId: number;
  environmentId: number;
  idempotencyKey: string;
  runCaseId?: number;
  exampleIndex?: number | null;
  executorKey?: string;
  correlationId?: string;
};
type HistoryInput = {
  userId: number;
  projectId: number;
  page?: number;
  limit?: number;
  status?: string;
  caseId?: number;
  runCaseId?: number;
};

function unavailable(): never {
  throw new AutomationError(503, 'automation_not_ready');
}

function resolveExampleIndex(
  snapshot: {
    examples: { rows: readonly (readonly string[])[] } | null;
  },
  value: number | null | undefined
): number | null {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new AutomationError(400, 'invalid_example_index', [
      { field: 'exampleIndex', code: 'invalid', message: 'example index must be a non-negative integer' },
    ]);
  }
  if (!snapshot.examples) {
    if (value !== undefined && value !== null) {
      throw new AutomationError(400, 'invalid_example_index', [
        {
          field: 'exampleIndex',
          code: 'unsupported',
          message: 'example index is only valid for Scenario Outline rows',
        },
      ]);
    }
    return null;
  }
  if (value === undefined || value === null) {
    throw new AutomationError(400, 'example_index_required', [
      { field: 'exampleIndex', code: 'required', message: 'an example row must be selected for a Scenario Outline' },
    ]);
  }
  if (value >= snapshot.examples.rows.length) {
    throw new AutomationError(400, 'invalid_example_index', [
      { field: 'exampleIndex', code: 'out_of_range', message: 'example index is outside the available rows' },
    ]);
  }
  return value;
}

export function createAutomationApplication({
  store,
  queue,
  worker,
  registry,
  environmentResolver,
  artifactStorage,
}: Dependencies) {
  async function access(userId: number, projectId: number): Promise<void> {
    if (!store || !(await store.canAccessProject(userId, projectId))) throw new AutomationError(403, 'forbidden');
  }

  return {
    async create(input: CreateInput): Promise<StoredExecution | Record<string, unknown>> {
      if (!store || !queue) return unavailable();
      if (!input.idempotencyKey?.trim()) throw new AutomationError(400, 'idempotency_key_required');
      if (!Number.isInteger(input.environmentId) || input.environmentId <= 0)
        throw new AutomationError(400, 'environment_required');
      if (!environmentResolver) return unavailable();
      await access(input.userId, input.projectId);
      const environment = await store.findEnvironment?.(input.environmentId);
      if (
        !environment ||
        Number(environment.id) !== input.environmentId ||
        Number(environment.projectId) !== input.projectId ||
        environment.enabled === false
      ) {
        throw new AutomationError(404, 'environment_not_found');
      }
      if (input.runCaseId !== undefined) {
        if (!Number.isInteger(input.runCaseId) || input.runCaseId <= 0 || !store.findRunCase) {
          throw new AutomationError(404, 'run_case_not_found');
        }
        const runCase = await store.findRunCase(input.runCaseId);
        if (
          !runCase ||
          Number(runCase.id) !== input.runCaseId ||
          Number(runCase.caseId) !== input.caseId ||
          Number(runCase.projectId) !== input.projectId ||
          !Number.isInteger(Number(runCase.runId)) ||
          Number(runCase.runId) <= 0
        ) {
          throw new AutomationError(404, 'run_case_not_found');
        }
      }
      let resolvedEnvironment;
      try {
        resolvedEnvironment = await environmentResolver.resolve(input.environmentId);
      } catch {
        throw new AutomationError(400, 'environment_invalid');
      }
      const existing = await store.findExecutionByIdempotencyKey({
        projectId: input.projectId,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) return existing;
      const source = await store.findCase(input.caseId);
      const sourceProjectId = Number(
        (source as { projectId?: unknown; Folder?: { Project?: { id?: unknown } } } | null)?.projectId ??
          (source as { Folder?: { Project?: { id?: unknown } } } | null)?.Folder?.Project?.id
      );
      if (!source || Number(source.id) !== input.caseId || sourceProjectId !== input.projectId) {
        throw new AutomationError(404, 'source_not_found');
      }
      const snapshot = composeCanonicalSnapshot(source);
      if (!snapshot.ok) throw new AutomationError(400, 'invalid_source', snapshot.errors);
      const exampleIndex = resolveExampleIndex(snapshot.snapshot, input.exampleIndex);
      const llmModel = (await store.findHerculesModel?.(input.projectId)) ?? undefined;
      if (input.runCaseId !== undefined && store.findActiveExecution) {
        const active = await store.findActiveExecution({ runCaseId: input.runCaseId, exampleIndex });
        if (active) {
          throw new AutomationError(409, 'automation_execution_active', [
            {
              field: 'runCaseId',
              code: 'active',
              message: 'an execution for this RunCase and Example is already queued or running',
            },
          ]);
        }
      }
      const definition = await store.createDefinition({
        projectId: input.projectId,
        caseId: input.caseId,
        version: snapshot.snapshot.version,
        snapshot: JSON.stringify(snapshot.snapshot),
        snapshotHash: snapshot.snapshot.hash,
      });
      let execution: StoredExecution;
      try {
        execution = await store.createExecution({
          definitionId: definition.id,
          projectId: input.projectId,
          caseId: input.caseId,
          environmentId: input.environmentId,
          captureVideo: resolvedEnvironment.captureVideo === true,
          runCaseId: input.runCaseId,
          exampleIndex,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId ?? randomUUID(),
          status: 'queued',
          attempt: 1,
          ...(llmModel ? { model: llmModel } : {}),
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'automation_execution_active') {
          throw new AutomationError(409, 'automation_execution_active', [
            {
              field: 'runCaseId',
              code: 'active',
              message: 'an execution for this RunCase and Example is already queued or running',
            },
          ]);
        }
        throw error;
      }
      const jobId = await queue.enqueue({
        executionId: execution.id,
        attempt: execution.attempt,
        snapshot:
          exampleIndex === null ? snapshot.snapshot.feature : presentExampleSnapshot(snapshot.snapshot, exampleIndex),
        environment: resolvedEnvironment,
        ...(input.executorKey ? { executorKey: input.executorKey } : {}),
        ...(llmModel ? { llmModel } : {}),
      });
      return { ...execution, jobId, snapshotHash: snapshot.snapshot.hash };
    },

    async detail(userId: number, executionId: string): Promise<StoredExecution> {
      if (!store) return unavailable();
      const execution = await store.findExecution(executionId);
      if (!execution) throw new AutomationError(404, 'execution_not_found');
      await access(userId, execution.projectId);
      return execution;
    },

    async history(input: HistoryInput) {
      if (!store) return unavailable();
      await access(input.userId, input.projectId);
      const page = Math.max(1, Math.floor(input.page ?? 1));
      const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 20)));
      if (input.status && !['queued', 'running', 'passed', 'failed', 'error', 'cancelled'].includes(input.status))
        throw new AutomationError(400, 'invalid_status');
      if (input.runCaseId !== undefined && (!Number.isInteger(input.runCaseId) || input.runCaseId <= 0))
        throw new AutomationError(400, 'invalid_run_case_id');
      return store.listExecutions({
        projectId: input.projectId,
        offset: (page - 1) * limit,
        limit,
        status: input.status,
        ...(input.caseId === undefined ? {} : { caseId: input.caseId }),
        ...(input.runCaseId === undefined ? {} : { runCaseId: input.runCaseId }),
      });
    },

    async environments(input: { userId: number; projectId: number }) {
      if (!store || !store.listEnvironments) return unavailable();
      await access(input.userId, input.projectId);
      const values = await store.listEnvironments(input.projectId);
      return values
        .filter((value) => Number(value.projectId) === input.projectId && value.enabled !== false)
        .map((value) => safeEnvironment(value));
    },

    async cancel(input: { userId: number; executionId: string }): Promise<StoredExecution> {
      if (!store || !queue) return unavailable();
      const execution = await this.detail(input.userId, input.executionId);
      if (['passed', 'failed', 'error', 'cancelled'].includes(execution.status)) return execution;
      await queue.cancel(execution.id);
      if (store.cancelExecution) return store.cancelExecution(execution.id);
      return store.updateExecution(execution.id, transitionExecution(execution, 'cancelled'));
    },

    async artifacts(userId: number, executionId: string) {
      if (!store) return unavailable();
      await this.detail(userId, executionId);
      return (await store.listArtifacts(executionId)).map((value) => safeArtifact(value));
    },

    async download(userId: number, artifactId: string) {
      if (!store) return unavailable();
      const artifact = await store.findArtifact(artifactId);
      if (!artifact || !(await store.canAccessProject(userId, Number(artifact.projectId))))
        throw new AutomationError(404, 'artifact_not_found');
      const expiresAt = artifact.expiresAt ? new Date(String(artifact.expiresAt)).getTime() : 0;
      if (expiresAt && expiresAt <= Date.now()) throw new AutomationError(404, 'artifact_not_found');
      if (!artifactStorage) throw new AutomationError(503, 'artifact_storage_not_ready');
      const content = await artifactStorage.get(String(artifact.storageKey), String(artifact.sha256 ?? ''));
      return {
        ...safeArtifact(artifact),
        artifactId,
        content: Buffer.from(content).toString('base64'),
        encoding: 'base64',
      };
    },

    async executors() {
      return registry.list();
    },

    async health() {
      const executors = await registry.list();
      const queueHealth = queue?.health ? await queue.health() : { ready: false, status: 'queue_not_configured' };
      const workerHealth = worker ? await worker.health() : undefined;
      const ready = Boolean(
        store &&
          queue &&
          queueHealth.ready &&
          workerHealth?.ready &&
          workerHealth.heartbeatAt &&
          workerHealth.phase0Ready &&
          executors.some((item) => item.health.ready)
      );
      return { status: ready ? 'ready' : 'not_ready', ready, executors };
    },

    safeError(error: unknown, correlationId: string) {
      const candidate = error as { status?: unknown; code?: unknown; details?: unknown };
      const known =
        error instanceof AutomationError
          ? error
          : typeof candidate?.status === 'number' && typeof candidate.code === 'string'
            ? new AutomationError(candidate.status, candidate.code, candidate.details)
            : new AutomationError(500, 'internal_error');
      const fields = safeErrorFields(known.details);
      return {
        status: known.status,
        body: {
          error: known.code,
          correlationId,
          ...(fields.length > 0 ? { fields } : {}),
        },
      };
    },
  };
}

// prettier-ignore
const ARTIFACT_FIELDS = [
  'id',
  'executionId',
  'projectId',
  'attempt',
  'kind',
  'filename',
  'storageKey',
  'mimeType',
  'size',
  'sha256',
  'expiresAt',
];
function safeArtifact(value: unknown): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  // prettier-ignore
  return Object.fromEntries(ARTIFACT_FIELDS.filter((field) => source && field in source).map((field) => [field, source[field]]));
}

function safeEnvironment(value: Record<string, unknown>): Record<string, unknown> {
  return {
    id: value.id,
    name: value.name,
    enabled: value.enabled !== false,
    isDefault: value.isDefault === true,
  };
}

function safeErrorFields(value: unknown): Array<{ field: string; code: string; message: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Record<string, unknown>;
      const field = typeof candidate.field === 'string' ? candidate.field.trim().slice(0, 200) : '';
      const code = typeof candidate.code === 'string' ? candidate.code.trim().slice(0, 64) : '';
      const message = typeof candidate.message === 'string' ? candidate.message.trim().slice(0, 500) : '';
      return field && code && message ? [{ field, code, message }] : [];
    })
    .slice(0, 32);
}

export type AutomationApplication = ReturnType<typeof createAutomationApplication>;
