import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isFalseLike,
  isMcpEnabled,
  isMcpRateLimitEnabled,
  isManualExecutionEnabled,
  isRateLimitEnabled,
  parseMcpRateLimitMax,
  parseMcpTrustedHosts,
  parseMcpRateLimitWindowMs,
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

  it('keeps the global API rate limiter enabled by default and accepts false-like values', () => {
    expect(isRateLimitEnabled(undefined)).toBe(true);
    expect(isRateLimitEnabled('true')).toBe(true);
    expect(isRateLimitEnabled('')).toBe(true);
    expect(isRateLimitEnabled('invalid')).toBe(true);
    expect(isRateLimitEnabled(' False ')).toBe(false);
    expect(isRateLimitEnabled('0')).toBe(false);
    expect(isRateLimitEnabled(' NO ')).toBe(false);
    expect(isRateLimitEnabled('off')).toBe(false);
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

  it('enables the MCP limiter by default and accepts all supported false-like values', () => {
    expect(isMcpRateLimitEnabled(undefined)).toBe(true);
    expect(isMcpRateLimitEnabled('true')).toBe(true);
    expect(isMcpRateLimitEnabled('')).toBe(true);
    expect(isMcpRateLimitEnabled('invalid')).toBe(true);
    expect(isMcpRateLimitEnabled(' False ')).toBe(false);
    expect(isMcpRateLimitEnabled('0')).toBe(false);
    expect(isMcpRateLimitEnabled(' NO ')).toBe(false);
    expect(isMcpRateLimitEnabled('off')).toBe(false);
  });

  it('uses MCP rate-limit defaults for missing or invalid positive integers', () => {
    expect(parseMcpRateLimitMax(undefined)).toBe(100);
    expect(parseMcpRateLimitMax('25')).toBe(25);
    expect(parseMcpRateLimitMax('invalid')).toBe(100);
    expect(parseMcpRateLimitMax('0')).toBe(100);
    expect(parseMcpRateLimitMax('-1')).toBe(100);
    expect(parseMcpRateLimitMax('1.5')).toBe(100);

    expect(parseMcpRateLimitWindowMs(undefined)).toBe(3600000);
    expect(parseMcpRateLimitWindowMs('10')).toBe(10);
    expect(parseMcpRateLimitWindowMs('invalid')).toBe(3600000);
    expect(parseMcpRateLimitWindowMs('0')).toBe(3600000);
    expect(parseMcpRateLimitWindowMs('-1')).toBe(3600000);
    expect(parseMcpRateLimitWindowMs('1.5')).toBe(3600000);
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
