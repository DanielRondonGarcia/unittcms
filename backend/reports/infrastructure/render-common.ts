import { Buffer } from 'node:buffer';
import {
  DEFAULT_REPORT_LIMITS,
  type ReportEvidenceRef,
  type ReportFormat,
  type ReportManualExecution,
  type ReportScenario,
  type ReportStep,
  type ReportUser,
} from '../api/types.js';

export type ReportLocale = 'en' | 'es';

export type ReportEvidenceReadRequest = {
  executionId: number | string;
  evidenceId: number;
};

export type ReportEvidenceReadResult = {
  bytes: Uint8Array;
  mimeType: string;
};

export type ReportEvidenceByteReader = (input: ReportEvidenceReadRequest) => Promise<ReportEvidenceReadResult>;

export type ReportRenderOptions = {
  maxBytes?: number;
  locale?: string;
  evidenceReader?: ReportEvidenceByteReader;
};

export type ReportRenderErrorCode =
  | 'report_render_failed'
  | 'report_output_limit_invalid'
  | 'report_output_limit_exceeded'
  | 'report_output_invalid';

export type ReportCopy = Readonly<{
  locale: ReportLocale;
  title: string;
  coverEyebrow: string;
  coverLead: string;
  project: string;
  execution: string;
  scenarios: string;
  scenario: string;
  scenarioNumber: string;
  titleLabel: string;
  content: string;
  path: string;
  status: string;
  steps: string;
  stepNumber: string;
  action: string;
  expectedResult: string;
  latestManualExecution: string;
  result: string;
  tester: string;
  assignee: string;
  started: string;
  finished: string;
  manualNotes: string;
  failureReason: string;
  howToFix: string;
  reproductionSteps: string;
  evidence: string;
  manualEvidence: string;
  state: string;
  reference: string;
  openEvidence: string;
  notAvailable: string;
  noScenarios: string;
  noSteps: string;
  noManualExecution: string;
  noEvidence: string;
  noReference: string;
  given: string;
  when: string;
  then: string;
  and: string;
  but: string;
  page: string;
  scenarioProgress: (index: number, total: number) => string;
}>;

const COPY: Record<ReportLocale, ReportCopy> = {
  en: {
    locale: 'en',
    title: 'Functional scenario report',
    coverEyebrow: 'Functional testing · execution report',
    coverLead: 'A practical view of the selected execution, its scenarios, steps, and manual evidence.',
    project: 'Project',
    execution: 'Execution',
    scenarios: 'Scenarios',
    scenario: 'Scenario',
    scenarioNumber: 'Scenario number',
    titleLabel: 'Title',
    content: 'Content',
    path: 'Path',
    status: 'Status',
    steps: 'Steps',
    stepNumber: '#',
    action: 'Action',
    expectedResult: 'Expected result',
    latestManualExecution: 'Latest manual execution',
    result: 'Result',
    tester: 'Tested by',
    assignee: 'Assignee',
    started: 'Started',
    finished: 'Finished',
    manualNotes: 'Manual notes',
    failureReason: 'Failure reason',
    howToFix: 'How to fix',
    reproductionSteps: 'Reproduction steps',
    evidence: 'Evidence',
    manualEvidence: 'Manual evidence',
    state: 'State',
    reference: 'Reference',
    openEvidence: 'Open evidence',
    notAvailable: 'Not available',
    noScenarios: 'No scenarios were selected for this report.',
    noSteps: 'No steps were captured for this scenario.',
    noManualExecution: 'No manual execution was recorded for this scenario.',
    noEvidence: 'No manual evidence was captured for this scenario.',
    noReference: 'Reference unavailable',
    given: 'Given',
    when: 'When',
    then: 'Then',
    and: 'And',
    but: 'But',
    page: 'Page',
    scenarioProgress: (index, total) => `Scenario ${index} of ${total}`,
  },
  es: {
    locale: 'es',
    title: 'Informe de escenarios funcionales',
    coverEyebrow: 'Pruebas funcionales · informe de ejecución',
    coverLead: 'Una vista práctica de la ejecución seleccionada, sus escenarios, pasos y evidencias manuales.',
    project: 'Proyecto',
    execution: 'Ejecución',
    scenarios: 'Escenarios',
    scenario: 'Escenario',
    scenarioNumber: 'Número de escenario',
    titleLabel: 'Título',
    content: 'Contenido',
    path: 'Ruta',
    status: 'Estado',
    steps: 'Pasos',
    stepNumber: '#',
    action: 'Acción',
    expectedResult: 'Resultado esperado',
    latestManualExecution: 'Última ejecución manual',
    result: 'Resultado',
    tester: 'Probado por',
    assignee: 'Responsable',
    started: 'Inicio',
    finished: 'Fin',
    manualNotes: 'Notas manuales',
    failureReason: 'Motivo del fallo',
    howToFix: 'Cómo corregirlo',
    reproductionSteps: 'Pasos para reproducirlo',
    evidence: 'Evidencias',
    manualEvidence: 'Evidencias manuales',
    state: 'Estado',
    reference: 'Referencia',
    openEvidence: 'Abrir evidencia',
    notAvailable: 'No disponible',
    noScenarios: 'No se seleccionaron escenarios para este informe.',
    noSteps: 'No se registraron pasos para este escenario.',
    noManualExecution: 'No se registró una ejecución manual para este escenario.',
    noEvidence: 'No se registraron evidencias manuales para este escenario.',
    noReference: 'Referencia no disponible',
    given: 'Dado',
    when: 'Cuando',
    then: 'Entonces',
    and: 'Y',
    but: 'Pero',
    page: 'Página',
    scenarioProgress: (index, total) => `Escenario ${index} de ${total}`,
  },
};

