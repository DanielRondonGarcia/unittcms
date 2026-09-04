'use client';

import { useCallback, useContext, useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { Download, Eye } from 'lucide-react';
import Config from '@/config/config';
import { TokenContext } from '@/utils/TokenProvider';
import { downloadReport, previewReport } from '@/utils/reportControl';
import {
  REPORT_FORMATS,
  type ReportControlInput,
  type ReportFormat,
  type ReportOutput,
  type ReportRunOption,
  type ReportScenarioOption,
  type ReportsMessages,
} from '@/types/report';
import type { LocaleCodeType } from '@/types/locale';

type Props = { projectId: string; locale: LocaleCodeType; messages: ReportsMessages };
type BusyState = 'runs' | 'scenarios' | 'preview' | ReportFormat | null;
type PageError = { message: string; code?: string; correlationId?: string };
const apiServer = Config.apiServer;

async function readList<T>(url: string, jwt: string): Promise<T[]> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error('Invalid report catalog response.');
  return value as T[];
}

function errorDetails(cause: unknown, fallback: string): PageError {
  const value = cause as { message?: unknown; code?: unknown; correlationId?: unknown };
  return {
    message: typeof value.message === 'string' ? value.message : fallback,
    code: typeof value.code === 'string' ? value.code : undefined,
    correlationId: typeof value.correlationId === 'string' ? value.correlationId : undefined,
  };
}

