/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op } from 'sequelize';
import { describe, expect, it, vi } from 'vitest';
import { registerMcpOperations } from './operations.js';

vi.mock('../routes/steps/persistence.js', () => {
  class MockCaseSaveValidationError extends Error {
    code: string;
    fields: RecordValue[];
    status: number;

    constructor(code: string) {
      super(code);
      this.code = code;
      this.fields = [];
      this.status = 400;
    }
  }

  const validateAndNormalizeCaseSteps = vi.fn(async ({ template, steps }: RecordValue) => {
    if (!Array.isArray(steps)) throw new MockCaseSaveValidationError('steps_invalid');
    if (template === 2) {
      const keywords = new Set(
        steps.filter((step) => step?.editState !== 'deleted').map((step) => step?.caseSteps?.keyword)
      );
      if (!['given', 'when', 'then'].every((keyword) => keywords.has(keyword))) {
        throw new MockCaseSaveValidationError('keywords_invalid');
      }
    }
    return { steps };
  });
  const persistCaseSteps = vi.fn(async ({ steps, Step, CaseStep, transaction }: RecordValue) => {
    for (const step of steps) {
      if (step.editState !== 'changed') continue;
      await Step.update({ step: step.step, result: step.result }, { where: { id: step.id }, transaction });
      await CaseStep.update(
        {
          stepNo: step.caseSteps.stepNo,
          keyword: step.caseSteps.keyword ?? null,
          section: step.caseSteps.section ?? 'scenario',
        },
        { where: { stepId: step.id }, transaction }
      );
    }
    return steps;
  });
  return { CaseSaveValidationError: MockCaseSaveValidationError, persistCaseSteps, validateAndNormalizeCaseSteps };
});

type RecordValue = Record<string, any>;

function model() {
  return {
    findByPk: vi.fn(async () => null),
    findOne: vi.fn(async () => null),
    findAll: vi.fn(async () => []),
    create: vi.fn(async (values: RecordValue) => values),
    findOrCreate: vi.fn(async () => [{ id: 1 }]),
    update: vi.fn(async () => [1]),
    destroy: vi.fn(async () => 1),
    bulkCreate: vi.fn(async (values: RecordValue[]) => values),
  };
}

function record(values: RecordValue): RecordValue {
  const value: RecordValue = { ...values };
  value.update = vi.fn(async (updates: RecordValue) => {
    Object.assign(value, updates);
    return value;
  });
  return value;
}

