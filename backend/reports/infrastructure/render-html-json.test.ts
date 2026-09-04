import { describe, expect, it } from 'vitest';
import type { ReportCounts, ReportModel } from '../api/types.js';
import { JSON_REPORT_CONTENT_TYPE, renderJson } from './render-json.js';
import { renderHtml } from './render-html.js';

function counts(overrides: Partial<ReportCounts> = {}): ReportCounts {
  return {
    total: 1,
    passed: 1,
    failed: 0,
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

const report: ReportModel = {
  project: {
    id: 1,
    name: 'Reports <project>',
    detail: 'Details & context',
    isPublic: false,
    ownerUserId: 7,
  },
  execution: {
    id: 2,
    name: 'Release 1',
    description: 'Selected run',
    state: 1,
    createdAt: null,
    updatedAt: null,
  },
  scenarios: [
    {
      id: 10,
      title: 'Checkout <alpha>',
      folderId: null,
      path: 'Checkout/<alpha>',
      pathSegments: ['Checkout', '<alpha>'],
      description: 'Description & details',
      preConditions: null,
      expectedResults: 'Order is created',
      state: 0,
      priority: 1,
      type: 4,
      automationStatus: 0,
      template: 0,
      automationVersion: 1,
      createdAt: null,
      updatedAt: null,
      steps: [
        {
          id: 1,
          position: 1,
          text: 'Open <checkout>',
          expectedResult: 'Checkout visible & ready',
          keyword: 'given',
          section: null,
        },
      ],
      snapshot: { revision: 1, hash: 'hash', source: 'current' },
      stale: false,
      deleted: false,
      runCase: null,
      manual: [
        {
          id: 20,
          status: 'finished',
          result: 'passed',
          actorUserId: 7,
          actor: { id: 7, username: 'tester' },
          assigneeUserId: null,
          assignee: null,
          startedAt: null,
          finishedAt: null,
          caseRevision: 1,
          caseSnapshotHash: 'hash',
          stale: false,
          sourceDeleted: false,
          correlationId: 'correlation-20',
          report: null,
          evidence: [
            {
              id: 90,
              source: 'manual',
              executionId: 20,
              label: 'proof.png',
              state: 'available',
              href: '/manual-executions/20/evidence/90',
            },
          ],
        },
      ],
      automation: [],
      evidence: [
        {
          id: 90,
          source: 'manual',
          executionId: 20,
          label: 'proof.png',
          state: 'available',
          href: '/manual-executions/20/evidence/90',
        },
        {
          id: 91,
          source: 'manual',
          executionId: 20,
          label: 'expired.png',
          state: 'expired',
          href: 'javascript:alert(1)',
        },
      ],
    },
  ],
  aggregates: {
    manual: counts(),
    automation: counts({ total: 1, passed: 0, untested: 1 }),
    combined: 'unavailable',
  },
};

describe('HTML and JSON report renderers', () => {
  it('serializes the canonical report model without changing facts', () => {
    const output = renderJson(report);

    expect(output).toBeInstanceOf(Buffer);
    expect(JSON_REPORT_CONTENT_TYPE).toBe('application/json; charset=utf-8');
    expect(JSON.parse(output.toString('utf8'))).toEqual(report);
  });

  it('renders escaped human content and only safe manual evidence references in HTML', () => {
    const html = renderHtml(report).toString('utf8');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Reports &lt;project&gt;');
    expect(html).toContain('Checkout &lt;alpha&gt;');
    expect(html).not.toContain('Details &amp; context');
    expect(html).toContain('href="/manual-executions/20/evidence/90"');
    expect(html).toContain('expired.png');
    expect(html).toContain('Expired');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toMatch(/metadata|automation|correlation-20|snapshot hash/i);
  });

  it('enforces the configured output bound for both renderers', () => {
    expect(() => renderJson(report, { maxBytes: 1 })).toThrowError(
      expect.objectContaining({ format: 'json', code: 'report_output_limit_exceeded' })
    );
    expect(() => renderHtml(report, { maxBytes: 1 })).toThrowError(
      expect.objectContaining({ format: 'html', code: 'report_output_limit_exceeded' })
    );
  });

  it('wraps JSON serialization failures without falling back to another format', () => {
    const circular = { ...report, circular: undefined } as ReportModel & { circular?: unknown };
    circular.circular = circular;

    expect(() => renderJson(circular)).toThrowError(
      expect.objectContaining({ format: 'json', code: 'report_render_failed' })
    );
    expect(renderHtml(report)).toBeInstanceOf(Buffer);
  });
});
