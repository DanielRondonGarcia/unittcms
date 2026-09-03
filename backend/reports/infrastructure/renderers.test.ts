import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type {
  ReportAutomationExecution,
  ReportCounts,
  ReportEvidenceRef,
  ReportManualExecution,
  ReportModel,
  ReportScenario,
} from '../api/types.js';
import { renderHtml } from './render-html.js';
import { renderJson } from './render-json.js';
import { renderDocx, DOCX_REPORT_CONTENT_TYPE } from './render-docx.js';
import { renderPdf, PDF_REPORT_CONTENT_TYPE } from './render-pdf.js';

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
        position: 2,
        text: 'Submit the order',
        expectedResult: 'Order is created',
        keyword: 'then',
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
  scenarios: [
    scenario(),
    scenario({
      id: 102,
      title: 'Zulu scenario',
      folderId: 12,
      path: 'Checkout/Zulu',
      pathSegments: ['Checkout', 'Zulu'],
      steps: [
        {
          id: 3,
          position: 1,
          text: 'Review the receipt',
          expectedResult: 'Receipt is shown',
          keyword: 'when',
          section: null,
        },
      ],
      manual: [],
      automation: [],
      evidence: [],
      runCase: null,
    }),
  ],
  aggregates: {
    manual: counts({ total: 2, passed: 1, untested: 1 }),
    automation: counts({ total: 2, failed: 1, untested: 1 }),
    combined: 'unavailable',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('report renderers', () => {
  it('preserves canonical facts, source separation, evidence refs, and stable order in JSON and HTML', () => {
    const json = renderJson(report);
    const html = renderHtml(report).toString('utf8');
    const jsonText = json.toString('utf8');

    expect(JSON.parse(jsonText)).toEqual(report);
    expect(jsonText.indexOf('"title": "Alpha scenario"')).toBeLessThan(jsonText.indexOf('"title": "Zulu scenario"'));
    expect(html.indexOf('Alpha scenario')).toBeLessThan(html.indexOf('Zulu scenario'));
    expect(html).toContain('Checkout/Alpha');
    expect(html).toContain('manual-correlation');
    expect(html).toContain('automation-correlation');
    expect(html).toContain('href="/manual-executions/401/evidence/501"');
    expect(html).toContain('href="/automation/artifacts/601/download"');
    expect(html).toContain('Combined:');
  });

  it('renders Unicode text without network access', () => {
    const unicodeReport: ReportModel = {
      ...report,
      project: { ...report.project, name: 'Proyecto Ñ — 世界' },
      scenarios: [
        scenario({
          title: 'Escenario ñ — 世界',
          description: `Descripción con acentos y símbolos: áéíóú ✓ ${'long content '.repeat(1_000)}`,
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
        scenario({
          id: 102,
          title: 'Second Unicode scenario',
          path: 'Checkout/Second',
          pathSegments: ['Checkout', 'Second'],
          manual: [],
          automation: [],
          evidence: [],
          runCase: null,
        }),
      ],
    };
    const fetch = vi.fn(() => Promise.reject(new Error('network access is not allowed')));
    vi.stubGlobal('fetch', fetch);

    const json = renderJson(unicodeReport).toString('utf8');
    const html = renderHtml(unicodeReport).toString('utf8');

    expect(fetch).not.toHaveBeenCalled();
    expect(json).toContain('Proyecto Ñ');
    expect(json).toContain('世界');
    expect(json).toContain('文字列を確認する');
    expect(html).toContain('Proyecto Ñ');
    expect(html).toContain('世界');
    expect(html).toContain('文字列を確認する');
  });

  it('rejects oversized output instead of returning partial or truncated files', () => {
    expect(() => renderJson(report, { maxBytes: 16 })).toThrowError(
      expect.objectContaining({ format: 'json', code: 'report_output_limit_exceeded' })
    );
    expect(() => renderHtml(report, { maxBytes: 16 })).toThrowError(
      expect.objectContaining({ format: 'html', code: 'report_output_limit_exceeded' })
    );
  });

  it('isolates renderer failures and never falls back to another format', () => {
    const circular = { ...report, circular: undefined } as ReportModel & { circular?: unknown };
    circular.circular = circular;
    expect(() => renderJson(circular)).toThrowError(
      expect.objectContaining({ format: 'json', code: 'report_render_failed' })
    );

    expect(renderJson(report)).toEqual(expect.any(Buffer));
    expect(renderHtml(report)).toEqual(expect.any(Buffer));
  });

  it('does not expose unavailable evidence as a clickable reference', () => {
    const unavailableReport: ReportModel = {
      ...report,
      scenarios: [
        scenario({
          evidence: [
            evidence({ state: 'expired', href: undefined }),
            evidence({ id: 502, state: 'missing', href: undefined }),
          ],
          manual: [
            manual({
              evidence: [
                evidence({ state: 'expired', href: undefined }),
                evidence({ id: 502, state: 'missing', href: undefined }),
              ],
            }),
          ],
          automation: [],
        }),
      ],
    };

    const html = renderHtml(unavailableReport).toString('utf8');
    expect(html).toContain('expired');
    expect(html).toContain('missing');
    expect(html).not.toContain('href="undefined"');
    expect(html).not.toContain('/manual-executions/401/evidence/501');
  });

  it('renders paginated PDF and packed DOCX with Unicode and authenticated evidence refs without network access', async () => {
    const unicodeReport: ReportModel = {
      ...report,
      project: { ...report.project, name: 'Proyecto Ñ — 世界' },
      scenarios: [
        scenario({
          title: 'Escenario ñ — 世界',
          description: `Descripción áéíóú ✓ ${'Long content for pagination '.repeat(250)}`,
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
        scenario({ id: 102, title: 'Second scenario', path: 'Checkout/Second', pathSegments: ['Checkout', 'Second'] }),
      ],
    };
    const fetch = vi.fn(() => Promise.reject(new Error('network access is not allowed')));
    vi.stubGlobal('fetch', fetch);
    const fontPath = process.platform === 'win32' ? 'C:\\Windows\\Fonts\\arial.ttf' : undefined;

    const [pdf, docx] = await Promise.all([
      renderPdf(unicodeReport, fontPath ? { fontPath } : {}),
      renderDocx(unicodeReport),
    ]);
    const pdfText = pdf.toString('latin1');
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    const relationshipsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');

    expect(fetch).not.toHaveBeenCalled();
    expect(PDF_REPORT_CONTENT_TYPE).toBe('application/pdf');
    expect(DOCX_REPORT_CONTENT_TYPE).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdfText).toContain('/ToUnicode');
    expect((pdfText.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    expect(pdfText).toContain('/manual-executions/401/evidence/501');
    expect(pdfText).toContain('/automation/artifacts/601/download');
    expect(docx.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(documentXml).toContain('Escenario');
    expect(documentXml).toContain('世界');
    expect(relationshipsXml).toContain('/manual-executions/401/evidence/501');
  });

  it('enforces PDF/DOCX bounds and isolates failures without fallback or corrupt output', async () => {
    await expect(renderPdf(report, { maxBytes: 64 })).rejects.toMatchObject({
      format: 'pdf',
      code: 'report_output_limit_exceeded',
    });
    await expect(renderDocx(report, { maxBytes: 64 })).rejects.toMatchObject({
      format: 'docx',
      code: 'report_output_limit_exceeded',
    });
    await expect(renderPdf(report, { fontPath: 'missing-report-font.ttf' })).rejects.toMatchObject({
      format: 'pdf',
      code: 'report_render_failed',
    });

    const malformed = { ...report, scenarios: [undefined] } as unknown as ReportModel;
    await expect(renderDocx(malformed)).rejects.toMatchObject({ format: 'docx', code: 'report_render_failed' });
    expect(renderJson(report)).toEqual(expect.any(Buffer));
    expect(renderHtml(report)).toEqual(expect.any(Buffer));
  });
});
