import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportCounts, ReportFormat, ReportModel, ReportStore } from '../../reports/api/types.js';
import { ReportService } from '../../reports/application/service.js';
import { ReportRenderError, type ReportRenderOptions } from '../../reports/infrastructure/render-common.js';
import type { ManualEvidenceView, ManualExecutionServicePort } from '../../manual-execution/api/types.js';
import reportsRoute, { type ReportRenderer, type ReportRouteOptions } from './index.js';

const verifySignedIn = vi.fn((req: { userId?: number }, _res: unknown, next: () => void) => {
  req.userId = 7;
  next();
});

vi.mock('../../middleware/auth.js', () => ({ default: () => ({ verifySignedIn }) }));

const report = {
  project: { id: 17, name: 'Q1 / Unsafe Project', detail: null, isPublic: true, ownerUserId: 7 },
  execution: { id: 42, name: 'Release run', description: null, state: 1, createdAt: null, updatedAt: null },
  scenarios: [],
  aggregates: { manual: {} as ReportCounts, automation: {} as ReportCounts, combined: 'unavailable' },
} as ReportModel;

const service = { build: vi.fn(async () => report) };
const renderers: Record<string, ReturnType<typeof vi.fn>> = {
  json: vi.fn(() => Buffer.from(JSON.stringify(report), 'utf8')),
  html: vi.fn(() => Buffer.from('<!doctype html><p>report</p>', 'utf8')),
  pdf: vi.fn(() => Buffer.from('%PDF-1.7 report', 'utf8')),
  docx: vi.fn(() => Buffer.from('PK report', 'utf8')),
};

function makeApp(
  options: {
    service?: { build: typeof service.build };
    renderers?: Partial<Record<ReportFormat, ReportRenderer>>;
    manualEvidenceService?: Pick<ManualExecutionServicePort, 'downloadEvidence'>;
  } = {}
) {
  const app = express();
  app.use(express.json());
  const routeOptions: ReportRouteOptions = {
    service: options.service ?? service,
    renderers: options.renderers ?? renderers,
    ...(options.manualEvidenceService ? { manualEvidenceService: options.manualEvidenceService } : {}),
  };
  app.use('/projects', reportsRoute({} as never, routeOptions));
  return app;
}

function body(format: 'json' | 'html' | 'pdf' | 'docx' = 'json') {
  return {
    selection: { mode: 'explicit', scenarioIds: [10, 10, 11] },
    execution: { runId: 42 },
    format,
  };
}

function typedError(code: string, status: number): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status });
}

