export type AutomationStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled';

export type AutomationEnvironment = {
  id: number;
  name: string;
  enabled?: boolean;
};

export type AutomationExecution = {
  id: string | number;
  projectId?: number;
  caseId?: number;
  environmentId?: number;
  status: AutomationStatus;
  attempt?: number;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: string;
  error?: string;
  correlationId?: string;
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
