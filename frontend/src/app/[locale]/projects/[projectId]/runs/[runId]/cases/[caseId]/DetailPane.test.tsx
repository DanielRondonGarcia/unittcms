/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TestCaseDetailPane from './DetailPane';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  fetchCase: vi.fn(),
  searchParams: new URLSearchParams(),
  routerPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ push: mocks.routerPush }),
}));

vi.mock('@/utils/caseControl', () => ({
  fetchCase: mocks.fetchCase,
}));

vi.mock('@/utils/errorHandler', () => ({
  logError: vi.fn(),
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
});

vi.mock('@heroui/react', () => ({
  Tabs: ({
    children,
    className,
    classNames,
    selectedKey,
    onSelectionChange,
  }: {
    children?: React.ReactNode;
    className?: string;
    classNames?: { base?: string; tabList?: string; tab?: string; panel?: string };
    selectedKey?: string;
    onSelectionChange?: (key: string) => void;
  }) => {
    const tabPanels = React.Children.toArray(children);
    return (
      <>
        <div
          data-selected-key={selectedKey}
          data-slot="base"
          data-testid="detail-tabs"
          className={[className, classNames?.base].filter(Boolean).join(' ')}
        >
          <div data-slot="tabList" data-testid="detail-tab-list" className={classNames?.tabList}>
            {(['caseDetail', 'manualExecution', 'automation', 'comments', 'history'] as const).map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`select-tab-${key}`}
                className={classNames?.tab}
                onClick={() => onSelectionChange?.(key)}
              >
                Select {key}
              </button>
            ))}
          </div>
        </div>
        {tabPanels.map((tabPanel, index) => (
          <div key={index} data-panel-class={classNames?.panel} data-slot="panel" className={classNames?.panel}>
            {tabPanel}
          </div>
        ))}
      </>
    );
  },
  Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void | Promise<void> }) => (
    <button onClick={onPress}>{children}</button>
  ),
  Tab: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => (
    <div data-tab-title={String(title)}>{children}</div>
  ),
}));

vi.mock('./CaseDetail', () => ({ default: () => <div data-testid="case-detail" /> }));
vi.mock('./AutomationExecutionPanel', () => ({ default: () => <div data-testid="automation-execution" /> }));
vi.mock('./ManualExecutionPanel', () => ({
  default: ({ runCaseId }: { runCaseId: number }) => (
    <div data-testid="manual-execution" data-run-case-id={runCaseId} />
  ),
}));
vi.mock('./AutomationHistory', () => ({ default: () => <div data-testid="automation-history" /> }));
vi.mock('@/components/Comments', () => ({
  default: ({ commentableId }: { commentableId?: number }) => (
    <div data-testid="comments" data-commentable-id={commentableId} />
  ),
}));

const contextValue = {
  token: { access_token: 'test-token' },
  isSignedIn: () => true,
};

const messages = {
  loading: 'Loading…',
  requestError: 'Something went wrong.',
  retry: 'Try again',
  retryAfter: 'Retry after',
  correlationId: 'Correlation ID',
  noCaseSelected: 'No test case selected',
  options: 'Run case detail tabs',
  caseDetail: 'Case detail',
  comments: 'Comments',
  history: 'History',
  automation: 'Automation',
};

const manualExecutionMessages = { manualExecution: 'Manual execution' };

