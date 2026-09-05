/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataTypes, Op } from 'sequelize';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import defineCase from '../models/cases.js';
import defineCaseTag from '../models/caseTags.js';
import defineCaseStep from '../models/caseSteps.js';
import defineFolder from '../models/folders.js';
import defineMember from '../models/members.js';
import defineOrganization from '../models/organizations.js';
import defineProject from '../models/projects.js';
import defineRun from '../models/runs.js';
import defineStep from '../models/steps.js';
import defineTag from '../models/tags.js';
import {
  gherkinKeywords,
  gherkinSections,
  gherkinTemplate,
  hasValidGherkinExamples,
  matchGherkinKeywordPrefix,
} from '../config/enums.js';

type Extra = { authInfo?: { scopes?: string[]; extra?: { userId?: number } } };
type Handler = (args: Record<string, any>, extra: Extra) => Promise<Record<string, unknown>>;
type CasePersistence = {
  persistCaseSteps: (args: Record<string, any>) => Promise<unknown>;
  validateAndNormalizeCaseSteps: (args: Record<string, any>) => Promise<{ steps: any[] }>;
};
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const denied = (scope: string) => ({
  content: [{ type: 'text', text: `insufficient_scope: ${scope} scope required` }],
  isError: true,
});
const plain = (value: any) => value?.get?.({ plain: true }) ?? value?.toJSON?.() ?? value;

const SAFE_ERROR_CODES = new Set([
  'unauthenticated',
  'project_not_found',
  'project_write_forbidden',
  'project_read_forbidden',
  'folder_not_found',
  'folder_parent_invalid',
  'folder_project_mismatch',
  'case_not_found',
  'case_project_mismatch',
  'case_ids_invalid',
  'tag_not_found',
  'tag_project_mismatch',
  'tag_ids_invalid',
  'tag_name_invalid',
  'tag_name_conflict',
  'run_not_found',
  'run_project_mismatch',
  'step_not_found',
  'step_case_mismatch',
  'steps_invalid',
  'step_create_id_forbidden',
  'gherkin_examples_invalid',
  'template_invalid',
  'steps_required',
  'steps_not_allowed_for_template',
  'details_keyword',
  'step_keyword_mismatch',
  'transaction_unavailable',
  'step_shape_invalid',
  'section_invalid',
  'step_order_invalid',
  'keywords_invalid',
  'gherkin_invalid',
  'gherkin_lint_unavailable',
  'gherkin_lint_failed',
  'operation_failed',
]);

class McpOperationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(SAFE_ERROR_CODES.has(code) ? code : 'operation_failed');
    this.name = 'McpOperationError';
    this.code = SAFE_ERROR_CODES.has(code) ? code : 'operation_failed';
  }
}

const operationError = (code: string) => new McpOperationError(code);

function safeErrorCode(error: unknown): string {
  if (error instanceof McpOperationError) return error.code;
  if (error && typeof error === 'object' && 'code' in error && SAFE_ERROR_CODES.has(String(error.code))) {
    return String(error.code);
  }
  if (error instanceof Error && SAFE_ERROR_CODES.has(error.message)) return error.message;
  return 'operation_failed';
}

const failed = (error: unknown) => ({
  content: [{ type: 'text', text: safeErrorCode(error) }],
  isError: true,
});