const STATUS_LABELS: Record<ReportLocale, Record<string, string>> = {
  en: {
    available: 'Available',
    expired: 'Expired',
    missing: 'Missing',
    unavailable: 'Unavailable',
    passed: 'Passed',
    failed: 'Failed',
    untested: 'Not tested',
    retest: 'Retest',
    skipped: 'Skipped',
    queued: 'Queued',
    running: 'In progress',
    error: 'Error',
    cancelled: 'Cancelled',
    finished: 'Finished',
    current: 'Current',
    deleted: 'Deleted',
    stale: 'Outdated',
  },
  es: {
    available: 'Disponible',
    expired: 'Expirada',
    missing: 'Faltante',
    unavailable: 'No disponible',
    passed: 'Aprobado',
    failed: 'Fallido',
    untested: 'Sin probar',
    retest: 'Repetir prueba',
    skipped: 'Omitido',
    queued: 'En cola',
    running: 'En progreso',
    error: 'Error',
    cancelled: 'Cancelada',
    finished: 'Finalizada',
    current: 'Actual',
    deleted: 'Eliminado',
    stale: 'Desactualizado',
  },
};

export class ReportRenderError extends Error {
  constructor(
    public readonly format: ReportFormat,
    public readonly code: ReportRenderErrorCode,
    public readonly cause?: unknown
  ) {
    super(`${format} report renderer failed: ${code}`);
    this.name = 'ReportRenderError';
  }
}

export function resolveReportLocale(value: unknown): ReportLocale {
  const firstLanguage = typeof value === 'string' ? value.split(',', 1)[0]?.trim().toLowerCase() : '';
  return firstLanguage === 'es' || firstLanguage.startsWith('es-') ? 'es' : 'en';
}

export function reportCopy(locale?: unknown): ReportCopy {
  return COPY[resolveReportLocale(locale)];
}

export function outputLimit(format: ReportFormat, options: ReportRenderOptions): number {
  const maxBytes = options.maxBytes ?? DEFAULT_REPORT_LIMITS.maxSerializedBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new ReportRenderError(format, 'report_output_limit_invalid');
  return maxBytes;
}

export function assertRenderedOutput(format: ReportFormat, output: Buffer, options: ReportRenderOptions): Buffer {
  const maxBytes = outputLimit(format, options);
  if (output.length > maxBytes) throw new ReportRenderError(format, 'report_output_limit_exceeded');
  return output;
}

export function wrapRenderError(format: ReportFormat, error: unknown): ReportRenderError {
  return error instanceof ReportRenderError && error.format === format
    ? error
    : new ReportRenderError(format, 'report_render_failed', error);
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  return String(value);
}

export function optionalValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function humanValue(value: unknown, copy: ReportCopy): string {
  return value === null || value === undefined || value === '' ? copy.notAvailable : String(value);
}

