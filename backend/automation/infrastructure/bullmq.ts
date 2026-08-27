import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import Redis from 'ioredis';
import type { AutomationExecutor, AutomationWorker, ExecutorHealth, ExecutorRegistry, ExecutionJob, WorkerHealth } from '../ports/index.js';
import type { QueueAdapter, WorkerJob, WorkerRuntime } from '../worker.js';

export const AUTOMATION_QUEUE_NAME = 'automation-execution';
export const AUTOMATION_CANCEL_CHANNEL = 'unittcms:automation:cancel';
export const AUTOMATION_HEALTH_KEY = 'unittcms:automation:worker:health';
export const AUTOMATION_HEALTH_TTL_MS = 15_000;

export type RedisConnectionOptions = {
  worker?: boolean;
};

export function createRedisConnection(redisUrl: string, options: RedisConnectionOptions = {}): Redis {
  const connection = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5_000,
    maxRetriesPerRequest: options.worker ? null : 1,
    retryStrategy: (attempt) => Math.min(5_000, Math.max(100, attempt * 250)),
  });
  return connection;
}

export async function connectRedis(connection: Redis): Promise<void> {
  if (connection.status === 'wait') await connection.connect();
  await connection.ping();
}

function workerJob(job: Job<ExecutionJob>): WorkerJob {
  return { ...job.data, jobId: String(job.id) };
}

export type BullMqQueueAdapterOptions = {
  publisher?: Redis;
  closeConnection?: boolean;
  closePublisher?: boolean;
};

export class BullMqQueueAdapter implements QueueAdapter {
  private readonly queue: Queue<ExecutionJob>;
  private readonly connection: Redis;
  private readonly options: BullMqQueueAdapterOptions;

  constructor(
    queue: Queue<ExecutionJob>,
    connection: Redis,
    options: BullMqQueueAdapterOptions = {}
  ) {
    this.queue = queue;
    this.connection = connection;
    this.options = options;
  }

  async add(
    name: string,
    job: ExecutionJob,
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: 'exponential'; delay: number };
      removeOnComplete: boolean;
      removeOnFail: boolean;
    }
  ): Promise<{ id?: string }> {
    const added = await this.queue.add(name, job, options);
    return { id: added.id ? String(added.id) : undefined };
  }

  async remove(executionId: string): Promise<void> {
    let failure: unknown;
    try {
      const jobs = await this.queue.getJobs(['waiting', 'delayed', 'prioritized', 'active'], 0, -1, true);
      await Promise.allSettled(
        jobs
          .filter((job) => String(job.data.executionId) === executionId)
          .map(async (job) => job.remove().catch(() => undefined))
      );
    } catch (error) {
      failure = error;
    } finally {
      const publisher = this.options.publisher;
      if (publisher) await publisher.publish(AUTOMATION_CANCEL_CHANNEL, executionId);
    }
    if (failure) throw failure;
  }

  async recoverStalled(): Promise<WorkerJob[]> {
    const jobs = await this.queue.getJobs(['waiting'], 0, -1, true);
    return jobs.map(workerJob);
  }

  async isReady(): Promise<boolean> {
    try {
      await this.connection.ping();
      return this.connection.status === 'ready';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    let failure: unknown;
    try {
      await this.queue.close();
    } catch (error) {
      failure = error;
    } finally {
      const publisher = this.options.publisher;
      if (publisher && this.options.closePublisher !== false && publisher !== this.connection)
        await publisher.quit().catch(() => undefined);
      if (this.options.closeConnection !== false) await this.connection.quit().catch(() => undefined);
    }
    if (failure) throw failure;
  }
}

export function createBullMqQueue(
  connection: Redis,
  options: { queueName?: string; publisher?: Redis; closeConnection?: boolean; closePublisher?: boolean } = {}
): BullMqQueueAdapter {
  const queue = new Queue<ExecutionJob>(options.queueName ?? AUTOMATION_QUEUE_NAME, { connection });
  return new BullMqQueueAdapter(queue, connection, options);
}

export class BullMqWorkerRuntime implements WorkerRuntime {
  private readonly connection: Redis;
  private readonly subscriber: Redis;
  private readonly queueName: string;
  private worker?: Worker<ExecutionJob>;
  private cancelHandler?: (executionId: string) => Promise<unknown>;
  private readonly onCancelMessage = (_channel: string, message: string) => {
    if (this.cancelHandler) void this.cancelHandler(message).catch(() => undefined);
  };

