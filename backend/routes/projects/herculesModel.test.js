import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import herculesModelRoute from './herculesModel.js';

const mockProjectModel = { findByPk: vi.fn() };
const mockOrganizationModel = { findByPk: vi.fn(), findOrCreate: vi.fn() };

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: vi.fn((req, _res, next) => {
      req.userId = 7;
      next();
    }),
  }),
}));

vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectManagerFromProjectId: vi.fn((_req, _res, next) => next()),
  }),
}));

vi.mock('../../models/projects.js', () => ({ default: () => mockProjectModel }));
vi.mock('../../models/organizations.js', () => ({ default: () => mockOrganizationModel }));

function organizationRecord(overrides = {}) {
  let values = { id: 4, name: 'Acme', ownerUserId: 7, herculesModel: null, ...overrides };
  const organization = {
    id: values.id,
    name: values.name,
    ownerUserId: values.ownerUserId,
    herculesModel: values.herculesModel,
    get: vi.fn(() => ({ ...values })),
    update: vi.fn(async (next) => {
      values = { ...values, ...next };
      Object.assign(organization, next);
      return organization;
    }),
  };
  return organization;
}

function projectRecord(overrides = {}) {
  const project = {
    id: 10,
    userId: 7,
    organizationId: 4,
    update: vi.fn(async (next) => Object.assign(project, next)),
    ...overrides,
  };
  return project;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', herculesModelRoute({}));
  return app;
}

describe('organization Hercules model settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the organization model without exposing unrelated fields', async () => {
    mockProjectModel.findByPk.mockResolvedValue(projectRecord());
    mockOrganizationModel.findByPk.mockResolvedValue(
      organizationRecord({ herculesModel: 'gpt-4o-mini', secret: 'hidden' })
    );

    const response = await request(makeApp()).get('/api/projects/10/settings/hercules-model');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ organization: { id: 4, name: 'Acme', herculesModel: 'gpt-4o-mini' } });
    expect(JSON.stringify(response.body)).not.toContain('hidden');
  });

  it('fails closed when a project points to an organization owned by another user', async () => {
    mockProjectModel.findByPk.mockResolvedValue(projectRecord({ userId: 7, organizationId: 99 }));
    const foreignOrganization = organizationRecord({ id: 99, ownerUserId: 42, herculesModel: 'foreign-model' });
    mockOrganizationModel.findByPk.mockResolvedValue(foreignOrganization);

    const response = await request(makeApp()).get('/api/projects/10/settings/hercules-model');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'organization_model_unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('foreign-model');
    expect(mockOrganizationModel.findOrCreate).not.toHaveBeenCalled();
  });

  it('does not update a foreign organization through a corrupt project association', async () => {
    mockProjectModel.findByPk.mockResolvedValue(projectRecord({ userId: 7, organizationId: 99 }));
    const foreignOrganization = organizationRecord({ id: 99, ownerUserId: 42, herculesModel: 'foreign-model' });
    mockOrganizationModel.findByPk.mockResolvedValue(foreignOrganization);

    const response = await request(makeApp())
      .put('/api/projects/10/settings/hercules-model')
      .send({ model: 'new-model' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'organization_model_unavailable' });
    expect(foreignOrganization.update).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('foreign-model');
  });

  it('allows the organization owner to update and clear the model', async () => {
    const organization = organizationRecord();
    mockProjectModel.findByPk.mockResolvedValue(projectRecord());
    mockOrganizationModel.findByPk.mockResolvedValue(organization);

    const response = await request(makeApp())
      .put('/api/projects/10/settings/hercules-model')
      .send({ model: '  organization-model  ' });

    expect(response.status).toBe(200);
    expect(organization.update).toHaveBeenCalledWith({ herculesModel: 'organization-model' });
    expect(response.body.organization.herculesModel).toBe('organization-model');
  });

  it('rejects invalid model values before persistence', async () => {
    mockProjectModel.findByPk.mockResolvedValue(projectRecord());
    mockOrganizationModel.findByPk.mockResolvedValue(organizationRecord());

    const response = await request(makeApp())
      .put('/api/projects/10/settings/hercules-model')
      .send({ model: 'x'.repeat(257) });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'organization_model_invalid',
      fields: [{ field: 'model', code: 'invalid' }],
    });
  });
});
