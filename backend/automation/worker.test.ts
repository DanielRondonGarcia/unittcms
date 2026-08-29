import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NeutralExecutorRegistry } from './ports/registry.js';
import type {
  AutomationStore,
  ExecutorInvocation,
  ExecutorResult,
  RunCaseStatusUpdate,
  RunCaseStatusUpdater,
  StoredExecution,
} from './ports/index.js';
import {
  BullMqExecutionQueue,
  ExecutionWorker,
  WorkerResultUpdater,
  installWorkerShutdown,
  jobIdFor,
  shouldRetry,
  signWorkerEvent,
} from './worker.js';

const job = { executionId: 'e1', attempt: 1, snapshot: 'Feature: Login' };
const initial: StoredExecution = {
  id: 'e1',
  projectId: 10,
  caseId: 7,
  runCaseId: 3,
  status: 'queued',
  attempt: 1,
  correlationId: 'corr-1',
};

function makeStore(value: StoredExecution = initial) {
  let current = { ...value } as StoredExecution;
  const updateExecution = vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    current = { ...current, ...patch };
    return current;
  });
  const store = {
    findExecution: vi.fn(async () => current),
    updateExecution,
  } as unknown as Pick<AutomationStore, 'findExecution' | 'updateExecution'>;
  return { store, updateExecution, read: () => current };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'result' as const,
    executionId: 'e1',
    attempt: 1,
    correlationId: 'corr-1',
    jobId: jobIdFor(job),
    outcome: 'passed' as const,
    ...overrides,
  };
}

function makeRunCaseStatus() {
  let current = {
    id: 3,
    projectId: 10,
    status: 0,
    history: [{ status: 3, source: 'manual' }],
  };
  const update: RunCaseStatusUpdater = vi.fn(async (change: RunCaseStatusUpdate) => {
    if (change.projectId !== current.projectId || change.runCaseId !== current.id) throw new Error('wrong project');
    current = { ...current, status: change.status };
  });
  return { update, read: () => current };
}

