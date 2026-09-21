/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op } from 'sequelize';
import { describe, expect, it, vi } from 'vitest';
import { matchGherkinKeywordPrefix } from '../config/enums.js';
import { registerMcpOperations } from './operations.js';

const persistenceMocks = vi.hoisted(() => ({
  persistCaseSteps: vi.fn(),
  validateAndNormalizeCaseSteps: vi.fn(),
}));

vi.mock('../routes/steps/persistence.js', () => {
  class MockCaseSaveValidationError extends Error {
    code: string;
    fields: RecordValue[];
    status: number;

    constructor(code: string, message = code, fields: RecordValue[] = []) {
      super(message);
      this.code = code;
      this.fields = fields;
      this.status = 400;
    }
  }

  persistenceMocks.validateAndNormalizeCaseSteps.mockImplementation(async ({ template, steps }: RecordValue) => {
    if (!Array.isArray(steps)) throw new MockCaseSaveValidationError('steps_invalid');
    if (template === 2) {
      const prefixedIndex = steps.findIndex(
        (step) => step?.editState !== 'deleted' && matchGherkinKeywordPrefix(step?.step) !== null
      );
      if (prefixedIndex !== -1) {
        throw new MockCaseSaveValidationError(
          'details_keyword',
          'Gherkin step details must not include a keyword prefix',
          [
            {
              field: `Steps[${prefixedIndex}].step`,
              code: 'details_keyword',
              message: 'Gherkin step details must not include a keyword prefix',
            },
          ]
        );
      }
      const keywords = new Set(
        steps.filter((step) => step?.editState !== 'deleted').map((step) => step?.caseSteps?.keyword)
      );
      if (!['given', 'when', 'then'].every((keyword) => keywords.has(keyword))) {
        throw new MockCaseSaveValidationError('keywords_invalid');
      }
    }
    return { steps };
  });
  persistenceMocks.persistCaseSteps.mockImplementation(
    async ({ caseId, steps, Step, CaseStep, transaction }: RecordValue) => {
      for (const step of steps) {
        if (step.editState === 'new') {
          const newStep = await Step.create({ step: step.step, result: step.result }, { transaction });
          await CaseStep.create(
            {
              caseId,
              stepId: newStep.id,
              stepNo: step.caseSteps.stepNo,
              keyword: step.caseSteps.keyword ?? null,
              section: step.caseSteps.section ?? 'scenario',
            },
            { transaction }
          );
          continue;
        }
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
    }
  );
  return {
    CaseSaveValidationError: MockCaseSaveValidationError,
    persistCaseSteps: persistenceMocks.persistCaseSteps,
    validateAndNormalizeCaseSteps: persistenceMocks.validateAndNormalizeCaseSteps,
  };
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
    position: 1,
    gherkinExamples: null,
  });
  const case2 = record({ id: 22, title: 'Case two', template: 0, automationVersion: 1, folderId: 12, position: 1 });
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
  models.Case.findAll.mockImplementation(async ({ where, order }: RecordValue) => {
    const ids = where?.id?.[Op.in] as number[] | undefined;
    const directIds = Array.isArray(where?.id) ? (where.id as number[]) : undefined;
    let records = [...cases.values()];
    if (ids || directIds) {
      const requestedIds = ids ?? directIds ?? [];
      records = records.filter((testcase) => requestedIds.includes(Number(testcase.id)));
    }
    const folderIds = where?.folderId?.[Op.in] as number[] | undefined;
    if (folderIds) records = records.filter((testcase) => folderIds.includes(Number(testcase.folderId)));
    if (where?.folderId !== undefined && !folderIds) {
      records = records.filter((testcase) => Number(testcase.folderId) === Number(where.folderId));
    }
    if (!Array.isArray(order)) return records;
    return records.sort((left, right) => {
      for (const [field, direction] of order) {
        const leftValue = left[field];
        const rightValue = right[field];
        if (leftValue === rightValue) continue;
        if (leftValue === undefined || leftValue === null) return 1;
        if (rightValue === undefined || rightValue === null) return -1;
        const result = leftValue < rightValue ? -1 : 1;
        return direction === 'DESC' ? -result : result;
      }
      return 0;
    });
  });
  models.Case.update.mockImplementation(async (values: RecordValue, { where }: RecordValue = {}) => {
    let updated = 0;
    for (const testcase of cases.values()) {
      const matchesId =
        where?.id === undefined ||
        (where.id?.[Op.in] as number[] | undefined)?.includes(Number(testcase.id)) ||
        Number(testcase.id) === Number(where.id);
      const matchesFolder = where?.folderId === undefined || Number(testcase.folderId) === Number(where.folderId);
      if (matchesId && matchesFolder) {
        Object.assign(testcase, values);
        updated += 1;
      }
    }
    return [updated];
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
    transaction: vi.fn(async (callback: (transaction: RecordValue) => Promise<unknown>) => {
      const previousCases = new Map(cases);
      try {
        return await callback({ id: 'tx-1' });
      } catch (error) {
        cases.clear();
        for (const [id, testcase] of previousCases) cases.set(id, testcase);
        throw error;
      }
    }),
  };
  const tools = new Map<
    string,
    { config: RecordValue; handler: (args: RecordValue, extra: RecordValue) => Promise<any> }
  >();
  const server = {
    registerTool: (
      name: string,
      config: RecordValue,
      handler: (args: RecordValue, extra: RecordValue) => Promise<any>
    ) => {
      tools.set(name, { config, handler });
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
    data: {
      project1,
      project2,
      folder1,
      folder2,
      folder3,
      case1,
      case2,
      tag1,
      tag2,
      run1,
      caseStepLinks,
      memberships,
      cases,
    },
  };
}

function diagnostic(response: any): RecordValue | undefined {
  try {
    const value = JSON.parse(response.content[0].text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function errorCode(response: any): string {
  return diagnostic(response)?.code ?? response.content[0].text;
}

function createCaseArgs(overrides: RecordValue = {}): RecordValue {
  return {
    projectId: 1,
    folderId: 11,
    title: 'New case',
    state: 0,
    priority: 2,
    type: 0,
    automationStatus: 0,
    template: 0,
    ...overrides,
  };
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
        'unittcms_reorder_test_cases',
        'unittcms_create_test_run',
        'unittcms_list_tags',
        'unittcms_create_tag',
        'unittcms_update_tag',
      ])
    );
  });

  it('exposes the canonical Gherkin contract in create and update tool guidance', () => {
    const { tools } = harness();
    const createConfig = tools.get('unittcms_create_test_case')?.config;
    const updateConfig = tools.get('unittcms_update_test_case')?.config;

    expect(createConfig?.description).toContain('create requires steps');
    expect(createConfig?.description).toContain('caseSteps.keyword stores canonical metadata');
    expect(createConfig?.description).toContain('step stores details only');
    expect(createConfig?.description).toContain('duplicated or mismatched prefixes are invalid');
    expect(createConfig?.inputSchema.steps.description).toContain('caseSteps.keyword: given');
    expect(createConfig?.inputSchema.steps.description).toContain('the user is authenticated');
    expect(createConfig?.inputSchema.template.description).toContain('step stores details only');
    expect(createConfig?.description).toContain('Omit position to append');
    expect(createConfig?.inputSchema.position.description).toContain('one-based rank');
    expect(updateConfig?.description).toContain('replaces and validates the supplied active step set');
    expect(updateConfig?.inputSchema.steps.description).toContain('retry with the corrected steps array');
    expect(updateConfig?.description).toContain('Omit position to preserve order');
    expect(updateConfig?.inputSchema.position.description).toContain('one-based rank');
  });

  it('exposes one-based positions in safe projections and orders project-wide results by folder position', async () => {
    const { call, data, models } = harness();
    const case10 = record({ id: 10, title: 'Case ten', template: 0, automationVersion: 1, folderId: 11, position: 1 });
    const case30 = record({
      id: 30,
      title: 'Case thirty',
      template: 0,
      automationVersion: 1,
      folderId: 13,
      position: 1,
    });
    data.case1.position = 2;
    data.cases.set(10, case10);
    data.cases.set(30, case30);

    const listResponse = await call('unittcms_list_test_cases', { projectId: 1, limit: 10 });
    const listed = JSON.parse(listResponse.content[0].text);
    expect(listed.map((testcase: RecordValue) => testcase.id)).toEqual([10, 21, 30]);
    expect(listed[0]).toEqual(expect.objectContaining({ id: 10, folderId: 11, position: 1 }));
    expect(listed[1]).toEqual(expect.objectContaining({ id: 21, folderId: 11, position: 2 }));
    expect(listed[2]).toEqual(expect.objectContaining({ id: 30, folderId: 13, position: 1 }));
    const listOptions = models.Case.findAll.mock.calls[models.Case.findAll.mock.calls.length - 1][0];
    expect(listOptions.order).toEqual([
      ['folderId', 'ASC'],
      ['position', 'ASC'],
      ['id', 'ASC'],
    ]);

    const fullResponse = await call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      title: 'Renamed case',
    });
    expect(JSON.parse(fullResponse.content[0].text)).toEqual(
      expect.objectContaining({ id: 21, title: 'Renamed case', folderId: 11, position: 2 })
    );
  });

  it('appends created cases by default and inserts them at an explicit one-based position', async () => {
    const appendHarness = harness();
    const appendResponse = await appendHarness.call('unittcms_create_test_case', createCaseArgs());
    expect(appendResponse.isError).not.toBe(true);
    expect(JSON.parse(appendResponse.content[0].text)).toEqual(
      expect.objectContaining({ id: 23, folderId: 11, position: 2 })
    );
    expect(appendHarness.data.cases.get(23)).toEqual(expect.objectContaining({ position: 2 }));

    const insertHarness = harness();
    const insertResponse = await insertHarness.call(
      'unittcms_create_test_case',
      createCaseArgs({ title: 'Inserted case', position: 1 })
    );
    expect(insertResponse.isError).not.toBe(true);
    expect(JSON.parse(insertResponse.content[0].text)).toEqual(
      expect.objectContaining({ id: 23, folderId: 11, position: 1 })
    );
    expect(insertHarness.data.case1).toEqual(expect.objectContaining({ id: 21, position: 2 }));
  });

  it('moves an updated case within its folder without changing its immutable ID', async () => {
    const { call, data } = harness();
    const case10 = record({ id: 10, title: 'Case ten', template: 0, automationVersion: 1, folderId: 11, position: 2 });
    data.cases.set(10, case10);

    const response = await call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      id: 999,
      title: 'Moved case',
      position: 2,
    });

    expect(response.isError).not.toBe(true);
    expect(JSON.parse(response.content[0].text)).toEqual(
      expect.objectContaining({ id: 21, title: 'Moved case', folderId: 11, position: 2 })
    );
    expect(data.case1).toEqual(expect.objectContaining({ id: 21, folderId: 11, position: 2 }));
    expect(case10).toEqual(expect.objectContaining({ id: 10, folderId: 11, position: 1 }));
  });

  it('appends moved cases to the target folder in supplied ID order', async () => {
    const { call, data } = harness();
    const case10 = record({ id: 10, title: 'Case ten', template: 0, automationVersion: 1, folderId: 11, position: 2 });
    const targetCase = record({
      id: 30,
      title: 'Target case',
      template: 0,
      automationVersion: 1,
      folderId: 13,
      position: 1,
    });
    data.cases.set(10, case10);
    data.cases.set(30, targetCase);

    const response = await call('unittcms_move_test_case', {
      projectId: 1,
      caseIds: [21, 10],
      targetFolderId: 13,
    });

    expect(response.isError).not.toBe(true);
    expect(JSON.parse(response.content[0].text)).toEqual({
      movedCaseIds: [21, 10],
      targetFolderId: 13,
      projectId: 1,
    });
    expect(targetCase).toEqual(expect.objectContaining({ id: 30, folderId: 13, position: 1 }));
    expect(data.case1).toEqual(expect.objectContaining({ id: 21, folderId: 13, position: 2 }));
    expect(case10).toEqual(expect.objectContaining({ id: 10, folderId: 13, position: 3 }));
  });

  it('validates a complete folder permutation before writing and commits case 10 at position 3', async () => {
    const createFolderCases = () => {
      const testHarness = harness();
      const case10 = record({
        id: 10,
        title: 'Case ten',
        template: 0,
        automationVersion: 1,
        folderId: 11,
        position: 2,
      });
      const case24 = record({
        id: 24,
        title: 'Case twenty-four',
        template: 0,
        automationVersion: 1,
        folderId: 11,
        position: 3,
      });
      testHarness.data.cases.set(10, case10);
      testHarness.data.cases.set(24, case24);
      return { testHarness, case10, case24 };
    };

    const success = createFolderCases();
    const successResponse = await success.testHarness.call('unittcms_reorder_test_cases', {
      projectId: 1,
      folderId: 11,
      orderedCaseIds: [21, 24, 10],
    });
    expect(successResponse.isError).not.toBe(true);
    expect(JSON.parse(successResponse.content[0].text)).toEqual({
      folderId: 11,
      orderedCaseIds: [21, 24, 10],
      committed: [
        { id: 21, position: 1 },
        { id: 24, position: 2 },
        { id: 10, position: 3 },
      ],
    });
    expect(success.case10).toEqual(expect.objectContaining({ id: 10, position: 3 }));
    expect(new Set([...success.testHarness.data.cases.keys()])).toEqual(new Set([10, 21, 22, 24]));

    const invalidRequests = [
      { orderedCaseIds: [21, 21, 10, 24], code: 'ordered_case_ids_duplicate' },
      { orderedCaseIds: [21, 10], code: 'ordered_case_ids_missing' },
      { orderedCaseIds: [21, 10, 24, 999], code: 'ordered_case_ids_unknown' },
      { orderedCaseIds: [21, 10, 24, 22], code: 'ordered_case_ids_foreign' },
    ];
    for (const request of invalidRequests) {
      const invalid = createFolderCases();
      const response = await invalid.testHarness.call('unittcms_reorder_test_cases', {
        projectId: 1,
        folderId: 11,
        orderedCaseIds: request.orderedCaseIds,
      });
      expect(errorCode(response)).toBe(request.code);
      expect(invalid.testHarness.models.Case.update).not.toHaveBeenCalled();
    }
  });

  it('enforces reorder authorization and maps persistence failures to safe errors', async () => {
    const unauthorized = harness();
    unauthorized.data.memberships.set('1:99', 2);
    const forbidden = await unauthorized.call(
      'unittcms_reorder_test_cases',
      { projectId: 1, folderId: 11, orderedCaseIds: [21] },
      99
    );
    expect(errorCode(forbidden)).toBe('project_write_forbidden');
    expect(unauthorized.models.Case.update).not.toHaveBeenCalled();

    const foreignFolder = harness();
    const foreignFolderResponse = await foreignFolder.call('unittcms_reorder_test_cases', {
      projectId: 1,
      folderId: 12,
      orderedCaseIds: [22],
    });
    expect(errorCode(foreignFolderResponse)).toBe('folder_project_mismatch');
    expect(foreignFolder.models.Case.update).not.toHaveBeenCalled();

    const persistenceFailure = harness();
    persistenceFailure.models.Case.update.mockRejectedValueOnce(
      new Error('SequelizeDatabaseError: secret connection details')
    );
    const response = await persistenceFailure.call('unittcms_reorder_test_cases', {
      projectId: 1,
      folderId: 11,
      orderedCaseIds: [21],
    });
    expect(errorCode(response)).toBe('operation_failed');
    expect(JSON.stringify(response)).not.toContain('secret');
    expect(JSON.stringify(response)).not.toContain('SequelizeDatabaseError');
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

  it('normalizes string and numeric templates and applies their step contracts', async () => {
    const textHarness = harness();
    const textResponse = await textHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Text case',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 'text',
      preConditions: 'A precondition',
      expectedResults: 'An expected result',
    });
    expect(textResponse.isError).not.toBe(true);
    expect(textHarness.models.Case.create).toHaveBeenCalledWith(
      expect.objectContaining({ template: 0, preConditions: 'A precondition', expectedResults: 'An expected result' }),
      expect.anything()
    );
    expect(textHarness.models.Step.create).not.toHaveBeenCalled();

    const stepHarness = harness();
    const stepResponse = await stepHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Step case',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 1,
      steps: [{ step: 'Given ordinary text', result: 'the dashboard opens' }],
    });
    expect(stepResponse.isError).not.toBe(true);
    expect(stepHarness.models.Case.create).toHaveBeenCalledWith(
      expect.objectContaining({ template: 1 }),
      expect.anything()
    );
    expect(stepHarness.models.Step.create).toHaveBeenCalledWith(
      { step: 'Given ordinary text', result: 'the dashboard opens' },
      expect.anything()
    );
    expect(stepHarness.models.CaseStep.create).toHaveBeenCalledWith(
      { caseId: 23, stepId: 60, stepNo: 1, keyword: null, section: 'scenario' },
      expect.anything()
    );
  });

  it('requires explicit Gherkin steps and stores details without displayed keyword labels', async () => {
    const missingHarness = harness();
    const missing = await missingHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Missing steps',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 'gherkin',
    });
    expect(errorCode(missing)).toBe('steps_required');
    expect(missingHarness.models.Case.create).not.toHaveBeenCalled();
    expect(missingHarness.sequelize.transaction).not.toHaveBeenCalled();

    const gherkinHarness = harness();
    const response = await gherkinHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Localized case',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 'gherkin',
      steps: [
        {
          step: 'Dado que el usuario está autenticado',
          result: '',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' },
        },
        {
          step: 'When the user opens the dashboard',
          result: '',
          caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' },
        },
        {
          step: 'the dashboard is visible',
          result: '',
          caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' },
        },
      ],
    });
    expect(response.isError).not.toBe(true);
    expect(persistenceMocks.validateAndNormalizeCaseSteps).toHaveBeenLastCalledWith(
      expect.objectContaining({ caseId: 23 })
    );
    expect(gherkinHarness.models.Step.create.mock.calls.map(([values]) => values.step)).toEqual([
      'que el usuario está autenticado',
      'the user opens the dashboard',
      'the dashboard is visible',
    ]);
  });

  it('rejects a duplicate Gherkin prefix during create without persisting case steps', async () => {
    const duplicateHarness = harness();
    const response = await duplicateHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Duplicate prefix',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 'gherkin',
      steps: [
        {
          step: 'Dado Dado que the user is signed out',
          result: '',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' },
        },
        {
          step: 'When the user opens the dashboard',
          result: '',
          caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' },
        },
        {
          step: 'the dashboard is visible',
          result: '',
          caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' },
        },
      ],
    });

    expect(errorCode(response)).toBe('details_keyword');
    const result = diagnostic(response);
    expect(result).toEqual(
      expect.objectContaining({
        code: 'details_keyword',
        message: 'Gherkin step details must not include a keyword prefix',
      })
    );
    expect(result?.fields).toEqual([expect.objectContaining({ field: 'Steps[0].step', code: 'details_keyword' })]);
    expect(result?.remediation).toContain('caseSteps');
    expect(result?.remediation).toContain('"step":"the user is authenticated"');
    expect(duplicateHarness.models.Case.create).toHaveBeenCalledOnce();
    expect(duplicateHarness.data.cases.has(23)).toBe(false);
    expect(duplicateHarness.models.Step.create).not.toHaveBeenCalled();
    expect(duplicateHarness.models.CaseStep.create).not.toHaveBeenCalled();
    expect(duplicateHarness.sequelize.transaction).toHaveBeenCalledOnce();
  });

  it('rejects Gherkin keyword mismatches and template steps without mutation', async () => {
    const mismatchHarness = harness();
    const mismatch = await mismatchHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Mismatch',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 2,
      steps: [
        { step: 'When this is wrong', result: '', caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' } },
        { step: 'when it happens', result: '', caseSteps: { stepNo: 2, keyword: 'when', section: 'scenario' } },
        { step: 'then it works', result: '', caseSteps: { stepNo: 3, keyword: 'then', section: 'scenario' } },
      ],
    });
    expect(errorCode(mismatch)).toBe('step_keyword_mismatch');
    const mismatchResult = diagnostic(mismatch);
    expect(mismatchResult).toEqual(
      expect.objectContaining({
        code: 'step_keyword_mismatch',
        remediation: expect.stringContaining('canonical keyword'),
      })
    );
    expect(mismatchResult?.fields).toEqual([
      expect.objectContaining({ field: 'steps[0].caseSteps.keyword', code: 'step_keyword_mismatch' }),
    ]);
    expect(JSON.stringify(mismatchResult)).not.toContain('this is wrong');
    expect(mismatchHarness.models.Case.create).not.toHaveBeenCalled();
    expect(mismatchHarness.sequelize.transaction).not.toHaveBeenCalled();

    const textHarness = harness();
    const textWithSteps = await textHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Text with steps',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 'text',
      steps: [{ step: 'ordinary text', result: 'ordinary result' }],
    });
    expect(errorCode(textWithSteps)).toBe('steps_not_allowed_for_template');
    expect(textHarness.models.Case.create).not.toHaveBeenCalled();
    expect(textHarness.sequelize.transaction).not.toHaveBeenCalled();

    const textUpdateHarness = harness();
    const textUpdate = await textUpdateHarness.call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      template: 'text',
      steps: [{ step: 'Given ordinary text', result: 'ordinary result' }],
    });
    expect(errorCode(textUpdate)).toBe('steps_not_allowed_for_template');
    expect(textUpdateHarness.data.case1.update).not.toHaveBeenCalled();
    expect(textUpdateHarness.sequelize.transaction).not.toHaveBeenCalled();

    const invalidTemplateHarness = harness();
    const invalidTemplate = await invalidTemplateHarness.call('unittcms_create_test_case', {
      projectId: 1,
      folderId: 11,
      title: 'Invalid template',
      state: 0,
      priority: 2,
      type: 0,
      automationStatus: 0,
      template: 'unsupported',
    });
    expect(errorCode(invalidTemplate)).toBe('template_invalid');
    expect(invalidTemplateHarness.models.Case.create).not.toHaveBeenCalled();
  });

  it('normalizes Gherkin prefixes on update and stores the numeric template', async () => {
    const { call, data, models } = harness();
    data.case1.template = 2;
    const response = await call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      template: 'gherkin',
      steps: [
        {
          id: 51,
          step: 'Dado que the user is signed out',
          result: 'ok',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' },
        },
        {
          id: 52,
          step: 'When the user opens login',
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
    expect(response.isError).not.toBe(true);
    expect(data.case1.update).toHaveBeenCalledWith(expect.objectContaining({ template: 2 }), expect.anything());
    expect(models.Step.update).toHaveBeenCalledWith(
      { step: 'que the user is signed out', result: 'ok' },
      expect.objectContaining({ where: { id: 51 } })
    );
  });

  it('rejects a duplicate Gherkin prefix before updating the case', async () => {
    const { call, data, models, sequelize } = harness();
    data.case1.template = 2;
    const response = await call('unittcms_update_test_case', {
      projectId: 1,
      caseId: 21,
      template: 'gherkin',
      steps: [
        {
          id: 51,
          step: 'Dado Dado que the user is signed out',
          result: 'ok',
          caseSteps: { stepNo: 1, keyword: 'given', section: 'scenario' },
        },
        {
          id: 52,
          step: 'When the user opens login',
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

    expect(errorCode(response)).toBe('details_keyword');
    const result = diagnostic(response);
    expect(result).toEqual(
      expect.objectContaining({
        code: 'details_keyword',
        message: 'Gherkin step details must not include a keyword prefix',
      })
    );
    expect(result?.fields).toEqual([expect.objectContaining({ field: 'Steps[0].step', code: 'details_keyword' })]);
    expect(result?.remediation).toContain('caseSteps');
    expect(result?.remediation).toContain('"step":"the user is authenticated"');
    expect(persistenceMocks.validateAndNormalizeCaseSteps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        steps: expect.arrayContaining([expect.objectContaining({ step: 'Dado que the user is signed out' })]),
      })
    );
    expect(data.case1.update).not.toHaveBeenCalled();
    expect(models.Step.update).not.toHaveBeenCalled();
    expect(models.CaseStep.update).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('returns stable safe errors instead of database messages', async () => {
    const { call, models } = harness();
    models.Run.create.mockRejectedValueOnce(new Error('SequelizeDatabaseError: secret connection details'));
    const response = await call('unittcms_create_test_run', { projectId: 1, name: 'Run' });
    const result = diagnostic(response);
    expect(result).toEqual(
      expect.objectContaining({
        code: 'operation_failed',
        message: 'The MCP operation could not be completed.',
        remediation: expect.any(String),
      })
    );
    expect(errorCode(response)).toBe('operation_failed');
    expect(JSON.stringify(response)).not.toContain('secret');
    expect(JSON.stringify(response)).not.toContain('SequelizeDatabaseError');
  });
});
