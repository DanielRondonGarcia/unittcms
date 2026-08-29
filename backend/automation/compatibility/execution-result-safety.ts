import type { ExecutorDiagnostics } from '../domain/index.js';
import { redactSecretMaterial } from './diagnostics.js';

const REDACTED = '[REDACTED]';
const MAX_RESULT_TEXT = 10_000;
const MAX_DIAGNOSTIC_TEXT = 16_384;
const MAX_EVENT_MESSAGE = 500;
const MAX_HISTORY_TEXT = 10_000;
const MAX_JSON_DEPTH = 32;

export type ExecutionResultSanitizer = Readonly<{
  text(value: unknown, maxLength?: number): string | null;
  diagnostics(value: unknown): ExecutorDiagnostics | undefined;
  attemptHistory(value: unknown): unknown[];
  eventMessage(value: unknown): string | null;
}>;

function parsedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function boundedRedactedText(value: unknown, maxLength: number, secretValues: readonly string[]): string | null {
  if (value === undefined || value === null) return null;
  let source: string;
  try {
    source = String(value);
  } catch {
    return REDACTED;
  }
  return redactSecretMaterial(source, secretValues).slice(0, maxLength);
}

function boundStructuredValue(value: unknown, depth: number): unknown {
  if (depth > MAX_JSON_DEPTH) return REDACTED;
  if (typeof value === 'string') return value.slice(0, MAX_HISTORY_TEXT);
  if (Array.isArray(value)) return value.map((item) => boundStructuredValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, boundStructuredValue(item, depth + 1)])
  );
}

function sanitizeHistoryValue(value: unknown, secretValues: readonly string[], depth = 0): unknown {
  if (depth > MAX_JSON_DEPTH) return REDACTED;
  if (typeof value === 'string') return boundedRedactedText(value, MAX_HISTORY_TEXT, secretValues);
  if (Array.isArray(value)) return value.map((item) => sanitizeHistoryValue(item, secretValues, depth + 1));
  if (!value || typeof value !== 'object') return value;

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return REDACTED;
    const redacted = redactSecretMaterial(serialized, secretValues);
    return boundStructuredValue(JSON.parse(redacted), depth);
  } catch {
    return REDACTED;
  }
}

function parseHistory(value: unknown): unknown[] {
  const candidate = parsedJson(value);
  return Array.isArray(candidate) ? candidate : [];
}

function diagnostics(value: unknown, secretValues: readonly string[]): ExecutorDiagnostics | undefined {
  const candidate = parsedJson(value);
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const source = candidate as Record<string, unknown>;
  const result: ExecutorDiagnostics = {};
  if (source.exitCode === null || (typeof source.exitCode === 'number' && Number.isSafeInteger(source.exitCode)))
    result.exitCode = source.exitCode;
  if (source.signal === null || (typeof source.signal === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(source.signal)))
    result.signal = source.signal;
  if (typeof source.timedOut === 'boolean') result.timedOut = source.timedOut;
  for (const field of ['stdout', 'stderr'] as const) {
    const text = boundedRedactedText(source[field], MAX_DIAGNOSTIC_TEXT, secretValues);
    if (text) result[field] = text;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function createExecutionResultSanitizer(secretValues: readonly string[] = []): ExecutionResultSanitizer {
  const configuredSecrets = Object.freeze([
    ...new Set(secretValues.filter((value): value is string => typeof value === 'string' && value.length > 0)),
  ]);
  return Object.freeze({
    text: (value: unknown, maxLength = MAX_RESULT_TEXT): string | null =>
      boundedRedactedText(value, maxLength, configuredSecrets),
    diagnostics: (value: unknown): ExecutorDiagnostics | undefined => diagnostics(value, configuredSecrets),
    attemptHistory: (value: unknown): unknown[] =>
      parseHistory(value).map((item) => sanitizeHistoryValue(item, configuredSecrets)),
    eventMessage: (value: unknown): string | null => boundedRedactedText(value, MAX_EVENT_MESSAGE, configuredSecrets),
  });
}

export const genericExecutionResultSanitizer: ExecutionResultSanitizer = createExecutionResultSanitizer();
