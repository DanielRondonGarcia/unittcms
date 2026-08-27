import { describe, expect, it } from 'vitest';
import {
  deleteGherkinCaseStep,
  hasValidGherkinExamples,
  hasValidGherkinKeywords,
  hasValidGherkinStepOrder,
  insertGherkinCaseStep,
  normalizeGherkinCaseSteps,
  validateGherkinCase,
} from './caseControl';
import type { GherkinKeyword, GherkinSection } from '@/types/base';
import type { StepType } from '@/types/case';

function step(id: number, stepNo: number, keyword: GherkinKeyword, section: GherkinSection): StepType {
  return {
    id,
    step: `step ${id}`,
    result: `result ${id}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    caseSteps: { stepNo, keyword, section },
    uid: `uid-${id}`,
    editState: 'notChanged',
  };
}

describe('Gherkin case step controls', () => {
  it('preserves valid background metadata without discarding the step', () => {
    const result = normalizeGherkinCaseSteps([
      step(1, 1, 'given', 'background'),
      step(2, 2, 'when', 'scenario'),
      step(3, 3, 'then', 'scenario'),
    ]);

    expect(result.migrated).toBe(false);
    expect(result.steps.filter((item) => item.caseSteps.section === 'background')).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ editState: 'notChanged', caseSteps: { section: 'background' } });
  });

  it('repairs duplicate and gapped orders using stable stored ordering', () => {
    const deleted = { ...step(99, 2, 'and', 'background'), editState: 'deleted' as const };
    const result = normalizeGherkinCaseSteps([
      step(1, 3, 'when', 'scenario'),
      deleted,
      step(2, 1, 'given', 'scenario'),
      step(3, 3, 'and', 'scenario'),
      step(4, 5, 'then', 'scenario'),
    ]);

    expect(result.migrated).toBe(true);
    expect(result.steps.map((item) => item.id)).toEqual([2, 99, 1, 3, 4]);
    expect(result.steps.filter((item) => item.editState !== 'deleted').map((item) => item.caseSteps.stepNo)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(result.steps.find((item) => item.id === 99)).toEqual(deleted);
    expect(result.steps.find((item) => item.id === 1)).toMatchObject({ editState: 'changed' });
    expect(result.steps.find((item) => item.id === 3)).toMatchObject({ editState: 'notChanged' });
    expect(result.steps.find((item) => item.id === 4)).toMatchObject({ editState: 'changed' });
  });

  it('keeps insertion and deletion order invariants for malformed legacy data', () => {
    const initial = [step(1, 3, 'when', 'scenario'), step(2, 1, 'given', 'scenario'), step(3, 3, 'then', 'scenario')];
    const inserted = insertGherkinCaseStep(initial, step(4, 0, 'and', 'scenario'), 2);

    expect(inserted.filter((item) => item.editState !== 'deleted').map((item) => item.id)).toEqual([2, 4, 1, 3]);
    expect(hasValidGherkinStepOrder(inserted)).toBe(true);

    const deleted = deleteGherkinCaseStep(inserted, 4);
    expect(deleted.find((item) => item.id === 4)).toMatchObject({ editState: 'deleted', caseSteps: { stepNo: 2 } });
    expect(deleted.filter((item) => item.editState !== 'deleted').map((item) => item.caseSteps.stepNo)).toEqual([
      1, 2, 3,
    ]);
    expect(hasValidGherkinStepOrder(deleted)).toBe(true);
  });

  it('deletes using stored step order when the response array is out of order', () => {
    const result = deleteGherkinCaseStep(
      [
        step(1, 3, 'then', 'scenario'),
        step(2, 1, 'given', 'scenario'),
        step(3, 2, 'when', 'scenario'),
        step(4, 4, 'and', 'scenario'),
      ],
      3
    );

    expect(result.filter((item) => item.editState !== 'deleted').map((item) => item.id)).toEqual([2, 1, 4]);
    expect(result.filter((item) => item.editState !== 'deleted').map((item) => item.caseSteps.stepNo)).toEqual([
      1, 2, 3,
    ]);
    expect(result.find((item) => item.id === 3)).toMatchObject({ editState: 'deleted', caseSteps: { stepNo: 2 } });
  });

  it('requires Given, When, and Then plus valid executable keywords', () => {
    expect(
      hasValidGherkinKeywords([
        step(1, 1, 'given', 'background'),
        step(2, 2, 'when', 'scenario'),
        step(3, 3, 'then', 'scenario'),
      ])
    ).toBe(true);
    expect(hasValidGherkinKeywords([step(1, 1, 'given', 'scenario'), step(2, 2, 'then', 'scenario')])).toBe(false);
  });

  it('rejects duplicate, non-positive, and gapped active step orders', () => {
    expect(hasValidGherkinStepOrder([step(1, 1, 'given', 'scenario'), step(2, 2, 'then', 'scenario')])).toBe(true);
    expect(hasValidGherkinStepOrder([step(1, 1, 'given', 'scenario'), step(2, 1, 'then', 'scenario')])).toBe(false);
    expect(hasValidGherkinStepOrder([step(1, 0, 'given', 'scenario'), step(2, 1, 'then', 'scenario')])).toBe(false);
    expect(hasValidGherkinStepOrder([step(1, 1, 'given', 'scenario'), step(2, 3, 'then', 'scenario')])).toBe(false);
  });

  it('keeps concrete scenarios as the default and validates rectangular examples', () => {
    expect(hasValidGherkinExamples(null)).toBe(true);
    expect(hasValidGherkinExamples({ headers: ['user', 'role'], rows: [['Ada', 'admin']] })).toBe(true);
    expect(hasValidGherkinExamples({ headers: ['user', 'role'], rows: [['Ada']] })).toBe(false);
  });

  it('reports field-level authoring issues while accepting valid connectors and backgrounds', () => {
    const valid = validateGherkinCase([
      { ...step(1, 1, 'given', 'background'), step: 'the app is open' },
      { ...step(2, 2, 'and', 'background'), step: 'the user is signed out' },
      { ...step(3, 3, 'when', 'scenario'), step: 'the user signs in' },
      { ...step(4, 4, 'then', 'scenario'), step: 'the dashboard is shown' },
    ]);
    expect(valid).toEqual({ valid: true, issues: [] });

    const invalid = validateGherkinCase([
      { ...step(1, 1, 'and', 'scenario'), step: 'Given duplicated' },
      { ...step(2, 1, 'when', 'scenario'), step: 'same' },
      { ...step(3, 3, 'then', 'scenario'), step: 'same' },
      { ...step(4, 4, 'and', 'scenario'), step: 'another' },
      { ...step(5, 5, 'when', 'scenario'), step: 'same' },
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'details_keyword',
        'step_order',
        'first_connector',
        'duplicate_step',
        'required_keywords',
      ])
    );
  });

  it('ignores deleted duplicates and validates outline placeholders', () => {
    const result = validateGherkinCase(
      [
        { ...step(1, 1, 'given', 'scenario'), step: 'a <user> exists' },
        { ...step(2, 2, 'when', 'scenario'), step: 'the user signs in' },
        { ...step(3, 3, 'then', 'scenario'), step: 'the user is visible' },
        { ...step(4, 4, 'given', 'scenario'), step: 'a <user> exists', editState: 'deleted' },
      ],
      { headers: ['user'], rows: [['Ada']] }
    );
    expect(result).toEqual({ valid: true, issues: [] });
    expect(
      validateGherkinCase(
        [
          { ...step(1, 1, 'given', 'scenario'), step: 'a <missing> exists' },
          step(2, 2, 'when', 'scenario'),
          step(3, 3, 'then', 'scenario'),
        ],
        { headers: ['user'], rows: [['Ada']] }
      ).issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'example_placeholder', stepIndex: 0 })]));
  });
});
