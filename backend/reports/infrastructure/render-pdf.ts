import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import type {
  ReportAutomationExecution,
  ReportCounts,
  ReportEvidenceRef,
  ReportManualExecution,
  ReportModel,
  ReportScenario,
} from '../api/types.js';
import {
  assertRenderedOutput,
  displayValue,
  outputLimit,
  safeEvidenceHref,
  type ReportRenderOptions,
  ReportRenderError,
  wrapRenderError,
} from './render-common.js';

export const PDF_REPORT_CONTENT_TYPE = 'application/pdf';

export type PdfRenderOptions = ReportRenderOptions & {
  fontPath?: string;
};

const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
];

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? displayValue(value);
  } catch {
    return 'Unavailable';
  }
}

function validateReport(report: ReportModel, format: 'pdf'): void {
  try {
    if (JSON.stringify(report) === undefined) throw new ReportRenderError(format, 'report_output_invalid');
  } catch (error) {
    throw error instanceof ReportRenderError ? error : new ReportRenderError(format, 'report_render_failed', error);
  }
}

function hasUnicode(report: ReportModel): boolean {
  const value = stringify(report);
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 127) return true;
  }
  return false;
}

function resolveFontPath(fontPath: string | undefined, report: ReportModel): string | undefined {
  if (fontPath) {
    if (!existsSync(fontPath)) throw new Error(`PDF font was not found: ${fontPath}`);
    return fontPath;
  }
  const candidate = FONT_CANDIDATES.find((path) => existsSync(path));
  if (!candidate && hasUnicode(report)) throw new Error('A local Unicode-capable PDF font is required for this report');
  return candidate;
}

type PdfDocument = InstanceType<typeof PDFDocument>;

function width(document: PdfDocument): number {
  return document.page.width - document.page.margins.left - document.page.margins.right;
}

function line(document: PdfDocument, label: string, value: unknown): void {
  document
    .fontSize(9)
    .fillColor('black')
    .text(`${label}: ${displayValue(value)}`, { width: width(document) });
}

function heading(document: PdfDocument, value: string, size = 13): void {
  document
    .fontSize(size)
    .fillColor('black')
    .text(value, { width: width(document) })
    .moveDown(0.2);
}

function fields(document: PdfDocument, entries: ReadonlyArray<readonly [string, unknown]>): void {
  entries.forEach(([label, value]) => line(document, label, value));
}

function userName(user: { username?: string; email?: string } | null, id: number | null): string {
  return user?.username ?? user?.email ?? (id === null ? 'Unavailable' : `User #${id}`);
}

function evidence(document: PdfDocument, item: ReportEvidenceRef): void {
  const href = safeEvidenceHref(item.href);
  const label = `${displayValue(item.source)} evidence #${item.id} for ${displayValue(item.executionId)}: ${displayValue(
    item.label
  )} [${displayValue(item.state)}]${href ? ` - ${href}` : ''}`;
  if (href) {
    document
      .fillColor('blue')
      .text(label, { link: href, underline: true, width: width(document) })
      .fillColor('black');
  } else {
    document.fillColor('black').text(label, { width: width(document) });
  }
}

function manual(document: PdfDocument, record: ReportManualExecution): void {
  fields(document, [
    ['Manual execution', record.id],
    ['Status', record.status],
    ['Result', record.result],
    ['Actor ID', record.actorUserId],
    ['Actor', userName(record.actor, record.actorUserId)],
    ['Assignee ID', record.assigneeUserId],
    ['Assignee', userName(record.assignee, record.assigneeUserId)],
    ['Started', record.startedAt],
    ['Finished', record.finishedAt],
    ['Case revision', record.caseRevision],
    ['Snapshot hash', record.caseSnapshotHash],
    ['Correlation', record.correlationId],
    ['Snapshot', record.stale ? 'stale' : record.sourceDeleted ? 'deleted' : 'current'],
  ]);
  if (record.report) line(document, 'Report details', stringify(record.report));
  record.evidence.forEach((item) => evidence(document, item));
}

function automation(document: PdfDocument, record: ReportAutomationExecution): void {
  fields(document, [
    ['Automation execution', record.id],
    ['Status', record.status],
    ['Attempt', record.attempt],
    ['Example', record.exampleIndex],
    ['Engine', record.engine],
    ['Model', record.model],
    ['Assignee ID', record.assigneeUserId],
    ['Assignee', userName(record.assignee, record.assigneeUserId)],
    ['Queued', record.queuedAt],
    ['Started', record.startedAt],
    ['Finished', record.finishedAt],
    ['Duration ms', record.durationMs],
    ['Summary', record.summary],
    ['Error', record.error],
    ['Error kind', record.errorKind],
    ['Correlation', record.correlationId],
    ['Snapshot hash', record.snapshotHash],
  ]);
  if (record.snapshot) line(document, 'Snapshot details', stringify(record.snapshot));
  record.evidence.forEach((item) => evidence(document, item));
}

