import Config from '@/config/config';
import {
  apiErrorFromResponse,
  isRecord,
  requestJson,
  toApiError,
  type ApiError,
  type ApiResult,
} from '@/utils/apiResult';
import {
  MANUAL_EXECUTION_RESULTS,
  MANUAL_EXECUTION_REPORT_VERSION,
  MANUAL_EXECUTION_STATUSES,
  MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH,
  MAX_MANUAL_EXECUTION_REPORT_LENGTH,
  MAX_MANUAL_EVIDENCE_BYTES,
  type ManualEvidenceDownload,
  type ManualEvidenceView,
  type ManualExecutionReport,
  type ManualExecutionResult,
  type ManualExecutionHistory,
  type ManualExecutionView,
} from '@/types/manualExecution';

const apiServer = Config.apiServer;
const manualExecutionPath = `${apiServer}/manual-executions`;
const REQUEST_TIMEOUT_MS = 15_000;
type Identifier = number | string;

function positiveIdentifier(value: unknown): value is number | string {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Number(value)))
  );
}

function idPath(value: Identifier): string | undefined {
  return positiveIdentifier(value) ? encodeURIComponent(String(value)) : undefined;
}

function invalidInput<T>(code = 'invalid_identifier'): ApiResult<T> {
  return {
    ok: false,
    error: { status: 400, code, message: 'The manual execution request contains invalid input.' },
  };
}

