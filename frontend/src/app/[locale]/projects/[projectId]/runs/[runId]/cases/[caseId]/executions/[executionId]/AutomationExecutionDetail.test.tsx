/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AutomationExecutionDetail from './AutomationExecutionDetail';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({ fetchExecution: vi.fn(), fetchArtifacts: vi.fn(), downloadArtifact: vi.fn() }));

vi.mock('@/utils/automationControl', async () => {
  const actual = await vi.importActual<typeof import('@/utils/automationControl')>('@/utils/automationControl');
  return {
    ...actual,
    fetchAutomationExecution: mocks.fetchExecution,
    fetchAutomationArtifacts: mocks.fetchArtifacts,
    downloadAutomationArtifact: mocks.downloadArtifact,
  };
});

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
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
  automationExecutionDetail: 'Automation execution detail',
  automationBackToHistory: 'Back to history',
  automationQueued: 'Queued',
  automationRetrying: 'Retrying',
  automationRunning: 'Running',
  automationPassed: 'Passed',
  automationFailed: 'Failed',
  automationError: 'Error',
  automationEvidenceInsufficient: 'Evidence insufficient',
  automationCancelled: 'Cancelled',
  automationTimeout: 'Timed out',
  automationTimeoutDetail:
    'Hercules exceeded the execution time limit. Review the process output, then retry the execution.',
  automationTechnicalFailure: 'A technical failure stopped the execution. Check the environment and retry.',
  automationFunctionalFailure: 'The scenario did not pass. Review the execution evidence and expected result.',
  automationEvidenceFailure: 'The execution could not be verified because required evidence is missing or unsafe.',
  automationCancelledDetail: 'The execution was cancelled before it completed.',
  automationGenericFailure: 'The automation could not be completed. Review the details and try again.',
  automationDiagnosticsAvailable: 'Observed process diagnostics are available below.',
  automationVideoDescription: 'Recorded browser execution video. Use the controls to play, pause, or seek.',
  automationAttempt: 'Attempt',
  automationDuration: 'Duration',
  automationQueuedAt: 'Queued',
  automationStartedAt: 'Started',
  automationFinishedAt: 'Finished',
  automationExample: 'Example row',
  automationAttemptHistory: 'Attempt history',
  automationEngine: 'Engine',
  automationModel: 'Model',
  automationEnvironmentId: 'Environment',
  automationCorrelationId: 'Correlation ID',
  automationSnapshotHash: 'Snapshot hash',
  automationWorkerStatus: 'Worker status',
  automationSnapshot: 'Canonical snapshot',
  automationTimeline: 'Execution timeline',
  automationDiagnostics: 'Failure diagnostics',
  automationExitCode: 'Exit code',
  automationSignal: 'Signal',
  automationOutput: 'Process output',
  automationNoDiagnostics: 'No additional process diagnostics were captured.',
  automationEvidence: 'Evidence',
  automationNoEvidence: 'No evidence available',
  automationNoVideo: 'Video capture was disabled for this execution.',
  automationVideo: 'Video',
  downloadAutomationArtifact: 'Download',
  automationUnavailable: 'Automation is unavailable',
  automationLoading: 'Loading automation',
};

describe('AutomationExecutionDetail', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    mocks.fetchExecution.mockReset();
    mocks.fetchArtifacts.mockReset();
    mocks.downloadArtifact.mockReset();
    vi.unstubAllGlobals();
  });

  it('shows actionable translated timeout feedback instead of the internal timeout code', async () => {
    mocks.fetchExecution.mockResolvedValue({
      id: 'e-timeout',
      projectId: 10,
      caseId: 7,
      status: 'error',
      attempt: 1,
      error: 'hercules_timeout',
      diagnostics: { timedOut: true },
      events: [
        { id: 'queued', executionId: 'e-timeout', attempt: 1, sequence: 110, type: 'queued' },
        {
          id: 'error',
          executionId: 'e-timeout',
          attempt: 1,
          sequence: 130,
          type: 'error',
          message: 'hercules_timeout',
        },
      ],
    });
    mocks.fetchArtifacts.mockResolvedValue([]);
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <AutomationExecutionDetail
            projectId="10"
            runId="4"
            caseId="7"
            executionId="e-timeout"
            locale="en"
            messages={messages as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(messages.automationTimeout);
    expect(container.textContent).toContain(messages.automationTimeoutDetail);
    expect(container.textContent).not.toContain('hercules_timeout');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('uses localized worker feedback instead of rendering machine event identifiers', async () => {
    const machineWorkerEvent = 'job-42:result:technical_error';
    const machineAttemptStatus = 'technical_error';
    mocks.fetchExecution.mockResolvedValue({
      id: 'e-technical',
      projectId: 10,
      caseId: 7,
      status: 'error',
      attempt: 1,
      error: 'hercules_result_error',
      errorKind: 'technical',
      lastWorkerEvent: machineWorkerEvent,
      lastAttemptStatus: machineAttemptStatus,
    });
    mocks.fetchArtifacts.mockResolvedValue([]);
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <AutomationExecutionDetail
            projectId="10"
            runId="4"
            caseId="7"
            executionId="e-technical"
            locale="en"
            messages={messages as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const workerStatusLabel = Array.from(container.querySelectorAll('dt')).find(
      (element) => element.textContent === messages.automationWorkerStatus
    )?.nextElementSibling;
    expect(workerStatusLabel?.textContent).toBe(messages.automationTechnicalFailure);
    expect(container.textContent).not.toContain(machineWorkerEvent);
    expect(container.textContent).not.toContain(machineAttemptStatus);
  });

  it('associates captured video with a translated accessible description', async () => {
    mocks.fetchExecution.mockResolvedValue({
      id: 'e-video',
      projectId: 10,
      caseId: 7,
      status: 'passed',
      captureVideo: true,
    });
    mocks.fetchArtifacts.mockResolvedValue([
      { id: 'video-1', kind: 'video', mimeType: 'video/webm', filename: 'run.webm' },
    ]);
    mocks.downloadArtifact.mockResolvedValue({ content: 'dmlkZW8=', encoding: 'base64', mimeType: 'video/webm' });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:video'),
      revokeObjectURL: vi.fn(),
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <AutomationExecutionDetail
            projectId="10"
            runId="4"
            caseId="7"
            executionId="e-video"
            locale="en"
            messages={messages as never}
          />
        </TokenContext.Provider>
      );
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });

    const video = container.querySelector('video');
    const descriptionId = video?.getAttribute('aria-describedby');
    expect(video).not.toBeNull();
    expect(descriptionId).toBeTruthy();
    expect(descriptionId && container.querySelector(`#${descriptionId}`)?.textContent).toBe(
      messages.automationVideoDescription
    );
  });
});
