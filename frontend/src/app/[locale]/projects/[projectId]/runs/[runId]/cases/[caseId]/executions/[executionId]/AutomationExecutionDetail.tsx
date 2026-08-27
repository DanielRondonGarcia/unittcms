'use client';

import { useContext, useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { Link } from '@/src/i18n/routing';
import type { RunDetailMessages } from '@/types/run';
import type { AutomationArtifact, AutomationExecution, AutomationStatus } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import {
  downloadAutomationArtifact,
  fetchAutomationArtifacts,
  fetchAutomationExecution,
  formatAutomationDuration,
} from '@/utils/automationControl';

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

export default function AutomationExecutionDetail({ projectId, runId, caseId, executionId, locale, messages }: Props) {
  const context = useContext(TokenContext);
  const [execution, setExecution] = useState<AutomationExecution | null>(null);
  const [artifacts, setArtifacts] = useState<AutomationArtifact[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!context.isSignedIn() || !context.token.access_token) return;
    let disposed = false;
    Promise.all([
      fetchAutomationExecution(context.token.access_token, executionId),
      fetchAutomationArtifacts(context.token.access_token, executionId),
    ])
      .then(([nextExecution, nextArtifacts]) => {
        if (!disposed) {
          setExecution(nextExecution);
          setArtifacts(nextArtifacts);
        }
      })
      .catch(() => {
        if (!disposed) setError(messages.automationUnavailable);
      });
    return () => {
      disposed = true;
    };
  }, [context, context.token.access_token, executionId, messages.automationUnavailable]);

  useEffect(() => {
    const video = artifacts.find((artifact) => artifact.mimeType?.toLowerCase().startsWith('video/'));
    if (!video || execution?.captureVideo !== true || !context.token.access_token) return;
    let disposed = false;
    let objectUrl = '';
    downloadAutomationArtifact(context.token.access_token, video.id)
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
  }, [artifacts, context, context.token.access_token, execution?.captureVideo, messages.automationUnavailable]);

  const handleDownload = async (artifact: AutomationArtifact) => {
    if (!context.token.access_token) return;
    try {
      const download = await downloadAutomationArtifact(context.token.access_token, artifact.id);
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

  return (
    <main className="mx-auto w-full min-w-0 max-w-4xl space-y-6 overflow-x-hidden p-6">
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

      <section className="min-w-0 max-w-full rounded-md border p-4">
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
            {statusLabel(execution.status, messages)}
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
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
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
        </dl>
        {execution.summary && <p className="mt-4 break-words whitespace-pre-wrap">{execution.summary}</p>}
        {execution.error && (
          <p className="mt-4 break-words whitespace-pre-wrap text-danger" role="alert">
            {execution.error}
          </p>
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

      <section className="min-w-0 max-w-full rounded-md border p-4">
        <h2 className="font-semibold">{messages.automationSnapshot}</h2>
        <pre className="mt-3 max-h-96 max-w-full overflow-auto rounded bg-default-100 p-3 text-xs">{snapshot}</pre>
      </section>

      <section className="min-w-0 max-w-full rounded-md border p-4">
        <h2 className="font-semibold">{messages.automationEvidence}</h2>
        {artifacts.length === 0 ? (
          <p className="mt-2 text-sm">{messages.automationNoEvidence}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {artifacts.map((artifact) => (
              <li key={String(artifact.id)} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 break-all">{artifact.filename ?? artifact.kind}</span>
                <Button size="sm" variant="light" onPress={() => handleDownload(artifact)}>
                  {messages.downloadAutomationArtifact}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {execution.captureVideo === true && videoUrl ? (
          <div className="mt-4">
            <h3 className="font-semibold">{messages.automationVideo}</h3>
            <video className="mt-2 max-w-full rounded" controls src={videoUrl} />
          </div>
        ) : execution.captureVideo !== true ? (
          <p className="mt-3 text-sm text-default-500">{messages.automationNoVideo}</p>
        ) : null}
      </section>
    </main>
  );
}
