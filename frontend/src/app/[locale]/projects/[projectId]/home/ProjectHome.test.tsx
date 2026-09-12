/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectHome } from './ProjectHome';
import { TokenContext } from '@/utils/TokenProvider';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('@/utils/TokenProvider', async () => {
  const { createContext } = await import('react');
  return { TokenContext: createContext(null) };
});

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('@/components/primitives', () => ({
  title: () => '',
  subtitle: () => '',
}));

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;

  return {
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void | Promise<void> }) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
    Card: passthrough,
    CardBody: passthrough,
    Chip: passthrough,
    Divider: () => <hr />,
  };
});

vi.mock('./TestTypesDonutChart', () => ({ default: () => null }));
vi.mock('./TestPriorityDonutChart', () => ({ default: () => null }));
vi.mock('./TestProgressColumnChart', () => ({ default: () => null }));

const contextValue = {
  token: { access_token: 'test-token' },
  isSignedIn: () => true,
};

const messages = {
  folders: 'Folders',
  testCases: 'Test Cases',
  testRuns: 'Test Runs',
  progress: 'Progress',
  testClassification: 'Test Classification',
  byType: 'By test type',
  byPriority: 'By test priority',
  loading: 'Loading project...',
  requestError: 'The requested data could not be loaded.',
  retry: 'Try again',
  retryAfter: 'Retry after',
  correlationId: 'Correlation ID',
  noProject: 'No project data is available.',
};

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

const project = {
  id: 7,
  name: 'QA project',
  detail: '',
  isPublic: false,
  userId: 1,
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
  Folders: [],
  Runs: [],
};

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('ProjectHome', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.unstubAllGlobals();
  });

  it('keeps the home mounted on a 429, preserves request metadata, and retries the same request', async () => {
    let resolveFailedResponse!: (value: Response) => void;
    mocks.fetch
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFailedResponse = resolve;
          })
      )
      .mockResolvedValueOnce(response(200, project));

    const failedResponse = response(
      429,
      { error: 'Too many requests.' },
      { 'X-Correlation-Id': 'corr-home-1', 'Retry-After': '30' }
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TokenContext.Provider value={contextValue as never}>
          <ProjectHome
            projectId="7"
            messages={messages}
            testRunCaseStatusMessages={{} as never}
            testTypeMessages={{} as never}
            priorityMessages={{} as never}
          />
        </TokenContext.Provider>
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(messages.loading);

    await act(async () => {
      resolveFailedResponse(failedResponse);
      await settle();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(messages.requestError);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Too many requests.');
    expect(container.textContent).toContain('HTTP 429');
    expect(container.textContent).toContain('corr-home-1');
    expect(container.textContent).toContain('30s');
    expect(container.querySelector('button')?.textContent).toBe(messages.retry);

    await act(async () => {
      container.querySelector('button')?.click();
      await settle();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.map(([input]) => input)).toEqual(['/api/home/7', '/api/home/7']);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('QA project');

    await act(async () => root.unmount());
    container.remove();
  });
});
