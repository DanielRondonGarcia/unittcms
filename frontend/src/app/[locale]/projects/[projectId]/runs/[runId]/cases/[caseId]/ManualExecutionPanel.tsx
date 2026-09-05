'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { Button } from '@heroui/react';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import { TokenContext } from '@/utils/TokenProvider';
import {
  cancelManualExecution,
  deleteManualEvidence,
  downloadManualEvidence,
  fetchActiveManualExecution,
  finishManualExecution,
  isAllowedManualEvidenceFile,
  listManualEvidence,
  manualEvidenceError,
  startManualExecution,
  uploadManualEvidence,
} from '@/utils/manualExecutionControl';
import {
  MANUAL_EXECUTION_REPORT_VERSION,
  MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH,
  MAX_MANUAL_EXECUTION_REPORT_LENGTH,
  MAX_MANUAL_EVIDENCE_BYTES,
  MAX_MANUAL_EVIDENCE_FILES,
  type ManualEvidenceView,
  type ManualExecutionMessages,
  type ManualExecutionReport,
  type ManualExecutionReportField,
  type ManualExecutionResult,
  type ManualExecutionView,
} from '@/types/manualExecution';
import type { ApiError, ApiResult } from '@/utils/apiResult';

type Props = {
  projectId: string;
  runCaseId: number;
  locale: string;
  messages: ManualExecutionMessages;
};

type ReportStatus = 'idle' | 'dirty' | 'saving' | 'error';
type UploadStatus = 'uploading' | 'uploaded' | 'failed';
type UploadFeedback = { filename: string; status: UploadStatus };

const REPORT_FIELDS: ManualExecutionReportField[] = [
  'failureReason',
  'howToFix',
  'reproductionSteps',
  'browser',
  'environment',
];

function emptyReport(): ManualExecutionReport {
  return {
    version: MANUAL_EXECUTION_REPORT_VERSION,
    failureReason: '',
    howToFix: '',
    reproductionSteps: '',
    browser: '',
    environment: '',
  };
}

function reportDraft(report: ManualExecutionView['report']): ManualExecutionReport {
  return report ? { ...emptyReport(), ...report } : emptyReport();
}

function hasReportContent(report: ManualExecutionReport | null | undefined): boolean {
  return Boolean(report && REPORT_FIELDS.some((field) => report[field].trim()));
}

function normalizedReportFieldLength(value: string): number {
  return Array.from(value.replace(/\r\n?/g, '\n').trim()).length;
}

function reportCharacterCount(report: ManualExecutionReport): number {
  return REPORT_FIELDS.reduce((total, field) => total + normalizedReportFieldLength(report[field]), 0);
}

function reportFieldLabel(field: ManualExecutionReportField, messages: ManualExecutionMessages): string {
  if (field === 'failureReason') return messages.manualExecutionReportFailureReason;
  if (field === 'howToFix') return messages.manualExecutionReportHowToFix;
  if (field === 'reproductionSteps') return messages.manualExecutionReportReproductionSteps;
  if (field === 'browser') return messages.manualExecutionReportBrowser;
  return messages.manualExecutionReportEnvironment;
}