  constructor(
    connection: Redis,
    subscriber: Redis,
    queueName = AUTOMATION_QUEUE_NAME
  ) {
    this.connection = connection;
    this.subscriber = subscriber;
    this.queueName = queueName;
  }

  onCancel(handler: (executionId: string) => Promise<unknown>): void {
    this.cancelHandler = handler;
  }

  async consume(handler: (job: WorkerJob) => Promise<unknown>, options: { concurrency: number }): Promise<void> {
    this.worker = new Worker<ExecutionJob>(
      this.queueName,
      async (job) => handler(workerJob(job)),
      {
        connection: this.connection,
        concurrency: options.concurrency,
        maxStalledCount: 1,
        stalledInterval: 30_000,
      }
    );
    this.worker.on('error', () => undefined);
    this.subscriber.on('message', this.onCancelMessage);
    await this.subscriber.subscribe(AUTOMATION_CANCEL_CHANNEL);
    await this.worker.waitUntilReady();
  }

  async close(): Promise<void> {
    const worker = this.worker;
    if (worker) await worker.close().catch(() => undefined);
    this.subscriber.off('message', this.onCancelMessage);
    await this.subscriber.unsubscribe(AUTOMATION_CANCEL_CHANNEL).catch(() => undefined);
    await this.subscriber.quit().catch(() => undefined);
    await this.connection.quit().catch(() => undefined);
  }
}

function unavailableHealth(status = 'worker_unavailable'): WorkerHealth {
  return { ready: false, status, heartbeatAt: '', phase0Ready: false, executors: [] };
}

function parseHealth(value: string | null): WorkerHealth {
  if (!value) return unavailableHealth();
  try {
    const parsed = JSON.parse(value) as Partial<WorkerHealth>;
    if (typeof parsed.heartbeatAt !== 'string' || typeof parsed.phase0Ready !== 'boolean' || !Array.isArray(parsed.executors))
      return unavailableHealth('worker_health_invalid');
    return {
      ready: parsed.ready === true,
      status: typeof parsed.status === 'string' ? parsed.status : 'worker_not_ready',
      heartbeatAt: parsed.heartbeatAt,
      phase0Ready: parsed.phase0Ready,
      executors: parsed.executors,
    };
  } catch {
    return unavailableHealth('worker_health_invalid');
  }
}

export class RedisWorkerHealth implements AutomationWorker {
  private readonly connection: Redis;
  private readonly key: string;

  constructor(connection: Redis, key = AUTOMATION_HEALTH_KEY) {
    this.connection = connection;
    this.key = key;
  }

  async publish(value: WorkerHealth, ttlMs = AUTOMATION_HEALTH_TTL_MS): Promise<void> {
    const safe = {
      ready: value.ready === true,
      status: String(value.status),
      heartbeatAt: String(value.heartbeatAt),
      phase0Ready: value.phase0Ready === true,
      executors: Array.isArray(value.executors) ? value.executors : [],
    };
    await this.connection.set(this.key, JSON.stringify(safe), 'PX', ttlMs);
  }

  async health(): Promise<WorkerHealth> {
    try {
      return parseHealth(await this.connection.get(this.key));
    } catch {
      return unavailableHealth('worker_redis_unavailable');
    }
  }
}

export class RedisExecutorRegistry implements ExecutorRegistry {
  private readonly remoteHealth: RedisWorkerHealth;

  constructor(remoteHealth: RedisWorkerHealth) {
    this.remoteHealth = remoteHealth;
  }

  register(_key: string, _executor: AutomationExecutor): void {
    // The API process never owns worker executors or their credentials.
  }

  async select(_key?: string): Promise<AutomationExecutor | undefined> {
    return undefined;
  }

  async list(): Promise<Array<{ key: string; health: ExecutorHealth }>> {
    const health = await this.remoteHealth.health();
    return health.executors.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as { key?: unknown; health?: Partial<ExecutorHealth> };
      const key = String(item.key ?? '');
      if (!key) return [];
      return [
        {
          key,
          health: {
            key,
            ready: item.health?.ready === true && health.ready,
            status: typeof item.health?.status === 'string' ? item.health.status : health.status,
          },
        },
      ];
    });
  }
}

export async function closeRedis(connection: Redis): Promise<void> {
  await connection.quit().catch(() => undefined);
}
