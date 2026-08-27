import { describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_CANCEL_CHANNEL,
  BullMqQueueAdapter,
  RedisExecutorRegistry,
  RedisWorkerHealth,
} from './bullmq.js';

function redisFixture() {
  let stored: string | null = null;
  return {
    client: {
      set: vi.fn(async (_key: string, value: string) => {
        stored = value;
        return 'OK';
      }),
      get: vi.fn(async () => stored),
      publish: vi.fn(async () => 1),
      ping: vi.fn(async () => 'PONG'),
      quit: vi.fn(async () => 'OK'),
      status: 'ready',
    },
  };
}

describe('BullMQ runtime boundary', () => {
  it('maps queue jobs and publishes cancellation without embedding secrets in job identity', async () => {
    const redis = redisFixture();
    const removed = vi.fn(async () => undefined);
    const queue = {
      add: vi.fn(async (_name: string, _job: unknown) => ({ id: 'e1:attempt:1' })),
      getJobs: vi.fn(async () => [{ id: 'e1:attempt:1', data: { executionId: 'e1', attempt: 1, snapshot: 'Feature: safe' }, remove: removed }]),
      close: vi.fn(async () => undefined),
    };
    const adapter = new BullMqQueueAdapter(queue as never, redis.client as never, { publisher: redis.client as never });

    await expect(
      adapter.add('automation-execution', { executionId: 'e1', attempt: 1, snapshot: 'Feature: safe' }, {
        jobId: 'e1:attempt:1',
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      })
    ).resolves.toEqual({ id: 'e1:attempt:1' });
    await adapter.remove('e1');

    expect(removed).toHaveBeenCalledOnce();
    expect(redis.client.publish).toHaveBeenCalledWith(AUTOMATION_CANCEL_CHANNEL, 'e1');
    expect(JSON.stringify(queue.add.mock.calls)).not.toContain('api-key');
  });

  it('publishes and reads only bounded worker health fields', async () => {
    const redis = redisFixture();
    const health = new RedisWorkerHealth(redis.client as never, 'health-key');
    await health.publish({
      ready: false,
      status: 'not_ready',
      heartbeatAt: '2026-08-24T00:00:00.000Z',
      phase0Ready: false,
      executors: [{ key: 'hercules', health: { ready: false, status: 'compatibility_not_ready' } }],
    });

    await expect(health.health()).resolves.toMatchObject({ ready: false, phase0Ready: false, executors: [{ key: 'hercules' }] });
    expect(JSON.stringify(redis.client.set.mock.calls)).not.toContain('api-key');
  });

  it('keeps the API executor registry remote and not credential-owning', async () => {
    const redis = redisFixture();
    const health = new RedisWorkerHealth(redis.client as never);
    await health.publish({
      ready: true,
      status: 'ready',
      heartbeatAt: '2026-08-24T00:00:00.000Z',
      phase0Ready: true,
      executors: [{ key: 'hercules', health: { ready: true, status: 'ready' } }],
    });
    const registry = new RedisExecutorRegistry(health);

    await expect(registry.select('hercules')).resolves.toBeUndefined();
    await expect(registry.list()).resolves.toEqual([
      { key: 'hercules', health: { key: 'hercules', ready: true, status: 'ready' } },
    ]);
  });
});
