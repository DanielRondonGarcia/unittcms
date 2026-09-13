'use client';

import { Children, isValidElement, type ReactNode, useState } from 'react';
import clsx from 'clsx';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Props = {
  content?: string | null;
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
  className?: string;
};

type ElementWithChildren = {
  children?: ReactNode;
};

type CopyState = 'idle' | 'copied' | 'failed';

function getTextContent(value: ReactNode): string {
  return Children.toArray(value)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement<ElementWithChildren>(child)) return getTextContent(child.props.children);
      return '';
    })
    .join('');
}

function safeUrlTransform(url: string): string {
  const normalized = url.trim();
  if (/^(?:https?:|mailto:)/i.test(normalized) || normalized.startsWith('#')) return normalized;
  return '';
}

function CopyableCodeBlock({
  code,
  children,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
}: {
  code: string;
  children: ReactNode;
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const label = copyState === 'copied' ? copiedLabel : copyState === 'failed' ? copyFailedLabel : copyLabel;

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed');
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <div className="my-3 min-w-0 max-w-full overflow-hidden rounded-lg border border-default-200 bg-default-50 dark:border-divider dark:bg-content2">
      <div className="flex justify-end border-b border-default-200 p-1 dark:border-divider">
        <button
          type="button"
          className="rounded px-2 py-1 text-xs font-medium text-default-600 hover:bg-default-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-default-700 dark:hover:bg-default-100"
          onClick={() => void handleCopy()}
          aria-label={label}
        >
          <span aria-live="polite">{label}</span>
        </button>
      </div>
      <pre
        className="max-w-full overflow-x-auto whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-foreground"
        translate="no"
      >
        {children}
      </pre>
    </div>
  );
}

function createComponents(copyLabels: Pick<Props, 'copyLabel' | 'copiedLabel' | 'copyFailedLabel'>): Components {
  return {
    a({ node: _node, children, href, ...props }) {
      return (
        <a
          {...props}
          href={href || undefined}
          className="break-words text-primary underline underline-offset-2 hover:text-primary-600"
        >
          {children}
        </a>
      );
    },
    blockquote({ node: _node, children }) {
      return <blockquote className="my-2 border-s-2 border-default-300 ps-3 italic">{children}</blockquote>;
    },
    code({ node: _node, className, children, ...props }) {
      return (
        <code
          {...props}
          className={clsx('break-words rounded bg-default-100 px-1 py-0.5 font-mono text-[0.9em]', className)}
          translate="no"
        >
          {children}
        </code>
      );
    },
    h1({ node: _node, children }) {
      return <h1 className="my-2 text-lg font-bold text-foreground">{children}</h1>;
    },
    h2({ node: _node, children }) {
      return <h2 className="my-2 text-base font-bold text-foreground">{children}</h2>;
    },
    h3({ node: _node, children }) {
      return <h3 className="my-2 font-semibold text-foreground">{children}</h3>;
    },
    h4({ node: _node, children }) {
      return <h4 className="my-2 font-semibold text-foreground">{children}</h4>;
    },
    h5({ node: _node, children }) {
      return <h5 className="my-2 font-semibold text-foreground">{children}</h5>;
    },
    h6({ node: _node, children }) {
      return <h6 className="my-2 font-semibold text-foreground">{children}</h6>;
    },
    img: () => null,
    li({ node: _node, children }) {
      return <li className="break-words">{children}</li>;
    },
    ol({ node: _node, children }) {
      return <ol className="my-2 list-decimal space-y-1 ps-5">{children}</ol>;
    },
    p({ node: _node, children }) {
      return <p className="my-2 break-words first:mt-0 last:mb-0">{children}</p>;
    },
    pre({ node: _node, children }) {
      const code = getTextContent(children).replace(/\n$/, '');
      return (
        <CopyableCodeBlock code={code} {...copyLabels}>
          {children}
        </CopyableCodeBlock>
      );
    },
    ul({ node: _node, children }) {
      return <ul className="my-2 list-disc space-y-1 ps-5">{children}</ul>;
    },
  };
}

export default function MarkdownContent({ content, copyLabel, copiedLabel, copyFailedLabel, className }: Props) {
  if (!content?.trim()) {
    return <span className={clsx('text-default-500', className)}>-</span>;
  }

  return (
    <div className={clsx('min-w-0 max-w-full break-words text-foreground', className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrlTransform}
        components={createComponents({ copyLabel, copiedLabel, copyFailedLabel })}
      >
        {content}
      </Markdown>
    </div>
  );
}
