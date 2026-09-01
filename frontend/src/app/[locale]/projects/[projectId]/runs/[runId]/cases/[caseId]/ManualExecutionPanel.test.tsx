/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ManualExecutionPanel from './ManualExecutionPanel';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  active: vi.fn(),
  finish: vi.fn(),
  updateReport: vi.fn(),
  cancel: vi.fn(),
  listEvidence: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/utils/manualExecutionControl', () => ({
  startManualExecution: mocks.start,
  fetchActiveManualExecution: mocks.active,
  finishManualExecution: mocks.finish,
  updateManualExecutionReport: mocks.updateReport,
  cancelManualExecution: mocks.cancel,
  listManualEvidence: mocks.listEvidence,
  uploadManualEvidence: mocks.upload,
  downloadManualEvidence: mocks.download,
  deleteManualEvidence: mocks.remove,
  isAllowedManualEvidenceFile: () => true,
  manualEvidenceError: (code: string, message: string) => ({ status: 400, code, message }),
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
});

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
    ...props
  }: {
    children?: React.ReactNode;
    onPress?: () => void | Promise<void>;
    isDisabled?: boolean;
    isLoading?: boolean;
    [key: string]: unknown;
  }) => (
    <button {...props} disabled={isDisabled} aria-busy={isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Modal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
  ModalContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const messages = {
  requestError: 'Request error',
  retry: 'Retry',
  retryAfter: 'Retry after',
  correlationId: 'Correlation ID',
  manualExecution: 'Manual execution',
  manualExecutionStart: 'Start manual execution',
  manualExecutionLoading: 'Loading manual execution',
  manualExecutionEmpty: 'No active manual execution',
  manualExecutionRunning: 'Running',
  manualExecutionPassed: 'Passed',
  manualExecutionFailed: 'Failed',
  manualExecutionCancelled: 'Cancelled',
  manualExecutionFinishPassed: 'Finish as passed',
  manualExecutionFinishFailed: 'Finish as failed',
  manualExecutionFinishFailedConfirm: 'Confirm and save failure',
  manualExecutionReportBack: 'Back to execution',
  manualExecutionCancel: 'Cancel execution',
  manualExecutionActor: 'Execution actor',
  manualExecutionAssignee: 'RunCase assignee',
  manualExecutionStartedAt: 'Started',
  manualExecutionFinishedAt: 'Finished',
  manualExecutionRevision: 'Case revision',
  manualExecutionStale: 'The case changed after execution started.',
  manualExecutionHistorical: 'Historical execution',
  manualExecutionSourceDeleted: 'The source RunCase is unavailable.',
  manualExecutionEvidence: 'Evidence',
  manualExecutionEvidencePrivate: 'Authorized project members can access this evidence.',
  manualExecutionEvidenceEmpty: 'No evidence uploaded',
  manualExecutionEvidenceUpload: 'Upload PNG or JPEG evidence',
  manualExecutionEvidenceDownload: 'Download',
  manualExecutionEvidenceDelete: 'Delete',
  manualExecutionEvidenceDeleteConfirm: 'Are you sure you want to delete this evidence attachment?',
  manualExecutionEvidenceDeleteCancel: 'Close',
  manualExecutionUnavailable: 'Manual execution is unavailable.',
  manualExecutionUnauthorized: 'Project membership is required.',
  manualExecutionEvidenceType: 'Only PNG or JPEG evidence is accepted.',
  manualExecutionEvidenceSize: 'Evidence must be 10 MiB or smaller.',
  manualExecutionEvidenceLimit: 'The evidence limit has been reached.',
  manualExecutionReport: 'Failure findings and notes',
  manualExecutionReportDescription: 'Capture the observed result and the context needed to fix or reproduce it.',
  manualExecutionReportFailureReason: 'Observed result / failure reason',
  manualExecutionReportHowToFix: 'How to fix / remediation',
  manualExecutionReportReproductionSteps: 'Reproduction steps',
  manualExecutionReportBrowser: 'Browser',
  manualExecutionReportEnvironment: 'Environment',
  manualExecutionReportFieldLimit: 'Up to 4,000 characters per field and 16,000 characters total.',
  manualExecutionReportSave: 'Confirm and save failure',
  manualExecutionReportSaving: 'Saving report…',
  manualExecutionReportSaved: 'Failure saved.',
  manualExecutionReportUnsaved: 'Unsaved changes',
  manualExecutionReportEmpty: 'No report details were saved.',
  manualExecutionReportComments: 'Use the RunCase Comments tab for discussion.',
  manualExecutionReportTooLong: 'The report exceeds the 16,000-character total. Remove some text before saving.',
  manualExecutionActorHint: 'Recorded automatically from the signed-in test actor.',
  manualExecutionEvidencePaste: 'Paste a PNG or JPEG from the clipboard',
  manualExecutionEvidenceDrop: 'Drop an image here or choose a file',
  manualExecutionEvidenceUploading: 'Uploading attachment…',
  manualExecutionEvidenceUploaded: 'Attachment uploaded.',
  manualExecutionEvidenceUploadFailed: 'Attachment upload failed.',
  manualExecutionEvidencePreview: 'Attachment preview',
  manualExecutionReportUnavailable: 'Failure details could not be saved. Try again.',
};

const runningExecution = {
  id: 4,
  projectId: 10,
  runId: 3,
  runCaseId: 12,
  caseId: 8,
  actorUserId: 7,
  assigneeUserId: 9,
  status: 'running' as const,
  result: null,
  startedAt: '2026-08-30T10:00:00.000Z',
  finishedAt: null,
  caseRevision: 2,
  caseSnapshotHash: 'a'.repeat(64),
  stale: false,
  historical: false,
  sourceDeleted: false,
  correlationId: 'manual-4',
};

const evidence = {
  id: 6,
  executionId: 4,
  uploaderUserId: 7,
  filename: 'proof.png',
  mimeType: 'image/png' as const,
  size: 8,
  sha256: 'b'.repeat(64),
  expiresAt: '2026-09-29T10:00:00.000Z',
  createdAt: '2026-08-30T10:01:00.000Z',
};

const uploadedEvidence = {
  ...evidence,
  id: 7,
  filename: 'uploaded.png',
};

const savedReport = {
  version: 1 as const,
  failureReason: 'The action failed visibly.',
  howToFix: 'Apply the latest release.',
  reproductionSteps: 'Open the case and submit it.',
  browser: 'Chrome 140',
  environment: 'Staging',
};

const contextValue = {
  token: { access_token: 'test-token', user: { id: 7 } },
  isSignedIn: () => true,
  isProjectMember: () => true,
  isProjectReporter: () => true,
};

const memberContextValue = {
  ...contextValue,
  isProjectMember: () => true,
  isProjectReporter: () => false,
};

const nonMemberContextValue = {
  ...contextValue,
  isProjectMember: () => false,
  isProjectReporter: () => false,
};

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ManualExecutionPanel', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.active.mockResolvedValue({ ok: true, data: null });
    mocks.listEvidence.mockResolvedValue({ ok: true, data: [] });
    mocks.start.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.finish.mockResolvedValue({
      ok: true,
      data: {
        ...runningExecution,
        status: 'finished',
        result: 'passed',
        finishedAt: '2026-08-30T10:02:00.000Z',
        stale: true,
        report: savedReport,
      },
    });
    mocks.updateReport.mockResolvedValue({ ok: true, data: { ...runningExecution, report: savedReport } });
    mocks.cancel.mockResolvedValue({ ok: true, data: { ...runningExecution, status: 'cancelled' } });
    mocks.remove.mockResolvedValue({ ok: true, data: undefined });
    mocks.download.mockResolvedValue({ ok: true, data: { bytes: new ArrayBuffer(1), mimeType: 'image/png' } });
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.unstubAllGlobals();
  });

  function renderPanel() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    return { container, root };
  }

  it('starts and finishes one aggregate result while showing actor, assignee, revision, and stale state', async () => {
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    expect(container.textContent).toContain(messages.manualExecutionEmpty);
    await act(async () => {
      container.querySelector('button')?.click();
      await settle();
    });
    expect(mocks.start).toHaveBeenCalledWith('test-token', 12);
    expect(container.textContent).toContain(messages.manualExecutionRunning);
    expect(container.textContent).toContain('#7');
    expect(container.textContent).toContain('#9');
    expect(container.textContent).toContain('2');
    expect(container.querySelector('[translate="no"]')?.textContent).toBe('manual-4');
    const evidenceEditor = container.querySelector('[data-testid="manual-execution-evidence-editor"]');
    const actionButtons = container.querySelector('[data-testid="manual-execution-actions"]');
    expect(
      evidenceEditor && actionButtons
        ? Boolean(evidenceEditor.compareDocumentPosition(actionButtons) & Node.DOCUMENT_POSITION_FOLLOWING)
        : false
    ).toBe(true);

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionFinishPassed)
        ?.click();
      await settle();
    });
    expect(mocks.finish).toHaveBeenCalledWith('test-token', 4, 'passed');
    expect(container.textContent).toContain(messages.manualExecutionPassed);
    expect(container.textContent).toContain(messages.manualExecutionStale);
    expect(container.textContent).not.toContain(messages.manualExecutionFinishFailed);
    expect(container.querySelector('[data-testid="manual-execution-findings"]')).toBeNull();
  });

  it('reveals failure findings first and sends them only when failure is confirmed', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    expect(container.querySelector('[data-testid="manual-execution-editor"]')).toBeNull();
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionFinishFailed)
        ?.click();
      await settle();
    });
    const failureTrigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.manualExecutionFinishFailedConfirm
    ) as HTMLButtonElement;
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(failureTrigger.type).toBe('button');
    expect(failureTrigger.getAttribute('form')).toBeNull();
    expect(failureTrigger.form).toBeNull();
    expect(container.querySelector('[data-testid="manual-execution-editor"]')).not.toBeNull();
    const evidenceEditor = container.querySelector('[data-testid="manual-execution-evidence-editor"]');
    const failureEditor = container.querySelector('[data-testid="manual-execution-editor"]');
    expect(
      evidenceEditor && failureEditor
        ? Boolean(evidenceEditor.compareDocumentPosition(failureEditor) & Node.DOCUMENT_POSITION_FOLLOWING)
        : false
    ).toBe(true);

    const failureReason = container.querySelector(
      'textarea[name="manual-execution-report-failureReason"]'
    ) as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(failureReason, savedReport.failureReason);
    await act(async () => {
      failureReason.dispatchEvent(new Event('input', { bubbles: true }));
      failureReason.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    });
    expect(container.textContent).toContain(messages.manualExecutionReportUnsaved);

    mocks.finish.mockResolvedValueOnce({
      ok: true,
      data: {
        ...runningExecution,
        status: 'finished',
        result: 'failed',
        finishedAt: '2026-08-30T10:02:00.000Z',
        report: savedReport,
      },
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionFinishFailedConfirm)
        ?.click();
      await settle();
    });
    expect(mocks.updateReport).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(
      'test-token',
      4,
      'failed',
      expect.objectContaining({ failureReason: savedReport.failureReason })
    );
    expect(container.querySelector('[data-testid="manual-execution-findings"]')).not.toBeNull();
    expect(container.textContent).toContain(savedReport.failureReason);
  });

  it('blocks save and finish with an actionable aggregate report limit message', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionFinishFailed)
        ?.click();
      await settle();
    });

    const fieldValues = {
      failureReason: 'a'.repeat(4_000),
      howToFix: 'b'.repeat(4_000),
      reproductionSteps: 'c'.repeat(4_000),
      browser: 'd',
      environment: 'e'.repeat(4_000),
    };
    await act(async () => {
      for (const [field, value] of Object.entries(fieldValues)) {
        const element = container.querySelector(`[name="manual-execution-report-${field}"]`) as
          | HTMLInputElement
          | HTMLTextAreaElement;
        const prototype =
          element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        valueSetter?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await settle();
    });

    expect(container.textContent).toContain(messages.manualExecutionReportTooLong);
    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.manualExecutionFinishFailedConfirm
    ) as HTMLButtonElement;
    expect(confirmButton.type).toBe('button');
    expect(confirmButton.getAttribute('form')).toBeNull();
    expect(confirmButton.form).toBeNull();
    await act(async () => {
      confirmButton.click();
      await settle();
    });
    expect(mocks.updateReport).not.toHaveBeenCalled();

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionFinishFailedConfirm)
        ?.click();
      await settle();
    });
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it('allows a project member who is not a reporter to use manual mutations', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.listEvidence.mockResolvedValue({ ok: true, data: [evidence] });
    mocks.finish.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.cancel.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.updateReport.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.upload.mockResolvedValue({ ok: true, data: uploadedEvidence });

    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={memberContextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    expect(container.querySelector('[data-testid="manual-execution-editor"]')).toBeNull();

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionFinishFailed)
        ?.click();
      await settle();
    });
    expect(container.querySelector('[data-testid="manual-execution-editor"]')).not.toBeNull();
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false);
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionReportBack)
        ?.click();
      await settle();
    });
    expect(mocks.updateReport).not.toHaveBeenCalled();

    await act(async () => {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const uploadFile = new File([new Uint8Array(1)], 'uploaded.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { configurable: true, value: [uploadFile] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    });
    expect(mocks.upload).toHaveBeenCalledWith('test-token', 4, expect.any(File), expect.any(AbortSignal));

    const deleteButton = container.querySelector('button[aria-label="Delete: proof.png"]') as HTMLButtonElement;
    await act(async () => {
      deleteButton.click();
      await settle();
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    await act(async () => {
      Array.from(dialog.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionEvidenceDelete)
        ?.click();
      await settle();
    });
    expect(mocks.remove).toHaveBeenCalledWith('test-token', 4, 6);

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionCancel)
        ?.click();
      await settle();
    });
    expect(mocks.cancel).toHaveBeenCalledWith('test-token', 4);
  });

  it('guards every running manual mutation for a user who is not a project member', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.listEvidence.mockResolvedValue({ ok: true, data: [evidence] });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={nonMemberContextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    const finishPassed = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.manualExecutionFinishPassed
    ) as HTMLButtonElement;
    const finishFailed = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.manualExecutionFinishFailed
    ) as HTMLButtonElement;
    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.manualExecutionCancel
    ) as HTMLButtonElement;
    const saveButton = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    const uploadInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const deleteButton = container.querySelector('button[aria-label="Delete: proof.png"]') as HTMLButtonElement;

    expect(finishPassed.disabled).toBe(true);
    expect(finishFailed.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
    expect(saveButton).toBeNull();
    expect(uploadInput.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);

    const file = new File([new Uint8Array(1)], 'blocked.png', { type: 'image/png' });
    Object.defineProperty(uploadInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      finishPassed.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      finishFailed.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
    });

    expect(mocks.updateReport).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('guards manual execution start for a user who is not a project member', async () => {
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={nonMemberContextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    const startButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.manualExecutionStart
    ) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('keeps evidence private, confirms deletion, downloads through the client, and hides deletion after finish', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.listEvidence.mockResolvedValue({ ok: true, data: [evidence] });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    expect(container.textContent).toContain(messages.manualExecutionEvidence);
    expect(container.textContent).not.toContain('Private evidence');
    expect(container.querySelector('input[accept="image/png,image/jpeg"]')).not.toBeNull();
    const downloadButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(messages.manualExecutionEvidenceDownload)
    );
    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(messages.manualExecutionEvidenceDelete)
    );
    expect(deleteButton).not.toBeNull();
    await act(async () => {
      deleteButton?.click();
      await settle();
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      messages.manualExecutionEvidenceDeleteConfirm
    );
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
        .find((button) => button.textContent === messages.manualExecutionEvidenceDeleteCancel)
        ?.click();
      await settle();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      downloadButton?.click();
      await settle();
    });
    expect(mocks.download).toHaveBeenCalledWith('test-token', 4, 6);

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionFinishPassed)
        ?.click();
      await settle();
    });
    expect(container.textContent).toContain('proof.png');
    expect(container.querySelector('button[aria-label*="Delete"]')).toBeNull();
  });

  it('shows visible upload feedback for pasted and rejected evidence', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.upload.mockResolvedValueOnce({ ok: true, data: evidence }).mockResolvedValueOnce({
      ok: false,
      error: {
        status: 413,
        code: 'evidence_size_exceeded',
        message: 'evidence_size_exceeded',
      },
    });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    const editor = container.querySelector('[data-testid="manual-execution-evidence-editor"]') as HTMLDivElement;
    expect(editor.tabIndex).toBe(0);
    expect(editor.getAttribute('aria-labelledby')).toBe('manual-evidence-heading');
    expect(editor.getAttribute('aria-describedby')).toBe(
      'manual-evidence-paste-instructions manual-evidence-drop-instructions'
    );
    editor.focus();
    expect(document.activeElement).toBe(editor);
    const clipboardFile = new File([Uint8Array.from([137, 80, 78, 71])], 'clipboard.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { items: [{ type: 'image/png', getAsFile: () => clipboardFile }] },
    });
    await act(async () => {
      editor.dispatchEvent(pasteEvent);
      await settle();
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      'test-token',
      4,
      expect.objectContaining({ type: 'image/png' }),
      expect.any(AbortSignal)
    );
    expect(container.textContent).toContain(messages.manualExecutionEvidenceUploaded);
    expect(container.textContent).toContain(evidence.filename);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const rejectedFile = new File([new Uint8Array(1)], 'too-large.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [rejectedFile] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    });
    expect(container.textContent).toContain(messages.manualExecutionEvidenceUploadFailed);
    expect(container.textContent).toContain('too-large.png');
  });

  it('uploads one pasted clipboard image from the evidence editor', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    mocks.upload.mockResolvedValue({ ok: true, data: evidence });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    const evidenceEditor = container.querySelector(
      '[data-testid="manual-execution-evidence-editor"]'
    ) as HTMLDivElement;
    const clipboardFile = new File([Uint8Array.from([137, 80, 78, 71])], 'evidence-paste.png', {
      type: 'image/png',
    });
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { items: [{ type: 'image/png', getAsFile: () => clipboardFile }] },
    });

    await act(async () => {
      evidenceEditor.dispatchEvent(pasteEvent);
      await settle();
    });

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledWith(
      'test-token',
      4,
      expect.objectContaining({ type: 'image/png' }),
      expect.any(AbortSignal)
    );
  });

  it('aborts an in-flight upload when the execution is cancelled and ignores its late response', async () => {
    mocks.active.mockResolvedValue({ ok: true, data: runningExecution });
    let resolveUpload: ((value: unknown) => void) | undefined;
    let uploadSignal: AbortSignal | undefined;
    mocks.upload.mockImplementationOnce(
      (_jwt: string, _executionId: number, _file: File, signal: AbortSignal) =>
        new Promise((resolve) => {
          resolveUpload = resolve;
          uploadSignal = signal;
        })
    );
    mocks.cancel.mockResolvedValueOnce({
      ok: true,
      data: {
        ...runningExecution,
        status: 'cancelled',
        finishedAt: '2026-08-30T10:03:00.000Z',
        report: savedReport,
      },
    });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(1)], 'late.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    });
    expect(uploadSignal?.aborted).toBe(false);

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.manualExecutionCancel)
        ?.click();
      await settle();
    });
    expect(uploadSignal?.aborted).toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith('test-token', 4);

    await act(async () => {
      resolveUpload?.({ ok: true, data: uploadedEvidence });
      await settle();
    });
    expect(container.textContent).not.toContain(uploadedEvidence.filename);
    expect(container.querySelector('[data-testid="manual-execution-findings"]')).toBeNull();
  });

  it('renders a typed 429 error with correlation and retries the failed active request', async () => {
    mocks.active
      .mockResolvedValueOnce({
        ok: false,
        error: {
          status: 429,
          code: 'rate_limited',
          message: 'rate_limited',
          correlationId: 'corr-429',
          retryAfterSeconds: 45,
        },
      })
      .mockResolvedValueOnce({ ok: true, data: null });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 429');
    expect(container.textContent).toContain('corr-429');
    expect(container.textContent).toContain('45s');

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === messages.retry)
        ?.click();
      await settle();
    });
    expect(mocks.active).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(messages.manualExecutionEmpty);
  });

  it('localizes an unauthorized action without exposing the machine error code', async () => {
    mocks.start.mockResolvedValueOnce({
      ok: false,
      error: {
        status: 403,
        code: 'project_membership_required',
        message: 'project_membership_required',
        correlationId: 'corr-403',
      },
    });
    const { container, root } = renderPanel();
    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ManualExecutionPanel projectId="10" runCaseId={12} locale="en" messages={messages as never} />
        </TokenContext.Provider>
      );
      await settle();
    });
    await act(async () => {
      container.querySelector('button')?.click();
      await settle();
    });
    expect(container.textContent).toContain(messages.manualExecutionUnauthorized);
    expect(container.textContent).toContain('corr-403');
    expect(container.textContent).not.toContain('project_membership_required');
  });
});