describe('automation queue and worker boundary', () => {
  it('uses deterministic job identity, bounded retry/backoff, and reports Redis loss', async () => {
    const adapter = {
      add: vi.fn(async (_name: string, _data: unknown, options: { jobId: string }) => ({ id: options.jobId })),
      remove: vi.fn(async () => undefined),
      recoverStalled: vi.fn(async () => [job]),
      isReady: vi.fn(async () => true),
      close: vi.fn(async () => undefined),
    };
    const queue = new BullMqExecutionQueue(adapter, { attempts: 99, backoffMs: 10 });

    await expect(queue.enqueue(job)).resolves.toBe('e1:attempt:1');
    expect(adapter.add).toHaveBeenCalledWith(
      'automation-execution',
      job,
      expect.objectContaining({ jobId: 'e1:attempt:1', attempts: 2, backoff: { type: 'exponential', delay: 10 } })
    );
    await expect(queue.reconcile()).resolves.toMatchObject({ ready: true, jobs: [job] });
    adapter.isReady.mockResolvedValue(false);
    await expect(queue.reconcile()).resolves.toMatchObject({ ready: false, errorCategory: 'redis_connection' });
  });

  it('authenticates callbacks, binds them to attempt/correlation, and makes replay idempotent', async () => {
    const { store } = makeStore();
    const updater = new WorkerResultUpdater(store, 'server-secret');
    const running = { ...event(), phase: 'running' as const };

    await updater.record(signWorkerEvent(running, 'server-secret'));
    await expect(updater.record(signWorkerEvent(running, 'server-secret'))).resolves.toMatchObject({
      status: 'running',
    });
    expect(store.updateExecution).toHaveBeenCalledOnce();
    await expect(
      updater.record({ ...signWorkerEvent(event(), 'server-secret'), signature: 'invalid' })
    ).rejects.toMatchObject({ code: 'invalid_worker_signature' });
    await expect(
      updater.record(signWorkerEvent(event({ correlationId: 'other-correlation' }), 'server-secret'))
    ).rejects.toMatchObject({ code: 'worker_event_mismatch' });
    await expect(
      updater.record(signWorkerEvent(event({ attempt: 2, jobId: 'e1:attempt:2' }), 'server-secret'))
    ).rejects.toMatchObject({ code: 'worker_event_mismatch' });
  });

  it('preserves failed attempt history only for explicitly recoverable technical results', async () => {
    const retryStore = makeStore({ ...initial, status: 'running' });
    const retry = new WorkerResultUpdater(retryStore.store, 'server-secret');
    const retried = await retry.record(
      signWorkerEvent(
        event({ outcome: 'technical_error', recoverable: true, errorCategory: 'technical' }),
        'server-secret'
      )
    );
    expect(retried).toMatchObject({ status: 'queued', attempt: 2 });
    expect(retried.attemptHistory).toEqual([expect.objectContaining({ status: 'error', attempt: 1 })]);

    const functionalStore = makeStore({ ...initial, status: 'running' });
    const functional = new WorkerResultUpdater(functionalStore.store, 'server-secret');
    const failed = await functional.record(
      signWorkerEvent(
        event({ outcome: 'functional_failure', recoverable: true, status: 'passed', runCaseStatus: 1 }),
        'server-secret'
      )
    );
    expect(failed).toMatchObject({ status: 'failed', attempt: 1 });
    expect(failed).not.toHaveProperty('runCaseStatus');
    expect(shouldRetry({ outcome: 'technical_error', recoverable: false })).toBe(false);
  });

  it.each([
    [{ outcome: 'technical_error', recoverable: true }, true],
    [{ outcome: 'timeout', recoverable: true }, true],
    [{ outcome: 'abandoned', recoverable: true }, true],
    [{ outcome: 'functional_failure', recoverable: true }, false],
    [{ outcome: 'cancelled', recoverable: true }, false],
    [{ outcome: 'technical_error', recoverable: true, errorCategory: 'invalid_source' }, false],
  ])('retries only recoverable technical failures: %o', (result, expected) => {
    expect(shouldRetry(result as ExecutorResult & { errorCategory?: string })).toBe(expected);
  });

  it('fails closed without an executor and never accepts client-controlled RunCase status', async () => {
    const data = makeStore({ ...initial, status: 'running' });
    const worker = new ExecutionWorker(
      new NeutralExecutorRegistry(),
      new WorkerResultUpdater(data.store, 'server-secret'),
      {
        secret: 'server-secret',
        phase0Ready: false,
      }
    );

    const result = await worker.process(job);
    expect(result).toMatchObject({ status: 'error' });
    const patch = data.updateExecution.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('runCaseStatus');
    expect(patch).not.toHaveProperty('statusApproval');
  });

  it('cancels timed-out work and records cancelled work without retrying it', async () => {
    let finish!: (result: ExecutorResult) => void;
    const executor = {
      execute: vi.fn(() => new Promise<ExecutorResult>((resolve) => (finish = resolve))),
      cancel: vi.fn(async () => finish({ outcome: 'cancelled' })),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('injected', executor);
    const data = makeStore();
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      deadlineMs: 1_000,
      phase0Ready: true,
    });
    const running = worker.process({ ...job, executorKey: 'injected' });
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalled(), { timeout: 100 });
    await worker.cancel('e1');
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(executor.cancel).toHaveBeenCalledWith('e1');
    expect(shouldRetry({ outcome: 'cancelled', recoverable: true })).toBe(false);
  });

  it('transitions an expired deadline to error and asks the executor to cancel', async () => {
    const executor = {
      execute: vi.fn(() => new Promise<ExecutorResult>(() => undefined)),
      cancel: vi.fn(async () => undefined),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('slow', executor);
    const data = makeStore();
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      deadlineMs: 5,
      phase0Ready: true,
    });

    await expect(worker.process({ ...job, executorKey: 'slow' })).resolves.toMatchObject({ status: 'error' });
    expect(executor.cancel).toHaveBeenCalledWith('e1');
  });

  it('exposes readiness, stalled recovery, and signal-safe shutdown hooks', async () => {
    const adapter = {
      add: vi.fn(async () => ({ id: 'e1:attempt:1' })),
      remove: vi.fn(async () => undefined),
      recoverStalled: vi.fn(async () => [job]),
      isReady: vi.fn(async () => true),
      close: vi.fn(async () => undefined),
    };
    const queue = new BullMqExecutionQueue(adapter);
    const data = makeStore();
    const worker = new ExecutionWorker(
      new NeutralExecutorRegistry(),
      new WorkerResultUpdater(data.store, 'server-secret'),
      {
        secret: 'server-secret',
        queue,
        phase0Ready: true,
      }
    );
    await expect(worker.health()).resolves.toMatchObject({ ready: false, status: 'not_ready' });
    const signals = { once: vi.fn(), off: vi.fn() };
    const stop = installWorkerShutdown(worker, signals);
    const shutdown = signals.once.mock.calls[0][1] as () => Promise<void>;
    await shutdown();
    stop();
    expect(adapter.close).toHaveBeenCalledOnce();
    expect(signals.off).toHaveBeenCalledTimes(2);
  });

  it('requires a configured queue and a live worker heartbeat before reporting ready', async () => {
    const executor = {
      execute: vi.fn(async () => ({ outcome: 'passed' as const })),
      cancel: vi.fn(async () => undefined),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('injected', executor);
    const data = makeStore();
    const noQueueWorker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      phase0Ready: true,
    });
    await expect(noQueueWorker.health()).resolves.toMatchObject({ ready: false, status: 'not_ready' });

    const adapter = {
      add: vi.fn(async () => ({ id: 'e1:attempt:1' })),
      remove: vi.fn(async () => undefined),
      recoverStalled: vi.fn(async () => []),
      isReady: vi.fn(async () => true),
      close: vi.fn(async () => undefined),
    };
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      queue: new BullMqExecutionQueue(adapter),
      phase0Ready: true,
    });
    await expect(worker.health()).resolves.toMatchObject({ ready: false, status: 'not_ready' });
    await worker.start({ consume: vi.fn(async () => undefined), close: vi.fn(async () => undefined) });
    await expect(worker.health()).resolves.toMatchObject({
      ready: true,
      status: 'ready',
      heartbeatAt: expect.any(String),
    });
    await worker.shutdown();
  });

  it('does not consume jobs or query executors while Phase 0 is disabled', async () => {
    const executor = {
      execute: vi.fn(async () => ({ outcome: 'passed' as const })),
      cancel: vi.fn(async () => undefined),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('injected', executor);
    const data = makeStore();
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      phase0Ready: false,
    });
    const runtime = { consume: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };

    await worker.start(runtime);
    await expect(worker.health()).resolves.toMatchObject({
      ready: false,
      status: 'phase0_not_ready',
      phase0Ready: false,
      executors: [],
    });
    expect(runtime.consume).not.toHaveBeenCalled();
    expect(executor.health).not.toHaveBeenCalled();
    await worker.shutdown();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['passed', 'passed', 1],
    ['functional_failure', 'failed', 2],
    ['evidence_error', 'error', 2],
  ] as const)('maps only terminal %s to the linked RunCase', async (outcome, status, runCaseStatus) => {
    const data = makeStore({
      ...initial,
      status: 'running',
      attemptHistory: [{ attempt: 0, status: 'failed', source: 'manual' }],
    });
    const runCase = makeRunCaseStatus();
    const updater = new WorkerResultUpdater(data.store, 'server-secret', runCase.update);
    const signed = signWorkerEvent(
      event({ outcome, ...(outcome === 'evidence_error' ? { outcome: 'technical_error', errorKind: 'evidence' } : {}) }),
      'server-secret'
    );

    const result = await updater.record(signed);

    expect(result).toMatchObject({ status, runCaseId: 3, caseId: 7 });
    expect(result.attemptHistory).toEqual([
      { attempt: 0, status: 'failed', source: 'manual' },
      expect.objectContaining({ attempt: 1, status }),
    ]);
    expect(runCase.read()).toEqual({
      id: 3,
      projectId: 10,
      status: runCaseStatus,
      history: [{ status: 3, source: 'manual' }],
    });
    expect(runCase.update).toHaveBeenCalledWith({
      runCaseId: 3,
      projectId: 10,
      status: runCaseStatus,
      executionId: 'e1',
      attempt: 1,
      correlationId: 'corr-1',
    });

    await expect(updater.record(signed)).resolves.toMatchObject({ status });
    expect(runCase.update).toHaveBeenCalledOnce();
  });

  it('keeps an execution without a RunCase relation and never maps non-terminal or technical outcomes', async () => {
    const cases = [
      { name: 'queued', value: { status: 'queued' as const, phase: 'running' as const } },
      { name: 'running', value: { status: 'running' as const, phase: 'running' as const } },
      { name: 'technical error', value: { status: 'running' as const, outcome: 'technical_error' as const } },
      {
        name: 'recoverable timeout',
        value: { status: 'running' as const, outcome: 'timeout' as const, recoverable: true },
      },
      {
        name: 'abandoned attempt',
        value: { status: 'running' as const, outcome: 'abandoned' as const, recoverable: true },
      },
      { name: 'cancelled', value: { status: 'running' as const, outcome: 'cancelled' as const } },
      { name: 'invalid result', value: { status: 'running' as const, outcome: 'unknown' as never } },
    ];

    for (const { name, value } of cases) {
      const data = makeStore({ ...initial, runCaseId: undefined, status: value.status });
      const runCase = makeRunCaseStatus();
      const updater = new WorkerResultUpdater(data.store, 'server-secret', runCase.update);
      const signed = signWorkerEvent(event(value), 'server-secret');

      if (name === 'invalid result') {
        await expect(updater.record(signed)).rejects.toMatchObject({ code: 'worker_result_invalid' });
      } else {
        await updater.record(signed);
      }

      expect(runCase.update).not.toHaveBeenCalled();
      expect(runCase.read().status).toBe(0);
    }
  });

  it('preserves every attempt and manual RunCase history before mapping a final retry', async () => {
    const data = makeStore({
      ...initial,
      status: 'running',
      attemptHistory: [{ attempt: 0, status: 'passed', source: 'manual' }],
    });
    const runCase = makeRunCaseStatus();
    const updater = new WorkerResultUpdater(data.store, 'server-secret', runCase.update);

    const retried = await updater.record(
      signWorkerEvent(
        event({ outcome: 'technical_error', recoverable: true, error: 'connection lost' }),
        'server-secret'
      )
    );
    expect(retried).toMatchObject({ status: 'queued', attempt: 2 });
    expect(retried.attemptHistory).toEqual([
      { attempt: 0, status: 'passed', source: 'manual' },
      expect.objectContaining({ attempt: 1, status: 'error', outcome: 'technical_error' }),
    ]);
    expect(runCase.update).not.toHaveBeenCalled();

    const final = await updater.record(
      signWorkerEvent(
        event({ attempt: 2, jobId: 'e1:attempt:2', outcome: 'functional_failure', error: 'assertion failed' }),
        'server-secret'
      )
    );
    expect(final.attemptHistory).toEqual([
      { attempt: 0, status: 'passed', source: 'manual' },
      expect.objectContaining({ attempt: 1, status: 'error', outcome: 'technical_error' }),
      expect.objectContaining({ attempt: 2, status: 'failed', outcome: 'functional_failure' }),
    ]);
    expect(runCase.read().history).toEqual([{ status: 3, source: 'manual' }]);
    expect(runCase.read().status).toBe(2);
  });

  it('maps an authenticated worker completion through the injected executor boundary', async () => {
    const executor = {
      execute: vi.fn(async () => ({ outcome: 'passed' as const })),
      cancel: vi.fn(async () => undefined),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('injected', executor);
    const data = makeStore();
    const runCase = makeRunCaseStatus();
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret', runCase.update), {
      secret: 'server-secret',
      phase0Ready: true,
    });

    await expect(worker.process({ ...job, executorKey: 'injected' })).resolves.toMatchObject({ status: 'passed' });
    expect(executor.execute).toHaveBeenCalledWith({ executionId: 'e1', snapshot: 'Feature: Login' });
    expect(runCase.read()).toMatchObject({ status: 1, history: [{ status: 3, source: 'manual' }] });
  });

  it('persists executor artifacts before emitting a metadata-only terminal event', async () => {
    const artifactContent = Buffer.from('video bytes');
    const artifactHash = createHash('sha256').update(artifactContent).digest('hex');
    const data = makeStore();
    const artifactStorage = {
      put: vi.fn(async () => ({ storageKey: 'execution/e1/attempt/1/video.webm', hash: artifactHash })),
      get: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const artifactStore = {
      createArtifact: vi.fn(async (value: Record<string, unknown>) => {
        expect(data.updateExecution).toHaveBeenCalledTimes(1);
        return value;
      }),
      deleteArtifacts: vi.fn(async () => undefined),
    };
    const artifacts = [
      {
        kind: 'video',
        filename: 'step.webm',
        mimeType: 'video/webm; codecs=vp9',
        content: artifactContent,
      },
    ];
    const executor = {
      execute: vi.fn(async (input: ExecutorInvocation) => {
        await input.artifactSink?.(artifacts);
        return { outcome: 'passed' as const, artifacts };
      }),
      cancel: vi.fn(async () => undefined),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('injected', executor);
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      phase0Ready: true,
      artifactStorage,
      artifactStore,
    });

    await expect(
      worker.process({
        ...job,
        executorKey: 'injected',
        environment: { baseUrl: 'https://qa.example.test', allowedHosts: ['qa.example.test'], secretRefs: [] },
      })
    ).resolves.toMatchObject({ status: 'passed' });
    expect(executor.execute).toHaveBeenCalledWith({
      executionId: 'e1',
      snapshot: 'Feature: Login',
      environment: { baseUrl: 'https://qa.example.test', allowedHosts: ['qa.example.test'], secretRefs: [] },
      artifactSink: expect.any(Function),
    });
    expect(artifactStorage.put).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'e1', attempt: 1, kind: 'video', mimeType: 'video/webm' })
    );
    expect(artifactStore.createArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'e1',
        projectId: 10,
        attempt: 1,
        kind: 'video',
        storageKey: 'execution/e1/attempt/1/video.webm',
        size: 11,
        sha256: artifactHash,
        expiresAt: expect.any(Date),
      })
    );
    expect(artifactStore.deleteArtifacts).not.toHaveBeenCalled();
    expect(data.updateExecution).toHaveBeenCalledTimes(2);
    expect(data.updateExecution.mock.calls.every(([, patch]) => !JSON.stringify(patch).includes('video bytes'))).toBe(
      true
    );
  });

  it('removes partial artifact metadata before deleting stored files', async () => {
    const content = Buffer.from('evidence');
    const hash = createHash('sha256').update(content).digest('hex');
    const storageKeys = ['execution/e1/attempt/1/one.xml', 'execution/e1/attempt/1/two.xml'];
    let storageIndex = 0;
    const deletedStorageKeys: string[] = [];
    const artifactStorage = {
      rootDir: 'receiver-dependent-root',
      put: vi.fn(async () => ({ storageKey: storageKeys[storageIndex++], hash })),
      get: vi.fn(),
      delete: vi.fn(async function (this: { rootDir: string }, storageKey: string) {
        if (this.rootDir !== 'receiver-dependent-root') throw new Error('receiver_missing');
        deletedStorageKeys.push(storageKey);
      }),
    };
    const artifactStore = {
      createArtifact: vi.fn().mockResolvedValueOnce({ id: 'a1' }).mockRejectedValueOnce(new Error('database failure')),
      deleteArtifacts: vi.fn(async () => undefined),
    };
    const executor = {
      execute: vi.fn(async () => ({
        outcome: 'passed' as const,
        artifacts: [
          { kind: 'junit', filename: 'one.xml', mimeType: 'application/xml', content },
          { kind: 'junit', filename: 'two.xml', mimeType: 'application/xml', content },
        ],
      })),
      cancel: vi.fn(async () => undefined),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('injected', executor);
    const data = makeStore();
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      phase0Ready: true,
      artifactStorage,
      artifactStore,
    });

    const result = await worker.process({ ...job, executorKey: 'injected' });
    expect(result).toMatchObject({
      status: 'error',
      error: 'artifact_persistence_failed',
      errorKind: 'technical',
    });
    expect(JSON.stringify(result)).not.toContain('database failure');
    expect(artifactStore.deleteArtifacts).toHaveBeenCalledWith(storageKeys);
    expect(artifactStorage.delete).toHaveBeenCalledTimes(2);
    expect(artifactStorage.delete).toHaveBeenNthCalledWith(1, storageKeys[0]);
    expect(artifactStorage.delete).toHaveBeenNthCalledWith(2, storageKeys[1]);
    expect(deletedStorageKeys).toEqual(storageKeys);
  });

  it('emits only safe artifact persistence diagnostics for raw database failures', async () => {
    const content = Buffer.from('evidence');
    const hash = createHash('sha256').update(content).digest('hex');
    const rawDatabaseError = 'SQLITE_BUSY: database is locked; INSERT INTO ExecutionArtifact(secret=top-secret)';
    const databaseError = Object.assign(new Error(rawDatabaseError), {
      code: 'SQLITE_BUSY',
      sql: 'INSERT INTO ExecutionArtifact(secret=top-secret)',
    });
    const diagnostics: unknown[] = [];
    const artifactStorage = {
      put: vi.fn(async () => ({ storageKey: 'execution/e1/attempt/1/one.xml', hash })),
      get: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const artifactStore = {
      createArtifact: vi.fn().mockRejectedValue(databaseError),
      deleteArtifacts: vi.fn(async () => undefined),
    };
    const executor = {
      execute: vi.fn(async () => ({
        outcome: 'passed' as const,
        artifacts: [{ kind: 'junit', filename: 'one.xml', mimeType: 'application/xml', content }],
      })),
      cancel: vi.fn(async () => undefined),
      health: vi.fn(async () => ({ ready: true, status: 'test' })),
    };
    const registry = new NeutralExecutorRegistry();
    registry.register('injected', executor);
    const data = makeStore();
    const worker = new ExecutionWorker(registry, new WorkerResultUpdater(data.store, 'server-secret'), {
      secret: 'server-secret',
      phase0Ready: true,
      artifactStorage,
      artifactStore,
      hooks: { log: (event) => diagnostics.push(event) },
    });

    const result = await worker.process({ ...job, executorKey: 'injected' });

    expect(result).toMatchObject({ status: 'error', error: 'artifact_persistence_failed' });
    expect(JSON.stringify(result)).not.toContain(rawDatabaseError);
    expect(JSON.stringify(diagnostics)).not.toContain(rawDatabaseError);
    expect(diagnostics).toContainEqual({
      executionId: 'e1',
      attempt: 1,
      stage: 'metadata_create',
      errorCategory: 'database_busy',
    });
  });

  it('rejects invalid or replayed signed results without allowing client approval fields', async () => {
    const data = makeStore({ ...initial, status: 'running' });
    const runCase = makeRunCaseStatus();
    const updater = new WorkerResultUpdater(data.store, 'server-secret', runCase.update);
    const final = signWorkerEvent(
      event({ outcome: 'functional_failure', status: 'passed', runCaseStatus: 1, approval: true }),
      'server-secret'
    );

    await updater.record(final);
    expect(runCase.read().status).toBe(2);
    await expect(updater.record(signWorkerEvent(event({ outcome: 'passed' }), 'server-secret'))).rejects.toMatchObject({
      code: 'worker_event_replay',
    });
    await expect(updater.record({ ...final, signature: 'invalid' })).rejects.toMatchObject({
      code: 'invalid_worker_signature',
    });
    expect(runCase.update).toHaveBeenCalledOnce();
    expect(runCase.read().status).toBe(2);
  });
});
