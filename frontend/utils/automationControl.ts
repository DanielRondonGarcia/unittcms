import Config from '@/config/config';
import type {
  AutomationArtifact,
  AutomationEnvironment,
  AutomationExecution,
  AutomationStatus,
  CreateAutomationExecutionInput,
} from '@/types/automation';

const apiServer = Config.apiServer;

export class AutomationRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly correlationId?: string
  ) {
    super(code);
  }
}

type AutomationPayload = { items?: unknown[]; error?: string; correlationId?: string } & Record<string, unknown>;

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
      payload.correlationId
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

export async function fetchAutomationEnvironments(jwt: string, projectId: number): Promise<AutomationEnvironment[]> {
  const payload = await request<AutomationPayload>(jwt, `/automation/projects/${projectId}/environments`);
  return items<AutomationEnvironment>(payload).filter((value) => value.enabled !== false);
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
  caseId?: number
): Promise<AutomationExecution[]> {
  const query = new URLSearchParams({ page: '1', limit: '20' });
  if (caseId !== undefined) query.set('caseId', String(caseId));
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
