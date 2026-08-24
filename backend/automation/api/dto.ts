export interface CreateAutomationExecutionRequest {
  projectId: number;
  caseId: number;
  environmentId: number;
  runCaseId?: number;
  executorKey?: string;
  idempotencyKey?: string;
}

export interface AutomationErrorResponse {
  error: string;
  correlationId: string;
  fields?: unknown;
}

export type AutomationResponse = Record<string, unknown> | AutomationErrorResponse;
