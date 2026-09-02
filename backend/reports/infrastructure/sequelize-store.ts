import { Buffer } from 'node:buffer';
import { genericExecutionResultSanitizer } from '../../automation/compatibility/execution-result-safety.js';
import { ReportError } from '../application/service.js';
import type {
  ReportAutomationExecution,
  ReportCounts,
  ReportEvidenceProbe,
  ReportEvidenceRef,
  ReportExecution,
  ReportManualExecution,
  ReportModel,
  ReportProject,
  ReportRunCase,
  ReportScenario,
  ReportScenarioSnapshot,
  ReportStep,
  ReportStore,
  ReportStoreBuildInput,
  ReportUser,
} from '../api/types.js';

type PlainRecord = Record<string, unknown>;
type ModelInstance = PlainRecord & {
  get?: (options?: { plain?: boolean }) => unknown;
  toJSON?: () => unknown;
};
type ModelOptions = { where?: PlainRecord; order?: unknown; attributes?: unknown; transaction?: unknown };
type ModelLike = {
  findByPk(id: unknown, options?: ModelOptions): Promise<unknown>;
  findOne(options?: ModelOptions): Promise<unknown>;
  findAll(options?: ModelOptions): Promise<unknown[]>;
};
type ReportDatabase = {
  transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T>;
};

export type ReportModels = {
  Project: ModelLike;
  Member: ModelLike;
  Folder: ModelLike;
  Case: ModelLike;
  Step?: ModelLike;
  CaseStep?: ModelLike;
  Run: ModelLike;
  RunCase: ModelLike;
  User?: ModelLike;
  ManualExecution?: ModelLike;
  ManualExecutionEvidence?: ModelLike;
  AutomationExecution?: ModelLike;
  AutomationDefinition?: ModelLike;
  ExecutionArtifact?: ModelLike;
};

export type ReportEvidenceHrefInput = {
  source: 'manual' | 'automation';
  executionId: number | string;
  evidenceId: number;
};

export type SequelizeReportStoreOptions = {
  sequelize: ReportDatabase;
  models: ReportModels;
  evidenceProbe?: ReportEvidenceProbe;
  evidenceHref?: (input: ReportEvidenceHrefInput) => string;
  now?: () => Date;
};

const RUN_CASE_STATUS = ['untested', 'passed', 'failed', 'retest', 'skipped'] as const;
const AUTOMATION_STATUS = new Set(['queued', 'running', 'passed', 'failed', 'error', 'cancelled']);
const SNAPSHOT_FIELDS = [
  'id',
  'title',
  'state',
  'priority',
  'type',
  'automationStatus',
  'description',
  'template',
  'automationVersion',
  'preConditions',
  'expectedResults',
  'folderId',
  'gherkinExamples',
  'updatedAt',
  'Steps',
  'steps',
  'feature',
  'version',
  'hash',
] as const;

function plain(value: unknown): PlainRecord | null {
  if (!value || typeof value !== 'object') return null;
  const instance = value as ModelInstance;
  const result = typeof instance.get === 'function' ? instance.get({ plain: true }) : (instance.toJSON?.() ?? instance);
  return result && typeof result === 'object' && !Array.isArray(result) ? (result as PlainRecord) : null;
}

async function findByPk(model: ModelLike | undefined, id: unknown, transaction: unknown): Promise<PlainRecord | null> {
  if (!model) return null;
  return plain(await model.findByPk(id, { transaction }));
}

async function findOne(model: ModelLike | undefined, options: ModelOptions): Promise<PlainRecord | null> {
  if (!model) return null;
  return plain(await model.findOne(options));
}

