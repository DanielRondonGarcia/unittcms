/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TestCaseDetailPane from './DetailPane';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  fetchCase: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
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
    selectedKey,
  }: {
    children?: React.ReactNode;
    className?: string;
    selectedKey?: string;
  }) => (
    <div data-selected-key={selectedKey} data-testid="detail-tabs" className={className}>
      {children}
    </div>
  ),
  Tab: ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) => (
    <div data-tab-title={String(title)}>{children}</div>
  ),
}));

vi.mock('./CaseDetail', () => ({ default: () => <div data-testid="case-detail" /> }));
vi.mock('./AutomationExecutionPanel', () => ({ default: () => <div data-testid="automation-execution" /> }));
vi.mock('./AutomationHistory', () => ({ default: () => <div data-testid="automation-history" /> }));
vi.mock('@/components/Comments', () => ({ default: () => <div data-testid="comments" /> }));

const contextValue = {
  token: { access_token: 'test-token' },
  isSignedIn: () => true,
};

const messages = {
  loading: 'Loading…',
  options: 'Run case detail tabs',
  caseDetail: 'Case detail',
  comments: 'Comments',
  history: 'History',
};

describe('run case detail tabs', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.searchParams = new URLSearchParams();
    mocks.fetchCase.mockResolvedValue({
      id: 1,
      Steps: [],
      RunCases: [],
      template: 'text',
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
    expect(tabs?.classList.contains('min-w-0')).toBe(true);
    expect(tabs?.classList.contains('w-full')).toBe(true);
    expect(tabs?.classList.contains('max-w-full')).toBe(true);
    expect(tabs?.classList.contains('shrink-0')).toBe(true);
    expect(tabs?.classList.contains('overflow-x-auto')).toBe(true);
    expect(tabs?.dataset.selectedKey).toBe('caseDetail');
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-tab-title]')).map((tab) => tab.dataset.tabTitle)
    ).toEqual([messages.caseDetail, messages.comments, messages.history]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
