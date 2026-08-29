/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { useAutomationPolling } from './useAutomationPolling';

type HarnessProps = {
  active: boolean;
  poll: () => Promise<string>;
  onValue: (value: string) => void;
  onError: (error: unknown) => void;
};

function Harness({ active, poll, onValue, onError }: HarnessProps) {
  useAutomationPolling({ active, poll, onValue, onError, intervalMs: 10, maxIntervalMs: 40 });
  return null;
}

function HistoryHarness({ poll, onValue, onError }: {
  poll: () => Promise<string[]>;
  onValue: (value: string[]) => void;
  onError: (error: unknown) => void;
}) {
  useAutomationPolling({ active: true, poll, onValue, onError, intervalMs: 10, maxIntervalMs: 40 });
  return null;
}

describe('useAutomationPolling', () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    vi.useRealTimers();
  });

  it('does not overlap requests and schedules the next poll after completion', async () => {
    vi.useFakeTimers();
    let releaseFirst!: (value: string) => void;
    const poll = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = resolve;
        })
    );
    const onValue = vi.fn();
    const root = createRoot(document.createElement('div'));
    roots.push(root);

    await act(async () => {
      root.render(<Harness active poll={poll} onValue={onValue} onError={vi.fn()} />);
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst('first');
      await Promise.resolve();
    });
    expect(onValue).toHaveBeenCalledWith('first');

    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('backs off after a failed request and resets the delay after success', async () => {
    vi.useFakeTimers();
    const poll = vi.fn<[], Promise<string>>();
    poll.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce('ok').mockResolvedValue('steady');
    const onValue = vi.fn();
    const onError = vi.fn();
    const root = createRoot(document.createElement('div'));
    roots.push(root);

    await act(async () => {
      root.render(<Harness active poll={poll} onValue={onValue} onError={onError} />);
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(19);
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(onValue).toHaveBeenCalledWith('ok');

    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('discovers a history execution after the first response is empty', async () => {
    vi.useFakeTimers();
    const poll = vi.fn<[], Promise<string[]>>().mockResolvedValueOnce([]).mockResolvedValueOnce(['execution-1']);
    const onValue = vi.fn();
    const root = createRoot(document.createElement('div'));
    roots.push(root);

    await act(async () => {
      root.render(<HistoryHarness poll={poll} onValue={onValue} onError={vi.fn()} />);
      await Promise.resolve();
    });
    expect(onValue).toHaveBeenNthCalledWith(1, []);

    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(onValue).toHaveBeenNthCalledWith(2, ['execution-1']);
  });
});
