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
import createCaseOrderService from '../routes/cases/orderService.js';

type Extra = { authInfo?: { scopes?: string[]; extra?: { userId?: number } } };
type Handler = (args: Record<string, any>, extra: Extra) => Promise<Record<string, unknown>>;
type CasePersistence = {
  persistCaseSteps: (args: Record<string, any>) => Promise<unknown>;
  validateAndNormalizeCaseSteps: (args: Record<string, any>) => Promise<{ steps: any[] }>;
};
type DiagnosticField = { field: string; code: string; message: string };
type ErrorGuidance = { message: string; remediation: string };

const GHERKIN_STEP_DETAILS_GUIDANCE =
  'For Gherkin, caseSteps.keyword stores the canonical metadata and step stores details only. Valid shape: caseSteps.keyword: given with step: "the user is authenticated". Do not store or display "Dado" or "Given" in step. A single matching displayed prefix may be normalized once, but duplicated or mismatched prefixes are invalid.';
const GHERKIN_STEPS_GUIDANCE =
  'For template gherkin (2), create requires steps. Each active step must include caseSteps.stepNo as a unique consecutive positive number, caseSteps.keyword as canonical given, when, then, and, or but, caseSteps.section as background or scenario, and non-empty details in step. caseSteps.keyword stores canonical metadata; step stores details only. Example: caseSteps.keyword: given and step: "the user is authenticated". Do not store or display "Dado" or "Given" in step. A single matching displayed prefix may be normalized once, but duplicated or mismatched prefixes are invalid.';
const GHERKIN_TEMPLATE_GUIDANCE =
  'Case template: text (0) uses preConditions/expectedResults and does not accept steps; step (1) uses ordinary steps; gherkin (2) requires the Gherkin steps contract. For Gherkin, caseSteps.keyword stores canonical metadata and step stores details only, for example keyword: given with step: "the user is authenticated".';
const GHERKIN_EXAMPLES_GUIDANCE =
  'When Gherkin examples are supplied, use a non-empty headers array of unique strings and rows whose string-cell count exactly matches the headers count. Omit or set gherkinExamples to null when examples are not needed.';
const CASE_POSITION_GUIDANCE =
  'position is the one-based rank within folderId; case IDs remain immutable and position is scoped to the current folder.';
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
  'case_folder_mismatch',
  'case_ids_invalid',
  'case_ids_duplicate',
  'case_ids_unknown',
  'ordered_case_ids_invalid',
  'ordered_case_ids_duplicate',
  'ordered_case_ids_unknown',
  'ordered_case_ids_foreign',
  'ordered_case_ids_missing',
  'position_invalid',
  'position_out_of_range',
  'position_required',
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
  'case_attributes_invalid',
  'transaction_required',
  'operation_failed',
]);

const GHERKIN_ERROR_CODES = new Set([
  'gherkin_examples_invalid',
  'steps_required',
  'details_keyword',
  'step_keyword_mismatch',
  'section_invalid',
  'step_order_invalid',
  'keywords_invalid',
  'gherkin_invalid',
  'gherkin_lint_unavailable',
  'gherkin_lint_failed',
]);