function authHeaders(jwt: string, json = true): HeadersInit {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${jwt}`,
  };
}

function nullableIdentifier(value: unknown): boolean {
  return value === null || positiveIdentifier(value);
}

function isManualExecutionStatus(value: unknown): value is ManualExecutionView['status'] {
  return MANUAL_EXECUTION_STATUSES.includes(value as ManualExecutionView['status']);
}

function isManualExecutionResult(value: unknown): value is ManualExecutionResult {
  return value === null || MANUAL_EXECUTION_RESULTS.includes(value as ManualExecutionResult);
}

export function isManualExecutionView(value: unknown): value is ManualExecutionView {
  return (
    isRecord(value) &&
    positiveIdentifier(value.id) &&
    positiveIdentifier(value.projectId) &&
    nullableIdentifier(value.runId) &&
    nullableIdentifier(value.runCaseId) &&
    nullableIdentifier(value.caseId) &&
    positiveIdentifier(value.actorUserId) &&
    nullableIdentifier(value.assigneeUserId) &&
    isManualExecutionStatus(value.status) &&
    isManualExecutionResult(value.result) &&
    typeof value.startedAt === 'string' &&
    (value.finishedAt === null || typeof value.finishedAt === 'string') &&
    positiveIdentifier(value.caseRevision) &&
    typeof value.caseSnapshotHash === 'string' &&
    typeof value.stale === 'boolean' &&
    typeof value.historical === 'boolean' &&
    typeof value.sourceDeleted === 'boolean' &&
    typeof value.correlationId === 'string' &&
    (value.report === undefined || value.report === null || isManualExecutionReport(value.report))
  );
}

export function isManualExecutionReport(value: unknown): value is ManualExecutionReport {
  if (!isRecord(value) || value.version !== MANUAL_EXECUTION_REPORT_VERSION) return false;
  const fields = ['failureReason', 'howToFix', 'reproductionSteps', 'browser', 'environment'] as const;
  const lengths = fields.map((field) => (typeof value[field] === 'string' ? Array.from(value[field]).length : -1));
  return (
    lengths.every((length) => length >= 0 && length <= MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH) &&
    lengths.reduce((total, length) => total + length, 0) <= MAX_MANUAL_EXECUTION_REPORT_LENGTH
  );
}

export function isManualEvidenceView(value: unknown): value is ManualEvidenceView {
  return (
    isRecord(value) &&
    positiveIdentifier(value.id) &&
    positiveIdentifier(value.executionId) &&
    positiveIdentifier(value.uploaderUserId) &&
    typeof value.filename === 'string' &&
    (value.mimeType === 'image/png' || value.mimeType === 'image/jpeg') &&
    positiveIdentifier(value.size) &&
    typeof value.sha256 === 'string' &&
    typeof value.expiresAt === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function isManualEvidenceList(value: unknown): value is ManualEvidenceView[] {
  return Array.isArray(value) && value.every(isManualEvidenceView);
}

function isManualExecutionHistory(value: unknown): value is ManualExecutionHistory {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isManualExecutionView) &&
    Number.isSafeInteger(value.total) &&
    Number(value.total) >= 0
  );
}

function isEmpty(value: unknown): value is undefined {
  return value === undefined;
}

async function requestBinary(input: RequestInfo | URL, init: RequestInit): Promise<ApiResult<ManualEvidenceDownload>> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined);
      return { ok: false, error: apiErrorFromResponse(response, payload) };
    }
    return {
      ok: true,
      data: {
        bytes: await response.arrayBuffer(),
        mimeType: response.headers.get('Content-Type')?.split(';', 1)[0] || 'application/octet-stream',
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: toApiError(
        error,
        timedOut ? 'The request timed out.' : 'The API could not be reached.',
        timedOut ? 'timeout' : undefined
      ),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function startManualExecution(jwt: string, runCaseId: Identifier): Promise<ApiResult<ManualExecutionView>> {
  const id = idPath(runCaseId);
  if (!id) return Promise.resolve(invalidInput('run_case_id_invalid'));
  return requestJson(
    `${manualExecutionPath}/run-cases/${id}`,
    { method: 'POST', headers: authHeaders(jwt) },
    isManualExecutionView
  );
}

export function fetchActiveManualExecution(
  jwt: string,
  runCaseId: Identifier
): Promise<ApiResult<ManualExecutionView | null>> {
  const id = idPath(runCaseId);
  if (!id) return Promise.resolve(invalidInput('run_case_id_invalid'));
  return requestJson(
    `${manualExecutionPath}/run-cases/${id}/active`,
    { method: 'GET', headers: authHeaders(jwt) },
    isManualExecutionView
  ).then((result) => {
    if (!result.ok && result.error.status === 404 && result.error.code === 'active_execution_not_found') {
      return { ok: true, data: null };
    }
    return result;
  });
}

export function fetchManualExecution(jwt: string, executionId: Identifier): Promise<ApiResult<ManualExecutionView>> {
  const id = idPath(executionId);
  if (!id) return Promise.resolve(invalidInput('execution_id_invalid'));
  return requestJson(
    `${manualExecutionPath}/${id}`,
    { method: 'GET', headers: authHeaders(jwt) },
    isManualExecutionView
  );
}

export function finishManualExecution(
  jwt: string,
  executionId: Identifier,
  result: ManualExecutionResult,
  report?: ManualExecutionReport | null
): Promise<ApiResult<ManualExecutionView>> {
  const id = idPath(executionId);
  if (!id || !MANUAL_EXECUTION_RESULTS.includes(result)) return Promise.resolve(invalidInput('result_invalid'));
  const body: { result: ManualExecutionResult; report?: ManualExecutionReport | null } = { result };
  if (report !== undefined) body.report = report;
  return requestJson(
    `${manualExecutionPath}/${id}/finish`,
    { method: 'POST', headers: authHeaders(jwt), body: JSON.stringify(body) },
    isManualExecutionView
  );
}

export function updateManualExecutionReport(
  jwt: string,
  executionId: Identifier,
  report: ManualExecutionReport | null
): Promise<ApiResult<ManualExecutionView>> {
  const id = idPath(executionId);
  if (!id) return Promise.resolve(invalidInput('execution_id_invalid'));
  return requestJson(
    `${manualExecutionPath}/${id}/report`,
    { method: 'PATCH', headers: authHeaders(jwt), body: JSON.stringify({ report }) },
    isManualExecutionView
  );
}

export function cancelManualExecution(jwt: string, executionId: Identifier): Promise<ApiResult<ManualExecutionView>> {
  const id = idPath(executionId);
  if (!id) return Promise.resolve(invalidInput('execution_id_invalid'));
  return requestJson(
    `${manualExecutionPath}/${id}/cancel`,
    { method: 'POST', headers: authHeaders(jwt) },
    isManualExecutionView
  );
}

export function fetchManualExecutionHistory(
  jwt: string,
  runCaseId: Identifier,
  limit = 20,
  page = 1
): Promise<ApiResult<ManualExecutionHistory>> {
  const id = idPath(runCaseId);
  if (!id) return Promise.resolve(invalidInput('run_case_id_invalid'));
  const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  return requestJson(
    `${manualExecutionPath}/run-cases/${id}/history?page=${safePage}&limit=${safeLimit}`,
    { method: 'GET', headers: authHeaders(jwt, false) },
    isManualExecutionHistory
  );
}

export function listManualEvidence(jwt: string, executionId: Identifier): Promise<ApiResult<ManualEvidenceView[]>> {
  const id = idPath(executionId);
  if (!id) return Promise.resolve(invalidInput('execution_id_invalid'));
  return requestJson(
    `${manualExecutionPath}/${id}/evidence`,
    { method: 'GET', headers: authHeaders(jwt) },
    isManualEvidenceList
  );
}

export function uploadManualEvidence(
  jwt: string,
  executionId: Identifier,
  file: File,
  signal?: AbortSignal
): Promise<ApiResult<ManualEvidenceView>> {
  const id = idPath(executionId);
  if (!id) return Promise.resolve(invalidInput('execution_id_invalid'));
  const body = new FormData();
  body.append('file', file, file.name);
  return requestJson(
    `${manualExecutionPath}/${id}/evidence`,
    { method: 'POST', headers: authHeaders(jwt, false), body, signal },
    isManualEvidenceView
  );
}

export function downloadManualEvidence(
  jwt: string,
  executionId: Identifier,
  evidenceId: Identifier
): Promise<ApiResult<ManualEvidenceDownload>> {
  const execution = idPath(executionId);
  const evidence = idPath(evidenceId);
  if (!execution || !evidence) return Promise.resolve(invalidInput('evidence_id_invalid'));
  return requestBinary(`${manualExecutionPath}/${execution}/evidence/${evidence}`, {
    method: 'GET',
    headers: authHeaders(jwt, false),
  });
}

export function deleteManualEvidence(
  jwt: string,
  executionId: Identifier,
  evidenceId: Identifier
): Promise<ApiResult<undefined>> {
  const execution = idPath(executionId);
  const evidence = idPath(evidenceId);
  if (!execution || !evidence) return Promise.resolve(invalidInput('evidence_id_invalid'));
  return requestJson(
    `${manualExecutionPath}/${execution}/evidence/${evidence}`,
    { method: 'DELETE', headers: authHeaders(jwt, false) },
    isEmpty
  );
}

export function isAllowedManualEvidenceFile(file: File): boolean {
  return file.size <= MAX_MANUAL_EVIDENCE_BYTES && (file.type === 'image/png' || file.type === 'image/jpeg');
}

export function manualEvidenceError(code: string, message: string): ApiError {
  return { status: 400, code, message };
}
