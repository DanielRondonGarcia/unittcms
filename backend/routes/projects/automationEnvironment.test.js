import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import automationEnvironmentRoute from './automationEnvironment.js';

const mockEnvironmentModel = {
  findOne: vi.fn(),
  findOrCreate: vi.fn(),
};

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: vi.fn((req, res, next) => next()),
  }),
}));

vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectManagerFromProjectId: vi.fn((req, res, next) => next()),
  }),
}));

vi.mock('../../models/testEnvironments.js', () => ({
  default: () => mockEnvironmentModel,
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', automationEnvironmentRoute({}));
  return app;
}

function environmentRecord(overrides = {}) {
  let values = {
    id: 3,
    projectId: 10,
    name: 'Default',
    baseUrl: 'https://app.example.test',
    allowedHosts: ['app.example.test', 'gateway.example.test'],
    secretRefs: ['secret://idp'],
    enabled: true,
    isDefault: true,
    captureVideo: false,
    ...overrides,
  };
  const environment = {
    get: vi.fn(() => ({ ...values })),
    update: vi.fn(async (next) => {
      values = { ...values, ...next };
      return environment;
    }),
  };
  return environment;
}

describe('automation environment settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the normalized host allowlist without secret values', async () => {
    mockEnvironmentModel.findOne.mockResolvedValue(environmentRecord());

    const response = await request(makeApp()).get('/api/10/settings/automation-environment');

    expect(response.status).toBe(200);
    expect(response.body.environment).toMatchObject({
      baseUrl: 'https://app.example.test/',
      allowedHosts: ['app.example.test', 'gateway.example.test'],
      hasSecretRefs: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('secret://idp');
  });

  it('accepts additional hosts and persists the normalized result', async () => {
    const environment = environmentRecord({ allowedHosts: ['app.example.test'] });
    mockEnvironmentModel.findOrCreate.mockResolvedValue([environment]);

    const response = await request(makeApp())
      .put('/api/10/settings/automation-environment')
      .send({
        baseUrl: 'https://APP.example.test/app',
        allowedHosts: [' https://Gateway.Example.Test/ ', 'app.example.test'],
        enabled: true,
        captureVideo: false,
      });

    expect(response.status).toBe(200);
    expect(environment.update).toHaveBeenCalledWith({
      baseUrl: 'https://app.example.test/app',
      allowedHosts: ['app.example.test', 'gateway.example.test'],
      enabled: true,
      isDefault: true,
      captureVideo: false,
    });
    expect(response.body.environment.allowedHosts).toEqual(['app.example.test', 'gateway.example.test']);
  });

  it('accepts an origin in the host list and persists its canonical hostname', async () => {
    const response = await request(makeApp())
      .put('/api/10/settings/automation-environment')
      .send({ baseUrl: 'https://app.example.test', allowedHosts: ['https://gateway.example.test/'] });

    expect(response.status).toBe(200);
    expect(response.body.environment.allowedHosts).toEqual(['app.example.test', 'gateway.example.test']);
    expect(mockEnvironmentModel.findOrCreate).toHaveBeenCalledOnce();
  });

  it('returns an actionable field error for an invalid host origin', async () => {
    const response = await request(makeApp())
      .put('/api/10/settings/automation-environment')
      .send({ baseUrl: 'https://app.example.test', allowedHosts: ['https://gateway.example.test:443'] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'environment_host_invalid',
      fields: [{ field: 'allowedHosts', code: 'environment_host_invalid' }],
    });
    expect(mockEnvironmentModel.findOrCreate).not.toHaveBeenCalled();
  });
});