function caller(extra: Extra): number {
  const id = Number(extra.authInfo?.extra?.userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw operationError('unauthenticated');
  return id;
}

export function registerScopedTool(
  server: McpServer,
  name: string,
  scope: 'read' | 'write',
  config: Record<string, any>,
  handler: Handler
): void {
  (server as any).registerTool(
    name,
    { ...config, inputSchema: config.inputSchema ?? {} },
    async (args: any, extra: Extra) => {
      if (!extra.authInfo?.scopes?.includes(scope)) return denied(scope);
      try {
        return await handler(args ?? {}, extra);
      } catch (error) {
        return failed(error);
      }
    }
  );
}

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_CASE_STEPS = 500;
const MAX_CASE_IDS = 500;
const MAX_TEXT_LENGTH = 10_000;
const caseFields = [
  'id',
  'title',
  'state',
  'priority',
  'type',
  'automationStatus',
  'description',
  'template',
  'automationVersion',
  'gherkinExamples',
  'preConditions',
  'expectedResults',
  'folderId',
];
const folderFields = ['id', 'name', 'detail', 'parentFolderId', 'projectId'];
const tagFields = ['id', 'name', 'projectId'];
const runFields = ['id', 'name', 'description', 'state', 'projectId'];
const caseMetadataFields = ['id', 'title', 'state', 'priority', 'type', 'automationStatus', 'template', 'folderId'];
const gherkinExamplesSchema = z
  .object({
    headers: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    rows: z
      .array(z.array(z.string().max(MAX_TEXT_LENGTH)).min(1).max(100))
      .min(1)
      .max(500),
  })
  .nullable()
  .optional();
const templateInputSchema = z
  .union([z.number().int(), z.enum(['text', 'step', 'gherkin'])])
  .describe(
    'Case template: text (0) uses preConditions/expectedResults, step (1) uses ordinary steps, gherkin (2) requires canonical Given/When/Then steps.'
  );
const stepInputSchema = z.object({
  id: z.number().int().positive().optional(),
  editState: z.enum(['notChanged', 'changed', 'new', 'deleted']).optional(),
  step: z.string().max(MAX_TEXT_LENGTH).optional(),
  result: z.string().max(MAX_TEXT_LENGTH).optional(),
  caseSteps: z
    .object({
      stepNo: z.number().int().positive().optional(),
      keyword: z.enum(['given', 'when', 'then', 'and', 'but']).nullable().optional(),
      section: z
        .enum(gherkinSections as [string, ...string[]])
        .nullable()
        .optional(),
    })
    .optional(),
});

function positiveId(value: unknown, code = 'operation_failed'): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw operationError(code);
  return id;
}

function listLimit(value: unknown): number {
  const limit = Number(value ?? DEFAULT_LIST_LIMIT);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) return DEFAULT_LIST_LIMIT;
  return limit;
}

function pick(value: unknown, fields: string[]): Record<string, unknown> {
  const source = plain(value) ?? {};
  return Object.fromEntries(
    fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])
  );
}

function safeFolder(folder: unknown): Record<string, unknown> {
  return pick(folder, folderFields);
}

function safeTag(tag: unknown): Record<string, unknown> {
  return pick(tag, tagFields);
}

function safeRun(run: unknown): Record<string, unknown> {
  return pick(run, runFields);
}

function safeStep(step: unknown): Record<string, unknown> {
  const source = plain(step) ?? {};
  return {
    id: source.id,
    step: source.step,
    result: source.result,
    caseSteps: {
      stepNo: source.caseSteps?.stepNo,
      keyword: source.caseSteps?.keyword ?? null,
      section: source.caseSteps?.section ?? 'scenario',
    },
  };
}

function safeCase(testcase: unknown, projectId: number, tags?: unknown[], steps?: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = { ...pick(testcase, caseFields), projectId };
  if (tags !== undefined) result.tags = tags.map(safeTag);
  if (steps !== undefined) result.steps = steps.map(safeStep);
  return result;
}

function safeCaseMetadata(testcase: unknown, projectId: number, tags: unknown[] = []): Record<string, unknown> {
  return { ...pick(testcase, caseMetadataFields), projectId, tags: tags.map(safeTag) };
}

function normalizeTagIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 5) throw operationError('tag_ids_invalid');
  const ids = value.map((id) => positiveId(id, 'tag_ids_invalid'));
  if (new Set(ids).size !== ids.length) throw operationError('tag_ids_invalid');
  return ids;
}

function normalizeCaseIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CASE_IDS) {
    throw operationError('case_ids_invalid');
  }
  const ids = value.map((id) => positiveId(id, 'case_ids_invalid'));
  if (new Set(ids).size !== ids.length) throw operationError('case_ids_invalid');
  return ids;
}

function hasOwn(value: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeCreateSteps(value: unknown): any[] {
  if (!Array.isArray(value) || value.length > MAX_CASE_STEPS) throw operationError('steps_invalid');
  return value.map((step) => {
    if (step && typeof step === 'object' && 'id' in step && step.id !== undefined && step.id !== null) {
      throw operationError('step_create_id_forbidden');
    }
    if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
    return { ...step, editState: 'new' };
  });
}

function normalizeUpdateSteps(value: unknown): any[] {
  if (!Array.isArray(value) || value.length > MAX_CASE_STEPS) throw operationError('steps_invalid');
  return value.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
    const source = step as Record<string, any>;
    return {
      ...source,
      editState: source.editState ?? (source.id === undefined ? 'new' : 'changed'),
    };
  });
}

