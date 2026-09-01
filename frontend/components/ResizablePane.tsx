'use client';
import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
  type PointerEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';

type Props = {
  leftPane: ReactNode;
  rightPane: ReactNode;
  minLeftWidth?: number;
  minRightWidth?: number;
  defaultLeftWidth?: number;
  separatorLabel?: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function getBounds(minLeftWidth: number, minRightWidth: number): { min: number; max: number } {
  const min = clamp(Number(minLeftWidth), 0, 100);
  const right = clamp(Number(minRightWidth), 0, 100 - min);
  return { min, max: 100 - right };
}

export default function ResizablePanes({
  leftPane,
  rightPane,
  minLeftWidth = 40,
  minRightWidth = 15,
  defaultLeftWidth = 70,
  separatorLabel = 'Resize panes',
}: Props) {
  const bounds = getBounds(minLeftWidth, minRightWidth);
  const [leftWidth, setLeftWidth] = useState(() => clamp(Number(defaultLeftWidth), bounds.min, bounds.max));
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    setLeftWidth((current) => clamp(current, bounds.min, bounds.max));
  }, [bounds.min, bounds.max]);

  const updateFromClientX = (clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width <= 0) return;
    setLeftWidth(clamp(((clientX - containerRect.left) / containerRect.width) * 100, bounds.min, bounds.max));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isDragging && pointerIdRef.current === event.pointerId) updateFromClientX(event.clientX);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setLeftWidth((current) => clamp(current + (event.key === 'ArrowRight' ? step : -step), bounds.min, bounds.max));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setLeftWidth(event.key === 'Home' ? bounds.min : bounds.max);
    }
  };

  const paneStyle = {
    '--left-pane-width': `${leftWidth}%`,
    '--min-left-pane-width': `${bounds.min}%`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden md:flex-row"
      style={{ ...paneStyle, userSelect: isDragging ? 'none' : 'auto' }}
    >
      <div className="h-1/2 min-h-0 min-w-0 w-full flex-none overflow-auto border-b dark:border-neutral-700 md:h-full md:w-[var(--left-pane-width)] md:min-w-[var(--min-left-pane-width)] md:border-b-0">
        {leftPane}
      </div>

      <div
        className="hidden w-1 shrink-0 cursor-col-resize touch-none transition-colors hover:bg-primary/50 active:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:block"
        role="separator"
        aria-label={separatorLabel}
        aria-orientation="vertical"
        aria-valuemin={Math.round(bounds.min)}
        aria-valuemax={Math.round(bounds.max)}
        aria-valuenow={Math.round(leftWidth)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ flexShrink: 0 }}
      />

      <div className="h-1/2 min-h-0 min-w-0 w-full flex-none overflow-auto md:h-full md:flex-1">{rightPane}</div>
    </div>
  );
}
