import type { CanonicalSnapshot, CaseSource, ExecutionState, ExecutorOutcome } from '../domain/index.js';

export type ResolvedEnvironment = { baseUrl: string; allowedHosts: string[]; secretRefs: string[] };
export type ExecutorInput = {
  executionId: string;
  snapshot: string | CanonicalSnapshot;
  environment?: ResolvedEnvironment;
};
export type ExecutorResult = { outcome: ExecutorOutcome; summary?: string; error?: string };
export type ExecutorHealth = { key?: string; ready: boolean; status: string };

export interface AutomationExecutor {
  execute(input: ExecutorInput): Promise<ExecutorResult>;
  cancel(executionId: string): Promise<void>;
  health(): Promise<ExecutorHealth>;
}

export type ExecutionJob = ExecutorInput & { attempt: number };
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
  status: ExecutionState;
  attempt: number;
  idempotencyKey?: string;
  correlationId?: string;
  snapshotHash?: string;
  [key: string]: unknown;
};

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
  createDefinition(value: Record<string, unknown>): Promise<Record<string, unknown>>;
  createExecution(value: Record<string, unknown>): Promise<StoredExecution>;
  findExecution(executionId: string): Promise<StoredExecution | null>;
  updateExecution(executionId: string, value: Record<string, unknown>): Promise<StoredExecution>;
  listExecutions(query: Record<string, unknown>): Promise<{ items: StoredExecution[]; total: number }>;
  listEnvironments?(projectId: number): Promise<Array<Record<string, unknown>>>;
  findEnvironment?(environmentId: number): Promise<Record<string, unknown> | null>;
  listArtifacts(executionId: string): Promise<unknown[]>;
  findArtifact(artifactId: string): Promise<Record<string, unknown> | null>;
}
