'use client';

import { useContext, useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Link } from '@/src/i18n/routing';
import type { RunDetailMessages } from '@/types/run';
import type { AutomationExecution, AutomationStatus } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import { fetchAutomationHistory, formatAutomationDuration } from '@/utils/automationControl';

type Props = {
  projectId: string;
  runId: string;
  caseId: string;
  runCaseId?: number;
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

export default function AutomationHistory({ projectId, runId, caseId, runCaseId, locale, messages }: Props) {
  const context = useContext(TokenContext);
  const [items, setItems] = useState<AutomationExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!context.isSignedIn() || !context.token.access_token || !runCaseId) {
      setIsLoading(false);
      return;
    }
    let disposed = false;
    setIsLoading(true);
    fetchAutomationHistory(context.token.access_token, Number(projectId), Number(caseId), runCaseId)
      .then((history) => {
        if (!disposed) {
          setItems(sortNewestFirst(history));
          setHasError(false);
        }
      })
      .catch(() => {
        if (!disposed) setHasError(true);
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [caseId, context.token.access_token, projectId, runCaseId, context]);

  if (isLoading) return <p>{messages.automationHistoryLoading}</p>;
  if (hasError) return <p role="alert">{messages.automationUnavailable}</p>;
  if (items.length === 0) return <p>{messages.automationHistoryEmpty}</p>;

  return (
    <div className="min-w-0 space-y-3">
      {items.map((item) => (
        <div
          key={String(item.id)}
          className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-3"
        >
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
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
                {statusLabel(item.status, messages)}
              </Chip>
              <span>{formatAutomationDuration(item.durationMs)}</span>
              <span>{timestamp(item.queuedAt ?? item.createdAt, locale)}</span>
              {item.attempt !== undefined && (
                <span>
                  {messages.automationAttempt}: {item.attempt}
                </span>
              )}
            </div>
            {item.summary && <p className="break-words whitespace-pre-wrap">{item.summary}</p>}
            {item.error && <p className="break-words whitespace-pre-wrap text-danger">{item.error}</p>}
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
      ))}
    </div>
  );
}
