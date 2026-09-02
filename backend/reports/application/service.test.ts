import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_REPORT_LIMITS, ReportError, ReportService, type ReportModel, type ReportStore } from './service.js';

const report: ReportModel = {
  project: { id: 10, name: 'Project', detail: null, isPublic: false, ownerUserId: 1 },
  execution: { id: 20, name: 'Run', description: null, state: null, createdAt: null, updatedAt: null },
  scenarios: [],
  aggregates: {
    manual: {
      total: 0,
      passed: 0,
      failed: 0,
      untested: 0,
      retest: 0,
      skipped: 0,
      queued: 0,
      running: 0,
      error: 0,
      cancelled: 0,
      unavailable: 0,
    },
    automation: {
      total: 0,
      passed: 0,
      failed: 0,
      untested: 0,
      retest: 0,
      skipped: 0,
      queued: 0,
      running: 0,
      error: 0,
      cancelled: 0,
      unavailable: 0,
    },
    combined: 'unavailable',
  },
};

function store(overrides: Partial<ReportStore> = {}): ReportStore {
  return {
    build: vi.fn(async () => report),
    ...overrides,
  };
}

describe('ReportService', () => {
  it('normalizes duplicate explicit IDs and forwards the exact selected run', async () => {
    const data = store();
    const service = new ReportService({ store: data });

    await service.build({
      userId: 7,
      projectId: 10,
      request: {
        selection: { mode: 'explicit', scenarioIds: [4, 2, 4] },
        execution: { runId: 99 },
        format: 'json',
      },
    });

    expect(data.build).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        projectId: 10,
        runId: 99,
        selection: { mode: 'explicit', scenarioIds: [4, 2] },
        limits: DEFAULT_REPORT_LIMITS,
      })
    );
  });

  it('accepts an empty all-scenarios project but rejects an explicit empty selection', async () => {
    const data = store();
    const service = new ReportService({ store: data });

    await expect(
      service.build({
        userId: 7,
        projectId: 10,
        request: { selection: { mode: 'all' }, execution: { runId: 99 }, format: 'json' },
      })
    ).resolves.toBe(report);

    await expect(
      service.build({
        userId: 7,
        projectId: 10,
        request: { selection: { mode: 'explicit', scenarioIds: [] }, execution: { runId: 99 }, format: 'json' },
      })
    ).rejects.toMatchObject({ code: 'selection_empty', status: 400 });
  });

  it('rejects invalid selection IDs and configured selection bounds before reading', async () => {
    const data = store();
    const service = new ReportService({ store: data, limits: { maxSelectionIds: 2 } });

    await expect(
      service.build({
        userId: 7,
        projectId: 10,
        request: {
          selection: { mode: 'explicit', scenarioIds: [1, 2, 3] },
          execution: { runId: 99 },
          format: 'json',
        },
      })
    ).rejects.toMatchObject({ code: 'selection_limit_exceeded', status: 413 });
    expect(data.build).not.toHaveBeenCalled();

    await expect(
      service.build({
        userId: 7,
        projectId: 10,
        request: {
          selection: { mode: 'explicit', scenarioIds: [1, -2] },
          execution: { runId: 99 },
          format: 'json',
        },
      })
    ).rejects.toMatchObject({ code: 'scenario_id_invalid', status: 400 });
    expect(data.build).not.toHaveBeenCalled();
  });

  it('preserves authorization failures without attempting to build a report', async () => {
    const data = store({
      build: vi.fn(async () => {
        throw new ReportError('forbidden', 403);
      }),
    });
    const service = new ReportService({ store: data });

    await expect(
      service.build({
        userId: 8,
        projectId: 10,
        request: { selection: { mode: 'all' }, execution: { runId: 99 }, format: 'json' },
      })
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('rejects a serialized report over the configured response bound', async () => {
    const data = store({
      build: vi.fn(async () => ({ ...report, project: { ...report.project, name: 'x'.repeat(100) } })),
    });
    const service = new ReportService({ store: data, limits: { maxSerializedBytes: 64 } });

    await expect(
      service.build({
        userId: 7,
        projectId: 10,
        request: { selection: { mode: 'all' }, execution: { runId: 99 }, format: 'json' },
      })
    ).rejects.toMatchObject({ code: 'report_size_exceeded', status: 413 });
  });
});
