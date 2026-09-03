import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import express, { type Request, type Response } from 'express';
import { DataTypes } from 'sequelize';
import defineAutomationDefinition from '../../models/automationDefinitions.js';
import defineAutomationExecution from '../../models/automationExecutions.js';
import defineCase from '../../models/cases.js';
import defineCaseStep from '../../models/caseSteps.js';
import defineExecutionArtifact from '../../models/executionArtifacts.js';
import defineFolder from '../../models/folders.js';
import defineManualExecution from '../../models/manualExecutions.js';
import defineManualExecutionEvidence from '../../models/manualExecutionEvidence.js';
import defineMember from '../../models/members.js';
import defineProject from '../../models/projects.js';
import defineRun from '../../models/runs.js';
import defineRunCase from '../../models/runCases.js';
import defineStep from '../../models/steps.js';
import defineUser from '../../models/users.js';
import authMiddleware from '../../middleware/auth.js';
import {
  createReportService,
  ReportError,
  resolveReportLimits,
  type ReportService,
} from '../../reports/application/service.js';
import {
  REPORT_FORMATS,
  type BuildReportInput,
  type ReportFormat,
  type ReportLimits,
  type ReportModel,
} from '../../reports/api/types.js';
import {
  createSequelizeReportStore,
  type ReportModels,
  type SequelizeReportStoreOptions,
} from '../../reports/infrastructure/sequelize-store.js';
import { ManualEvidenceStorage } from '../../manual-execution/infrastructure/storage.js';
import {
  assertRenderedOutput,
  ReportRenderError,
  type ReportRenderOptions,
  wrapRenderError,
} from '../../reports/infrastructure/render-common.js';
import { DOCX_REPORT_CONTENT_TYPE, renderDocx } from '../../reports/infrastructure/render-docx.js';
import { HTML_REPORT_CONTENT_TYPE, renderHtml } from '../../reports/infrastructure/render-html.js';
import { JSON_REPORT_CONTENT_TYPE, renderJson } from '../../reports/infrastructure/render-json.js';
import { PDF_REPORT_CONTENT_TYPE, renderPdf } from '../../reports/infrastructure/render-pdf.js';
import { contentDisposition, toSafeFileName } from '../../config/contentDisposition.js';

type ReportServicePort = Pick<ReportService, 'build'>;
export type ReportRenderer = (report: ReportModel, options?: ReportRenderOptions) => Buffer | Promise<Buffer>;

export type ReportRouteOptions = {
  service?: ReportServicePort;
  limits?: ReportLimits;
  renderers?: Partial<Record<ReportFormat, ReportRenderer>>;
};

type RequestWithContext = Request & {
  userId?: unknown;
  correlationId?: unknown;
  reportCorrelationId?: string;
};

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTENT_TYPES: Record<ReportFormat, string> = {
  json: JSON_REPORT_CONTENT_TYPE,
  html: HTML_REPORT_CONTENT_TYPE,
  pdf: PDF_REPORT_CONTENT_TYPE,
  docx: DOCX_REPORT_CONTENT_TYPE,
};

const DEFAULT_RENDERERS: Record<ReportFormat, ReportRenderer> = {
  json: renderJson,
  html: renderHtml,
  pdf: renderPdf,
  docx: renderDocx,
};

function positiveId(value: unknown, field: string): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ReportError(`${field}_invalid`);
  return parsed;
}

function isReportFormat(value: unknown): value is ReportFormat {
  return typeof value === 'string' && (REPORT_FORMATS as readonly string[]).includes(value);
}

function correlation(req: RequestWithContext): string {
  const candidates = [req.reportCorrelationId, req.correlationId, req.get('X-Correlation-Id')];
  const value = candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && CORRELATION_ID_PATTERN.test(candidate)
  );
  return value ?? randomUUID();
}

function correlationMiddleware(req: RequestWithContext, res: Response, next: () => void): void {
  const value = correlation(req);
  req.reportCorrelationId = value;
  res.setHeader('X-Correlation-Id', value);
  next();
}

