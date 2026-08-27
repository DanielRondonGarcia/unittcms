import { describe, expect, it, vi } from 'vitest';
import { LlmConfigError } from './infrastructure/llm-config.js';
import { AutomationWorkerBootstrapError, loadWorkerHerculesVolume, loadWorkerSecret, start } from './worker-bootstrap.js';

vi.mock('./infrastructure/bullmq.js', () => ({
  AUTOMATION_HEALTH_TTL_MS: 60_000,
  BullMqWorkerRuntime: class {},
  closeRedis: vi.fn(),
  connectRedis: vi.fn(),
  createBullMqQueue: vi.fn(),
  createRedisConnection: vi.fn(),
  RedisWorkerHealth: class {},
}));

describe('automation worker bootstrap boundary', () => {
  it('loads and trims the file secret with precedence over the direct secret', () => {
    const paths: string[] = [];
    const secret = loadWorkerSecret(
      {
        AUTOMATION_WORKER_SECRET_FILE: ' /run/secrets/automation_worker_secret ',
        AUTOMATION_WORKER_SECRET: 'direct-secret',
      },
      (filePath) => {
        paths.push(filePath);
        return ' file-secret\n';
      }
    );

    expect(secret).toBe('file-secret');
    expect(paths).toEqual(['/run/secrets/automation_worker_secret']);
  });

  it('rejects an empty file secret with the safe required error code', () => {
    expect(() =>
      loadWorkerSecret(
        { AUTOMATION_WORKER_SECRET_FILE: '/run/secrets/automation_worker_secret' },
        () => ' \n'
      )
    ).toThrow(new AutomationWorkerBootstrapError('automation_worker_secret_required'));
  });

  it('rejects an unreadable file secret with the safe required error code', () => {
    expect(() =>
      loadWorkerSecret(
        { AUTOMATION_WORKER_SECRET_FILE: '/run/secrets/automation_worker_secret' },
        () => {
          throw new Error('reader failure');
        }
      )
    ).toThrow(new AutomationWorkerBootstrapError('automation_worker_secret_required'));
  });

  it('falls back to the trimmed direct secret when no file is configured', () => {
    let readerCalled = false;
    const secret = loadWorkerSecret({ AUTOMATION_WORKER_SECRET: ' direct-secret\n' }, () => {
      readerCalled = true;
      return 'file-secret';
    });

    expect(secret).toBe('direct-secret');
    expect(readerCalled).toBe(false);
  });

  it('loads the worker-only Hercules volume and rejects unsafe environment values', () => {
    expect(loadWorkerHerculesVolume({ AUTOMATION_HERCULES_VOLUME: 'unittcms_hercules-work' })).toBe(
      'unittcms_hercules-work'
    );
    expect(loadWorkerHerculesVolume({})).toBeUndefined();
    expect(() => loadWorkerHerculesVolume({ AUTOMATION_HERCULES_VOLUME: 'invalid/name' })).toThrow(
      new AutomationWorkerBootstrapError('automation_hercules_volume_invalid')
    );
  });

  it('fails closed when started outside real mode before touching Redis', async () => {
    await expect(start({ mode: 'disabled' })).rejects.toEqual(
      new AutomationWorkerBootstrapError('worker_requires_real_mode')
    );
  });

  it('requires worker HMAC and typed LLM configuration before opening Redis', async () => {
    await expect(start({ mode: 'real', redisUrl: 'redis://unreachable.test:6379', workerSecret: 'worker-secret' })).rejects.toBeInstanceOf(
      LlmConfigError
    );
  });
});
