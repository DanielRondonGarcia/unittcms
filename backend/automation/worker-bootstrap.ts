import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HerculesAutomationExecutor } from './infrastructure/hercules.js';
import { createExecutionResultSanitizer } from './compatibility/execution-result-safety.js';
import {
  AUTOMATION_HEALTH_TTL_MS,
  BullMqWorkerRuntime,
  closeRedis,
  connectRedis,
  createBullMqQueue,
  createRedisConnection,
  RedisWorkerHealth,
} from './infrastructure/bullmq.js';
import { SequelizeAutomationStore, type AutomationModels } from './infrastructure/sequelize-store.js';
import { loadWorkerLlmConfig, type WorkerLlmConfig } from './infrastructure/llm-config.js';
import { FileArtifactStorage } from './infrastructure/artifacts.js';
import { resolveHerculesVolume } from './compatibility/hercules.js';
import { NeutralExecutorRegistry } from './ports/registry.js';
import type { RunCaseStatusUpdate } from './ports/index.js';
import { BullMqExecutionQueue, ExecutionWorker, WorkerResultUpdater, type WorkerLog } from './worker.js';

export class AutomationWorkerBootstrapError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'AutomationWorkerBootstrapError';
    this.code = code;
  }
}

export type WorkerBootstrapOptions = {
  mode?: string;
  redisUrl?: string;
  artifactRoot?: string;
  workdir?: string;
  workerSecret?: string;
  workerSecretFile?: string;
  llmConfig?: WorkerLlmConfig;
  image?: string;
  workVolume?: string;
  models?: AutomationModels;
  phase0Ready?: boolean;
  concurrency?: number;
  deadlineMs?: number;
  backoffMs?: number;
};

export type AutomationWorkerHandle = {
  worker: ExecutionWorker;
  health: RedisWorkerHealth;
  shutdown(): Promise<void>;
};

const ARTIFACT_DIAGNOSTIC_STAGES = new Set([
  'validation',
  'storage_put',
  'metadata_create',
  'metadata_cleanup',
  'storage_cleanup',
]);
const ARTIFACT_DIAGNOSTIC_CATEGORIES = new Set([
  'database_busy',
  'database_constraint',
  'database_readonly',
  'storage_missing',
  'storage_invalid',
  'unknown',
]);

function logWorkerDiagnostic(event: WorkerLog): void {
  const executionId = event.executionId;
  const attempt = event.attempt;
  const stage = event.stage;
  const errorCategory = event.errorCategory;
  if (
    typeof executionId !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(executionId) ||
    typeof attempt !== 'number' ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    typeof stage !== 'string' ||
    !ARTIFACT_DIAGNOSTIC_STAGES.has(stage) ||
    typeof errorCategory !== 'string' ||
    !ARTIFACT_DIAGNOSTIC_CATEGORIES.has(errorCategory)
  )
    return;
  console.error(JSON.stringify({ executionId, attempt, stage, errorCategory }));
}

function envText(value: string | undefined, code: string): string {
  const result = value?.trim();
  if (!result) throw new AutomationWorkerBootstrapError(code);
  return result;
}

type WorkerSecretFileReader = (filePath: string) => string;

export function loadWorkerSecret(
  environment: Readonly<Record<string, string | undefined>>,
  readSecretFile: WorkerSecretFileReader = (filePath) => readFileSync(filePath, 'utf8')
): string {
  const secretFile = environment.AUTOMATION_WORKER_SECRET_FILE;
  if (secretFile !== undefined) {
    const filePath = secretFile.trim();
    if (!filePath || filePath.includes('\u0000'))
      throw new AutomationWorkerBootstrapError('automation_worker_secret_required');
    try {
      const secret = readSecretFile(filePath).trim();
      if (!secret) throw new AutomationWorkerBootstrapError('automation_worker_secret_required');
      return secret;
    } catch {
      throw new AutomationWorkerBootstrapError('automation_worker_secret_required');
    }
  }
  return envText(environment.AUTOMATION_WORKER_SECRET, 'automation_worker_secret_required');
}

export function loadWorkerHerculesVolume(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  try {
    const value = environment.AUTOMATION_HERCULES_VOLUME;
    return value === undefined ? undefined : resolveHerculesVolume(value);
  } catch {
    throw new AutomationWorkerBootstrapError('automation_hercules_volume_invalid');
  }
}

