/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import AutomationTimeline from './AutomationTimeline';

const messages = {
  automationTimeline: 'Execution timeline',
  automationQueued: 'Queued',
  automationRetrying: 'Retrying',
  automationRunning: 'Running',
  automationPassed: 'Passed',
  automationFailed: 'Failed',
  automationError: 'Error',
  automationCancelled: 'Cancelled',
  automationTimeout: 'Timed out',
  automationTimeoutDetail: 'Review the process output, then retry the execution.',
  automationTechnicalFailure: 'A technical failure stopped the execution. Check the environment and retry.',
  automationFunctionalFailure: 'The scenario did not pass. Review the execution evidence and expected result.',
  automationEvidenceFailure: 'The execution could not be verified because required evidence is missing or unsafe.',
  automationCancelledDetail: 'The execution was cancelled before it completed.',
  automationGenericFailure: 'The automation could not be completed. Review the details and try again.',
};

describe('AutomationTimeline', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
  });

  it('renders retrying as its own localized status instead of queued', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <AutomationTimeline
          execution={{
            id: 'e1',
            status: 'queued',
            attempt: 2,
            events: [
              { id: 'queued', executionId: 'e1', attempt: 1, sequence: 110, type: 'queued' },
              {
                id: 'retrying',
                executionId: 'e1',
                attempt: 2,
                sequence: 205,
                type: 'retrying',
                message: 'Retry queued',
              },
            ],
          }}
          locale="en"
          messages={messages as never}
        />
      );
    });

    expect(Array.from(container.querySelectorAll('p')).map((item) => item.textContent)).toEqual(['Queued', 'Retrying']);
    expect(container.textContent).not.toContain('Retry queued');
    expect(container.querySelector('[aria-labelledby="timeline-e1"]')).not.toBeNull();
    expect(container.querySelector('.bg-warning')).not.toBeNull();
  });

  it('renders a technical event with translated feedback instead of its machine code', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <AutomationTimeline
          execution={{
            id: 'e2',
            status: 'error',
            events: [
              {
                id: 'error',
                executionId: 'e2',
                attempt: 1,
                sequence: 130,
                type: 'error',
                message: 'hercules_process_failed',
              },
            ],
          }}
          locale="en"
          messages={messages as never}
        />
      );
    });

    expect(container.textContent).toContain(messages.automationTechnicalFailure);
    expect(container.textContent).not.toContain('hercules_process_failed');
  });
});
