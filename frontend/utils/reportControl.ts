import Config from '@/config/config';
import {
  REPORT_FORMATS,
  REPORT_INTENTS,
  type ReportControlInput,
  type ReportFormat,
  type ReportIdentifier,
  type ReportIntent,
  type ReportOutput,
  type ReportRequest,
  type ReportSelection,
  type ReportSelectionInput,
} from '@/types/report';
import { apiErrorFromResponse, isRecord, toApiError, type ApiError } from '@/utils/apiResult';
import { getFilenameFromContentDisposition } from '@/utils/request';

export { REPORT_FORMATS, REPORT_INTENTS };
export const REPORT_SHARED_MESSAGE_KEYS = ['request_error', 'retry', 'correlation_id', 'export'] as const;
export const REPORT_MESSAGE_KEYS = {
  selectionInvalid: 'report_selection_invalid',
  runInvalid: 'report_run_invalid',
  formatInvalid: 'report_format_invalid',
  intentInvalid: 'report_intent_invalid',
  previewFailed: 'report_preview_failed',
  downloadFailed: 'report_download_failed',
  outputInvalid: 'report_output_invalid',
} as const;

export type ReportMessageKey = (typeof REPORT_MESSAGE_KEYS)[keyof typeof REPORT_MESSAGE_KEYS];
export type {
  ReportControlInput,
  ReportFormat,
  ReportIdentifier,
  ReportIntent,
  ReportOutput,
  ReportRequest,
  ReportSelection,
  ReportSelectionInput,
};
export type ReportControlError = ApiError & { messageKey: ReportMessageKey };
export type ReportResult<T> = { ok: true; data: T } | { ok: false; error: ReportControlError };
type ReportPreviewInput = Pick<ReportControlInput, 'selection' | 'runId' | 'locale'>;

