/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import MarkdownContent from './MarkdownContent';

const roots: ReturnType<typeof createRoot>[] = [];
const originalClipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

describe('MarkdownContent', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('renders GFM content, filters unsafe links, and copies fenced code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <MarkdownContent
          content={
            '## Run locally\n\nUse `pnpm test`.\n\n```bash\npnpm test\n```\n\n[Unsafe](javascript:alert(1)) [Docs](https://example.com/docs)'
          }
          copyLabel="Copy code"
          copiedLabel="Copied"
          copyFailedLabel="Copy failed"
        />
      );
    });

    expect(container.querySelector('h2')?.textContent).toBe('Run locally');
    expect(container.querySelector('code')?.textContent).toBe('pnpm test');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('a[href="https://example.com/docs"]')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();

    const button = container.querySelector<HTMLButtonElement>('button');
    expect(button?.textContent).toBe('Copy code');

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('pnpm test');
    expect(button?.textContent).toBe('Copied');
  });

  it('shows localized failure feedback when the clipboard rejects the copy', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    setClipboard(writeText);
    const container = document.createElement('div');
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <MarkdownContent
          content={'```sh\necho test\n```'}
          copyLabel="Copy code"
          copiedLabel="Copied"
          copyFailedLabel="Copy failed"
        />
      );
    });

    const button = container.querySelector<HTMLButtonElement>('button');
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('echo test');
    expect(button?.textContent).toBe('Copy failed');
  });
});
