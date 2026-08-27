import type { GherkinKeyword, GherkinSection } from './base';

type RunType = {
  id: number;
  name: string;
  configurations: number;
  description: string;
  state: number;
  projectId: number;
  createdAt: string;
  updatedAt: string;
  RunCases?: RunCaseType[];
};

type RunCaseType = {
  id: number;
  runId: number;
  caseId: number;
  status: number;
  editState: 'notChanged' | 'changed' | 'new' | 'deleted';
  createdAt: string;
  updatedAt: string;
  assigneeUserId: number | null;
};

type RunCaseStepType = {
  stepNo: number;
  keyword?: GherkinKeyword | null;
  section?: GherkinSection | null;
};

type RunStatusCountType = {
  status: number;
  count: number;
};

type ProgressSeriesType = {
  name: string;
  data: number[];
};

type RunsMessages = {
  runList: string;
  run: string;
  newRun: string;
  editRun: string;
  deleteRun: string;
  id: string;
  name: string;
  description: string;
  lastUpdate: string;
  actions: string;
  runName: string;
  runDescription: string;
  close: string;
  create: string;
  update: string;
  pleaseEnter: string;
  noRunsFound: string;
  areYouSure: string;
  delete: string;
  actionsAria: string;
  tableAria: string;
};

type RunMessages = {
  backToRuns: string;
  updating: string;
  update: string;
  updatedTestRun: string;
  export: string;
  progress: string;
  refresh: string;
  id: string;
  title: string;
  pleaseEnter: string;
  description: string;
  priority: string;
  status: string;
  actions: string;
  selectTestCase: string;
  testCaseSelection: string;
  includeInRun: string;
  excludeFromRun: string;
  runCaseStatus: string;
  included: string;
  excluded: string;
  runIncludedGherkin: string;
  runGherkinCasesDescription: string;
  runGherkinCasesProgress: string;
  runGherkinCasesSkipped: string;
  runGherkinCasesComplete: string;
  runGherkinCasesError: string;
  automationEnvironment: string;
  automationQueued: string;
  automationRunning: string;
  automationPassed: string;
  automationFailed: string;
  automationError: string;
  automationCancelled: string;
  noCasesFound: string;
  areYouSureLeave: string;
  type: string;
  testDetail: string;
  steps: string;
  preconditions: string;
  expectedResult: string;
  detailsOfTheStep: string;
  close: string;
  filter: string;
  clearAll: string;
  apply: string;
  selectStatus: string;
  pleaseSave: string;
  caseTitleOrDescription: string;
  selected: string;
  tags: string;
  selectTags: string;
  comments: string;
  assignee: string;
  unassigned: string;
  assignTo: string;
  assignedToMe: string;
  assignSelected: string;
  filterByAssignee: string;
  selectAssignee: string;
  searchAssignee: string;
  successTitle: string;
  errorTitle: string;
  saveError: string;
  exportOptions: string;
  expandFolder: string;
  collapseFolder: string;
  testCaseActions: string;
  testCaseSelectActions: string;
  includeExcludeActions: string;
  testCasesTable: string;
  statusFilterAria: string;
  tagFilterAria: string;
  assigneeFilterAria: string;
  selectAssigneeAria: string;
  errorFetchingTags: string;
};

type RunDetailMessages = {
  title: string;
  description: string;
  priority: string;
  type: string;
  tags: string;
  testDetail: string;
  steps: string;
  preconditions: string;
  expectedResult: string;
  detailsOfTheStep: string;
  caseDetail: string;
  comments: string;
  history: string;
  loading: string;
  historyUnavailable: string;
  historyNotice: string;
  options: string;
  given: string;
  when: string;
  then: string;
  and: string;
  but: string;
  background: string;
  scenario: string;
  examples: string;
  noScenarioSteps: string;
  automation: string;
  automationEnvironment: string;
  selectAutomationEnvironment: string;
  noAutomationEnvironments: string;
  runAutomatically: string;
  automationLoading: string;
  automationQueued: string;
  automationRunning: string;
  automationPassed: string;
  automationFailed: string;
  automationError: string;
  automationCancelled: string;
  automationSummary: string;
  automationErrorDetail: string;
  automationDuration: string;
  automationEvidence: string;
  automationHistory: string;
  cancelAutomation: string;
  downloadAutomationArtifact: string;
  automationUnavailable: string;
  automationNoEvidence: string;
  automationHistoryLoading: string;
  automationHistoryEmpty: string;
  automationViewDetail: string;
  automationExecutionDetail: string;
  automationQueuedAt: string;
  automationStartedAt: string;
  automationFinishedAt: string;
  automationAttempt: string;
  automationSnapshot: string;
  automationVideo: string;
  automationBackToHistory: string;
  automationNoVideo: string;
};

export type {
  RunType,
  RunCaseType,
  RunCaseStepType,
  RunStatusCountType,
  ProgressSeriesType,
  RunsMessages,
  RunMessages,
  RunDetailMessages,
};
