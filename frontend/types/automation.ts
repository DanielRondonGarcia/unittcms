export type AutomationStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled';

export type AutomationEnvironment = {
  id: number;
  name: string;
  allowedHosts?: string[];
  enabled?: boolean;
  isDefault?: boolean;
  captureVideo?: boolean;
};

export type AutomationErrorField = {
  field: string;
  code: string;
  message: string;
};

export type AutomationErrorKind = 'technical' | 'functional' | 'cancelled' | 'evidence';

export type AutomationErrorMessages = {
  automationTechnicalFailure: string;
  automationFunctionalFailure: string;
  automationEvidenceFailure: string;
  automationCancelledDetail: string;
  automationGenericFailure: string;
  automationTimeoutDetail: string;
};

export type AutomationDefaultEnvironment = {
  id?: number;
  projectId?: number;
  name: string;
  baseUrl: string;
  allowedHosts: string[];
  enabled: boolean;
  isDefault: boolean;
  hasSecretRefs: boolean;
  captureVideo: boolean;
};

export type AutomationExecution = {
  id: string | number;
  projectId?: number;
  caseId?: number;
  exampleIndex?: number | null;
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
  errorKind?: AutomationErrorKind;
  errorFields?: AutomationErrorField[];
  correlationId?: string;
  captureVideo?: boolean;
  engine?: string;
  model?: string;
  attemptHistory?: unknown[];
  lastWorkerEvent?: string;
  lastAttemptStatus?: string;
  diagnostics?: {
    exitCode?: number | null;
    signal?: string | null;
    timedOut?: boolean;
    stdout?: string;
    stderr?: string;
  };
  events?: AutomationExecutionEvent[];
  snapshot?: unknown;
  snapshotHash?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AutomationExecutionEvent = {
  id: string | number;
  executionId: string | number;
  attempt: number;
  sequence: number;
  type: 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'cancelled' | 'retrying';
  message?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
};

export type AutomationOrganizationModel = {
  id: number;
  name: string;
  herculesModel: string | null;
};

export type AutomationArtifact = {
  id: string | number;
  executionId?: string | number;
  kind: string;
  filename?: string;
  storageKey?: string;
  mimeType?: string;
  size?: number;
  expiresAt?: string;
};

export type CreateAutomationExecutionInput = {
  projectId: number;
  caseId: number;
  environmentId: number;
  runCaseId?: number;
  exampleIndex?: number | null;
  executorKey?: string;
  idempotencyKey: string;
};

export type AutomationBatchCase = {
  caseId: number;
  runCaseId: number;
  title: string;
  exampleIndex?: number | null;
  exampleValues?: string[];
};

export type AutomationBatchResult = AutomationBatchCase & {
  execution?: AutomationExecution;
  error?: string;
  errorFields?: AutomationErrorField[];
};
