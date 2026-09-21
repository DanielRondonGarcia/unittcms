import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Sequelize } from 'sequelize';
import casesIndexByProjectIdRoute from './indexByProjectId';

vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: vi.fn((req, res, next) => {
      req.userId = 1;
      next();
    }),
  }),
}));

vi.mock('../../middleware/verifyVisible.js', () => ({
  default: () => ({
    verifyProjectVisibleFromProjectId: vi.fn((req, res, next) => {
      next();
    }),
    verifyProjectVisibleFromRunId: vi.fn((req, res, next) => {
      next();
    }),
  }),
}));

const mockProject = {
  hasMany: vi.fn(),
};
vi.mock('../../models/projects.js', () => ({
  default: () => mockProject,
}));

const mockFolder = {
  hasMany: vi.fn(),
  belongsTo: vi.fn(),
};
vi.mock('../../models/folders.js', () => ({
  default: () => mockFolder,
}));

const mockCase = {
  findAll: vi.fn(),
  belongsTo: vi.fn(),
  hasMany: vi.fn(),
  belongsToMany: vi.fn(),
};
vi.mock('../../models/cases.js', () => ({
  default: () => mockCase,
}));

const mockRunCase = {
  belongsTo: vi.fn(),
};
vi.mock('../../models/runCases.js', () => ({
  default: () => mockRunCase,
}));

const mockTags = {
  belongsToMany: vi.fn(),
};
vi.mock('../../models/tags.js', () => ({
  default: () => mockTags,
}));

describe('GET /cases/byproject', () => {
  let app;
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    logging: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/cases', casesIndexByProjectIdRoute(sequelize));
  });

  it('orders project case lists by folder, position, and case id', async () => {
    mockCase.findAll.mockResolvedValue([{ id: 1 }]);

    const res = await request(app).get('/cases/byproject?projectId=1&runId=2');

    expect(res.status).toBe(200);
    const findAllOptions = mockCase.findAll.mock.calls[0][0];
    expect(findAllOptions.order).toEqual([
      ['folderId', 'ASC'],
      ['position', 'ASC'],
      ['id', 'ASC'],
    ]);
    expect(res.body).toEqual([{ id: 1 }]);
  });
});