describe('project report route security and export boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifySignedIn.mockImplementation((req, _res, next) => {
      req.userId = 7;
      next();
    });
    service.build.mockResolvedValue(report);
    Object.values(renderers).forEach((renderer) => renderer.mockClear());
  });

  it('requires sign-in before the service can read the project or run', async () => {
    verifySignedIn.mockImplementationOnce(
      (_req, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
        res.status(401).json({ error: 'Access denied' });
      }
    );

    const response = await request(makeApp()).post('/projects/17/reports').send(body());

    expect(response.status).toBe(401);
    expect(service.build).not.toHaveBeenCalled();
    expect(renderers.json).not.toHaveBeenCalled();
  });

  it('passes the authenticated user, project, exact run, and selection to the read-only service', async () => {
    const response = await request(makeApp())
      .post('/projects/17/reports')
      .set('X-Correlation-Id', 'route-42')
      .send(body());

    expect(response.status).toBe(200);
    expect(response.headers['x-correlation-id']).toBe('route-42');
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="Q1 _ Unsafe Project\.json"/);
    expect(service.build).toHaveBeenCalledWith({ userId: 7, projectId: 17, request: body() });
    expect(renderers.json).toHaveBeenCalledWith(report, expect.objectContaining({ maxBytes: expect.any(Number) }));
  });

  it('passes the UI locale through Accept-Language without adding it to the canonical request', async () => {
    const response = await request(makeApp())
      .post('/projects/17/reports')
      .set('Accept-Language', 'es-ES,es;q=0.9')
      .send(body('html'));

    expect(response.status).toBe(200);
    expect(service.build).toHaveBeenCalledWith({ userId: 7, projectId: 17, request: body('html') });
    expect(renderers.html).toHaveBeenCalledWith(
      report,
      expect.objectContaining({ maxBytes: expect.any(Number), locale: 'es-ES,es;q=0.9' })
    );
  });

  it('binds the render reader to the authenticated user through manual evidence authorization', async () => {
    const downloadedEvidence: ManualEvidenceView = {
      id: 9,
      executionId: 20,
      uploaderUserId: 7,
      filename: 'proof.png',
      mimeType: 'image/png',
      size: 1,
      sha256: 'a'.repeat(64),
      expiresAt: '2026-09-30T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    const downloadEvidence = vi.fn(async () => ({ bytes: Buffer.from([1]), evidence: downloadedEvidence }));
    const pdfRenderer = vi.fn(async (_report: ReportModel, options?: ReportRenderOptions) => {
      const reader = options?.evidenceReader;
      if (!reader) throw new Error('expected a bound evidence reader');
      await reader({ executionId: 20, evidenceId: 9 });
      return Buffer.from('%PDF-1.7 report', 'utf8');
    });
    const customService = { build: vi.fn(async () => report) };

    const response = await request(
      makeApp({
        service: customService,
        renderers: { pdf: pdfRenderer },
        manualEvidenceService: { downloadEvidence },
      })
    )
      .post('/projects/17/reports')
      .send(body('pdf'));

    expect(response.status).toBe(200);
    expect(customService.build).toHaveBeenCalledOnce();
    expect(pdfRenderer).toHaveBeenCalledOnce();
    expect(downloadEvidence).toHaveBeenCalledWith(20, 9, 7);
  });

  it('deduplicates explicit IDs and rejects bounds or foreign selections without output', async () => {
    const store: ReportStore = { build: vi.fn(async () => report) };
    const normalizedService = new ReportService({ store, limits: { maxSelectionIds: 2 } });
    const normalizedResponse = await request(makeApp({ service: normalizedService }))
      .post('/projects/17/reports')
      .send(body());

    expect(normalizedResponse.status).toBe(413);
    expect(store.build).not.toHaveBeenCalled();

    const smallStore: ReportStore = { build: vi.fn(async () => report) };
    const smallService = new ReportService({ store: smallStore });
    const duplicateResponse = await request(makeApp({ service: smallService }))
      .post('/projects/17/reports')
      .send({ ...body(), selection: { mode: 'explicit', scenarioIds: [10, 10] } });

    expect(duplicateResponse.status).toBe(200);
    expect(smallStore.build).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 42, selection: { mode: 'explicit', scenarioIds: [10] } })
    );

    service.build.mockRejectedValueOnce(typedError('scenario_not_found', 404));
    const foreignResponse = await request(makeApp()).post('/projects/17/reports').send(body());
    expect(foreignResponse.status).toBe(404);
    expect(foreignResponse.body).toEqual(expect.objectContaining({ error: 'scenario_not_found' }));
    expect(JSON.stringify(foreignResponse.body)).not.toContain('scenarios');
  });

  it('maps project, execution, and malformed format authorization errors with correlation', async () => {
    for (const [code, status, payload] of [
      ['forbidden', 403, body()],
      ['execution_not_found', 404, body()],
      ['format_invalid', 400, { ...body(), format: 'csv' }],
    ] as const) {
      if (code !== 'format_invalid') service.build.mockRejectedValueOnce(typedError(code, status));
      const response = await request(makeApp())
        .post('/projects/17/reports')
        .set('X-Correlation-Id', code)
        .send(payload);
      expect(response.status).toBe(status);
      expect(response.body).toEqual(expect.objectContaining({ error: code, code, correlationId: code }));
    }
  });

  it.each([
    ['json', 'application/json; charset=utf-8'],
    ['html', 'text/html; charset=utf-8'],
    ['pdf', 'application/pdf'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ] as const)(
    'returns the selected %s renderer with its safe content type and filename',
    async (format, contentType) => {
      const response = await request(makeApp()).post('/projects/17/reports').send(body(format));

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(new RegExp(`^${contentType.replace(/[.+-]/g, '\\$&')}`));
      expect(response.headers['content-disposition']).toMatch(new RegExp(`filename="Q1 _ Unsafe Project\\.${format}"`));
      expect(response.headers['content-disposition']).not.toMatch(/[\r\n/\\]/);
      expect(renderers[format]).toHaveBeenCalledOnce();
    }
  );

  it('returns a format-specific renderer error and never sends partial report bytes', async () => {
    renderers.pdf.mockRejectedValueOnce(new ReportRenderError('pdf', 'report_render_failed'));

    const response = await request(makeApp())
      .post('/projects/17/reports')
      .set('X-Correlation-Id', 'render-1')
      .send(body('pdf'));

    expect(response.status).toBe(500);
    expect(response.headers['x-correlation-id']).toBe('render-1');
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'report_render_failed',
        code: 'report_render_failed',
        format: 'pdf',
        correlationId: 'render-1',
      })
    );
    expect(response.text).not.toContain('%PDF');
  });

  it('preserves authenticated evidence links and performs no write operation', async () => {
    const evidenceReport = {
      ...report,
      scenarios: [{ id: 10, evidence: [{ id: 9, href: '/manual-executions/20/evidence/9', state: 'available' }] }],
    } as ReportModel;
    service.build.mockResolvedValueOnce(evidenceReport);
    renderers.json.mockImplementationOnce(() => Buffer.from(JSON.stringify(evidenceReport), 'utf8'));

    const response = await request(makeApp()).post('/projects/17/reports').send(body());

    expect(response.status).toBe(200);
    expect(response.body.scenarios[0].evidence[0].href).toBe('/manual-executions/20/evidence/9');
  });
});
