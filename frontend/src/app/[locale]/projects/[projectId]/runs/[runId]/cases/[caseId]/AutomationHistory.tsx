'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import AutomationTimeline from './AutomationTimeline';
import { Link } from '@/src/i18n/routing';
import type { GherkinExamples } from '@/types/case';
import type { RunDetailMessages } from '@/types/run';
import type { AutomationExecution, AutomationStatus } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import {
  fetchAutomationHistory,
  formatAutomationError,
  formatAutomationExampleLabel,
  formatAutomationDuration,
  isAutomationActive,
} from '@/utils/automationControl';
import {
  downloadManualEvidence,
  fetchManualExecutionHistory,
  listManualEvidence,
} from '@/utils/manualExecutionControl';
import type {
  ManualEvidenceView,
  ManualExecutionMessages,
  ManualExecutionReportField,
  ManualExecutionView,
} from '@/types/manualExecution';
import { useAutomationPolling } from '@/utils/useAutomationPolling';

type Props = {
  projectId: string;
  runId: string;
  caseId: string;
  runCaseId?: number;
  examples?: GherkinExamples | null;
  locale: string;
  messages: RunDetailMessages;
  manualExecutionMessages?: ManualExecutionMessages;
};

const MAX_EMPTY_HISTORY_POLLS = 3;

function statusLabel(status: AutomationStatus, messages: RunDetailMessages): string {
  return (
    {
      queued: messages.automationQueued,
      running: messages.automationRunning,
      passed: messages.automationPassed,
      failed: messages.automationFailed,
      error: messages.automationError,
      cancelled: messages.automationCancelled,
    } as Record<AutomationStatus, string>
  )[status];
}

function executionStatusLabel(item: AutomationExecution, messages: RunDetailMessages): string {
  return item.diagnostics?.timedOut === true || item.error === 'hercules_timeout' || item.error === 'deadline_exceeded'
    ? messages.automationTimeout
    : item.errorKind === 'evidence'
      ? messages.automationEvidenceInsufficient
      : statusLabel(item.status, messages);
}

function sortNewestFirst(items: AutomationExecution[]): AutomationExecution[] {
  return [...items].sort((left, right) => {
    const leftDate = new Date(left.queuedAt ?? left.createdAt ?? 0).getTime();
    const rightDate = new Date(right.queuedAt ?? right.createdAt ?? 0).getTime();
    return rightDate - leftDate;
  });
}