export async function start(options: WorkerBootstrapOptions = {}): Promise<AutomationWorkerHandle> {
  const mode = options.mode ?? process.env.AUTOMATION_EXECUTION_MODE ?? 'disabled';
  if (mode !== 'real') throw new AutomationWorkerBootstrapError('worker_requires_real_mode');
  const redisUrl = envText(options.redisUrl ?? process.env.AUTOMATION_REDIS_URL, 'automation_redis_url_required');
  const workerSecret = loadWorkerSecret({
    AUTOMATION_WORKER_SECRET_FILE: options.workerSecretFile ?? process.env.AUTOMATION_WORKER_SECRET_FILE,
    AUTOMATION_WORKER_SECRET: options.workerSecret ?? process.env.AUTOMATION_WORKER_SECRET,
  });
  const llmConfig = options.llmConfig ?? loadWorkerLlmConfig(process.env, { required: true });
  if (!llmConfig) throw new AutomationWorkerBootstrapError('llm_config_required');
  const resultSanitizer = createExecutionResultSanitizer(llmConfig.apiKey ? [llmConfig.apiKey] : []);
  const workVolume = loadWorkerHerculesVolume({
    AUTOMATION_HERCULES_VOLUME: options.workVolume ?? process.env.AUTOMATION_HERCULES_VOLUME,
  });
  const artifactRoot = options.artifactRoot ?? process.env.AUTOMATION_ARTIFACT_ROOT;
  const workdir =
    options.workdir ?? process.env.AUTOMATION_HERCULES_WORKDIR ?? join(artifactRoot ?? process.cwd(), 'hercules-work');
  const phase0Ready = options.phase0Ready ?? process.env.AUTOMATION_PHASE0_READY === 'true';
  const models = options.models ?? ((await import('../models/index.js')).default as unknown as AutomationModels);

  const connection = createRedisConnection(redisUrl, { worker: true });
  const publisher = createRedisConnection(redisUrl);
  const subscriber = createRedisConnection(redisUrl, { worker: true });
  try {
    await Promise.all([connectRedis(connection), connectRedis(publisher), connectRedis(subscriber)]);
    const queueAdapter = createBullMqQueue(connection, {
      publisher,
      closeConnection: false,
      closePublisher: true,
    });
    const queue = new BullMqExecutionQueue(queueAdapter, {
      attempts: 2,
      backoffMs: options.backoffMs,
      concurrency: options.concurrency,
      deadlineMs: options.deadlineMs,
    });
    const store = new SequelizeAutomationStore(models);
    const artifactStorage = new FileArtifactStorage({
      rootDir: artifactRoot,
      secretValues: llmConfig.apiKey ? [llmConfig.apiKey] : [],
    });
    const registry = new NeutralExecutorRegistry();
    registry.register(
      'hercules',
      new HerculesAutomationExecutor({
        workdir,
        llmConfig,
        image: options.image ?? process.env.AUTOMATION_HERCULES_IMAGE,
        workVolume,
      })
    );
    const runCaseStatusUpdater = async (input: RunCaseStatusUpdate) => {
      await store.updateRunCaseStatus(input);
    };
    const executionWorker = new ExecutionWorker(
      registry,
      new WorkerResultUpdater(store, workerSecret, runCaseStatusUpdater, resultSanitizer),
      {
        secret: workerSecret,
        queue,
        phase0Ready,
        concurrency: options.concurrency,
        deadlineMs: options.deadlineMs,
        backoffMs: options.backoffMs,
        artifactStorage,
        artifactStore: store,
        resultSanitizer,
        hooks: { log: logWorkerDiagnostic },
      }
    );
    const runtime = new BullMqWorkerRuntime(connection, subscriber);
    const health = new RedisWorkerHealth(connection);
    await executionWorker.start(runtime);
    let closed = false;
    const publishHeartbeat = async () => {
      try {
        await health.publish(await executionWorker.health(), AUTOMATION_HEALTH_TTL_MS);
      } catch {
        // Redis loss is represented by an expired heartbeat and a not-ready API health response.
      }
    };
    await publishHeartbeat();
    const heartbeatTimer = setInterval(() => void publishHeartbeat(), Math.floor(AUTOMATION_HEALTH_TTL_MS / 3));
    heartbeatTimer.unref?.();
    const signalHandler = () => void shutdown();
    process.once('SIGTERM', signalHandler);
    process.once('SIGINT', signalHandler);
    async function shutdown(): Promise<void> {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatTimer);
      process.off('SIGTERM', signalHandler);
      process.off('SIGINT', signalHandler);
      await health
        .publish({ ready: false, status: 'worker_shutdown', heartbeatAt: '', phase0Ready: false, executors: [] })
        .catch(() => undefined);
      await executionWorker.shutdown();
    }
    return { worker: executionWorker, health, shutdown };
  } catch (error) {
    await Promise.all([closeRedis(connection), closeRedis(publisher), closeRedis(subscriber)]);
    throw error;
  }
}
