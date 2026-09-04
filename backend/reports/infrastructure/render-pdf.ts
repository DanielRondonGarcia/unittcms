import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { MAX_EVIDENCE_BYTES } from '../../manual-execution/infrastructure/storage.js';
import type { ReportEvidenceRef, ReportModel, ReportScenario, ReportStep } from '../api/types.js';
import {
  assertRenderedOutput,
  hasExpectedResults,
  humanDate,
  humanExpectedResult,
  humanStatus,
  humanStepKeyword,
  humanUserName,
  latestManualExecution,
  manualNoteEntries,
  outputLimit,
  reportCopy,
  scenarioEvidence,
  scenarioStatus,
  statusTone,
  type ReportCopy,
  type ReportRenderOptions,
  ReportRenderError,
  wrapRenderError,
} from './render-common.js';

export const PDF_REPORT_CONTENT_TYPE = 'application/pdf';

export type PdfRenderOptions = ReportRenderOptions & {
  fontPath?: string;
};

export const MAX_EMBEDDED_EVIDENCE_BYTES = MAX_EVIDENCE_BYTES;

const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
];

const COLORS = {
  ink: '#17233c',
  navy: '#23456f',
  teal: '#0f766e',
  surface: '#f6f8fb',
  border: '#d7e0ea',
  muted: '#66758a',
  positive: '#0f766e',
  positiveSoft: '#e8f6f1',
  negative: '#b42318',
  negativeSoft: '#fff0ee',
  warning: '#a15c07',
  warningSoft: '#fff6e5',
  infoSoft: '#edf4fb',
  white: '#ffffff',
} as const;

type PdfDocument = InstanceType<typeof PDFDocument>;
type PdfCell = string | PDFKit.Mixins.CellOptions;
type PdfRow = PdfCell[];
type StatusTone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral';
type SupportedEvidenceMime = 'image/png' | 'image/jpeg';

const EVIDENCE_IMAGE_BOX_HEIGHT = 240;
const EVIDENCE_IMAGE_GAP = 12;

function validateReport(report: ReportModel): void {
  try {
    if (JSON.stringify(report) === undefined) throw new ReportRenderError('pdf', 'report_output_invalid');
  } catch (error) {
    throw error instanceof ReportRenderError ? error : new ReportRenderError('pdf', 'report_render_failed', error);
  }
}

