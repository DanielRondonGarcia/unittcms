import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import type {
  ReportAutomationExecution,
  ReportCounts,
  ReportEvidenceRef,
  ReportManualExecution,
  ReportModel,
  ReportScenario,
} from '../api/types.js';
import { renderDocx } from './render-docx.js';
import { renderHtml } from './render-html.js';
import { renderJson } from './render-json.js';
import { latestManualExecution, statusTone, type ReportEvidenceByteReader } from './render-common.js';
import { MAX_EMBEDDED_EVIDENCE_BYTES, renderPdf } from './render-pdf.js';

function counts(overrides: Partial<ReportCounts> = {}): ReportCounts {
  return {
    total: 2,
    passed: 1,
    failed: 1,
    untested: 0,
    retest: 0,
    skipped: 0,
    queued: 0,
    running: 0,
    error: 0,
    cancelled: 0,
    unavailable: 0,
    ...overrides,
  };
}

function evidence(overrides: Partial<ReportEvidenceRef> = {}): ReportEvidenceRef {
  return {
    id: 501,
    source: 'manual',
    executionId: 401,
    label: 'proof.png',
    state: 'available',
    href: '/manual-executions/401/evidence/501',
    ...overrides,
  };
}

function manual(overrides: Partial<ReportManualExecution> = {}): ReportManualExecution {
  return {
    id: 401,
    status: 'finished',
    result: 'passed',
    actorUserId: 7,
    actor: { id: 7, username: 'tester' },
    assigneeUserId: 8,
    assignee: { id: 8, username: 'owner' },
    startedAt: '2026-09-01T10:00:00.000Z',
    finishedAt: '2026-09-01T10:01:00.000Z',
    caseRevision: 3,
    caseSnapshotHash: 'manual-hash',
    stale: false,
    sourceDeleted: false,
    correlationId: 'manual-correlation',
    report: null,
    evidence: [evidence()],
    ...overrides,
  };
}

function automation(overrides: Partial<ReportAutomationExecution> = {}): ReportAutomationExecution {
  return {
    id: 'automation-401',
    status: 'failed',
    attempt: 1,
    exampleIndex: null,
    engine: 'hercules',
    model: 'test-model',
    queuedAt: '2026-09-01T10:02:00.000Z',
    startedAt: '2026-09-01T10:02:01.000Z',
    finishedAt: '2026-09-01T10:02:03.000Z',
    durationMs: 2000,
    summary: 'Automation failed',
    error: 'Expected result did not match',
    errorKind: 'assertion',
    assigneeUserId: 8,
    assignee: { id: 8, username: 'owner' },
    correlationId: 'automation-correlation',
    snapshot: { feature: 'Feature: Alpha' },
    snapshotHash: 'automation-hash',
    evidence: [
      evidence({
        id: 601,
        source: 'automation',
        executionId: 'automation-401',
        label: 'automation.log',
        href: '/automation/artifacts/601/download',
      }),
    ],
    ...overrides,
  };
}

function scenario(overrides: Partial<ReportScenario> = {}): ReportScenario {
  return {
    id: 101,
    title: 'Alpha scenario',
    folderId: 11,
    path: 'Checkout/Alpha',
    pathSegments: ['Checkout', 'Alpha'],
    description: 'Validate the alpha flow',
    preConditions: 'A signed-in user exists',
    expectedResults: 'The order is created',
    state: 0,
    priority: 1,
    type: 4,
    automationStatus: 1,
    template: 0,
    automationVersion: 3,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:30:00.000Z',
    steps: [
      {
        id: 2,
        position: 1,
        text: 'Open the checkout',
        expectedResult: 'Checkout is visible',
        keyword: 'given',
        section: null,
      },
      {
        id: 1,
        position: 3,
        text: 'Submit the order',
        expectedResult: 'Order is created',
        keyword: 'then',
        section: 'scenario',
      },
      {
        id: 3,
        position: 2,
        text: 'Fill in the order details',
        expectedResult: 'The order details are accepted',
        keyword: 'when',
        section: 'scenario',
      },
    ],
    snapshot: { revision: 3, hash: null, source: 'current' },
    stale: false,
    deleted: false,
    runCase: {
      id: 301,
      runId: 201,
      caseId: 101,
      status: 'passed',
      assigneeUserId: 8,
      assignee: { id: 8, username: 'owner' },
    },
    manual: [manual()],
    automation: [automation()],
    evidence: [evidence(), automation().evidence[0]],
    ...overrides,
  };
}

const report: ReportModel = {
  project: {
    id: 1,
    name: 'Reports project',
    detail: 'A client-ready functional scenario report',
    isPublic: false,
    ownerUserId: 8,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T09:30:00.000Z',
  },
  execution: {
    id: 201,
    name: 'Release 1',
    description: 'Selected execution',
    state: 1,
    createdAt: '2026-09-01T08:30:00.000Z',
    updatedAt: '2026-09-01T09:30:00.000Z',
  },
  scenarios: [scenario()],
  aggregates: {
    manual: counts({ total: 99, passed: 98, failed: 1 }),
    automation: counts({ total: 88, passed: 0, failed: 88 }),
    combined: 'unavailable',
  },
};

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

afterEach(() => {
  vi.restoreAllMocks();
});

