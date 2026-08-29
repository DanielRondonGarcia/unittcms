import Config from '@/config/config';
import type {
  AutomationArtifact,
  AutomationBatchCase,
  AutomationBatchResult,
  AutomationDefaultEnvironment,
  AutomationErrorKind,
  AutomationErrorMessages,
  AutomationEnvironment,
  AutomationOrganizationModel,
  AutomationErrorField,
  AutomationExecution,
  AutomationStatus,
  CreateAutomationExecutionInput,
} from '@/types/automation';

const apiServer = Config.apiServer;

export class AutomationRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly correlationId?: string,
    public readonly fields: AutomationErrorField[] = []
  ) {
    super(code);
  }
}

type AutomationPayload = { items?: unknown[]; error?: string; correlationId?: string; fields?: unknown } & Record<
  string,
  unknown
>;

function safeErrorFields(value: unknown): AutomationErrorField[] {
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

async function request<T>(jwt: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiServer}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as AutomationPayload;
  if (!response.ok) {
    throw new AutomationRequestError(
      response.status,
      payload.error ?? 'automation_request_failed',
      payload.correlationId,
      safeErrorFields(payload.fields)
    );
  }
  return payload as T;
}

function items<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as AutomationPayload).items)) {
    return (payload as AutomationPayload).items as T[];
  }
  return [];
}

function execution(payload: unknown): AutomationExecution {
  const value = payload as AutomationExecution;
  if (!value || typeof value !== 'object' || !value.id || !isAutomationStatus(value.status)) {
    throw new AutomationRequestError(502, 'invalid_automation_response');
  }
  return value;
}

function isAutomationStatus(value: unknown): value is AutomationStatus {
  return ['queued', 'running', 'passed', 'failed', 'error', 'cancelled'].includes(String(value));
}

export function isAutomationActive(status: AutomationStatus): boolean {
  return status === 'queued' || status === 'running';
}

