import { createHash } from 'node:crypto';

export const EXECUTION_STATES = ['queued', 'running', 'passed', 'failed', 'error', 'cancelled'] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];
export type GherkinKeyword = 'given' | 'when' | 'then';
export type FieldError = { field: string; code: string; message: string };

type SourceStep = {
  id?: number;
  step?: unknown;
  keyword?: unknown;
  stepNo?: unknown;
  caseSteps?: { keyword?: unknown; stepNo?: unknown };
};

export type CaseSource = {
  id?: unknown;
  projectId?: unknown;
  title?: unknown;
  template?: unknown;
  automationVersion?: unknown;
  Steps?: SourceStep[];
  steps?: SourceStep[];
};

export type CanonicalStep = { keyword: GherkinKeyword; text: string; stepNo: number };
export type CanonicalSnapshot = Readonly<{
  caseId: number;
  title: string;
  version: number;
  hash: string;
  feature: string;
  steps: readonly CanonicalStep[];
}>;
export type SnapshotResult = { ok: true; snapshot: CanonicalSnapshot } | { ok: false; errors: FieldError[] };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function field(field: string, code: string, message: string): FieldError {
  return { field, code, message };
}

export function composeCanonicalSnapshot(source: CaseSource): SnapshotResult {
  const errors: FieldError[] = [];
  const caseId = Number(source.id);
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  const version = Number(source.automationVersion ?? 1);

  if (!Number.isInteger(caseId) || caseId <= 0)
    errors.push(field('id', 'required', 'case id must be a positive integer'));
  if (!title || /[\r\n]/.test(title)) errors.push(field('title', 'required', 'title must be a single non-empty line'));
  if (source.template !== undefined && source.template !== 2)
    errors.push(field('template', 'unsupported', 'only Gherkin cases can be automated'));
  if (!Number.isInteger(version) || version < 1)
    errors.push(field('automationVersion', 'invalid', 'version must be a positive integer'));

  const sourceSteps = source.Steps ?? source.steps ?? [];
  if (!Array.isArray(sourceSteps) || sourceSteps.length === 0) {
    errors.push(field('Steps', 'required', 'at least one ordered step is required'));
  }

  const steps: CanonicalStep[] = [];
  const seen = new Set<number>();
  for (const [index, item] of (Array.isArray(sourceSteps) ? sourceSteps : []).entries()) {
    const metadata = item.caseSteps ?? item;
    const stepNo = Number(metadata.stepNo);
    const keyword = typeof metadata.keyword === 'string' ? metadata.keyword.toLowerCase() : '';
    const text = typeof item.step === 'string' ? item.step.trim() : '';
    const prefix = `Steps[${index}]`;
    if (!Number.isInteger(stepNo) || stepNo < 1 || seen.has(stepNo))
      errors.push(field(`${prefix}.caseSteps.stepNo`, 'invalid', 'step order must be unique and positive'));
    else seen.add(stepNo);
    if (!['given', 'when', 'then'].includes(keyword))
      errors.push(field(`${prefix}.caseSteps.keyword`, 'unsupported', 'keyword must be given, when, or then'));
    if (!text || /[\r\n]/.test(text))
      errors.push(field(`${prefix}.step`, 'required', 'step text must be a single non-empty line'));
    if (Number.isInteger(stepNo) && stepNo > 0 && ['given', 'when', 'then'].includes(keyword) && text) {
      steps.push({ keyword: keyword as GherkinKeyword, text, stepNo });
    }
  }

  steps.sort((left, right) => left.stepNo - right.stepNo);
  for (const keyword of ['given', 'when', 'then'] as const) {
    if (!steps.some((step) => step.keyword === keyword))
      errors.push(field('Steps', 'syntax', `at least one ${keyword} step is required`));
  }
  if (errors.length) return { ok: false, errors };

  const feature = [
    `Feature: ${title}`,
    '',
    `  Scenario: ${title}`,
    ...steps.map(({ keyword, text }) => `    ${keyword[0].toUpperCase()}${keyword.slice(1)} ${text}`),
    '',
  ].join('\n');
  const payload = JSON.stringify({ caseId, title, version, steps });
  const snapshot = deepFreeze({
    caseId,
    title,
    version,
    feature,
    steps,
    hash: createHash('sha256').update(payload).digest('hex'),
  });
  return { ok: true, snapshot };
}

export function presentSnapshot(snapshot: CanonicalSnapshot, labels: Record<GherkinKeyword, string>): string {
  return [
    `Feature: ${snapshot.title}`,
    '',
    `  Scenario: ${snapshot.title}`,
    ...snapshot.steps.map(({ keyword, text }) => `    ${labels[keyword]} ${text}`),
    '',
  ].join('\n');
}

type ExecutionRecord = {
  id: string;
  status: ExecutionState;
  attempt: number;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorKind?: 'technical' | 'functional' | 'cancelled';
};

const transitions: Record<ExecutionState, readonly ExecutionState[]> = {
  queued: ['running', 'error', 'cancelled'],
  running: ['passed', 'failed', 'error', 'cancelled'],
  passed: [],
  failed: [],
  error: [],
  cancelled: [],
};

export function transitionExecution<T extends ExecutionRecord>(record: T, status: ExecutionState, now = new Date()): T {
  if (!transitions[record.status].includes(status))
    throw new Error(`invalid transition from ${record.status} to ${status}`);
  const timestamp = now.toISOString();
  const next = { ...record, status } as T;
  if (status === 'running') next.startedAt = record.startedAt ?? timestamp;
  if (['passed', 'failed', 'error', 'cancelled'].includes(status)) {
    next.finishedAt = timestamp;
    const start = Date.parse(next.startedAt ?? next.queuedAt ?? timestamp);
    next.durationMs = Math.max(0, Date.parse(timestamp) - start);
  }
  return next;
}

export function prepareRetry<T extends ExecutionRecord>(record: T, now = new Date()): T {
  if (record.status !== 'error' || record.errorKind !== 'technical' || record.attempt >= 2) return record;
  return {
    ...record,
    status: 'queued',
    attempt: record.attempt + 1,
    queuedAt: now.toISOString(),
    startedAt: undefined,
    finishedAt: undefined,
    durationMs: undefined,
  };
}

export type ExecutorOutcome =
  | 'passed'
  | 'functional_failure'
  | 'technical_error'
  | 'timeout'
  | 'abandoned'
  | 'cancelled';

export function mapExecutorResult(result: { outcome: ExecutorOutcome; summary?: string; error?: string }) {
  const status: ExecutionState =
    result.outcome === 'passed'
      ? 'passed'
      : result.outcome === 'functional_failure'
        ? 'failed'
        : result.outcome === 'cancelled'
          ? 'cancelled'
          : 'error';
  return {
    status,
    summary: result.summary,
    error: result.error,
    errorKind:
      status === 'failed'
        ? 'functional'
        : status === 'cancelled'
          ? 'cancelled'
          : status === 'error'
            ? 'technical'
            : undefined,
  };
}