async function documentParts(output: Buffer) {
  const zip = await JSZip.loadAsync(output);
  const media = await Promise.all(
    Object.keys(zip.files)
      .filter((name) => name.startsWith('word/media/') && !zip.files[name]?.dir)
      .map(async (name) => ({ name, bytes: await zip.file(name)!.async('nodebuffer') }))
  );
  return {
    document: (await zip.file('word/document.xml')?.async('string')) ?? '',
    relationships: (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? '',
    header: (await zip.file('word/header1.xml')?.async('string')) ?? '',
    footer: (await zip.file('word/footer1.xml')?.async('string')) ?? '',
    media,
  };
}

function isPdfEvidenceMetadataTable(options: unknown): boolean {
  const serialized = JSON.stringify(options) ?? '';
  return (
    /proof\.png|manual-executions\/\d+\/evidence\/\d+/i.test(serialized) ||
    (/(?:"text":"Title"|"text":"Título")/.test(serialized) &&
      /(?:"text":"State"|"text":"Estado")/.test(serialized) &&
      /(?:"text":"Reference"|"text":"Referencia")/.test(serialized))
  );
}

function isPdfEvidenceCaption(text: unknown): boolean {
  return text === 'MANUAL EVIDENCE' || text === 'EVIDENCIAS MANUALES';
}

describe('report renderers', () => {
  it('escapes manual note content exactly once in HTML', () => {
    const notedReport = {
      ...report,
      scenarios: [scenario({ manual: [manual({ report: { failureReason: 'A & <B>' } })] })],
    };
    const html = renderHtml(notedReport).toString('utf8');

    expect(html).toContain('<dd>A &amp; &lt;B&gt;</dd>');
    expect(html).not.toContain('A &amp;amp; &amp;lt;B&amp;gt;');
  });

  it('keeps canonical JSON, preserves HTML evidence links, and embeds only validated DOCX evidence images', async () => {
    const json = renderJson(report, { locale: 'es' });
    const html = renderHtml(report).toString('utf8');
    const pdfTableSpy = vi.spyOn(PDFDocument.prototype, 'table');
    const docxReader = vi.fn(async ({ executionId, evidenceId }) => {
      expect({ executionId, evidenceId }).toEqual({ executionId: 401, evidenceId: 501 });
      return { bytes: TINY_PNG, mimeType: 'image/png' };
    });
    const [pdf, docx] = await Promise.all([renderPdf(report), renderDocx(report, { evidenceReader: docxReader })]);
    const parts = await documentParts(docx);
    const pdfTables = pdfTableSpy.mock.calls.map(([options]) => JSON.stringify(options)).join('\n');

    expect(JSON.parse(json.toString('utf8'))).toEqual(report);
    expect(html).toContain('href="/manual-executions/401/evidence/501"');
    expect(html).not.toContain('/automation/artifacts/601/download');
    expect(html).not.toMatch(/metadata|automation|correlation|snapshot hash|actor id|owner id/i);
    expect(pdfTables).not.toContain('proof.png');
    expect(pdfTables).not.toContain('/manual-executions/401/evidence/501');
    expect(pdfTableSpy.mock.calls.some(([options]) => isPdfEvidenceMetadataTable(options))).toBe(false);
    expect(pdfTables).not.toMatch(/automation|correlation|snapshot hash|actor id|owner id/i);
    expect(pdf.toString('latin1')).not.toContain('/manual-executions/401/evidence/501');
    expect(pdf.toString('latin1')).not.toContain('/automation/');
    expect(docxReader).toHaveBeenCalledOnce();
    expect(parts.media.some(({ bytes }) => bytes.equals(TINY_PNG))).toBe(true);
    const imageParagraphs = parts.document.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<w:drawing>[\s\S]*?<\/w:p>/g) ?? [];
    expect(imageParagraphs).toHaveLength(1);
    expect(imageParagraphs[0]).toContain('<w:jc w:val="center"/>');
    expect(imageParagraphs[0]).toMatch(/<wp:extent cx="(\d+)" cy="\1"\s*\/>/);
    expect(parts.document).toContain('Latest manual execution');
    expect(parts.document).toContain('tester');
    expect(parts.document).not.toContain('MANUAL EVIDENCE');
    expect(parts.document).not.toContain('EVIDENCIAS MANUALES');
    expect(parts.document).not.toContain('proof.png');
    expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:State|Estado)<\/w:t>/);
    expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:Reference|Referencia)<\/w:t>/);
    expect(parts.relationships).not.toContain('/manual-executions/401/evidence/501');
    expect(parts.document).not.toMatch(/metadata|automation|correlation|snapshot hash|actor id|owner id/i);
    expect(parts.relationships).not.toContain('/automation/');
  });

  it('embeds a valid manual PNG below manual execution details without evidence metadata', async () => {
    const reader = vi.fn(async ({ executionId, evidenceId }) => {
      expect({ executionId, evidenceId }).toEqual({ executionId: 401, evidenceId: 501 });
      return { bytes: TINY_PNG, mimeType: 'image/png' };
    });
    const imageSpy = vi.spyOn(PDFDocument.prototype, 'image');
    const tableSpy = vi.spyOn(PDFDocument.prototype, 'table');
    const textSpy = vi.spyOn(PDFDocument.prototype, 'text');

    const pdf = await renderPdf(report, { evidenceReader: reader });
    const tableText = tableSpy.mock.calls.map(([options]) => JSON.stringify(options)).join('\n');
    const pdfText = textSpy.mock.calls.map(([text]) => String(text)).join('\n');
    const [bytes, options] = imageSpy.mock.calls[0] ?? [];

    expect(reader).toHaveBeenCalledOnce();
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes).toEqual(TINY_PNG);
    expect(options).toEqual(
      expect.objectContaining({
        fit: [expect.any(Number), expect.any(Number)],
        align: 'center',
        valign: 'center',
      })
    );
    expect(textSpy.mock.calls.some(([text]) => isPdfEvidenceCaption(text))).toBe(false);
    expect(pdfText).not.toContain('proof.png');
    expect(tableText).not.toContain('proof.png');
    expect(tableText).not.toContain('/manual-executions/401/evidence/501');
    expect(tableSpy.mock.calls.some(([tableOptions]) => isPdfEvidenceMetadataTable(tableOptions))).toBe(false);
    expect(pdf.toString('latin1')).not.toContain('/manual-executions/401/evidence/501');
    const manualDetailsTableIndex = tableSpy.mock.calls.findIndex(([tableOptions]) =>
      JSON.stringify(tableOptions).includes('tester')
    );
    expect(imageSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      tableSpy.mock.invocationCallOrder[manualDetailsTableIndex]
    );
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  });

  it('renders no evidence metadata when embedding is unavailable or unsafe', async () => {
    const cases: Array<{
      value: ReportModel;
      reader?: ReportEvidenceByteReader;
    }> = [
      { value: report },
      {
        value: {
          ...report,
          scenarios: [
            scenario({
              evidence: [evidence({ state: 'unavailable' })],
              manual: [manual({ evidence: [evidence({ state: 'unavailable' })] })],
            }),
          ],
        },
        reader: vi.fn(async () => ({ bytes: TINY_PNG, mimeType: 'image/png' })),
      },
      {
        value: {
          ...report,
          scenarios: [
            scenario({
              evidence: [evidence({ mimeType: 'text/plain' })],
              manual: [manual({ evidence: [evidence({ mimeType: 'text/plain' })] })],
            }),
          ],
        },
        reader: vi.fn(async () => ({ bytes: TINY_PNG, mimeType: 'image/png' })),
      },
      {
        value: report,
        reader: vi.fn(async () => {
          throw new Error('reader failed');
        }),
      },
      {
        value: report,
        reader: vi.fn(async () => ({ bytes: TINY_PNG, mimeType: 'image/gif' })),
      },
      {
        value: report,
        reader: vi.fn(async () => ({ bytes: Buffer.alloc(0), mimeType: 'image/png' })),
      },
      {
        value: report,
        reader: vi.fn(async () => ({
          bytes: Buffer.alloc(MAX_EMBEDDED_EVIDENCE_BYTES + 1),
          mimeType: 'image/png',
        })),
      },
    ];
    const imageSpy = vi.spyOn(PDFDocument.prototype, 'image');
    const pdfTextSpy = vi.spyOn(PDFDocument.prototype, 'text');
    const tableSpy = vi.spyOn(PDFDocument.prototype, 'table');

    for (const testCase of cases) {
      const options = testCase.reader ? { evidenceReader: testCase.reader } : {};
      const pdf = await renderPdf(testCase.value, options);
      expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    }

    expect(imageSpy).not.toHaveBeenCalled();
    expect(pdfTextSpy.mock.calls.some(([text]) => isPdfEvidenceCaption(text))).toBe(false);
    expect(pdfTextSpy.mock.calls.map(([text]) => String(text)).join('\n')).not.toContain('proof.png');
    expect(pdfTextSpy.mock.calls.map(([text]) => String(text)).join('\n')).not.toContain(
      '/manual-executions/401/evidence/501'
    );
    expect(tableSpy.mock.calls.some(([options]) => isPdfEvidenceMetadataTable(options))).toBe(false);
    expect(cases[1].reader).not.toHaveBeenCalled();
    expect(cases[2].reader).not.toHaveBeenCalled();
    expect(cases[3].reader).toHaveBeenCalledOnce();
    expect(cases[4].reader).toHaveBeenCalledOnce();
    expect(cases[5].reader).toHaveBeenCalledOnce();
    expect(cases[6].reader).toHaveBeenCalledOnce();
  });

  it('keeps DOCX valid and omits evidence metadata when manual images are unavailable or unsafe', async () => {
    const noManualReader = vi.fn(async () => ({ bytes: TINY_PNG, mimeType: 'image/png' }));
    const unavailableReader = vi.fn(async () => ({ bytes: TINY_PNG, mimeType: 'image/png' }));
    const unsupportedReader = vi.fn(async () => ({ bytes: TINY_PNG, mimeType: 'image/png' }));
    const rejectedReader = vi.fn(async () => {
      throw new Error('reader rejected');
    });
    const invalidMimeReader = vi.fn(async () => ({ bytes: TINY_PNG, mimeType: 'image/gif' }));
    const emptyReader = vi.fn(async () => ({ bytes: Buffer.alloc(0), mimeType: 'image/png' }));
    const oversizedReader = vi.fn(async () => ({
      bytes: Buffer.alloc(MAX_EMBEDDED_EVIDENCE_BYTES + 1),
      mimeType: 'image/png',
    }));
    const invalidMagicBytes = Buffer.from(TINY_PNG);
    invalidMagicBytes[0] = 0;
    const invalidMagicReader = vi.fn(async () => ({ bytes: invalidMagicBytes, mimeType: 'image/png' }));
    const invalidDimensionsBytes = Buffer.from(TINY_PNG);
    invalidDimensionsBytes.writeUInt32BE(0, 16);
    const invalidDimensionsReader = vi.fn(async () => ({
      bytes: invalidDimensionsBytes,
      mimeType: 'image/png',
    }));
    const noManualReport = {
      ...report,
      scenarios: [scenario({ manual: [], evidence: [] })],
    };
    const unavailableReport = {
      ...report,
      scenarios: [
        scenario({
          evidence: [evidence({ state: 'unavailable' })],
          manual: [manual({ evidence: [evidence({ state: 'unavailable' })] })],
        }),
      ],
    };
    const unsupportedReport = {
      ...report,
      scenarios: [
        scenario({
          evidence: [evidence({ mimeType: 'text/plain' })],
          manual: [manual({ evidence: [evidence({ mimeType: 'text/plain' })] })],
        }),
      ],
    };
    const cases: Array<{ value: ReportModel; reader?: ReportEvidenceByteReader }> = [
      { value: report },
      { value: noManualReport, reader: noManualReader },
      { value: unavailableReport, reader: unavailableReader },
      { value: unsupportedReport, reader: unsupportedReader },
      { value: report, reader: rejectedReader },
      { value: report, reader: invalidMimeReader },
      { value: report, reader: emptyReader },
      { value: report, reader: oversizedReader },
      { value: report, reader: invalidMagicReader },
      { value: report, reader: invalidDimensionsReader },
    ];

    for (const testCase of cases) {
      const output = await renderDocx(testCase.value, testCase.reader ? { evidenceReader: testCase.reader } : {});
      const parts = await documentParts(output);

      expect(output.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      expect(parts.media).toHaveLength(0);
      expect(parts.document).not.toContain('MANUAL EVIDENCE');
      expect(parts.document).not.toContain('EVIDENCIAS MANUALES');
      expect(parts.document).not.toContain('proof.png');
      expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:State|Estado)<\/w:t>/);
      expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:Reference|Referencia)<\/w:t>/);
      expect(parts.document).not.toContain('No manual evidence was captured');
      expect(parts.relationships).not.toContain('/manual-executions/401/evidence/501');
    }

    expect(noManualReader).not.toHaveBeenCalled();
    expect(unavailableReader).not.toHaveBeenCalled();
    expect(unsupportedReader).not.toHaveBeenCalled();
    expect(rejectedReader).toHaveBeenCalledOnce();
    expect(invalidMimeReader).toHaveBeenCalledOnce();
    expect(emptyReader).toHaveBeenCalledOnce();
    expect(oversizedReader).toHaveBeenCalledOnce();
    expect(invalidMagicReader).toHaveBeenCalledOnce();
    expect(invalidDimensionsReader).toHaveBeenCalledOnce();
  });

  it('localizes human copy and HTML language without changing user-provided text', async () => {
    const english = renderHtml(report, { locale: 'en' }).toString('utf8');
    const spanish = renderHtml(report, { locale: 'es-ES,es;q=0.9' }).toString('utf8');
    const fallback = renderHtml(report, { locale: 'fr-FR' }).toString('utf8');
    const pdfTextSpy = vi.spyOn(PDFDocument.prototype, 'text');
    const pdf = await renderPdf(report, { locale: 'es' });
    const docx = await renderDocx(report, { locale: 'es' });
    const parts = await documentParts(docx);
    const pdfText = pdfTextSpy.mock.calls.map(([text]) => String(text)).join('\n');

    expect(english).toContain('<html lang="en">');
    expect(english).toContain('Functional scenario report');
    expect(english).toContain('Given Open the checkout');
    expect(english).toContain('Alpha scenario');
    expect(spanish).toContain('<html lang="es">');
    expect(spanish).toContain('Informe de escenarios funcionales');
    expect(spanish).toContain('Dado Open the checkout');
    expect(spanish).toContain('Entonces Submit the order');
    expect(spanish).toContain('Evidencias manuales');
    expect(spanish).not.toMatch(/<h3>Evidencias<\/h3>/);
    expect(spanish).toContain('Alpha scenario');
    expect(fallback).toContain('<html lang="en">');
    expect(fallback).toContain('Functional scenario report');
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdfText).toContain('Informe de escenarios funcionales');
    expect(pdfText).toContain('Dado Open the checkout');
    expect(pdfTextSpy.mock.calls.some(([text]) => String(text) === 'EVIDENCIAS')).toBe(false);
    expect(pdfTextSpy.mock.calls.some(([text]) => isPdfEvidenceCaption(text))).toBe(false);
    expect(pdfText).not.toContain('proof.png');
    expect(pdfText).not.toContain('/manual-executions/401/evidence/501');
    expect(parts.document).toContain('Informe de escenarios funcionales');
    expect(parts.document).toContain('Dado Open the checkout');
    expect(parts.document).not.toContain('<w:t>Evidencias</w:t>');
    expect(parts.header).toContain('Informe de escenarios funcionales');
    expect(parts.footer).toContain('Página');
  });

  it('does not classify unavailable evidence as positive', () => {
    expect(statusTone('unavailable')).toBe('warning');
    expect(statusTone('not available')).toBe('warning');
    expect(statusTone('available')).toBe('positive');
  });

  it('removes the narrative block while retaining steps, manual execution, and evidence', async () => {
    const html = renderHtml(report).toString('utf8');
    const pdfTextSpy = vi.spyOn(PDFDocument.prototype, 'text');
    const pdfTableSpy = vi.spyOn(PDFDocument.prototype, 'table');
    const [pdf, docx] = await Promise.all([renderPdf(report), renderDocx(report)]);
    const pdfText = pdfTextSpy.mock.calls.map(([text]) => String(text)).join('\n');
    const pdfTables = pdfTableSpy.mock.calls.map(([options]) => JSON.stringify(options)).join('\n');
    const parts = await documentParts(docx);

    expect(html).toContain('class="scenario-facts"');
    expect(html).not.toContain('scenario-identity');
    expect(html).not.toContain('Scenario metadata');
    expect(html).toMatch(/class="scenario-facts"[\s\S]*?<\/dl><h3>Steps<\/h3>/);
    expect(html).not.toMatch(
      /Scenario narrative|Feature: Alpha scenario|Scenario: Alpha scenario|Description|Preconditions|Expected results|Validate the alpha flow|A signed-in user exists/i
    );
    expect(pdfText).not.toMatch(
      /SCENARIO NARRATIVE|FEATURE: ALPHA SCENARIO|SCENARIO: ALPHA SCENARIO|DESCRIPTION|PRECONDITIONS|EXPECTED RESULTS|VALIDATE THE ALPHA FLOW|A SIGNED-IN USER EXISTS/i
    );
    expect(parts.document).not.toMatch(
      /Scenario narrative|Feature: Alpha scenario|Scenario: Alpha scenario|Description|Preconditions|Expected results|Validate the alpha flow|A signed-in user exists/i
    );

    expect(html).toContain('<h3>Steps</h3>');
    expect(html).toContain('Given Open the checkout');
    expect(html).toContain('Latest manual execution');
    expect(html).toContain('proof.png');
    expect(html).toContain('Manual evidence');
    expect(html).toMatch(
      /<h3>Latest manual execution<\/h3><article class="manual-execution">[\s\S]*?<dl class="manual-facts">[\s\S]*?<caption>Manual evidence<\/caption><thead><tr><th scope="col">Title<\/th><th scope="col">State<\/th><th scope="col">Reference<\/th><\/tr><\/thead>/
    );
    expect(html).not.toContain('<h3>Evidence</h3>');
    expect(pdfText).toContain('STEPS');
    expect(pdfTables).toContain('Open the checkout');
    expect(pdfText).toContain('LATEST MANUAL EXECUTION');
    expect(pdfTables).toContain('tester');
    expect(pdfTextSpy.mock.calls.some(([text]) => isPdfEvidenceCaption(text))).toBe(false);
    expect(pdfText).not.toContain('proof.png');
    expect(pdfTables).not.toContain('proof.png');
    expect(pdfTables).not.toContain('/manual-executions/401/evidence/501');
    expect(pdfTableSpy.mock.calls.some(([options]) => isPdfEvidenceMetadataTable(options))).toBe(false);
    expect(pdf.toString('latin1')).not.toContain('/manual-executions/401/evidence/501');
    expect(pdfTextSpy.mock.calls.some(([text]) => String(text) === 'EVIDENCE')).toBe(false);
    expect(parts.document).toContain('Steps');
    expect(parts.document).toContain('Given Open the checkout');
    expect(parts.document).toContain('Latest manual execution');
    expect(parts.document).toContain('tester');
    expect(parts.document).not.toContain('MANUAL EVIDENCE');
    expect(parts.document).not.toContain('EVIDENCIAS MANUALES');
    expect(parts.document).not.toContain('proof.png');
    expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:State|Estado)<\/w:t>/);
    expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:Reference|Referencia)<\/w:t>/);
    expect(parts.document).not.toContain('<w:t>Evidence</w:t>');
    expect(parts.relationships).not.toContain('/manual-executions/401/evidence/501');
    expect(pdf).toBeInstanceOf(Buffer);
    expect(docx).toBeInstanceOf(Buffer);
  });

  it('centers the cover and keeps scenario content top-aligned on following pages', async () => {
    const twoScenarioReport = {
      ...report,
      scenarios: [scenario(), scenario({ id: 102, title: 'Beta scenario', path: 'Checkout/Beta' })],
    };
    const html = renderHtml(twoScenarioReport).toString('utf8');
    const pdfTextSpy = vi.spyOn(PDFDocument.prototype, 'text');
    const pdfAddPageSpy = vi.spyOn(PDFDocument.prototype, 'addPage');
    const pdfRectSpy = vi.spyOn(PDFDocument.prototype, 'rect');
    const pdf = await renderPdf(twoScenarioReport);
    const parts = await documentParts(await renderDocx(twoScenarioReport));
    const sectionProperties = parts.document.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g) ?? [];
    const paragraphs = parts.document.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
    const coverParagraphs = paragraphs.slice(0, 3);
    const sectionBreakIndex = paragraphs.findIndex((paragraph) => paragraph.includes('<w:sectPr>'));
    const scenariosHeadingIndex = paragraphs.findIndex((paragraph) => paragraph.includes('Scenarios'));
    const scenarioHeadings = paragraphs.filter(
      (paragraph) => paragraph.includes('Scenario 101') || paragraph.includes('Scenario 102')
    );
    const centeredPdfText = pdfTextSpy.mock.calls.filter(([, options]) => {
      return typeof options === 'object' && options !== null && 'align' in options && options.align === 'center';
    });
    const pdfScenariosHeadingIndex = pdfTextSpy.mock.calls.findIndex(([text]) => String(text) === 'SCENARIOS');
    const pdfFirstScenarioIndex = pdfTextSpy.mock.calls.findIndex(
      ([text]) => String(text) === 'Scenario 101 — Alpha scenario'
    );
    const pdfSecondScenarioIndex = pdfTextSpy.mock.calls.findIndex(
      ([text]) => String(text) === 'Scenario 102 — Beta scenario'
    );
    const textCallOrder = pdfTextSpy.mock.invocationCallOrder;
    const pageCallOrder = pdfAddPageSpy.mock.invocationCallOrder;

    expect(html).toContain('.cover { display: flex;');
    expect(html).toContain('min-height: calc(297mm - 16mm - 17mm);');
    expect(html).toContain('align-items: center;');
    expect(html).toContain('justify-content: center;');
    expect(html).not.toContain('border-top: 7px solid var(--teal);');
    expect(html).not.toContain('padding: 26px 0 4px;');
    expect(html).toContain('.report-section.has-scenarios { break-before: page; page-break-before: always; }');
    expect(html).toContain('.scenario { break-before: auto; page-break-before: auto; padding-top: 0; }');
    expect(html).toContain('<section class="report-section has-scenarios"');
    expect(html.match(/<h2 id="scenario-list-title">Scenarios<\/h2>/g)).toHaveLength(1);
    expect(centeredPdfText).toHaveLength(4);
    expect(centeredPdfText.map(([text]) => String(text))).toEqual(
      expect.arrayContaining(['Functional scenario report', 'Project: Reports project · Execution: Release 1'])
    );
    expect(
      pdfRectSpy.mock.calls.some(([, , width, height]) => typeof width === 'number' && width > 400 && height === 7)
    ).toBe(false);
    expect(pageCallOrder[0]).toBeLessThan(textCallOrder[pdfScenariosHeadingIndex]);
    expect(textCallOrder[pdfScenariosHeadingIndex]).toBeLessThan(textCallOrder[pdfFirstScenarioIndex]);
    expect(
      pageCallOrder.some(
        (order) => order > textCallOrder[pdfScenariosHeadingIndex] && order < textCallOrder[pdfFirstScenarioIndex]
      )
    ).toBe(false);
    expect(
      pageCallOrder.some(
        (order) => order > textCallOrder[pdfFirstScenarioIndex] && order < textCallOrder[pdfSecondScenarioIndex]
      )
    ).toBe(true);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(sectionProperties).toHaveLength(2);
    expect(sectionProperties[0]).toMatch(/<w:vAlign w:val="center"\s*\/>/);
    expect(sectionProperties[1]).toMatch(/<w:type w:val="nextPage"\s*\/>/);
    expect(sectionProperties[1]).toMatch(/<w:vAlign w:val="top"\s*\/>/);
    expect(coverParagraphs).toHaveLength(3);
    coverParagraphs.forEach((paragraph) => expect(paragraph).toMatch(/<w:jc w:val="center"\s*\/>/));
    expect(sectionBreakIndex).toBeGreaterThanOrEqual(0);
    expect(scenariosHeadingIndex).toBeGreaterThan(sectionBreakIndex);
    expect(paragraphs.filter((paragraph) => paragraph.includes('Scenarios'))).toHaveLength(1);
    expect(scenarioHeadings).toHaveLength(2);
    expect(scenarioHeadings[0]).not.toContain('<w:pageBreakBefore/>');
    expect(scenarioHeadings[1]).toContain('<w:pageBreakBefore/>');
  });

  it('omits the expected-result column when all step values are blank', async () => {
    const noExpectedResultsReport: ReportModel = {
      ...report,
      scenarios: [
        scenario({
          steps: report.scenarios[0].steps.map((step) => ({ ...step, expectedResult: '  ' })),
        }),
      ],
    };
    const pdfTableSpy = vi.spyOn(PDFDocument.prototype, 'table');
    const html = renderHtml(noExpectedResultsReport, { locale: 'es' }).toString('utf8');
    const [pdf, docx] = await Promise.all([
      renderPdf(noExpectedResultsReport, { locale: 'es' }),
      renderDocx(noExpectedResultsReport, { locale: 'es' }),
    ]);
    const parts = await documentParts(docx);
    const pdfTables = pdfTableSpy.mock.calls.map(([options]) => JSON.stringify(options)).join('\n');

    expect(html).toContain('<table class="steps-table">');
    expect(html).not.toContain('Resultado esperado');
    expect(html).not.toContain('No disponible');
    expect(pdfTables).not.toContain('Resultado esperado');
    expect(pdfTables).not.toContain('No disponible');
    expect(parts.document).not.toContain('Resultado esperado');
    expect(parts.document).not.toContain('No disponible');
    expect(pdf).toBeInstanceOf(Buffer);
  });

  it('keeps the expected-result column for mixed step values and marks only missing cells', async () => {
    const mixedExpectedResultsReport: ReportModel = {
      ...report,
      scenarios: [
        scenario({
          steps: report.scenarios[0].steps.map((step, index) => ({
            ...step,
            expectedResult: index === 0 ? '  ' : 'Order is created',
          })),
        }),
      ],
    };
    const pdfTableSpy = vi.spyOn(PDFDocument.prototype, 'table');
    const html = renderHtml(mixedExpectedResultsReport, { locale: 'es' }).toString('utf8');
    const [pdf, docx] = await Promise.all([
      renderPdf(mixedExpectedResultsReport, { locale: 'es' }),
      renderDocx(mixedExpectedResultsReport, { locale: 'es' }),
    ]);
    const parts = await documentParts(docx);
    const pdfTables = pdfTableSpy.mock.calls.map(([options]) => JSON.stringify(options)).join('\n');

    expect(html).toContain('Resultado esperado');
    expect(html).toContain('No disponible');
    expect(html).toContain('Order is created');
    expect(pdfTables).toContain('Resultado esperado');
    expect(pdfTables).toContain('No disponible');
    expect(pdfTables).toContain('Order is created');
    expect(parts.document).toContain('Resultado esperado');
    expect(parts.document).toContain('No disponible');
    expect(parts.document).toContain('Order is created');
    expect(pdf).toBeInstanceOf(Buffer);
  });

  it('shows only the deterministic latest manual execution and its evidence', async () => {
    const tiedStart = '2026-09-02T12:00:00.000Z';
    const lowerTie = manual({
      id: 404,
      actor: { id: 7, username: 'lower-tie' },
      startedAt: tiedStart,
      evidence: [evidence({ id: 504, executionId: 404, label: 'lower-tie.png', href: '/manual/404' })],
    });
    const higherTie = manual({
      id: 405,
      actor: { id: 7, username: 'higher-tie' },
      startedAt: tiedStart,
      evidence: [evidence({ id: 505, executionId: 405, label: 'higher-tie.png', href: '/manual/405' })],
    });
    const missingDate = manual({
      id: 999,
      actor: { id: 7, username: 'missing-date' },
      startedAt: null,
      evidence: [evidence({ id: 599, executionId: 999, label: 'missing-date.png', href: '/manual/999' })],
    });
    const latestReport: ReportModel = {
      ...report,
      scenarios: [
        scenario({
          manual: [missingDate, lowerTie, higherTie, manual({ id: 403, actor: { id: 7, username: 'older' } })],
          evidence: [...missingDate.evidence, ...lowerTie.evidence, ...higherTie.evidence],
        }),
      ],
    };
    const pdfTextSpy = vi.spyOn(PDFDocument.prototype, 'text');
    const pdfTableSpy = vi.spyOn(PDFDocument.prototype, 'table');
    const imageSpy = vi.spyOn(PDFDocument.prototype, 'image');
    const pdfReader = vi.fn(async ({ executionId, evidenceId }) => {
      expect({ executionId, evidenceId }).toEqual({ executionId: 405, evidenceId: 505 });
      return { bytes: TINY_PNG, mimeType: 'image/png' };
    });
    const docxReader = vi.fn(async ({ executionId, evidenceId }) => {
      expect({ executionId, evidenceId }).toEqual({ executionId: 405, evidenceId: 505 });
      return { bytes: TINY_PNG, mimeType: 'image/png' };
    });
    const html = renderHtml(latestReport).toString('utf8');
    const [pdf, docx] = await Promise.all([
      renderPdf(latestReport, { evidenceReader: pdfReader }),
      renderDocx(latestReport, { evidenceReader: docxReader }),
    ]);
    const parts = await documentParts(docx);
    const pdfTables = pdfTableSpy.mock.calls.map(([options]) => JSON.stringify(options)).join('\n');

    expect(latestManualExecution(latestReport.scenarios[0].manual)?.id).toBe(405);
    expect(html).toContain('higher-tie');
    expect(html).toContain('/manual/405');
    expect(html).not.toContain('lower-tie');
    expect(html).not.toContain('missing-date');
    expect(html).not.toContain('/manual/404');
    expect(html).not.toContain('/manual/999');
    expect(html).toMatch(
      /<article class="manual-execution">[\s\S]*?higher-tie[\s\S]*?<caption>Manual evidence<\/caption>[\s\S]*?higher-tie\.png[\s\S]*?<\/article>/
    );
    expect(html).not.toContain('<h3>Evidence</h3>');
    expect(pdfTables).toContain('higher-tie');
    expect(pdfTables).not.toContain('higher-tie.png');
    expect(pdfTables).not.toContain('/manual/405');
    expect(pdfTables).not.toContain('lower-tie');
    expect(pdfTables).not.toContain('missing-date');
    expect(pdfReader).toHaveBeenCalledOnce();
    expect(docxReader).toHaveBeenCalledOnce();
    expect(imageSpy).toHaveBeenCalledOnce();
    expect(imageSpy.mock.calls[0]?.[0]).toEqual(TINY_PNG);
    expect(pdfTextSpy.mock.calls.some(([text]) => isPdfEvidenceCaption(text))).toBe(false);
    expect(pdfTextSpy.mock.calls.map(([text]) => String(text)).join('\n')).not.toContain('higher-tie.png');
    expect(pdfTextSpy.mock.calls.map(([text]) => String(text)).join('\n')).not.toContain('/manual/405');
    expect(pdfTableSpy.mock.calls.some(([options]) => isPdfEvidenceMetadataTable(options))).toBe(false);
    const latestManualDetailsIndex = pdfTableSpy.mock.calls.findIndex(([options]) =>
      JSON.stringify(options).includes('higher-tie')
    );
    expect(imageSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      pdfTableSpy.mock.invocationCallOrder[latestManualDetailsIndex]
    );
    expect(pdfTextSpy.mock.calls.some(([text]) => String(text) === 'EVIDENCE')).toBe(false);
    expect(parts.document).toContain('higher-tie');
    expect(parts.media.some(({ bytes }) => bytes.equals(TINY_PNG))).toBe(true);
    expect(parts.relationships).not.toContain('/manual/405');
    expect(parts.document).not.toContain('lower-tie');
    expect(parts.document).not.toContain('missing-date');
    expect(parts.document).not.toContain('higher-tie.png');
    expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:State|Estado)<\/w:t>/);
    expect(parts.document).not.toMatch(/<w:t(?:\s[^>]*)?>(?:Reference|Referencia)<\/w:t>/);
    expect(parts.document).not.toContain('<w:t>Evidence</w:t>');
    expect(pdf).toBeInstanceOf(Buffer);
  });

  it('renders localized empty states without exposing automation when no manual result exists', async () => {
    const emptyScenario = scenario({ manual: [], evidence: [], automation: [automation()] });
    const emptyReport = { ...report, scenarios: [emptyScenario] };
    const html = renderHtml(emptyReport, { locale: 'es' }).toString('utf8');
    const pdf = await renderPdf(emptyReport, { locale: 'es' });
    const docx = await renderDocx(emptyReport, { locale: 'es' });
    const parts = await documentParts(docx);

    expect(html).toContain('No se registró una ejecución manual para este escenario.');
    expect(html).toContain('No se registraron evidencias manuales para este escenario.');
    expect(html).not.toMatch(/automation|hercules|automation\.log/i);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(parts.document).toContain('No se registró una ejecución manual para este escenario.');
    expect(parts.document).not.toContain('No se registraron evidencias manuales para este escenario.');
    expect(parts.media).toHaveLength(0);
    expect(parts.document).not.toMatch(/automation|hercules|automation\.log/i);
  });

  it('renders Unicode text without network access', async () => {
    const unicodeReport: ReportModel = {
      ...report,
      project: { ...report.project, name: 'Proyecto Ñ — 世界' },
      scenarios: [
        scenario({
          title: 'Escenario ñ — 世界',
          description: `Descripción con acentos y símbolos: áéíóú ✓ ${'long content '.repeat(100)}`,
          steps: [
            {
              id: 9,
              position: 1,
              text: '文字列を確認する',
              expectedResult: '結果が表示される',
              keyword: 'when',
              section: null,
            },
          ],
        }),
      ],
    };
    const fetch = vi.fn(() => Promise.reject(new Error('network access is not allowed')));
    vi.stubGlobal('fetch', fetch);

    const json = renderJson(unicodeReport).toString('utf8');
    const html = renderHtml(unicodeReport).toString('utf8');
    const [pdf, docx] = await Promise.all([renderPdf(unicodeReport), renderDocx(unicodeReport)]);
    const parts = await documentParts(docx);

    expect(fetch).not.toHaveBeenCalled();
    expect(json).toContain('Proyecto Ñ');
    expect(json).toContain('世界');
    expect(html).toContain('文字列を確認する');
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/ToUnicode');
    expect(docx.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(parts.document).toContain('世界');
  });

  it('enforces output bounds and isolates renderer failures', async () => {
    expect(() => renderJson(report, { maxBytes: 16 })).toThrowError(
      expect.objectContaining({ format: 'json', code: 'report_output_limit_exceeded' })
    );
    expect(() => renderHtml(report, { maxBytes: 16 })).toThrowError(
      expect.objectContaining({ format: 'html', code: 'report_output_limit_exceeded' })
    );
    await expect(renderPdf(report, { maxBytes: 64 })).rejects.toMatchObject({
      format: 'pdf',
      code: 'report_output_limit_exceeded',
    });
    await expect(renderDocx(report, { maxBytes: 64 })).rejects.toMatchObject({
      format: 'docx',
      code: 'report_output_limit_exceeded',
    });

    const circular = { ...report, circular: undefined } as ReportModel & { circular?: unknown };
    circular.circular = circular;
    expect(() => renderJson(circular)).toThrowError(
      expect.objectContaining({ format: 'json', code: 'report_render_failed' })
    );
    expect(renderJson(report)).toEqual(expect.any(Buffer));
    expect(renderHtml(report)).toEqual(expect.any(Buffer));
    await expect(renderPdf(report, { fontPath: 'missing-report-font.ttf' })).rejects.toMatchObject({
      format: 'pdf',
      code: 'report_render_failed',
    });
  });
});