export function formatAutomationDuration(durationMs?: number): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '—';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}s`;
}

export function formatAutomationExampleLabel(label: string, exampleIndex: number, row?: readonly string[]): string {
  const preview = row?.join(' · ') ?? '';
  return `${label} ${exampleIndex + 1}${preview ? `: ${preview}` : ''}`;
}

const TIMEOUT_ERROR_CODES = new Set(['deadline_exceeded', 'hercules_timeout', 'timeout']);
const EVIDENCE_ERROR_CODES = new Set(['evidence_junit_invalid', 'evidence_junit_missing', 'evidence_secret_detected']);
const FUNCTIONAL_ERROR_CODES = new Set(['assertion_failed', 'functional_failure']);
const CANCELLED_ERROR_CODES = new Set(['automation_cancelled', 'hercules_cancelled', 'cancelled']);
const TECHNICAL_ERROR_CODES = new Set([
  'artifact_not_found',
  'artifact_persistence_failed',
  'artifact_storage_not_ready',
  'automation_execution_active',
  'automation_not_ready',
  'automation_request_failed',
  'environment_invalid',
  'environment_not_found',
  'environment_required',
  'environment_target_rejected',
  'environment_url_invalid',
  'executor_failure',
  'executor_not_configured',
  'forbidden',
  'hercules_llm_config_invalid',
  'hercules_process_failed',
  'hercules_provider_unsupported',
  'hercules_result_error',
  'invalid_automation_environment_response',
  'invalid_automation_organization_response',
  'invalid_automation_response',
  'invalid_canonical_feature',
  'organization_model_unavailable',
  'organization_owner_required',
  'organization_scope_invalid',
  'project_not_found',
  'source_not_found',
  'execution_not_found',
]);

type AutomationErrorFeedback = {
  code?: unknown;
  errorKind?: AutomationErrorKind | string;
  status?: string;
  timedOut?: boolean;
};

function errorCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function formatAutomationError(
  feedback: AutomationErrorFeedback,
  messages: AutomationErrorMessages
): string | undefined {
  const code = errorCode(feedback.code);
  const kind = errorCode(feedback.errorKind);
  const status = errorCode(feedback.status);
  const knownCode =
    TIMEOUT_ERROR_CODES.has(code) ||
    EVIDENCE_ERROR_CODES.has(code) ||
    code.startsWith('evidence_') ||
    FUNCTIONAL_ERROR_CODES.has(code) ||
    CANCELLED_ERROR_CODES.has(code) ||
    TECHNICAL_ERROR_CODES.has(code);
  const failureStatus = ['failed', 'error', 'cancelled'].includes(status);

  if (!code && !kind && !failureStatus) return undefined;
  if (!kind && !knownCode && !failureStatus && ['queued', 'running', 'passed'].includes(status)) return undefined;
  if (feedback.timedOut === true || TIMEOUT_ERROR_CODES.has(code)) return messages.automationTimeoutDetail;
  if (kind === 'evidence' || EVIDENCE_ERROR_CODES.has(code) || code.startsWith('evidence_'))
    return messages.automationEvidenceFailure;
  if (kind === 'cancelled' || CANCELLED_ERROR_CODES.has(code) || status === 'cancelled')
    return messages.automationCancelledDetail;
  if (kind === 'functional' || FUNCTIONAL_ERROR_CODES.has(code) || status === 'failed')
    return messages.automationFunctionalFailure;
  if (kind === 'technical' || TECHNICAL_ERROR_CODES.has(code) || status === 'error')
    return messages.automationTechnicalFailure;
  return messages.automationGenericFailure;
}

export async function fetchAutomationEnvironments(jwt: string, projectId: number): Promise<AutomationEnvironment[]> {
  const payload = await request<AutomationPayload>(jwt, `/automation/projects/${projectId}/environments`);
  return items<AutomationEnvironment>(payload).filter((value) => value.enabled !== false);
}

async function waitForAutomationExecution(
  jwt: string,
  execution: AutomationExecution,
  pollIntervalMs: number
): Promise<AutomationExecution> {
  let current = execution;
  while (isAutomationActive(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    current = await fetchAutomationExecution(jwt, current.id);
  }
  return current;
}

export async function runAutomationBatch(
  jwt: string,
  input: {
    projectId: number;
    runId: number;
    environmentId: number;
    cases: AutomationBatchCase[];
    batchId: string;
    pollIntervalMs?: number;
    onStart?: (testCase: AutomationBatchCase) => void;
    onResult?: (result: AutomationBatchResult) => void;
  }
): Promise<AutomationBatchResult[]> {
  const results: AutomationBatchResult[] = [];
  for (const testCase of input.cases) {
    const base = { ...testCase };
    input.onStart?.(testCase);
    try {
      const created = await createAutomationExecution(jwt, {
        projectId: input.projectId,
        caseId: testCase.caseId,
        runCaseId: testCase.runCaseId,
        ...(testCase.exampleIndex === undefined ? {} : { exampleIndex: testCase.exampleIndex }),
        environmentId: input.environmentId,
        idempotencyKey: `run-${input.runId}-case-${testCase.runCaseId}-${input.batchId}${
          testCase.exampleIndex === undefined || testCase.exampleIndex === null
            ? ''
            : `-example-${testCase.exampleIndex}`
        }`,
      });
      const result = {
        ...base,
        execution: await waitForAutomationExecution(jwt, created, input.pollIntervalMs ?? 750),
      };
      results.push(result);
      input.onResult?.(result);
    } catch (error) {
      const requestError = error instanceof AutomationRequestError ? error : undefined;
      const result = {
        ...base,
        error: requestError?.code ?? (error instanceof Error ? error.message : 'automation_request_failed'),
        ...(requestError && requestError.fields.length > 0 ? { errorFields: requestError.fields } : {}),
      };
      results.push(result);
      input.onResult?.(result);
    }
  }
  return results;
}

export async function fetchAutomationDefaultEnvironment(
  jwt: string,
  projectId: number
): Promise<AutomationDefaultEnvironment | null> {
  const payload = await request<AutomationPayload>(jwt, `/projects/${projectId}/settings/automation-environment`);
  const environment = payload.environment;
  return environment && typeof environment === 'object' ? (environment as AutomationDefaultEnvironment) : null;
}

export async function saveAutomationDefaultEnvironment(
  jwt: string,
  projectId: number,
  input: { baseUrl: string; allowedHosts: string[]; enabled: boolean; captureVideo: boolean }
): Promise<AutomationDefaultEnvironment> {
  const payload = await request<AutomationPayload>(jwt, `/projects/${projectId}/settings/automation-environment`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  if (!payload.environment || typeof payload.environment !== 'object') {
    throw new AutomationRequestError(502, 'invalid_automation_environment_response');
  }
  return payload.environment as AutomationDefaultEnvironment;
}

export async function fetchAutomationOrganizationModel(
  jwt: string,
  projectId: number
): Promise<AutomationOrganizationModel | null> {
  const payload = await request<AutomationPayload>(jwt, `/projects/${projectId}/settings/hercules-model`);
  const organization = payload.organization;
  return organization && typeof organization === 'object' ? (organization as AutomationOrganizationModel) : null;
}

export async function saveAutomationOrganizationModel(
  jwt: string,
  projectId: number,
  model: string | null
): Promise<AutomationOrganizationModel> {
  const payload = await request<AutomationPayload>(jwt, `/projects/${projectId}/settings/hercules-model`, {
    method: 'PUT',
    body: JSON.stringify({ model }),
  });
  if (!payload.organization || typeof payload.organization !== 'object')
    throw new AutomationRequestError(502, 'invalid_automation_organization_response');
  return payload.organization as AutomationOrganizationModel;
}

export async function createAutomationExecution(
  jwt: string,
  input: CreateAutomationExecutionInput
): Promise<AutomationExecution> {
  const { idempotencyKey, ...body } = input;
  return execution(
    await request<AutomationExecution>(jwt, '/automation/executions', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    })
  );
}

export async function fetchAutomationExecution(
  jwt: string,
  executionId: string | number
): Promise<AutomationExecution> {
  return execution(
    await request<AutomationExecution>(jwt, `/automation/executions/${encodeURIComponent(executionId)}`)
  );
}

export async function fetchAutomationHistory(
  jwt: string,
  projectId: number,
  caseId?: number,
  runCaseId?: number,
  limit = 20
): Promise<AutomationExecution[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
  const query = new URLSearchParams({ page: '1', limit: String(safeLimit) });
  if (caseId !== undefined) query.set('caseId', String(caseId));
  if (runCaseId !== undefined) query.set('runCaseId', String(runCaseId));
  const payload = await request<AutomationPayload>(
    jwt,
    `/automation/projects/${projectId}/executions?${query.toString()}`
  );
  return items<AutomationExecution>(payload);
}

export async function cancelAutomationExecution(
  jwt: string,
  executionId: string | number
): Promise<AutomationExecution> {
  return execution(
    await request<AutomationExecution>(jwt, `/automation/executions/${encodeURIComponent(executionId)}/cancel`, {
      method: 'POST',
    })
  );
}

export async function fetchAutomationArtifacts(
  jwt: string,
  executionId: string | number
): Promise<AutomationArtifact[]> {
  const payload = await request<AutomationPayload>(
    jwt,
    `/automation/executions/${encodeURIComponent(executionId)}/artifacts`
  );
  return items<AutomationArtifact>(payload);
}

export async function downloadAutomationArtifact(
  jwt: string,
  artifactId: string | number
): Promise<AutomationArtifact & { content?: string; encoding?: string }> {
  return (await request<AutomationArtifact & { content?: string; encoding?: string }>(
    jwt,
    `/automation/artifacts/${encodeURIComponent(artifactId)}/download`
  )) as AutomationArtifact & { content?: string; encoding?: string };
}
