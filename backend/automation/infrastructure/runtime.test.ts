import { describe, expect, it } from 'vitest';
import { createRealAutomationRuntime } from './runtime.js';

describe('real API automation runtime boundary', () => {
  it('fails closed before creating a Redis connection when the URL is absent', async () => {
    await expect(createRealAutomationRuntime({ redisUrl: '   ' })).rejects.toThrow('automation_redis_url_required');
  });
});
