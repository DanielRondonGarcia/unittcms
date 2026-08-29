import { useEffect, useRef } from 'react';

type Options<T> = {
  active: boolean;
  poll: () => Promise<T>;
  onValue: (value: T) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  maxIntervalMs?: number;
  restartKey?: string | number;
};

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useAutomationPolling<T>({
  active,
  poll,
  onValue,
  onError,
  intervalMs = 750,
  maxIntervalMs = 8_000,
  restartKey,
}: Options<T>): void {
  const pollRef = useRef(poll);
  const onValueRef = useRef(onValue);
  const onErrorRef = useRef(onError);
  pollRef.current = poll;
  onValueRef.current = onValue;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!active) return undefined;

    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const baseDelay = Math.max(1, Number(intervalMs) || 1);
    const maximumDelay = Math.max(baseDelay, Number(maxIntervalMs) || baseDelay);
    let delay = baseDelay;

    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = () => {
      if (disposed || timer !== undefined || !isVisible()) return;
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, delay);
    };

    const run = async () => {
      if (disposed || inFlight || !isVisible()) return;
      inFlight = true;
      try {
        const value = await pollRef.current();
        if (disposed) return;
        delay = baseDelay;
        onValueRef.current(value);
      } catch (error) {
        if (disposed) return;
        onErrorRef.current?.(error);
        delay = Math.min(maximumDelay, Math.max(baseDelay, delay * 2));
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const resume = () => {
      if (!isVisible() || disposed) return;
      clearTimer();
      void run();
    };

    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    void run();

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, [active, intervalMs, maxIntervalMs, restartKey]);
}
