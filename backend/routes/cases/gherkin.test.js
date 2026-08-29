import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import stepsEditRoute from '../steps/edit.js';
import casesCloneRoute from './clone.js';
import casesEditRoute from './edit.js';
import casesNewRoute from './new.js';
import casesShowRoute from './show.js';
const mockLintGherkinFeature = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../automation/domain/index.js', () => ({
  composeCanonicalSnapshot: vi.fn(({ id, title, automationVersion, gherkinExamples, Steps }) => {
    const examplesValid =
      gherkinExamples === null ||
      gherkinExamples === undefined ||
      (Array.isArray(gherkinExamples.headers) &&
        Array.isArray(gherkinExamples.rows) &&
        gherkinExamples.rows.every((row) => Array.isArray(row) && row.length === gherkinExamples.headers.length));
    if (!examplesValid) {
      return { ok: false, errors: [{ field: 'gherkinExamples', code: 'invalid', message: 'invalid examples' }] };
    }
    return {
      ok: true,
      snapshot: {
        caseId: Number(id),
        title,
        version: Number(automationVersion ?? 1),
        feature: `Feature: ${title}\n\n  Scenario: ${title}\n${Steps.map((step) => `    ${step.caseSteps.keyword} ${step.step}`).join('\n')}\n`,
        steps: Steps,
        examples: gherkinExamples ?? null,
        hash: 'test-hash',
      },
    };
  }),
}));
vi.mock('../../automation/infrastructure/gherkin-lint.js', () => ({ lintGherkinFeature: mockLintGherkinFeature }));
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
const sequelize = {
  transaction: vi.fn(async (callback) => {
    if (!callback) return transaction;
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  }),
};
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
  mockLintGherkinFeature.mockResolvedValue([]);
  nextStepId = 100;
  mockCase.findByPk.mockResolvedValue({ id: 42, template: 1, title: 'Login', automationVersion: 1, update: vi.fn() });
  mockCase.create.mockResolvedValue({ id: 42, template: 2 });
  mockStep.create.mockImplementation(async (attributes) => ({ id: nextStepId++, ...attributes }));
  mockStep.bulkCreate.mockResolvedValue([{ id: 101 }, { id: 102 }]);
});
describe('Gherkin case persistence', () => {
  it('seeds ordered Given, When, Then rows in the Scenario section for template 2', async () => {
    const response = await request(app)
      .post('/cases?folderId=7')
      .send({ title: 'Login', state: 0, priority: 2, type: 0, automationStatus: 0, template: 2 });

    expect(response.status).toBe(200);
    expect(sequelize.transaction).toHaveBeenCalledOnce();
    expect(mockCaseStep.create.mock.calls.map(([attributes]) => attributes)).toEqual([
      { caseId: 42, stepId: 100, stepNo: 1, keyword: 'given', section: 'scenario' },
      { caseId: 42, stepId: 101, stepNo: 2, keyword: 'when', section: 'scenario' },
      { caseId: 42, stepId: 102, stepNo: 3, keyword: 'then', section: 'scenario' },
    ]);
  });
  it('persists reordered and repeated keywords on save', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, title: 'Login', automationVersion: 1 });
    const steps = [
      {
        id: 10,
        step: 'Then text',
        result: 'Then result',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        uid: 'ui-10',
        editState: 'changed',
        caseSteps: { stepNo: 1, keyword: 'then', section: 'scenario', CaseId: 42, StepId: 10 },
      },
      {
        id: 11,
        step: 'When text',
        result: 'When result',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        uid: 'ui-11',
        editState: 'notChanged',
        caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario', CaseId: 42, StepId: 11 },
      },
      {
        id: 12,
        step: 'Given text',
        result: 'Given result',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        uid: 'ui-12',
        editState: 'new',
        caseSteps: { stepNo: 3, keyword: 'given', section: 'scenario', CaseId: 42, StepId: 12 },
      },
    ];
    const response = await request(app).post('/steps/update?caseId=42').send(steps);
    expect(response.status).toBe(200);
    expect(mockStep.update).toHaveBeenCalledWith(
      { step: 'Then text', result: 'Then result' },
      expect.objectContaining({ where: { id: 10 }, transaction })
    );
    expect(mockCaseStep.update).toHaveBeenCalledWith(
      { stepNo: 1, keyword: 'then', section: 'scenario' },
      expect.objectContaining({ where: { stepId: 10 }, transaction })
    );
    expect(mockCaseStep.create).toHaveBeenCalledWith(
      { caseId: '42', stepId: 100, stepNo: 3, keyword: 'given', section: 'scenario' },
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
  it('persists And and But as row keywords without changing their step text', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, title: 'Login', automationVersion: 1 });
    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        {
          id: 10,
          step: 'Given text',
          result: 'legacy',
          editState: 'changed',
          caseSteps: { stepNo: 1, keyword: 'given' },
        },
        {
          id: 11,
          step: 'When text',
          result: 'legacy',
          editState: 'changed',
          caseSteps: { stepNo: 2, keyword: 'when' },
        },
        { id: 12, step: 'And text', result: 'legacy', editState: 'changed', caseSteps: { stepNo: 3, keyword: 'and' } },
        { id: 13, step: 'But text', result: 'legacy', editState: 'changed', caseSteps: { stepNo: 4, keyword: 'but' } },
        {
          id: 14,
          step: 'Then text',
          result: 'legacy',
          editState: 'changed',
          caseSteps: { stepNo: 5, keyword: 'then' },
        },
      ]);

    expect(response.status).toBe(200);
    expect(mockCaseStep.update).toHaveBeenCalledWith(
      { stepNo: 3, keyword: 'and', section: 'scenario' },
      expect.objectContaining({ where: { stepId: 12 }, transaction })
    );
    expect(mockCaseStep.update).toHaveBeenCalledWith(
      { stepNo: 4, keyword: 'but', section: 'scenario' },
      expect.objectContaining({ where: { stepId: 13 }, transaction })
    );
  });
  it('preserves background rows without discarding them', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, title: 'Login', automationVersion: 1 });
    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        {
          id: 10,
          step: 'Given text',
          result: '',
          editState: 'changed',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'background' },
        },
        {
          id: 11,
          step: 'When text',
          result: '',
          editState: 'notChanged',
          caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' },
        },
        {
          id: 12,
          step: 'Then text',
          result: '',
          editState: 'notChanged',
          caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' },
        },
      ]);

    expect(response.status).toBe(200);
    expect(mockCaseStep.update).toHaveBeenCalledWith(
      { stepNo: 1, keyword: 'given', section: 'background' },
      expect.objectContaining({ where: { stepId: 10 }, transaction })
    );
    expect(mockCaseStep.update).toHaveBeenCalledTimes(1);
    expect(mockCaseStep.create).not.toHaveBeenCalled();
  });
  it('bumps the automation revision after saving gherkin steps', async () => {
    const update = vi.fn();
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, title: 'Login', automationVersion: 4, update });
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
    mockCase.findByPk.mockResolvedValue({
      id: 42,
      template: 2,
      title: 'Login',
      automationVersion: 2,
      Steps: [
        { id: 10, step: 'Given text', result: '', editState: 'notChanged', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When text', result: '', editState: 'notChanged', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 12, step: 'Then text', result: '', editState: 'notChanged', caseSteps: { stepNo: 3, keyword: 'then' } },
      ],
      update,
    });
    const response = await request(app).put('/cases/42').send({ title: 'Renamed', template: 2 });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ automationVersion: 3 }));
  });
  it('updates case metadata and steps in the same transaction', async () => {
    const update = vi.fn();
    mockCase.findByPk.mockResolvedValue({
      id: 42,
      template: 2,
      title: 'Login',
      automationVersion: 1,
      update,
    });
    const response = await request(app)
      .put('/cases/42')
      .send({
        title: 'Renamed',
        template: 2,
        Steps: [
          { id: 10, step: 'Given text', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'given' } },
          { id: 11, step: 'When text', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'when' } },
          { id: 12, step: 'Then text', result: '', editState: 'changed', caseSteps: { stepNo: 3, keyword: 'then' } },
        ],
      });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed', automationVersion: 2 }), {
      transaction,
    });
    expect(mockStep.update).toHaveBeenCalled();
    expect(mockCaseStep.update).toHaveBeenCalled();
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
  it('persists Scenario Outline examples and rejects incomplete tables', async () => {
    const update = vi.fn();
    mockCase.findByPk.mockResolvedValue({
      id: 42,
      template: 2,
      title: 'Login',
      automationVersion: 1,
      Steps: [
        { id: 10, step: 'Given text', result: '', editState: 'notChanged', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When text', result: '', editState: 'notChanged', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 12, step: 'Then text', result: '', editState: 'notChanged', caseSteps: { stepNo: 3, keyword: 'then' } },
      ],
      update,
    });
    const examples = { headers: ['user', 'role'], rows: [['Ada', 'admin']] };

    const saved = await request(app).put('/cases/42').send({ template: 2, gherkinExamples: examples });
    expect(saved.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ gherkinExamples: examples, automationVersion: 2 }));

    vi.clearAllMocks();
    mockCase.findByPk.mockResolvedValue({
      id: 42,
      template: 2,
      title: 'Login',
      automationVersion: 1,
      Steps: [
        { id: 10, step: 'Given text', result: '', editState: 'notChanged', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When text', result: '', editState: 'notChanged', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 12, step: 'Then text', result: '', editState: 'notChanged', caseSteps: { stepNo: 3, keyword: 'then' } },
      ],
      update,
    });
    const invalid = await request(app)
      .put('/cases/42')
      .send({ template: 2, gherkinExamples: { headers: ['user', 'role'], rows: [['Ada']] } });
    expect(invalid.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([
    { label: 'missing', keyword: undefined },
    { label: 'unsupported', keyword: 'invalid' },
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
  it('rejects a malformed frontend-shaped row before opening a transaction', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2 });
    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        {
          id: 10,
          step: 'text',
          result: null,
          uid: 'ui-10',
          editState: 'changed',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'background' },
        },
      ]);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('step and result must be strings');
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
  it('rejects duplicate or non-positive Gherkin step orders before opening a transaction', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2 });
    const duplicate = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        { id: 10, step: 'Given', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'when' } },
        { id: 12, step: 'Then', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'then' } },
      ]);

    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toBe('Gherkin step order must be unique, consecutive, and positive');
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(mockStep.update).not.toHaveBeenCalled();
    expect(mockCaseStep.update).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2 });
    const nonPositive = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        { id: 10, step: 'Given', result: '', editState: 'changed', caseSteps: { stepNo: 0, keyword: 'given' } },
        { id: 11, step: 'When', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'when' } },
        { id: 12, step: 'Then', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'then' } },
      ]);

    expect(nonPositive.status).toBe(400);
    expect(nonPositive.body.error).toContain('stepNo must be a positive integer');
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
  it('rejects invalid Gherkin order on case update before writing case metadata', async () => {
    const update = vi.fn();
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, update });
    const response = await request(app)
      .put('/cases/42')
      .send({
        template: 2,
        Steps: [
          { id: 10, step: 'Given', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'given' } },
          { id: 11, step: 'When', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'when' } },
          { id: 12, step: 'Then', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'then' } },
        ],
      });

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects invalid sections and preserves valid background metadata', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2 });
    const invalidSection = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        {
          id: 10,
          step: 'Given',
          result: '',
          editState: 'changed',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'outline' },
        },
        {
          id: 11,
          step: 'When',
          result: '',
          editState: 'changed',
          caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' },
        },
        {
          id: 12,
          step: 'Then',
          result: '',
          editState: 'changed',
          caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' },
        },
      ]);
    expect(invalidSection.status).toBe(400);

    const legacyBackground = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        {
          id: 10,
          step: 'Given',
          result: '',
          editState: 'changed',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'background' },
        },
        {
          id: 11,
          step: 'When',
          result: '',
          editState: 'changed',
          caseSteps: { stepNo: 2, keyword: 'when', section: 'background' },
        },
        {
          id: 12,
          step: 'Then',
          result: '',
          editState: 'changed',
          caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' },
        },
      ]);
    expect(legacyBackground.status).toBe(200);
    expect(mockCaseStep.update).toHaveBeenCalledWith(
      { stepNo: 1, keyword: 'given', section: 'background' },
      expect.objectContaining({ where: { stepId: 10 }, transaction })
    );
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
          expect.objectContaining({ model: mockStep, through: { attributes: ['stepNo', 'keyword', 'section'] } }),
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
        { caseId: 99, stepId: 101, stepNo: 1, keyword: 'then', section: 'scenario' },
        { caseId: 99, stepId: 102, stepNo: 2, keyword: 'given', section: 'scenario' },
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
    expect(mockCaseStep.create.mock.calls[0][0]).toMatchObject({ keyword: null, section: 'scenario' });
  });
  it('returns structured server lint failures without opening a transaction', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, title: 'Login', automationVersion: 1 });
    mockLintGherkinFeature.mockResolvedValue([
      { line: 4, rule: 'no-trailing-spaces', message: 'Trailing spaces are not allowed' },
    ]);

    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        { id: 10, step: 'Given text', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When text', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 12, step: 'Then text', result: '', editState: 'changed', caseSteps: { stepNo: 3, keyword: 'then' } },
      ]);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Gherkin lint failed',
      code: 'gherkin_lint_failed',
      fields: [{ field: 'line 4', code: 'no-trailing-spaces', message: 'Trailing spaces are not allowed' }],
    });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
  it('returns service unavailable when server lint cannot run', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, title: 'Login', automationVersion: 1 });
    mockLintGherkinFeature.mockRejectedValue(
      Object.assign(new Error('module unavailable'), { code: 'gherkin_lint_unavailable' })
    );

    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        { id: 10, step: 'Given text', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When text', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 12, step: 'Then text', result: '', editState: 'changed', caseSteps: { stepNo: 3, keyword: 'then' } },
      ]);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Gherkin lint is unavailable', code: 'gherkin_lint_unavailable' });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('returns parser failures as structured lint fields without opening a transaction', async () => {
    mockCase.findByPk.mockResolvedValue({ id: 42, template: 2, title: 'Login', automationVersion: 1 });
    mockLintGherkinFeature.mockResolvedValue([
      { line: 8, rule: 'unexpected-error', message: 'Expected a Scenario near the end' },
    ]);

    const response = await request(app)
      .post('/steps/update?caseId=42')
      .send([
        { id: 10, step: 'Given text', result: '', editState: 'changed', caseSteps: { stepNo: 1, keyword: 'given' } },
        { id: 11, step: 'When text', result: '', editState: 'changed', caseSteps: { stepNo: 2, keyword: 'when' } },
        { id: 12, step: 'Then text', result: '', editState: 'changed', caseSteps: { stepNo: 3, keyword: 'then' } },
      ]);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Gherkin lint failed',
      code: 'gherkin_lint_failed',
      fields: [{ field: 'line 8', code: 'unexpected-error', message: 'Expected a Scenario near the end' }],
    });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
});
