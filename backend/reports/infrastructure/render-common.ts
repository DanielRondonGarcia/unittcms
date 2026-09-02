import { Buffer } from 'node:buffer';
import { DEFAULT_REPORT_LIMITS, type ReportFormat } from '../api/types.js';

export type ReportRenderOptions = {
  maxBytes?: number;
};

export type ReportRenderErrorCode =
  | 'report_render_failed'
  | 'report_output_limit_invalid'
  | 'report_output_limit_exceeded'
  | 'report_output_invalid';

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
