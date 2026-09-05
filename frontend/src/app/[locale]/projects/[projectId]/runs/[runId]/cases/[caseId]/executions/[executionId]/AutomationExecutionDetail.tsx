'use client';

import { useContext, useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import AutomationTimeline from '../../AutomationTimeline';
import { Link } from '@/src/i18n/routing';
import type { RunDetailMessages } from '@/types/run';
import type { AutomationArtifact, AutomationExecution, AutomationStatus } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import {
  downloadAutomationArtifact,
  fetchAutomationArtifacts,
  fetchAutomationExecution,
  formatAutomationError,
  formatAutomationDuration,
  formatAutomationExampleLabel,
  isAutomationActive,
} from '@/utils/automationControl';
import { useAutomationPolling } from '@/utils/useAutomationPolling';

type Props = {
  projectId: string;
  runId: string;
  caseId: string;
  executionId: string;
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

function executionStatusLabel(execution: AutomationExecution, messages: RunDetailMessages): string {
  return execution.diagnostics?.timedOut === true ||
    execution.error === 'hercules_timeout' ||
    execution.error === 'deadline_exceeded'
    ? messages.automationTimeout
    : execution.errorKind === 'evidence'
      ? messages.automationEvidenceInsufficient
      : statusLabel(execution.status, messages);
}

function isTimedOut(execution: AutomationExecution): boolean {
  return (
    execution.diagnostics?.timedOut === true ||
    execution.error === 'hercules_timeout' ||
    execution.error === 'deadline_exceeded'
  );
}

function executionErrorMessage(execution: AutomationExecution, messages: RunDetailMessages): string | undefined {
  return formatAutomationError(
    {
      code: execution.error,
      errorKind: execution.errorKind,
      status: execution.status,
      timedOut: execution.diagnostics?.timedOut === true,
    },
    messages
  );
}

function workerStatusLabel(execution: AutomationExecution, messages: RunDetailMessages): string {
  return executionErrorMessage(execution, messages) ?? executionStatusLabel(execution, messages);
}

function timestamp(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function artifactBytes(content: string): Uint8Array {
  return Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
}

function artifactName(artifact: AutomationArtifact): string {
  return artifact.filename ?? artifact.storageKey?.split('/').pop() ?? artifact.kind;
}

function artifactSize(size: number | undefined): string {
  if (!Number.isFinite(size) || size === undefined || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function snapshotExampleRow(execution: AutomationExecution): string[] | undefined {
  if (execution.exampleIndex === undefined || execution.exampleIndex === null) return undefined;
  const snapshot =
    typeof execution.snapshot === 'string'
      ? (() => {
          try {
            return JSON.parse(execution.snapshot) as unknown;
          } catch {
            return undefined;
          }
        })()
      : execution.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const examples = (snapshot as { examples?: unknown }).examples;
  if (!examples || typeof examples !== 'object') return undefined;
  const rows = (examples as { rows?: unknown }).rows;
  const row = Array.isArray(rows) ? rows[execution.exampleIndex] : undefined;
  return Array.isArray(row) && row.every((value) => typeof value === 'string') ? row : undefined;
}

export default function AutomationExecutionDetail({ projectId, runId, caseId, executionId, locale, messages }: Props) {
  const context = useContext(TokenContext);
  const [execution, setExecution] = useState<AutomationExecution | null>(null);
  const [artifacts, setArtifacts] = useState<AutomationArtifact[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const accessToken = context.token.access_token;

  useEffect(() => {
    if (!context.isSignedIn() || !accessToken) return;
    let disposed = false;
    Promise.all([fetchAutomationExecution(accessToken, executionId)])
      .then(([nextExecution]) => {
        if (!disposed) {
          setExecution(nextExecution);
        }
      })
      .catch(() => {
        if (!disposed) setError(messages.automationUnavailable);
      });
    return () => {
      disposed = true;
    };
  }, [accessToken, context, executionId, messages.automationUnavailable]);

  useAutomationPolling({
    active: Boolean(accessToken && execution && isAutomationActive(execution.status)),
    poll: () => fetchAutomationExecution(accessToken as string, executionId),
    onValue: (nextExecution) => {
      setExecution(nextExecution);
      setError('');
    },
    onError: () => setError(messages.automationUnavailable),
  });

  const terminalExecutionId = execution?.id;
  const terminalExecutionStatus = execution?.status;

  useEffect(() => {
    if (!terminalExecutionId || !accessToken || !terminalExecutionStatus || isAutomationActive(terminalExecutionStatus))
      return;
    let disposed = false;
    fetchAutomationArtifacts(accessToken, terminalExecutionId)
      .then((nextArtifacts) => {
        if (!disposed) setArtifacts(nextArtifacts);
      })
      .catch(() => {
        if (!disposed) setError(messages.automationUnavailable);
      });
    return () => {
      disposed = true;
    };
  }, [accessToken, messages.automationUnavailable, terminalExecutionId, terminalExecutionStatus]);

  useEffect(() => {
    const video = artifacts.find((artifact) => artifact.mimeType?.toLowerCase().startsWith('video/'));
    if (!video || execution?.captureVideo !== true || !accessToken) return;
    let disposed = false;
    let objectUrl = '';
    downloadAutomationArtifact(accessToken, video.id)
      .then((download) => {
        if (disposed || !download.content || download.encoding !== 'base64') return;
        objectUrl = URL.createObjectURL(new Blob([artifactBytes(download.content)], { type: video.mimeType }));
        setVideoUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setError(messages.automationUnavailable);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accessToken, artifacts, execution?.captureVideo, messages.automationUnavailable]);

  const handleDownload = async (artifact: AutomationArtifact) => {
    if (!accessToken) return;
    try {
      const download = await downloadAutomationArtifact(accessToken, artifact.id);
      if (!download.content || download.encoding !== 'base64') return;
      const objectUrl = URL.createObjectURL(
        new Blob([artifactBytes(download.content)], { type: download.mimeType ?? 'application/octet-stream' })
      );
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = artifact.filename ?? `${artifact.kind}.evidence`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError(messages.automationUnavailable);
    }
  };

  if (!execution) {
    return <div className="min-w-0 p-6">{error || messages.automationLoading}</div>;
  }

  const snapshot =
    typeof execution.snapshot === 'string' ? execution.snapshot : JSON.stringify(execution.snapshot ?? {}, null, 2);
  const errorMessage = executionErrorMessage(execution, messages);
  const videoDescriptionId = `automation-video-description-${String(execution.id)}`;

  return (
    <main className="mx-auto min-h-full w-full min-w-0 max-w-4xl space-y-6 p-6 dark:bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{messages.automationExecutionDetail}</h1>
          <p className="break-all text-sm text-default-500" translate="no">
            {execution.id}
          </p>
        </div>
        <Button
          as={Link}
          href={`/projects/${projectId}/runs/${runId}/cases/${caseId}?tab=history`}
          locale={locale}
          variant="bordered"
          size="sm"
        >
          {messages.automationBackToHistory}
        </Button>
      </div>

      <section className="min-w-0 max-w-full rounded-md border p-4 dark:border-divider dark:bg-content1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            color={
              execution.status === 'passed'
                ? 'success'
                : execution.status === 'failed' || execution.status === 'error'
                  ? 'danger'
                  : 'warning'
            }
          >
            {executionStatusLabel(execution, messages)}
          </Chip>
          {execution.attempt !== undefined && (
            <span className="text-sm">
              {messages.automationAttempt}: {execution.attempt}
            </span>
          )}
          <span className="text-sm">
            {messages.automationDuration}: {formatAutomationDuration(execution.durationMs)}
          </span>
        </div>
        <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="font-semibold">{messages.automationQueuedAt}</dt>
            <dd>{timestamp(execution.queuedAt, locale)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationStartedAt}</dt>
            <dd>{timestamp(execution.startedAt, locale)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationFinishedAt}</dt>
            <dd>{timestamp(execution.finishedAt, locale)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationExample}</dt>
            <dd>
              {execution.exampleIndex === undefined || execution.exampleIndex === null
                ? '—'
                : (() => {
                    const label = formatAutomationExampleLabel(
                      messages.automationExample,
                      execution.exampleIndex,
                      snapshotExampleRow(execution)
                    );
                    return (
                      <span className="block min-w-0 max-w-full truncate" title={label} aria-label={label}>
                        {label}
                      </span>
                    );
                  })()}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationAttemptHistory}</dt>
            <dd>{Array.isArray(execution.attemptHistory) ? execution.attemptHistory.length : '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationEngine}</dt>
            <dd className="break-words">{execution.engine || '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationModel}</dt>
            <dd className="break-words">{execution.model || '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationEnvironmentId}</dt>
            <dd>{execution.environmentId ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationCorrelationId}</dt>
            <dd className="break-all" translate="no">
              {execution.correlationId || '—'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationSnapshotHash}</dt>
            <dd className="break-all" translate="no">
              {execution.snapshotHash || '—'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">{messages.automationWorkerStatus}</dt>
            <dd className="break-words">{workerStatusLabel(execution, messages)}</dd>
          </div>
        </dl>
        {execution.summary && <p className="mt-4 break-words whitespace-pre-wrap">{execution.summary}</p>}
        {errorMessage && (
          <div className="mt-4 space-y-1 text-danger" role="alert">
            <p className="font-semibold">
              {isTimedOut(execution) ? messages.automationTimeout : messages.automationErrorDetail}
            </p>
            <p className="break-words whitespace-pre-wrap">{errorMessage}</p>
          </div>
        )}
        {execution.errorFields && execution.errorFields.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-danger">
            {execution.errorFields.map((field, index) => (
              <li key={`${field.field}-${index}`} className="break-words">
                <code translate="no">{field.field}</code>: {field.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AutomationTimeline execution={execution} locale={locale} messages={messages} />

      {execution.diagnostics && (
        <section className="min-w-0 max-w-full rounded-md border p-4 dark:border-divider dark:bg-content1">
          <h2 className="font-semibold">{messages.automationDiagnostics}</h2>
          <p className="mt-2 text-sm text-default-500">{messages.automationDiagnosticsAvailable}</p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            {execution.diagnostics.exitCode !== undefined && (
              <div>
                <dt className="font-semibold">{messages.automationExitCode}</dt>
                <dd>{execution.diagnostics.exitCode ?? '—'}</dd>
              </div>
            )}
            {execution.diagnostics.signal && (
              <div>
                <dt className="font-semibold">{messages.automationSignal}</dt>
                <dd translate="no">{execution.diagnostics.signal}</dd>
              </div>
            )}
          </dl>
          {execution.diagnostics.stdout || execution.diagnostics.stderr ? (
            <div className="mt-4">
              <h3 className="font-semibold">{messages.automationOutput}</h3>
              <pre
                className="mt-2 max-h-96 max-w-full overflow-auto whitespace-pre-wrap rounded bg-default-100 p-3 text-xs dark:bg-content2"
                translate="no"
              >
                {[
                  execution.diagnostics.stderr && `stderr\n${execution.diagnostics.stderr}`,
                  execution.diagnostics.stdout && `stdout\n${execution.diagnostics.stdout}`,
                ]
                  .filter(Boolean)
                  .join('\n\n')}
              </pre>
            </div>
          ) : (
            <p className="mt-3 text-sm text-default-500">{messages.automationNoDiagnostics}</p>
          )}
        </section>
      )}

      <section className="min-w-0 max-w-full rounded-md border p-4 dark:border-divider dark:bg-content1">
        <h2 className="font-semibold">{messages.automationSnapshot}</h2>
        <pre className="mt-3 max-h-96 max-w-full overflow-auto rounded bg-default-100 p-3 text-xs dark:bg-content2">
          {snapshot}
        </pre>
      </section>

      <section className="min-w-0 max-w-full rounded-md border p-4 dark:border-divider dark:bg-content1">
        <h2 className="font-semibold">{messages.automationEvidence}</h2>
        {artifacts.length === 0 ? (
          <p className="mt-2 text-sm">{messages.automationNoEvidence}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {artifacts.map((artifact) => (
              <li key={String(artifact.id)} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="break-all">{artifactName(artifact)}</p>
                  <p className="break-words text-xs text-default-500">
                    {artifact.kind} · {artifact.mimeType ?? '—'} · {artifactSize(artifact.size)}
                  </p>
                </div>
                <Button className="max-w-full" size="sm" variant="light" onPress={() => handleDownload(artifact)}>
                  <span className="break-words">{messages.downloadAutomationArtifact}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {execution.captureVideo === true && videoUrl ? (
          <div className="mt-4">
            <h3 className="font-semibold">{messages.automationVideo}</h3>
            <p id={videoDescriptionId} className="sr-only">
              {messages.automationVideoDescription}
            </p>
            <video className="mt-2 max-w-full rounded" controls src={videoUrl} aria-describedby={videoDescriptionId} />
          </div>
        ) : execution.captureVideo !== true ? (
          <p className="mt-3 text-sm text-default-500">{messages.automationNoVideo}</p>
        ) : null}
      </section>
    </main>
  );
}