function harness() {
  const project1 = record({ id: 1, name: 'Project one', userId: 7, isPublic: false });
  const project2 = record({ id: 2, name: 'Project two', userId: 8, isPublic: false });
  const folder1 = record({ id: 11, name: 'Folder one', detail: null, projectId: 1, parentFolderId: null });
  const folder2 = record({ id: 12, name: 'Folder two', detail: null, projectId: 2, parentFolderId: null });
  const folder3 = record({ id: 13, name: 'Folder three', detail: null, projectId: 1, parentFolderId: null });
  const case1 = record({
    id: 21,
    title: 'Case one',
    state: 0,
    priority: 2,
    type: 0,
    automationStatus: 0,
    template: 0,
    automationVersion: 1,
    folderId: 11,
    gherkinExamples: null,
  });
  const case2 = record({ id: 22, title: 'Case two', template: 0, automationVersion: 1, folderId: 12 });
  const tag1 = record({ id: 31, name: 'frontend', projectId: 1 });
  const tag2 = record({ id: 32, name: 'backend', projectId: 2 });
  const run1 = record({ id: 41, name: 'Run one', projectId: 1, state: 0 });
  const step1 = record({ id: 51, step: 'the user is signed out', result: 'ok' });
  const step2 = record({ id: 52, step: 'the user opens login', result: 'ok' });
  const step3 = record({ id: 53, step: 'the dashboard is shown', result: 'ok' });
  const caseStepLinks: RecordValue[] = [
    { caseId: 21, stepId: 51, stepNo: 1, keyword: 'given', section: 'scenario' },
    { caseId: 21, stepId: 52, stepNo: 2, keyword: 'when', section: 'scenario' },
    { caseId: 21, stepId: 53, stepNo: 3, keyword: 'then', section: 'scenario' },
  ];
  const projects = new Map([
    [1, project1],
    [2, project2],
  ]);
  const folders = new Map([
    [11, folder1],
    [12, folder2],
    [13, folder3],
  ]);
  const cases = new Map([
    [21, case1],
    [22, case2],
  ]);
  const tags = new Map([
    [31, tag1],
    [32, tag2],
  ]);
  const memberships = new Map<string, number>();
  const models = {
    Project: model(),
    Member: model(),
    Organization: model(),
    Folder: model(),
    Case: model(),
    Step: model(),
    CaseStep: model(),
    Tags: model(),
    caseTags: model(),
    Run: model(),
  } as Record<string, ReturnType<typeof model>>;

  models.Project.findByPk.mockImplementation(async (id: number) => projects.get(Number(id)) ?? null);
  models.Member.findOne.mockImplementation(async ({ where }: RecordValue) => {
    const role = memberships.get(`${Number(where.projectId)}:${Number(where.userId)}`);
    return role === undefined ? null : { projectId: Number(where.projectId), userId: Number(where.userId), role };
  });
  models.Folder.findByPk.mockImplementation(async (id: number) => folders.get(Number(id)) ?? null);
  models.Folder.findAll.mockImplementation(async ({ where }: RecordValue) => {
    if (where?.projectId !== undefined)
      return [...folders.values()].filter((folder) => folder.projectId === Number(where.projectId));
    const ids = where?.id?.[Op.in] as number[] | undefined;
    if (ids) return [...folders.values()].filter((folder) => ids.includes(Number(folder.id)));
    return [...folders.values()];
  });
  models.Case.findByPk.mockImplementation(async (id: number) => cases.get(Number(id)) ?? null);
  models.Case.findAll.mockImplementation(async ({ where }: RecordValue) => {
    const ids = where?.id?.[Op.in] as number[] | undefined;
    if (ids) return [...cases.values()].filter((testcase) => ids.includes(Number(testcase.id)));
    const folderIds = where?.folderId?.[Op.in] as number[] | undefined;
    if (folderIds) return [...cases.values()].filter((testcase) => folderIds.includes(Number(testcase.folderId)));
    return [...cases.values()];
  });
  models.Case.create.mockImplementation(async (values: RecordValue) => {
    const created = record({ ...values, id: 23 });
    cases.set(23, created);
    return created;
  });
  models.Step.findAll.mockImplementation(async ({ where }: RecordValue) => {
    const ids = where?.id?.[Op.in] as number[] | undefined;
    const values = [step1, step2, step3];
    return ids ? values.filter((step) => ids.includes(Number(step.id))) : values;
  });
  models.Step.create.mockImplementation(async (values: RecordValue) => record({ ...values, id: 60 }));
  models.CaseStep.findAll.mockImplementation(async ({ where }: RecordValue) => {
    const values = caseStepLinks.filter((link) => {
      if (where?.caseId !== undefined && Number(link.caseId) !== Number(where.caseId)) return false;
      const ids = where?.stepId?.[Op.in] as number[] | undefined;
      return !ids || ids.includes(Number(link.stepId));
    });
    return values;
  });
  models.Tags.findByPk.mockImplementation(async (id: number) => tags.get(Number(id)) ?? null);
  models.Tags.findAll.mockImplementation(async ({ where }: RecordValue) => {
    const ids = where?.id?.[Op.in] as number[] | undefined;
    return [...tags.values()].filter(
      (tag) =>
        (!ids || ids.includes(Number(tag.id))) &&
        (where?.projectId === undefined || tag.projectId === Number(where.projectId))
    );
  });
  models.Tags.findOne.mockImplementation(
    async ({ where }: RecordValue) =>
      [...tags.values()].find((tag) => tag.name === where.name && tag.projectId === Number(where.projectId)) ?? null
  );
  models.caseTags.findAll.mockImplementation(async () => []);
  models.Run.create.mockImplementation(async (values: RecordValue) => record({ ...values, id: 42 }));

  const sequelize = {
    define: vi.fn((name: string) => models[name]),
    transaction: vi.fn(async (callback: (transaction: RecordValue) => Promise<unknown>) => callback({ id: 'tx-1' })),
  };
  const tools = new Map<string, { handler: (args: RecordValue, extra: RecordValue) => Promise<any> }>();
  const server = {
    registerTool: (
      name: string,
      _config: RecordValue,
      handler: (args: RecordValue, extra: RecordValue) => Promise<any>
    ) => {
      tools.set(name, { handler });
    },
  };
  registerMcpOperations(server as never, sequelize);

  const call = (name: string, args: RecordValue, userId = 7, scopes = ['read', 'write']) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    return tool.handler(args, { authInfo: { scopes, extra: { userId } } });
  };

  return {
    call,
    tools,
    models,
    sequelize,
    data: { project1, project2, folder1, folder2, folder3, case1, case2, tag1, tag2, run1, caseStepLinks, memberships },
  };
}

