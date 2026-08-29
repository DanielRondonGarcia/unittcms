import { describe, expect, it } from 'vitest';
import {
  automationBatchCaseKey,
  mergeAutomationBatchResults,
  rehydrateAutomationBatchResults,
  tryAcquireAutomationRun,
} from './automationBatchState';
import type { AutomationBatchCase } from '@/types/automation';

const cases: AutomationBatchCase[] = [
  { caseId: 8, runCaseId: 12, title: 'Outline', exampleIndex: 0, exampleValues: ['Ada'] },
  { caseId: 8, runCaseId: 12, title: 'Outline', exampleIndex: 1, exampleValues: ['Grace'] },
];
const singleCase: AutomationBatchCase = { caseId: 9, runCaseId: 13, title: 'Scenario', exampleIndex: null };

describe('automation batch state', () => {
  it('rejects a second batch invocation while the first one owns the run lock', () => {
    const lock = { current: false };
    expect(tryAcquireAutomationRun(lock)).toBe(true);
    expect(tryAcquireAutomationRun(lock)).toBe(false);
    lock.current = false;
    expect(tryAcquireAutomationRun(lock)).toBe(true);
  });

  it('rehydrates an execution discovered after an initially empty history', () => {
    expect(rehydrateAutomationBatchResults(cases, [])).toEqual([]);

    const active = {
      id: 'execution-2',
      runCaseId: 12,
      exampleIndex: 1,
      status: 'running' as const,
      queuedAt: '2026-08-28T12:00:00.000Z',
    };
    expect(rehydrateAutomationBatchResults(cases, [active])).toEqual([{ ...cases[1], execution: active }]);
    expect(automationBatchCaseKey(cases[1])).toBe('12:1');
    expect(
      rehydrateAutomationBatchResults([singleCase], [{ id: 'execution-3', runCaseId: 13, status: 'queued' }])
    ).toEqual([{ ...singleCase, execution: { id: 'execution-3', runCaseId: 13, status: 'queued' } }]);
    expect(automationBatchCaseKey(singleCase)).toBe('13:single');
  });

  it('keeps a newer terminal rerun instead of blocking on an older active execution', () => {
    const active = {
      id: 'execution-old',
      runCaseId: 12,
      exampleIndex: 0,
      status: 'running' as const,
      queuedAt: '2026-08-28T12:00:00.000Z',
    };
    const terminal = {
      id: 'execution-new',
      runCaseId: 12,
      exampleIndex: 0,
      status: 'passed' as const,
      finishedAt: '2026-08-28T12:01:00.000Z',
    };

    expect(rehydrateAutomationBatchResults(cases, [active, terminal])).toEqual([
      { ...cases[0], execution: terminal },
    ]);
    expect(mergeAutomationBatchResults([{ ...cases[0], execution: active }], [{ ...cases[0], execution: terminal }])).toEqual([
      { ...cases[0], execution: terminal },
    ]);
  });
});
