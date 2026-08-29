import { describe, expect, it } from 'vitest';
import {
  composeCanonicalSnapshot,
  mapExecutorResult,
  presentExampleSnapshot,
  presentSnapshot,
  prepareRetry,
  transitionExecution,
} from './index.js';

const source = {
  id: 7,
  title: 'Login',
  automationVersion: 3,
  Steps: [
    { id: 2, step: 'the login form is visible', caseSteps: { stepNo: 2, keyword: 'when' } },
    { id: 1, step: 'the visitor is signed out', caseSteps: { stepNo: 1, keyword: 'given' } },
    { id: 3, step: 'the dashboard is shown', caseSteps: { stepNo: 3, keyword: 'then' } },
  ],
};

describe('automation domain', () => {
  it('composes an ordered immutable English snapshot with a stable hash', () => {
    const result = composeCanonicalSnapshot(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.feature).toContain('Given the visitor is signed out');
    expect(result.snapshot.feature.indexOf('Given')).toBeLessThan(result.snapshot.feature.indexOf('When'));
    expect(result.snapshot.feature).not.toContain('Background:');
    expect(result.snapshot.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'given', section: 'scenario' })])
    );
    expect(result.snapshot.version).toBe(3);
    expect(result.snapshot.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(() => ((result.snapshot as unknown as { hash: string }).hash = 'changed')).toThrow();
  });

  it('returns field errors and never accepts localized or malformed source', () => {
    const result = composeCanonicalSnapshot({
      id: 7,
      title: '',
      Steps: [{ step: 'Dado algo', caseSteps: { stepNo: 1, keyword: 'dado' } }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title' }),
        expect.objectContaining({ field: 'Steps[0].caseSteps.keyword' }),
      ])
    );
  });

  it('translates only presentation output and preserves the canonical snapshot', () => {
    const result = composeCanonicalSnapshot(source);
    if (!result.ok) throw new Error('expected valid source');

    const translated = presentSnapshot(result.snapshot, {
      given: 'Dado',
      when: 'Cuando',
      then: 'Entonces',
      and: 'Y',
      but: 'Pero',
    });
    expect(translated).toContain('Dado the visitor is signed out');
    expect(result.snapshot.feature).toContain('Given the visitor is signed out');
    expect(translated).not.toBe(result.snapshot.feature);
  });

  it('changes the immutable identity when the source version changes', () => {
    const first = composeCanonicalSnapshot(source);
    const second = composeCanonicalSnapshot({ ...source, automationVersion: 4 });

    if (!first.ok || !second.ok) throw new Error('expected valid sources');
    expect(second.snapshot.version).toBe(4);
    expect(second.snapshot.hash).not.toBe(first.snapshot.hash);
  });

  it('preserves Background rows and renders them before the Scenario block', () => {
    const result = composeCanonicalSnapshot({
      ...source,
      Steps: [
        { id: 3, step: 'the dashboard is shown', caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' } },
        { id: 1, step: 'the visitor is signed out', caseSteps: { stepNo: 1, keyword: 'given', section: 'background' } },
        { id: 2, step: 'the login form is visible', caseSteps: { stepNo: 2, keyword: 'when' } },
      ],
    });

    if (!result.ok) throw new Error('expected valid source');
    expect(result.snapshot.feature).toContain('  Scenario: Login');
    expect(result.snapshot.feature).toContain('  Background:\n    Given the visitor is signed out');
    expect(result.snapshot.feature.indexOf('Background:')).toBeLessThan(result.snapshot.feature.indexOf('Scenario:'));
    expect(result.snapshot.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: 'given', section: 'background' })])
    );
    expect(result.snapshot.steps).toEqual(expect.arrayContaining([expect.objectContaining({ keyword: 'given' })]));
    expect(
      presentSnapshot(result.snapshot, {
        given: 'Dado',
        when: 'Cuando',
        then: 'Entonces',
        and: 'Y',
        but: 'Pero',
        background: 'Antecedentes',
        scenario: 'Escenario',
      })
    ).toContain('Antecedentes:');
  });

  it('renders a valid Scenario Outline and escapes table content', () => {
    const result = composeCanonicalSnapshot({
      ...source,
      gherkinExamples: {
        headers: ['user|name', 'note'],
        rows: [['Ada', 'line one\nline two | ok']],
      },
      Steps: [
        { id: 1, step: 'a user exists', caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' } },
        { id: 2, step: 'the user signs in', caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' } },
        { id: 3, step: 'the dashboard is shown', caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' } },
      ],
    });

    if (!result.ok) throw new Error('expected valid source');
    expect(result.snapshot.feature).toContain('Scenario Outline: Login');
    expect(result.snapshot.feature).toContain(
      '  Examples:\n    | user\\|name | note |\n    | Ada | line one\\nline two \\| ok |'
    );
    expect(result.snapshot.examples).toEqual({
      headers: ['user|name', 'note'],
      rows: [['Ada', 'line one\nline two | ok']],
    });
  });

  it('materializes one row as an independent Scenario without leaking the Examples table', () => {
    const result = composeCanonicalSnapshot({
      ...source,
      gherkinExamples: {
        headers: [' user ', ' role '],
        rows: [
          ['Ada', 'admin'],
          ['Lin', 'viewer'],
        ],
      },
      Steps: [
        { id: 1, step: '< user > exists', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 2, step: '<user> has the < role > role', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 3, step: 'the dashboard is shown', caseSteps: { stepNo: 3, keyword: 'then' } },
      ],
    });

    if (!result.ok) throw new Error('expected valid source');
    expect(result.snapshot.examples).toEqual({
      headers: ['user', 'role'],
      rows: [
        ['Ada', 'admin'],
        ['Lin', 'viewer'],
      ],
    });
    expect(presentExampleSnapshot(result.snapshot, 1)).toBe(
      [
        'Feature: Login',
        '',
        '  Scenario: Login',
        '    Given Lin exists',
        '    When Lin has the viewer role',
        '    Then the dashboard is shown',
        '',
      ].join('\n')
    );
    expect(() => presentExampleSnapshot(result.snapshot, -1)).toThrow('example_index_invalid');
    expect(() => presentExampleSnapshot(result.snapshot, 2)).toThrow('example_index_invalid');
  });

  it('rejects empty and duplicate example headers after trimming', () => {
    const empty = composeCanonicalSnapshot({
      ...source,
      gherkinExamples: { headers: [' user ', '   '], rows: [['Ada', 'admin']] },
    });
    const duplicate = composeCanonicalSnapshot({
      ...source,
      gherkinExamples: { headers: [' user ', 'user'], rows: [['Ada', 'admin']] },
    });

    expect(empty.ok).toBe(false);
    expect(duplicate.ok).toBe(false);
    if (!empty.ok)
      expect(empty.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'gherkinExamples.headers' })])
      );
    if (!duplicate.ok)
      expect(duplicate.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'gherkinExamples.headers' })])
      );
  });

  it('rejects unknown sections without producing a snapshot', () => {
    const result = composeCanonicalSnapshot({
      ...source,
      Steps: source.Steps?.map((step, index) => ({
        ...step,
        caseSteps: { ...step.caseSteps, section: index === 0 ? 'outline' : 'scenario' },
      })),
    });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'Steps[0].caseSteps.section' })])
      );
  });

  it('continues rejecting duplicate and non-positive step orders', () => {
    const duplicate = composeCanonicalSnapshot({
      ...source,
      Steps: source.Steps?.map((step, index) => ({
        ...step,
        caseSteps: { ...step.caseSteps, stepNo: index === 2 ? 2 : step.caseSteps.stepNo },
      })),
    });
    const nonPositive = composeCanonicalSnapshot({
      ...source,
      Steps: source.Steps?.map((step, index) => ({
        ...step,
        caseSteps: { ...step.caseSteps, stepNo: index === 0 ? 0 : step.caseSteps.stepNo },
      })),
    });

    expect(duplicate.ok).toBe(false);
    expect(nonPositive.ok).toBe(false);
    if (!duplicate.ok)
      expect(duplicate.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'Steps[2].caseSteps.stepNo' })])
      );
    if (!nonPositive.ok)
      expect(nonPositive.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'Steps[0].caseSteps.stepNo' })])
      );
  });

  it('enforces lifecycle transitions, timestamps, attempts, and result semantics', () => {
    const queued = {
      id: 'e1',
      status: 'queued' as const,
      attempt: 1,
      queuedAt: '2026-01-01T00:00:00.000Z',
      startedAt: undefined,
      finishedAt: undefined,
      durationMs: undefined,
      errorKind: undefined,
    };
    const running = transitionExecution(queued, 'running', new Date('2026-01-01T00:00:01.000Z'));
    const failed = transitionExecution(running, 'failed', new Date('2026-01-01T00:00:03.000Z'));

    expect(running.startedAt).toBe('2026-01-01T00:00:01.000Z');
    expect(failed.finishedAt).toBe('2026-01-01T00:00:03.000Z');
    expect(failed.durationMs).toBe(2000);
    const technical = transitionExecution(running, 'error', new Date('2026-01-01T00:00:03.000Z'));
    expect(prepareRetry({ ...technical, errorKind: 'technical' })).toMatchObject({ status: 'queued', attempt: 2 });
    expect(mapExecutorResult({ outcome: 'functional_failure', summary: 'assertion failed' })).toMatchObject({
      status: 'failed',
    });
    expect(mapExecutorResult({ outcome: 'timeout' })).toMatchObject({ status: 'error' });
    expect(mapExecutorResult({ outcome: 'cancelled' })).toMatchObject({ status: 'cancelled' });
    expect(() => transitionExecution(running, 'queued', new Date())).toThrow(/invalid transition/);
  });
});