function timestamp(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function manualStatusLabel(item: ManualExecutionView, messages: ManualExecutionMessages): string {
  if (item.status === 'running') return messages.manualExecutionRunning;
  if (item.status === 'cancelled') return messages.manualExecutionCancelled;
  return item.result === 'passed' ? messages.manualExecutionPassed : messages.manualExecutionFailed;
}

function manualStatusValue(item: ManualExecutionView, messages: ManualExecutionMessages): string {
  if (item.status === 'running') return messages.manualExecutionRunning;
  if (item.status === 'cancelled') return messages.manualExecutionCancelled;
  return messages.manualExecutionFinished;
}

function manualResultValue(item: ManualExecutionView, messages: ManualExecutionMessages): string {
  if (item.result === 'passed') return messages.manualExecutionPassed;
  if (item.result === 'failed') return messages.manualExecutionFailed;
  return '—';
}

function sortManualNewestFirst(items: ManualExecutionView[]): ManualExecutionView[] {
  return [...items].sort((left, right) => {
    const leftDate = new Date(left.finishedAt ?? left.startedAt).getTime();
    const rightDate = new Date(right.finishedAt ?? right.startedAt).getTime();
    return rightDate - leftDate || right.id - left.id;
  });
}

type HistoryEntry =
  | { kind: 'automation'; item: AutomationExecution; timestamp: number }
  | { kind: 'manual'; item: ManualExecutionView; timestamp: number };

function historyTimestamp(value: string | undefined | null): number {
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const MANUAL_REPORT_FIELDS: ManualExecutionReportField[] = [
  'failureReason',
  'howToFix',
  'reproductionSteps',
  'browser',
  'environment',
];

function hasManualReportContent(report: ManualExecutionView['report']): boolean {
  return Boolean(
    report &&
      MANUAL_REPORT_FIELDS.some((field) => {
        const value = report[field];
        return typeof value === 'string' && value.trim().length > 0;
      })
  );
}

function shouldShowManualReport(item: ManualExecutionView): boolean {
  return item.status === 'finished' && item.result === 'failed' && hasManualReportContent(item.report);
}

function manualReportFieldLabel(field: ManualExecutionReportField, messages: ManualExecutionMessages): string {
  if (field === 'failureReason') return messages.manualExecutionReportFailureReason;
  if (field === 'howToFix') return messages.manualExecutionReportHowToFix;
  if (field === 'reproductionSteps') return messages.manualExecutionReportReproductionSteps;
  if (field === 'browser') return messages.manualExecutionReportBrowser;
  return messages.manualExecutionReportEnvironment;
}

function displayFilename(filename: string): string {
  return filename.replace(/[\r\n"\\/]/g, '_').slice(0, 255) || 'evidence';
}

function formatEvidenceSize(size: number, locale: string): string {
  const kilobytes = Math.ceil(size / 1024);
  try {
    return `${new Intl.NumberFormat(locale).format(kilobytes)} KB`;
  } catch {
    return `${kilobytes} KB`;
  }
}

function canCreateObjectUrl(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
}

function revokeObjectUrl(url: string): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

function ManualHistoryEntry({
  item,
  locale,
  messages,
  accessToken,
}: {
  item: ManualExecutionView;
  locale: string;
  messages: ManualExecutionMessages;
  accessToken: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [evidence, setEvidence] = useState<ManualEvidenceView[]>([]);
  const [evidenceStatus, setEvidenceStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [evidenceLoadFailed, setEvidenceLoadFailed] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const [previewErrors, setPreviewErrors] = useState<Set<number>>(new Set());
  const [downloadingEvidenceId, setDownloadingEvidenceId] = useState<number | null>(null);
  const [previewEvidenceId, setPreviewEvidenceId] = useState<number | null>(null);
  const previewUrlRefs = useRef(new Map<number, string>());
  const previewCloseButtonRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailsId = `manual-history-details-${item.id}`;
  const hasReport = shouldShowManualReport(item);

  const closePreview = useCallback(() => {
    setPreviewEvidenceId(null);
    const trigger = previewTriggerRef.current;
    previewTriggerRef.current = null;
    if (trigger && document.contains(trigger)) trigger.focus();
  }, []);

  const openPreview = useCallback((evidenceId: number, trigger: HTMLButtonElement) => {
    previewTriggerRef.current = trigger;
    setPreviewEvidenceId(evidenceId);
  }, []);

  const revokePreviewUrls = useCallback(() => {
    closePreview();
    previewUrlRefs.current.forEach((url) => revokeObjectUrl(url));
    previewUrlRefs.current.clear();
  }, [closePreview]);

  useEffect(() => {
    if (previewEvidenceId === null) return;
    previewCloseButtonRef.current?.focus();
  }, [previewEvidenceId]);

  useEffect(() => {
    if (previewEvidenceId === null) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePreview();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closePreview, previewEvidenceId]);

  useEffect(() => {
    if (previewEvidenceId !== null && !previewUrls[previewEvidenceId]) closePreview();
  }, [closePreview, previewEvidenceId, previewUrls]);

  useEffect(() => {
    if (isExpanded) return;
    revokePreviewUrls();
    setPreviewUrls({});
    setPreviewErrors(new Set());
    setEvidenceStatus('idle');
    setEvidenceLoadFailed(false);
    setIsPreviewLoading(false);
  }, [isExpanded, revokePreviewUrls]);

  useEffect(() => {
    if (!isExpanded) return undefined;

    let disposed = false;
    revokePreviewUrls();
    setPreviewUrls({});
    setPreviewErrors(new Set());
    setEvidence([]);
    setEvidenceLoadFailed(false);
    setIsPreviewLoading(false);
    setEvidenceStatus('loading');

    const markPreviewError = (evidenceId: number) => {
      if (disposed) return;
      setPreviewErrors((current) => new Set(current).add(evidenceId));
    };

    async function loadEvidence() {
      try {
        const result = await listManualEvidence(accessToken, item.id);
        if (disposed) return;
        if (!result.ok) {
          setEvidenceLoadFailed(true);
          setEvidenceStatus('error');
          return;
        }

        setEvidence(result.data);
        setEvidenceStatus('loaded');
        setIsPreviewLoading(result.data.length > 0 && canCreateObjectUrl());

        for (const evidenceItem of result.data) {
          if (disposed) return;
          let previewResult;
          try {
            previewResult = await downloadManualEvidence(accessToken, evidenceItem.executionId, evidenceItem.id);
          } catch {
            markPreviewError(evidenceItem.id);
            continue;
          }
          if (disposed) return;
          if (!previewResult.ok || !canCreateObjectUrl()) {
            markPreviewError(evidenceItem.id);
            continue;
          }
          try {
            const url = URL.createObjectURL(new Blob([previewResult.data.bytes], { type: evidenceItem.mimeType }));
            if (disposed) {
              revokeObjectUrl(url);
              return;
            }
            previewUrlRefs.current.set(evidenceItem.id, url);
            setPreviewUrls((current) => ({ ...current, [evidenceItem.id]: url }));
          } catch {
            markPreviewError(evidenceItem.id);
          }
        }
        if (!disposed) setIsPreviewLoading(false);
      } catch {
        if (disposed) return;
        setEvidenceLoadFailed(true);
        setEvidenceStatus('error');
      }
    }

    void loadEvidence();
    return () => {
      disposed = true;
      revokePreviewUrls();
    };
  }, [accessToken, isExpanded, item.id, revokePreviewUrls]);

  const previewEvidence =
    previewEvidenceId === null ? undefined : evidence.find((evidenceItem) => evidenceItem.id === previewEvidenceId);
  const previewUrl = previewEvidenceId === null ? undefined : previewUrls[previewEvidenceId];
  const previewFilename = previewEvidence ? displayFilename(previewEvidence.filename) : undefined;
  const previewDialogTitleId = `manual-history-evidence-preview-title-${item.id}`;

  const download = useCallback(
    async (evidenceItem: ManualEvidenceView) => {
      if (!accessToken || downloadingEvidenceId !== null) return;
      setDownloadingEvidenceId(evidenceItem.id);
      try {
        const result = await downloadManualEvidence(accessToken, evidenceItem.executionId, evidenceItem.id);
        if (!result.ok || !canCreateObjectUrl()) {
          setPreviewErrors((current) => new Set(current).add(evidenceItem.id));
          return;
        }
        const objectUrl = URL.createObjectURL(new Blob([result.data.bytes], { type: evidenceItem.mimeType }));
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = displayFilename(evidenceItem.filename);
        link.click();
        setTimeout(() => revokeObjectUrl(objectUrl), 0);
      } catch {
        setPreviewErrors((current) => new Set(current).add(evidenceItem.id));
      } finally {
        setDownloadingEvidenceId(null);
      }
    },
    [accessToken, downloadingEvidenceId]
  );

  return (
    <article
      className="min-w-0 overflow-hidden rounded-md border text-sm dark:border-divider dark:bg-content1"
      data-history-entry="manual"
      data-history-entry-id={item.id}
    >
      <button
        type="button"
        className="block w-full p-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        aria-label={`${isExpanded ? messages.manualExecutionCollapse : messages.manualExecutionExpand}: ${messages.manualExecution} #${item.id}`}
        data-testid={`manual-history-toggle-${item.id}`}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-default-500">{messages.manualExecution}</span>
          <Chip
            size="sm"
            color={item.result === 'passed' ? 'success' : item.result === 'failed' ? 'danger' : 'warning'}
          >
            {manualStatusLabel(item, messages)}
          </Chip>
          <span>{timestamp(item.finishedAt ?? item.startedAt, locale)}</span>
          <span>
            {messages.manualExecutionActor}: #{item.actorUserId}
          </span>
          <span>
            {messages.manualExecutionRevision}: {item.caseRevision}
          </span>
          <span className="ms-auto text-default-500" aria-hidden="true">
            {isExpanded ? '−' : '+'}
          </span>
        </span>
        {item.stale && <span className="mt-2 block break-words text-warning-700">{messages.manualExecutionStale}</span>}
        {item.sourceDeleted && (
          <span className="mt-2 block break-words text-default-500">{messages.manualExecutionSourceDeleted}</span>
        )}
        {shouldShowManualReport(item) && item.report?.failureReason && (
          <span className="mt-2 block whitespace-pre-wrap break-words">{item.report.failureReason}</span>
        )}
      </button>

      {isExpanded && (
        <div
          id={detailsId}
          className="min-w-0 border-t p-3 dark:border-divider dark:bg-content2"
          data-testid={detailsId}
        >
          <dl className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionStatus}</dt>
              <dd className="break-words">{manualStatusValue(item, messages)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionResult}</dt>
              <dd className="break-words">{manualResultValue(item, messages)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionActor}</dt>
              <dd className="break-words">#{item.actorUserId}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionAssignee}</dt>
              <dd className="break-words">{item.assigneeUserId ? `#${item.assigneeUserId}` : '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionStartedAt}</dt>
              <dd className="break-words">{timestamp(item.startedAt, locale)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionFinishedAt}</dt>
              <dd className="break-words">{timestamp(item.finishedAt, locale)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.manualExecutionRevision}</dt>
              <dd>{item.caseRevision}</dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold">{messages.correlationId}</dt>
              <dd className="break-all font-mono text-xs" translate="no">
                {item.correlationId}
              </dd>
            </div>
          </dl>

          {item.stale && <p className="mt-3 break-words text-warning-700">{messages.manualExecutionStale}</p>}
          {item.historical && <p className="mt-2 break-words">{messages.manualExecutionHistorical}</p>}
          {item.sourceDeleted && (
            <p className="mt-2 break-words text-default-500">{messages.manualExecutionSourceDeleted}</p>
          )}

          {hasReport && (
            <section
              className="mt-4 min-w-0 rounded-md border border-default-200 p-3 dark:border-divider dark:bg-content3"
              aria-labelledby={`manual-history-report-heading-${item.id}`}
              data-testid={`manual-history-report-${item.id}`}
            >
              <h4 id={`manual-history-report-heading-${item.id}`} className="font-semibold">
                {messages.manualExecutionReport}
              </h4>
              <p className="mt-1 break-words text-xs text-default-500">{messages.manualExecutionReportComments}</p>
              <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                {MANUAL_REPORT_FIELDS.map((field) => (
                  <div key={field} className={field === 'reproductionSteps' ? 'sm:col-span-2' : ''}>
                    <dt className="font-semibold">{manualReportFieldLabel(field, messages)}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words">
                      {typeof item.report?.[field] === 'string' && item.report[field] ? item.report[field] : '—'}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section
            className="mt-4 min-w-0"
            aria-labelledby={`manual-history-evidence-heading-${item.id}`}
            data-testid={`manual-history-evidence-${item.id}`}
          >
            <h4 id={`manual-history-evidence-heading-${item.id}`} className="font-semibold">
              {messages.manualExecutionEvidence}
            </h4>
            <p className="mt-1 break-words text-xs text-default-500">{messages.manualExecutionEvidencePrivate}</p>
            {(evidenceStatus === 'idle' || evidenceStatus === 'loading') && (
              <p className="mt-2 text-sm" role="status" aria-live="polite">
                {messages.manualExecutionLoading}
              </p>
            )}
            {evidenceStatus === 'error' && evidenceLoadFailed && (
              <div className="mt-2 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700" role="alert">
                <p>{messages.requestError}</p>
                <p className="break-words text-sm">{messages.manualExecutionUnavailable}</p>
              </div>
            )}
            {evidenceStatus === 'loaded' && (
              <>
                {isPreviewLoading && (
                  <p className="mt-2 text-xs text-default-500" role="status" aria-live="polite">
                    {messages.manualExecutionLoading}
                  </p>
                )}
                {previewErrors.size > 0 && (
                  <p className="mt-2 break-words text-sm text-danger-700" role="alert">
                    {messages.requestError}: {messages.manualExecutionUnavailable}
                  </p>
                )}
                {evidence.length === 0 ? (
                  <p className="mt-2 text-sm">{messages.manualExecutionEvidenceEmpty}</p>
                ) : (
                  <ul className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
                    {evidence.map((evidenceItem) => {
                      const filename = displayFilename(evidenceItem.filename);
                      return (
                        <li
                          key={evidenceItem.id}
                          className="min-w-0 rounded-md border border-default-200 p-2 dark:border-divider dark:bg-content3"
                          data-testid={`manual-history-evidence-item-${evidenceItem.id}`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {previewUrls[evidenceItem.id] ? (
                              <button
                                type="button"
                                className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-haspopup="dialog"
                                aria-label={`${messages.manualExecutionEvidenceOpen}: ${filename}`}
                                data-testid={`manual-history-evidence-open-${evidenceItem.id}`}
                                onClick={(event) => openPreview(evidenceItem.id, event.currentTarget)}
                              >
                                {/* Blob URLs contain authenticated bytes and are never private API URLs. */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={previewUrls[evidenceItem.id]}
                                  alt={`${messages.manualExecutionEvidencePreview}: ${filename}`}
                                  width={80}
                                  height={56}
                                  loading="lazy"
                                  className="h-14 w-20 rounded object-cover"
                                  data-testid={`manual-history-evidence-preview-${evidenceItem.id}`}
                                />
                              </button>
                            ) : (
                              <div
                                className="flex h-14 w-20 shrink-0 items-center justify-center rounded bg-default-100 text-xs font-semibold uppercase text-default-500"
                                aria-label={messages.manualExecutionEvidencePreview}
                              >
                                {evidenceItem.mimeType === 'image/png' ? 'PNG' : 'JPEG'}
                              </div>
                            )}
                            <span className="min-w-0 flex-1 break-all" title={filename}>
                              {filename}
                              <span className="block text-xs text-default-500">
                                {formatEvidenceSize(evidenceItem.size, locale)}
                              </span>
                            </span>
                          </div>
                          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-md border px-3 py-1 text-xs hover:bg-default-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              disabled={downloadingEvidenceId !== null}
                              data-testid={`manual-history-evidence-download-${evidenceItem.id}`}
                              onClick={() => void download(evidenceItem)}
                            >
                              {messages.manualExecutionEvidenceDownload}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {isExpanded && previewEvidence && previewUrl && previewFilename && (
        <div
          className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black/80 p-4 dark:bg-background/90"
          role="dialog"
          aria-modal="true"
          aria-labelledby={previewDialogTitleId}
          data-testid={`manual-history-evidence-dialog-${item.id}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <div
            className="flex max-h-full max-w-full flex-col items-center gap-4 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex w-full max-w-6xl items-center justify-between gap-4">
              <h2
                id={previewDialogTitleId}
                className="min-w-0 truncate text-sm font-semibold text-white dark:text-foreground"
              >
                {messages.manualExecutionEvidencePreview}: {previewFilename}
              </h2>
              <button
                ref={previewCloseButtonRef}
                type="button"
                className="shrink-0 rounded-md bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-default-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:bg-content3 dark:text-foreground dark:hover:bg-content4"
                aria-label={messages.manualExecutionEvidenceClose}
                data-testid={`manual-history-evidence-close-${item.id}`}
                onClick={closePreview}
              >
                {messages.manualExecutionEvidenceClose}
              </button>
            </div>
            {/* Blob URLs contain authenticated bytes and are never private API URLs. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={`${messages.manualExecutionEvidencePreview}: ${previewFilename}`}
              className="max-h-[calc(100vh-7rem)] max-w-full rounded object-contain"
              data-testid={`manual-history-evidence-lightbox-image-${item.id}`}
            />
          </div>
        </div>
      )}
    </article>
  );
}

export default function AutomationHistory({
  projectId,
  runId,
  caseId,
  runCaseId,
  examples,
  locale,
  messages,
  manualExecutionMessages,
}: Props) {
  const context = useContext(TokenContext);
  const [items, setItems] = useState<AutomationExecution[]>([]);
  const [manualItems, setManualItems] = useState<ManualExecutionView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isManualLoading, setIsManualLoading] = useState(Boolean(manualExecutionMessages));
  const [hasError, setHasError] = useState(false);
  const [hasManualError, setHasManualError] = useState(false);
  const [emptyHistoryPolls, setEmptyHistoryPolls] = useState(0);
  const [emptyManualHistoryPolls, setEmptyManualHistoryPolls] = useState(0);
  const accessToken = context.token.access_token;
  const validRunCaseId = typeof runCaseId === 'number' && Number.isInteger(runCaseId) && runCaseId > 0;
  const historyKey = `${projectId}:${caseId}:${runCaseId ?? ''}`;
  const manualHistoryKey = `${historyKey}:${manualExecutionMessages ? 'enabled' : 'disabled'}`;

  const loadHistory = useCallback(async () => {
    const linkedRunCaseId = runCaseId;
    if (
      !accessToken ||
      typeof linkedRunCaseId !== 'number' ||
      !Number.isInteger(linkedRunCaseId) ||
      linkedRunCaseId <= 0
    )
      return [];
    const history = await fetchAutomationHistory(accessToken, Number(projectId), Number(caseId), linkedRunCaseId);
    return sortNewestFirst(history.filter((item) => Number(item.runCaseId) === linkedRunCaseId));
  }, [accessToken, caseId, projectId, runCaseId]);

  const loadManualHistory = useCallback(async () => {
    const linkedRunCaseId = runCaseId;
    if (
      !manualExecutionMessages ||
      !accessToken ||
      typeof linkedRunCaseId !== 'number' ||
      !Number.isInteger(linkedRunCaseId) ||
      linkedRunCaseId <= 0
    )
      return [];
    const history = await fetchManualExecutionHistory(accessToken, linkedRunCaseId, 20, 1);
    if (!history.ok) throw history.error;
    return sortManualNewestFirst(history.data.items.filter((item) => Number(item.runCaseId) === linkedRunCaseId));
  }, [accessToken, manualExecutionMessages, runCaseId]);

  useEffect(() => {
    setItems([]);
    setManualItems([]);
    setHasError(false);
    setHasManualError(false);
    setEmptyHistoryPolls(0);
    setEmptyManualHistoryPolls(0);
    setIsLoading(Boolean(accessToken && validRunCaseId));
    setIsManualLoading(Boolean(accessToken && validRunCaseId && manualExecutionMessages));
  }, [accessToken, historyKey, manualExecutionMessages, validRunCaseId]);

  useAutomationPolling({
    active: Boolean(
      accessToken &&
        validRunCaseId &&
        (items.some((item) => isAutomationActive(item.status)) ||
          (items.length === 0 && emptyHistoryPolls < MAX_EMPTY_HISTORY_POLLS))
    ),
    poll: loadHistory,
    restartKey: historyKey,
    onValue: (history) => {
      setItems(history);
      setEmptyHistoryPolls((current) => (history.length === 0 ? current + 1 : 0));
      setIsLoading(false);
      setHasError(false);
    },
    onError: () => {
      setEmptyHistoryPolls(MAX_EMPTY_HISTORY_POLLS);
      setIsLoading(false);
      setHasError(true);
    },
  });

  useAutomationPolling({
    active: Boolean(
      manualExecutionMessages &&
        accessToken &&
        validRunCaseId &&
        (manualItems.some((item) => item.status === 'running') ||
          (manualItems.length === 0 && emptyManualHistoryPolls < MAX_EMPTY_HISTORY_POLLS))
    ),
    poll: loadManualHistory,
    restartKey: manualHistoryKey,
    onValue: (history) => {
      setManualItems(history);
      setEmptyManualHistoryPolls((current) => (history.length === 0 ? current + 1 : 0));
      setIsManualLoading(false);
      setHasManualError(false);
    },
    onError: () => {
      setEmptyManualHistoryPolls(MAX_EMPTY_HISTORY_POLLS);
      setIsManualLoading(false);
      setHasManualError(true);
    },
  });

  const historyEntries: HistoryEntry[] = [
    ...items.map((item) => ({
      kind: 'automation' as const,
      item,
      timestamp: historyTimestamp(item.queuedAt ?? item.createdAt),
    })),
    ...manualItems.map((item) => ({
      kind: 'manual' as const,
      item,
      timestamp: historyTimestamp(item.finishedAt ?? item.startedAt),
    })),
  ].sort((left, right) => right.timestamp - left.timestamp);

  if (isLoading || isManualLoading)
    return (
      <p role="status" aria-live="polite">
        {messages.automationHistoryLoading}
      </p>
    );
  if (hasError && hasManualError && historyEntries.length === 0)
    return <p role="alert">{messages.automationUnavailable}</p>;
  if (historyEntries.length === 0) return <p>{messages.automationHistoryEmpty}</p>;

  return (
    <div className="min-w-0 space-y-4" data-testid="execution-history">
      <section className="min-w-0 space-y-3" aria-labelledby="execution-history-heading">
        <h3 id="execution-history-heading" className="font-semibold">
          {messages.automationHistory}
        </h3>
        {historyEntries.map((entry) => {
          if (entry.kind === 'manual') {
            const item = entry.item;
            if (!manualExecutionMessages) return null;
            return (
              <ManualHistoryEntry
                key={`manual-${item.id}`}
                item={item}
                locale={locale}
                messages={manualExecutionMessages}
                accessToken={accessToken}
              />
            );
          }

          const item = entry.item;
          const exampleLabel =
            item.exampleIndex === undefined || item.exampleIndex === null
              ? undefined
              : formatAutomationExampleLabel(
                  messages.automationExample,
                  item.exampleIndex,
                  examples?.rows[item.exampleIndex]
                );
          const errorMessage = formatAutomationError(
            {
              code: item.error,
              errorKind: item.errorKind,
              status: item.status,
              timedOut: item.diagnostics?.timedOut === true,
            },
            messages
          );
          return (
            <div
              key={`automation-${item.id}`}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-3 dark:border-divider dark:bg-content1"
              data-history-entry="automation"
            >
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-default-500">{messages.automation}</span>
                  <Chip
                    size="sm"
                    color={
                      item.status === 'passed'
                        ? 'success'
                        : item.status === 'failed' || item.status === 'error'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {executionStatusLabel(item, messages)}
                  </Chip>
                  <span>{formatAutomationDuration(item.durationMs)}</span>
                  <span>{timestamp(item.queuedAt ?? item.createdAt, locale)}</span>
                  {item.attempt !== undefined && (
                    <span>
                      {messages.automationAttempt}: {item.attempt}
                    </span>
                  )}
                  {exampleLabel && (
                    <span className="block min-w-0 max-w-full truncate" title={exampleLabel} aria-label={exampleLabel}>
                      {exampleLabel}
                    </span>
                  )}
                </div>
                {item.summary && <p className="break-words whitespace-pre-wrap">{item.summary}</p>}
                {errorMessage && <p className="break-words whitespace-pre-wrap text-danger">{errorMessage}</p>}
                {item.errorFields && item.errorFields.length > 0 && (
                  <ul className="list-disc space-y-1 ps-5 text-danger">
                    {item.errorFields.map((field, index) => (
                      <li key={`${field.field}-${index}`} className="break-words">
                        <code translate="no">{field.field}</code>: {field.message}
                      </li>
                    ))}
                  </ul>
                )}
                <AutomationTimeline execution={item} locale={locale} messages={messages} compact />
              </div>
              <Button
                as={Link}
                href={`/projects/${projectId}/runs/${runId}/cases/${caseId}/executions/${item.id}`}
                locale={locale}
                size="sm"
                variant="bordered"
              >
                {messages.automationViewDetail}
              </Button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