async function findAll(model: ModelLike | undefined, options: ModelOptions): Promise<PlainRecord[]> {
  if (!model) return [];
  return (await model.findAll(options)).map(plain).filter((value): value is PlainRecord => Boolean(value));
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveValue(value: unknown): number | null {
  const number = numberValue(value);
  return number !== null && number > 0 ? number : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : value === null || value === undefined ? null : String(value);
}

function dateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateObject(value: unknown): Date | null {
  const date =
    value instanceof Date ? new Date(value) : value === null || value === undefined ? null : new Date(String(value));
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function sameId(left: unknown, right: unknown): boolean {
  return String(left) === String(right);
}

function parseObject(value: unknown): PlainRecord | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? (candidate as PlainRecord) : null;
}

function safeSnapshot(value: unknown): PlainRecord | null {
  const source = parseObject(value);
  if (!source) return null;
  return Object.fromEntries(SNAPSHOT_FIELDS.filter((field) => field in source).map((field) => [field, source[field]]));
}

function snapshotSteps(value: unknown): PlainRecord[] {
  const source = parseObject(value);
  const values = source?.Steps ?? source?.steps ?? (Array.isArray(value) ? value : []);
  return Array.isArray(values)
    ? values.map((item) => plain(item)).filter((item): item is PlainRecord => Boolean(item))
    : [];
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareIds(left: unknown, right: unknown): number {
  const leftNumber = numberValue(left);
  const rightNumber = numberValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return compareStrings(String(left), String(right));
}

function compareRecords(left: PlainRecord, right: PlainRecord, dateField: string): number {
  return (
    compareStrings(dateValue(left[dateField]) ?? '', dateValue(right[dateField]) ?? '') || compareIds(left.id, right.id)
  );
}

function latestRecord(records: PlainRecord[], dateField: string): PlainRecord | null {
  return (
    records
      .slice()
      .sort((left, right) => compareRecords(left, right, dateField))
      .at(-1) ?? null
  );
}

function userIdsFrom(value: unknown, ids: Set<number>): void {
  const id = positiveValue(value);
  if (id !== null) ids.add(id);
}

function reportUser(id: number | null, users: Map<number, ReportUser>): ReportUser | null {
  if (id === null) return null;
  return users.get(id) ?? { id };
}

function readReport(value: unknown): Record<string, string | number> | null {
  const source = parseObject(value);
  if (!source || source.version !== 1) return null;
  const result: Record<string, string | number> = { version: 1 };
  for (const field of ['failureReason', 'howToFix', 'reproductionSteps', 'browser', 'environment']) {
    if (typeof source[field] === 'string') result[field] = source[field].trim();
  }
  return Object.keys(result).length > 1 ? result : null;
}

function sanitizedText(value: unknown): string | null {
  return genericExecutionResultSanitizer.text(value);
}

function statusForRunCase(value: unknown): string {
  const index = numberValue(value);
  return index !== null && index >= 0 && index < RUN_CASE_STATUS.length ? RUN_CASE_STATUS[index] : 'unavailable';
}

function emptyCounts(total: number): ReportCounts {
  return {
    total,
    passed: 0,
    failed: 0,
    untested: 0,
    retest: 0,
    skipped: 0,
    queued: 0,
    running: 0,
    error: 0,
    cancelled: 0,
    unavailable: 0,
  };
}

function countStatus(counts: ReportCounts, status: string): void {
  if (status in counts && status !== 'total') {
    counts[status as keyof Omit<ReportCounts, 'total'>] += 1;
  } else {
    counts.unavailable += 1;
  }
}

function aggregate(scenarios: ReportScenario[], source: 'manual' | 'automation'): ReportCounts {
  const counts = emptyCounts(scenarios.length);
  for (const scenario of scenarios) {
    const records = source === 'manual' ? scenario.manual : scenario.automation;
    const latest = latestRecord(records as unknown as PlainRecord[], source === 'manual' ? 'startedAt' : 'queuedAt');
    if (!latest) {
      countStatus(counts, 'untested');
      continue;
    }
    if (source === 'manual') {
      const result = stringValue(latest.result);
      countStatus(counts, result ?? (latest.status === 'running' ? 'running' : 'untested'));
    } else {
      countStatus(counts, String(latest.status));
    }
  }
  return counts;
}

function createPath(folderId: number | null, folders: Map<number, PlainRecord>): string[] {
  if (folderId === null) return [];
  const segments: string[] = [];
  const visited = new Set<number>();
  let currentId: number | null = folderId;
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = folders.get(currentId);
    if (!folder) break;
    const name = stringValue(folder.name);
    if (name) segments.unshift(name);
    currentId = positiveValue(folder.parentFolderId);
  }
  return segments;
}

function mapUserRows(rows: PlainRecord[]): Map<number, ReportUser> {
  const users = new Map<number, ReportUser>();
  for (const row of rows) {
    const id = positiveValue(row.id);
    if (id === null) continue;
    const user: ReportUser = { id };
    if (typeof row.username === 'string') user.username = row.username;
    if (typeof row.email === 'string') user.email = row.email;
    users.set(id, user);
  }
  return users;
}

function mapStep(row: PlainRecord, through: PlainRecord | null, fallbackPosition: number): ReportStep {
  const position = positiveValue(through?.stepNo) ?? fallbackPosition;
  return {
    id: positiveValue(row.id),
    position,
    text: stringValue(row.step) ?? '',
    expectedResult: stringValue(row.result) ?? '',
    keyword: stringValue(through?.keyword),
    section: stringValue(through?.section),
  };
}

function mapSnapshotStep(row: PlainRecord, fallbackPosition: number): ReportStep {
  const through = plain(row.caseSteps ?? row.CaseStep) ?? row;
  return mapStep(row, through, fallbackPosition);
}

function sortSteps(steps: ReportStep[]): ReportStep[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort(
      (left, right) =>
        left.step.position - right.step.position || compareIds(left.step.id, right.step.id) || left.index - right.index
    )
    .map(({ step }) => step);
}

function mapCurrentSteps(
  currentCase: PlainRecord,
  caseSteps: PlainRecord[],
  steps: Map<number, PlainRecord>
): ReportStep[] {
  const id = positiveValue(currentCase.id);
  const linked = caseSteps.filter((row) => id !== null && sameId(row.caseId, id));
  if (linked.length > 0) {
    return sortSteps(
      linked.map((link, index) => mapStep(steps.get(positiveValue(link.stepId) ?? -1) ?? {}, link, index + 1))
    );
  }
  const nested = currentCase.Steps ?? currentCase.steps;
  return Array.isArray(nested)
    ? sortSteps(
        nested
          .map((value) => plain(value))
          .filter((value): value is PlainRecord => Boolean(value))
          .map((row, index) => mapSnapshotStep(row, index + 1))
      )
    : [];
}

function mapSnapshotSteps(snapshot: PlainRecord | null): ReportStep[] {
  return sortSteps(snapshotSteps(snapshot).map((row, index) => mapSnapshotStep(row, index + 1)));
}

function manualStale(record: PlainRecord, current: PlainRecord | null): boolean {
  if (record.staleRevision === true) return true;
  const recordRevision = positiveValue(record.caseRevision);
  const currentRevision = positiveValue(current?.automationVersion);
  return recordRevision !== null && currentRevision !== null && recordRevision !== currentRevision;
}

function snapshotFromManual(record: PlainRecord): PlainRecord | null {
  return safeSnapshot(record.caseSnapshot);
}

function snapshotFromAutomation(record: PlainRecord, definitions: Map<number, PlainRecord>): PlainRecord | null {
  const definition = plain(record.AutomationDefinition) ?? definitions.get(positiveValue(record.definitionId) ?? -1);
  return safeSnapshot(definition?.snapshot ?? record.snapshot);
}

function scenarioBase(
  current: PlainRecord | null,
  manualRows: PlainRecord[],
  automationRows: PlainRecord[],
  definitions: Map<number, PlainRecord>,
  stale: boolean
): { base: PlainRecord; snapshot: ReportScenarioSnapshot } {
  const manual = latestRecord(manualRows, 'startedAt');
  const manualSnapshot = manual ? snapshotFromManual(manual) : null;
  if (manualSnapshot && (stale || !current)) {
    return {
      base: manualSnapshot,
      snapshot: {
        revision: positiveValue(manual?.caseRevision),
        hash: stringValue(manual?.caseSnapshotHash),
        source: 'manual',
      },
    };
  }
  if (current) {
    return {
      base: current,
      snapshot: {
        revision: positiveValue(current.automationVersion),
        hash: null,
        source: 'current',
      },
    };
  }
  const automation = latestRecord(automationRows, 'queuedAt');
  const automationSnapshot = automation ? snapshotFromAutomation(automation, definitions) : null;
  if (automationSnapshot) {
    return {
      base: automationSnapshot,
      snapshot: {
        revision: positiveValue(automationSnapshot.version ?? automationSnapshot.automationVersion),
        hash: stringValue(automation?.snapshotHash),
        source: 'automation',
      },
    };
  }
  const fallback = manual ? snapshotFromManual(manual) : null;
  return {
    base: fallback ?? {},
    snapshot: {
      revision: positiveValue(manual?.caseRevision),
      hash: stringValue(manual?.caseSnapshotHash),
      source: fallback ? 'manual' : 'current',
    },
  };
}

function manualHref(input: ReportEvidenceHrefInput): string {
  return `/manual-executions/${encodeURIComponent(String(input.executionId))}/evidence/${encodeURIComponent(String(input.evidenceId))}`;
}

function automationHref(input: ReportEvidenceHrefInput): string {
  return `/automation/artifacts/${encodeURIComponent(String(input.evidenceId))}/download`;
}

function evidenceState(value: unknown): value is ReportEvidenceRef['state'] {
  return value === 'available' || value === 'expired' || value === 'missing' || value === 'unavailable';
}

export class SequelizeReportStore implements ReportStore {
  private readonly sequelize: ReportDatabase;
  private readonly models: ReportModels;
  private readonly evidenceProbe?: ReportEvidenceProbe;
  private readonly evidenceHref: (input: ReportEvidenceHrefInput) => string;
  private readonly clock: () => Date;

  constructor(options: SequelizeReportStoreOptions) {
    this.sequelize = options.sequelize;
    this.models = options.models;
    this.evidenceProbe = options.evidenceProbe;
    this.evidenceHref =
      options.evidenceHref ?? ((input) => (input.source === 'manual' ? manualHref(input) : automationHref(input)));
    this.clock = options.now ?? (() => new Date());
  }

  async build(input: ReportStoreBuildInput): Promise<ReportModel> {
    const now = dateObject(input.now) ?? this.clock();
    return this.sequelize.transaction((transaction) => this.read({ ...input, now }, transaction));
  }

  private async authorizeProject(projectId: number, userId: number, transaction: unknown): Promise<PlainRecord> {
    const project = await findByPk(this.models.Project, projectId, transaction);
    if (!project) throw new ReportError('project_not_found', 404);
    const ownerId = positiveValue(project.userId);
    if (project.isPublic === true || ownerId === userId) return project;
    const member = await findOne(this.models.Member, { where: { projectId, userId }, transaction });
    if (!member) throw new ReportError('forbidden', 403);
    return project;
  }

  private async read(input: ReportStoreBuildInput, transaction: unknown): Promise<ReportModel> {
    const project = await this.authorizeProject(input.projectId, input.userId, transaction);
    const run = await findByPk(this.models.Run, input.runId, transaction);
    if (!run || !sameId(run.projectId, input.projectId)) throw new ReportError('execution_not_found', 404);

    const folders = await findAll(this.models.Folder, {
      where: { projectId: input.projectId },
      order: [
        ['name', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction,
    });
    const folderById = new Map<number, PlainRecord>();
    for (const folder of folders) {
      const id = positiveValue(folder.id);
      if (id !== null) folderById.set(id, folder);
    }

    const runCaseRows = await findAll(this.models.RunCase, { where: { runId: input.runId }, transaction });
    const runCases = runCaseRows.filter((row) => sameId(row.runId, input.runId));
    const runCaseByCase = new Map<number, PlainRecord>();
    const runCaseById = new Map<number, PlainRecord>();
    for (const row of runCases) {
      const id = positiveValue(row.id);
      const caseId = positiveValue(row.caseId);
      if (id !== null) runCaseById.set(id, row);
      if (caseId !== null && !runCaseByCase.has(caseId)) runCaseByCase.set(caseId, row);
    }

    const currentCaseRows =
      input.selection.mode === 'all'
        ? await findAll(this.models.Case, {
            where: { folderId: [...folderById.keys()] },
            transaction,
          })
        : await findAll(this.models.Case, {
            where: { id: input.selection.scenarioIds },
            transaction,
          });
    const currentCases = new Map<number, PlainRecord>();
    const invalidCurrentIds = new Set<number>();
    for (const row of currentCaseRows) {
      const id = positiveValue(row.id);
      const folderId = positiveValue(row.folderId);
      if (id === null) continue;
      if (folderId === null || !folderById.has(folderId)) {
        invalidCurrentIds.add(id);
        continue;
      }
      currentCases.set(id, row);
    }

    const manualRows = await findAll(this.models.ManualExecution, {
      where: { projectId: input.projectId, runId: input.runId },
      order: [
        ['startedAt', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction,
    });
    const validManualRows = manualRows.filter((row) => {
      const caseId = positiveValue(row.caseId);
      const runCaseId = positiveValue(row.runCaseId);
      return (
        sameId(row.projectId, input.projectId) &&
        sameId(row.runId, input.runId) &&
        caseId !== null &&
        (runCaseId === null || runCaseById.has(runCaseId))
      );
    });

    const automationCandidates =
      runCaseById.size > 0
        ? await findAll(this.models.AutomationExecution, {
            where: { projectId: input.projectId, runCaseId: [...runCaseById.keys()] },
            order: [
              ['queuedAt', 'ASC'],
              ['id', 'ASC'],
            ],
            transaction,
          })
        : [];
    const validAutomationRows = automationCandidates.filter((row) => {
      const runCaseId = positiveValue(row.runCaseId);
      const caseId = positiveValue(row.caseId);
      const runCase = runCaseId === null ? null : runCaseById.get(runCaseId);
      return (
        sameId(row.projectId, input.projectId) &&
        runCase !== null &&
        runCase !== undefined &&
        caseId !== null &&
        sameId(runCase.caseId, caseId)
      );
    });

    const manualCaseIds = validManualRows
      .map((row) => positiveValue(row.caseId))
      .filter((id): id is number => id !== null);
    const automationCaseIds = validAutomationRows
      .map((row) => positiveValue(row.caseId))
      .filter((id): id is number => id !== null);
    const sourceCaseIds = new Set([...manualCaseIds, ...automationCaseIds]);
    let selectedIds: number[];
    if (input.selection.mode === 'explicit') {
      for (const id of input.selection.scenarioIds) {
        if (invalidCurrentIds.has(id) || (!currentCases.has(id) && !sourceCaseIds.has(id)))
          throw new ReportError('scenario_not_found', 404);
      }
      selectedIds = [...input.selection.scenarioIds];
    } else {
      selectedIds = [...new Set([...currentCases.keys(), ...sourceCaseIds])];
    }
    if (selectedIds.length > input.limits.maxScenarios) throw new ReportError('scenario_limit_exceeded', 413);

    const currentCaseIds = [...currentCases.keys()];
    const caseStepRows =
      currentCaseIds.length > 0
        ? await findAll(this.models.CaseStep, { where: { caseId: currentCaseIds }, transaction })
        : [];
    const stepIds = [
      ...new Set(caseStepRows.map((row) => positiveValue(row.stepId)).filter((id): id is number => id !== null)),
    ];
    const stepRows = stepIds.length > 0 ? await findAll(this.models.Step, { where: { id: stepIds }, transaction }) : [];
    const stepsById = new Map<number, PlainRecord>();
    for (const row of stepRows) {
      const id = positiveValue(row.id);
      if (id !== null) stepsById.set(id, row);
    }

    const definitionIds = [
      ...new Set(
        validAutomationRows.map((row) => positiveValue(row.definitionId)).filter((id): id is number => id !== null)
      ),
    ];
    const definitionRows =
      definitionIds.length > 0
        ? await findAll(this.models.AutomationDefinition, { where: { id: definitionIds }, transaction })
        : [];
    const definitions = new Map<number, PlainRecord>();
    for (const row of definitionRows) {
      const id = positiveValue(row.id);
      if (id !== null) definitions.set(id, row);
    }

    const manualIds = validManualRows.map((row) => positiveValue(row.id)).filter((id): id is number => id !== null);
    const manualEvidenceRows =
      manualIds.length > 0
        ? await findAll(this.models.ManualExecutionEvidence, { where: { executionId: manualIds }, transaction })
        : [];
    const automationIds = validAutomationRows
      .map((row) => positiveValue(row.id) ?? stringValue(row.id))
      .filter((id): id is number | string => id !== null);
    const artifactRows =
      automationIds.length > 0
        ? await findAll(this.models.ExecutionArtifact, { where: { executionId: automationIds }, transaction })
        : [];

    const userIds = new Set<number>();
    userIdsFrom(project.userId, userIds);
    for (const row of runCases) userIdsFrom(row.assigneeUserId, userIds);
    for (const row of validManualRows) {
      userIdsFrom(row.actorUserId, userIds);
      userIdsFrom(row.assigneeUserId, userIds);
    }
    for (const row of manualEvidenceRows) userIdsFrom(row.uploaderUserId, userIds);
    const userRows =
      userIds.size > 0 ? await findAll(this.models.User, { where: { id: [...userIds] }, transaction }) : [];
    const users = mapUserRows(userRows);

    const manualEvidenceByExecution = new Map<number, ReportEvidenceRef[]>();
    for (const row of manualEvidenceRows) {
      const executionId = positiveValue(row.executionId);
      const evidenceId = positiveValue(row.id);
      if (executionId === null || evidenceId === null) continue;
      const evidence = await this.mapManualEvidence(row, input, input.now, evidenceId, executionId);
      const items = manualEvidenceByExecution.get(executionId) ?? [];
      items.push(evidence);
      manualEvidenceByExecution.set(executionId, items);
    }

    const automationEvidenceByExecution = new Map<string, ReportEvidenceRef[]>();
    for (const row of artifactRows) {
      const executionId = String(row.executionId ?? '');
      const evidenceId = positiveValue(row.id);
      if (!executionId || evidenceId === null) continue;
      const item: ReportEvidenceRef = {
        id: evidenceId,
        source: 'automation',
        executionId,
        label:
          stringValue(row.filename) ??
          (String(row.storageKey ?? '')
            .split('/')
            .pop() ||
            String(row.kind ?? 'artifact')),
        state: this.artifactState(row.expiresAt, input.now),
        ...(stringValue(row.mimeType) ? { mimeType: stringValue(row.mimeType) as string } : {}),
        ...(positiveValue(row.size) !== null ? { size: positiveValue(row.size) as number } : {}),
      };
      if (item.state === 'available') item.href = this.evidenceHref({ source: 'automation', executionId, evidenceId });
      const items = automationEvidenceByExecution.get(executionId) ?? [];
      items.push(item);
      automationEvidenceByExecution.set(executionId, items);
    }

    const manualByCase = this.groupByCase(validManualRows);
    const automationByCase = this.groupByCase(validAutomationRows);
    const scenarios: ReportScenario[] = [];
    for (const id of selectedIds) {
      const current = currentCases.get(id) ?? null;
      const manual = manualByCase.get(id) ?? [];
      const automation = automationByCase.get(id) ?? [];
      const stale = manual.some((row) => manualStale(row, current));
      const deleted = current === null;
      const baseInfo = scenarioBase(current, manual, automation, definitions, stale || deleted);
      const base = baseInfo.base;
      const folderId = positiveValue(base.folderId) ?? positiveValue(current?.folderId);
      const pathSegments = createPath(folderId, folderById);
      const scenarioManual = manual
        .slice()
        .sort((left, right) => compareRecords(left, right, 'startedAt'))
        .map((row) => this.mapManualExecution(row, users, manualEvidenceByExecution, stale, deleted));
      const scenarioAutomation = automation
        .slice()
        .sort((left, right) => compareRecords(left, right, 'queuedAt'))
        .map((row) =>
          this.mapAutomationExecution(row, users, runCaseByCase, definitions, automationEvidenceByExecution)
        );
      const evidence = [
        ...scenarioManual.flatMap((row) => row.evidence),
        ...scenarioAutomation.flatMap((row) => row.evidence),
      ];
      scenarios.push({
        id,
        title: stringValue(base.title),
        folderId,
        path: pathSegments.join('/'),
        pathSegments,
        description: stringValue(base.description),
        preConditions: stringValue(base.preConditions),
        expectedResults: stringValue(base.expectedResults),
        state: numberValue(base.state),
        priority: numberValue(base.priority),
        type: numberValue(base.type),
        automationStatus: numberValue(base.automationStatus),
        template: numberValue(base.template),
        automationVersion: numberValue(base.automationVersion),
        createdAt: dateValue(base.createdAt),
        updatedAt: dateValue(base.updatedAt),
        steps:
          baseInfo.snapshot.source === 'current'
            ? mapCurrentSteps(current ?? {}, caseStepRows, stepsById)
            : mapSnapshotSteps(base),
        snapshot: baseInfo.snapshot,
        stale: stale || deleted,
        deleted,
        runCase: this.mapRunCase(runCaseByCase.get(id) ?? null, users),
        manual: scenarioManual,
        automation: scenarioAutomation,
        evidence,
      });
    }

    scenarios.sort((left, right) => compareStrings(left.path, right.path) || left.id - right.id);
    const execution: ReportExecution = {
      id: input.runId,
      name: stringValue(run.name) ?? '',
      description: stringValue(run.description),
      state: numberValue(run.state),
      createdAt: dateValue(run.createdAt),
      updatedAt: dateValue(run.updatedAt),
    };
    const projectRef: ReportProject = {
      id: input.projectId,
      name: stringValue(project.name) ?? '',
      detail: stringValue(project.detail),
      isPublic: project.isPublic === true,
      ownerUserId: positiveValue(project.userId) ?? input.projectId,
      ...(dateValue(project.createdAt) !== null ? { createdAt: dateValue(project.createdAt) } : {}),
      ...(dateValue(project.updatedAt) !== null ? { updatedAt: dateValue(project.updatedAt) } : {}),
    };
    const report: ReportModel = {
      project: projectRef,
      execution,
      scenarios,
      aggregates: {
        manual: aggregate(scenarios, 'manual'),
        automation: aggregate(scenarios, 'automation'),
        combined: 'unavailable',
      },
    };
    const serialized = JSON.stringify(report);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > input.limits.maxSerializedBytes)
      throw new ReportError('report_size_exceeded', 413);
    return report;
  }

  private groupByCase(rows: PlainRecord[]): Map<number, PlainRecord[]> {
    const result = new Map<number, PlainRecord[]>();
    for (const row of rows) {
      const caseId = positiveValue(row.caseId);
      if (caseId === null) continue;
      const items = result.get(caseId) ?? [];
      items.push(row);
      result.set(caseId, items);
    }
    return result;
  }

  private mapRunCase(row: PlainRecord | null, users: Map<number, ReportUser>): ReportRunCase | null {
    if (!row) return null;
    const id = positiveValue(row.id);
    const runId = positiveValue(row.runId);
    const caseId = positiveValue(row.caseId);
    if (id === null || runId === null || caseId === null) return null;
    const assigneeUserId = positiveValue(row.assigneeUserId);
    return {
      id,
      runId,
      caseId,
      status: statusForRunCase(row.status),
      assigneeUserId,
      assignee: reportUser(assigneeUserId, users),
    };
  }

  private mapManualExecution(
    row: PlainRecord,
    users: Map<number, ReportUser>,
    evidenceByExecution: Map<number, ReportEvidenceRef[]>,
    stale: boolean,
    deleted: boolean
  ): ReportManualExecution {
    const id = positiveValue(row.id) ?? 0;
    const actorUserId = positiveValue(row.actorUserId) ?? 0;
    const assigneeUserId = positiveValue(row.assigneeUserId);
    const result = row.result === 'passed' || row.result === 'failed' ? row.result : null;
    return {
      id,
      status: stringValue(row.status) ?? 'unavailable',
      result,
      actorUserId,
      actor: reportUser(actorUserId > 0 ? actorUserId : null, users),
      assigneeUserId,
      assignee: reportUser(assigneeUserId, users),
      startedAt: dateValue(row.startedAt),
      finishedAt: dateValue(row.finishedAt),
      caseRevision: positiveValue(row.caseRevision) ?? 1,
      caseSnapshotHash: stringValue(row.caseSnapshotHash) ?? '',
      stale: stale || row.staleRevision === true,
      sourceDeleted: deleted,
      correlationId: stringValue(row.correlationId),
      report: readReport(row.report),
      evidence: evidenceByExecution.get(id) ?? [],
    };
  }

  private mapAutomationExecution(
    row: PlainRecord,
    users: Map<number, ReportUser>,
    runCaseByCase: Map<number, PlainRecord>,
    definitions: Map<number, PlainRecord>,
    evidenceByExecution: Map<string, ReportEvidenceRef[]>
  ): ReportAutomationExecution {
    const id = String(row.id ?? '');
    const caseId = positiveValue(row.caseId);
    const runCase = caseId === null ? null : runCaseByCase.get(caseId);
    const assigneeUserId = positiveValue(runCase?.assigneeUserId);
    const status = String(row.status ?? 'unavailable');
    const safeStatus = AUTOMATION_STATUS.has(status) ? status : 'unavailable';
    const exampleIndex =
      row.exampleIndex === null || row.exampleIndex === undefined ? null : numberValue(row.exampleIndex);
    const snapshot = snapshotFromAutomation(row, definitions);
    return {
      id,
      status: safeStatus,
      attempt: positiveValue(row.attempt) ?? 1,
      exampleIndex,
      engine: stringValue(row.engine),
      model: stringValue(row.model),
      queuedAt: dateValue(row.queuedAt),
      startedAt: dateValue(row.startedAt),
      finishedAt: dateValue(row.finishedAt),
      durationMs: numberValue(row.durationMs),
      summary: sanitizedText(row.summary),
      error: sanitizedText(row.error),
      errorKind: stringValue(row.errorKind),
      assigneeUserId,
      assignee: reportUser(assigneeUserId, users),
      correlationId: stringValue(row.correlationId),
      snapshot,
      snapshotHash: stringValue(row.snapshotHash ?? plain(row.AutomationDefinition)?.snapshotHash),
      evidence: evidenceByExecution.get(id) ?? [],
    };
  }

  private artifactState(expiresAt: unknown, now: Date): ReportEvidenceRef['state'] {
    const expiry = dateObject(expiresAt);
    return expiry && expiry.getTime() <= now.getTime() ? 'expired' : 'available';
  }

  private async mapManualEvidence(
    row: PlainRecord,
    input: ReportStoreBuildInput,
    now: Date,
    evidenceId: number,
    executionId: number
  ): Promise<ReportEvidenceRef> {
    const expiresAt = dateObject(row.expiresAt);
    let state: ReportEvidenceRef['state'];
    if (!stringValue(row.storageKey)) state = 'missing';
    else if (!expiresAt || expiresAt.getTime() <= now.getTime()) state = expiresAt ? 'expired' : 'unavailable';
    else if (!this.evidenceProbe) state = 'unavailable';
    else {
      try {
        const candidate = await this.evidenceProbe({
          userId: input.userId,
          projectId: input.projectId,
          executionId,
          evidenceId,
          storageKey: String(row.storageKey),
          expectedSha256: String(row.sha256 ?? ''),
          expiresAt,
        });
        state = evidenceState(candidate) ? candidate : 'unavailable';
      } catch {
        state = 'unavailable';
      }
    }
    const item: ReportEvidenceRef = {
      id: evidenceId,
      source: 'manual',
      executionId,
      label: stringValue(row.filename) ?? 'evidence',
      state,
      ...(stringValue(row.mimeType) ? { mimeType: stringValue(row.mimeType) as string } : {}),
      ...(positiveValue(row.size) !== null ? { size: positiveValue(row.size) as number } : {}),
      ...(dateValue(row.expiresAt) !== null ? { expiresAt: dateValue(row.expiresAt) as string } : {}),
    };
    if (state === 'available') item.href = this.evidenceHref({ source: 'manual', executionId, evidenceId });
    return item;
  }
}

export function createSequelizeReportStore(options: SequelizeReportStoreOptions): SequelizeReportStore {
  return new SequelizeReportStore(options);
}
