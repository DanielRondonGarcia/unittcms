import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import foldersCloneRoute from './clone.js';

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: (req, res, next) => next(),
  }),
}));

vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectDeveloperFromFolderId: (req, res, next) => next(),
  }),
}));

const mockFolder = {
  create: vi.fn(),
  findAll: vi.fn(),
  findByPk: vi.fn(),
};
vi.mock('../../models/folders.js', () => ({ default: () => mockFolder }));

const mockCase = {
  create: vi.fn(),
  findAll: vi.fn(),
  findByPk: vi.fn(),
  update: vi.fn(),
  belongsTo: vi.fn(),
  belongsToMany: vi.fn(),
};
vi.mock('../../models/cases.js', () => ({ default: () => mockCase }));

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
app.use('/folders', foldersCloneRoute(sequelize));

const sourceCase = (attributes) => ({
  ...attributes,
  Steps: [],
  get: () => ({ ...attributes, Steps: [] }),
});

describe('folder clone ordering', () => {
  let folders;
  let casesByFolder;
  let nextFolderId;
  let nextCaseId;

  beforeEach(() => {
    vi.clearAllMocks();
    folders = [
      { id: 1, name: 'Source', detail: 'Root', projectId: 5 },
      { id: 2, name: 'Child', detail: 'Nested', parentFolderId: 1, projectId: 5 },
      { id: 99, name: 'Target', detail: 'Destination', projectId: 5 },
    ];
    casesByFolder = new Map([
      [
        1,
        [
          sourceCase({ id: 20, folderId: 1, position: 1, title: 'Root first', template: 0 }),
          sourceCase({ id: 10, folderId: 1, position: 2, title: 'Root second', template: 0 }),
        ],
      ],
      [2, [sourceCase({ id: 30, folderId: 2, position: 1, title: 'Child first', template: 0 })]],
    ]);
    nextFolderId = 100;
    nextCaseId = 200;

    mockFolder.findByPk.mockImplementation(async (id) => folders.find((folder) => folder.id === Number(id)));
    mockFolder.create.mockImplementation(async (attributes) => {
      const clonedFolder = { ...attributes, id: nextFolderId++ };
      folders.push(clonedFolder);
      casesByFolder.set(clonedFolder.id, []);
      return clonedFolder;
    });
    mockFolder.findAll.mockImplementation(async ({ where }) => {
      const children = folders.filter((folder) => folder.parentFolderId === Number(where.parentFolderId));
      return children.sort((left, right) => left.id - right.id);
    });

    mockCase.findAll.mockImplementation(async ({ where }) => {
      const rows = casesByFolder.get(Number(where.folderId)) ?? [];
      return [...rows].sort((left, right) => left.position - right.position || left.id - right.id);
    });
    mockCase.create.mockImplementation(async (attributes) => {
      const createdCase = { ...attributes, id: nextCaseId++ };
      casesByFolder.get(Number(attributes.folderId)).push(createdCase);
      return createdCase;
    });
    mockCase.findByPk.mockImplementation(async (id) => {
      for (const rows of casesByFolder.values()) {
        const found = rows.find((testcase) => testcase.id === Number(id));
        if (found) return found;
      }
      return null;
    });
    mockCase.update.mockImplementation(async (attributes, { where }) => {
      for (const rows of casesByFolder.values()) {
        const testcase = rows.find((row) => row.id === Number(where.id));
        if (testcase) {
          Object.assign(testcase, attributes);
          return [1];
        }
      }
      return [0];
    });
  });

  it('recursively clones each folder in canonical case order with fresh positions', async () => {
    const response = await request(app).post('/folders/1/clone').send({ targetFolderId: 99 });

    expect(response.status).toBe(201);
    expect(mockFolder.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentFolderId: 1 }, order: [['id', 'ASC']], transaction })
    );
    expect(mockCase.findAll).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { folderId: 1 },
        order: [
          ['position', 'ASC'],
          ['id', 'ASC'],
        ],
      })
    );
    expect(mockCase.create.mock.calls.map(([attributes]) => attributes.title)).toEqual([
      'Root first',
      'Root second',
      'Child first',
    ]);
    expect(mockCase.create.mock.calls.map(([attributes]) => attributes.folderId)).toEqual([100, 100, 101]);
    expect(mockCase.create.mock.calls.every(([attributes]) => attributes.position < 0)).toBe(true);
    expect(mockCase.create.mock.calls.every(([attributes]) => !('id' in attributes))).toBe(true);
    expect(casesByFolder.get(100).map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 200, position: 1 },
      { id: 201, position: 2 },
    ]);
    expect(casesByFolder.get(101).map(({ id, position }) => ({ id, position }))).toEqual([{ id: 202, position: 1 }]);
    expect(casesByFolder.get(1).map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 20, position: 1 },
      { id: 10, position: 2 },
    ]);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
