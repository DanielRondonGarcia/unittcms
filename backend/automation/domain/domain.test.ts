import { describe, expect, it } from 'vitest';
import {
  composeCanonicalSnapshot,
  mapExecutorResult,
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

    const translated = presentSnapshot(result.snapshot, { given: 'Dado', when: 'Cuando', then: 'Entonces' });
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
