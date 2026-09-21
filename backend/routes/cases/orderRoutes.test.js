import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import casesMoveRoute from './move.js';
import casesNewRoute from './new.js';
import casesEditRoute from './edit.js';

const mocks = vi.hoisted(() => {
  const state = {
    authenticated: true,
    authorized: true,
  };
  const orderService = {
    createCase: vi.fn(),
    moveCase: vi.fn(),
    moveCasesToFolder: vi.fn(),
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

vi.mock('../steps/persistence.js', () => ({
  CaseSaveValidationError: class extends Error {},
  persistCaseSteps: vi.fn(),
  validateAndNormalizeCaseSteps: vi.fn(async ({ steps }) => ({ steps: steps ?? [] })),
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
  default: () => {
    const verifyAuthorization = (req, res, next) => {
      if (!mocks.state.authorized) return res.status(403).json({ error: 'Forbidden' });
      return next();
    };

    return {
      verifyProjectDeveloperFromFolderId: verifyAuthorization,
      verifyProjectDeveloperFromCaseId: verifyAuthorization,
      verifyProjectDeveloperFromProjectId: verifyAuthorization,
    };
  },
}));

const mockCase = {
  create: vi.fn(),
  findByPk: vi.fn(),
  belongsToMany: vi.fn(),
};
vi.mock('../../models/cases.js', () => ({ default: () => mockCase }));

const mockFolder = { findByPk: vi.fn() };
vi.mock('../../models/folders.js', () => ({ default: () => mockFolder }));

const mockStep = { belongsToMany: vi.fn() };
vi.mock('../../models/steps.js', () => ({ default: () => mockStep }));

const mockCaseStep = {};
vi.mock('../../models/caseSteps.js', () => ({ default: () => mockCaseStep }));

const transaction = { commit: vi.fn(), rollback: vi.fn() };
const sequelize = {
  transaction: vi.fn(async (callback) => {
    if (typeof callback === 'function') return callback(transaction);
    return transaction;
  }),
};

const app = express();
app.use(express.json());

beforeAll(() => {
  app.use('/cases', casesMoveRoute(sequelize));
  app.use('/cases', casesNewRoute(sequelize));
  app.use('/cases', casesEditRoute(sequelize));
});

function editableCase() {
  return {
    id: 10,
    folderId: 7,
    position: 2,
    title: 'Original',
    template: 0,
    automationVersion: 1,
    Steps: [],
    update: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.authenticated = true;
  mocks.state.authorized = true;
  mockCase.findByPk.mockResolvedValue(editableCase());
  mocks.orderService.createCase.mockResolvedValue({ id: 20, title: 'Created', folderId: 7, position: 3 });
  mocks.orderService.moveCase.mockResolvedValue([{ id: 10, folderId: 7, position: 1 }]);
  mocks.orderService.moveCasesToFolder.mockResolvedValue({
    movedCaseIds: [10, 12],
    targetFolderId: 9,
    targetCases: [],
  });
});

describe('case ordering REST write paths', () => {
  it('delegates create append and insert while excluding immutable identity fields', async () => {
    const commonPayload = {
      title: 'Created',
      state: 0,
      priority: 1,
      type: 0,
      automationStatus: 0,
      template: 0,
      id: 999,
    };

    const appended = await request(app).post('/cases?folderId=7').send(commonPayload);
    const inserted = await request(app)
      .post('/cases?folderId=7')
      .send({ ...commonPayload, position: 2 });

    expect(appended.status).toBe(200);
    expect(inserted.status).toBe(200);
    expect(mocks.orderService.createCase).toHaveBeenNthCalledWith(1, {
      attributes: expect.not.objectContaining({ id: 999, position: expect.anything() }),
      folderId: '7',
      position: undefined,
      transaction,
    });
    expect(mocks.orderService.createCase).toHaveBeenNthCalledWith(2, {
      attributes: expect.not.objectContaining({ id: 999, position: expect.anything() }),
      folderId: '7',
      position: 2,
      transaction,
    });
  });

  it('moves an edited case by position without changing its id or folder', async () => {
    const testcase = editableCase();
    mockCase.findByPk.mockResolvedValue(testcase);

    const response = await request(app).put('/cases/10').send({ title: 'Renamed', position: 1, id: 999, folderId: 99 });

    expect(response.status).toBe(200);
    expect(testcase.update).toHaveBeenCalledWith({ title: 'Renamed' }, { transaction });
    expect(mocks.orderService.moveCase).toHaveBeenCalledWith({
      caseId: '10',
      position: 1,
      transaction,
    });
    expect(testcase.update.mock.calls[0][0]).not.toHaveProperty('id');
    expect(testcase.update.mock.calls[0][0]).not.toHaveProperty('folderId');
    expect(testcase.update.mock.calls[0][0]).not.toHaveProperty('position');
    expect(testcase.id).toBe(10);
    expect(testcase.folderId).toBe(7);
  });

  it('preserves order and skips the ordering service for an identity-safe metadata edit', async () => {
    const testcase = editableCase();
    mockCase.findByPk.mockResolvedValue(testcase);

    const response = await request(app).put('/cases/10').send({ title: 'Renamed', id: 999, folderId: 99 });

    expect(response.status).toBe(200);
    expect(testcase.update).toHaveBeenCalledWith({ title: 'Renamed' });
    expect(mocks.orderService.moveCase).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(testcase.id).toBe(10);
    expect(testcase.folderId).toBe(7);
  });

  it('delegates cross-folder moves in request order and preserves the move response shape', async () => {
    const response = await request(app)
      .put('/cases/move?projectId=3')
      .send({ caseIds: [10, 12], targetFolderId: 9 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'Cases moved successfully',
      movedCaseIds: [10, 12],
      targetFolderId: 9,
    });
    expect(mocks.orderService.moveCasesToFolder).toHaveBeenCalledWith({
      caseIds: [10, 12],
      targetFolderId: 9,
    });
  });

  it('maps ordering validation failures and retains existing request validation', async () => {
    mocks.orderService.moveCase.mockRejectedValueOnce(
      new mocks.MockCaseOrderError('position_invalid', 'position must be a positive integer')
    );
    const invalidPosition = await request(app).put('/cases/10').send({ position: 0 });
    const missingMoveFields = await request(app).put('/cases/move?projectId=3').send({ caseIds: [] });

    expect(invalidPosition.status).toBe(400);
    expect(invalidPosition.body).toEqual({
      error: 'position must be a positive integer',
      code: 'position_invalid',
    });
    expect(missingMoveFields.status).toBe(400);
    expect(missingMoveFields.body).toEqual({ error: 'caseIds(array) and targetFolderId are required' });
  });

  it('keeps authentication and project authorization before ordering writes', async () => {
    mocks.state.authenticated = false;
    const unauthenticated = await request(app).post('/cases?folderId=7').send({});

    expect(unauthenticated.status).toBe(401);
    expect(mocks.orderService.createCase).not.toHaveBeenCalled();

    mocks.state.authenticated = true;
    mocks.state.authorized = false;
    const unauthorized = await request(app)
      .put('/cases/move?projectId=3')
      .send({ caseIds: [10], targetFolderId: 9 });

    expect(unauthorized.status).toBe(403);
    expect(mocks.orderService.moveCasesToFolder).not.toHaveBeenCalled();
  });
});
