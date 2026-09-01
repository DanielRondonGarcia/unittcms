/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import CaseDetail from './CaseDetail';

vi.mock('@heroui/react', () => ({
  Textarea: ({ label, value }: { label?: string; value?: string }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/TestCasePriority', () => ({ default: () => <span>priority</span> }));
vi.mock('@/src/i18n/routing', () => ({
  Link: ({ href, locale, children, ...props }: { href: string; locale: string; children?: React.ReactNode }) => (
    <a href={href} data-locale={locale} {...props}>
      {children}
    </a>
  ),
  NextUiLinkClasses: '',
}));

const messages = {
  description: 'Description',
  priority: 'Priority',
  type: 'Type',
  tags: 'Tags',
  noCaseSelected: 'No test case selected',
  metadata: 'Metadata',
  noScenarioSteps: 'No scenario steps',
  testDetail: 'Test detail',
  preconditions: 'Preconditions',
  expectedResult: 'Expected result',
  steps: 'Steps',
  detailsOfTheStep: 'Step details',
};

const testCase = {
  id: 1,
  title: 'A case with a long title',
  state: 0,
  priority: 0,
  type: 0,
  automationStatus: 0,
  description: 'A long description',
  template: 0,
  preConditions: 'The precondition',
  expectedResults: 'The expected result',
  folderId: 4,
};

describe('run case detail navigation', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps a valid localized case link and avoids invalid hrefs', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <CaseDetail
          projectId="2"
          testCase={testCase as never}
          locale="es"
          messages={messages as never}
          testTypeMessages={{ other: 'Other' } as never}
          priorityMessages={{ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }}
        />
      );
    });

    const link = container.querySelector<HTMLAnchorElement>('a');
    expect(link?.getAttribute('href')).toBe('/projects/2/folders/4/cases/1');
    expect(link?.dataset.locale).toBe('es');
    expect(container.querySelector('summary')?.textContent).toBe(messages.metadata);
    const rootElement = container.firstElementChild as HTMLElement | null;
    expect(rootElement?.classList.contains('h-full')).toBe(false);
    expect(rootElement?.classList.contains('overflow-y-auto')).toBe(false);
    expect(rootElement?.classList.contains('min-w-0')).toBe(true);

    act(() => {
      root.render(
        <CaseDetail
          projectId="2"
          testCase={{ ...testCase, folderId: 0 } as never}
          locale="es"
          messages={messages as never}
          testTypeMessages={{ other: 'Other' } as never}
          priorityMessages={{ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }}
        />
      );
    });

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain(messages.noCaseSelected);

    act(() => root.unmount());
    container.remove();
  });

  it('keeps long detail values observable for narrow responsive layouts', () => {
    const longDescription = 'Description that must remain readable '.repeat(20);
    const longPreconditions = 'Precondition value that must not be silently lost '.repeat(12);
    const longExpectedResult = 'Expected result value that must remain available '.repeat(12);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <CaseDetail
          projectId="2"
          testCase={
            {
              ...testCase,
              description: longDescription,
              preConditions: longPreconditions,
              expectedResults: longExpectedResult,
            } as never
          }
          locale="en"
          messages={messages as never}
          testTypeMessages={{ other: 'Other' } as never}
          priorityMessages={{ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }}
        />
      );
    });

    expect(container.querySelector('dd')?.textContent).toBe(longDescription);
    expect(container.textContent).toContain(longPreconditions);
    expect(container.textContent).toContain(longExpectedResult);
    expect(container.querySelector('details summary')?.textContent).toBe(messages.metadata);

    act(() => root.unmount());
    container.remove();
  });
});