const MCP_ERROR_GUIDANCE: Record<string, ErrorGuidance> = {
  details_keyword: {
    message: 'Gherkin step details must contain details only, not a keyword prefix.',
    remediation:
      'Retry with a shape such as {"caseSteps":{"keyword":"given","section":"scenario","stepNo":1},"step":"the user is authenticated"}. Store only "the user is authenticated" in step; do not include or duplicate "Dado" or "Given". A single matching prefix may be normalized once, but duplicated or mismatched prefixes are invalid.',
  },
  step_keyword_mismatch: {
    message: 'The canonical keyword does not match the displayed prefix at the reported step.',
    remediation:
      'At the reported steps[index], set caseSteps.keyword to the canonical keyword matching the detected displayed prefix, or remove that prefix and keep details only in step, then retry. Do not echo scenario content in step.',
  },
  step_order_invalid: {
    message: 'Active Gherkin step numbers must be unique, consecutive, and positive.',
    remediation: 'Retry with active caseSteps.stepNo values 1, 2, 3, and so on, without duplicates or gaps.',
  },
  keywords_invalid: {
    message: 'Active Gherkin steps require Given, When, Then, and only canonical step keywords.',
    remediation:
      'Retry with at least one active step using each canonical keyword given, when, and then; optional steps may use and or but. Put the canonical value in caseSteps.keyword.',
  },
  section_invalid: {
    message: 'Each active Gherkin step section must be background or scenario.',
    remediation: 'Retry with caseSteps.section set to exactly background or scenario for every active step.',
  },
  steps_required: {
    message: 'Gherkin cases require a non-empty active steps set.',
    remediation:
      'For a Gherkin create, provide steps with at least one active step; for an update, include the replacement active set and keep at least one step.',
  },
  gherkin_examples_invalid: {
    message: 'The Gherkin examples table is invalid.',
    remediation: GHERKIN_EXAMPLES_GUIDANCE,
  },
  gherkin_invalid: {
    message: 'The Gherkin case is invalid.',
    remediation:
      'Correct the bounded fields reported in fields, then retry with the canonical Gherkin step shape and details-only step text.',
  },
  gherkin_lint_failed: {
    message: 'Gherkin lint failed for the supplied case.',
    remediation:
      'Correct each bounded lint field reported in fields, then retry. Keep keyword metadata canonical and step text limited to details.',
  },
  gherkin_lint_unavailable: {
    message: 'Gherkin lint is temporarily unavailable.',
    remediation: 'Retry the same validated Gherkin request when the lint service is available.',
  },
  steps_invalid: {
    message: 'The steps value is invalid.',
    remediation: 'Retry with steps as an array containing at most 500 step objects.',
  },
  position_invalid: {
    message: 'The case position must be a positive one-based integer.',
    remediation: `Retry with ${CASE_POSITION_GUIDANCE}`,
  },
  position_out_of_range: {
    message: 'The requested case position is outside the folder order.',
    remediation: `Retry with a position between 1 and the folder case count plus one; ${CASE_POSITION_GUIDANCE}`,
  },
  position_required: {
    message: 'An explicit case position is required for this ordering operation.',
    remediation: `Retry with a positive one-based position; ${CASE_POSITION_GUIDANCE}`,
  },
  case_folder_mismatch: {
    message: 'The case does not belong to the requested folder.',
    remediation: 'Retry with the folderId that currently contains the case.',
  },
  ordered_case_ids_invalid: {
    message: 'orderedCaseIds must be an array of positive case IDs.',
    remediation: 'Retry with an array containing at most 500 positive integer case IDs.',
  },
  ordered_case_ids_duplicate: {
    message: 'orderedCaseIds must not contain duplicate case IDs.',
    remediation: 'Retry with each case ID exactly once in the desired folder order.',
  },
  ordered_case_ids_unknown: {
    message: 'orderedCaseIds contains a case that does not exist.',
    remediation: 'Retry after removing unknown IDs and provide the complete current folder permutation.',
  },
  ordered_case_ids_foreign: {
    message: 'orderedCaseIds contains a case from another folder.',
    remediation: 'Retry with only cases belonging to the requested folder.',
  },
  ordered_case_ids_missing: {
    message: 'orderedCaseIds is not a complete folder permutation.',
    remediation: 'Retry with every case in the folder exactly once, including unchanged cases.',
  },
  case_ids_duplicate: {
    message: 'caseIds must not contain duplicate case IDs.',
    remediation: 'Retry with each case ID once in the requested move order.',
  },
  case_ids_unknown: {
    message: 'Some requested cases were not found.',
    remediation: 'Retry with existing case IDs from the visible project.',
  },
  step_shape_invalid: {
    message: 'A supplied step has an invalid shape.',
    remediation:
      'Retry each active step with caseSteps, a positive stepNo, a canonical keyword and section for Gherkin, plus string step and result values.',
  },
  template_invalid: {
    message: 'The case template is invalid.',
    remediation: 'Retry with template text, step, or gherkin, or numeric template 0, 1, or 2.',
  },
  steps_not_allowed_for_template: {
    message: 'Text-template cases do not accept steps.',
    remediation: 'Retry a text-template request without steps, or choose the step or gherkin template.',
  },
};

const DEFAULT_ERROR_GUIDANCE: ErrorGuidance = {
  message: 'The MCP operation could not be completed.',
  remediation: 'Correct the referenced resource or request and retry the operation.',
};

class McpOperationError extends Error {
  readonly code: string;
  readonly fields?: DiagnosticField[];

  constructor(code: string, fields?: DiagnosticField[]) {
    super(SAFE_ERROR_CODES.has(code) ? code : 'operation_failed');
    this.name = 'McpOperationError';
    this.code = SAFE_ERROR_CODES.has(code) ? code : 'operation_failed';
    this.fields = fields;
  }
}

const operationError = (code: string, fields?: DiagnosticField[]) => new McpOperationError(code, fields);

function safeErrorCode(error: unknown): string {
  if (error instanceof McpOperationError) return error.code;
  if (error && typeof error === 'object' && 'code' in error && SAFE_ERROR_CODES.has(String(error.code))) {
    return String(error.code);
  }
  if (error instanceof Error && SAFE_ERROR_CODES.has(error.message)) return error.message;
  return 'operation_failed';
}

