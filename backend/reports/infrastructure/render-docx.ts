import { Buffer } from 'node:buffer';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalAlignSection,
  WidthType,
} from 'docx';
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

export const DOCX_REPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const COLORS = {
  ink: '17233C',
  navy: '23456F',
  teal: '0F766E',
  surface: 'F6F8FB',
  border: 'D7E0EA',
  muted: '66758A',
  positive: '0F766E',
  positiveSoft: 'E8F6F1',
  negative: 'B42318',
  negativeSoft: 'FFF0EE',
  warning: 'A15C07',
  warningSoft: 'FFF6E5',
  infoSoft: 'EDF4FB',
  white: 'FFFFFF',
} as const;

const DOCX_CONTENT_WIDTH = 10_400;
const EVIDENCE_IMAGE_BOX_WIDTH = 720;
const EVIDENCE_IMAGE_BOX_HEIGHT = 480;
const MAX_EVIDENCE_IMAGE_DIMENSION = 10_000;
const MAX_EVIDENCE_IMAGE_PIXELS = 50_000_000;
const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
};
const CELL_MARGINS = { marginUnitType: WidthType.DXA, top: 100, bottom: 100, left: 120, right: 120 };

type DocxHeading = (typeof HeadingLevel)[keyof typeof HeadingLevel];
type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];
type StatusTone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral';
type DocxCellValue = {
  text: string;
  tone?: StatusTone;
  fill?: string;
  color?: string;
  bold?: boolean;
};
type DocxRow = DocxCellValue[];
type DocxBlock = Paragraph | Table;
type SupportedEvidenceMime = 'image/png' | 'image/jpeg';
type EvidenceDimensions = { width: number; height: number };
type EvidenceImage = {
  bytes: Buffer;
  mimeType: SupportedEvidenceMime;
  dimensions: EvidenceDimensions;
};

function validateReport(report: ReportModel): void {
  try {
    if (JSON.stringify(report) === undefined) throw new ReportRenderError('docx', 'report_output_invalid');
  } catch (error) {
    throw error instanceof ReportRenderError ? error : new ReportRenderError('docx', 'report_render_failed', error);
  }
}

function value(valueToRender: unknown, copy: ReportCopy): string {
  return valueToRender === null || valueToRender === undefined || valueToRender === ''
    ? copy.notAvailable
    : String(valueToRender);
}

function statusCell(valueToRender: unknown, copy: ReportCopy): DocxCellValue {
  return { text: humanStatus(valueToRender, copy), tone: statusTone(valueToRender) };
}

function toneColors(tone: StatusTone): { fill: string; color: string } {
  return {
    positive: { fill: COLORS.positiveSoft, color: COLORS.positive },
    negative: { fill: COLORS.negativeSoft, color: COLORS.negative },
    warning: { fill: COLORS.warningSoft, color: COLORS.warning },
    info: { fill: COLORS.infoSoft, color: COLORS.navy },
    neutral: { fill: COLORS.surface, color: COLORS.muted },
  }[tone];
}

function cellParagraph(cell: DocxCellValue, isHeader: boolean): Paragraph {
  const colors = cell.tone ? toneColors(cell.tone) : undefined;
  const run = new TextRun({
    text: cell.text,
    bold: isHeader || cell.bold,
    color: cell.color ?? colors?.color ?? (isHeader ? COLORS.white : COLORS.ink),
    size: isHeader ? 16 : 17,
    font: 'Arial',
  });
  return new Paragraph({ children: [run], spacing: { after: 0 }, keepLines: true });
}

function tableCell(cell: DocxCellValue, rowIndex: number, isHeader: boolean, width: number): TableCell {
  const colors = cell.tone ? toneColors(cell.tone) : undefined;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: {
      fill: cell.fill ?? colors?.fill ?? (isHeader ? COLORS.navy : rowIndex % 2 === 1 ? COLORS.surface : COLORS.white),
      type: ShadingType.CLEAR,
    },
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.TOP,
    borders: TABLE_BORDERS,
    children: [cellParagraph(cell, isHeader)],
  });
}

