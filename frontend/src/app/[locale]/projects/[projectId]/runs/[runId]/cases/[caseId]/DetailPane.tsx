'use client';
import { useCallback, useEffect, useState, useContext } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, Tab } from '@heroui/react';
import CaseDetail from './CaseDetail';
import AutomationExecutionPanel from './AutomationExecutionPanel';
import AutomationHistory from './AutomationHistory';
import ManualExecutionPanel from './ManualExecutionPanel';
import Comments from '@/components/Comments';
import { TokenContext } from '@/utils/TokenProvider';
import { fetchCase } from '@/utils/caseControl';
import { logError } from '@/utils/errorHandler';
import { toApiError, type ApiError } from '@/utils/apiResult';
import { EmptyState, LoadingState, RequestErrorState } from '@/components/RequestState';
import type { CaseType, StepType } from '@/types/case';
import type { RunDetailMessages } from '@/types/run';
import type { PriorityMessages } from '@/types/priority';
import type { TestTypeMessages } from '@/types/testType';
import type { CommentMessages } from '@/types/comment';
import type { ManualExecutionMessages } from '@/types/manualExecution';
import { gherkinTemplate } from '@/config/selection';

function isPositiveIdentifier(value: string): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

type Props = {
  projectId: string;
  runId: string;
  locale: string;
  caseId: string;
  messages: RunDetailMessages;
  manualExecutionMessages: ManualExecutionMessages;
  manualExecutionEnabled?: boolean;
  testTypeMessages: TestTypeMessages;
  priorityMessages: PriorityMessages;
  commentMessages: CommentMessages;
};

export default function TestCaseDetailPane({
  projectId,
  runId,
  locale,
  caseId,
  messages,
  manualExecutionMessages,
  manualExecutionEnabled = true,
  testTypeMessages,
  priorityMessages,
  commentMessages,
}: Props) {
  const context = useContext(TokenContext);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedTab, setSelectedTab] = useState('caseDetail');
  const [isFetching, setIsFetching] = useState(true);
  const [testCase, setTestCase] = useState<CaseType | null>(null);
  const [runCaseId, setRunCaseId] = useState<number | undefined>(undefined);
  const [fetchError, setFetchError] = useState<ApiError | null>(null);

  const handleTabChange = useCallback(
    (key: string) => {
      setSelectedTab(key);
      const currentParams = new URLSearchParams(searchParams.toString());
      currentParams.set('tab', key);
      const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
      router.push(newUrl, { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    // if the url has ?tab=comments, then select the comments tab
    const tab = searchParams.get('tab');
    if (tab === 'comments') {
      setSelectedTab('comments');
    } else if (tab === 'history') {
      setSelectedTab('history');
    } else if (
      (tab === 'manual' || tab === 'manualExecution' || tab === 'manual-execution') &&
      manualExecutionEnabled
    ) {
      setSelectedTab('manualExecution');
    } else if (
      (tab === 'automation' || tab === 'automated') &&
      testCase?.template === gherkinTemplate &&
      runCaseId !== undefined
    ) {
      setSelectedTab('automation');
    } else {
      setSelectedTab('caseDetail');
    }
  }, [manualExecutionEnabled, runCaseId, searchParams, testCase?.template]);

  const fetchData = useCallback(async () => {
    if (!context.isSignedIn()) {
      setIsFetching(false);
      return;
    }

    if (!isPositiveIdentifier(projectId) || !isPositiveIdentifier(runId) || !isPositiveIdentifier(caseId)) {
      setTestCase(null);
      setRunCaseId(undefined);
      setFetchError({ status: 400, code: 'invalid_route', message: messages.noCaseSelected });
      setIsFetching(false);
      return;
    }

    setIsFetching(true);
    setFetchError(null);
    try {
      const result = await fetchCase(context.token.access_token, Number(caseId));
      if (!result.ok) {
        setTestCase(null);
        setRunCaseId(undefined);
        setFetchError(result.error);
        return;
      }

      const data = result.data;
      const steps = (data.Steps ?? [])
        .slice()
        .sort((a: StepType, b: StepType) => a.caseSteps.stepNo - b.caseSteps.stepNo);
      const nextCase = { ...data, Steps: steps };
      setTestCase(nextCase);

      // Find the runCase for this case in this run
      const runCase = (data.RunCases ?? []).find(
        (rc) =>
          Number(rc.runId) === Number(runId) &&
          Number(rc.caseId) === Number(caseId) &&
          Number.isInteger(Number(rc.id)) &&
          Number(rc.id) > 0
      );
      setRunCaseId(runCase ? Number(runCase.id) : undefined);
    } catch (error: unknown) {
      logError('Error fetching case data', error);
      setTestCase(null);
      setRunCaseId(undefined);
      setFetchError(toApiError(error));
    } finally {
      setIsFetching(false);
    }
  }, [caseId, context, messages, projectId, runId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (isFetching) {
    return <LoadingState message={messages.loading} />;
  }

  if (fetchError) {
    return (
      <RequestErrorState
        error={fetchError}
        messages={messages}
        onRetry={fetchError.code === 'invalid_route' ? undefined : fetchData}
      />
    );
  }

  if (!testCase) {
    return <EmptyState message={messages.noCaseSelected} />;
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden p-3"
      data-testid="run-case-detail-pane"
    >
      <Tabs
        aria-label={messages.options}
        size="sm"
        classNames={{
          base: 'shrink-0 min-w-0 w-full max-w-full',
          tabList: 'run-case-tab-list w-full min-w-0 max-w-full overflow-x-auto',
          tab: 'shrink-0 w-auto min-w-max whitespace-nowrap',
          panel: 'min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto p-0',
        }}
        selectedKey={selectedTab}
        onSelectionChange={(key) => handleTabChange(String(key))}
      >
        <Tab key="caseDetail" title={messages.caseDetail}>
          <CaseDetail
            projectId={projectId}
            testCase={testCase}
            locale={locale}
            messages={messages}
            testTypeMessages={testTypeMessages}
            priorityMessages={priorityMessages}
          />
        </Tab>
        {manualExecutionEnabled && runCaseId !== undefined && (
          <Tab key="manualExecution" title={manualExecutionMessages.manualExecution}>
            <ManualExecutionPanel
              projectId={projectId}
              runCaseId={runCaseId}
              locale={locale}
              messages={manualExecutionMessages}
            />
          </Tab>
        )}
        {testCase.template === gherkinTemplate && runCaseId !== undefined && (
          <Tab key="automation" title={messages.automation}>
            <AutomationExecutionPanel
              projectId={projectId}
              runId={runId}
              caseId={caseId}
              runCaseId={runCaseId}
              examples={testCase.gherkinExamples}
              locale={locale}
              messages={messages}
            />
          </Tab>
        )}
        <Tab key="comments" title={messages.comments}>
          <Comments
            projectId={projectId}
            commentableType="RunCase"
            commentableId={runCaseId}
            messages={commentMessages}
          />
        </Tab>
        <Tab key="history" title={messages.history}>
          <AutomationHistory
            projectId={projectId}
            runId={runId}
            caseId={caseId}
            runCaseId={runCaseId}
            examples={testCase.gherkinExamples}
            locale={locale}
            messages={messages}
            manualExecutionMessages={manualExecutionEnabled ? manualExecutionMessages : undefined}
          />
        </Tab>
      </Tabs>
    </div>
  );
}