const apiServer = Config.apiServer;
const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const MIME_TYPES: Record<ReportFormat, string> = {
  json: 'application/json',
  html: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function positiveId(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function failure<T>(code: string, message: string, messageKey: ReportMessageKey, status = 400): ReportResult<T> {
  return { ok: false, error: { status, code, message, messageKey } as ReportControlError };
}

export function isReportFormat(value: unknown): value is ReportFormat {
  return typeof value === 'string' && (REPORT_FORMATS as readonly string[]).includes(value);
}

export function isReportIntent(value: unknown): value is ReportIntent {
  return typeof value === 'string' && (REPORT_INTENTS as readonly string[]).includes(value);
}

export function reportMessageKey(code: string, intent: ReportIntent = 'download'): ReportMessageKey {
  if (code === 'report_selection_invalid') return REPORT_MESSAGE_KEYS.selectionInvalid;
  if (code === 'report_run_invalid') return REPORT_MESSAGE_KEYS.runInvalid;
  if (code === 'report_format_invalid') return REPORT_MESSAGE_KEYS.formatInvalid;
  if (code === 'report_intent_invalid') return REPORT_MESSAGE_KEYS.intentInvalid;
  if (code === 'report_output_invalid' || code === 'report_output_limit_exceeded')
    return REPORT_MESSAGE_KEYS.outputInvalid;
  return intent === 'preview' ? REPORT_MESSAGE_KEYS.previewFailed : REPORT_MESSAGE_KEYS.downloadFailed;
}

export function normalizeReportSelection(value: unknown): ReportResult<ReportSelection> {
  if (!isRecord(value))
    return failure(
      'report_selection_invalid',
      'The report selection is invalid.',
      REPORT_MESSAGE_KEYS.selectionInvalid
    );
  if (value.mode === 'all') return { ok: true, data: { mode: 'all' } };
  if (value.mode !== 'explicit' || !Array.isArray(value.scenarioIds) || value.scenarioIds.length === 0)
    return failure(
      'report_selection_invalid',
      'Report selection must be all or a non-empty explicit list.',
      REPORT_MESSAGE_KEYS.selectionInvalid
    );

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const scenarioId of value.scenarioIds) {
    const id = positiveId(scenarioId);
    if (id === undefined)
      return failure(
        'report_selection_invalid',
        'Report selection contains an invalid scenario ID.',
        REPORT_MESSAGE_KEYS.selectionInvalid
      );
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ok: true, data: { mode: 'explicit', scenarioIds: ids } };
}

export function buildReportRequest(input: ReportControlInput): ReportResult<ReportRequest> {
  if (!isRecord(input))
    return failure('report_selection_invalid', 'The report request is invalid.', REPORT_MESSAGE_KEYS.selectionInvalid);
  const runId = positiveId(input.runId);
  if (runId === undefined)
    return failure('report_run_invalid', 'A single selected execution is required.', REPORT_MESSAGE_KEYS.runInvalid);
  if (!isReportFormat(input.format))
    return failure(
      'report_format_invalid',
      'Report format must be JSON, HTML, PDF, or DOCX.',
      REPORT_MESSAGE_KEYS.formatInvalid
    );
  if (input.intent !== undefined && !isReportIntent(input.intent))
    return failure(
      'report_intent_invalid',
      'Report intent must be preview or download.',
      REPORT_MESSAGE_KEYS.intentInvalid
    );

  const selection = normalizeReportSelection(input.selection);
  if (!selection.ok) return selection;
  return { ok: true, data: { selection: selection.data, execution: { runId }, format: input.format } };
}

function filename(value: string | null, format: ReportFormat): string {
  const safe = value
    ?.replace(/[\r\n"\\/]/g, '_')
    .trim()
    .slice(0, 255);
  return safe && safe.toLowerCase().endsWith(`.${format}`) ? safe : `project-report.${format}`;
}

function withMessageKey(error: ApiError, intent: ReportIntent): ReportControlError {
  return { ...error, messageKey: reportMessageKey(error.code, intent) };
}

export async function requestReport(
  jwt: string,
  projectId: ReportIdentifier,
  input: ReportControlInput
): Promise<ReportResult<ReportOutput>> {
  const id = positiveId(projectId);
  const intent = input?.intent === undefined ? 'download' : input?.intent;
  if (id === undefined)
    return failure(
      'report_project_invalid',
      'The project ID is invalid.',
      intent === 'preview' ? REPORT_MESSAGE_KEYS.previewFailed : REPORT_MESSAGE_KEYS.downloadFailed
    );
  if (!isReportIntent(intent))
    return failure(
      'report_intent_invalid',
      'Report intent must be preview or download.',
      REPORT_MESSAGE_KEYS.intentInvalid
    );

  const request = buildReportRequest(input);
  if (!request.ok) return request;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    };
    if (typeof input.locale === 'string' && input.locale.trim()) headers['Accept-Language'] = input.locale.trim();
    const response = await fetch(`${apiServer}/projects/${id}/reports`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request.data),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined);
      return { ok: false, error: withMessageKey(apiErrorFromResponse(response, payload), intent) };
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0)
      return failure('report_output_invalid', 'The report response was empty.', REPORT_MESSAGE_KEYS.outputInvalid, 502);
    if (bytes.byteLength > MAX_REPORT_BYTES)
      return failure(
        'report_output_limit_exceeded',
        'The report response exceeds the supported size.',
        REPORT_MESSAGE_KEYS.outputInvalid,
        413
      );

    const format = request.data.format;
    const output: ReportOutput = {
      intent,
      format,
      bytes,
      mimeType: response.headers.get('Content-Type')?.split(';', 1)[0] || MIME_TYPES[format],
      filename: filename(getFilenameFromContentDisposition(response.headers.get('Content-Disposition')), format),
    };
    if (format === 'json' || format === 'html') {
      output.text = new TextDecoder().decode(bytes);
      if (!output.text.trim())
        return failure(
          'report_output_invalid',
          'The report response was empty.',
          REPORT_MESSAGE_KEYS.outputInvalid,
          502
        );
      if (format === 'json') {
        try {
          output.json = JSON.parse(output.text);
        } catch {
          return failure(
            'report_output_invalid',
            'The report JSON response is invalid.',
            REPORT_MESSAGE_KEYS.outputInvalid,
            502
          );
        }
      }
    }
    return { ok: true, data: output };
  } catch (error: unknown) {
    return {
      ok: false,
      error: withMessageKey(toApiError(error, 'The report request could not be completed.'), intent),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function previewReport(
  jwt: string,
  projectId: ReportIdentifier,
  input: ReportPreviewInput
): Promise<ReportResult<ReportOutput>> {
  return requestReport(jwt, projectId, { ...input, format: 'html', intent: 'preview' });
}

export function downloadReport(
  jwt: string,
  projectId: ReportIdentifier,
  input: Omit<ReportControlInput, 'intent'>
): Promise<ReportResult<ReportOutput>> {
  return requestReport(jwt, projectId, { ...input, intent: 'download' });
}