function docxTable(headers: readonly string[], rows: readonly DocxRow[], widths: readonly number[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((header, index) =>
      tableCell({ text: header }, 0, true, widths[index] ?? widths[widths.length - 1])
    ),
  });
  const bodyRows = rows.map(
    (row, rowIndex) =>
      new TableRow({
        children: row.map((cell, cellIndex) =>
          tableCell(cell, rowIndex, false, widths[cellIndex] ?? widths[widths.length - 1])
        ),
      })
  );
  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    margins: CELL_MARGINS,
    tableLook: { firstRow: true, noVBand: true },
  });
}

function tableCaption(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: COLORS.muted, size: 14, font: 'Arial' })],
    spacing: { before: 140, after: 60 },
    keepNext: true,
  });
}

function tableBlock(
  caption: string,
  headers: readonly string[],
  rows: readonly DocxRow[],
  widths: readonly number[]
): DocxBlock[] {
  return [tableCaption(caption), docxTable(headers, rows, widths)];
}

function heading(
  text: string,
  level: DocxHeading = HeadingLevel.HEADING_2,
  pageBreakBefore = false,
  alignment?: DocxAlignment
): Paragraph {
  const size =
    level === HeadingLevel.TITLE
      ? 34
      : level === HeadingLevel.HEADING_1
        ? 23
        : level === HeadingLevel.HEADING_2
          ? 18
          : 16;
  return new Paragraph({
    heading: level,
    pageBreakBefore,
    alignment,
    keepNext: true,
    spacing: { before: level === HeadingLevel.TITLE ? 0 : 220, after: 90 },
    children: [new TextRun({ text, bold: true, color: COLORS.navy, size, font: 'Arial' })],
  });
}

function bodyParagraph(text: string, color: string = COLORS.muted, alignment?: DocxAlignment): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, color, size: 18, font: 'Arial' })],
    alignment,
    spacing: { after: 140 },
  });
}

function emptyState(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, color: COLORS.muted, size: 17, font: 'Arial' })],
    shading: { fill: COLORS.surface, type: ShadingType.CLEAR },
    spacing: { before: 50, after: 140 },
  });
}

function supportedEvidenceMime(valueToCheck: unknown): valueToCheck is SupportedEvidenceMime {
  return valueToCheck === 'image/png' || valueToCheck === 'image/jpeg';
}

function hasImageMagic(bytes: Buffer, mimeType: SupportedEvidenceMime): boolean {
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function safeDimensions(width: number, height: number): EvidenceDimensions | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_EVIDENCE_IMAGE_DIMENSION ||
    height > MAX_EVIDENCE_IMAGE_DIMENSION ||
    width * height > MAX_EVIDENCE_IMAGE_PIXELS
  )
    return null;
  return { width, height };
}

function pngDimensions(bytes: Buffer): EvidenceDimensions | null {
  if (bytes.length < 24 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR')
    return null;
  return safeDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  );
}

function jpegDimensions(bytes: Buffer): EvidenceDimensions | null {
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00) return null;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return null;
      return safeDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

function imageDimensions(bytes: Buffer, mimeType: SupportedEvidenceMime): EvidenceDimensions | null {
  return mimeType === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
}

function evidenceImage(result: unknown): EvidenceImage | null {
  if (!result || typeof result !== 'object') return null;
  const candidate = result as { bytes?: unknown; mimeType?: unknown };
  if (!supportedEvidenceMime(candidate.mimeType) || !(candidate.bytes instanceof Uint8Array)) return null;
  if (candidate.bytes.byteLength === 0 || candidate.bytes.byteLength > MAX_EVIDENCE_BYTES) return null;
  const bytes = Buffer.from(candidate.bytes);
  if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES || !hasImageMagic(bytes, candidate.mimeType)) return null;
  const dimensions = imageDimensions(bytes, candidate.mimeType);
  return dimensions ? { bytes, mimeType: candidate.mimeType, dimensions } : null;
}