export function humanStatus(value: unknown, copy: ReportCopy): string {
  if (value === null || value === undefined || value === '') return copy.notAvailable;
  const normalized = String(value).trim().toLowerCase();
  return STATUS_LABELS[resolveReportLocale(copy.locale)]?.[normalized] ?? String(value);
}

export function statusTone(value: unknown): 'positive' | 'negative' | 'warning' | 'info' | 'neutral' {
  const normalized = String(value ?? '').toLowerCase();
  if (/unavailable|not available|untested|not tested|skip|stale|queued|retest/.test(normalized)) return 'warning';
  if (/pass|success|current|available|finished|complete/.test(normalized)) return 'positive';
  if (/fail|error|cancel|deleted|expired|missing/.test(normalized)) return 'negative';
  if (/running|pending|active|in progress/.test(normalized)) return 'info';
  return 'neutral';
}

export function humanStepKeyword(step: Pick<ReportStep, 'keyword'>, copy: ReportCopy): string {
  const keyword = typeof step.keyword === 'string' ? step.keyword.trim().toLowerCase() : '';
  if (keyword === 'given' || keyword === 'when' || keyword === 'then' || keyword === 'and' || keyword === 'but')
    return copy[keyword];
  return copy.steps;
}

export function hasExpectedResults(steps: readonly Pick<ReportStep, 'expectedResult'>[]): boolean {
  return steps.some((step) => typeof step.expectedResult === 'string' && step.expectedResult.trim() !== '');
}

export function humanExpectedResult(value: unknown, copy: ReportCopy): string {
  return typeof value === 'string' && value.trim() !== '' ? value : copy.notAvailable;
}

export function safeEvidenceHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const value = href.trim();
  if (!value || value.startsWith('//')) return undefined;
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalizedTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = new Date(value instanceof Date ? value : String(value)).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareIds(left: unknown, right: unknown): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right));
}

export function latestManualExecution(records: ReportManualExecution[]): ReportManualExecution | null {
  return (
    records
      .map((record, index) => ({ record, index, timestamp: normalizedTimestamp(record.startedAt) }))
      .sort((left, right) => {
        if (left.timestamp === null && right.timestamp !== null) return -1;
        if (left.timestamp !== null && right.timestamp === null) return 1;
        if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp)
          return left.timestamp - right.timestamp;
        return compareIds(left.record.id, right.record.id) || left.index - right.index;
      })
      .at(-1)?.record ?? null
  );
}

export function scenarioStatus(scenario: ReportScenario): unknown {
  const latest = latestManualExecution(scenario.manual);
  return latest?.result ?? latest?.status ?? scenario.runCase?.status ?? null;
}

export function humanUserName(user: ReportUser | null): string | null {
  const name = user?.username ?? user?.email;
  return typeof name === 'string' && name.trim() ? name : null;
}

export function humanDate(value: unknown, copy: ReportCopy): string {
  const timestamp = normalizedTimestamp(value);
  if (timestamp === null) return copy.notAvailable;
  const iso = new Date(timestamp).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function scenarioEvidence(scenario: ReportScenario): ReportEvidenceRef[] {
  const latest = latestManualExecution(scenario.manual);
  if (!latest) return [];

  const result: ReportEvidenceRef[] = [];
  const seen = new Set<string>();
  const append = (items: ReportEvidenceRef[]): void => {
    items.forEach((item) => {
      if (item.source !== 'manual' || String(item.executionId) !== String(latest.id)) return;
      const key = JSON.stringify([
        item.id,
        item.source,
        item.executionId,
        item.label,
        item.state,
        item.mimeType,
        item.size,
        item.href,
        item.expiresAt,
      ]);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
  };

  append(scenario.evidence);
  append(latest.evidence);
  return result;
}

export function manualNoteEntries(record: ReportManualExecution, copy: ReportCopy): Array<readonly [string, string]> {
  if (!record.report) return [];
  const entries: Array<readonly [string, unknown]> = [
    [copy.failureReason, record.report.failureReason],
    [copy.howToFix, record.report.howToFix],
    [copy.reproductionSteps, record.report.reproductionSteps],
  ];
  return entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1] !== '');
}
