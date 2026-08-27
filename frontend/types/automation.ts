export type AutomationStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled';

export type AutomationEnvironment = {
  id: number;
  name: string;
  enabled?: boolean;
  isDefault?: boolean;
  captureVideo?: boolean;
};

export type AutomationErrorField = {
  field: string;
  code: string;
  message: string;
};

export type AutomationDefaultEnvironment = {
  id?: number;
  projectId?: number;
  name: string;
  baseUrl: string;
  enabled: boolean;
  isDefault: boolean;
  hasSecretRefs: boolean;
  captureVideo: boolean;
};

export type AutomationExecution = {
  id: string | number;
  projectId?: number;
  caseId?: number;
  runCaseId?: number;
  environmentId?: number;
  status: AutomationStatus;
  attempt?: number;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: string;
  error?: string;
  errorFields?: AutomationErrorField[];
  correlationId?: string;
  captureVideo?: boolean;
  snapshot?: unknown;
  snapshotHash?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AutomationArtifact = {
  id: string | number;
  executionId?: string | number;
  kind: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  expiresAt?: string;
};

export type CreateAutomationExecutionInput = {
  projectId: number;
  caseId: number;
  environmentId: number;
  runCaseId?: number;
  executorKey?: string;
  idempotencyKey: string;
};

export type AutomationBatchCase = {
  caseId: number;
  runCaseId: number;
  title: string;
};

export type AutomationBatchResult = AutomationBatchCase & {
  execution?: AutomationExecution;
  error?: string;
  errorFields?: AutomationErrorField[];
};
