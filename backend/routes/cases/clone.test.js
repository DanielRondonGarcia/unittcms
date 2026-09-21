import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import casesCloneRoute from './clone.js';

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: (req, res, next) => next(),
  }),
}));

vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectDeveloperFromProjectId: (req, res, next) => next(),
  }),
}));

const mockCase = {
  create: vi.fn(),
  findAll: vi.fn(),
  findByPk: vi.fn(),
  update: vi.fn(),
  belongsToMany: vi.fn(),
};
vi.mock('../../models/cases.js', () => ({ default: () => mockCase }));

const mockFolder = { findByPk: vi.fn() };
vi.mock('../../models/folders.js', () => ({ default: () => mockFolder }));

const mockStep = { bulkCreate: vi.fn(), belongsToMany: vi.fn() };
vi.mock('../../models/steps.js', () => ({ default: () => mockStep }));

const mockCaseStep = { bulkCreate: vi.fn() };
vi.mock('../../models/caseSteps.js', () => ({ default: () => mockCaseStep }));

const transaction = { commit: vi.fn(), rollback: vi.fn() };
const sequelize = {
  transaction: vi.fn(async (callback) => {
    try {
      const result = await callback(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }),
};

const app = express();
app.use(express.json());
app.use('/cases', casesCloneRoute(sequelize));

const sourceCase = (attributes) => ({
  ...attributes,
  Steps: [],
  get: () => ({ ...attributes, Steps: [] }),
});

describe('case clone ordering', () => {
  let sourceCases;
  let targetCases;
  let nextCaseId;

  beforeEach(() => {
    vi.clearAllMocks();
    sourceCases = [
      sourceCase({ id: 20, folderId: 7, position: 1, title: 'First', template: 0 }),
      sourceCase({ id: 10, folderId: 7, position: 2, title: 'Second', template: 0 }),
    ];
    targetCases = [{ id: 90, folderId: 8, position: 1, title: 'Existing' }];
    nextCaseId = 100;

    mockFolder.findByPk.mockResolvedValue({ id: 8, projectId: 5 });
    mockCase.findAll.mockImplementation(async ({ where }) => {
      if (where?.id) return sourceCases;
      if (Number(where?.folderId) === 8) {
        return [...targetCases].sort((left, right) => left.position - right.position || left.id - right.id);
      }
      return [];
    });
    mockCase.create.mockImplementation(async (attributes) => {
      const createdCase = { ...attributes, id: nextCaseId++ };
      targetCases.push(createdCase);
      return createdCase;
    });
    mockCase.findByPk.mockImplementation(async (id) => targetCases.find((testcase) => testcase.id === Number(id)));
    mockCase.update.mockImplementation(async (attributes, { where }) => {
      const testcase = targetCases.find((row) => row.id === Number(where.id));
      if (!testcase) return [0];
      Object.assign(testcase, attributes);
      return [1];
    });
  });

  it('reads source order and appends new immutable cases to the target', async () => {
    const response = await request(app)
      .post('/cases/clone?projectId=5')
      .send({ caseIds: [10, 20], targetFolderId: 8 });

    expect(response.status).toBe(200);
    expect(mockCase.findAll).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: [10, 20] },
        order: [
          ['position', 'ASC'],
          ['id', 'ASC'],
        ],
      })
    );
    expect(mockCase.create.mock.calls.map(([attributes]) => attributes.title)).toEqual(['First', 'Second']);
    expect(mockCase.create.mock.calls.every(([attributes]) => attributes.position < 0)).toBe(true);
    expect(mockCase.create.mock.calls.every(([attributes]) => !('id' in attributes))).toBe(true);
    expect(mockCase.create.mock.calls.map(([attributes]) => attributes.folderId)).toEqual([8, 8]);
    expect(
      [...targetCases]
        .sort((left, right) => left.position - right.position)
        .map(({ id, position }) => ({ id, position }))
    ).toEqual([
      { id: 90, position: 1 },
      { id: 100, position: 2 },
      { id: 101, position: 3 },
    ]);
    expect(sourceCases.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 20, position: 1 },
      { id: 10, position: 2 },
    ]);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
