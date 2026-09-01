export type ApiError = {
  status: number;
  code: string;
  message: string;
  correlationId?: string;
  retryAfterSeconds?: number;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_CODE_LENGTH = 100;
const MAX_CORRELATION_ID_LENGTH = 128;
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;

  const normalized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? ' ' : character;
  })
    .join('')
    .trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function headerValue(response: Response, name: string, maxLength = MAX_MESSAGE_LENGTH): string | undefined {
  try {
    return safeString(response.headers?.get(name) ?? response.headers?.get(name.toLowerCase()), maxLength);
  } catch {
    return undefined;
  }
}

function safeHttpStatus(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_HTTP_STATUS && value <= MAX_HTTP_STATUS
    ? value
    : 0;
}

export function parseRetryAfter(value: string | null | undefined): number | undefined {
  const normalized = safeString(value, 100);
  if (!normalized) return undefined;

  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const retryAt = Date.parse(normalized);
  if (!Number.isFinite(retryAt)) return undefined;

  const remainingSeconds = Math.ceil((retryAt - Date.now()) / 1000);
  return Math.max(0, remainingSeconds);
}

function payloadString(payload: unknown, key: string, maxLength: number): string | undefined {
  return isRecord(payload) ? safeString(payload[key], maxLength) : undefined;
}

function payloadCorrelationId(payload: unknown): string | undefined {
  const correlationId = payloadString(payload, 'correlationId', MAX_CORRELATION_ID_LENGTH);
  return correlationId ?? payloadString(payload, 'correlation_id', MAX_CORRELATION_ID_LENGTH);
}

export function apiErrorFromResponse(response: Response, payload?: unknown): ApiError {
  const status = safeHttpStatus(response.status);
  const message =
    payloadString(payload, 'message', MAX_MESSAGE_LENGTH) ??
    payloadString(payload, 'error', MAX_MESSAGE_LENGTH) ??
    (typeof payload === 'string' ? safeString(payload, MAX_MESSAGE_LENGTH) : undefined) ??
    (status > 0 ? `Request failed with status ${status}.` : 'The request failed.');

  return {
    status,
    code: payloadString(payload, 'code', MAX_CODE_LENGTH) ?? (status > 0 ? `http_${status}` : 'request_failed'),
    message,
    correlationId:
      headerValue(response, 'X-Correlation-Id', MAX_CORRELATION_ID_LENGTH) ?? payloadCorrelationId(payload),
    retryAfterSeconds: parseRetryAfter(headerValue(response, 'Retry-After')),
  };
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

export function toApiError(
  error: unknown,
  fallbackMessage = 'The request could not be completed.',
  codeOverride?: string
): ApiError {
  if (
    isRecord(error) &&
    typeof error.status === 'number' &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return {
      status: safeHttpStatus(error.status),
      code: safeString(error.code, MAX_CODE_LENGTH) ?? 'request_failed',
      message: safeString(error.message, MAX_MESSAGE_LENGTH) ?? fallbackMessage,
      correlationId: safeString(error.correlationId, MAX_CORRELATION_ID_LENGTH),
      retryAfterSeconds:
        typeof error.retryAfterSeconds === 'number' &&
        Number.isFinite(error.retryAfterSeconds) &&
        error.retryAfterSeconds >= 0
          ? Math.ceil(error.retryAfterSeconds)
          : undefined,
    };
  }

  const message = isAbortError(error)
    ? fallbackMessage
    : safeString(error instanceof Error ? error.message : error, 500);
  return {
    status: 0,
    code: codeOverride ?? (isAbortError(error) ? 'timeout' : 'network_error'),
    message: message ?? fallbackMessage,
  };
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  isValid: (value: unknown) => value is T,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => undefined);

    if (!response.ok) return { ok: false, error: apiErrorFromResponse(response, payload) };

    if (!isValid(payload)) {
      return {
        ok: false,
        error: {
          status: safeHttpStatus(response.status),
          code: 'malformed_response',
          message: 'The server returned an invalid response.',
          correlationId:
            headerValue(response, 'X-Correlation-Id', MAX_CORRELATION_ID_LENGTH) ?? payloadCorrelationId(payload),
          retryAfterSeconds: parseRetryAfter(headerValue(response, 'Retry-After')),
        },
      };
    }

    return { ok: true, data: payload };
  } catch (error: unknown) {
    const aborted = isAbortError(error);
    return {
      ok: false,
      error: toApiError(
        error,
        timedOut || aborted ? 'The request timed out.' : 'The API could not be reached.',
        timedOut || aborted ? 'timeout' : undefined
      ),
    };
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}