function hasUnicode(report: ReportModel): boolean {
  const value = JSON.stringify(report) ?? '';
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

function contentWidth(document: PdfDocument): number {
  return document.page.width - document.page.margins.left - document.page.margins.right;
}

function coverTextHeight(document: PdfDocument, text: string, width: number, fontSize: number): number {
  document.fontSize(fontSize);
  return document.heightOfString(text, { width, align: 'center' });
}

function coverLineHeight(document: PdfDocument, width: number, fontSize: number): number {
  return coverTextHeight(document, 'M', width, fontSize);
}

function coverContext(report: ReportModel, copy: ReportCopy): string {
  return `${copy.project}: ${value(report.project.name, copy)} · ${copy.execution}: ${value(report.execution.name, copy)}`;
}

function coverStartY(
  document: PdfDocument,
  report: ReportModel,
  copy: ReportCopy,
  width: number
): {
  startY: number;
  eyebrowGap: number;
  leadGap: number;
} {
  const eyebrowHeight = coverTextHeight(document, copy.coverEyebrow, width, 8);
  const eyebrowGap = coverLineHeight(document, width, 8) * 0.25;
  const titleHeight = coverTextHeight(document, copy.title, width, 24);
  const leadHeight = coverTextHeight(document, copy.coverLead, width, 10);
  const leadGap = coverLineHeight(document, width, 10) * 0.5;
  const contextHeight = coverTextHeight(document, coverContext(report, copy), width, 9);
  const blockHeight = eyebrowHeight + eyebrowGap + titleHeight + leadHeight + leadGap + contextHeight;
  const contentTop = document.page.margins.top;
  const contentBottom = document.page.height - document.page.margins.bottom;
  const availableHeight = contentBottom - contentTop;
  return {
    startY: contentTop + Math.max(0, (availableHeight - blockHeight) / 2),
    eyebrowGap,
    leadGap,
  };
}

function fitColumnWidths(
  document: PdfDocument,
  columnWidths: readonly (number | string)[] | undefined
): readonly (number | string)[] | undefined {
  if (!columnWidths) return undefined;

  const numericWidths = columnWidths.filter((width): width is number => typeof width === 'number');
  if (numericWidths.length !== columnWidths.length) return columnWidths;

  const availableWidth = contentWidth(document);
  const requestedWidth = numericWidths.reduce((total, width) => total + width, 0);
  if (requestedWidth <= availableWidth || requestedWidth <= 0) return columnWidths;

  const scale = availableWidth / requestedWidth;
  let usedWidth = 0;
  return numericWidths.map((width, index) => {
    if (index === numericWidths.length - 1) return availableWidth - usedWidth;
    const fittedWidth = width * scale;
    usedWidth += fittedWidth;
    return fittedWidth;
  });
}

function value(valueToRender: unknown, copy: ReportCopy): string {
  return valueToRender === null || valueToRender === undefined || valueToRender === ''
    ? copy.notAvailable
    : String(valueToRender);
}

function statusCell(valueToRender: unknown, copy: ReportCopy): PDFKit.Mixins.CellOptions {
  const tone = statusTone(valueToRender);
  const colors: Record<StatusTone, { backgroundColor: string; textColor: string }> = {
    positive: { backgroundColor: COLORS.positiveSoft, textColor: COLORS.positive },
    negative: { backgroundColor: COLORS.negativeSoft, textColor: COLORS.negative },
    warning: { backgroundColor: COLORS.warningSoft, textColor: COLORS.warning },
    info: { backgroundColor: COLORS.infoSoft, textColor: COLORS.navy },
    neutral: { backgroundColor: COLORS.surface, textColor: COLORS.muted },
  };
  return { text: humanStatus(valueToRender, copy), ...colors[tone] };
}

function table(
  document: PdfDocument,
  caption: string,
  headers: readonly string[],
  rows: readonly PdfRow[],
  columnWidths?: readonly (number | string)[]
): void {
  document
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(caption.toUpperCase(), { width: contentWidth(document) })
    .moveDown(0.15);
  const header = headers.map<PDFKit.Mixins.CellOptions>((headerText) => ({
    text: headerText,
    type: 'TH',
    backgroundColor: COLORS.navy,
    textColor: COLORS.white,
    padding: 5,
  }));
  document.table({
    data: [header, ...rows],
    maxWidth: contentWidth(document),
    columnStyles: fitColumnWidths(document, columnWidths)?.map((width) => ({ width })),
    defaultStyle: {
      border: 0.5,
      borderColor: COLORS.border,
      padding: 5,
      textColor: COLORS.ink,
    },
    rowStyles: (row) => (row > 0 && row % 2 === 0 ? { backgroundColor: COLORS.surface } : undefined),
  });
  document.moveDown(0.4);
}

function sectionHeading(document: PdfDocument, text: string): void {
  document
    .fontSize(10.5)
    .fillColor(COLORS.navy)
    .text(text.toUpperCase(), { width: contentWidth(document) });
  const lineY = document.y + 3;
  document
    .save()
    .strokeColor(COLORS.teal)
    .lineWidth(1.2)
    .moveTo(document.page.margins.left, lineY)
    .lineTo(document.page.margins.left + contentWidth(document), lineY)
    .stroke()
    .restore();
  document.moveDown(0.45);
}

function emptyState(document: PdfDocument, text: string): void {
  document
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(text, { width: contentWidth(document) })
    .moveDown(0.35);
}

function drawPageChrome(
  document: PdfDocument,
  report: ReportModel,
  copy: ReportCopy,
  fontPath: string | undefined,
  pageNumber: number
): void {
  const left = document.page.margins.left;
  const width = contentWidth(document);
  document
    .save()
    .font(fontPath ?? 'Helvetica')
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text(`${value(report.project.name, copy)} · ${copy.title}`, left, 22, { width, lineBreak: false })
    .text(`${copy.page} ${pageNumber}`, left, 22, { width, align: 'right', lineBreak: false })
    .strokeColor(COLORS.border)
    .lineWidth(0.5)
    .moveTo(left, 36)
    .lineTo(left + width, 36)
    .stroke()
    .restore();
  document.x = left;
  document.y = document.page.margins.top;
}

function cover(document: PdfDocument, report: ReportModel, copy: ReportCopy): void {
  const left = document.page.margins.left;
  const width = contentWidth(document);
  const layout = coverStartY(document, report, copy, width);
  document.x = left;
  document.y = layout.startY;
  document.fontSize(8).fillColor(COLORS.teal).text(copy.coverEyebrow, { width, align: 'center' });
  document.y += layout.eyebrowGap;
  document.fontSize(24).fillColor(COLORS.navy).text(copy.title, { width, align: 'center' });
  document.fontSize(10).fillColor(COLORS.muted).text(copy.coverLead, { width, align: 'center' });
  document.y += layout.leadGap;
  document.fontSize(9).fillColor(COLORS.ink).text(coverContext(report, copy), { width, align: 'center' });
}

function supportedEvidenceMime(valueToCheck: unknown): valueToCheck is SupportedEvidenceMime {
  return valueToCheck === 'image/png' || valueToCheck === 'image/jpeg';
}

function hasImageMagic(bytes: Buffer, mimeType: SupportedEvidenceMime): boolean {
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function evidenceBuffer(result: unknown): Buffer | null {
  if (!result || typeof result !== 'object') return null;
  const candidate = result as { bytes?: unknown; mimeType?: unknown };
  if (!supportedEvidenceMime(candidate.mimeType) || !(candidate.bytes instanceof Uint8Array)) return null;
  if (candidate.bytes.byteLength === 0 || candidate.bytes.byteLength > MAX_EMBEDDED_EVIDENCE_BYTES) return null;
  const bytes = Buffer.from(candidate.bytes);
  if (bytes.length === 0 || bytes.length > MAX_EMBEDDED_EVIDENCE_BYTES) return null;
  return hasImageMagic(bytes, candidate.mimeType) ? bytes : null;
}

async function readEvidenceImage(
  reader: ReportRenderOptions['evidenceReader'],
  item: ReportEvidenceRef
): Promise<Buffer | null> {
  if (!reader || item.source !== 'manual' || item.state !== 'available') return null;
  if (item.mimeType !== undefined && !supportedEvidenceMime(item.mimeType)) return null;
  try {
    return evidenceBuffer(await reader({ executionId: item.executionId, evidenceId: item.id }));
  } catch {
    return null;
  }
}

function evidenceContentBottom(document: PdfDocument): number {
  return document.page.height - document.page.margins.bottom;
}

async function embedEvidenceImages(
  document: PdfDocument,
  evidence: ReportEvidenceRef[],
  reader: ReportRenderOptions['evidenceReader']
): Promise<void> {
  if (!reader) return;
  for (const item of evidence) {
    const image = await readEvidenceImage(reader, item);
    if (!image) continue;

    const imageHeight = EVIDENCE_IMAGE_BOX_HEIGHT;
    if (document.y + imageHeight + EVIDENCE_IMAGE_GAP > evidenceContentBottom(document)) document.addPage();
    const imageTop = document.y;
    try {
      document.image(image, {
        fit: [contentWidth(document), imageHeight],
        align: 'center',
        valign: 'center',
      });
    } catch {
      document.y = imageTop;
      continue;
    }
    document.y = imageTop + imageHeight + EVIDENCE_IMAGE_GAP;
  }
}

function stepTable(document: PdfDocument, steps: ReportStep[], copy: ReportCopy): void {
  if (steps.length === 0) {
    emptyState(document, copy.noSteps);
    return;
  }
  const includeExpectedResults = hasExpectedResults(steps);
  const headers = [copy.stepNumber, copy.action];
  const columnWidths = includeExpectedResults ? [45, 225, 230] : [45, contentWidth(document) - 45];
  if (includeExpectedResults) headers.push(copy.expectedResult);
  const rows = steps.map<PdfRow>((step) => {
    const row: PdfRow = [value(step.position, copy), `${humanStepKeyword(step, copy)} ${value(step.text, copy)}`];
    if (includeExpectedResults) row.push(humanExpectedResult(step.expectedResult, copy));
    return row;
  });
  table(document, copy.steps, headers, rows, columnWidths);
}

async function manualSection(
  document: PdfDocument,
  scenario: ReportScenario,
  copy: ReportCopy,
  reader: ReportRenderOptions['evidenceReader']
): Promise<void> {
  const latest = latestManualExecution(scenario.manual);
  if (!latest) {
    emptyState(document, copy.noManualExecution);
    return;
  }
  const tester = humanUserName(latest.actor);
  const assignee = humanUserName(latest.assignee);
  const headers = [copy.result, copy.status, copy.tester, copy.assignee, copy.started, copy.finished];
  const row: PdfRow = [
    statusCell(latest.result, copy),
    statusCell(latest.status, copy),
    tester ? tester : copy.notAvailable,
    assignee ? assignee : copy.notAvailable,
    latest.startedAt ? humanDate(latest.startedAt, copy) : copy.notAvailable,
    latest.finishedAt ? humanDate(latest.finishedAt, copy) : copy.notAvailable,
  ];
  table(document, copy.latestManualExecution, headers, [row], [78, 88, 100, 100, 95, 95]);

  const notes = manualNoteEntries(latest, copy);
  if (notes.length > 0)
    table(
      document,
      copy.manualNotes,
      [copy.titleLabel, copy.content],
      notes.map<PdfRow>(([label, content]) => [label, content]),
      [125, 375]
    );
  await embedEvidenceImages(document, scenarioEvidence(scenario), reader);
}

async function scenario(
  document: PdfDocument,
  valueToRender: ReportScenario,
  index: number,
  total: number,
  copy: ReportCopy,
  reader: ReportRenderOptions['evidenceReader']
): Promise<void> {
  if (index > 0) document.addPage();
  document
    .fontSize(8)
    .fillColor(COLORS.teal)
    .text(copy.scenarioProgress(index + 1, total), { width: contentWidth(document) });
  document
    .fontSize(21)
    .fillColor(COLORS.navy)
    .text(`${copy.scenario} ${value(valueToRender.id, copy)} — ${value(valueToRender.title, copy)}`, {
      width: contentWidth(document),
    })
    .moveDown(0.35);

  table(
    document,
    copy.scenario,
    [copy.scenarioNumber, copy.titleLabel, copy.path, copy.status],
    [
      [
        value(valueToRender.id, copy),
        value(valueToRender.title, copy),
        value(valueToRender.path, copy),
        statusCell(scenarioStatus(valueToRender), copy),
      ],
    ],
    [75, 175, 205, 95]
  );

  sectionHeading(document, copy.steps);
  stepTable(document, valueToRender.steps, copy);

  sectionHeading(document, copy.latestManualExecution);
  await manualSection(document, valueToRender, copy, reader);
}

async function writeReport(
  document: PdfDocument,
  report: ReportModel,
  copy: ReportCopy,
  reader: ReportRenderOptions['evidenceReader']
): Promise<void> {
  cover(document, report, copy);
  if (report.scenarios.length === 0) {
    sectionHeading(document, copy.scenarios);
    emptyState(document, copy.noScenarios);
    return;
  }
  document.addPage();
  sectionHeading(document, copy.scenarios);
  for (const [index, scenarioValue] of report.scenarios.entries()) {
    await scenario(document, scenarioValue, index, report.scenarios.length, copy, reader);
  }
}

function createPdf(
  report: ReportModel,
  copy: ReportCopy,
  fontPath: string | undefined,
  reader: ReportRenderOptions['evidenceReader']
): Promise<Buffer> {
  const document = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  let pageNumber = 0;
  document.on('pageAdded', () => {
    pageNumber += 1;
    drawPageChrome(document, report, copy, fontPath, pageNumber);
  });
  return new Promise((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.once('error', reject);
    document.once('end', () => resolve(Buffer.concat(chunks)));
    try {
      document.font(fontPath ?? 'Helvetica').fontSize(9);
      pageNumber += 1;
      drawPageChrome(document, report, copy, fontPath, pageNumber);
      writeReport(document, report, copy, reader)
        .then(() => document.end())
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

export async function renderPdf(report: ReportModel, options: PdfRenderOptions = {}): Promise<Buffer> {
  try {
    outputLimit('pdf', options);
    validateReport(report);
    const copy = reportCopy(options.locale);
    const output = await createPdf(report, copy, resolveFontPath(options.fontPath, report), options.evidenceReader);
    return assertRenderedOutput('pdf', output, options);
  } catch (error) {
    throw wrapRenderError('pdf', error);
  }
}
