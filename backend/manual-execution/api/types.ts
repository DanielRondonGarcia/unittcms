export const MANUAL_EXECUTION_RESULTS = ['passed', 'failed'] as const;
export const MANUAL_EXECUTION_STATUSES = ['running', 'finished', 'cancelled'] as const;
export const MANUAL_EXECUTION_REPORT_VERSION = 1 as const;
export const MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH = 4_000;
export const MAX_MANUAL_EXECUTION_REPORT_LENGTH = 16_000;

export type ManualExecutionResult = (typeof MANUAL_EXECUTION_RESULTS)[number];
export type ManualExecutionStatus = (typeof MANUAL_EXECUTION_STATUSES)[number];

/** Version 1 is a plain-text, execution-scoped issue report. */
export type ManualExecutionReport = {
  version: typeof MANUAL_EXECUTION_REPORT_VERSION;
  failureReason: string;
  howToFix: string;
  reproductionSteps: string;
  browser: string;
  environment: string;
};

export type ManualExecutionView = {
  id: number;
  projectId: number;
  runId: number | null;
  runCaseId: number | null;
  caseId: number | null;
  actorUserId: number;
  assigneeUserId: number | null;
  status: ManualExecutionStatus;
  result: ManualExecutionResult | null;
  startedAt: string;
  finishedAt: string | null;
  caseRevision: number;
  caseSnapshotHash: string;
  stale: boolean;
  historical: boolean;
  sourceDeleted: boolean;
  correlationId: string;
  report: ManualExecutionReport | null;
};

export type ManualExecutionHistory = {
  items: ManualExecutionView[];
  total: number;
};

export type ManualEvidenceView = {
  id: number;
  executionId: number;
  uploaderUserId: number;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  expiresAt: string;
  createdAt: string;
};

export type EvidenceUpload = {
  content: Uint8Array;
  mimeType: string;
  filename: string;
  expectedSha256?: string;
};

export type ManualExecutionErrorShape = {
  code: string;
  status: number;
  message: string;
};

export interface ManualExecutionServicePort {
  start(runCaseId: number, userId: number, correlationId: string): Promise<ManualExecutionView>;
  get(executionId: number, userId: number): Promise<ManualExecutionView>;
  active(runCaseId: number, userId: number): Promise<ManualExecutionView | null>;
  listHistory(runCaseId: number, userId: number, page?: number, limit?: number): Promise<ManualExecutionHistory>;
  finish(executionId: number, userId: number, result: unknown, report?: unknown): Promise<ManualExecutionView>;
  updateReport(executionId: number, userId: number, report: unknown): Promise<ManualExecutionView>;
  cancel(executionId: number, userId: number): Promise<ManualExecutionView>;
  listEvidence(executionId: number, userId: number): Promise<ManualEvidenceView[]>;
  uploadEvidence(executionId: number, userId: number, input: EvidenceUpload): Promise<ManualEvidenceView>;
  downloadEvidence(
    executionId: number,
    evidenceId: number,
    userId: number
  ): Promise<{ bytes: Uint8Array; evidence: ManualEvidenceView }>;
  deleteEvidence(executionId: number, evidenceId: number, userId: number): Promise<void>;
}