function sendError(res: Response, error: unknown, correlationId: string): void {
  const candidate = error as { code?: unknown; status?: unknown; format?: unknown };
  const code = typeof candidate.code === 'string' && candidate.code ? candidate.code : 'report_failed';
  const renderError = error instanceof ReportRenderError;
  const status =
    renderError && candidate.code === 'report_output_limit_exceeded'
      ? 413
      : Number.isInteger(candidate.status) && Number(candidate.status) >= 400 && Number(candidate.status) < 600
        ? Number(candidate.status)
        : 500;
  const body = {
    error: code,
    code,
    correlationId,
    ...(renderError ? { format: error.format } : {}),
  };
  res.status(status).json(body);
}

function createDefaultStore(sequelize: unknown) {
  const evidenceStorage = new ManualEvidenceStorage({ rootDir: process.env.MANUAL_EXECUTION_EVIDENCE_ROOT });
  const models = {
    Project: defineProject(sequelize, DataTypes),
    Member: defineMember(sequelize, DataTypes),
    Folder: defineFolder(sequelize, DataTypes),
    Case: defineCase(sequelize, DataTypes),
    Step: defineStep(sequelize, DataTypes),
    CaseStep: defineCaseStep(sequelize, DataTypes),
    Run: defineRun(sequelize, DataTypes),
    RunCase: defineRunCase(sequelize, DataTypes),
    User: defineUser(sequelize, DataTypes),
    ManualExecution: defineManualExecution(sequelize, DataTypes),
    ManualExecutionEvidence: defineManualExecutionEvidence(sequelize, DataTypes),
    AutomationExecution: defineAutomationExecution(sequelize, DataTypes),
    AutomationDefinition: defineAutomationDefinition(sequelize, DataTypes),
    ExecutionArtifact: defineExecutionArtifact(sequelize, DataTypes),
  } as unknown as ReportModels;
  return createSequelizeReportStore({
    sequelize: sequelize as SequelizeReportStoreOptions['sequelize'],
    models,
    evidenceProbe: (input) => evidenceStorage.probe(input),
  });
}

function createService(sequelize: unknown, options: ReportRouteOptions, limits: ReportLimits): ReportServicePort {
  if (options.service) return options.service;
  return createReportService({ store: createDefaultStore(sequelize), limits });
}

async function renderReport(
  format: ReportFormat,
  report: ReportModel,
  renderer: ReportRenderer,
  options: ReportRenderOptions
): Promise<Buffer> {
  try {
    const output = await renderer(report, options);
    if (!Buffer.isBuffer(output) || output.length === 0) throw new ReportRenderError(format, 'report_output_invalid');
    return assertRenderedOutput(format, output, options);
  } catch (error) {
    throw wrapRenderError(format, error);
  }
}

function reportFilename(report: ReportModel, format: ReportFormat): string {
  const name = toSafeFileName(typeof report.project?.name === 'string' ? report.project.name : '')
    .replace(/^\.+$/, '')
    .slice(0, 180)
    .trim();
  return `${name || 'project-report'}.${format}`;
}

export default function reportsRoute(sequelize: unknown, options: ReportRouteOptions = {}) {
  const router = express.Router();
  const limits = resolveReportLimits(options.limits);
  const service = createService(sequelize, options, limits);
  const renderers = { ...DEFAULT_RENDERERS, ...options.renderers };
  const { verifySignedIn } = authMiddleware(sequelize);

  router.use(correlationMiddleware);

  router.post('/:projectId/reports', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    const correlationId = req.reportCorrelationId ?? correlation(req);
    try {
      const projectId = positiveId(req.params.projectId, 'projectId');
      const userId = positiveId(req.userId, 'userId');
      const formatValue = req.body && typeof req.body === 'object' ? req.body.format : undefined;
      if (!isReportFormat(formatValue)) throw new ReportError('format_invalid');
      const input = { userId, projectId, request: req.body } as BuildReportInput;
      const report = await service.build(input);
      const output = await renderReport(formatValue, report, renderers[formatValue], {
        maxBytes: limits.maxSerializedBytes,
      });
      res.setHeader('Content-Type', CONTENT_TYPES[formatValue]);
      res.setHeader('Content-Disposition', contentDisposition(reportFilename(report, formatValue)));
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Correlation-Id');
      res.setHeader('Content-Length', String(output.byteLength));
      return res.status(200).send(output);
    } catch (error) {
      sendError(res, error, correlationId);
      return undefined;
    }
  });

  return router;
}
