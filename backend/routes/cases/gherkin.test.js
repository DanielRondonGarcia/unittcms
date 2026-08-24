import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Sequelize } from 'sequelize';
import stepsEditRoute from '../steps/edit.js';
import casesCloneRoute from './clone.js';
import casesEditRoute from './edit.js';
import casesNewRoute from './new.js';
import casesShowRoute from './show.js';
vi.mock('../../middleware/auth.js', () => ({
  default: () => ({
    verifySignedIn: (req, res, next) => next(),
  }),
}));
vi.mock('../../middleware/verifyEditable.js', () => ({
  default: () => ({
    verifyProjectDeveloperFromFolderId: (req, res, next) => next(),
    verifyProjectDeveloperFromCaseId: (req, res, next) => next(),
    verifyProjectDeveloperFromProjectId: (req, res, next) => next(),
  }),
}));
vi.mock('../../middleware/verifyVisible.js', () => ({
  default: () => ({
    verifyProjectVisibleFromCaseId: (req, res, next) => next(),
  }),
}));
const mockCase = {
  create: vi.fn(),
  findAll: vi.fn(),
  findByPk: vi.fn(),
  belongsToMany: vi.fn(),
  hasMany: vi.fn(),
};
vi.mock('../../models/cases.js', () => ({ default: () => mockCase }));
const mockStep = {
  create: vi.fn(),
  bulkCreate: vi.fn(),
  update: vi.fn(),
  belongsToMany: vi.fn(),
};
vi.mock('../../models/steps.js', () => ({ default: () => mockStep }));
const mockCaseStep = {
  create: vi.fn(),
  bulkCreate: vi.fn(),
  update: vi.fn(),
};
vi.mock('../../models/caseSteps.js', () => ({ default: () => mockCaseStep }));
const mockTags = { belongsToMany: vi.fn() };
vi.mock('../../models/tags.js', () => ({ default: () => mockTags }));
const mockAttachment = { belongsToMany: vi.fn() };
vi.mock('../../models/attachments.js', () => ({ default: () => mockAttachment }));
const mockRunCase = { belongsTo: vi.fn() };
vi.mock('../../models/runCases.js', () => ({ default: () => mockRunCase }));
const transaction = { commit: vi.fn(), rollback: vi.fn() };
const sequelize = new Sequelize({ dialect: 'sqlite', logging: false });
sequelize.transaction = vi.fn(async (callback) => {
  if (!callback) return transaction;
  const result = await callback(transaction);
  await transaction.commit();
  return result;
});
const app = express();
app.use(express.json());
let nextStepId = 100;
beforeAll(() => {
  app.use('/cases', casesNewRoute(sequelize));
  app.use('/cases', casesEditRoute(sequelize));
  app.use('/cases', casesShowRoute(sequelize));
  app.use('/cases', casesCloneRoute(sequelize));
  app.use('/steps', stepsEditRoute(sequelize));
});
beforeEach(() => {
  vi.clearAllMocks();
  nextStepId = 100;
  mockCase.findByPk.mockResolvedValue({ id: 42, template: 1, update: vi.fn() });
  mockCase.create.mockResolvedValue({ id: 42, template: 2 });
  mockStep.create.mockImplementation(async (attributes) => ({ id: nextStepId++, ...attributes }));
  mockStep.bulkCreate.mockResolvedValue([{ id: 101 }, { id: 102 }]);
});
describe('Gherkin case persistence', () => {
  it('seeds ordered given, when, then rows for template 2', async () => {
    const response = await request(app)
      .post('/cases?folderId=7')
      .send({ title: 'Login', state: 0, priority: 2, type: 0, automationStatus: 0, template: 2 });

    expect(response.status).toBe(200);
    expect(sequelize.transaction).toHaveBeenCalledOnce();
    expect(mockCaseStep.create.mock.calls.map(([attributes]) => attributes)).toEqual([
      { caseId: 42, stepId: 100, stepNo: 1, keyword: 'given' },
      { caseId: 42, stepId: 101, stepNo: 2, keyword: 'when' },
      { caseId: 42, stepId: 102, stepNo: 3, keyword: 'then' },
    ]);
  });
  it('persists reordered and repeated keywords on save', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2 });
    const steps = [
      { id: 10, step: 'Then text', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'then' } },
      { id: 11, step: 'Given text', result: '', editState: 'notChanged', caseSteps: { stepNo: 2, keyword: 'given' } },
      { id: 12, step: 'Given again', result: '', editState: 'new', caseSteps: { stepNo: 3, keyword: 'given' } },
    ];
    const response = await request(app).post('/steps/update?caseId=42').send(steps);
    expect(response.status).toBe(200);
    expect(mockCaseStep.update).toHaveBeenCalledWith(
      { stepNo: 1, keyword: 'then' },
      expect.objectContaining({ where: { stepId: 10 }, transaction })
    );
    expect(mockCaseStep.create).toHaveBeenCalledWith(
      { caseId: '42', stepId: 100, stepNo: 3, keyword: 'given' },
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
  it('bumps the automation revision after saving gherkin steps', async () => {
    const update = vi.fn();
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, automationVersion: 4, update });
    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        { id: 10, step: 'Given text', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When text', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 12, step: 'Then text', result: '', editState: 'changed', caseSteps: { stepNo: 3, keyword: 'then' } },
      ]);
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ automationVersion: 5 }, { transaction });
  });
  it('bumps the automation revision when a gherkin case changes', async () => {
    const update = vi.fn();
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, automationVersion: 2, update });
    const response = await request(app).put('/cases/42').send({ title: 'Renamed', template: 2 });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ automationVersion: 3 }));
  });
  it.each([
    { label: 'missing', keyword: undefined },
    { label: 'unsupported', keyword: 'and' },
  ])('rejects $label keyword without committing rows', async ({ keyword }) => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2 });
    const caseSteps = { stepNo: 1 };
    if (keyword !== undefined) caseSteps.keyword = keyword;

    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([{ id: 10, step: 'text', result: '', editState: 'changed', caseSteps }]);
    expect(response.status).toBe(400);
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(mockStep.update).not.toHaveBeenCalled();
    expect(mockCaseStep.update).not.toHaveBeenCalled();
  });
  it('rejects invalid metadata during case edit before updating the case', async () => {
    const update = vi.fn();
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, update });

    const response = await request(app)
      .put('/cases/42')
      .send({ template: 2, Steps: [{ id: 10, editState: 'changed', caseSteps: { stepNo: 1, keyword: 'and' } }] });
    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('shows keyword metadata with each case step', async () => {
    const testcase = { id: 42, template: 2, Steps: [{ id: 10, caseSteps: { stepNo: 1, keyword: 'given' } }] };
    mockCase.findByPk.mockResolvedValue(testcase);

    const response = await request(app).get('/cases/42');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(testcase);
    expect(mockCase.findByPk).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({ model: mockStep, through: { attributes: ['stepNo', 'keyword'] } }),
        ]),
      })
    );
  });
  it('clones keyword metadata and step order transactionally', async () => {
    const sourceCase = {
      id: 42,
      folderId: 7,
      template: 2,
      Steps: [
        { id: 10, step: 'Then', result: '', caseSteps: { stepNo: 1, keyword: 'then' } },
        { id: 11, step: 'Given', result: '', caseSteps: { stepNo: 2, keyword: 'given' } },
      ],
      get: () => sourceCase,
    };
    mockCase.findAll.mockResolvedValue([sourceCase]);
    mockCase.create.mockResolvedValue({ id: 99 });

    const response = await request(app)
      .post('/cases/clone?projectId=5')
      .send({ caseIds: [42], targetFolderId: 8 });
    expect(response.status).toBe(200);
    expect(mockCaseStep.bulkCreate).toHaveBeenCalledWith(
      [
        { caseId: 99, stepId: 101, stepNo: 1, keyword: 'then' },
        { caseId: 99, stepId: 102, stepNo: 2, keyword: 'given' },
      ],
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
  it.each([0, 1])('keeps keyword nullable for legacy template %s rows', async (template) => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template });

    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([{ id: 10, step: 'legacy', result: '', editState: 'new', caseSteps: { stepNo: 1 } }]);
    expect(response.status).toBe(200);
    expect(mockCaseStep.create.mock.calls[0][0].keyword ?? null).toBeNull();
  });
});