function saveOutput(output: ReportOutput): void {
  const url = URL.createObjectURL(new Blob([output.bytes], { type: output.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = output.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ReportsPage({ projectId, locale, messages }: Props) {
  const { token } = useContext(TokenContext);
  const accessToken = token.access_token;
  const [runs, setRuns] = useState<ReportRunOption[]>([]);
  const [scenarios, setScenarios] = useState<ReportScenarioOption[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectionMode, setSelectionMode] = useState<'all' | 'explicit'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<ReportOutput | null>(null);
  const [error, setError] = useState<PageError | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);

  const loadRuns = useCallback(async () => {
    if (!accessToken) return;
    setBusy('runs');
    setError(null);
    try {
      setRuns(
        await readList<ReportRunOption>(`${apiServer}/runs?projectId=${encodeURIComponent(projectId)}`, accessToken)
      );
    } catch (cause) {
      setError(errorDetails(cause, messages.requestError));
    } finally {
      setBusy(null);
    }
  }, [accessToken, messages.requestError, projectId]);

  useEffect(() => void loadRuns(), [loadRuns]);

  const loadScenarios = async (runId: string) => {
    setSelectedRunId(runId);
    setScenarios([]);
    setSelectedIds(new Set());
    setPreview(null);
    setError(null);
    if (!runId || !accessToken) return;
    setBusy('scenarios');
    try {
      setScenarios(
        await readList<ReportScenarioOption>(
          `${apiServer}/cases/byproject?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(runId)}`,
          accessToken
        )
      );
    } catch (cause) {
      setError(errorDetails(cause, messages.requestError));
    } finally {
      setBusy(null);
    }
  };

  const inputFor = (requestedFormat: ReportFormat): ReportControlInput => ({
    selection: selectionMode === 'all' ? { mode: 'all' } : { mode: 'explicit', scenarioIds: Array.from(selectedIds) },
    runId: selectedRunId,
    format: requestedFormat,
    locale,
  });

  const runReport = async (intent: 'preview' | 'download', requestedFormat: ReportFormat) => {
    setError(null);
    if (intent === 'preview') setPreview(null);
    setBusy(intent === 'preview' ? 'preview' : requestedFormat);
    try {
      const input = inputFor(requestedFormat);
      const result =
        intent === 'preview'
          ? await previewReport(accessToken, projectId, {
              selection: input.selection,
              runId: input.runId,
              locale: input.locale,
            })
          : await downloadReport(accessToken, projectId, input);
      if (!result.ok) {
        setError(errorDetails(result.error, messages.requestError));
        return;
      }
      if (intent === 'preview') setPreview(result.data);
      else saveOutput(result.data);
    } catch (cause) {
      setError(errorDetails(cause, messages.requestError));
    } finally {
      setBusy(null);
    }
  };

  const toggleScenario = (id: number) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <main className="container mx-auto max-w-5xl px-6 pb-12 pt-6">
      <h1 className="text-xl font-bold">{messages.title}</h1>
      {error && (
        <div role="alert" className="my-4 rounded-medium bg-danger-50 p-3 text-danger">
          <p>{error.message}</p>
          {error.code && <p className="text-sm">{error.code}</p>}
          {error.correlationId && (
            <p className="text-sm">
              {messages.correlationId}: {error.correlationId}
            </p>
          )}
        </div>
      )}
      <section aria-busy={busy !== null} className="mt-6 flex flex-col gap-5 rounded-medium border p-5">
        <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="report-execution">
          {messages.execution}
          <select
            id="report-execution"
            required
            value={selectedRunId}
            disabled={busy !== null}
            onChange={(event) => void loadScenarios(event.target.value)}
            className="rounded-medium border p-2 font-normal"
          >
            <option value="">{messages.chooseExecution}</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name}
              </option>
            ))}
          </select>
        </label>
        {busy === 'runs' && <p role="status">{messages.loading}</p>}
        {busy === null && runs.length === 0 && <p className="text-sm text-default-500">{messages.noRuns}</p>}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{messages.selection}</legend>
          <label>
            <input
              type="radio"
              name="report-selection"
              checked={selectionMode === 'all'}
              onChange={() => setSelectionMode('all')}
            />{' '}
            {messages.allScenarios}
          </label>
          <label>
            <input
              type="radio"
              name="report-selection"
              checked={selectionMode === 'explicit'}
              onChange={() => setSelectionMode('explicit')}
            />{' '}
            {messages.explicitScenarios}
          </label>
        </fieldset>
        {selectedRunId && (
          <div className="flex flex-col gap-2" aria-label={messages.explicitScenarios}>
            {busy === 'scenarios' && <p role="status">{messages.loading}</p>}
            {busy !== 'scenarios' && scenarios.length === 0 && (
              <p className="text-sm text-default-500">{messages.noScenarios}</p>
            )}
            {selectionMode === 'explicit' &&
              scenarios.map((scenario) => (
                <label key={scenario.id} className="flex gap-2 p-1">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(scenario.id)}
                    onChange={() => toggleScenario(scenario.id)}
                  />
                  <span>
                    {scenario.title} <span className="text-xs text-default-500">#{scenario.id}</span>
                  </span>
                </label>
              ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            color="primary"
            startContent={<Eye size={16} />}
            isLoading={busy === 'preview'}
            isDisabled={busy !== null || !selectedRunId}
            onPress={() => void runReport('preview', 'html')}
          >
            {messages.preview}
          </Button>
          {REPORT_FORMATS.map((entry) => (
            <Button
              key={entry}
              variant="bordered"
              startContent={<Download size={16} />}
              isLoading={busy === entry}
              isDisabled={busy !== null || !selectedRunId}
              onPress={() => void runReport('download', entry)}
            >
              {messages.download} {entry.toUpperCase()}
            </Button>
          ))}
        </div>
      </section>
      {preview && (
        <section className="mt-6 rounded-medium border p-5">
          <h2 className="font-semibold">
            {messages.preview}: {preview.filename}
          </h2>
          {preview.format === 'json' && (
            <pre className="mt-3 max-h-[36rem] overflow-auto bg-default-100 p-3 text-xs">{preview.text}</pre>
          )}
          {preview.format === 'html' && (
            <iframe
              title={messages.preview}
              srcDoc={preview.text}
              sandbox=""
              className="mt-3 h-[36rem] w-full border"
            />
          )}
          {(preview.format === 'pdf' || preview.format === 'docx') && (
            <p className="mt-3 text-sm text-default-500">{messages.previewUnavailable}</p>
          )}
        </section>
      )}
    </main>
  );
}
