import { createHash } from 'node:crypto';

export const EXECUTION_STATES = ['queued', 'running', 'passed', 'failed', 'error', 'cancelled'] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];
export type GherkinKeyword = 'given' | 'when' | 'then' | 'and' | 'but';
export type GherkinSection = 'background' | 'scenario';
export type FieldError = { field: string; code: string; message: string };

type SourceStep = {
  id?: number;
  step?: unknown;
  keyword?: unknown;
  stepNo?: unknown;
  section?: unknown;
  caseSteps?: { keyword?: unknown; stepNo?: unknown; section?: unknown };
};

export type CaseSource = {
  id?: unknown;
  projectId?: unknown;
  title?: unknown;
  template?: unknown;
  automationVersion?: unknown;
  gherkinExamples?: unknown;
  Steps?: SourceStep[];
  steps?: SourceStep[];
};

export type GherkinExamples = Readonly<{
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}>;
export type CanonicalStep = { keyword: GherkinKeyword; section: GherkinSection; text: string; stepNo: number };
export type CanonicalSnapshot = Readonly<{
  caseId: number;
  title: string;
  version: number;
  hash: string;
  feature: string;
  steps: readonly CanonicalStep[];
  examples: GherkinExamples | null;
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

function normalizeSection(value: unknown): GherkinSection | null {
  if (value === undefined || value === null || value === '') return 'scenario';
  return value === 'background' || value === 'scenario' ? value : null;
}

function normalizeExamples(value: unknown): { examples: GherkinExamples | null; errors: FieldError[] } {
  if (value === undefined || value === null || value === '') return { examples: null, errors: [] };

  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return {
        examples: null,
        errors: [field('gherkinExamples', 'invalid', 'examples must be a valid table object')],
      };
    }
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      examples: null,
      errors: [field('gherkinExamples', 'invalid', 'examples must be a valid table object')],
    };
  }

  const source = candidate as { headers?: unknown; rows?: unknown };
  const headers = source.headers;
  const rows = source.rows;
  const errors: FieldError[] = [];
  const normalizedHeaders =
    Array.isArray(headers) && headers.every((header): header is string => typeof header === 'string')
      ? headers.map((header) => header.trim())
      : [];
  if (!Array.isArray(headers) || headers.length === 0 || headers.some((header) => typeof header !== 'string')) {
    errors.push(field('gherkinExamples.headers', 'invalid', 'examples need one or more string headers'));
  } else if (normalizedHeaders.some((header) => header === '')) {
    errors.push(field('gherkinExamples.headers', 'invalid', 'example headers cannot be empty'));
  } else if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    errors.push(field('gherkinExamples.headers', 'invalid', 'example headers must be unique'));
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    errors.push(field('gherkinExamples.rows', 'invalid', 'examples need one or more data rows'));
  } else if (Array.isArray(headers)) {
    rows.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== headers.length || row.some((cell) => typeof cell !== 'string')) {
        errors.push(
          field(`gherkinExamples.rows[${index}]`, 'invalid', 'each example row must match the header column count')
        );
      }
    });
  }

  if (errors.length) return { examples: null, errors };
  return {
    examples: {
      headers: normalizedHeaders,
      rows: (rows as string[][]).map((row) => [...row]),
    },
    errors: [],
  };
}

function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/\|/g, '\\|');
}

