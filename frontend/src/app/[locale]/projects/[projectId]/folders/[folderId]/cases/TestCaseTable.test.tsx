/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TestCaseTable from './TestCaseTable';

const mocks = vi.hoisted(() => ({
  onMoveEvent: vi.fn(() => vi.fn()),
  reorderCases: vi.fn(),
}));

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

  return {
    Button: ({
      children,
      onPress,
      isDisabled,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      isDisabled?: boolean;
    }) => (
      <button disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    ),
    Dropdown: passthrough,
    DropdownTrigger: passthrough,
    DropdownMenu: passthrough,
    DropdownItem: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => (
      <button onClick={onPress}>{children}</button>
    ),
    Checkbox: ({ isSelected, onChange }: { isSelected?: boolean; onChange?: () => void }) => (
      <input type="checkbox" checked={isSelected} onChange={onChange} />
    ),
    Badge: passthrough,
    Popover: passthrough,
    PopoverContent: passthrough,
    PopoverTrigger: passthrough,
    Card: passthrough,
    CardBody: passthrough,
    Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

vi.mock('@heroui/theme', () => ({
  table: () => ({
    table: () => '',
    thead: () => '',
    tbody: () => '',
    tr: () => '',
    th: () => '',
    td: () => '',
  }),
}));

vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    Plus: Icon,
    MoreVertical: Icon,
    Trash: Icon,
    FileUp: Icon,
    FileDown: Icon,
    ChevronUp: Icon,
    ChevronDown: Icon,
    Filter: Icon,
    FileJson: Icon,
    FileSpreadsheet: Icon,
  };
});

vi.mock('./TestCaseFilter', () => ({ default: () => null }));
vi.mock('@/components/TestCasePriority', () => ({ default: () => null }));
vi.mock('@/src/i18n/routing', () => ({
  Link: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
  NextUiLinkClasses: '',
}));
vi.mock('@/utils/testCaseMoveEvent', () => ({ onMoveEvent: mocks.onMoveEvent }));

const messages = {
  testCaseList: 'Test cases',
  id: 'ID',
  title: 'Title',
  priority: 'Priority',
  actions: 'Actions',
  deleteCase: 'Delete case',
  delete: 'Delete',
  close: 'Close',
  areYouSure: 'Are you sure?',
  newTestCase: 'New test case',
  export: 'Export',
  status: 'Status',
  noCasesFound: 'No cases found',
  caseTitle: 'Case title',
  caseDescription: 'Case description',
  caseTitleOrDescription: 'Search',
  create: 'Create',
  pleaseEnter: 'Please enter',
  filter: 'Filter',
  clearAll: 'Clear all',
  apply: 'Apply',
  selectPriorities: 'Select priorities',
  selected: 'Selected',
  type: 'Type',
  selectTypes: 'Select types',
  casesSelected: 'cases selected',
  selectAction: 'Select action',
  move: 'Move',
  clone: 'Clone',
  casesMoved: 'Cases moved',
  casesCloned: 'Cases cloned',
  tags: 'Tags',
  selectTags: 'Select tags',
  import: 'Import',
  importCases: 'Import cases',
  importAvailable: 'Import available',
  downloadTemplate: 'Download template',
  clickToUpload: 'Click to upload',
  orDragAndDrop: 'or drag and drop',
  maxFileSize: 'Max file size',
  casesImported: 'Cases imported',
  createMore: 'Create more',
  successTitle: 'Success',
  errorTitle: 'Error',
  errorFetchingTags: 'Error fetching tags',
  priorityFilter: 'Priority filter',
  typeFilter: 'Type filter',
  tagFilter: 'Tag filter',
  testCaseActions: 'Test case actions',
  exportOptions: 'Export options',
  noTestCase: 'No test case',
  template: 'Template',
  text: 'Text',
  step: 'Step',
  gherkin: 'Gherkin',
};

function testCase(id: number, position: number, title = `Case ${id}`) {
  return {
    id,
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
    folderId: 3,
  };
}

function renderTable(
  cases = [testCase(1, 1), testCase(2, 2), testCase(3, 3), testCase(4, 4)],
  activeSearchFilter = ''
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <TestCaseTable
        projectId="10"
        folderId={3}
        isDisabled={false}
        cases={cases}
        onCreateCase={vi.fn()}
        onDeleteCase={vi.fn()}
        onDeleteCases={vi.fn()}
        onReorderCases={mocks.reorderCases}
        onShowImportDialog={vi.fn()}
        onExportCases={vi.fn()}
        onFilterChange={vi.fn()}
        activeSearchFilter={activeSearchFilter}
        activePriorityFilters={[]}
        activeTypeFilters={[]}
        activeTagFilters={[]}
        messages={messages}
        priorityMessages={{} as never}
        testTypeMessages={{} as never}
        locale="en"
      />
    );
  });
  return { container, root };
}

function dataTransfer() {
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
  };
}

function dragRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

function rowIds(container: HTMLElement) {
  return dragRows(container).map((row) => row.children[1]?.textContent?.trim());
}

describe('TestCaseTable ordering', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reorderCases.mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = '';
  });

  it('uses position order and submits the complete multi-selection permutation on drop', async () => {
    const { container, root } = renderTable([testCase(10, 2), testCase(2, 1), testCase(3, 3), testCase(4, 4)]);
    roots.push(root);
    await act(async () => Promise.resolve());

    expect(rowIds(container)).toEqual(['2', '10', '3', '4']);
    const rows = dragRows(container);
    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'));
    await act(async () => {
      checkboxes[0].click();
      checkboxes[1].click();
    });

    const transfer = dataTransfer();
    const start = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.assign(start, { dataTransfer: transfer });
    await act(async () => rows[1].dispatchEvent(start));

    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.assign(over, { dataTransfer: transfer });
    await act(async () => rows[3].dispatchEvent(over));

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: transfer });
    await act(async () => {
      rows[3].dispatchEvent(drop);
      await Promise.resolve();
    });

    expect(mocks.reorderCases).toHaveBeenCalledWith(3, [3, 2, 10, 4]);
  });

  it('refuses dragging in filtered and alternate-column views', async () => {
    const filtered = renderTable(undefined, 'login');
    roots.push(filtered.root);
    await act(async () => Promise.resolve());
    expect(dragRows(filtered.container)[0].getAttribute('draggable')).toBe('false');

    await act(async () => filtered.root.unmount());
    roots.splice(roots.indexOf(filtered.root), 1);
    document.body.innerHTML = '';

    const alternate = renderTable();
    roots.push(alternate.root);
    await act(async () => Promise.resolve());
    const idHeader = Array.from(alternate.container.querySelectorAll('th')).find(
      (header) => header.textContent === 'ID'
    );
    await act(async () => idHeader?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(dragRows(alternate.container)[0].getAttribute('draggable')).toBe('false');
    expect(mocks.reorderCases).not.toHaveBeenCalled();
  });

  it('keeps the server-confirmed order visible and exposes a rollback state after failure', async () => {
    mocks.reorderCases.mockResolvedValue(false);
    const { container, root } = renderTable();
    roots.push(root);
    await act(async () => Promise.resolve());
    const rows = dragRows(container);
    const transfer = dataTransfer();
    const start = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.assign(start, { dataTransfer: transfer });
    await act(async () => rows[0].dispatchEvent(start));
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: transfer });
    await act(async () => {
      rows[3].dispatchEvent(drop);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('server-confirmed order was restored');
    expect(rowIds(container)).toEqual(['1', '2', '3', '4']);
  });
});
