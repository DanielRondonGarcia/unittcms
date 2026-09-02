import { Buffer } from 'node:buffer';
import type { ReportModel } from '../api/types.js';
import {
  assertRenderedOutput,
  outputLimit,
  type ReportRenderOptions,
  ReportRenderError,
  wrapRenderError,
} from './render-common.js';

export const JSON_REPORT_CONTENT_TYPE = 'application/json; charset=utf-8';

export function renderJson(report: ReportModel, options: ReportRenderOptions = {}): Buffer {
  try {
    outputLimit('json', options);
    const serialized = JSON.stringify(report, null, 2);
    if (serialized === undefined) throw new ReportRenderError('json', 'report_output_invalid');
    return assertRenderedOutput('json', Buffer.from(serialized, 'utf8'), options);
  } catch (error) {
    throw wrapRenderError('json', error);
  }
}