function formatExamples(examples: GherkinExamples): string[] {
  const row = (cells: readonly string[]) => `    | ${cells.map(escapeTableCell).join(' | ')} |`;
  return ['  Examples:', row(examples.headers), ...examples.rows.map(row)];
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
    const value = (item && typeof item === 'object' ? item : {}) as SourceStep;
    const metadata = value.caseSteps ?? value;
    const stepNo = Number(metadata.stepNo);
    const keyword = typeof metadata.keyword === 'string' ? metadata.keyword.toLowerCase() : '';
    const section = normalizeSection(metadata.section ?? value.section);
    const text = typeof value.step === 'string' ? value.step.trim() : '';
    const prefix = `Steps[${index}]`;
    if (!Number.isInteger(stepNo) || stepNo < 1 || seen.has(stepNo))
      errors.push(field(`${prefix}.caseSteps.stepNo`, 'invalid', 'step order must be unique and positive'));
    else seen.add(stepNo);
    if (!['given', 'when', 'then', 'and', 'but'].includes(keyword))
      errors.push(
        field(`${prefix}.caseSteps.keyword`, 'unsupported', 'keyword must be given, when, then, and, or but')
      );
    if (!section)
      errors.push(field(`${prefix}.caseSteps.section`, 'unsupported', 'section must be background or scenario'));
    if (!text || /[\r\n]/.test(text))
      errors.push(field(`${prefix}.step`, 'required', 'step text must be a single non-empty line'));
    if (
      Number.isInteger(stepNo) &&
      stepNo > 0 &&
      ['given', 'when', 'then', 'and', 'but'].includes(keyword) &&
      section &&
      text
    ) {
      steps.push({ keyword: keyword as GherkinKeyword, section, text, stepNo });
    }
  }

  for (const keyword of ['given', 'when', 'then'] as const) {
    if (!steps.some((step) => step.keyword === keyword))
      errors.push(field('Steps', 'syntax', `at least one ${keyword} step is required`));
  }

  const examplesResult = normalizeExamples(source.gherkinExamples);
  errors.push(...examplesResult.errors);
  const normalizedSteps = steps;

  normalizedSteps.sort((left, right) => {
    return left.stepNo - right.stepNo;
  });
  if (errors.length) return { ok: false, errors };

  const scenarioLabel = examplesResult.examples ? 'Scenario Outline' : 'Scenario';
  const stepLine = ({ keyword, text }: CanonicalStep) => `    ${keyword[0].toUpperCase()}${keyword.slice(1)} ${text}`;
  const backgroundSteps = normalizedSteps.filter((step) => step.section === 'background');
  const scenarioSteps = normalizedSteps.filter((step) => step.section === 'scenario');
  const featureLines = [`Feature: ${title}`, ''];
  if (backgroundSteps.length > 0) {
    featureLines.push('  Background:', ...backgroundSteps.map(stepLine), '');
  }
  featureLines.push(`  ${scenarioLabel}: ${title}`, ...scenarioSteps.map(stepLine));
  if (examplesResult.examples) featureLines.push('', ...formatExamples(examplesResult.examples));
  featureLines.push('');
  const feature = featureLines.join('\n');
  const payload = JSON.stringify({ caseId, title, version, steps: normalizedSteps, examples: examplesResult.examples });
  const snapshot = deepFreeze({
    caseId,
    title,
    version,
    feature,
    steps: normalizedSteps,
    examples: examplesResult.examples,
    hash: createHash('sha256').update(payload).digest('hex'),
  });
  return { ok: true, snapshot };
}

export function presentSnapshot(
  snapshot: CanonicalSnapshot,
  labels: Record<GherkinKeyword, string> & Partial<Record<GherkinSection | 'examples', string>>
): string {
  const line = ({ keyword, text }: CanonicalStep) => `    ${labels[keyword]} ${text}`;
  const scenarioLabel = snapshot.examples
    ? `${labels.scenario ?? 'Scenario'} Outline`
    : (labels.scenario ?? 'Scenario');
  const backgroundSteps = snapshot.steps.filter((step) => step.section === 'background');
  const scenarioSteps = snapshot.steps.filter((step) => step.section === 'scenario');
  const lines = [`Feature: ${snapshot.title}`, ''];
  if (backgroundSteps.length > 0) {
    lines.push(`  ${labels.background ?? 'Background'}:`, ...backgroundSteps.map(line), '');
  }
  lines.push(`  ${scenarioLabel}: ${snapshot.title}`, ...scenarioSteps.map(line));
  if (snapshot.examples) {
    lines.push(
      '',
      labels.examples ? `  ${labels.examples}:` : '  Examples:',
      ...formatExamples(snapshot.examples).slice(1)
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function presentExampleSnapshot(snapshot: CanonicalSnapshot, exampleIndex: number): string {
  const examples = snapshot.examples;
  if (!examples || !Number.isInteger(exampleIndex) || exampleIndex < 0 || exampleIndex >= examples.rows.length) {
    throw new Error('example_index_invalid');
  }

  const values = new Map(examples.headers.map((header, index) => [header.trim(), examples.rows[exampleIndex][index]]));
  const substitute = (text: string) =>
    text.replace(/<([^>]+)>/g, (placeholder, header: string) => values.get(header.trim()) ?? placeholder);
  const line = ({ keyword, text }: CanonicalStep) =>
    `    ${keyword[0].toUpperCase()}${keyword.slice(1)} ${substitute(text)}`;
  const backgroundSteps = snapshot.steps.filter((step) => step.section === 'background');
  const scenarioSteps = snapshot.steps.filter((step) => step.section === 'scenario');
  const lines = [`Feature: ${snapshot.title}`, ''];
  if (backgroundSteps.length > 0) lines.push('  Background:', ...backgroundSteps.map(line), '');
  lines.push('  Scenario: ' + snapshot.title, ...scenarioSteps.map(line), '');
  return lines.join('\n');
}

type ExecutionRecord = {
  id: string;
  status: ExecutionState;
  attempt: number;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorKind?: ExecutorErrorKind;
};

export type ExecutorErrorKind = 'technical' | 'functional' | 'cancelled' | 'evidence';

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

export function mapExecutorResult(result: {
  outcome: ExecutorOutcome;
  summary?: string;
  error?: string;
  errorKind?: ExecutorErrorKind;
}) {
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
      result.errorKind ??
      (status === 'failed'
        ? 'functional'
        : status === 'cancelled'
          ? 'cancelled'
          : status === 'error'
            ? 'technical'
            : undefined),
  };
}
