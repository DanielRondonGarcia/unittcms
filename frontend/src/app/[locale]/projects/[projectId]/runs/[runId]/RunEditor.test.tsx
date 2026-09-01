/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import RunEditor from './RunEditor';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  fetchRun: vi.fn(),
  fetchFolders: vi.fn(),
  fetchProjectCases: vi.fn(),
  fetchMembers: vi.fn(),
  routerPush: vi.fn(),
  treeToggle: vi.fn(),
}));

vi.mock('../runsControl', () => ({
  fetchRun: mocks.fetchRun,
  fetchProjectCases: mocks.fetchProjectCases,
  fetchProjectMembersForRun: mocks.fetchMembers,
  updateRun: vi.fn(),
  updateRunCases: vi.fn(),
  includeExcludeTestCases: vi.fn(),
  changeStatus: vi.fn(),
  mergeRunCaseChanges: vi.fn(),
  hasUnsavedRunCaseChanges: vi.fn(() => false),
  exportRun: vi.fn(),
  assignRunCases: vi.fn(),
}));

vi.mock('../../folders/foldersControl', () => ({
  fetchFolders: mocks.fetchFolders,
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
});

vi.mock('@/utils/formGuard', () => ({ useFormGuard: vi.fn() }));

vi.mock('@/src/i18n/routing', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('react-arborist', () => ({
  Tree: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="tree">
      {typeof children === 'function'
        ? (children as (props: unknown) => React.ReactNode)({
            node: {
              data: { id: '3', name: 'Regression', children: [{ id: 'child' }] },
              isOpen: false,
              toggle: mocks.treeToggle,
            },
            style: {},
          })
        : children}
    </div>
  ),
}));

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

  return {
    Button: ({
      children,
      onPress,
      isDisabled,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      onPress?: () => void | Promise<void>;
      isDisabled?: boolean;
      'aria-label'?: string;
    }) => (
      <button aria-label={ariaLabel} disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    ),
    Input: () => <input />,
    Textarea: () => <textarea />,
    Select: passthrough,
    SelectItem: passthrough,
    Tooltip: passthrough,
    Divider: () => <hr />,
    Selection: Set,
    DropdownTrigger: passthrough,
    Dropdown: passthrough,
    DropdownMenu: passthrough,
    DropdownItem: passthrough,
    Badge: passthrough,
    Popover: passthrough,
    PopoverContent: passthrough,
    PopoverTrigger: passthrough,
    addToast: vi.fn(),
  };
});

vi.mock('./RunPregressDonutChart', () => ({ default: () => null }));
vi.mock('./TestCaseSelector', () => ({ default: () => null }));
vi.mock('./AutomationBatchPanel', () => ({ default: () => null }));
vi.mock('./AssigneePicker', () => ({ default: () => null }));
vi.mock('./TestRunFilter', () => ({ default: () => null }));
vi.mock('@/components/TreeItem', () => ({
  default: ({ toggleButton, label }: { toggleButton?: React.ReactNode; label: string }) => (
    <div>
      {toggleButton}
      <span>{label}</span>
    </div>
  ),
}));

const contextValue = {
  token: { access_token: 'test-token', user: { id: 7 } },
  isSignedIn: () => true,
  isProjectManager: () => false,
  isProjectDeveloper: () => false,
  isProjectReporter: () => false,
};

const messages = {
  backToRuns: 'Back to runs',
  loading: 'Loading run',
  requestError: 'Run request failed',
  retry: 'Retry',
  retryAfter: 'Retry after',
  correlationId: 'Correlation ID',
  errorTitle: 'Invalid run',
  areYouSureLeave: 'Are you sure?',
  update: 'Update',
  updating: 'Updating',
  successTitle: 'Success',
  updatedTestRun: 'Run updated',
  export: 'Export',
  progress: 'Progress',
  refresh: 'Refresh',
  title: 'Title',
  pleaseEnter: 'Please enter a value',
  description: 'Description',
  status: 'Status',
  selectTestCase: 'Select a test case',
  filter: 'Filter',
  exportOptions: 'Export options',
  expandFolder: 'Expand folder',
  collapseFolder: 'Collapse folder',
};

const run = {
  id: 7,
  name: 'Release run',
  configurations: 0,
  description: '',
  state: 0,
  projectId: 10,
  createdAt: '',
  updatedAt: '',
};

const folder = {
  id: 3,
  name: 'Regression',
  detail: '',
  projectId: 10,
  parentFolderId: null,
  createdAt: '',
  updatedAt: '',
  Cases: [],
};

const testCase = {
  id: 11,
  title: 'Login case',
  state: 0,
  priority: 0,
  type: 0,
  automationStatus: 0,
  description: '',
  template: 0,
  preConditions: '',
  expectedResults: '',
  folderId: 3,
  RunCases: [{ id: 12, runId: 7, caseId: 11, status: 0, editState: 'notChanged', assigneeUserId: null }],
};

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('RunEditor', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchFolders.mockResolvedValue([folder]);
    mocks.fetchProjectCases.mockResolvedValue([testCase]);
    mocks.fetchMembers.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.unstubAllGlobals();
  });

  it('resumes dependent initialization after retrying a failed initial run request', async () => {
    mocks.fetchRun
      .mockResolvedValueOnce({
        ok: false,
        error: {
          status: 503,
          code: 'http_503',
          message: 'Run unavailable',
          correlationId: 'corr-run-1',
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { run, statusCounts: [] } });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <RunEditor
            projectId="10"
            runId="7"
            messages={messages as never}
            runStatusMessages={{} as never}
            testRunCaseStatusMessages={{} as never}
            priorityMessages={{} as never}
            testTypeMessages={{} as never}
            locale="en"
          />
        </TokenContext.Provider>
      );
      await settle();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Run unavailable');
    expect(mocks.fetchRun).toHaveBeenCalledTimes(1);
    expect(mocks.fetchFolders).not.toHaveBeenCalled();
    expect(mocks.fetchProjectCases).not.toHaveBeenCalled();
    expect(mocks.fetchMembers).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector('button')?.click();
      await settle();
    });

    expect(mocks.fetchRun).toHaveBeenCalledTimes(2);
    expect(mocks.fetchFolders).toHaveBeenCalledTimes(1);
    expect(mocks.fetchProjectCases).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMembers).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps locale navigation and interactive disclosure fallback controls usable', async () => {
    mocks.fetchRun.mockResolvedValueOnce({ ok: true, data: { run, statusCounts: [] } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const staleCatalog = { ...messages, expandFolder: undefined, collapseFolder: undefined };
    const fallbackMessages = {
      ...staleCatalog,
      expandFolder: staleCatalog.expandFolder ?? 'Expand folder (fallback)',
      collapseFolder: staleCatalog.collapseFolder ?? 'Collapse folder (fallback)',
    };

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <RunEditor
            projectId="10"
            runId="7"
            messages={fallbackMessages as never}
            runStatusMessages={{} as never}
            testRunCaseStatusMessages={{} as never}
            priorityMessages={{} as never}
            testTypeMessages={{} as never}
            locale="es"
          />
        </TokenContext.Provider>
      );
      await settle();
    });

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Expand folder (fallback)"]');
    expect(toggle).not.toBeNull();
    await act(async () => toggle?.click());
    expect(mocks.treeToggle).toHaveBeenCalledOnce();

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back to runs"]');
    await act(async () => back?.click());
    expect(mocks.routerPush).toHaveBeenCalledWith('/projects/10/runs', { locale: 'es' });
  });
});