function normalizeTemplate(value: unknown): number {
  if (value === 'text') return 0;
  if (value === 'step') return 1;
  if (value === 'gherkin') return gherkinTemplate;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= gherkinTemplate) {
    return value;
  }
  throw operationError('template_invalid');
}

function activeSteps(steps: any[]): any[] {
  return steps.filter((step) => step?.editState !== 'deleted');
}

function normalizeOrdinarySteps(steps: any[]): any[] {
  return steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || step.editState === 'deleted') return step;
    const caseSteps = step.caseSteps && typeof step.caseSteps === 'object' ? { ...step.caseSteps } : {};
    if (caseSteps.stepNo === undefined) caseSteps.stepNo = index + 1;
    return { ...step, caseSteps };
  });
}

function normalizeGherkinStepsForMcp(steps: any[]): any[] {
  return steps.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || step.editState === 'deleted') return step;

    const keyword = step.caseSteps?.keyword;
    const section = step.caseSteps?.section;
    if (!gherkinKeywords.includes(keyword)) throw operationError('keywords_invalid');
    if (!gherkinSections.includes(section)) throw operationError('section_invalid');

    const prefix = matchGherkinKeywordPrefix(step.step);
    if (!prefix) return step;
    if (prefix.keyword !== keyword) throw operationError('step_keyword_mismatch');
    return { ...step, step: prefix.details };
  });
}

function normalizeMcpSteps(value: unknown, template: number, mode: 'create' | 'update'): any[] {
  const steps = mode === 'create' ? normalizeCreateSteps(value) : normalizeUpdateSteps(value);
  if (template === 1) return normalizeOrdinarySteps(steps);
  if (template === gherkinTemplate) {
    if (activeSteps(steps).length === 0) throw operationError('steps_required');
    return normalizeGherkinStepsForMcp(steps);
  }
  return steps;
}

function rejectTextTemplateSteps(value: unknown): void {
  if (Array.isArray(value) && value.length > 0) throw operationError('steps_not_allowed_for_template');
}

async function inTransaction(sequelize: any, callback: (transaction: any) => Promise<any>): Promise<any> {
  if (typeof sequelize.transaction !== 'function') throw operationError('transaction_unavailable');
  return sequelize.transaction(callback);
}

async function loadCasePersistence(): Promise<CasePersistence> {
  return (await import('../routes/steps/persistence.js')) as unknown as CasePersistence;
}