async function readEvidenceImage(
  reader: ReportRenderOptions['evidenceReader'],
  item: ReportEvidenceRef
): Promise<EvidenceImage | null> {
  if (!reader || item.source !== 'manual' || item.state !== 'available') return null;
  if (item.mimeType !== undefined && !supportedEvidenceMime(item.mimeType)) return null;
  try {
    const image = evidenceImage(await reader({ executionId: item.executionId, evidenceId: item.id }));
    if (!image || (item.mimeType !== undefined && item.mimeType !== image.mimeType)) return null;
    return image;
  } catch {
    return null;
  }
}

function imageTransformation(dimensions: EvidenceDimensions): { width: number; height: number } {
  const scale = Math.min(EVIDENCE_IMAGE_BOX_WIDTH / dimensions.width, EVIDENCE_IMAGE_BOX_HEIGHT / dimensions.height);
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

async function evidenceImageBlocks(
  evidence: ReportEvidenceRef[],
  reader: ReportRenderOptions['evidenceReader']
): Promise<DocxBlock[]> {
  if (!reader) return [];
  const blocks: DocxBlock[] = [];
  for (const item of evidence) {
    const image = await readEvidenceImage(reader, item);
    if (!image) continue;
    try {
      blocks.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: image.bytes,
              type: image.mimeType === 'image/png' ? 'png' : 'jpg',
              transformation: imageTransformation(image.dimensions),
            }),
          ],
          spacing: { before: 120, after: 120 },
          keepLines: true,
        })
      );
    } catch {
      continue;
    }
  }
  return blocks;
}

function stepBlocks(steps: ReportStep[], copy: ReportCopy): DocxBlock[] {
  if (steps.length === 0) return [emptyState(copy.noSteps)];
  const includeExpectedResults = hasExpectedResults(steps);
  const headers = [copy.stepNumber, copy.action];
  const widths = includeExpectedResults ? [700, 4000, 5700] : [700, DOCX_CONTENT_WIDTH - 700];
  if (includeExpectedResults) headers.push(copy.expectedResult);
  const rows = steps.map<DocxRow>((step) => {
    const row: DocxRow = [
      { text: value(step.position, copy) },
      { text: `${humanStepKeyword(step, copy)} ${value(step.text, copy)}` },
    ];
    if (includeExpectedResults) row.push({ text: humanExpectedResult(step.expectedResult, copy) });
    return row;
  });
  return tableBlock(copy.steps, headers, rows, widths);
}

async function manualBlocks(
  scenario: ReportScenario,
  copy: ReportCopy,
  reader: ReportRenderOptions['evidenceReader']
): Promise<DocxBlock[]> {
  const latest = latestManualExecution(scenario.manual);
  if (!latest) return [emptyState(copy.noManualExecution)];
  const tester = humanUserName(latest.actor);
  const assignee = humanUserName(latest.assignee);
  const row: DocxRow = [
    statusCell(latest.result, copy),
    statusCell(latest.status, copy),
    { text: tester ?? copy.notAvailable },
    { text: assignee ?? copy.notAvailable },
    { text: latest.startedAt ? humanDate(latest.startedAt, copy) : copy.notAvailable },
    { text: latest.finishedAt ? humanDate(latest.finishedAt, copy) : copy.notAvailable },
  ];
  const blocks = tableBlock(
    copy.latestManualExecution,
    [copy.result, copy.status, copy.tester, copy.assignee, copy.started, copy.finished],
    [row],
    [1500, 1500, 2200, 2200, 1500, 1500]
  );
  const notes = manualNoteEntries(latest, copy);
  if (notes.length > 0) {
    blocks.push(
      ...tableBlock(
        copy.manualNotes,
        [copy.titleLabel, copy.content],
        notes.map<DocxRow>(([label, content]) => [{ text: label }, { text: content, fill: COLORS.surface }]),
        [2600, DOCX_CONTENT_WIDTH - 2600]
      )
    );
  }
  blocks.push(...(await evidenceImageBlocks(scenarioEvidence(scenario), reader)));
  return blocks;
}