function counts(document: PdfDocument, label: string, value: ReportCounts): void {
  heading(document, label, 11);
  fields(document, Object.entries(value));
}

function scenario(document: PdfDocument, value: ReportScenario, index: number): void {
  if (index > 0) document.addPage();
  heading(document, `Scenario ${value.id}: ${displayValue(value.title)}`, 15);
  fields(document, [
    ['Path', value.path],
    ['Folder ID', value.folderId],
    ['State', value.state],
    ['Priority', value.priority],
    ['Type', value.type],
    ['Automation status', value.automationStatus],
    ['Template', value.template],
    ['Automation version', value.automationVersion],
    ['Created', value.createdAt],
    ['Updated', value.updatedAt],
    ['Description', value.description],
    ['Preconditions', value.preConditions],
    ['Expected results', value.expectedResults],
    ['Snapshot source', value.snapshot.source],
    ['Snapshot revision', value.snapshot.revision],
    ['Snapshot hash', value.snapshot.hash],
    ['Stale', value.stale],
    ['Deleted', value.deleted],
  ]);
  if (value.runCase) {
    fields(document, [
      ['Run case ID', value.runCase.id],
      ['Run ID', value.runCase.runId],
      ['Run case scenario ID', value.runCase.caseId],
      ['Run status', value.runCase.status],
      ['Run assignee ID', value.runCase.assigneeUserId],
      ['Run assignee', userName(value.runCase.assignee, value.runCase.assigneeUserId)],
    ]);
  }
  heading(document, 'Steps', 11);
  if (value.steps.length === 0) line(document, 'Steps', 'None');
  value.steps.forEach((step) =>
    line(
      document,
      `Step ${step.position}`,
      `${displayValue(step.keyword)} ${displayValue(step.text)} -> ${displayValue(step.expectedResult)}`
    )
  );
  heading(document, 'Manual source', 11);
  if (value.manual.length === 0) line(document, 'Manual executions', 'None');
  value.manual.forEach((record) => manual(document, record));
  heading(document, 'Automation source', 11);
  if (value.automation.length === 0) line(document, 'Automation executions', 'None');
  value.automation.forEach((record) => automation(document, record));
  heading(document, 'Evidence', 11);
  if (value.evidence.length === 0) line(document, 'Evidence references', 'None');
  value.evidence.forEach((item) => evidence(document, item));
}

function writeReport(document: PdfDocument, report: ReportModel): void {
  heading(document, 'Functional scenario report', 18);
  fields(document, [
    ['Project', report.project.name],
    ['Project ID', report.project.id],
    ['Project detail', report.project.detail],
    ['Project visibility', report.project.isPublic ? 'public' : 'private'],
    ['Project owner ID', report.project.ownerUserId],
    ['Project created', report.project.createdAt],
    ['Project updated', report.project.updatedAt],
    ['Execution', `${report.execution.name} (#${report.execution.id})`],
    ['Execution description', report.execution.description],
    ['Execution state', report.execution.state],
    ['Execution created', report.execution.createdAt],
    ['Execution updated', report.execution.updatedAt],
    ['Scenario count', report.scenarios.length],
  ]);
  heading(document, 'Aggregates', 13);
  counts(document, 'Manual source', report.aggregates.manual);
  counts(document, 'Automation source', report.aggregates.automation);
  line(document, 'Combined', report.aggregates.combined);
  heading(document, 'Scenarios', 13);
  if (report.scenarios.length === 0) line(document, 'Scenarios', 'None');
  report.scenarios.forEach((value, index) => scenario(document, value, index));
}

function createPdf(report: ReportModel, fontPath: string | undefined): Promise<Buffer> {
  const document = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.once('error', reject);
    document.once('end', () => resolve(Buffer.concat(chunks)));
    try {
      document.font(fontPath ?? 'Helvetica').fontSize(9);
      writeReport(document, report);
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}

export async function renderPdf(report: ReportModel, options: PdfRenderOptions = {}): Promise<Buffer> {
  try {
    outputLimit('pdf', options);
    validateReport(report, 'pdf');
    const output = await createPdf(report, resolveFontPath(options.fontPath, report));
    return assertRenderedOutput('pdf', output, options);
  } catch (error) {
    throw wrapRenderError('pdf', error);
  }
}
