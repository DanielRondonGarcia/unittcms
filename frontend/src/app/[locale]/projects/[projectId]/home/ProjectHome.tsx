'use client';
import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Card, CardBody, Chip, Divider } from '@heroui/react';
import { Folder, Clipboard, FlaskConical } from 'lucide-react';
import { useTheme } from 'next-themes';
import { aggregateBasicInfo, aggregateTestPriority, aggregateTestType, aggregateProgress } from './aggregate';
import { HomeMessages } from './page';
import TestTypesChart from './TestTypesDonutChart';
import TestPriorityChart from './TestPriorityDonutChart';
import TestProgressBarChart from './TestProgressColumnChart';
import Config from '@/config/config';
import { TokenContext } from '@/utils/TokenProvider';
import { ProgressSeriesType } from '@/types/run';
import { title, subtitle } from '@/components/primitives';
import { TestRunCaseStatusMessages } from '@/types/status';
import { TestTypeMessages } from '@/types/testType';
import { PriorityMessages } from '@/types/priority';
import { ProjectType } from '@/types/project';
import { CasePriorityCountType, CaseTypeCountType } from '@/types/chart';
import { logError } from '@/utils/errorHandler';
import { EmptyState, LoadingState, RequestErrorState } from '@/components/RequestState';
import { isRecord, requestJson, toApiError, type ApiError, type ApiResult } from '@/utils/apiResult';

const apiServer = Config.apiServer;

function isProjectPayload(value: unknown): value is ProjectType {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.Folders) ||
    !Array.isArray(value.Runs)
  ) {
    return false;
  }

  return (
    value.Folders.every((folder) => isRecord(folder) && Array.isArray(folder.Cases)) &&
    value.Runs.every((run) => isRecord(run) && (!run.RunCases || Array.isArray(run.RunCases)))
  );
}

async function fetchProject(jwt: string, projectId: number): Promise<ApiResult<ProjectType>> {
  const url = `${apiServer}/home/${projectId}`;

  return requestJson<ProjectType>(
    url,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    },
    isProjectPayload
  );
}

type Props = {
  projectId: string;
  messages: HomeMessages;
  testRunCaseStatusMessages: TestRunCaseStatusMessages;
  testTypeMessages: TestTypeMessages;
  priorityMessages: PriorityMessages;
};

export function ProjectHome({
  projectId,
  messages,
  testRunCaseStatusMessages,
  testTypeMessages,
  priorityMessages,
}: Props) {
  const context = useContext(TokenContext);
  const { theme } = useTheme();
  const [isFetching, setIsFetching] = useState(true);
  const [project, setProject] = useState<ProjectType | null>(null);
  const [fetchError, setFetchError] = useState<ApiError | null>(null);
  const [folderNum, setFolderNum] = useState(0);
  const [caseNum, setCaseNum] = useState(0);
  const [runNum, setRunNum] = useState(0);
  const [typesCounts, setTypesCounts] = useState<CaseTypeCountType[]>([]);
  const [priorityCounts, setPriorityCounts] = useState<CasePriorityCountType[]>([]);
  const [progressCategories, setProgressCategories] = useState<string[]>([]);
  const [progressSeries, setProgressSeries] = useState<ProgressSeriesType[]>([]);
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const isCurrentRequest = () => requestIdRef.current === requestId;

    setIsFetching(true);
    setFetchError(null);
    setProject(null);
    setFolderNum(0);
    setCaseNum(0);
    setRunNum(0);
    setTypesCounts([]);
    setPriorityCounts([]);
    setProgressCategories([]);
    setProgressSeries([]);

    if (!context.isSignedIn()) {
      setIsFetching(false);
      return;
    }

    try {
      const result = await fetchProject(context.token.access_token, Number(projectId));
      if (!isCurrentRequest()) {
        return;
      }

      if (result.ok) {
        setProject(result.data);
      } else {
        setFetchError(result.error);
      }
    } catch (error: unknown) {
      if (!isCurrentRequest()) {
        return;
      }

      logError('Error in effect:', error);
      setFetchError(toApiError(error));
    } finally {
      if (isCurrentRequest()) {
        setIsFetching(false);
      }
    }
  }, [context, projectId]);

  useEffect(() => {
    void fetchData();

    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchData]);

  useEffect(() => {
    async function aggregate() {
      if (!project) {
        return;
      }
      const { folderNum, runNum, caseNum } = aggregateBasicInfo(project);
      setFolderNum(folderNum);
      setRunNum(runNum);
      setCaseNum(caseNum);

      const typeRet = aggregateTestType(project);
      setTypesCounts([...typeRet]);

      const priorityRet = aggregateTestPriority(project);
      setPriorityCounts([...priorityRet]);

      const { series, categories } = aggregateProgress(project, testRunCaseStatusMessages);
      setProgressSeries([...series]);
      setProgressCategories([...categories]);
    }

    aggregate();
  }, [project, testRunCaseStatusMessages]);

  if (isFetching) {
    return <LoadingState message={messages.loading} />;
  }

  if (fetchError) {
    return <RequestErrorState error={fetchError} messages={messages} onRetry={fetchData} />;
  }

  if (!project) {
    return <EmptyState message={messages.noProject} />;
  }

  return (
    <div className="container mx-auto max-w-5xl pt-6 px-6 flex-grow">
      <h1 className={title({ size: 'sm' })}>{project.name}</h1>
      <div className="mt-4">
        <Chip variant="flat" startContent={<Folder size={16} />} className="px-3">
          {folderNum} {messages.folders}
        </Chip>
        <Chip variant="flat" startContent={<Clipboard size={16} />} className="px-3 ms-2">
          {caseNum} {messages.testCases}
        </Chip>
        <Chip variant="flat" startContent={<FlaskConical size={16} />} className="px-3 ms-2">
          {runNum} {messages.testRuns}
        </Chip>
      </div>

      {project.detail && (
        <Card className="mt-3 bg-neutral-100 dark:bg-neutral-700 dark:text-white" shadow="none">
          <CardBody>{project.detail}</CardBody>
        </Card>
      )}

      <Divider className="my-8" />
      <h2 className={subtitle()}>{messages.progress}</h2>
      <div style={{ height: '18rem' }}>
        <TestProgressBarChart progressSeries={progressSeries} progressCategories={progressCategories} theme={theme} />
      </div>

      <Divider className="my-12" />
      <h2 className={subtitle()}>{messages.testClassification}</h2>
      <div className="flex pb-20">
        <div style={{ width: '32rem', height: '18rem' }}>
          <h3>{messages.byType}</h3>
          <TestTypesChart typesCounts={typesCounts} testTypeMessages={testTypeMessages} theme={theme} />
        </div>
        <div style={{ width: '30rem', height: '18rem' }}>
          <h3>{messages.byPriority}</h3>
          <TestPriorityChart priorityCounts={priorityCounts} priorityMessages={priorityMessages} theme={theme} />
        </div>
      </div>
    </div>
  );
}
