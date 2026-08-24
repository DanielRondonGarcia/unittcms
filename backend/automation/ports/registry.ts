import type { AutomationExecutor, ExecutorHealth, ExecutorRegistry } from './index.js';

export class NeutralExecutorRegistry implements ExecutorRegistry {
  private readonly executors = new Map<string, AutomationExecutor>();

  register(key: string, executor: AutomationExecutor): void {
    this.executors.set(key, executor);
  }

  async select(key?: string): Promise<AutomationExecutor | undefined> {
    return key ? this.executors.get(key) : this.executors.values().next().value;
  }

  async list(): Promise<Array<{ key: string; health: ExecutorHealth }>> {
    return Promise.all(
      [...this.executors.entries()].map(async ([key, executor]) => ({ key, health: await executor.health() }))
    );
  }
}
