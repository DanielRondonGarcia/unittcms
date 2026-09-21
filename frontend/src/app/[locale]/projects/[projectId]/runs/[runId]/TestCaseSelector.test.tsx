/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TestCaseSelector from './TestCaseSelector';

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Table: ({ children, onSortChange }: { children?: React.ReactNode; onSortChange?: (value: unknown) => void }) => (
      <>
        <button onClick={() => onSortChange?.({ column: 'title', direction: 'ascending' })}>Sort title</button>
        <table>{children}</table>
      </>
    ),
    TableHeader: ({
      children,
      columns,
    }: {
      children: (column: { uid: string; name: string }) => React.ReactNode;
      columns: Array<{ uid: string; name: string }>;
    }) => (
      <thead>
        <tr>{columns.map((column) => children(column))}</tr>
      </thead>
    ),
    TableColumn: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
    TableBody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
    TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
    TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
    Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
    DropdownTrigger: passthrough,
    Dropdown: passthrough,
    DropdownMenu: passthrough,
    DropdownItem: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
    Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

vi.mock('../runsControl', () => ({
  isRunCaseIncluded: (testCase: { RunCases?: Array<{ id: number }> }) => Boolean(testCase.RunCases?.[0]),
}));
vi.mock('./RunCaseStatus', () => ({
  default: ({ uid }: { uid: string }) => <span data-testid="run-status">{uid}</span>,
}));
vi.mock('./AssigneePicker', () => ({
  default: ({ assigneeUserId }: { assigneeUserId: number | null }) => (
    <span data-testid="assignee">{assigneeUserId ?? 'unassigned'}</span>
  ),
}));
vi.mock('@/components/TestCasePriority', () => ({ default: () => <span data-testid="priority" /> }));
vi.mock('@/src/i18n/routing', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
  NextUiLinkClasses: '',
}));
vi.mock('@/config/selection', () => ({ testRunCaseStatus: [{ uid: 'ready' }] }));

const messages = {
  id: 'ID',
  title: 'Title',
  runCaseStatus: 'Run case status',
  priority: 'Priority',
  tags: 'Tags',
  status: 'Status',
  assignee: 'Assignee',
  comments: 'Comments',
  actions: 'Actions',
  included: 'Included',
  excluded: 'Excluded',
  testCaseActions: 'Test case actions',
  includeExcludeActions: 'Include or exclude',
  includeInRun: 'Include',
  excludeFromRun: 'Exclude',
  unassigned: 'Unassigned',
  selectAssigneeAria: 'Select assignee',
  searchAssignee: 'Search assignee',
};

function testCase(id: number, folderId: number, position: number, title: string, assigneeUserId: number) {
  return {
    id,
    folderId,
    position,
    title,
    state: 0,
    priority: 1,
    type: 0,
    automationStatus: 0,
    description: '',
    template: 0,
    preConditions: '',
    expectedResults: '',
    RunCases: [{ id: id + 100, runId: 7, caseId: id, status: 0, editState: 'notChanged' as const, assigneeUserId }],
  };
}

describe('TestCaseSelector ordering', () => {
  let root: ReturnType<typeof createRoot> | undefined;

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = '';
  });

  it('inherits folder, position, then id order while preserving run status and assignee cells', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TestCaseSelector
          projectId="10"
          runId="7"
          locale="en"
          cases={[
            testCase(10, 2, 1, 'Other folder', 30),
            testCase(3, 1, 2, 'Second', 20),
            testCase(2, 1, 1, 'First', 10),
          ]}
          isDisabled={false}
          isManager={true}
          members={[]}
          selectedKeys={new Set()}
          onSelectionChange={vi.fn()}
          onChangeStatus={vi.fn()}
          onIncludeCase={vi.fn()}
          onExcludeCase={vi.fn()}
          onAssignCase={vi.fn()}
          messages={messages as never}
          testRunCaseStatusMessages={{ ready: 'Ready' } as never}
          priorityMessages={{} as never}
          testTypeMessages={{} as never}
        />
      );
    });

    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(['2', '3', '10']);
    expect(container.querySelectorAll('[data-testid="run-status"]').length).toBe(3);
    expect(Array.from(container.querySelectorAll('[data-testid="assignee"]')).map((node) => node.textContent)).toEqual([
      '10',
      '20',
      '30',
    ]);
  });

  it('keeps alternate title sorting available', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TestCaseSelector
          projectId="10"
          runId="7"
          locale="en"
          cases={[testCase(1, 1, 1, 'Zulu', 1), testCase(2, 1, 2, 'Alpha', 2)]}
          isDisabled={false}
          isManager={false}
          members={[]}
          selectedKeys={new Set()}
          onSelectionChange={vi.fn()}
          onChangeStatus={vi.fn()}
          onIncludeCase={vi.fn()}
          onExcludeCase={vi.fn()}
          onAssignCase={vi.fn()}
          messages={messages as never}
          testRunCaseStatusMessages={{ ready: 'Ready' } as never}
          priorityMessages={{} as never}
          testTypeMessages={{} as never}
        />
      );
    });

    act(() => container.querySelector('button')?.click());
    expect(
      Array.from(container.querySelectorAll('tbody tr')).map((row) => row.querySelector('td')?.textContent)
    ).toEqual(['2', '1']);
  });
});
