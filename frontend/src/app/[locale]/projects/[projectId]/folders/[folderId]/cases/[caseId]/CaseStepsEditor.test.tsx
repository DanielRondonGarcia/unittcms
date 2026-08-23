/** @vitest-environment happy-dom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StepsEditor from './CaseStepsEditor';
import { hasValidGherkinKeywords } from '@/utils/caseControl';
import type { GherkinKeyword } from '@/types/base';
import type { CaseMessages, StepType } from '@/types/case';

const mocks = vi.hoisted(() => ({ selections: [] as ((value: Set<string>) => void)[] }));

vi.mock('@heroui/react', () => ({
  Textarea: () => null,
  Button: ({ children, onPress, isDisabled }: any) => (
    <button disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => children,
  Avatar: () => null,
  Select: ({ children, label, onSelectionChange }: any) => {
    mocks.selections.push(onSelectionChange);
    return (
      <div>
        {label}
        {children}
      </div>
    );
  },
  SelectItem: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('lucide-react', () => ({ Plus: () => <span>+</span>, Trash: () => <span>×</span> }));

const messages = {
  step: 'Pasos',
  given: 'Dado',
  when: 'Cuando',
  then: 'Entonces',
  detailsOfTheStep: 'Details',
  expectedResult: 'Expected result',
  deleteThisStep: 'Delete',
  insertStep: 'Insert',
} as CaseMessages;

const makeStep = (id: number, stepNo: number, keyword?: GherkinKeyword | null) =>
  ({ id, step: `step ${id}`, result: `result ${id}`, caseSteps: { stepNo, keyword } }) as StepType;

function renderEditor(steps: StepType[]) {
  const container = document.createElement('div');
  const root = createRoot(container);
  const handlers = { onStepUpdate: vi.fn(), onStepPlus: vi.fn(), onStepDelete: vi.fn() };
  act(() => root.render(<StepsEditor isDisabled={false} isGherkin steps={steps} messages={messages} {...handlers} />));
  return { container, root, ...handlers };
}

describe('Gherkin step editor', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.selections.length = 0;
  });

  it('shows localized labels and preserves row order when keywords repeat', () => {
    const { container, root, onStepUpdate } = renderEditor([makeStep(1, 1, 'given'), makeStep(2, 2, 'then')]);
    expect(container.textContent).toContain('Dado');
    expect(container.textContent).toContain('Cuando');
    expect(container.textContent).toContain('Entonces');
    act(() => mocks.selections[0](new Set(['then'])));
    expect(onStepUpdate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ caseSteps: { stepNo: 1, keyword: 'then' } })
    );
    act(() => root.unmount());
  });

  it('keeps insertion and deletion controls wired to positions', () => {
    const rendered = renderEditor([makeStep(1, 1, 'given')]);
    const buttons = rendered.container.querySelectorAll('button');
    act(() => {
      buttons[0].click();
      buttons[1].click();
    });
    expect(rendered.onStepDelete).toHaveBeenCalledWith(1);
    expect(rendered.onStepPlus).toHaveBeenCalledWith(2);
    act(() => rendered.root.unmount());
  });

  it('rejects malformed active keywords at the save guard', () => {
    expect(hasValidGherkinKeywords([makeStep(1, 1, 'given'), makeStep(2, 2, 'then')])).toBe(true);
    expect(hasValidGherkinKeywords([makeStep(1, 1), makeStep(2, 2, 'invalid' as GherkinKeyword)])).toBe(false);
    expect(hasValidGherkinKeywords([{ ...makeStep(1, 1), editState: 'deleted' }])).toBe(true);
  });
});
