import { Buffer } from 'node:buffer';
import {
  DEFAULT_REPORT_LIMITS,
  REPORT_FORMATS,
  type BuildReportInput,
  type ReportLimits,
  type ReportModel,
  type ReportStore,
  type ResolvedReportLimits,
  type NormalizedReportSelection,
} from '../api/types.js';

export { DEFAULT_REPORT_LIMITS } from '../api/types.js';
export type { BuildReportInput, ReportLimits, ReportModel, ReportStore, ResolvedReportLimits } from '../api/types.js';

export class ReportError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly details?: unknown
  ) {
    super(code);
    this.name = 'ReportError';
  }
}

export type ReportServiceOptions = {
  store: ReportStore;
  limits?: ReportLimits;
  now?: () => Date;
};

function positiveId(value: unknown, field: string): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ReportError(`${field}_invalid`);
  return parsed;
}

function positiveLimit(value: unknown, field: string, fallback: number): number {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new ReportError(`${field}_invalid`, 500);
  return candidate;
}

export function resolveReportLimits(limits: ReportLimits = {}): ResolvedReportLimits {
  return {
    maxScenarios: positiveLimit(limits.maxScenarios, 'maxScenarios', DEFAULT_REPORT_LIMITS.maxScenarios),
    maxSelectionIds: positiveLimit(limits.maxSelectionIds, 'maxSelectionIds', DEFAULT_REPORT_LIMITS.maxSelectionIds),
    maxSerializedBytes: positiveLimit(
      limits.maxSerializedBytes,
      'maxSerializedBytes',
      DEFAULT_REPORT_LIMITS.maxSerializedBytes
    ),
  };
}

function normalizeSelection(selection: unknown, limits: ResolvedReportLimits): NormalizedReportSelection {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection))
    throw new ReportError('selection_required');
  const source = selection as { mode?: unknown; scenarioIds?: unknown };
  if (source.mode !== 'all' && source.mode !== 'explicit') throw new ReportError('selection_mode_invalid');

  if (source.mode === 'all') {
    if (source.scenarioIds !== undefined && (!Array.isArray(source.scenarioIds) || source.scenarioIds.length > 0))
      throw new ReportError('selection_invalid');
    return { mode: 'all' };
  }

  if (!Array.isArray(source.scenarioIds) || source.scenarioIds.length === 0) throw new ReportError('selection_empty');
  if (source.scenarioIds.length > limits.maxSelectionIds) throw new ReportError('selection_limit_exceeded', 413);

  const scenarioIds: number[] = [];
  const seen = new Set<number>();
  for (const value of source.scenarioIds) {
    const id = positiveId(value, 'scenario_id');
    if (!seen.has(id)) {
      seen.add(id);
      scenarioIds.push(id);
    }
  }
  return { mode: 'explicit', scenarioIds };
}

function normalizeRequest(input: BuildReportInput, limits: ResolvedReportLimits) {
  if (!input || typeof input !== 'object') throw new ReportError('request_invalid');
  const userId = positiveId(input.userId, 'userId');
  const projectId = positiveId(input.projectId, 'projectId');
  const request = input.request;
  if (!request || typeof request !== 'object') throw new ReportError('request_invalid');
  const runId = positiveId(request.execution?.runId, 'runId');
  if (!REPORT_FORMATS.includes(request.format)) throw new ReportError('format_invalid');
  return { userId, projectId, runId, selection: normalizeSelection(request.selection, limits) };
}

export class ReportService {
  private readonly store: ReportStore;
  private readonly limits: ResolvedReportLimits;
  private readonly now: () => Date;

  constructor(options: ReportServiceOptions) {
    this.store = options.store;
    this.limits = resolveReportLimits(options.limits);
    this.now = options.now ?? (() => new Date());
  }

  async build(input: BuildReportInput): Promise<ReportModel> {
    const normalized = normalizeRequest(input, this.limits);
    const report = await this.store.build({ ...normalized, limits: this.limits, now: this.now() });
    if (report.scenarios.length > this.limits.maxScenarios) throw new ReportError('scenario_limit_exceeded', 413);
    const serialized = JSON.stringify(report);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > this.limits.maxSerializedBytes)
      throw new ReportError('report_size_exceeded', 413);
    return report;
  }
}

export function createReportService(options: ReportServiceOptions): ReportService {
  return new ReportService(options);
}
