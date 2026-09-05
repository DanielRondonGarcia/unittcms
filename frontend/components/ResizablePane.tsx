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
  rightPaneVisible?: boolean;
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
  rightPaneVisible = true,
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
    '--right-pane-width': `calc(100% - ${leftWidth}%)`,
    '--min-left-pane-width': `${bounds.min}%`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden md:flex-row"
      style={{ ...paneStyle, userSelect: isDragging ? 'none' : 'auto' }}
    >
      <div
        className={`min-h-0 min-w-0 flex-none overflow-auto border-b transition-[height,width] duration-300 ease-out motion-reduce:transition-none dark:border-divider md:min-h-full md:border-b-0 ${
          rightPaneVisible
            ? 'h-1/2 w-full md:h-full md:w-[var(--left-pane-width)] md:min-w-[var(--min-left-pane-width)]'
            : 'h-full w-full md:h-full md:w-full'
        }`}
      >
        {leftPane}
      </div>

      <div
        className={`hidden shrink-0 cursor-col-resize touch-none transition-[width,opacity,background-color] duration-300 ease-out motion-reduce:transition-none hover:bg-primary/50 active:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:block ${
          rightPaneVisible ? 'w-1 opacity-100' : 'pointer-events-none w-0 opacity-0'
        }`}
        role="separator"
        aria-label={separatorLabel}
        aria-orientation="vertical"
        aria-valuemin={Math.round(bounds.min)}
        aria-valuemax={Math.round(bounds.max)}
        aria-valuenow={Math.round(leftWidth)}
        aria-hidden={!rightPaneVisible}
        tabIndex={rightPaneVisible ? 0 : -1}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ flexShrink: 0 }}
      />

      <div
        className={`min-h-0 min-w-0 flex-none overflow-auto transition-[height,width,opacity] duration-300 ease-out motion-reduce:transition-none ${
          rightPaneVisible
            ? 'visible h-1/2 w-full opacity-100 md:h-full md:w-[var(--right-pane-width)] md:flex-none'
            : 'invisible pointer-events-none h-0 w-full opacity-0 md:h-full md:w-0'
        }`}
        aria-hidden={!rightPaneVisible}
      >
        {rightPane}
      </div>
    </div>
  );
}
