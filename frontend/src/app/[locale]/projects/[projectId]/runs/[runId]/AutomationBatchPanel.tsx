'use client';

import { useContext, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Select, SelectItem } from '@heroui/react';
import { Play } from 'lucide-react';
import { getPersistedRunCase } from '../runsControl';
import { gherkinTemplate } from '@/config/selection';
import type { CaseType } from '@/types/case';
import type { RunMessages } from '@/types/run';
import type { AutomationBatchResult, AutomationEnvironment, AutomationStatus } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import { fetchAutomationEnvironments, runAutomationBatch } from '@/utils/automationControl';

type Props = {
  projectId: string;
  runId: string;
  cases: CaseType[];
  messages: RunMessages;
  isAuthorized: boolean;
  hasPendingRunCaseChanges: boolean;
};

function statusLabel(status: AutomationStatus, messages: RunMessages): string {
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

export default function AutomationBatchPanel({
  projectId,
  runId,
  cases,
  messages,
  isAuthorized,
  hasPendingRunCaseChanges,
}: Props) {
  const tokenContext = useContext(TokenContext);
  const [environments, setEnvironments] = useState<AutomationEnvironment[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState('');
  const [results, setResults] = useState<AutomationBatchResult[]>([]);
  const [runningTitle, setRunningTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const eligibleCases = useMemo(
    () =>
      cases.flatMap((testCase) => {
        const runCase = getPersistedRunCase(testCase);
        return runCase && testCase.template === gherkinTemplate
          ? [{ caseId: testCase.id, runCaseId: runCase.id, title: testCase.title }]
          : [];
      }),
    [cases]
  );
  const includedCases = useMemo(() => cases.filter((testCase) => getPersistedRunCase(testCase)), [cases]);
  const skippedCases = includedCases.length - eligibleCases.length;

  useEffect(() => {
    if (!tokenContext.isSignedIn() || !tokenContext.token.access_token) return;
    let disposed = false;
    fetchAutomationEnvironments(tokenContext.token.access_token, Number(projectId))
      .then((items) => {
        if (disposed) return;
        setEnvironments(items);
        const defaultEnvironment = items.find((environment) => environment.isDefault);
        setSelectedEnvironment((current) => current || (defaultEnvironment ? String(defaultEnvironment.id) : ''));
      })
      .catch(() => {
        if (!disposed) setError(messages.runGherkinCasesError);
      });
    return () => {
      disposed = true;
    };
  }, [messages.runGherkinCasesError, projectId, tokenContext]);

  const handleRun = async () => {
    if (
      !isAuthorized ||
      !selectedEnvironment ||
      !tokenContext.token.access_token ||
      eligibleCases.length === 0 ||
      hasPendingRunCaseChanges
    )
      return;
    setIsLoading(true);
    setError('');
    setResults([]);
    setRunningTitle('');
    const batchId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await runAutomationBatch(tokenContext.token.access_token, {
        projectId: Number(projectId),
        runId: Number(runId),
        environmentId: Number(selectedEnvironment),
        cases: eligibleCases,
        batchId,
        onStart: (testCase) => setRunningTitle(testCase.title),
        onResult: (result) => {
          setRunningTitle('');
          setResults((current) => [...current.filter((item) => item.runCaseId !== result.runCaseId), result]);
        },
      });
    } catch {
      setError(messages.runGherkinCasesError);
    } finally {
      setRunningTitle('');
      setIsLoading(false);
    }
  };

  return (
    <section className="mt-6 min-w-0 rounded-md border p-4" aria-labelledby="run-automation-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h6 id="run-automation-heading" className="font-bold">
            {messages.runIncludedGherkin}
          </h6>
          <p className="text-sm text-default-500">{messages.runGherkinCasesDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="flat">
            {eligibleCases.length} {messages.runGherkinCasesProgress}
          </Chip>
          {skippedCases > 0 && (
            <Chip size="sm" variant="flat" color="warning">
              {skippedCases} {messages.runGherkinCasesSkipped}
            </Chip>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Select
          size="sm"
          variant="bordered"
          label={messages.automationEnvironment}
          selectedKeys={selectedEnvironment ? [selectedEnvironment] : []}
          onSelectionChange={(selection) => {
            if (selection !== 'all' && selection.size > 0) setSelectedEnvironment(String(Array.from(selection)[0]));
          }}
          isDisabled={!isAuthorized || isLoading || environments.length === 0}
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
          isDisabled={
            !isAuthorized || !selectedEnvironment || eligibleCases.length === 0 || isLoading || hasPendingRunCaseChanges
          }
          isLoading={isLoading}
          onPress={handleRun}
        >
          {messages.runIncludedGherkin}
        </Button>
      </div>
      {hasPendingRunCaseChanges && (
        <p className="mt-3 text-sm text-warning" role="status" aria-live="polite">
          {messages.pleaseSave}
        </p>
      )}
      {runningTitle && (
        <p className="mt-3 text-sm" role="status" aria-live="polite">
          {messages.automationRunning}: {runningTitle}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold">{messages.runGherkinCasesComplete}</p>
          <ul className="space-y-1 text-sm">
            {results.map((result) => (
              <li key={result.runCaseId} className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words">{result.title}</span>
                <div className="min-w-0">
                  <Chip
                    size="sm"
                    className="max-w-full"
                    color={result.error ? 'danger' : result.execution?.status === 'passed' ? 'success' : 'warning'}
                  >
                    <span className="break-words">
                      {result.error ??
                        (result.execution ? statusLabel(result.execution.status, messages) : messages.automationError)}
                    </span>
                  </Chip>
                  {result.errorFields && result.errorFields.length > 0 && (
                    <ul className="mt-1 list-disc space-y-1 ps-5 text-danger">
                      {result.errorFields.map((field, index) => (
                        <li key={`${field.field}-${index}`} className="break-words">
                          <code translate="no">{field.field}</code>: {field.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
