import { getFilenameFromContentDisposition } from '@/utils/request';
import { logError } from '@/utils/errorHandler';
import { CaseType } from '@/types/case';
import { RunType, RunCaseType } from '@/types/run';
import Config from '@/config/config';
import { testRunCaseStatus } from '@/config/selection';
const apiServer = Config.apiServer;

async function fetchRun(jwt: string, runId: number) {
  const url = `${apiServer}/runs/${runId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

async function fetchRuns(jwt: string, projectId: number) {
  const url = `${apiServer}/runs?projectId=${projectId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

async function createRun(jwt: string, projectId: number, name: string, description: string) {
  const newTestRun = {
    name,
    configurations: 0,
    description,
    state: 0,
  };

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(newTestRun),
  };

  const url = `${apiServer}/runs?projectId=${projectId}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error creating new test run:', error);
    throw error;
  }
}

async function updateRun(jwt: string, updateTestRun: RunType) {
  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(updateTestRun),
  };

  const url = `${apiServer}/runs/${updateTestRun.id}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error updating run:', error);
    throw error;
  }
}

async function deleteRun(jwt: string, runId: number) {
  const fetchOptions = {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  };

  const url = `${apiServer}/runs/${runId}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
  } catch (error: unknown) {
    logError('Error deleting run:', error);
    throw error;
  }
}

async function exportRun(jwt: string, runId: number, type: string) {
  if (type !== 'xml' && type !== 'json' && type !== 'csv') {
    console.error('export type error. type:', type);
    return;
  }
  const url = `${apiServer}/runs/download/${runId}?type=${type}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const disposition = response.headers.get('content-disposition');
    const filename = getFilenameFromContentDisposition(disposition) ?? `cases.${type}`;

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

async function fetchRunCases(jwt: string, runId: number) {
  const url = `${apiServer}/runcases?runId=${runId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

function changeStatus(changeCaseId: number, newStatus: number, currentTestCases: CaseType[]): CaseType[] {
  return currentTestCases.map((testCase) => {
    const runCases = testCase.RunCases;
    const runCase = runCases?.[0];
    if (
      testCase.id !== changeCaseId ||
      !runCases ||
      !runCase ||
      testRunCaseStatus.length === 0 ||
      runCase.editState === 'deleted'
    ) {
      return testCase;
    }

    return {
      ...testCase,
      RunCases: [
        {
          ...runCase,
          status: newStatus,
          editState: runCase.editState === 'notChanged' ? 'changed' : runCase.editState,
        },
        ...runCases.slice(1),
      ],
    };
  });
}

function includeExcludeTestCases(
  isInclude: boolean,
  keys: number[],
  runId: number,
  currentTestCases: CaseType[]
): CaseType[] {
  const keySet = new Set(keys);

  return currentTestCases.map((testCase) => {
    if (!keySet.has(testCase.id)) return testCase;

    const runCases = testCase.RunCases;
    const runCase = runCases?.[0];
    if (isInclude) {
      if (!runCases || !runCase) {
        return {
          ...testCase,
          RunCases: [
            {
              id: -1,
              runId,
              status: 0,
              editState: 'new',
              assigneeUserId: null,
            } as RunCaseType,
          ],
        };
      }
      if (runCase.editState !== 'deleted') return testCase;

      return {
        ...testCase,
        RunCases: [{ ...runCase, editState: runCase.id > 0 ? 'changed' : 'new' }, ...runCases.slice(1)],
      };
    }

    if (!runCase || runCase.editState === 'deleted' || !runCases) return testCase;
    return {
      ...testCase,
      RunCases: [{ ...runCase, editState: 'deleted' }, ...runCases.slice(1)],
    };
  });
}

function isRunCaseIncluded(testCase: CaseType): boolean {
  return Boolean(testCase.RunCases?.[0] && testCase.RunCases[0].editState !== 'deleted');
}

function getPersistedRunCase(testCase: CaseType) {
  const runCase = testCase.RunCases?.[0];
  return runCase && runCase.id > 0 && runCase.editState !== 'new' && runCase.editState !== 'deleted'
    ? runCase
    : undefined;
}

function mergeRunCaseChanges(currentCases: CaseType[], changedCases: CaseType[]): CaseType[] {
  const changedById = new Map(changedCases.map((testCase) => [testCase.id, testCase]));
  const mergedCases = currentCases.map((testCase) => changedById.get(testCase.id) ?? testCase);
  const currentIds = new Set(currentCases.map((testCase) => testCase.id));
  return [...mergedCases, ...changedCases.filter((testCase) => !currentIds.has(testCase.id))];
}

function hasUnsavedRunCaseChanges(testCases: CaseType[]): boolean {
  return testCases.some((testCase) => {
    const runCase = testCase.RunCases?.[0];
    return Boolean(runCase && runCase.editState !== 'notChanged');
  });
}

async function updateRunCases(jwt: string, runId: number, testCases: CaseType[]) {
  const runCases: RunCaseType[] = [];
  testCases.forEach((itr) => {
    if (itr.RunCases && itr.RunCases.length > 0) {
      runCases.push({
        id: itr.RunCases[0].id,
        caseId: itr.id,
        runId: runId,
        status: itr.RunCases[0].status,
        editState: itr.RunCases[0].editState,
        assigneeUserId: itr.RunCases[0].assigneeUserId ?? null,
        createdAt: '0',
        updatedAt: '0',
      });
    }
  });

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(runCases),
  };

  const url = `${apiServer}/runcases/update?runId=${runId}`;
  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error: unknown) {
    logError('Error updating run cases:', error);
    throw error;
  }
}

async function fetchProjectCases(
  jwt: string,
  projectId: number,
  runId: number,
  search?: string,
  status?: string[],
  tag?: string[],
  assigneeUserId?: string
) {
  const queryParams = [`projectId=${projectId}&runId=${runId}`];

  if (search) {
    queryParams.push(`search=${search}`);
  }

  if (status && status.length > 0) {
    queryParams.push(`status=${status.join(',')}`);
  }

  if (tag && tag.length > 0) {
    queryParams.push(`tag=${tag.join(',')}`);
  }

  if (assigneeUserId !== undefined && assigneeUserId !== '') {
    queryParams.push(`assigneeUserId=${assigneeUserId}`);
  }

  const query = `?${queryParams.join('&')}`;

  const url = `${apiServer}/cases/byproject${query}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

async function assignRunCases(jwt: string, runId: number, runCaseIds: number[], assigneeUserId: number | null) {
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ runCaseIds, assigneeUserId }),
  };

  const url = `${apiServer}/runcases/assignee?runId=${runId}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error: unknown) {
    logError('Error assigning run cases:', error);
    throw error;
  }
}

async function fetchProjectMembersForRun(jwt: string, projectId: string) {
  const url = `${apiServer}/members?projectId=${projectId}&includeOwner=true`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error: unknown) {
    logError('Error fetching project members:', error);
    return [];
  }
}

export {
  fetchRun,
  fetchRuns,
  createRun,
  updateRun,
  deleteRun,
  exportRun,
  fetchRunCases,
  changeStatus,
  includeExcludeTestCases,
  isRunCaseIncluded,
  getPersistedRunCase,
  mergeRunCaseChanges,
  hasUnsavedRunCaseChanges,
  updateRunCases,
  fetchProjectCases,
  assignRunCases,
  fetchProjectMembersForRun,
};
