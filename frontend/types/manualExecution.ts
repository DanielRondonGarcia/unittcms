import type { RunDetailMessages } from './run';

export const MANUAL_EXECUTION_RESULTS = ['passed', 'failed'] as const;
export const MANUAL_EXECUTION_STATUSES = ['running', 'finished', 'cancelled'] as const;
export const MANUAL_EXECUTION_REPORT_VERSION = 1 as const;
export const MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH = 4_000;
export const MAX_MANUAL_EXECUTION_REPORT_LENGTH = 16_000;
export const MAX_MANUAL_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MAX_MANUAL_EVIDENCE_FILES = 10;

export type ManualExecutionResult = (typeof MANUAL_EXECUTION_RESULTS)[number];
export type ManualExecutionStatus = (typeof MANUAL_EXECUTION_STATUSES)[number];

export type ManualExecutionReport = {
  version: typeof MANUAL_EXECUTION_REPORT_VERSION;
  failureReason: string;
  howToFix: string;
  reproductionSteps: string;
  browser: string;
  environment: string;
};

export type ManualExecutionReportField = Exclude<keyof ManualExecutionReport, 'version'>;

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
  /** Optional so clients can still parse responses from servers before the report migration. */
  report?: ManualExecutionReport | null;
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
  mimeType: 'image/png' | 'image/jpeg';
  size: number;
  sha256: string;
  expiresAt: string;
  createdAt: string;
};

export type ManualEvidenceDownload = {
  bytes: ArrayBuffer;
  mimeType: string;
};

export type ManualExecutionMessages = Pick<
  RunDetailMessages,
  'requestError' | 'retry' | 'retryAfter' | 'correlationId'
> & {
  manualExecution: string;
  manualExecutionStart: string;
  manualExecutionLoading: string;
  manualExecutionEmpty: string;
  manualExecutionRunning: string;
  manualExecutionPassed: string;
  manualExecutionFailed: string;
  manualExecutionCancelled: string;
  manualExecutionFinished: string;
  manualExecutionStatus: string;
  manualExecutionResult: string;
  manualExecutionExpand: string;
  manualExecutionCollapse: string;
  manualExecutionFinishPassed: string;
  manualExecutionFinishFailed: string;
  manualExecutionFinishFailedConfirm: string;
  manualExecutionReportBack: string;
  manualExecutionCancel: string;
  manualExecutionActor: string;
  manualExecutionAssignee: string;
  manualExecutionStartedAt: string;
  manualExecutionFinishedAt: string;
  manualExecutionRevision: string;
  manualExecutionStale: string;
  manualExecutionHistorical: string;
  manualExecutionSourceDeleted: string;
  manualExecutionEvidence: string;
  manualExecutionEvidencePrivate: string;
  manualExecutionEvidenceEmpty: string;
  manualExecutionEvidenceUpload: string;
  manualExecutionEvidenceDownload: string;
  manualExecutionEvidenceDelete: string;
  manualExecutionEvidenceDeleteConfirm: string;
  manualExecutionEvidenceDeleteCancel: string;
  manualExecutionUnavailable: string;
  manualExecutionUnauthorized: string;
  manualExecutionEvidenceType: string;
  manualExecutionEvidenceSize: string;
  manualExecutionEvidenceLimit: string;
  manualExecutionReport: string;
  manualExecutionReportDescription: string;
  manualExecutionReportFailureReason: string;
  manualExecutionReportHowToFix: string;
  manualExecutionReportReproductionSteps: string;
  manualExecutionReportBrowser: string;
  manualExecutionReportEnvironment: string;
  manualExecutionReportFieldLimit: string;
  manualExecutionReportSave: string;
  manualExecutionReportSaving: string;
  manualExecutionReportSaved: string;
  manualExecutionReportUnsaved: string;
  manualExecutionReportEmpty: string;
  manualExecutionReportComments: string;
  manualExecutionReportTooLong: string;
  manualExecutionActorHint: string;
  manualExecutionEvidencePaste: string;
  manualExecutionEvidenceDrop: string;
  manualExecutionEvidenceUploading: string;
  manualExecutionEvidenceUploaded: string;
  manualExecutionEvidenceUploadFailed: string;
  manualExecutionEvidencePreview: string;
  manualExecutionEvidenceOpen: string;
  manualExecutionEvidenceClose: string;
  manualExecutionReportUnavailable: string;
};
