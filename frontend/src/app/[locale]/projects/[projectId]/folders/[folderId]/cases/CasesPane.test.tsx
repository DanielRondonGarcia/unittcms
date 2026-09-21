/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CasesPane from './CasesPane';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  fetchCases: vi.fn(),
  createCase: vi.fn(),
  deleteCases: vi.fn(),
  exportCases: vi.fn(),
  reorderCases: vi.fn(),
  addToast: vi.fn(),
  routerPush: vi.fn(),
  searchParams: { toString: () => '', get: () => null },
  tableProps: undefined as
    | {
        cases: Array<{ id: number }>;
        folderId: number;
        onReorderCases: (folderId: number, orderedCaseIds: number[]) => Promise<boolean>;
      }
    | undefined,
}));

vi.mock('@heroui/react', () => ({ addToast: mocks.addToast }));
vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => mocks.searchParams,
}));
vi.mock('@/utils/caseControl', () => ({
  fetchCases: mocks.fetchCases,
  createCase: mocks.createCase,
  deleteCases: mocks.deleteCases,
  exportCases: mocks.exportCases,
  reorderCases: mocks.reorderCases,
}));
vi.mock('@/utils/testCaseMoveEvent', () => ({ onMoveEvent: () => vi.fn() }));
vi.mock('./TestCaseTable', () => ({
  default: (props: typeof mocks.tableProps) => {
    mocks.tableProps = props ?? undefined;
    return (
      <>
        <div data-testid="case-ids">{props?.cases.map((testCase) => testCase.id).join(',')}</div>
        <button onClick={() => void props?.onReorderCases(props.folderId, [2, 1])}>Reorder</button>
      </>
    );
  },
}));
vi.mock('./CaseDialog', () => ({ default: () => null }));
vi.mock('./CaseMoveDialog', () => ({ default: () => null }));
vi.mock('./CaseImportDialog', () => ({ default: () => null }));
vi.mock('@/components/DeleteConfirmDialog', () => ({ default: () => null }));

const contextValue = {
  token: { access_token: 'test-token' },
  isSignedIn: () => true,
  isProjectDeveloper: () => true,
};

const messages = {
  successTitle: 'Success',
  errorTitle: 'Error',
  casesImported: 'Cases imported',
};

function testCase(id: number, position: number) {
  return {
    id,
    position,
    title: `Case ${id}`,
    folderId: 3,
  };
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe('CasesPane case reordering', () => {
  let root: ReturnType<typeof createRoot> | undefined;

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCases.mockResolvedValue([testCase(1, 1), testCase(2, 2)]);
    mocks.reorderCases.mockResolvedValue({ ok: true, data: { folderId: 3, orderedCaseIds: [2, 1], committed: [] } });
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    mocks.tableProps = undefined;
    document.body.innerHTML = '';
  });

  function renderPane() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TokenContext.Provider value={contextValue as never}>
          <CasesPane
            projectId="10"
            folderId="3"
            messages={messages as never}
            priorityMessages={{} as never}
            testTypeMessages={{} as never}
            locale="en"
          />
        </TokenContext.Provider>
      );
    });
    return container;
  }

  it('sends the complete permutation and refreshes from the server after success', async () => {
    mocks.fetchCases.mockReset();
    mocks.fetchCases
      .mockResolvedValueOnce([testCase(1, 1), testCase(2, 2)])
      .mockResolvedValueOnce([testCase(2, 1), testCase(1, 2)]);
    const container = renderPane();
    await act(async () => settle());

    expect(mocks.tableProps?.folderId).toBe(3);
    await act(async () => {
      container.querySelector('button')?.click();
      await settle();
    });

    expect(mocks.reorderCases).toHaveBeenCalledWith('test-token', 3, [2, 1]);
    expect(mocks.fetchCases).toHaveBeenCalledTimes(2);
  });

  it('restores the server-confirmed list and reports failure when reorder is rejected', async () => {
    mocks.reorderCases.mockResolvedValue({ ok: false, error: { status: 409, code: 'stale_order' } });
    const container = renderPane();
    await act(async () => settle());

    await act(async () => {
      container.querySelector('button')?.click();
      await settle();
    });

    expect(container.querySelector('[data-testid="case-ids"]')?.textContent).toBe('1,2');
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
        color: 'danger',
        description: expect.stringContaining('server-confirmed order was restored'),
      })
    );
  });
});
