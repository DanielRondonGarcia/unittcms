import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REPORT_FORMATS,
  REPORT_MESSAGE_KEYS,
  buildReportRequest,
  downloadReport,
  previewReport,
} from './reportControl';

function response(body: BodyInit | null, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

describe('report control frontend boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds an all-scenarios request with exactly one selected run', () => {
    expect(buildReportRequest({ selection: { mode: 'all' }, runId: '8', format: 'html', locale: 'es' })).toEqual({
      ok: true,
      data: { selection: { mode: 'all' }, execution: { runId: 8 }, format: 'html' },
    });
  });

  it('deduplicates explicit scenario IDs and accepts every export format', () => {
    expect(
      buildReportRequest({ selection: { mode: 'explicit', scenarioIds: ['2', 2, 4] }, runId: 8, format: 'json' })
    ).toMatchObject({ ok: true, data: { selection: { mode: 'explicit', scenarioIds: [2, 4] } } });

    for (const format of REPORT_FORMATS) {
      expect(buildReportRequest({ selection: { mode: 'all' }, runId: 8, format })).toMatchObject({
        ok: true,
        data: { format },
      });
    }
  });

  it('returns clear validation errors without making a request', async () => {
    expect(buildReportRequest({ selection: { mode: 'explicit', scenarioIds: [] }, runId: 8, format: 'json' })).toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'report_selection_invalid' }) })
    );
    expect(buildReportRequest({ selection: { mode: 'all' }, runId: 8, format: 'csv' })).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'report_format_invalid',
          messageKey: REPORT_MESSAGE_KEYS.formatInvalid,
        }),
      })
    );
    expect(buildReportRequest({ selection: { mode: 'all' }, runId: 0, format: 'json' })).toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'report_run_invalid' }) })
    );

    const result = await downloadReport('jwt', 17, { selection: { mode: 'all' }, runId: 8, format: 'csv' });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('always requests HTML for preview after a PDF download', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        response(new Uint8Array([37, 80, 68, 70]), 200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="project-report.pdf"',
        })
      )
      .mockResolvedValueOnce(
        response('<h1>Report</h1>', 200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'attachment; filename="project-report.html"',
        })
      );

    const input = { selection: { mode: 'all' as const }, runId: 8 };
    const download = await downloadReport('jwt', 17, { ...input, format: 'pdf' });
    expect(download).toMatchObject({
      ok: true,
      data: { intent: 'download', format: 'pdf', filename: 'project-report.pdf' },
    });
    expect(download.ok && download.data.bytes.byteLength).toBe(4);

    const preview = await previewReport('jwt', '17', input);
    expect(preview).toMatchObject({ ok: true, data: { intent: 'preview', format: 'html', text: '<h1>Report</h1>' } });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/projects/17/reports', '/api/projects/17/reports']);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      selection: { mode: 'all' },
      execution: { runId: 8 },
      format: 'pdf',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      selection: { mode: 'all' },
      execution: { runId: 8 },
      format: 'html',
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer jwt', 'Content-Type': 'application/json' })
    );
  });

  it('maps API failures to a locale-independent download message key', async () => {
    vi.mocked(fetch).mockResolvedValue(
      response(
        JSON.stringify({ error: 'report_forbidden', code: 'report_forbidden', correlationId: 'report-42' }),
        403,
        {
          'Content-Type': 'application/json',
        }
      )
    );

    const result = await downloadReport('jwt', 17, { selection: { mode: 'all' }, runId: 8, format: 'json' });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          status: 403,
          code: 'report_forbidden',
          correlationId: 'report-42',
          messageKey: REPORT_MESSAGE_KEYS.downloadFailed,
        }),
      })
    );
  });

  it('sends the UI locale as Accept-Language while keeping the JSON body canonical', async () => {
    vi.mocked(fetch).mockResolvedValue(
      response('<html lang="es"></html>', 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'attachment; filename="project-report.html"',
      })
    );

    const result = await previewReport('jwt', 17, {
      selection: { mode: 'all' },
      runId: 8,
      locale: 'es',
    });

    expect(result).toMatchObject({ ok: true, data: { format: 'html' } });
    const [, requestInit] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer jwt',
        'Content-Type': 'application/json',
        'Accept-Language': 'es',
      })
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      selection: { mode: 'all' },
      execution: { runId: 8 },
      format: 'html',
    });
  });
});
