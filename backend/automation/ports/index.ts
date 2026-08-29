import type {
  CanonicalSnapshot,
  CaseSource,
  ExecutionState,
  ExecutorErrorKind,
  ExecutorOutcome,
} from '../domain/index.js';

export type ResolvedEnvironment = {
  baseUrl: string;
  allowedHosts: string[];
  secretRefs: string[];
  captureVideo?: boolean;
};
export type RunCaseSource = { id: number; caseId: number; runId: number; projectId: number };
export type ExecutorInput = {
  executionId: string;
  snapshot: string | CanonicalSnapshot;
  environment?: ResolvedEnvironment;
};
export type ExecutorInvocation = ExecutorInput & {
  artifactSink?: (artifacts: ExecutorArtifact[]) => Promise<void>;
  llmModel?: string;
};
export type ExecutorArtifact = {
  kind: string;
  content: Uint8Array;
  mimeType: string;
  filename?: string;
  expiresAt?: Date;
};
export type ExecutorResult = {
  outcome: ExecutorOutcome;
  summary?: string;
  error?: string;
  errorKind?: ExecutorErrorKind;
  diagnostics?: {
    exitCode?: number | null;
    signal?: string | null;
    timedOut?: boolean;
    stdout?: string;
    stderr?: string;
  };
  artifacts?: ExecutorArtifact[];
};
export type ExecutorHealth = { key?: string; ready: boolean; status: string };

export type StoredExecutionEventType = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled' | 'retrying';

export type StoredExecutionEvent = {
  id: string;
  executionId: string;
  attempt: number;
  sequence: number;
  type: StoredExecutionEventType;
  message?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
};

export interface AutomationExecutor {
  execute(input: ExecutorInvocation): Promise<ExecutorResult>;
  cancel(executionId: string): Promise<void>;
  health(): Promise<ExecutorHealth>;
}

export type ExecutionJob = ExecutorInput & { attempt: number; executorKey?: string; llmModel?: string };
export type QueueHealth = { ready: boolean; status: string };
export interface ExecutionQueue {
  enqueue(job: ExecutionJob): Promise<string>;
  cancel(executionId: string): Promise<void>;
  health?(): Promise<QueueHealth>;
}

export interface ArtifactStorage {
  put(input: {
    executionId: string;
    attempt: number;
    content: Uint8Array;
    mimeType: string;
    filename?: string;
    kind?: string;
    expiresAt?: Date;
  }): Promise<{ storageKey: string; hash: string }>;
  get(storageKey: string, expectedSha256?: string): Promise<Uint8Array>;
  delete?(storageKey: string): Promise<void>;
}

export interface EnvironmentResolver {
  resolve(environmentId: number): Promise<ResolvedEnvironment>;
}

export type WorkerHealth = {
  ready: boolean;
  status: string;
  heartbeatAt: string;
  phase0Ready: boolean;
  executors: unknown[];
};
export interface AutomationWorker {
  health(): Promise<WorkerHealth>;
}

export interface ExecutorRegistry {
  register(key: string, executor: AutomationExecutor): void;
  select(key?: string): Promise<AutomationExecutor | undefined>;
  list(): Promise<Array<{ key: string; health: ExecutorHealth }>>;
}

export type StoredExecution = {
  id: string;
  projectId: number;
  caseId: number;
  exampleIndex?: number | null;
  status: ExecutionState;
  attempt: number;
  idempotencyKey?: string;
  correlationId?: string;
  snapshotHash?: string;
  diagnostics?: {
    exitCode?: number | null;
    signal?: string | null;
    timedOut?: boolean;
    stdout?: string;
    stderr?: string;
  } | null;
  events?: StoredExecutionEvent[];
  [key: string]: unknown;
};

export function executionEventSequence(attempt: number, type: StoredExecutionEventType): number {
  const phase = type === 'retrying' ? 5 : type === 'queued' ? 10 : type === 'running' ? 20 : 30;
  return attempt * 100 + phase;
}

export const RUN_CASE_STATUS = { passed: 1, failed: 2 } as const;
export type RunCaseStatusUpdate = {
  runCaseId: number;
  projectId: number;
  status: (typeof RUN_CASE_STATUS)[keyof typeof RUN_CASE_STATUS];
  executionId: string;
  attempt: number;
  correlationId: string;
};
export type RunCaseStatusUpdater = (update: RunCaseStatusUpdate) => Promise<void>;

export interface AutomationStore {
  findCase(caseId: number): Promise<CaseSource | null>;
  canAccessProject(userId: number, projectId: number): Promise<boolean>;
  findExecutionByIdempotencyKey(input: { projectId: number; idempotencyKey: string }): Promise<StoredExecution | null>;
  findActiveExecution?(input: { runCaseId: number; exampleIndex: number | null }): Promise<StoredExecution | null>;
  createDefinition(value: Record<string, unknown>): Promise<Record<string, unknown>>;
  createExecution(value: Record<string, unknown>): Promise<StoredExecution>;
  createArtifact(value: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteArtifacts(storageKeys: readonly string[]): Promise<void>;
  findExecution(executionId: string): Promise<StoredExecution | null>;
  appendExecutionEvent?(value: {
    executionId: string;
    attempt: number;
    sequence: number;
    type: StoredExecutionEventType;
    message?: string;
    details?: Record<string, unknown>;
  }): Promise<StoredExecutionEvent>;
  listExecutionEvents?(executionId: string): Promise<StoredExecutionEvent[]>;
  findHerculesModel?(projectId: number): Promise<string | null>;
  updateExecution(executionId: string, value: Record<string, unknown>): Promise<StoredExecution>;
  cancelExecution?(executionId: string): Promise<StoredExecution>;
  listExecutions(query: Record<string, unknown>): Promise<{ items: StoredExecution[]; total: number }>;
  listEnvironments?(projectId: number): Promise<Array<Record<string, unknown>>>;
  findEnvironment?(environmentId: number): Promise<Record<string, unknown> | null>;
  findRunCase?(runCaseId: number): Promise<RunCaseSource | null>;
  listArtifacts(executionId: string): Promise<unknown[]>;
  findArtifact(artifactId: string): Promise<Record<string, unknown> | null>;
}