describe('run case detail tabs', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.searchParams = new URLSearchParams();
    mocks.fetchCase.mockReset();
    mocks.routerPush.mockReset();
    mocks.fetchCase.mockResolvedValue({
      ok: true,
      data: {
        id: 1,
        Steps: [],
        RunCases: [],
        template: 'text',
      },
    });
  });

  it('keeps the tab base visible and preserves the tab order', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <TestCaseDetailPane
            projectId="1"
            runId="2"
            locale="en"
            caseId="1"
            messages={messages as never}
            manualExecutionMessages={manualExecutionMessages as never}
            testTypeMessages={{} as never}
            priorityMessages={{} as never}
            commentMessages={{} as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const tabs = container.querySelector<HTMLElement>('[data-testid="detail-tabs"]');
    expect(tabs).not.toBeNull();
    expect(tabs?.dataset.slot).toBe('base');
    expect(tabs?.classList.contains('min-w-0')).toBe(true);
    expect(tabs?.classList.contains('w-full')).toBe(true);
    expect(tabs?.classList.contains('max-w-full')).toBe(true);
    expect(tabs?.classList.contains('shrink-0')).toBe(true);
    expect(tabs?.classList.contains('min-h-0')).toBe(false);
    expect(tabs?.classList.contains('flex-1')).toBe(false);
    expect(tabs?.classList.contains('flex-col')).toBe(false);
    expect(tabs?.classList.contains('overflow-hidden')).toBe(false);

    const tabList = container.querySelector<HTMLElement>('[data-testid="detail-tab-list"]');
    expect(tabList?.dataset.slot).toBe('tabList');
    expect(tabList?.classList.contains('run-case-tab-list')).toBe(true);
    expect(tabList?.classList.contains('w-full')).toBe(true);
    expect(tabList?.classList.contains('min-w-0')).toBe(true);
    expect(tabList?.classList.contains('max-w-full')).toBe(true);
    expect(tabList?.classList.contains('overflow-x-auto')).toBe(true);
    expect(tabList?.parentElement).toBe(tabs);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="select-tab-comments"]')?.className).toContain(
      'min-w-max'
    );
    expect(container.querySelector<HTMLButtonElement>('[data-testid="select-tab-comments"]')?.className).toContain(
      'shrink-0'
    );

    const panel = container.querySelector<HTMLElement>('[data-slot="panel"]');
    expect(panel?.dataset.panelClass).toContain('overflow-y-auto');
    expect(panel?.classList.contains('min-h-0')).toBe(true);
    expect(panel?.classList.contains('min-w-0')).toBe(true);
    expect(panel?.classList.contains('flex-1')).toBe(true);
    expect(panel?.classList.contains('overflow-y-auto')).toBe(true);
    expect(panel?.classList.contains('overflow-x-auto')).toBe(true);
    expect(tabs?.nextElementSibling).toBe(panel);
    expect(tabs?.dataset.selectedKey).toBe('caseDetail');
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-tab-title]')).map((tab) => tab.dataset.tabTitle)
    ).toEqual([messages.caseDetail, messages.comments, messages.history]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('writes the selected tab while preserving the localized path and unrelated query params', async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, '', '/es/projects/1/runs/2/cases/1?filter=active&sort=desc');
    mocks.searchParams = new URLSearchParams('filter=active&sort=desc');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <TestCaseDetailPane
            projectId="1"
            runId="2"
            locale="es"
            caseId="1"
            messages={messages as never}
            manualExecutionMessages={manualExecutionMessages as never}
            testTypeMessages={{} as never}
            priorityMessages={{} as never}
            commentMessages={{} as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.routerPush).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="select-tab-comments"]')?.click();
      await Promise.resolve();
    });

    expect(mocks.routerPush).toHaveBeenCalledWith(
      '/es/projects/1/runs/2/cases/1?filter=active&sort=desc&tab=comments',
      { scroll: false }
    );
    expect(container.querySelector<HTMLElement>('[data-testid="detail-tabs"]')?.dataset.selectedKey).toBe('comments');

    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState({}, '', previousUrl || '/');
  });

  it('renders a typed fetch error and retries only the case request', async () => {
    mocks.fetchCase
      .mockResolvedValueOnce({
        ok: false,
        error: {
          status: 429,
          code: 'http_429',
          message: 'Too many requests.',
          correlationId: 'corr-case-1',
          retryAfterSeconds: 30,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 1, Steps: [], RunCases: [], template: 'text' },
      });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <TestCaseDetailPane
            projectId="1"
            runId="2"
            locale="en"
            caseId="1"
            messages={messages as never}
            manualExecutionMessages={manualExecutionMessages as never}
            testTypeMessages={{} as never}
            priorityMessages={{} as never}
            commentMessages={{} as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Too many requests.');
    expect(container.textContent).toContain('30s');
    expect(container.textContent).toContain('corr-case-1');

    await act(async () => {
      container.querySelector('button')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetchCase).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="case-detail"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('preserves comments, history, and manual execution deep links', async () => {
    for (const [requestedTab, expectedTab] of [
      ['comments', 'comments'],
      ['history', 'history'],
      ['manual-execution', 'manualExecution'],
    ] as const) {
      mocks.searchParams = new URLSearchParams(`tab=${requestedTab}`);
      mocks.fetchCase.mockResolvedValueOnce({
        ok: true,
        data: {
          id: 1,
          Steps: [],
          RunCases: [{ id: 9, runId: 2, caseId: 1, status: 0 }],
          template: 'text',
        },
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <TokenContext.Provider value={contextValue as never}>
            <TestCaseDetailPane
              projectId="1"
              runId="2"
              locale="en"
              caseId="1"
              messages={messages as never}
              manualExecutionMessages={manualExecutionMessages as never}
              testTypeMessages={{} as never}
              priorityMessages={{} as never}
              commentMessages={{} as never}
            />
          </TokenContext.Provider>
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector<HTMLElement>('[data-testid="detail-tabs"]')?.dataset.selectedKey).toBe(
        expectedTab
      );

      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('keeps the RunCase comment target separate from the manual execution panel', async () => {
    mocks.fetchCase.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 1,
        Steps: [],
        RunCases: [{ id: 9, runId: 2, caseId: 1, status: 0, assigneeUserId: 3 }],
        template: 'text',
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <TestCaseDetailPane
            projectId="1"
            runId="2"
            locale="en"
            caseId="1"
            messages={messages as never}
            manualExecutionMessages={manualExecutionMessages as never}
            testTypeMessages={{} as never}
            priorityMessages={{} as never}
            commentMessages={{} as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="manual-execution"]')?.getAttribute('data-run-case-id')).toBe('9');
    expect(container.querySelector('[data-testid="comments"]')?.getAttribute('data-commentable-id')).toBe('9');
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-tab-title]')).map((tab) => tab.dataset.tabTitle)
    ).toEqual([messages.caseDetail, manualExecutionMessages.manualExecution, messages.comments, messages.history]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('omits manual execution while keeping case, comments, and history tabs available', async () => {
    mocks.fetchCase.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 1,
        Steps: [],
        RunCases: [{ id: 9, runId: 2, caseId: 1, status: 0 }],
        template: 'text',
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <TestCaseDetailPane
            projectId="1"
            runId="2"
            locale="en"
            caseId="1"
            messages={messages as never}
            manualExecutionMessages={manualExecutionMessages as never}
            manualExecutionEnabled={false}
            testTypeMessages={{} as never}
            priorityMessages={{} as never}
            commentMessages={{} as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="manual-execution"]')).toBeNull();
    expect(container.querySelector('[data-testid="case-detail"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="comments"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="automation-history"]')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-tab-title]')).map((tab) => tab.dataset.tabTitle)
    ).toEqual([messages.caseDetail, messages.comments, messages.history]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
