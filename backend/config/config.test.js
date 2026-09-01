import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isManualExecutionEnabled, registerManualExecutionRoute } from './config.js';

describe('manual execution feature flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to enabled and only disables for a false value', () => {
    expect(isManualExecutionEnabled(undefined)).toBe(true);
    expect(isManualExecutionEnabled('true')).toBe(true);
    expect(isManualExecutionEnabled('')).toBe(true);
    expect(isManualExecutionEnabled('invalid')).toBe(true);
    expect(isManualExecutionEnabled(' false ')).toBe(false);
  });

  it('does not register the manual API when disabled or invoke its service', async () => {
    const service = { get: vi.fn() };
    const routeFactory = vi.fn(() => {
      const router = express.Router();
      router.get('/:executionId', (_req, res) => {
        service.get();
        res.sendStatus(200);
      });
      return router;
    });
    const app = express();

    registerManualExecutionRoute(app, {}, routeFactory, false);

    const response = await request(app).get('/manual-executions/1');

    expect(response.status).toBe(404);
    expect(routeFactory).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });
});
