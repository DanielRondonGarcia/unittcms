'use client';

import { useContext, useEffect, useState } from 'react';
import { Button, Select, SelectItem } from '@heroui/react';
import { Download, Play, X } from 'lucide-react';
import { TokenContext } from '@/utils/TokenProvider';
import { Link } from '@/src/i18n/routing';
import type { RunDetailMessages } from '@/types/run';
import type {
  AutomationArtifact,
  AutomationErrorField,
  AutomationEnvironment,
  AutomationExecution,
  AutomationStatus,
} from '@/types/automation';
import {
  cancelAutomationExecution,
  createAutomationExecution,
  downloadAutomationArtifact,
  fetchAutomationArtifacts,
  fetchAutomationEnvironments,
  fetchAutomationExecution,
  fetchAutomationHistory,
  formatAutomationDuration,
  isAutomationActive,
  AutomationRequestError,
} from '@/utils/automationControl';

type Props = {
  projectId: string;
  runId: string;
  caseId: string;
  runCaseId: number;
  locale: string;
  messages: RunDetailMessages;
};

export default function AutomationExecutionPanel({ projectId, runId, caseId, runCaseId, locale, messages }: Props) {
  const tokenContext = useContext(TokenContext);
  const [environments, setEnvironments] = useState<AutomationEnvironment[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState('');
  const [execution, setExecution] = useState<AutomationExecution | null>(null);
  const [history, setHistory] = useState<AutomationExecution[]>([]);
  const [artifacts, setArtifacts] = useState<AutomationArtifact[]>([]);
  const [isEnvironmentLoading, setIsEnvironmentLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<AutomationErrorField[]>([]);

  const accessToken = tokenContext.token.access_token;
  const isAuthorized = tokenContext.isProjectDeveloper(Number(projectId));

  const statusLabel = (status: AutomationStatus) =>
    ({
      queued: messages.automationQueued,
      running: messages.automationRunning,
      passed: messages.automationPassed,
      failed: messages.automationFailed,
      error: messages.automationError,
      cancelled: messages.automationCancelled,
    })[status];

  useEffect(() => {
    if (!tokenContext.isSignedIn() || !accessToken) return;

    let disposed = false;
    setIsEnvironmentLoading(true);
    setError(null);
    setErrorFields([]);
    fetchAutomationEnvironments(accessToken, Number(projectId))
      .then((items) => {
        if (disposed) return;
        setEnvironments(items);
        const defaultEnvironment = items.find((environment) => environment.isDefault);
        setSelectedEnvironment((current) => current || (defaultEnvironment ? String(defaultEnvironment.id) : ''));
      })
      .catch(() => {
        if (!disposed) {
          setEnvironments([]);
          setError(messages.automationUnavailable);
          setErrorFields([]);
        }
      })
      .finally(() => {
        if (!disposed) setIsEnvironmentLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [accessToken, messages.automationUnavailable, projectId, tokenContext]);

  useEffect(() => {
    const executionId = execution?.id;
    if (!executionId || !accessToken || !isAutomationActive(execution.status)) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await fetchAutomationExecution(accessToken, executionId);
        if (disposed) return;
        setExecution(next);
        if (isAutomationActive(next.status)) timer = setTimeout(poll, 750);
      } catch {
        if (!disposed) {
          setError(messages.automationUnavailable);
          setErrorFields([]);
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessToken, execution?.id, execution?.status, messages.automationUnavailable]);

  useEffect(() => {
    const executionId = execution?.id;
    if (!executionId || !accessToken || !execution.status || isAutomationActive(execution.status)) return;

    let disposed = false;
    Promise.all([
      fetchAutomationArtifacts(accessToken, executionId),
      fetchAutomationHistory(accessToken, Number(projectId), Number(caseId), runCaseId),
    ])
      .then(([nextArtifacts, nextHistory]) => {
        if (disposed) return;
        setArtifacts(nextArtifacts);
        setHistory(nextHistory.filter((item) => Number(item.runCaseId) === runCaseId));
      })
      .catch(() => {
        if (!disposed) {
          setError(messages.automationUnavailable);
          setErrorFields([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, [accessToken, caseId, execution?.id, execution?.status, messages.automationUnavailable, projectId, runCaseId]);

  const handleRun = async () => {
    if (!isAuthorized || !selectedEnvironment || !accessToken || !Number.isInteger(runCaseId) || runCaseId <= 0) return;
    setIsActionLoading(true);
    setError(null);
    setErrorFields([]);
    setArtifacts([]);
    setHistory([]);
    try {
      const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const nextExecution = await createAutomationExecution(accessToken, {
        projectId: Number(projectId),
        caseId: Number(caseId),
        runCaseId,
        environmentId: Number(selectedEnvironment),
        idempotencyKey: `run-case-${runCaseId}-${random}`,
      });
      setExecution(nextExecution);
    } catch (error) {
      if (error instanceof AutomationRequestError) {
        setError(error.code);
        setErrorFields(error.fields);
      } else {
        setError(messages.automationUnavailable);
        setErrorFields([]);
      }
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!execution || !accessToken || !isAutomationActive(execution.status)) return;
    setIsActionLoading(true);
    try {
      setExecution(await cancelAutomationExecution(accessToken, execution.id));
    } catch {
      setError(messages.automationUnavailable);
      setErrorFields([]);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleArtifactDownload = async (artifact: AutomationArtifact) => {
    if (!accessToken) return;
    try {
      const result = await downloadAutomationArtifact(accessToken, artifact.id);
      if (!result.content || result.encoding !== 'base64') return;
      const bytes = Uint8Array.from(atob(result.content), (character) => character.charCodeAt(0));
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType ?? 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = artifact.filename ?? `${artifact.kind}.evidence`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError(messages.automationUnavailable);
      setErrorFields([]);
    }
  };

  return (
    <div
      className="mt-6 min-w-0 max-w-full overflow-x-hidden rounded-md border p-4"
      aria-labelledby="automation-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h6 id="automation-heading" className="font-bold">
          {messages.automation}
        </h6>
        {execution && (
          <span role="status" aria-live="polite">
            {statusLabel(execution.status)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Select
          size="sm"
          variant="bordered"
          label={messages.automationEnvironment}
          placeholder={messages.selectAutomationEnvironment}
          selectedKeys={selectedEnvironment ? [selectedEnvironment] : []}
          onSelectionChange={(selection) => {
            if (selection !== 'all' && selection.size > 0) setSelectedEnvironment(String(Array.from(selection)[0]));
          }}
          isDisabled={!isAuthorized || isEnvironmentLoading || environments.length === 0}
          className="w-full min-w-0 sm:max-w-64"
        >
          {environments.map((environment) => (
            <SelectItem key={String(environment.id)}>{environment.name}</SelectItem>
          ))}
        </Select>
        <Button
          color="primary"
          size="sm"
          startContent={<Play size={15} />}
          isDisabled={!isAuthorized || !selectedEnvironment || isActionLoading}
          isLoading={isActionLoading && !execution}
          onPress={handleRun}
        >
          {messages.runAutomatically}
        </Button>
      </div>

      {isEnvironmentLoading && <p className="mt-2 text-sm">{messages.automationLoading}</p>}
      {!isEnvironmentLoading && environments.length === 0 && !error && (
        <p className="mt-2 text-sm">{messages.noAutomationEnvironments}</p>
      )}
      {error && (
        <div className="mt-2 min-w-0 text-sm text-danger" role="alert">
          <p className="break-words whitespace-pre-wrap">{error}</p>
          {errorFields.length > 0 && (
            <ul className="mt-1 list-disc space-y-1 ps-5">
              {errorFields.map((field, index) => (
                <li key={`${field.field}-${index}`} className="break-words">
                  <code translate="no">{field.field}</code>: {field.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {execution && (
        <div className="mt-4 min-w-0 space-y-2 text-sm">
          {isAutomationActive(execution.status) && (
            <Button
              color="warning"
              variant="flat"
              size="sm"
              startContent={<X size={15} />}
              isLoading={isActionLoading}
              onPress={handleCancel}
            >
              {messages.cancelAutomation}
            </Button>
          )}
          {execution.summary && (
            <p className="break-words whitespace-pre-wrap">
              <strong>{messages.automationSummary}:</strong> {execution.summary}
            </p>
          )}
          {execution.error && (
            <p className="break-words whitespace-pre-wrap" role="alert">
              <strong>{messages.automationErrorDetail}:</strong> {execution.error}
            </p>
          )}
          {execution.errorFields && execution.errorFields.length > 0 && (
            <ul className="list-disc space-y-1 ps-5 text-danger">
              {execution.errorFields.map((field, index) => (
                <li key={`${field.field}-${index}`} className="break-words">
                  <code translate="no">{field.field}</code>: {field.message}
                </li>
              ))}
            </ul>
          )}
          {(execution.finishedAt || execution.durationMs !== undefined) && (
            <p>
              <strong>{messages.automationDuration}:</strong> {formatAutomationDuration(execution.durationMs)}
            </p>
          )}
          <div>
            <strong>{messages.automationEvidence}</strong>
            {artifacts.length === 0 ? (
              <p>{messages.automationNoEvidence}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {artifacts.map((artifact) => (
                  <li key={String(artifact.id)} className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all">{artifact.filename ?? artifact.kind}</span>
                    <Button
                      size="sm"
                      variant="light"
                      startContent={<Download size={14} />}
                      onPress={() => handleArtifactDownload(artifact)}
                    >
                      {messages.downloadAutomationArtifact}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {history.length > 0 && (
            <div>
              <strong>{messages.automationHistory}</strong>
              <ul className="mt-1 space-y-1">
                {history.map((historyItem) => (
                  <li key={String(historyItem.id)} className="flex min-w-0 flex-wrap items-center gap-2">
                    <span>
                      {statusLabel(historyItem.status)} - {formatAutomationDuration(historyItem.durationMs)}
                    </span>
                    <Button
                      as={Link}
                      href={`/projects/${projectId}/runs/${runId}/cases/${caseId}/executions/${historyItem.id}`}
                      locale={locale}
                      size="sm"
                      variant="light"
                    >
                      {messages.automationViewDetail}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
