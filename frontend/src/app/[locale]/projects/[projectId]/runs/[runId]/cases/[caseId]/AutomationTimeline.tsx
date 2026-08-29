'use client';

import type { RunDetailMessages } from '@/types/run';
import type { AutomationExecution, AutomationExecutionEvent, AutomationStatus } from '@/types/automation';
import { formatAutomationError } from '@/utils/automationControl';

type Props = {
  execution: AutomationExecution;
  locale: string;
  messages: RunDetailMessages;
  compact?: boolean;
};

type TimelineItem = {
  id: string;
  type: AutomationExecutionEvent['type'];
  createdAt?: string;
  message?: string;
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

function itemLabel(type: TimelineItem['type'], messages: RunDetailMessages): string {
  if (type === 'retrying') return messages.automationRetrying;
  return statusLabel(type as AutomationStatus, messages);
}

function itemMessage(item: TimelineItem, messages: RunDetailMessages): string | undefined {
  if (item.type === 'retrying') return undefined;
  return formatAutomationError({ code: item.message, status: item.type }, messages);
}

function timestamp(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function fallbackItems(execution: AutomationExecution): TimelineItem[] {
  const items: TimelineItem[] = [];
  if (execution.queuedAt || execution.createdAt) {
    items.push({ id: 'queued', type: 'queued', createdAt: execution.queuedAt ?? execution.createdAt });
  }
  if (execution.startedAt) items.push({ id: 'running', type: 'running', createdAt: execution.startedAt });
  if (execution.finishedAt) {
    items.push({ id: 'finished', type: execution.status, createdAt: execution.finishedAt });
  }
  if (items.length === 0) items.push({ id: 'current', type: execution.status, createdAt: execution.updatedAt });
  return items;
}

function timelineItems(execution: AutomationExecution): TimelineItem[] {
  if (!Array.isArray(execution.events) || execution.events.length === 0) return fallbackItems(execution);
  return [...execution.events]
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => ({
      id: String(event.id),
      type: event.type,
      createdAt: event.createdAt,
      message: event.message,
    }));
}

export default function AutomationTimeline({ execution, locale, messages, compact = false }: Props) {
  return (
    <section
      className={compact ? 'min-w-0' : 'min-w-0 rounded-md border p-4'}
      aria-labelledby={`timeline-${execution.id}`}
    >
      <h2 id={`timeline-${execution.id}`} className="font-semibold">
        {messages.automationTimeline}
      </h2>
      <ol className="mt-3 space-y-0">
        {timelineItems(execution).map((item, index, items) => (
          <li key={item.id} className="flex min-w-0 gap-3">
            <div className="flex w-3 shrink-0 flex-col items-center">
              <span
                className={`mt-1 h-3 w-3 rounded-full ${
                  item.type === 'retrying' ? 'bg-warning' : index === items.length - 1 ? 'bg-primary' : 'bg-default-400'
                }`}
                aria-hidden="true"
              />
              {index < items.length - 1 && <span className="w-px flex-1 bg-default-300" aria-hidden="true" />}
            </div>
            <div className={`min-w-0 flex-1 ${index < items.length - 1 ? 'pb-3' : 'pb-1'}`}>
              <p className="break-words text-sm font-medium">{itemLabel(item.type, messages)}</p>
              <time className="text-xs text-default-500" dateTime={item.createdAt}>
                {timestamp(item.createdAt, locale)}
              </time>
              {itemMessage(item, messages) && (
                <p className="break-words text-xs text-default-500">{itemMessage(item, messages)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
