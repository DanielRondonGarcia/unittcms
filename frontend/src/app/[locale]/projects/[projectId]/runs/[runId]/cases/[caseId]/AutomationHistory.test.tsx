/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AutomationHistory from './AutomationHistory';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({ fetchHistory: vi.fn() }));

vi.mock('@/utils/automationControl', async () => {
  const actual = await vi.importActual<typeof import('@/utils/automationControl')>('@/utils/automationControl');
  return { ...actual, fetchAutomationHistory: mocks.fetchHistory };
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
});
