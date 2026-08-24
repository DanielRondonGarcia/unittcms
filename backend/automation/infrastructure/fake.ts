import type { AutomationExecutor, ExecutorHealth, ExecutorResult, ExecutorInput } from '../ports/index.js';

export class FakeAutomationExecutor implements AutomationExecutor {
  readonly executions: ExecutorInput[] = [];
  readonly cancelled = new Set<string>();

  constructor(private readonly result: ExecutorResult = { outcome: 'passed', summary: 'fake execution' }) {}

  async execute(input: ExecutorInput): Promise<ExecutorResult> {
    this.executions.push(input);
    return this.result;
  }

  async cancel(executionId: string): Promise<void> {
    this.cancelled.add(executionId);
  }

  async health(): Promise<ExecutorHealth> {
    return { key: 'fake', ready: true, status: 'test-only' };
  }
}
