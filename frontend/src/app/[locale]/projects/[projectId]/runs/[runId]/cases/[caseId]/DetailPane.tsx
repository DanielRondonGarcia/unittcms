'use client';
import { useEffect, useState, useContext } from 'react';
import { useSearchParams } from 'next/navigation';
import { Tabs, Tab } from '@heroui/react';
import CaseDetail from './CaseDetail';
import AutomationExecutionPanel from './AutomationExecutionPanel';
import AutomationHistory from './AutomationHistory';
import Comments from '@/components/Comments';
import { TokenContext } from '@/utils/TokenProvider';
import { fetchCase } from '@/utils/caseControl';
import { logError } from '@/utils/errorHandler';
import type { CaseType, StepType } from '@/types/case';
import type { RunCaseType, RunDetailMessages } from '@/types/run';
import type { PriorityMessages } from '@/types/priority';
import type { TestTypeMessages } from '@/types/testType';
import type { CommentMessages } from '@/types/comment';
import { gherkinTemplate } from '@/config/selection';

type Props = {
  projectId: string;
  runId: string;
  locale: string;
  caseId: string;
  messages: RunDetailMessages;
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
  testTypeMessages,
  priorityMessages,
  commentMessages,
}: Props) {
  const context = useContext(TokenContext);
  const searchParams = useSearchParams();
  const [selectedTab, setSelectedTab] = useState('caseDetail');
  const [isFetching, setIsFetching] = useState(false);
  const [testCase, setTestCase] = useState<CaseType | null>(null);
  const [runCaseId, setRunCaseId] = useState<number | undefined>(undefined);

  useEffect(() => {
    // if the url has ?tab=comments, then select the comments tab
    const tab = searchParams.get('tab');
    if (tab === 'comments') {
      setSelectedTab('comments');
    } else if (tab === 'history') {
      setSelectedTab('history');
    } else {
      setSelectedTab('caseDetail');
    }
  }, [searchParams]);

  useEffect(() => {
    async function fetchDataEffect() {
      if (!context.isSignedIn()) return;
      if (!caseId || Number(caseId) <= 0) return;

      setIsFetching(true);
      try {
        const data = await fetchCase(context.token.access_token, Number(caseId));
        if (data.Steps && data.Steps.length > 0) {
          data.Steps = [...data.Steps].sort((a: StepType, b: StepType) => a.caseSteps.stepNo - b.caseSteps.stepNo);
        }
        setTestCase(data);

        // Find the runCase for this case in this run
        if (data.RunCases && data.RunCases.length > 0) {
          const runCase = data.RunCases.find(
            (rc: RunCaseType) =>
              Number(rc.runId) === Number(runId) &&
              Number(rc.caseId) === Number(caseId) &&
              Number.isInteger(Number(rc.id)) &&
              Number(rc.id) > 0
          );
          setRunCaseId(runCase ? Number(runCase.id) : undefined);
        } else {
          setRunCaseId(undefined);
        }
      } catch (error: unknown) {
        logError('Error fetching case data', error);
      } finally {
        setIsFetching(false);
      }
    }

    fetchDataEffect();
  }, [context, caseId, runId]);

  if (isFetching || !testCase) {
    return <div>{messages.loading}</div>;
  } else {
    return (
      <div className="flex h-full min-w-0 w-full flex-col p-3">
        <Tabs
          aria-label={messages.options}
          size="sm"
          className="min-w-0 max-w-full"
          selectedKey={selectedTab}
          onSelectionChange={(key) => setSelectedTab(String(key))}
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
            {testCase.template === gherkinTemplate && runCaseId !== undefined && (
              <AutomationExecutionPanel
                projectId={projectId}
                runId={runId}
                caseId={caseId}
                runCaseId={runCaseId}
                locale={locale}
                messages={messages}
              />
            )}
          </Tab>
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
              locale={locale}
              messages={messages}
            />
          </Tab>
        </Tabs>
      </div>
    );
  }
}
