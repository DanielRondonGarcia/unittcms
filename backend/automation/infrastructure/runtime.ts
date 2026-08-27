import { createAutomationApplication, type AutomationApplication } from '../application/service.js';
import type { EnvironmentResolver as EnvironmentResolverPort, ExecutorRegistry, ResolvedEnvironment } from '../ports/index.js';
import { EnvironmentResolver } from './environment.js';
import { FileArtifactStorage } from './artifacts.js';
import {
  closeRedis,
  connectRedis,
  createBullMqQueue,
  createRedisConnection,
  RedisExecutorRegistry,
  RedisWorkerHealth,
} from './bullmq.js';
import { SequelizeAutomationStore, type AutomationModels } from './sequelize-store.js';
import { BullMqExecutionQueue } from '../worker.js';

export type RealAutomationRuntime = {
  application: AutomationApplication;
  close(): Promise<void>;
};

export type RealAutomationRuntimeOptions = {
  redisUrl: string;
  artifactRoot?: string;
  models?: AutomationModels;
};

export async function createRealAutomationRuntime(options: RealAutomationRuntimeOptions): Promise<RealAutomationRuntime> {
  const redisUrl = options.redisUrl.trim();
  if (!redisUrl) throw new Error('automation_redis_url_required');
  const connection = createRedisConnection(redisUrl);
  try {
    await connectRedis(connection);
    const queue = createBullMqQueue(connection, { publisher: connection, closeConnection: true });
    const queueBoundary = new BullMqExecutionQueue(queue);
    const models = options.models ?? ((await import('../../models/index.js')).default as unknown as AutomationModels);
    const store = new SequelizeAutomationStore(models);
    const environmentResolver: EnvironmentResolverPort = new EnvironmentResolver(
      async (environmentId) => (await store.findEnvironment?.(environmentId)) as ResolvedEnvironment | null
    );
    const remoteHealth = new RedisWorkerHealth(connection);
    const registry: ExecutorRegistry = new RedisExecutorRegistry(remoteHealth);
    const artifactStorage = new FileArtifactStorage({ rootDir: options.artifactRoot });
    const application = createAutomationApplication({
      store,
      queue: queueBoundary,
      worker: remoteHealth,
      registry,
      environmentResolver,
      artifactStorage,
    });
    return {
      application,
      close: async () => {
        await queueBoundary.shutdown();
      },
    };
  } catch (error) {
    await closeRedis(connection);
    throw error;
  }
}
