import { describe, expect, test, assert } from 'vitest';
import {
  changeStatus,
  getPersistedRunCase,
  hasUnsavedRunCaseChanges,
  includeExcludeTestCases,
  isRunCaseIncluded,
  mergeRunCaseChanges,
} from './runsControl';
import { CaseType } from '@/types/case';

const sampleTestCase: CaseType = {
  id: 1,
  title: '',
  state: 0,
  priority: 0,
  type: 0,
  automationStatus: 0,
  description: '',
  template: 0,
  preConditions: '',
  expectedResults: '',
  folderId: 1,
};

const initialTestCases: CaseType[] = [
  {
    ...sampleTestCase,
    id: 1,
    RunCases: [
      {
        id: 1,
        runId: 1,
        caseId: 1,
        status: 0,
        editState: 'notChanged',
      },
    ],
  },
  {
    ...sampleTestCase,
    id: 2,
    RunCases: [
      {
        id: 2,
        runId: 1,
        caseId: 2,
        status: 0,
        editState: 'notChanged',
      },
    ],
  },
  {
    ...sampleTestCase,
    id: 3,
    RunCases: [
      {
        id: 3,
        runId: 1,
        caseId: 3,
        status: 0,
        editState: 'new',
      },
    ],
  },
  {
    ...sampleTestCase,
    id: 4,
    RunCases: [
      {
        id: 4,
        runId: 1,
        caseId: 4,
        status: 0,
        editState: 'deleted',
      },
    ],
  },
];

describe('runsControl', () => {
  test('update test case which has not changed yet', () => {
    const changeCaseId = 1;
    const newStatus = 1;
    const currentRunCases = [...initialTestCases];
    const newTestCases = changeStatus(changeCaseId, newStatus, currentRunCases);

    if (newTestCases[0] && newTestCases[0].RunCases && newTestCases[0].RunCases[0]) {
      expect(newTestCases[0].RunCases[0].status).toBe(1);
      expect(newTestCases[0].RunCases[0].editState).toBe('changed');
    } else {
      assert.fail("RunCases isn't exist");
    }
  });

  test('update test case which has already changed', () => {
    const changeCaseId = 1;
    const newStatus = 1;
    const currentRunCases = [...initialTestCases];
    const newTestCases = changeStatus(changeCaseId, newStatus, currentRunCases);

    const overwriteStatus = 2;
    const overwrittenCases = changeStatus(changeCaseId, overwriteStatus, newTestCases);

    if (overwrittenCases[0] && overwrittenCases[0].RunCases && overwrittenCases[0].RunCases[0]) {
      expect(overwrittenCases[0].RunCases[0].status).toBe(2);
      expect(overwrittenCases[0].RunCases[0].editState).toBe('changed');
    } else {
      assert.fail("RunCases isn't exist");
    }
  });

  test('when update test case whose editState is "new", the editState remains "new"', () => {
    const changeCaseId = 3;
    const newStatus = 1;
    const currentRunCases = [...initialTestCases];
    const newTestCases = changeStatus(changeCaseId, newStatus, currentRunCases);

    if (newTestCases[2] && newTestCases[2].RunCases && newTestCases[2].RunCases[0]) {
      expect(newTestCases[2].RunCases[0].status).toBe(1);
      expect(newTestCases[2].RunCases[0].editState).toBe('new');
    } else {
      assert.fail("RunCases isn't exist");
    }
  });

  test('when update test case whose editState is "deleted", the editState remains "deleted" and status not changed', () => {
    const changeCaseId = 4;
    const newStatus = 1;
    const currentRunCases = [...initialTestCases];
    const newTestCases = changeStatus(changeCaseId, newStatus, currentRunCases);

    if (newTestCases[3] && newTestCases[3].RunCases && newTestCases[3].RunCases[0]) {
      expect(newTestCases[3].RunCases[0].status).toBe(0);
      expect(newTestCases[3].RunCases[0].editState).toBe('deleted');
    } else {
      assert.fail("RunCases isn't exist");
    }
  });

  test("included test case's editState is 'new'", () => {
    const isInclude = true;
    const keys: number[] = [3];
    const runId = 1;
    const currentRunCases = [...initialTestCases];
    const newTestCases = includeExcludeTestCases(isInclude, keys, runId, currentRunCases);

    if (newTestCases[2] && newTestCases[2].RunCases && newTestCases[2].RunCases[0]) {
      expect(newTestCases[2].RunCases[0].editState).toBe('new');
    } else {
      assert.fail("RunCases isn't exist");
    }
  });

  test('when include test case, whose editState is "new"', () => {
    const isInclude = true;
    const keys: number[] = [3];
    const runId = 1;
    const currentRunCases = [...initialTestCases];
    const newTestCases = includeExcludeTestCases(isInclude, keys, runId, currentRunCases);

    if (newTestCases[2] && newTestCases[2].RunCases && newTestCases[2].RunCases[0]) {
      expect(newTestCases[2].RunCases[0].editState).toBe('new');
    } else {
      assert.fail("RunCases isn't exist");
    }
  });

  test("excluded test cases's editState are 'deleted'", () => {
    const isInclude = false;
    const keys: number[] = [1, 3];
    const runId = 1;
    const currentRunCases = [...initialTestCases];
    const newTestCases = includeExcludeTestCases(isInclude, keys, runId, currentRunCases);

    if (newTestCases[0] && newTestCases[0].RunCases && newTestCases[0].RunCases[0]) {
      expect(newTestCases[0].RunCases[0].editState).toBe('deleted');
    } else {
      assert.fail("RunCases isn't exist");
    }

    if (newTestCases[2] && newTestCases[2].RunCases && newTestCases[2].RunCases[0]) {
      expect(newTestCases[2].RunCases[0].editState).toBe('deleted');
    } else {
      assert.fail("RunCases isn't exist");
    }
  });

  test('distinguishes included RunCases from deleted or unsaved memberships', () => {
    const included = {
      ...initialTestCases[0],
      RunCases: [{ ...initialTestCases[0].RunCases![0], editState: 'notChanged' as const }],
    };
    expect(isRunCaseIncluded(included)).toBe(true);
    expect(isRunCaseIncluded(initialTestCases[3])).toBe(false);
    expect(getPersistedRunCase(included)?.id).toBe(1);
    expect(getPersistedRunCase(initialTestCases[2])).toBeUndefined();
    expect(hasUnsavedRunCaseChanges([initialTestCases[0]])).toBe(false);
    expect(hasUnsavedRunCaseChanges([initialTestCases[2]])).toBe(true);
  });

  test('merges filtered changes into the global list without losing pending states or order', () => {
    const currentCases = [
      {
        ...initialTestCases[0],
        RunCases: [{ ...initialTestCases[0].RunCases![0], editState: 'changed' as const }],
      },
      {
        ...initialTestCases[1],
        RunCases: [{ ...initialTestCases[1].RunCases![0], editState: 'changed' as const }],
      },
    ];
    const filteredChanges = [
      {
        ...currentCases[0],
        RunCases: [{ ...currentCases[0].RunCases![0], editState: 'deleted' as const }],
      },
    ];

    const mergedCases = mergeRunCaseChanges(currentCases, filteredChanges);

    expect(mergedCases.map((testCase) => testCase.id)).toEqual([1, 2]);
    expect(mergedCases[0].RunCases?.[0].editState).toBe('deleted');
    expect(mergedCases[1].RunCases?.[0].editState).toBe('changed');
    expect(currentCases[0].RunCases?.[0].editState).toBe('changed');
  });
});
