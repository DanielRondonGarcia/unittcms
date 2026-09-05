import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isFalseLike,
  isMcpEnabled,
  isManualExecutionEnabled,
  parseMcpTrustedHosts,
  isSelfRegistrationEnabled,
  registerManualExecutionRoute,
} from './config.js';

describe('manual execution feature flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to enabled and accepts all supported false-like values', () => {
    expect(isManualExecutionEnabled(undefined)).toBe(true);
    expect(isManualExecutionEnabled('true')).toBe(true);
    expect(isManualExecutionEnabled('')).toBe(true);
    expect(isManualExecutionEnabled('invalid')).toBe(true);
    expect(isManualExecutionEnabled(' false ')).toBe(false);
    expect(isManualExecutionEnabled('0')).toBe(false);
    expect(isManualExecutionEnabled(' NO ')).toBe(false);
    expect(isManualExecutionEnabled('off')).toBe(false);
  });

  it('uses the same false-like parsing for self-registration', () => {
    expect(isSelfRegistrationEnabled(undefined)).toBe(true);
    expect(isSelfRegistrationEnabled('true')).toBe(true);
    expect(isSelfRegistrationEnabled('false')).toBe(false);
    expect(isSelfRegistrationEnabled('0')).toBe(false);
    expect(isSelfRegistrationEnabled('no')).toBe(false);
    expect(isSelfRegistrationEnabled('off')).toBe(false);
    expect(isFalseLike('invalid')).toBe(false);
  });

  it('keeps MCP disabled by default and normalizes configured trusted hosts', () => {
    expect(isMcpEnabled(undefined)).toBe(false);
    expect(isMcpEnabled('false')).toBe(false);
    expect(isMcpEnabled('true')).toBe(true);
    expect(parseMcpTrustedHosts(' app.example.test, gateway.example.test, app.example.test ')).toEqual([
      'app.example.test',
      'gateway.example.test',
    ]);
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
