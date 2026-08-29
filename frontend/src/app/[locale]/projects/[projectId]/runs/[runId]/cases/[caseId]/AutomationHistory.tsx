'use client';

import { useCallback, useContext, useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Link } from '@/src/i18n/routing';
import type { GherkinExamples } from '@/types/case';
import type { RunDetailMessages } from '@/types/run';
import type { AutomationExecution, AutomationStatus } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import { fetchAutomationHistory, formatAutomationExampleLabel, formatAutomationDuration } from '@/utils/automationControl';
import { useAutomationPolling } from '@/utils/useAutomationPolling';

type Props = {
  projectId: string;
  runId: string;
  caseId: string;
  runCaseId?: number;
  examples?: GherkinExamples | null;
  locale: string;
  messages: RunDetailMessages;
};

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
  return item.errorKind === 'evidence' ? messages.automationEvidenceInsufficient : statusLabel(item.status, messages);
}

function sortNewestFirst(items: AutomationExecution[]): AutomationExecution[] {
  return [...items].sort((left, right) => {
    const leftDate = new Date(left.queuedAt ?? left.createdAt ?? 0).getTime();
    const rightDate = new Date(right.queuedAt ?? right.createdAt ?? 0).getTime();
    return rightDate - leftDate;
  });
}

function timestamp(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function AutomationHistory({ projectId, runId, caseId, runCaseId, examples, locale, messages }: Props) {
  const context = useContext(TokenContext);
  const [items, setItems] = useState<AutomationExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const accessToken = context.token.access_token;
  const validRunCaseId =
    typeof runCaseId === 'number' && Number.isInteger(runCaseId) && runCaseId > 0;
  const historyKey = `${projectId}:${caseId}:${runCaseId ?? ''}`;

  const loadHistory = useCallback(async () => {
    const linkedRunCaseId = runCaseId;
    if (!accessToken || typeof linkedRunCaseId !== 'number' || !Number.isInteger(linkedRunCaseId) || linkedRunCaseId <= 0)
      return [];
    const history = await fetchAutomationHistory(accessToken, Number(projectId), Number(caseId), linkedRunCaseId);
    return sortNewestFirst(history.filter((item) => Number(item.runCaseId) === linkedRunCaseId));
  }, [accessToken, caseId, projectId, runCaseId]);

  useEffect(() => {
    setItems([]);
    setHasError(false);
    setIsLoading(Boolean(accessToken && validRunCaseId));
  }, [accessToken, historyKey, validRunCaseId]);

  useAutomationPolling({
    active: Boolean(accessToken && validRunCaseId),
    poll: loadHistory,
    restartKey: historyKey,
    onValue: (history) => {
      setItems(history);
      setIsLoading(false);
      setHasError(false);
    },
    onError: () => {
      setIsLoading(false);
      setHasError(true);
    },
  });

  if (isLoading) return <p role="status" aria-live="polite">{messages.automationHistoryLoading}</p>;
  if (hasError && items.length === 0) return <p role="alert">{messages.automationUnavailable}</p>;
  if (items.length === 0) return <p>{messages.automationHistoryEmpty}</p>;

  return (
    <div className="min-w-0 space-y-3">
      {items.map((item) => {
        const exampleLabel =
          item.exampleIndex === undefined || item.exampleIndex === null
            ? undefined
            : formatAutomationExampleLabel(messages.automationExample, item.exampleIndex, examples?.rows[item.exampleIndex]);
        return (
          <div
            key={String(item.id)}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
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
              {item.errorKind === 'evidence' ? (
                <p className="break-words whitespace-pre-wrap text-danger">{messages.automationEvidenceInsufficient}</p>
              ) : (
                item.error && <p className="break-words whitespace-pre-wrap text-danger">{item.error}</p>
              )}
              {item.errorFields && item.errorFields.length > 0 && (
                <ul className="list-disc space-y-1 ps-5 text-danger">
                  {item.errorFields.map((field, index) => (
                    <li key={`${field.field}-${index}`} className="break-words">
                      <code translate="no">{field.field}</code>: {field.message}
                    </li>
                  ))}
                </ul>
              )}
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
    </div>
  );
}
