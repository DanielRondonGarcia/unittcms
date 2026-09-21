import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import casesReorderRoute from './reorder.js';

const mocks = vi.hoisted(() => {
  const state = {
    authenticated: true,
    authorized: true,
  };
  const orderService = {
    reorderFolder: vi.fn(),
  };
  class MockCaseOrderError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  return { state, orderService, MockCaseOrderError };
});

vi.mock('./orderService.js', () => ({
  default: vi.fn(() => mocks.orderService),
  CaseOrderError: mocks.MockCaseOrderError,
}));

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: (req, res, next) => {
      if (!mocks.state.authenticated) return res.status(401).json({ error: 'Unauthorized' });
      req.userId = 1;
      return next();
    },
  }),
}));

vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectDeveloperFromFolderId: (req, res, next) => {
      if (!req.query.folderId) return res.status(400).json({ error: 'folderId is required' });
      if (!mocks.state.authorized) return res.status(403).json({ error: 'Forbidden' });
      return next();
    },
  }),
}));

const app = express();
app.use(express.json());

beforeAll(() => {
  app.use('/cases', casesReorderRoute({}));
});

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

afterAll(() => {
  consoleError.mockRestore();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.authenticated = true;
  mocks.state.authorized = true;
  mocks.orderService.reorderFolder.mockResolvedValue([
    { id: 12, folderId: 7, position: 1 },
    { id: 11, folderId: 7, position: 2 },
    { id: 10, folderId: 7, position: 3 },
  ]);
});

describe('PUT /cases/reorder', () => {
  it('mounts before parameterized case routes', () => {
    const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const reorderMount = server.indexOf("app.use('/cases', casesReorderRoute(sequelize));");
    const parameterizedMount = server.indexOf("app.use('/cases', casesShowRoute(sequelize));");

    expect(reorderMount).toBeGreaterThanOrEqual(0);
    expect(parameterizedMount).toBeGreaterThan(reorderMount);
  });

  it('commits a complete permutation and preserves immutable case IDs', async () => {
    const orderedCaseIds = [12, 11, 10];
    const response = await request(app).put('/cases/reorder').send({ folderId: 7, orderedCaseIds });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      folderId: 7,
      orderedCaseIds,
      committed: [
        { id: 12, position: 1 },
        { id: 11, position: 2 },
        { id: 10, position: 3 },
      ],
    });
    expect(response.body.committed.find((testcase) => testcase.id === 10)).toEqual({ id: 10, position: 3 });
    expect(mocks.orderService.reorderFolder).toHaveBeenCalledWith({ folderId: 7, orderedCaseIds });
  });

  it.each([
    ['duplicate', 'ordered_case_ids_duplicate', 'orderedCaseIds must not contain duplicates', [10, 10, 11], 400],
    ['missing', 'ordered_case_ids_missing', 'orderedCaseIds is not a complete folder permutation', [10, 11], 400],
    ['unknown', 'ordered_case_ids_unknown', 'orderedCaseIds contains unknown cases', [10, 11, 999], 404],
    ['foreign', 'ordered_case_ids_foreign', 'orderedCaseIds contains cases from another folder', [10, 11, 20], 400],
    ['malformed', 'ordered_case_ids_invalid', 'orderedCaseIds must be an array', 'not-an-array', 400],
  ])('maps %s permutation validation errors without writing', async (_name, code, message, orderedCaseIds, status) => {
    mocks.orderService.reorderFolder.mockRejectedValueOnce(new mocks.MockCaseOrderError(code, message, status));

    const response = await request(app).put('/cases/reorder').send({ folderId: 7, orderedCaseIds });

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: message, code });
    expect(mocks.orderService.reorderFolder).toHaveBeenCalledWith({ folderId: 7, orderedCaseIds });
  });

  it('rejects a missing folder before invoking the ordering service', async () => {
    const response = await request(app)
      .put('/cases/reorder')
      .send({ orderedCaseIds: [10, 11, 12] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'folderId is required' });
    expect(mocks.orderService.reorderFolder).not.toHaveBeenCalled();
  });

  it('requires authentication and project edit access before ordering', async () => {
    mocks.state.authenticated = false;
    const unauthenticated = await request(app)
      .put('/cases/reorder')
      .send({ folderId: 7, orderedCaseIds: [10] });

    expect(unauthenticated.status).toBe(401);
    expect(mocks.orderService.reorderFolder).not.toHaveBeenCalled();

    mocks.state.authenticated = true;
    mocks.state.authorized = false;
    const unauthorized = await request(app)
      .put('/cases/reorder')
      .send({ folderId: 7, orderedCaseIds: [10] });

    expect(unauthorized.status).toBe(403);
    expect(unauthorized.body).toEqual({ error: 'Forbidden' });
    expect(mocks.orderService.reorderFolder).not.toHaveBeenCalled();
  });

  it('maps transaction or persistence failures to a safe response', async () => {
    mocks.orderService.reorderFolder.mockRejectedValueOnce(new Error('SQLITE_CONSTRAINT: leaked database detail'));

    const response = await request(app)
      .put('/cases/reorder')
      .send({ folderId: 7, orderedCaseIds: [12, 11, 10] });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toContain('SQLITE_CONSTRAINT');
    expect(mocks.orderService.reorderFolder).toHaveBeenCalledOnce();
  });
});
