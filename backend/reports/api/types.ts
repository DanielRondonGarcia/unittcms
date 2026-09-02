export const REPORT_FORMATS = ['json', 'html', 'pdf', 'docx'] as const;
export const REPORT_SELECTION_MODES = ['all', 'explicit'] as const;
export const REPORT_EVIDENCE_STATES = ['available', 'expired', 'missing', 'unavailable'] as const;

export const DEFAULT_REPORT_LIMITS = Object.freeze({
  maxScenarios: 1_000,
  maxSelectionIds: 1_000,
  maxSerializedBytes: 10 * 1024 * 1024,
});

export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportSelectionMode = (typeof REPORT_SELECTION_MODES)[number];
export type ReportEvidenceState = (typeof REPORT_EVIDENCE_STATES)[number];

export type ReportLimits = {
  maxScenarios?: number;
  maxSelectionIds?: number;
  maxSerializedBytes?: number;
};

export type ResolvedReportLimits = {
  maxScenarios: number;
  maxSelectionIds: number;
  maxSerializedBytes: number;
};

export type ReportSelection = {
  mode: ReportSelectionMode;
  scenarioIds?: number[];
};

export type BuildReportRequest = {
  selection: ReportSelection;
  execution: { runId: number };
  format: ReportFormat;
};

export type BuildReportInput = {
  userId: number;
  projectId: number;
  request: BuildReportRequest;
};

export type NormalizedReportSelection = { mode: 'all' } | { mode: 'explicit'; scenarioIds: number[] };

export type ReportStoreBuildInput = {
  userId: number;
  projectId: number;
  runId: number;
  selection: NormalizedReportSelection;
  limits: ResolvedReportLimits;
  now: Date;
};

export type ReportUser = {
  id: number;
  username?: string;
  email?: string;
};

export type ReportProject = {
  id: number;
  name: string;
  detail: string | null;
  isPublic: boolean;
  ownerUserId: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ReportExecution = {
  id: number;
  name: string;
  description: string | null;
  state: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ReportStep = {
  id: number | null;
  position: number;
  text: string;
  expectedResult: string;
  keyword: string | null;
  section: string | null;
};

export type ReportEvidenceRef = {
  id: number;
  source: 'manual' | 'automation';
  executionId: number | string;
  label: string;
  state: ReportEvidenceState;
  mimeType?: string;
  size?: number;
  href?: string;
  expiresAt?: string;
};

export type ReportScenarioSnapshot = {
  revision: number | null;
  hash: string | null;
  source: 'current' | 'manual' | 'automation';
};

export type ReportRunCase = {
  id: number;
  runId: number;
  caseId: number;
  status: string;
  assigneeUserId: number | null;
  assignee: ReportUser | null;
};

export type ReportManualExecution = {
  id: number;
  status: string;
  result: 'passed' | 'failed' | null;
  actorUserId: number;
  actor: ReportUser | null;
  assigneeUserId: number | null;
  assignee: ReportUser | null;
  startedAt: string | null;
  finishedAt: string | null;
  caseRevision: number;
  caseSnapshotHash: string;
  stale: boolean;
  sourceDeleted: boolean;
  correlationId: string | null;
  report: Record<string, string | number> | null;
  evidence: ReportEvidenceRef[];
};

export type ReportAutomationExecution = {
  id: string;
  status: string;
  attempt: number;
  exampleIndex: number | null;
  engine: string | null;
  model: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  errorKind: string | null;
  assigneeUserId: number | null;
  assignee: ReportUser | null;
  correlationId: string | null;
  snapshot: unknown | null;
  snapshotHash: string | null;
  evidence: ReportEvidenceRef[];
};

export type ReportScenario = {
  id: number;
  title: string | null;
  folderId: number | null;
  path: string;
  pathSegments: string[];
  description: string | null;
  preConditions: string | null;
  expectedResults: string | null;
  state: number | null;
  priority: number | null;
  type: number | null;
  automationStatus: number | null;
  template: number | null;
  automationVersion: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  steps: ReportStep[];
  snapshot: ReportScenarioSnapshot;
  stale: boolean;
  deleted: boolean;
  runCase: ReportRunCase | null;
  manual: ReportManualExecution[];
  automation: ReportAutomationExecution[];
  evidence: ReportEvidenceRef[];
};

export type ReportCounts = {
  total: number;
  passed: number;
  failed: number;
  untested: number;
  retest: number;
  skipped: number;
  queued: number;
  running: number;
  error: number;
  cancelled: number;
  unavailable: number;
};

export type ReportModel = {
  project: ReportProject;
  execution: ReportExecution;
  scenarios: ReportScenario[];
  aggregates: {
    manual: ReportCounts;
    automation: ReportCounts;
    combined: 'unavailable';
  };
};

export type ReportEvidenceProbeInput = {
  userId: number;
  projectId: number;
  executionId: number;
  evidenceId: number;
  storageKey: string;
  expectedSha256: string;
  expiresAt: Date;
};

export type ReportEvidenceProbe = (input: ReportEvidenceProbeInput) => Promise<ReportEvidenceState>;

export interface ReportStore {
  build(input: ReportStoreBuildInput): Promise<ReportModel>;
}