async function scenario(
  valueToRender: ReportScenario,
  index: number,
  total: number,
  copy: ReportCopy,
  reader: ReportRenderOptions['evidenceReader']
): Promise<DocxBlock[]> {
  const children: DocxBlock[] = [
    heading(
      `${copy.scenario} ${value(valueToRender.id, copy)} — ${value(valueToRender.title, copy)}`,
      HeadingLevel.HEADING_1,
      index > 0
    ),
    bodyParagraph(copy.scenarioProgress(index + 1, total)),
  ];
  children.push(
    ...tableBlock(
      copy.scenario,
      [copy.scenarioNumber, copy.titleLabel, copy.path, copy.status],
      [
        [
          { text: value(valueToRender.id, copy) },
          { text: value(valueToRender.title, copy) },
          { text: value(valueToRender.path, copy) },
          statusCell(scenarioStatus(valueToRender), copy),
        ],
      ],
      [1700, 2700, 3700, 2300]
    )
  );

  children.push(heading(copy.steps, HeadingLevel.HEADING_2));
  children.push(...stepBlocks(valueToRender.steps, copy));

  children.push(heading(copy.latestManualExecution, HeadingLevel.HEADING_2));
  children.push(...(await manualBlocks(valueToRender, copy, reader)));
  return children;
}

function documentHeader(report: ReportModel, copy: ReportCopy): Header {
  return new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: copy.title, bold: true, color: COLORS.navy, size: 14, font: 'Arial' }),
          new TextRun({
            text: `  ·  ${value(report.project.name, copy)}`,
            color: COLORS.muted,
            size: 14,
            font: 'Arial',
          }),
        ],
        spacing: { after: 0 },
      }),
    ],
  });
}

function documentFooter(copy: ReportCopy): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: `${copy.page} `, color: COLORS.muted, size: 14, font: 'Arial' }),
          new TextRun({ children: [PageNumber.CURRENT], color: COLORS.muted, size: 14, font: 'Arial' }),
        ],
      }),
    ],
  });
}

async function documentChildren(
  report: ReportModel,
  copy: ReportCopy,
  reader: ReportRenderOptions['evidenceReader']
): Promise<DocxBlock[]> {
  const children: DocxBlock[] = [heading(copy.scenarios, HeadingLevel.HEADING_1)];
  if (report.scenarios.length === 0) {
    children.push(emptyState(copy.noScenarios));
    return children;
  }
  for (const [index, scenarioValue] of report.scenarios.entries()) {
    children.push(...(await scenario(scenarioValue, index, report.scenarios.length, copy, reader)));
  }
  return children;
}

function coverChildren(report: ReportModel, copy: ReportCopy): DocxBlock[] {
  return [
    heading(copy.title, HeadingLevel.TITLE, false, AlignmentType.CENTER),
    bodyParagraph(copy.coverLead, COLORS.muted, AlignmentType.CENTER),
    bodyParagraph(
      `${copy.project}: ${value(report.project.name, copy)} · ${copy.execution}: ${value(report.execution.name, copy)}`,
      COLORS.ink,
      AlignmentType.CENTER
    ),
  ];
}

export async function renderDocx(report: ReportModel, options: ReportRenderOptions = {}): Promise<Buffer> {
  try {
    outputLimit('docx', options);
    validateReport(report);
    const copy = reportCopy(options.locale);
    const scenarioChildren = await documentChildren(report, copy, options.evidenceReader);
    const header = documentHeader(report, copy);
    const footer = documentFooter(copy);
    const margin = { top: 900, right: 720, bottom: 900, left: 720, header: 420, footer: 420 };
    const document = new Document({
      title: copy.title,
      subject: copy.title,
      sections: [
        {
          headers: { default: header },
          footers: { default: footer },
          properties: {
            page: { margin },
            verticalAlign: VerticalAlignSection.CENTER,
          },
          children: coverChildren(report, copy),
        },
        {
          headers: { default: header },
          footers: { default: footer },
          properties: {
            page: { margin },
            type: SectionType.NEXT_PAGE,
            verticalAlign: VerticalAlignSection.TOP,
          },
          children: scenarioChildren,
        },
      ],
    });
    return assertRenderedOutput('docx', await Packer.toBuffer(document), options);
  } catch (error) {
    throw wrapRenderError('docx', error);
  }
}