export function registerMcpOperations(server: McpServer, sequelize: any): void {
  const Project = defineProject(sequelize, DataTypes) as any;
  const Member = defineMember(sequelize, DataTypes) as any;
  const Organization = defineOrganization(sequelize, DataTypes) as any;
  const Folder = defineFolder(sequelize, DataTypes) as any;
  const Case = defineCase(sequelize, DataTypes) as any;
  const Step = defineStep(sequelize, DataTypes) as any;
  const CaseStep = defineCaseStep(sequelize, DataTypes) as any;
  const Tag = defineTag(sequelize, DataTypes) as any;
  const CaseTag = defineCaseTag(sequelize, DataTypes) as any;
  const Run = defineRun(sequelize, DataTypes) as any;
  const visible = async (projectId: number, userId: number) => {
    const project = await Project.findByPk(projectId);
    return Boolean(
      project &&
        (project.isPublic ||
          Number(project.userId) === userId ||
          (await Member.findOne({ where: { projectId, userId } })))
    );
  };
  const editable = async (projectId: number, userId: number) => {
    const project = await Project.findByPk(projectId);
    if (!project) return false;
    if (Number(project.userId) === userId) return true;
    const member = await Member.findOne({ where: { projectId, userId } });
    return Boolean(member && Number(member.role) <= 1);
  };
  const requireVisibleProject = async (projectId: number, userId: number) => {
    const project = await Project.findByPk(projectId);
    if (!project || !(await visible(projectId, userId))) throw operationError('project_not_found');
    return project;
  };
  const requireEditableProject = async (projectId: number, userId: number) => {
    const project = await Project.findByPk(projectId);
    if (!project) throw operationError('project_not_found');
    if (!(await editable(projectId, userId))) throw operationError('project_write_forbidden');
    return project;
  };
  const folderForProject = async (folderId: number, projectId: number, errorCode = 'folder_project_mismatch') => {
    const folder = await Folder.findByPk(folderId);
    if (!folder) throw operationError('folder_not_found');
    if (Number(folder.projectId) !== projectId) throw operationError(errorCode);
    return folder;
  };
  const caseForProject = async (caseId: number, projectId: number) => {
    const testcase = await Case.findByPk(caseId);
    if (!testcase) throw operationError('case_not_found');
    const folder = await Folder.findByPk(Number(testcase.folderId));
    if (!folder) throw operationError('case_not_found');
    if (Number(folder.projectId) !== projectId) throw operationError('case_project_mismatch');
    return { testcase, folder };
  };
  const tagsForProject = async (projectId: number, tagIds: number[]) => {
    if (tagIds.length === 0) return [];
    const tags = await Tag.findAll({
      where: { id: { [Op.in]: tagIds }, projectId },
      attributes: tagFields,
    });
    const records = Array.isArray(tags) ? tags : [];
    const knownIds = new Set(records.map((tag: any) => Number(plain(tag)?.id)));
    if (
      knownIds.size !== tagIds.length ||
      tagIds.some((tagId) => !knownIds.has(tagId)) ||
      records.some((tag: any) => Number(plain(tag)?.projectId) !== projectId)
    ) {
      throw operationError('tag_project_mismatch');
    }
    return tagIds.map((tagId) => records.find((tag: any) => Number(plain(tag)?.id) === tagId));
  };
  const tagsForCases = async (projectId: number, caseIds: number[]) => {
    const result = new Map<number, any[]>();
    if (caseIds.length === 0) return result;
    const links = await CaseTag.findAll({ where: { caseId: { [Op.in]: caseIds } } });
    const linkRecords = Array.isArray(links) ? links : [];
    const tagIds = [...new Set(linkRecords.map((link: any) => Number(plain(link)?.tagId)).filter((id) => id > 0))];
    if (tagIds.length === 0) return result;
    const tags = await Tag.findAll({
      where: { id: { [Op.in]: tagIds }, projectId },
      attributes: tagFields,
    });
    const tagById = new Map(
      (Array.isArray(tags) ? tags : [])
        .filter((tag: any) => Number(plain(tag)?.projectId) === projectId)
        .map((tag: any) => [Number(plain(tag)?.id), tag])
    );
    for (const link of linkRecords) {
      const source = plain(link) ?? {};
      const tag = tagById.get(Number(source.tagId));
      if (!tag) continue;
      const caseId = Number(source.caseId);
      result.set(caseId, [...(result.get(caseId) ?? []), tag]);
    }
    return result;
  };
  const loadCaseSteps = async (caseId: number) => {
    const links = await CaseStep.findAll({ where: { caseId } });
    const linkRecords = Array.isArray(links) ? links : [];
    const stepIds = [...new Set(linkRecords.map((link: any) => Number(plain(link)?.stepId)).filter((id) => id > 0))];
    if (stepIds.length === 0) return [];
    const stepRecords = await Step.findAll({ where: { id: { [Op.in]: stepIds } } });
    const stepById = new Map(
      (Array.isArray(stepRecords) ? stepRecords : []).map((step: any) => [Number(plain(step)?.id), step])
    );
    if (stepIds.some((stepId) => !stepById.has(stepId))) throw operationError('step_not_found');
    return linkRecords.map((link: any) => {
      const source = plain(link) ?? {};
      const step = plain(stepById.get(Number(source.stepId))) ?? {};
      return {
        id: Number(step.id ?? source.stepId),
        step: step.step,
        result: step.result,
        editState: 'notChanged',
        caseSteps: {
          stepNo: Number(source.stepNo),
          keyword: source.keyword ?? null,
          section: source.section ?? 'scenario',
        },
      };
    });
  };
  const assertStepsBelongToCase = async (caseId: number, steps: any[]) => {
    const ids = steps
      .filter((step) => step?.editState !== 'new')
      .map((step) => positiveId(step?.id, 'step_case_mismatch'));
    if (new Set(ids).size !== ids.length) throw operationError('step_case_mismatch');
    if (ids.length === 0) return;
    const targetLinks = await CaseStep.findAll({ where: { caseId, stepId: { [Op.in]: ids } } });
    const targetIds = new Set(
      (Array.isArray(targetLinks) ? targetLinks : []).map((link: any) => Number(plain(link)?.stepId))
    );
    if (targetIds.size !== ids.length || ids.some((stepId) => !targetIds.has(stepId))) {
      throw operationError('step_case_mismatch');
    }
    const allLinks = await CaseStep.findAll({ where: { stepId: { [Op.in]: ids } } });
    if ((Array.isArray(allLinks) ? allLinks : []).some((link: any) => Number(plain(link)?.caseId) !== caseId)) {
      throw operationError('step_case_mismatch');
    }
  };
  const caseResponse = async (projectId: number, caseId: number) => {
    const { testcase } = await caseForProject(caseId, projectId);
    const steps = await loadCaseSteps(caseId);
    const tagLinks = await CaseTag.findAll({ where: { caseId } });
    const tagIds = [
      ...new Set((Array.isArray(tagLinks) ? tagLinks : []).map((link: any) => Number(plain(link)?.tagId))),
    ].filter((id) => id > 0);
    const tags = tagIds.length === 0 ? [] : await tagsForProject(projectId, tagIds);
    return safeCase(testcase, projectId, tags, steps);
  };
  const replaceCaseTags = async (
    projectId: number,
    caseId: number,
    tagIds: number[],
    transaction: any,
    validatedTags?: any[]
  ) => {
    const tags = validatedTags ?? (await tagsForProject(projectId, tagIds));
    await CaseTag.destroy({ where: { caseId }, transaction });
    if (tags.length > 0) {
      await CaseTag.bulkCreate(
        tags.map((tag: any) => ({ caseId, tagId: Number(plain(tag)?.id) })),
        { transaction }
      );
    }
    return tags;
  };
  const add = (name: string, scope: 'read' | 'write', config: Record<string, any>, handler: Handler) =>
    registerScopedTool(server, name, scope, config, handler);

  add(
    'get_project',
    'read',
    { description: 'Read one visible project', inputSchema: { projectId: z.number().int().positive() } },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = Number(args.projectId);
      const project = await Project.findByPk(projectId);
      if (!project || !(await visible(projectId, userId))) throw new Error('project_not_found');
      return text(plain(project));
    }
  );
  add(
    'create_project',
    'write',
    {
      description: 'Create a project owned by the caller',
      inputSchema: {
        name: z.string().trim().min(1).max(200),
        detail: z.string().optional(),
        isPublic: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const [organization] = await Organization.findOrCreate({
        where: { ownerUserId: userId },
        defaults: { name: `Organization ${userId}`, ownerUserId: userId },
      });
      return text(
        plain(
          await Project.create({
            name: args.name,
            detail: args.detail ?? null,
            isPublic: args.isPublic ?? false,
            userId,
            organizationId: organization.id,
          })
        )
      );
    }
  );
  add(
    'update_project',
    'write',
    {
      description: 'Update a project owned by the caller',
      inputSchema: {
        projectId: z.number().int().positive(),
        name: z.string().trim().min(1).max(200).optional(),
        detail: z.string().optional(),
        isPublic: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = Number(args.projectId);
      if (!(await editable(projectId, userId))) throw new Error('project_write_forbidden');
      const project = await Project.findByPk(projectId);
      if (!project) throw new Error('project_not_found');
      await project.update(
        Object.fromEntries(
          ['name', 'detail', 'isPublic'].filter((key) => args[key] !== undefined).map((key) => [key, args[key]])
        )
      );
      return text(plain(project));
    }
  );

  add(
    'unittcms_list_folders',
    'read',
    {
      description: 'List safe folder metadata in a visible project',
      inputSchema: {
        projectId: z.number().int().positive(),
        limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireVisibleProject(projectId, userId);
      const folders = await Folder.findAll({
        where: { projectId },
        attributes: folderFields,
        order: [['id', 'ASC']],
        limit: listLimit(args.limit),
      });
      return text((Array.isArray(folders) ? folders : []).map(safeFolder));
    }
  );

  add(
    'unittcms_create_folder',
    'write',
    {
      description: 'Create a folder in an editable project',
      inputSchema: {
        projectId: z.number().int().positive(),
        name: z.string().trim().min(1).max(200),
        detail: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        parentFolderId: z.number().int().positive().optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      if (args.parentFolderId !== undefined) {
        await folderForProject(positiveId(args.parentFolderId), projectId, 'folder_parent_invalid');
      }
      const folder = await Folder.create({
        name: String(args.name).trim(),
        detail: args.detail ?? null,
        projectId,
        parentFolderId: args.parentFolderId ?? null,
      });
      return text(safeFolder(folder));
    }
  );

  add(
    'unittcms_update_folder',
    'write',
    {
      description: 'Rename or update folder metadata without changing projects',
      inputSchema: {
        projectId: z.number().int().positive(),
        folderId: z.number().int().positive(),
        name: z.string().trim().min(1).max(200).optional(),
        detail: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        parentFolderId: z.number().int().positive().nullable().optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const folder = await folderForProject(positiveId(args.folderId), projectId);
      if (args.parentFolderId !== undefined && args.parentFolderId !== null) {
        const parentFolderId = positiveId(args.parentFolderId, 'folder_parent_invalid');
        if (parentFolderId === Number(folder.id)) throw operationError('folder_parent_invalid');
        await folderForProject(parentFolderId, projectId, 'folder_parent_invalid');
      }
      const values: Record<string, unknown> = {};
      if (args.name !== undefined) values.name = String(args.name).trim();
      if (args.detail !== undefined) values.detail = args.detail;
      if (args.parentFolderId !== undefined) values.parentFolderId = args.parentFolderId;
      await folder.update(values);
      return text(safeFolder(folder));
    }
  );

  add(
    'unittcms_list_tags',
    'read',
    {
      description: 'List safe tag metadata in a visible project',
      inputSchema: {
        projectId: z.number().int().positive(),
        limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireVisibleProject(projectId, userId);
      const tags = await Tag.findAll({
        where: { projectId },
        attributes: tagFields,
        order: [['name', 'ASC']],
        limit: listLimit(args.limit),
      });
      return text((Array.isArray(tags) ? tags : []).map(safeTag));
    }
  );

  add(
    'unittcms_create_tag',
    'write',
    {
      description: 'Create a project-owned tag',
      inputSchema: {
        projectId: z.number().int().positive(),
        name: z.string().trim().min(3).max(20),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const name = String(args.name).trim();
      if (name.length < 3 || name.length > 20) throw operationError('tag_name_invalid');
      if (await Tag.findOne({ where: { name, projectId } })) throw operationError('tag_name_conflict');
      const tag = await Tag.create({ name, projectId });
      return text(safeTag(tag));
    }
  );

  add(
    'unittcms_update_tag',
    'write',
    {
      description: 'Rename a project-owned tag',
      inputSchema: {
        projectId: z.number().int().positive(),
        tagId: z.number().int().positive(),
        name: z.string().trim().min(3).max(20),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const tag = await Tag.findByPk(positiveId(args.tagId));
      if (!tag || Number(tag.projectId) !== projectId) throw operationError('tag_not_found');
      const name = String(args.name).trim();
      if (name.length < 3 || name.length > 20) throw operationError('tag_name_invalid');
      const existing = await Tag.findOne({ where: { name, projectId, id: { [Op.ne]: Number(tag.id) } } });
      if (existing) throw operationError('tag_name_conflict');
      await tag.update({ name });
      return text(safeTag(tag));
    }
  );

  add(
    'unittcms_list_test_cases',
    'read',
    {
      description: 'List safe test-case metadata and same-project tag metadata',
      inputSchema: {
        projectId: z.number().int().positive(),
        limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireVisibleProject(projectId, userId);
      const folders = await Folder.findAll({ where: { projectId }, attributes: ['id'] });
      const folderIds = (Array.isArray(folders) ? folders : []).map((folder: any) => Number(plain(folder)?.id));
      if (folderIds.length === 0) return text([]);
      const cases = await Case.findAll({
        where: { folderId: { [Op.in]: folderIds } },
        attributes: caseMetadataFields,
        order: [['id', 'ASC']],
        limit: listLimit(args.limit),
      });
      const records = Array.isArray(cases) ? cases : [];
      const caseIds = records.map((testcase: any) => Number(plain(testcase)?.id));
      const tagsByCase = await tagsForCases(projectId, caseIds);
      return text(
        records.map((testcase: any) => {
          const id = Number(plain(testcase)?.id);
          return safeCaseMetadata(testcase, projectId, tagsByCase.get(id) ?? []);
        })
      );
    }
  );

  add(
    'unittcms_create_test_case',
    'write',
    {
      description: 'Create a test case with optional transactional steps, examples, and tags',
      inputSchema: {
        projectId: z.number().int().positive(),
        folderId: z.number().int().positive(),
        title: z.string().trim().min(1).max(200),
        state: z.number().int(),
        priority: z.number().int(),
        type: z.number().int(),
        automationStatus: z.number().int(),
        template: templateInputSchema,
        description: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        preConditions: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        expectedResults: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        automationVersion: z.number().int().positive().optional(),
        gherkinExamples: gherkinExamplesSchema,
        tagIds: z.array(z.number().int().positive()).max(5).optional(),
        steps: z
          .array(stepInputSchema)
          .max(MAX_CASE_STEPS)
          .optional()
          .describe(
            'Omit for text cases; use step/result for step cases; provide stepNo, keyword, and section for Gherkin cases.'
          ),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const folderId = positiveId(args.folderId, 'folder_project_mismatch');
      await folderForProject(folderId, projectId);
      const template = normalizeTemplate(args.template);
      if (template === 0) rejectTextTemplateSteps(args.steps);
      if (template === gherkinTemplate && !hasValidGherkinExamples(args.gherkinExamples)) {
        throw operationError('gherkin_examples_invalid');
      }
      const tagIds = args.tagIds === undefined ? undefined : normalizeTagIds(args.tagIds);
      const validatedTags = tagIds === undefined ? undefined : await tagsForProject(projectId, tagIds);
      const suppliedSteps = args.steps === undefined ? undefined : normalizeMcpSteps(args.steps, template, 'create');
      if (template === gherkinTemplate && suppliedSteps === undefined) throw operationError('steps_required');
      const values = {
        title: String(args.title).trim(),
        state: args.state,
        priority: args.priority,
        type: args.type,
        automationStatus: args.automationStatus,
        description: args.description ?? null,
        template,
        automationVersion: args.automationVersion ?? 1,
        gherkinExamples: args.gherkinExamples ?? null,
        preConditions: args.preConditions ?? null,
        expectedResults: args.expectedResults ?? null,
        folderId,
      };
      let casePersistence: CasePersistence | undefined;
      if (template !== 0 && suppliedSteps !== undefined) {
        casePersistence = await loadCasePersistence();
      }
      const created = await inTransaction(sequelize, async (transaction) => {
        const testcase = await Case.create(values, { transaction });
        if (casePersistence && suppliedSteps) {
          const normalized = await casePersistence.validateAndNormalizeCaseSteps({
            caseId: testcase.id,
            title: values.title,
            template,
            automationVersion: values.automationVersion,
            gherkinExamples: values.gherkinExamples,
            steps: suppliedSteps,
          });
          await casePersistence.persistCaseSteps({
            caseId: testcase.id,
            steps: normalized.steps,
            isGherkin: template === gherkinTemplate,
            Step,
            CaseStep,
            transaction,
          });
        }
        if (tagIds !== undefined) await replaceCaseTags(projectId, testcase.id, tagIds, transaction, validatedTags);
        return testcase;
      });
      return text(await caseResponse(projectId, positiveId(created.id, 'case_not_found')));
    }
  );

  add(
    'unittcms_update_test_case',
    'write',
    {
      description: 'Update test-case metadata and optionally replace validated steps, examples, and tags',
      inputSchema: {
        projectId: z.number().int().positive(),
        caseId: z.number().int().positive(),
        title: z.string().trim().min(1).max(200).optional(),
        state: z.number().int().optional(),
        priority: z.number().int().optional(),
        type: z.number().int().optional(),
        automationStatus: z.number().int().optional(),
        template: templateInputSchema.optional(),
        description: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        preConditions: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        expectedResults: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        gherkinExamples: gherkinExamplesSchema,
        tagIds: z.array(z.number().int().positive()).max(5).optional(),
        steps: z
          .array(stepInputSchema)
          .max(MAX_CASE_STEPS)
          .optional()
          .describe(
            'Omit for text cases; use step/result for step cases; provide stepNo, keyword, and section for Gherkin cases.'
          ),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const caseId = positiveId(args.caseId, 'case_not_found');
      const { testcase } = await caseForProject(caseId, projectId);
      const template =
        args.template === undefined ? normalizeTemplate(testcase.template) : normalizeTemplate(args.template);
      const examples = hasOwn(args, 'gherkinExamples') ? args.gherkinExamples : testcase.gherkinExamples;
      if (template === gherkinTemplate && !hasValidGherkinExamples(examples)) {
        throw operationError('gherkin_examples_invalid');
      }
      const hasSteps = hasOwn(args, 'steps');
      if (template === 0) rejectTextTemplateSteps(args.steps);
      let casePersistence: CasePersistence | undefined;
      let normalized: { steps: any[] } | undefined;
      if (template !== 0) {
        const candidateSteps = hasSteps
          ? normalizeMcpSteps(args.steps, template, 'update')
          : await loadCaseSteps(caseId);
        casePersistence = await loadCasePersistence();
        normalized = await casePersistence.validateAndNormalizeCaseSteps({
          caseId,
          title: args.title ?? testcase.title,
          template,
          automationVersion: Number(testcase.automationVersion || 1) + (template === gherkinTemplate ? 1 : 0),
          gherkinExamples: examples,
          steps: candidateSteps,
        });
        if (hasSteps) await assertStepsBelongToCase(caseId, normalized.steps);
      }
      const tagIds = args.tagIds === undefined ? undefined : normalizeTagIds(args.tagIds);
      const validatedTags = tagIds === undefined ? undefined : await tagsForProject(projectId, tagIds);
      const values: Record<string, unknown> = {};
      for (const key of [
        'title',
        'state',
        'priority',
        'type',
        'automationStatus',
        'description',
        'preConditions',
        'expectedResults',
        'template',
        'gherkinExamples',
      ]) {
        if (hasOwn(args, key)) {
          values[key] = key === 'title' ? String(args[key]).trim() : key === 'template' ? template : args[key];
        }
      }
      if (template === gherkinTemplate) values.automationVersion = Number(testcase.automationVersion || 1) + 1;
      await inTransaction(sequelize, async (transaction) => {
        await testcase.update(values, { transaction });
        if (hasSteps && casePersistence && normalized) {
          await casePersistence.persistCaseSteps({
            caseId,
            steps: normalized.steps,
            isGherkin: template === gherkinTemplate,
            Step,
            CaseStep,
            transaction,
          });
        }
        if (tagIds !== undefined) await replaceCaseTags(projectId, caseId, tagIds, transaction, validatedTags);
      });
      return text(await caseResponse(projectId, caseId));
    }
  );

  add(
    'unittcms_move_test_case',
    'write',
    {
      description: 'Move one or more test cases within the same editable project',
      inputSchema: {
        projectId: z.number().int().positive(),
        caseIds: z.array(z.number().int().positive()).min(1).max(MAX_CASE_IDS),
        targetFolderId: z.number().int().positive(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const caseIds = normalizeCaseIds(args.caseIds);
      const targetFolderId = positiveId(args.targetFolderId, 'folder_project_mismatch');
      await folderForProject(targetFolderId, projectId);
      const cases = await Case.findAll({ where: { id: { [Op.in]: caseIds } } });
      const records = Array.isArray(cases) ? cases : [];
      if (records.length !== caseIds.length) throw operationError('case_not_found');
      const sourceFolderIds = [...new Set(records.map((testcase: any) => Number(plain(testcase)?.folderId)))];
      const sourceFolders = await Folder.findAll({
        where: { id: { [Op.in]: sourceFolderIds } },
        attributes: ['id', 'projectId'],
      });
      const folderById = new Map(
        (Array.isArray(sourceFolders) ? sourceFolders : []).map((folder: any) => [Number(plain(folder)?.id), folder])
      );
      if (
        sourceFolderIds.some((folderId) => {
          const folder = folderById.get(folderId);
          return !folder || Number(plain(folder)?.projectId) !== projectId;
        })
      ) {
        throw operationError('case_project_mismatch');
      }
      await inTransaction(sequelize, async (transaction) => {
        for (const testcase of records) await testcase.update({ folderId: targetFolderId }, { transaction });
      });
      return text({ movedCaseIds: caseIds, targetFolderId, projectId });
    }
  );

  add(
    'unittcms_create_test_run',
    'write',
    {
      description: 'Create a test run in an editable project',
      inputSchema: {
        projectId: z.number().int().positive(),
        name: z.string().trim().min(1).max(200),
        configurations: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        description: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        state: z.number().int().nullable().optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const run = await Run.create({
        name: String(args.name).trim(),
        configurations: args.configurations ?? null,
        description: args.description ?? null,
        state: args.state ?? null,
        projectId,
      });
      return text(safeRun(run));
    }
  );
}
