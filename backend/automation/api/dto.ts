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
  fields?: AutomationErrorField[];
}

export interface AutomationErrorField {
  field: string;
  code: string;
  message: string;
}

export type AutomationResponse = Record<string, unknown> | AutomationErrorResponse;