function boundedDiagnosticText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || undefined;
}

function safeDiagnosticFields(error: unknown): DiagnosticField[] | undefined {
  if (!error || typeof error !== 'object' || !Array.isArray((error as { fields?: unknown }).fields)) return undefined;

  const fields = (error as { fields: unknown[] }).fields.slice(0, 16).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const source = value as Record<string, unknown>;
    const field = boundedDiagnosticText(source.field, 160);
    const code = boundedDiagnosticText(source.code, 80);
    const message = boundedDiagnosticText(source.message, 500);
    if (!field || !code || !message || !/^[A-Za-z0-9_.[\]-]+(?: \d+)?$/.test(field)) return [];
    if (!/^[A-Za-z0-9_.[\]-]+$/.test(code)) return [];
    return [{ field, code, message }];
  });

  return fields.length > 0 ? fields : undefined;
}

function safeStructuredMessage(error: unknown, code: string): string | undefined {
  if (!GHERKIN_ERROR_CODES.has(code) || error instanceof McpOperationError || !error || typeof error !== 'object') {
    return undefined;
  }
  if (!Array.isArray((error as { fields?: unknown }).fields)) return undefined;
  return boundedDiagnosticText((error as { message?: unknown }).message, 500);
}

const failed = (error: unknown) => {
  const code = safeErrorCode(error);
  const guidance = MCP_ERROR_GUIDANCE[code] ?? DEFAULT_ERROR_GUIDANCE;
  const diagnostic: Record<string, unknown> = {
    code,
    message: safeStructuredMessage(error, code) ?? guidance.message,
    remediation: guidance.remediation,
  };
  const fields = safeDiagnosticFields(error);
  if (fields) diagnostic.fields = fields;
  return {
    content: [{ type: 'text', text: JSON.stringify(diagnostic) }],
    isError: true,
  };
};

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
  'position',
];
const folderFields = ['id', 'name', 'detail', 'parentFolderId', 'projectId'];
const tagFields = ['id', 'name', 'projectId'];
const runFields = ['id', 'name', 'description', 'state', 'projectId'];
const caseMetadataFields = [
  'id',
  'title',
  'state',
  'priority',
  'type',
  'automationStatus',
  'template',
  'folderId',
  'position',
];
const gherkinExamplesSchema = z
  .object({
    headers: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    rows: z
      .array(z.array(z.string().max(MAX_TEXT_LENGTH)).min(1).max(100))
      .min(1)
      .max(500),
  })
  .nullable()
  .optional()
  .describe(GHERKIN_EXAMPLES_GUIDANCE);
const templateInputSchema = z
  .union([z.number().int(), z.enum(['text', 'step', 'gherkin'])])
  .describe(GHERKIN_TEMPLATE_GUIDANCE);
