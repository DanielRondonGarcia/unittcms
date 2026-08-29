import { isAutomationActive } from './automationControl';
import type { AutomationBatchCase, AutomationBatchResult, AutomationExecution } from '@/types/automation';

export function tryAcquireAutomationRun(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function automationBatchCaseKey(testCase: AutomationBatchCase): string {
  return `${testCase.runCaseId}:${testCase.exampleIndex ?? 'single'}`;
}

function executionExampleIndex(execution: AutomationExecution): number | null {
  return execution.exampleIndex === undefined || execution.exampleIndex === null ? null : execution.exampleIndex;
}

function executionTime(execution: AutomationExecution): number {
  const value = execution.finishedAt ?? execution.queuedAt ?? execution.createdAt ?? execution.updatedAt;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function preferredExecution(current: AutomationExecution | undefined, next: AutomationExecution): AutomationExecution {
  if (!current) return next;
  const currentActive = isAutomationActive(current.status);
  const nextActive = isAutomationActive(next.status);
  const currentTime = executionTime(current);
  const nextTime = executionTime(next);
  if (currentTime !== nextTime) return nextTime > currentTime ? next : current;
  if (currentActive !== nextActive) return nextActive ? next : current;
  return next;
}

export function rehydrateAutomationBatchResults(
  eligibleCases: AutomationBatchCase[],
  executions: AutomationExecution[]
): AutomationBatchResult[] {
  const latest = new Map<string, AutomationExecution>();
  for (const execution of executions) {
    const testCase = eligibleCases.find(
      (candidate) =>
        Number(execution.runCaseId) === candidate.runCaseId &&
        executionExampleIndex(execution) === (candidate.exampleIndex ?? null)
    );
    if (!testCase) continue;
    const key = automationBatchCaseKey(testCase);
    latest.set(key, preferredExecution(latest.get(key), execution));
  }
  return eligibleCases.flatMap((testCase) => {
    const execution = latest.get(automationBatchCaseKey(testCase));
    return execution ? [{ ...testCase, execution }] : [];
  });
}

export function mergeAutomationBatchResults(
  current: AutomationBatchResult[],
  next: AutomationBatchResult[]
): AutomationBatchResult[] {
  const merged = new Map(current.map((result) => [automationBatchCaseKey(result), result]));
  for (const result of next) {
    const key = automationBatchCaseKey(result);
    const previous = merged.get(key);
    if (!previous || !result.execution || !previous.execution || String(previous.execution.id) === String(result.execution.id)) {
      merged.set(key, result);
      continue;
    }
    merged.set(key, {
      ...result,
      execution: preferredExecution(previous.execution, result.execution),
    });
  }
  return Array.from(merged.values());
}
