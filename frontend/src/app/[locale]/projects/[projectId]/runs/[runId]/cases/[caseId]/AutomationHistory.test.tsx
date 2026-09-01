/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AutomationHistory from './AutomationHistory';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  fetchHistory: vi.fn(),
  fetchManualHistory: vi.fn(),
  listEvidence: vi.fn(),
  downloadEvidence: vi.fn(),
}));

vi.mock('@/utils/automationControl', async () => {
  const actual = await vi.importActual<typeof import('@/utils/automationControl')>('@/utils/automationControl');
  return { ...actual, fetchAutomationHistory: mocks.fetchHistory };
});

vi.mock('@/utils/manualExecutionControl', async () => {
  const actual = await vi.importActual<typeof import('@/utils/manualExecutionControl')>(
    '@/utils/manualExecutionControl'
  );
  return {
    ...actual,
    fetchManualExecutionHistory: mocks.fetchManualHistory,
    listManualEvidence: mocks.listEvidence,
    downloadManualEvidence: mocks.downloadEvidence,
  };
});

vi.mock('@/src/i18n/routing', () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('@heroui/react', () => ({
  Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

const contextValue = {
  token: { access_token: 'test-token' },
  isSignedIn: () => true,
};

const nativeCreateObjectURL = URL.createObjectURL;
const nativeRevokeObjectURL = URL.revokeObjectURL;

const messages = {
  automationHistoryLoading: 'Loading history',
  automationUnavailable: 'Automation unavailable',
  automationHistoryEmpty: 'No automation executions yet',
  automationQueued: 'Queued',
  automationRunning: 'Running',
  automationPassed: 'Passed',
  automationFailed: 'Failed',
  automationError: 'Error',
  automationCancelled: 'Cancelled',
  automationEvidenceInsufficient: 'Execution evidence is insufficient',
  automationTechnicalFailure: 'A technical failure stopped the execution. Check the environment and retry.',
  automationFunctionalFailure: 'The scenario did not pass. Review the execution evidence and expected result.',
  automationEvidenceFailure: 'The execution could not be verified because required evidence is missing or unsafe.',
  automationCancelledDetail: 'The execution was cancelled before it completed.',
  automationGenericFailure: 'The automation could not be completed. Review the details and try again.',
  automationTimeoutDetail:
    'Hercules exceeded the execution time limit. Review the process output for context, then retry the execution.',
  automationTimeline: 'Execution timeline',
  automationTimeout: 'Timed out',
  automationExample: 'Example',
  automationAttempt: 'Attempt',
  automationViewDetail: 'View details',
  automation: 'Automation',
};

const manualExecutionMessages = {
  requestError: 'Request failed',
  retry: 'Try again',
  retryAfter: 'Retry after',
  correlationId: 'Correlation ID',
  manualExecution: 'Manual execution',
  manualExecutionFinished: 'Finished',
  manualExecutionStatus: 'Status',
  manualExecutionResult: 'Result',
  manualExecutionExpand: 'Expand manual execution details',
  manualExecutionCollapse: 'Collapse manual execution details',
  manualExecutionRunning: 'Running',
  manualExecutionPassed: 'Passed',
  manualExecutionFailed: 'Failed',
  manualExecutionCancelled: 'Cancelled',
  manualExecutionLoading: 'Loading manual execution…',
  manualExecutionActor: 'Actor',
  manualExecutionAssignee: 'Assignee',
  manualExecutionStartedAt: 'Started',
  manualExecutionFinishedAt: 'Finished',
  manualExecutionRevision: 'Revision',
  manualExecutionStale: 'The case changed.',
  manualExecutionHistorical: 'This is historical.',
  manualExecutionSourceDeleted: 'The source is unavailable.',
  manualExecutionEvidence: 'Evidence',
  manualExecutionEvidencePrivate: 'Evidence is private.',
  manualExecutionEvidenceEmpty: 'No evidence.',
  manualExecutionEvidenceDownload: 'Download',
  manualExecutionEvidencePreview: 'Preview',
  manualExecutionEvidenceOpen: 'Open image preview',
  manualExecutionEvidenceClose: 'Close image preview',
  manualExecutionUnavailable: 'Manual execution unavailable',
  manualExecutionReport: 'Failure findings and notes',
  manualExecutionReportComments: 'Comments remain shared.',
  manualExecutionReportFailureReason: 'Failure reason',
  manualExecutionReportHowToFix: 'How to fix',
  manualExecutionReportReproductionSteps: 'Reproduction steps',
  manualExecutionReportBrowser: 'Browser',
  manualExecutionReportEnvironment: 'Environment',
};

describe('AutomationHistory', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.useRealTimers();
    mocks.fetchHistory.mockReset();
    mocks.fetchManualHistory.mockReset();
    mocks.listEvidence.mockReset();
    mocks.downloadEvidence.mockReset();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: nativeCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: nativeRevokeObjectURL,
    });
  });

  it('discovers a RunCase execution after the initial history response is empty', async () => {
    vi.useFakeTimers();
    mocks.fetchHistory.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'execution-1',
        runCaseId: 12,
        exampleIndex: 0,
        status: 'running',
        queuedAt: '2026-08-28T12:00:00.000Z',
      },
    ]);
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <AutomationHistory
            projectId="10"
            runId="4"
            caseId="8"
            runCaseId={12}
            examples={{ headers: ['user'], rows: [['Ada']] }}
            locale="en"
            messages={messages as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(messages.automationHistoryEmpty);
    expect(mocks.fetchHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(750);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetchHistory).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Example 1: Ada');
    expect(container.textContent).toContain(messages.automationRunning);
  });

  it('renders a localized technical failure instead of the stored machine code', async () => {
    mocks.fetchHistory.mockResolvedValueOnce([
      {
        id: 'execution-error',
        runCaseId: 12,
        status: 'error',
        error: 'hercules_process_failed',
        queuedAt: '2026-08-28T12:00:00.000Z',
      },
    ]);
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <AutomationHistory
            projectId="10"
            runId="4"
            caseId="8"
            runCaseId={12}
            locale="en"
            messages={messages as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(messages.automationTechnicalFailure);
    expect(container.textContent).not.toContain('hercules_process_failed');
  });

  it('renders automation and manual executions in one chronological list', async () => {
    mocks.fetchHistory.mockResolvedValueOnce([
      {
        id: 'automation-1',
        runCaseId: 12,
        status: 'passed',
        queuedAt: '2026-08-28T12:00:00.000Z',
      },
    ]);
    mocks.fetchManualHistory.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            id: 4,
            runCaseId: 12,
            status: 'finished',
            result: 'failed',
            actorUserId: 7,
            caseRevision: 2,
            startedAt: '2026-08-28T12:05:00.000Z',
            finishedAt: '2026-08-28T12:06:00.000Z',
            report: { failureReason: 'Observed failure' },
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <AutomationHistory
            projectId="10"
            runId="4"
            caseId="8"
            runCaseId={12}
            locale="en"
            messages={messages as never}
            manualExecutionMessages={manualExecutionMessages as never}
          />
        </TokenContext.Provider>
      );
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(container.querySelectorAll('[data-history-entry]')).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-history-entry]')).map(
        (entry) => entry.dataset.historyEntry
      )
    ).toEqual(['manual', 'automation']);
    expect(container.querySelectorAll('#execution-history-heading')).toHaveLength(1);
    expect(container.textContent).toContain('Observed failure');
  });

  it('keeps manual history collapsed and lazily loads report details and evidence on expansion', async () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:manual-evidence-41'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });

    const failedExecution = {
      id: 4,
      projectId: 10,
      runId: 4,
      runCaseId: 12,
      caseId: 8,
      status: 'finished' as const,
      result: 'failed' as const,
      actorUserId: 7,
      assigneeUserId: 9,
      startedAt: '2026-08-28T12:05:00.000Z',
      finishedAt: '2026-08-28T12:06:00.000Z',
      caseRevision: 2,
      caseSnapshotHash: 'snapshot-4',
      stale: true,
      historical: true,
      sourceDeleted: false,
      correlationId: 'manual-correlation-4',
      report: {
        version: 1 as const,
        failureReason: 'Observed failure',
        howToFix: 'Apply the documented fix',
        reproductionSteps: 'Open the affected page',
        browser: 'Chromium',
        environment: 'Staging',
      },
    };
    const passedExecution = {
      ...failedExecution,
      id: 5,
      result: 'passed' as const,
      correlationId: 'manual-correlation-5',
      report: {
        ...failedExecution.report,
        failureReason: 'This passed finding must stay hidden',
      },
    };
    mocks.fetchHistory.mockResolvedValueOnce([]);
    mocks.fetchManualHistory.mockResolvedValueOnce({
      ok: true,
      data: { items: [failedExecution, passedExecution], total: 2, page: 1, limit: 20 },
    });
    mocks.listEvidence.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 41,
          executionId: 4,
          uploaderUserId: 7,
          filename: 'checkout.png',
          mimeType: 'image/png',
          size: 2048,
          sha256: 'sha-41',
          expiresAt: '2027-08-28T12:06:00.000Z',
          createdAt: '2026-08-28T12:05:30.000Z',
        },
      ],
    });
    mocks.downloadEvidence.mockResolvedValue({
      ok: true,
      data: { bytes: new ArrayBuffer(4), mimeType: 'image/png' },
    });

    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <AutomationHistory
            projectId="10"
            runId="4"
            caseId="8"
            runCaseId={12}
            locale="en"
            messages={messages as never}
            manualExecutionMessages={manualExecutionMessages as never}
          />
        </TokenContext.Provider>
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });

    const failedToggle = container.querySelector<HTMLButtonElement>('[data-testid="manual-history-toggle-4"]');
    expect(failedToggle).not.toBeNull();
    expect(failedToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="manual-history-details-4"]')).toBeNull();
    expect(container.querySelector('[data-testid="manual-history-evidence-open-41"]')).toBeNull();
    expect(container.textContent).not.toContain('Apply the documented fix');
    expect(container.textContent).not.toContain('This passed finding must stay hidden');
    expect(mocks.listEvidence).not.toHaveBeenCalled();
    expect(mocks.downloadEvidence).not.toHaveBeenCalled();

    await act(async () => {
      failedToggle?.click();
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });

    expect(failedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(mocks.listEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.listEvidence).toHaveBeenCalledWith('test-token', 4);
    expect(mocks.downloadEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.downloadEvidence).toHaveBeenCalledWith('test-token', 4, 41);
    expect(container.textContent).toContain('Apply the documented fix');
    expect(container.textContent).toContain('Open the affected page');
    expect(container.textContent).toContain('Chromium');
    expect(container.textContent).toContain('Staging');
    expect(container.textContent).toContain('checkout.png');
    expect(container.textContent).toContain('2 KB');
    expect(container.textContent).toContain('Finished');
    expect(container.textContent).toContain('Result');
    expect(container.textContent).toContain('Failed');
    expect(container.textContent).toContain('#7');
    expect(container.textContent).toContain('#9');
    expect(container.textContent).toContain('Revision');
    expect(container.textContent).toContain('The case changed.');
    expect(container.textContent).toContain('This is historical.');
    expect(container.textContent).toContain('manual-correlation-4');
    expect(container.textContent).not.toContain('This passed finding must stay hidden');
    expect(container.querySelector('[data-testid="manual-history-report-4"]')).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>('[data-testid="manual-history-evidence-preview-41"]')?.src).toBe(
      'blob:manual-evidence-41'
    );
    const openPreviewButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="manual-history-evidence-open-41"]'
    );
    expect(openPreviewButton).not.toBeNull();
    expect(openPreviewButton?.getAttribute('aria-label')).toBe('Open image preview: checkout.png');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="manual-history-details-5"]')).toBeNull();
    expect(mocks.listEvidence).not.toHaveBeenCalledWith('test-token', 5);

    await act(async () => {
      openPreviewButton?.click();
      await Promise.resolve();
    });

    const previewDialog = container.querySelector<HTMLElement>('[data-testid="manual-history-evidence-dialog-4"]');
    expect(previewDialog).not.toBeNull();
    expect(previewDialog?.getAttribute('role')).toBe('dialog');
    expect(previewDialog?.getAttribute('aria-modal')).toBe('true');
    expect(previewDialog?.getAttribute('aria-labelledby')).toBe('manual-history-evidence-preview-title-4');
    expect(
      container.querySelector<HTMLImageElement>('[data-testid="manual-history-evidence-lightbox-image-4"]')?.src
    ).toBe('blob:manual-evidence-41');
    expect(container.querySelector('[data-testid="manual-history-evidence-close-4"]')?.textContent).toBe(
      'Close image preview'
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="manual-history-evidence-close-4"]')?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="manual-history-evidence-open-41"]')?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      failedToggle?.click();
      await Promise.resolve();
    });

    expect(failedToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="manual-history-details-4"]')).toBeNull();
    expect(container.textContent).not.toContain('Apply the documented fix');
    expect(container.textContent).not.toContain('checkout.png');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:manual-evidence-41');
  });
});