const stepInputSchema = z.object({
  id: z.number().int().positive().optional(),
  editState: z.enum(['notChanged', 'changed', 'new', 'deleted']).optional(),
  step: z.string().max(MAX_TEXT_LENGTH).optional().describe(GHERKIN_STEP_DETAILS_GUIDANCE),
  result: z.string().max(MAX_TEXT_LENGTH).optional(),
  caseSteps: z
    .object({
      stepNo: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('For Gherkin, use unique consecutive positive step numbers starting at 1 for the active set.'),
      keyword: z
        .enum(['given', 'when', 'then', 'and', 'but'])
        .nullable()
        .optional()
        .describe(
          'For Gherkin, canonical metadata only: use given, when, then, and, or but; do not put the keyword in step.'
        ),
      section: z
        .enum(gherkinSections as [string, ...string[]])
        .nullable()
        .optional()
        .describe('For Gherkin, use exactly background or scenario.'),
    })
    .optional()
    .describe('Gherkin metadata for the step; keyword is canonical metadata and step remains details-only.'),
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

function normalizeOrderedCaseIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_CASE_IDS) throw operationError('ordered_case_ids_invalid');
  return value.map((id) => positiveId(id, 'ordered_case_ids_invalid'));
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
  return steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || step.editState === 'deleted') return step;

    const keyword = step.caseSteps?.keyword;
    const section = step.caseSteps?.section;
    if (!gherkinKeywords.includes(keyword)) throw operationError('keywords_invalid');
    if (!gherkinSections.includes(section)) throw operationError('section_invalid');

    const prefix = matchGherkinKeywordPrefix(step.step);
    if (!prefix) return step;
    if (prefix.keyword !== keyword) {
      throw operationError('step_keyword_mismatch', [
        {
          field: `steps[${index}].caseSteps.keyword`,
          code: 'step_keyword_mismatch',
          message:
            'The selected canonical keyword must match the detected displayed prefix; use the matching canonical keyword or remove the displayed prefix.',
        },
      ]);
    }
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
  const caseOrderService = createCaseOrderService({ sequelize, Case, Folder });
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
      description: `List safe test-case metadata and same-project tag metadata. ${CASE_POSITION_GUIDANCE}`,
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
        order: [
          ['folderId', 'ASC'],
          ['position', 'ASC'],
          ['id', 'ASC'],
        ],
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
      description: `Create a test case with optional transactional steps, examples, tags, and a one-based folder position. Omit position to append; an explicit position inserts and shifts neighboring cases. ${CASE_POSITION_GUIDANCE} ${GHERKIN_STEPS_GUIDANCE}`,
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
        position: z.number().int().positive().optional().describe(CASE_POSITION_GUIDANCE),
        gherkinExamples: gherkinExamplesSchema,
        tagIds: z.array(z.number().int().positive()).max(5).optional(),
        steps: z.array(stepInputSchema).max(MAX_CASE_STEPS).optional().describe(GHERKIN_STEPS_GUIDANCE),
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
        const testcase = await caseOrderService.createCase({
          attributes: values,
          folderId,
          position: args.position,
          transaction,
        });
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
      description: `Update test-case metadata and optionally replace validated steps, examples, tags, and folder position. Omit position to preserve order; an explicit position moves the case within its current folder. ${CASE_POSITION_GUIDANCE} ${GHERKIN_STEPS_GUIDANCE} When steps is supplied, it replaces and validates the supplied active step set; retry with the corrected steps array rather than relying on server-side repair.`,
      inputSchema: {
        projectId: z.number().int().positive(),
        caseId: z.number().int().positive(),
        title: z.string().trim().min(1).max(200).optional(),
        state: z.number().int().optional(),
        priority: z.number().int().optional(),
        type: z.number().int().optional(),
        automationStatus: z.number().int().optional(),
        template: templateInputSchema.optional().describe(GHERKIN_TEMPLATE_GUIDANCE),
        description: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        preConditions: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        expectedResults: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
        position: z.number().int().positive().optional().describe(CASE_POSITION_GUIDANCE),
        gherkinExamples: gherkinExamplesSchema,
        tagIds: z.array(z.number().int().positive()).max(5).optional(),
        steps: z
          .array(stepInputSchema)
          .max(MAX_CASE_STEPS)
          .optional()
          .describe(
            `${GHERKIN_STEPS_GUIDANCE} On update, supplying steps replaces and validates the supplied active step set; retry with the corrected steps array when validation reports a problem.`
          ),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const caseId = positiveId(args.caseId, 'case_not_found');
      const { testcase } = await caseForProject(caseId, projectId);
      const hasPosition = hasOwn(args, 'position') && args.position !== undefined && args.position !== null;
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
        if (hasPosition) {
          await caseOrderService.moveCase({ caseId, position: args.position, transaction });
        }
      });
      return text(await caseResponse(projectId, caseId));
    }
  );

  add(
    'unittcms_move_test_case',
    'write',
    {
      description: `Move one or more test cases within the same editable project. Cases append to targetFolderId in supplied caseIds order. ${CASE_POSITION_GUIDANCE}`,
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
      await caseOrderService.moveCasesToFolder({ caseIds, targetFolderId });
      return text({ movedCaseIds: caseIds, targetFolderId, projectId });
    }
  );

  add(
    'unittcms_reorder_test_cases',
    'write',
    {
      description: `Reorder all test cases in one folder with a complete permutation. ${CASE_POSITION_GUIDANCE}`,
      inputSchema: {
        projectId: z.number().int().positive(),
        folderId: z.number().int().positive(),
        orderedCaseIds: z
          .array(z.number().int().positive())
          .max(MAX_CASE_IDS)
          .describe(
            'Complete folder permutation: include every case in folderId exactly once, in the desired one-based order.'
          ),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = positiveId(args.projectId);
      await requireEditableProject(projectId, userId);
      const folderId = positiveId(args.folderId, 'folder_project_mismatch');
      await folderForProject(folderId, projectId);
      const orderedCaseIds = normalizeOrderedCaseIds(args.orderedCaseIds);
      const committedCases = await caseOrderService.reorderFolder({ folderId, orderedCaseIds });
      return text({
        folderId,
        orderedCaseIds,
        committed: committedCases.map((testcase: any) => ({
          id: Number(plain(testcase)?.id),
          position: Number(plain(testcase)?.position),
        })),
      });
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