function timestamp(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatSize(size: number, locale: string): string {
  const kilobytes = Math.ceil(size / 1024);
  try {
    return `${new Intl.NumberFormat(locale).format(kilobytes)} KB`;
  } catch {
    return `${kilobytes} KB`;
  }
}

function statusLabel(execution: ManualExecutionView, messages: ManualExecutionMessages): string {
  if (execution.status === 'running') return messages.manualExecutionRunning;
  if (execution.status === 'cancelled') return messages.manualExecutionCancelled;
  return execution.result === 'passed' ? messages.manualExecutionPassed : messages.manualExecutionFailed;
}

function errorMessage(error: ApiError, messages: ManualExecutionMessages): string {
  if (error.status === 401 || error.status === 403) return messages.manualExecutionUnauthorized;
  if (error.code === 'report_too_long') return messages.manualExecutionReportTooLong;
  if (error.code.startsWith('report_')) return messages.manualExecutionReportUnavailable;
  if (error.code.includes('mime') || error.code.includes('extension') || error.code.includes('content_invalid'))
    return messages.manualExecutionEvidenceType;
  if (error.code.includes('size')) return messages.manualExecutionEvidenceSize;
  if (error.code === 'evidence_limit_exceeded') return messages.manualExecutionEvidenceLimit;
  return messages.manualExecutionUnavailable;
}

function displayFilename(filename: string): string {
  return filename.replace(/[\r\n"\\/]/g, '_').slice(0, 255) || 'evidence';
}

function canCreateObjectUrl(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

function revokeObjectUrl(url: string): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

export function createClipboardImageFile(item: Pick<DataTransferItem, 'type' | 'getAsFile'>): File | null {
  const source = item.getAsFile();
  if (!source) return null;
  const mimeType =
    item.type === 'image/png' || item.type === 'image/jpeg'
      ? item.type
      : source.type === 'image/png' || source.type === 'image/jpeg'
        ? source.type
        : null;
  if (!mimeType) return null;
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const timestampValue = Date.now();
  return new File([source], `manual-execution-${timestampValue}.${extension}`, { type: mimeType });
}

function ErrorState({
  error,
  messages,
  onRetry,
}: {
  error: ApiError;
  messages: ManualExecutionMessages;
  onRetry?: () => void | Promise<void>;
}) {
  return (
    <div className="mt-3 min-w-0 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700" role="alert">
      <p className="font-semibold">{messages.requestError}</p>
      <p className="break-words text-sm">{errorMessage(error, messages)}</p>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs">
        {error.status > 0 && <span>HTTP {error.status}</span>}
        {error.correlationId && (
          <span className="min-w-0 break-all">
            {messages.correlationId}: <code translate="no">{error.correlationId}</code>
          </span>
        )}
        {error.retryAfterSeconds !== undefined && (
          <span>
            {messages.retryAfter}: {error.retryAfterSeconds}s
          </span>
        )}
      </div>
      {onRetry && (
        <Button type="button" size="sm" color="danger" variant="flat" className="mt-2" onPress={onRetry}>
          {messages.retry}
        </Button>
      )}
    </div>
  );
}

function ReportField({
  field,
  label,
  value,
  disabled,
  onChange,
}: {
  field: ManualExecutionReportField;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `manual-execution-report-${field}`;
  const commonProps = {
    id,
    name: id,
    value,
    maxLength: MAX_MANUAL_EXECUTION_REPORT_FIELD_LENGTH,
    autoComplete: 'off' as const,
    disabled,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    className:
      'mt-1 block w-full rounded-md border border-default-200 bg-content1 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
  };

  return (
    <div className={field === 'reproductionSteps' ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {field === 'browser' ? (
        <input {...commonProps} type="text" />
      ) : (
        <textarea {...commonProps} rows={field === 'reproductionSteps' ? 5 : field === 'environment' ? 3 : 4} />
      )}
    </div>
  );
}

export default function ManualExecutionPanel({ projectId, runCaseId, locale, messages }: Props) {
  const context = useContext(TokenContext);
  const accessToken = context.token.access_token;
  const signedIn = context.isSignedIn();
  const canExecute = signedIn && Boolean(accessToken) && context.isProjectMember(Number(projectId));
  const currentUserId = context.token.user?.id;
  const validRunCase = Number.isSafeInteger(runCaseId) && runCaseId > 0;
  const [execution, setExecution] = useState<ManualExecutionView | null>(null);
  const [evidence, setEvidence] = useState<ManualEvidenceView[]>([]);
  const [report, setReport] = useState<ManualExecutionReport>(emptyReport);
  const [reportStatus, setReportStatus] = useState<ReportStatus>('idle');
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const previewUrlRefs = useRef(new Map<number, string>());
  const reportExecutionId = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEvidenceLoading, setIsEvidenceLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);
  const [evidenceToDelete, setEvidenceToDelete] = useState<ManualEvidenceView | null>(null);
  const [failureFormOpen, setFailureFormOpen] = useState(false);
  const failureFormRef = useRef<HTMLDivElement>(null);
  const uploadControllers = useRef(new Set<AbortController>());
  const uploadGeneration = useRef(0);
  const uploadExecutionId = useRef<number | null>(null);
  const actionInFlight = useRef(false);
  const reportTooLong = reportCharacterCount(report) > MAX_MANUAL_EXECUTION_REPORT_LENGTH;

  const abortUploads = useCallback(() => {
    uploadGeneration.current += 1;
    uploadControllers.current.forEach((controller) => controller.abort());
    uploadControllers.current.clear();
  }, []);

  const beginAction = useCallback(() => {
    actionInFlight.current = true;
    setIsActionLoading(true);
  }, []);

  const endAction = useCallback(() => {
    actionInFlight.current = false;
    setIsActionLoading(false);
  }, []);

  const loadEvidence = useCallback(
    async (executionId: number) => {
      if (!accessToken) return;
      setIsEvidenceLoading(true);
      const result = await listManualEvidence(accessToken, executionId);
      if (result.ok) {
        setEvidence(result.data);
        setActionError(null);
        setRetryAction(null);
      } else {
        setActionError(result.error);
        setRetryAction(() => () => loadEvidence(executionId));
      }
      setIsEvidenceLoading(false);
    },
    [accessToken]
  );

  const loadActive = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    if (!signedIn || !accessToken || !validRunCase) {
      setExecution(null);
      setEvidence([]);
      setIsLoading(false);
      return;
    }
    const result = await fetchActiveManualExecution(accessToken, runCaseId);
    if (!result.ok) {
      setExecution(null);
      setEvidence([]);
      setLoadError(result.error);
      setIsLoading(false);
      return;
    }
    setExecution(result.data);
    if (result.data) await loadEvidence(result.data.id);
    else setEvidence([]);
    setIsLoading(false);
  }, [accessToken, loadEvidence, runCaseId, signedIn, validRunCase]);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  useEffect(() => {
    const executionId = execution?.id ?? null;
    if (reportExecutionId.current === executionId) return;
    reportExecutionId.current = executionId;
    setReport(reportDraft(execution?.report ?? null));
    setReportStatus('idle');
    setFailureFormOpen(false);
  }, [execution?.id, execution?.report]);

  useEffect(() => {
    const executionId = execution?.id ?? null;
    if (uploadExecutionId.current !== executionId || execution?.status !== 'running') {
      uploadExecutionId.current = executionId;
      abortUploads();
    }
  }, [abortUploads, execution?.id, execution?.status]);

  useEffect(() => {
    if (!failureFormOpen || execution?.status !== 'running') return;
    const form = failureFormRef.current;
    form?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    form?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, [execution?.status, failureFormOpen]);

  useEffect(() => {
    const activeIds = new Set(evidence.map((item) => item.id));
    const removedIds: number[] = [];
    previewUrlRefs.current.forEach((url, id) => {
      if (!activeIds.has(id)) {
        revokeObjectUrl(url);
        previewUrlRefs.current.delete(id);
        removedIds.push(id);
      }
    });
    if (removedIds.length > 0) {
      setPreviewUrls((current) => {
        return Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.includes(Number(id))));
      });
    }

    let disposed = false;
    async function loadPreviews() {
      if (!accessToken || !canCreateObjectUrl()) return;
      for (const item of evidence) {
        if (disposed || previewUrlRefs.current.has(item.id)) continue;
        const result = await downloadManualEvidence(accessToken, item.executionId, item.id);
        if (disposed || !result.ok || previewUrlRefs.current.has(item.id)) continue;
        try {
          const url = URL.createObjectURL(new Blob([result.data.bytes], { type: item.mimeType }));
          if (disposed) {
            revokeObjectUrl(url);
            return;
          }
          previewUrlRefs.current.set(item.id, url);
          setPreviewUrls((current) => ({ ...current, [item.id]: url }));
        } catch {
          // The attachment metadata remains visible when the browser cannot create a preview URL.
        }
      }
    }

    void loadPreviews();
    return () => {
      disposed = true;
    };
  }, [accessToken, evidence]);

  useEffect(
    () => () => {
      abortUploads();
      previewUrlRefs.current.forEach((url) => revokeObjectUrl(url));
      previewUrlRefs.current.clear();
    },
    [abortUploads]
  );

  const start = useCallback(async () => {
    if (!canExecute || !accessToken || !validRunCase || isActionLoading) return;
    beginAction();
    setActionError(null);
    setRetryAction(null);
    try {
      const result = await startManualExecution(accessToken, runCaseId);
      if (!result.ok) {
        setActionError(result.error);
        setRetryAction(() => start);
        return;
      }
      setExecution(result.data);
      setEvidence([]);
      setUploadFeedback(null);
      await loadEvidence(result.data.id);
    } finally {
      endAction();
    }
  }, [accessToken, beginAction, canExecute, endAction, isActionLoading, loadEvidence, runCaseId, validRunCase]);

  const finish = useCallback(
    async (resultValue: ManualExecutionResult) => {
      if (!canExecute || !execution || execution.status !== 'running' || !accessToken || isActionLoading) return;
      if (resultValue === 'failed' && !failureFormOpen) {
        setFailureFormOpen(true);
        setActionError(null);
        setRetryAction(null);
        setReportStatus('idle');
        return;
      }
      if (resultValue === 'failed' && reportTooLong) {
        setActionError(null);
        setReportStatus('error');
        return;
      }
      beginAction();
      setActionError(null);
      setRetryAction(null);
      if (resultValue === 'failed') setReportStatus('saving');
      try {
        const resultValueResponse =
          resultValue === 'failed'
            ? await finishManualExecution(accessToken, execution.id, resultValue, report)
            : await finishManualExecution(accessToken, execution.id, resultValue);
        if (!resultValueResponse.ok) {
          setActionError(resultValueResponse.error);
          if (resultValue === 'failed') setReportStatus('error');
          setRetryAction(() => () => finish(resultValue));
        } else {
          setExecution(resultValueResponse.data);
          setReportStatus('idle');
          setFailureFormOpen(false);
        }
      } finally {
        endAction();
      }
    },
    [
      accessToken,
      beginAction,
      canExecute,
      endAction,
      execution,
      failureFormOpen,
      isActionLoading,
      report,
      reportTooLong,
    ]
  );

  const cancel = useCallback(async () => {
    if (!canExecute || !execution || execution.status !== 'running' || !accessToken || actionInFlight.current) return;
    beginAction();
    abortUploads();
    setActionError(null);
    setRetryAction(null);
    try {
      const result = await cancelManualExecution(accessToken, execution.id);
      if (!result.ok) {
        setActionError(result.error);
        setRetryAction(() => cancel);
      } else {
        setExecution(result.data);
        setUploadFeedback(null);
        setFailureFormOpen(false);
      }
    } finally {
      endAction();
    }
  }, [abortUploads, accessToken, beginAction, canExecute, endAction, execution]);

  const setReportField = useCallback((field: ManualExecutionReportField, value: string) => {
    setReport((current) => ({ ...current, [field]: value }));
    setReportStatus('dirty');
  }, []);

  const setLocalPreview = useCallback((item: ManualEvidenceView, file: File) => {
    if (!canCreateObjectUrl()) return;
    try {
      const url = URL.createObjectURL(file);
      const previous = previewUrlRefs.current.get(item.id);
      if (previous) revokeObjectUrl(previous);
      previewUrlRefs.current.set(item.id, url);
      setPreviewUrls((current) => ({ ...current, [item.id]: url }));
    } catch {
      // The attachment metadata and authenticated download remain available without a local preview.
    }
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!canExecute || !execution || execution.status !== 'running' || !accessToken || actionInFlight.current) return;
      const executionId = execution.id;
      const generation = uploadGeneration.current;
      const controller = new AbortController();
      const filename = displayFilename(file.name);
      const failUpload = (code: string, message: string) => {
        setUploadFeedback({ filename, status: 'failed' });
        setActionError(manualEvidenceError(code, message));
        setRetryAction(null);
      };
      if (evidence.length >= MAX_MANUAL_EVIDENCE_FILES) {
        failUpload('evidence_limit_exceeded', messages.manualExecutionEvidenceLimit);
        return;
      }
      if (file.size > MAX_MANUAL_EVIDENCE_BYTES) {
        failUpload('evidence_size_exceeded', messages.manualExecutionEvidenceSize);
        return;
      }
      if (!isAllowedManualEvidenceFile(file)) {
        failUpload('evidence_type_invalid', messages.manualExecutionEvidenceType);
        return;
      }
      setUploadFeedback({ filename, status: 'uploading' });
      setIsActionLoading(true);
      setActionError(null);
      setRetryAction(null);
      uploadControllers.current.add(controller);
      let result: ApiResult<ManualEvidenceView>;
      try {
        result = await uploadManualEvidence(accessToken, executionId, file, controller.signal);
      } catch {
        result = {
          ok: false,
          error: manualEvidenceError('evidence_upload_failed', messages.manualExecutionEvidenceUploadFailed),
        };
      } finally {
        uploadControllers.current.delete(controller);
      }
      const stale =
        generation !== uploadGeneration.current ||
        controller.signal.aborted ||
        !execution ||
        execution.id !== executionId ||
        execution.status !== 'running';
      if (stale) {
        if (!actionInFlight.current) setIsActionLoading(uploadControllers.current.size > 0);
        return;
      }
      if (!result.ok) {
        setUploadFeedback({ filename, status: 'failed' });
        setActionError(result.error);
        setRetryAction(() => () => upload(file));
      } else {
        setEvidence((current) => [...current, result.data]);
        setLocalPreview(result.data, file);
        setUploadFeedback({ filename, status: 'uploaded' });
      }
      if (!actionInFlight.current) setIsActionLoading(uploadControllers.current.size > 0);
    },
    [accessToken, canExecute, evidence.length, execution, messages, setLocalPreview]
  );

  const download = useCallback(
    async (item: ManualEvidenceView) => {
      if (!accessToken || actionInFlight.current) return;
      beginAction();
      setActionError(null);
      setRetryAction(null);
      try {
        const result = await downloadManualEvidence(accessToken, item.executionId, item.id);
        if (!result.ok) {
          setActionError(result.error);
          setRetryAction(() => () => download(item));
        } else if (canCreateObjectUrl()) {
          try {
            const objectUrl = URL.createObjectURL(new Blob([result.data.bytes], { type: item.mimeType }));
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = displayFilename(item.filename);
            link.click();
            setTimeout(() => revokeObjectUrl(objectUrl), 0);
          } catch {
            setActionError({ status: 0, code: 'download_unavailable', message: messages.manualExecutionUnavailable });
          }
        }
      } finally {
        endAction();
      }
    },
    [accessToken, beginAction, endAction, messages]
  );

  const remove = useCallback(
    async (item: ManualEvidenceView) => {
      if (
        !canExecute ||
        !execution ||
        execution.status !== 'running' ||
        !accessToken ||
        item.uploaderUserId !== currentUserId ||
        actionInFlight.current
      )
        return;
      beginAction();
      setActionError(null);
      setRetryAction(null);
      try {
        const result = await deleteManualEvidence(accessToken, item.executionId, item.id);
        if (!result.ok) {
          setActionError(result.error);
          setRetryAction(() => () => remove(item));
        } else {
          const previewUrl = previewUrlRefs.current.get(item.id);
          if (previewUrl) {
            revokeObjectUrl(previewUrl);
            previewUrlRefs.current.delete(item.id);
          }
          setPreviewUrls((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== item.id))
          );
          setEvidence((current) => current.filter((entry) => entry.id !== item.id));
        }
      } finally {
        endAction();
      }
    },
    [accessToken, beginAction, canExecute, currentUserId, endAction, execution]
  );

  const requestRemove = useCallback(
    (item: ManualEvidenceView) => {
      if (!canExecute || !execution || execution.status !== 'running' || item.uploaderUserId !== currentUserId) return;
      setEvidenceToDelete(item);
    },
    [canExecute, currentUserId, execution]
  );

  const confirmRemove = useCallback(() => {
    if (!evidenceToDelete) return;
    const item = evidenceToDelete;
    setEvidenceToDelete(null);
    void remove(item);
  }, [evidenceToDelete, remove]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void upload(file);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const item = Array.from(event.clipboardData?.items ?? []).find(
      (candidate) => candidate.type === 'image/png' || candidate.type === 'image/jpeg'
    );
    const file = item ? createClipboardImageFile(item) : null;
    if (file) void upload(file);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files)[0];
    if (file) void upload(file);
  };

  if (isLoading) {
    return (
      <section
        className="mt-4 min-w-0 rounded-md border p-3 dark:border-divider dark:bg-content1"
        aria-labelledby="manual-execution-heading"
      >
        <h3 id="manual-execution-heading" className="font-bold">
          {messages.manualExecution}
        </h3>
        <p className="mt-2 text-sm" role="status" aria-live="polite">
          {messages.manualExecutionLoading}
        </p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section
        className="mt-4 min-w-0 rounded-md border p-3 dark:border-divider dark:bg-content1"
        aria-labelledby="manual-execution-heading"
      >
        <h3 id="manual-execution-heading" className="font-bold">
          {messages.manualExecution}
        </h3>
        <ErrorState error={loadError} messages={messages} onRetry={loadActive} />
      </section>
    );
  }

  return (
    <section
      className="mt-4 min-w-0 max-w-full overflow-x-hidden rounded-md border p-3 dark:border-divider dark:bg-content1"
      aria-labelledby="manual-execution-heading"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 id="manual-execution-heading" className="font-bold">
          {messages.manualExecution}
        </h3>
        {execution && (
          <span className="rounded-full border px-2 py-1 text-sm" role="status" aria-live="polite">
            {statusLabel(execution, messages)}
          </span>
        )}
      </div>

      {actionError && <ErrorState error={actionError} messages={messages} onRetry={retryAction ?? undefined} />}

      {!execution ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm" role="status">
            {messages.manualExecutionEmpty}
          </p>
          {signedIn && !canExecute && (
            <p className="text-sm" role="status">
              {messages.manualExecutionUnauthorized}
            </p>
          )}
          <Button
            type="button"
            color="primary"
            size="sm"
            isDisabled={!canExecute || isActionLoading}
            isLoading={isActionLoading}
            onPress={start}
          >
            {messages.manualExecutionStart}
          </Button>
        </div>
      ) : (
        <>
          <dl className="mt-3 grid min-w-0 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionActor}</dt>
              <dd className="break-words">#{execution.actorUserId}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionAssignee}</dt>
              <dd className="break-words">{execution.assigneeUserId ? `#${execution.assigneeUserId}` : '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionStartedAt}</dt>
              <dd className="break-words">{timestamp(execution.startedAt, locale)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionFinishedAt}</dt>
              <dd className="break-words">{timestamp(execution.finishedAt, locale)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionRevision}</dt>
              <dd>{execution.caseRevision}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.correlationId}</dt>
              <dd className="break-all font-mono text-xs" translate="no">
                {execution.correlationId}
              </dd>
            </div>
          </dl>

          <p className="mt-2 text-xs text-default-500">{messages.manualExecutionActorHint}</p>

          {execution.stale && (
            <p className="mt-3 text-sm text-warning-700" role="status">
              {messages.manualExecutionStale}
            </p>
          )}
          {execution.historical && (
            <p className="mt-2 text-sm" role="status">
              {messages.manualExecutionHistorical}
            </p>
          )}
          {execution.sourceDeleted && (
            <p className="mt-2 text-sm" role="status">
              {messages.manualExecutionSourceDeleted}
            </p>
          )}

          <section
            className="mt-4 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-labelledby="manual-evidence-heading"
            aria-describedby={
              execution.status === 'running'
                ? 'manual-evidence-paste-instructions manual-evidence-drop-instructions'
                : undefined
            }
            tabIndex={execution.status === 'running' ? 0 : undefined}
            data-testid="manual-execution-evidence-editor"
            onDragOver={execution.status === 'running' ? onDragOver : undefined}
            onDrop={execution.status === 'running' ? onDrop : undefined}
            onPaste={execution.status === 'running' ? onPaste : undefined}
          >
            <h4 id="manual-evidence-heading" className="font-semibold">
              {messages.manualExecutionEvidence}
            </h4>
            <p className="mt-1 break-words text-xs text-default-500">{messages.manualExecutionEvidencePrivate}</p>
            {execution.status === 'running' && (
              <div className="mt-3 rounded-md border border-dashed border-default-300 p-3 dark:border-divider dark:bg-content2">
                <p id="manual-evidence-paste-instructions" className="break-words text-sm">
                  {messages.manualExecutionEvidencePaste}
                </p>
                <p id="manual-evidence-drop-instructions" className="mt-1 break-words text-xs text-default-500">
                  {messages.manualExecutionEvidenceDrop}
                </p>
                <label
                  htmlFor="manual-execution-evidence-upload"
                  className="mt-3 inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm hover:bg-default-100 focus-within:ring-2 focus-within:ring-primary"
                >
                  <span>{messages.manualExecutionEvidenceUpload}</span>
                  <input
                    id="manual-execution-evidence-upload"
                    className="sr-only"
                    name="manual-execution-evidence"
                    type="file"
                    accept="image/png,image/jpeg"
                    aria-label={messages.manualExecutionEvidenceUpload}
                    disabled={!canExecute || isActionLoading || evidence.length >= MAX_MANUAL_EVIDENCE_FILES}
                    onChange={onFileChange}
                  />
                </label>
              </div>
            )}
            {uploadFeedback && (
              <p
                className={`mt-2 break-words text-sm ${uploadFeedback.status === 'failed' ? 'text-danger-700' : ''}`}
                role={uploadFeedback.status === 'failed' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {uploadFeedback.status === 'uploading'
                  ? messages.manualExecutionEvidenceUploading
                  : uploadFeedback.status === 'uploaded'
                    ? messages.manualExecutionEvidenceUploaded
                    : messages.manualExecutionEvidenceUploadFailed}{' '}
                <span className="font-medium">{uploadFeedback.filename}</span>
              </p>
            )}
            {isEvidenceLoading ? (
              <p className="mt-2 text-sm" role="status">
                {messages.manualExecutionLoading}
              </p>
            ) : evidence.length === 0 ? (
              <p className="mt-2 text-sm">{messages.manualExecutionEvidenceEmpty}</p>
            ) : (
              <ul className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
                {evidence.map((item) => (
                  <li
                    key={item.id}
                    className="min-w-0 rounded-md border border-default-200 p-2 dark:border-divider dark:bg-content2"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {previewUrls[item.id] ? (
                        // Blob URLs are already local authenticated bytes and cannot benefit from Next image optimization.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previewUrls[item.id]}
                          alt={`${messages.manualExecutionEvidencePreview}: ${displayFilename(item.filename)}`}
                          width={80}
                          height={56}
                          loading="lazy"
                          className="h-14 w-20 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div
                          className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-default-100 text-xs font-semibold uppercase text-default-500"
                          aria-label={messages.manualExecutionEvidencePreview}
                        >
                          {item.mimeType === 'image/png' ? 'PNG' : 'JPEG'}
                        </div>
                      )}
                      <span className="min-w-0 flex-1 break-all text-sm" title={item.filename}>
                        {item.filename}
                        <span className="block text-xs text-default-500">{formatSize(item.size, locale)}</span>
                      </span>
                    </div>
                    <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="light"
                        isDisabled={isActionLoading}
                        aria-label={`${messages.manualExecutionEvidenceDownload}: ${item.filename}`}
                        onPress={() => download(item)}
                      >
                        {messages.manualExecutionEvidenceDownload}
                      </Button>
                      {execution.status === 'running' && item.uploaderUserId === currentUserId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="light"
                          isDisabled={!canExecute || isActionLoading}
                          aria-label={`${messages.manualExecutionEvidenceDelete}: ${item.filename}`}
                          onPress={() => requestRemove(item)}
                        >
                          {messages.manualExecutionEvidenceDelete}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {execution.status === 'running' && evidence.length >= MAX_MANUAL_EVIDENCE_FILES && (
              <p className="mt-2 text-xs text-default-500">{messages.manualExecutionEvidenceLimit}</p>
            )}
          </section>

          {execution.status === 'running' && failureFormOpen ? (
            <div
              ref={failureFormRef}
              className="mt-4 min-w-0 rounded-md border border-default-200 bg-content2/30 p-3 dark:border-divider"
              data-testid="manual-execution-editor"
            >
              <form
                id="manual-execution-failure-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void finish('failed');
                }}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-semibold">{messages.manualExecutionReport}</h4>
                    <p className="mt-1 break-words text-sm text-default-500">
                      {messages.manualExecutionReportDescription}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border px-2 py-1 text-xs text-default-500">
                    {messages.manualExecutionRunning}
                  </span>
                </div>
                <p id="manual-execution-report-help" className="mt-3 text-xs text-default-500">
                  {messages.manualExecutionReportFieldLimit}
                </p>
                {reportTooLong && (
                  <p className="mt-2 break-words text-sm text-danger-700" role="alert">
                    {messages.manualExecutionReportTooLong}
                  </p>
                )}
                <fieldset disabled={!canExecute || isActionLoading} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                  {REPORT_FIELDS.map((field) => (
                    <ReportField
                      key={field}
                      field={field}
                      label={reportFieldLabel(field, messages)}
                      value={report[field]}
                      disabled={!canExecute || isActionLoading}
                      onChange={(value) => setReportField(field, value)}
                    />
                  ))}
                </fieldset>
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3">
                  {reportStatus === 'saving' && (
                    <span className="text-sm" role="status" aria-live="polite">
                      {messages.manualExecutionReportSaving}
                    </span>
                  )}
                  {reportStatus === 'dirty' && (
                    <span className="text-sm text-warning-700" role="status" aria-live="polite">
                      {messages.manualExecutionReportUnsaved}
                    </span>
                  )}
                </div>
                <p className="mt-3 break-words text-sm text-default-500">{messages.manualExecutionReportComments}</p>
              </form>
            </div>
          ) : execution.status === 'finished' && execution.result === 'failed' && hasReportContent(execution.report) ? (
            <section
              className="mt-4 min-w-0 rounded-md border border-default-200 p-3 dark:border-divider dark:bg-content2/30"
              aria-labelledby="manual-report-heading"
              data-testid="manual-execution-findings"
            >
              <h4 id="manual-report-heading" className="font-semibold">
                {messages.manualExecutionReport}
              </h4>
              <p className="mt-1 break-words text-sm text-default-500">{messages.manualExecutionReportComments}</p>
              <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                {REPORT_FIELDS.map((field) => (
                  <div key={field} className={field === 'reproductionSteps' ? 'sm:col-span-2' : ''}>
                    <dt className="text-sm font-semibold">{reportFieldLabel(field, messages)}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{execution.report?.[field] || '—'}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {execution.status === 'running' && (
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2" data-testid="manual-execution-actions">
              <Button
                type="button"
                color="success"
                size="sm"
                isDisabled={!canExecute || isActionLoading}
                onPress={() => finish('passed')}
              >
                {messages.manualExecutionFinishPassed}
              </Button>
              <Button
                type="button"
                color="danger"
                size="sm"
                isDisabled={!canExecute || isActionLoading}
                onPress={() => finish('failed')}
              >
                {failureFormOpen ? messages.manualExecutionFinishFailedConfirm : messages.manualExecutionFinishFailed}
              </Button>
              {failureFormOpen && (
                <Button
                  type="button"
                  variant="flat"
                  size="sm"
                  isDisabled={isActionLoading}
                  onPress={() => {
                    setFailureFormOpen(false);
                    setReport(reportDraft(execution.report ?? null));
                    setReportStatus('idle');
                  }}
                >
                  {messages.manualExecutionReportBack}
                </Button>
              )}
              <Button
                type="button"
                color="warning"
                variant="flat"
                size="sm"
                isDisabled={!canExecute || actionInFlight.current}
                isLoading={actionInFlight.current}
                onPress={cancel}
              >
                {messages.manualExecutionCancel}
              </Button>
            </div>
          )}
        </>
      )}
      <DeleteConfirmDialog
        isOpen={evidenceToDelete !== null}
        onCancel={() => setEvidenceToDelete(null)}
        onConfirm={confirmRemove}
        closeText={messages.manualExecutionEvidenceDeleteCancel}
        confirmText={messages.manualExecutionEvidenceDeleteConfirm}
        deleteText={messages.manualExecutionEvidenceDelete}
      />
    </section>
  );
}
