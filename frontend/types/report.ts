/** UI-facing report shapes; construction and authorization remain backend-owned. */
export const REPORT_FORMATS = ['json', 'html', 'pdf', 'docx'] as const;
export const REPORT_INTENTS = ['preview', 'download'] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportIntent = (typeof REPORT_INTENTS)[number];
export type ReportIdentifier = number | string;
export type ReportSelection = { mode: 'all' } | { mode: 'explicit'; scenarioIds: number[] };
export type ReportSelectionInput = {
  mode: 'all' | 'explicit';
  scenarioIds?: readonly ReportIdentifier[];
};
export type ReportControlInput = {
  selection: ReportSelectionInput;
  runId: ReportIdentifier;
  format: unknown;
  intent?: unknown;
};
export type ReportRequest = {
  selection: ReportSelection;
  execution: { runId: number };
  format: ReportFormat;
};
export type ReportOutput = {
  intent: ReportIntent;
  format: ReportFormat;
  bytes: ArrayBuffer;
  mimeType: string;
  filename: string;
  text?: string;
  json?: unknown;
};

export type ReportEvidenceState = 'available' | 'expired' | 'missing' | 'unavailable';
export type ReportEvidenceRef = {
  id: number;
  source: 'manual' | 'automation';
  executionId: number | string;
  label: string;
  state: ReportEvidenceState;
  href?: string;
  expiresAt?: string;
};
export type ReportRunOption = { id: number; name: string };
export type ReportScenarioOption = { id: number; title: string; folderId?: number | null };
export type ReportsMessages = Record<
  | 'title'
  | 'selection'
  | 'allScenarios'
  | 'explicitScenarios'
  | 'execution'
  | 'chooseExecution'
  | 'preview'
  | 'download'
  | 'loading'
  | 'requestError'
  | 'correlationId'
  | 'noRuns'
  | 'noScenarios'
  | 'previewUnavailable',
  string
>;