function errorCode(response: any): string {
  return response.content[0].text;
}

describe('MCP domain operations', () => {
  it('registers the project contracts and the complete mapped domain surface', () => {
    const { tools } = harness();
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'get_project',
        'create_project',
        'update_project',
        'unittcms_list_folders',
        'unittcms_create_folder',
        'unittcms_update_folder',
        'unittcms_list_test_cases',
        'unittcms_create_test_case',
        'unittcms_update_test_case',
        'unittcms_move_test_case',
        'unittcms_create_test_run',
        'unittcms_list_tags',
        'unittcms_create_tag',
        'unittcms_update_tag',
      ])
    );
  });

  it('enforces read and write scopes before invoking domain handlers', async () => {
    const { call, models } = harness();
    const readResponse = await call('unittcms_list_folders', { projectId: 1 }, 7, ['write']);
    expect(readResponse.isError).toBe(true);
    expect(errorCode(readResponse)).toContain('read scope required');
    expect(models.Folder.findAll).not.toHaveBeenCalled();

    const writeResponse = await call('unittcms_create_folder', { projectId: 1, name: 'New folder' }, 7, ['read']);
    expect(writeResponse.isError).toBe(true);
    expect(errorCode(writeResponse)).toContain('write scope required');
    expect(models.Folder.create).not.toHaveBeenCalled();
  });

  it('keeps visible reads broad but limits writes to owners, managers, and developers', async () => {
    const { call, data, models } = harness();
    data.project1.isPublic = true;
    const publicRead = await call('unittcms_list_folders', { projectId: 1, limit: 1 }, 99, ['read']);
    expect(publicRead.isError).not.toBe(true);
    expect(models.Folder.findAll).toHaveBeenCalled();
    const folderReadOptions = models.Folder.findAll.mock.calls[models.Folder.findAll.mock.calls.length - 1][0];
    expect(folderReadOptions.limit).toBe(1);

    data.project1.isPublic = false;
    const privateRead = await call('unittcms_list_folders', { projectId: 1 }, 99, ['read']);
    expect(errorCode(privateRead)).toBe('project_not_found');

    data.memberships.set('1:99', 2);
    const reporterWrite = await call('unittcms_create_test_run', { projectId: 1, name: 'Reporter run' }, 99);
    expect(errorCode(reporterWrite)).toBe('project_write_forbidden');
    expect(models.Run.create).not.toHaveBeenCalled();

    data.memberships.set('1:98', 1);
    const developerWrite = await call('unittcms_create_test_run', { projectId: 1, name: 'Developer run' }, 98);
    expect(developerWrite.isError).not.toBe(true);
    expect(JSON.parse(developerWrite.content[0].text)).not.toHaveProperty('configurations');
  });

  it('rejects cross-project folders, cases, tags, and moves before mutation', async () => {
    const { call, models } = harness();
    const parentResponse = await call('unittcms_create_folder', { projectId: 1, name: 'Nested', parentFolderId: 12 });
    expect(errorCode(parentResponse)).toBe('folder_parent_invalid');
    expect(models.Folder.create).not.toHaveBeenCalled();

    const folderUpdate = await call('unittcms_update_folder', { projectId: 1, folderId: 11, parentFolderId: 12 });
    expect(errorCode(folderUpdate)).toBe('folder_parent_invalid');

    const caseUpdate = await call('unittcms_update_test_case', { projectId: 1, caseId: 22, title: 'Leaked' });
    expect(errorCode(caseUpdate)).toBe('case_project_mismatch');

    const tagUpdate = await call('unittcms_update_tag', { projectId: 1, tagId: 32, name: 'renamed' });
    expect(errorCode(tagUpdate)).toBe('tag_not_found');

    const move = await call('unittcms_move_test_case', { projectId: 1, caseIds: [22], targetFolderId: 13 });
    expect(errorCode(move)).toBe('case_project_mismatch');
    expect(models.Case.update).not.toHaveBeenCalled();
  });

  it('validates same-project tag IDs and the Gherkin Given/When/Then contract', async () => {
    const { call, data, models, sequelize } = harness();
    const foreignTag = await call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Tagged case',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 0,
      tagIds: [32],
    });
    expect(errorCode(foreignTag)).toBe('tag_project_mismatch');

    data.case1.template = 2;
    const transactionCallsBeforeInvalid = sequelize.transaction.mock.calls.length;
    const invalidGherkin = await call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      steps: [
        {
          id: 51,
          step: 'the user is signed out',
          result: 'ok',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' },
        },
        {
          id: 52,
          step: 'the user opens login',
          result: 'ok',
          caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' },
        },
      ],
    });
    expect(errorCode(invalidGherkin)).toBe('keywords_invalid');
    expect(sequelize.transaction.mock.calls.length).toBe(transactionCallsBeforeInvalid);

    const updateForeignTag = await call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      tagIds: [32],
    });
    expect(errorCode(updateForeignTag)).toBe('tag_project_mismatch');
    expect(sequelize.transaction.mock.calls.length).toBe(transactionCallsBeforeInvalid);

    const validGherkin = await call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      steps: [
        {
          id: 51,
          step: 'the user is signed out',
          result: 'ok',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' },
        },
        {
          id: 52,
          step: 'the user opens login',
          result: 'ok',
          caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' },
        },
        {
          id: 53,
          step: 'the dashboard is shown',
          result: 'ok',
          caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' },
        },
      ],
    });
    expect(validGherkin.isError).not.toBe(true);
    expect(models.Step.update).toHaveBeenCalledWith(
      { step: 'the user is signed out', result: 'ok' },
      expect.objectContaining({ where: { id: 51 }, transaction: { id: 'tx-1' } })
    );
    expect(models.CaseStep.update).toHaveBeenCalledWith(
      expect.objectContaining({ stepNo: 1, keyword: 'given', section: 'scenario' }),
      expect.objectContaining({ where: { stepId: 51 }, transaction: { id: 'tx-1' } })
    );
  });

  it('returns stable safe errors instead of database messages', async () => {
    const { call, models } = harness();
    models.Run.create.mockRejectedValueOnce(new Error('SequelizeDatabaseError: secret connection details'));
    const response = await call('unittcms_create_test_run', { projectId: 1, name: 'Run' });
    expect(errorCode(response)).toBe('operation_failed');
    expect(errorCode(response)).not.toContain('secret');
  });
});
