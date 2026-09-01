import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineFolder from '../../models/folders.js';
import defineManualExecution from '../../models/manualExecutions.js';
import defineManualExecutionEvidence from '../../models/manualExecutionEvidence.js';
import defineMember from '../../models/members.js';
import defineProject from '../../models/projects.js';
import defineRun from '../../models/runs.js';
import defineRunCase from '../../models/runCases.js';
import authMiddleware from '../../middleware/auth.js';
import {
  createManualExecutionService,
  ManualExecutionError,
  type ManualExecutionModels,
  type ManualEvidenceStoragePort,
} from '../../manual-execution/application/service.js';
import type { ManualExecutionServicePort } from '../../manual-execution/api/types.js';
import { MAX_EVIDENCE_BYTES, ManualEvidenceStorage } from '../../manual-execution/infrastructure/storage.js';

type RequestWithContext = Request & { userId?: number; correlationId?: string };
type UploadedFile = { buffer: Buffer; mimetype: string; originalname: string };
type RouteOptions = {
  service?: ManualExecutionServicePort;
  storage?: ManualEvidenceStoragePort;
};

function id(value: string | undefined, field: string): number {
  const parsed = value && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ManualExecutionError(`${field}_invalid`);
  return parsed;
}

function queryNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ManualExecutionError(`${field}_invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ManualExecutionError(`${field}_invalid`);
  return parsed;
}

function correlation(req: RequestWithContext): string {
  return req.correlationId ?? req.get('X-Correlation-Id') ?? 'unknown';
}

function sendError(req: RequestWithContext, res: Response, error: unknown): void {
  const candidate = error as { code?: string; status?: number };
  const code = candidate?.code || 'manual_execution_failed';
  const status =
    Number.isInteger(candidate?.status) && (candidate.status as number) >= 400 ? (candidate.status as number) : 500;
  res.status(status).json({ error: code, code, correlationId: correlation(req) });
}

function safeFilename(filename: string): string {
  return filename.replace(/[\r\n"\\/]/g, '_').slice(0, 255) || 'evidence';
}

function uploadMiddleware(upload: multer.Multer, req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();
    const correlationId = correlation(req);
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'evidence_size_exceeded', code: 'evidence_size_exceeded', correlationId });
    }
    return res.status(400).json({ error: 'evidence_upload_invalid', code: 'evidence_upload_invalid', correlationId });
  });
}

function createService(sequelize: unknown, options: RouteOptions): ManualExecutionServicePort {
  if (options.service) return options.service;
  const models: ManualExecutionModels = {
    ManualExecution: defineManualExecution(sequelize, DataTypes),
    ManualExecutionEvidence: defineManualExecutionEvidence(sequelize, DataTypes),
    RunCase: defineRunCase(sequelize, DataTypes),
    Run: defineRun(sequelize, DataTypes),
    Case: defineCase(sequelize, DataTypes),
    Folder: defineFolder(sequelize, DataTypes),
    Project: defineProject(sequelize, DataTypes),
    Member: defineMember(sequelize, DataTypes),
  } as unknown as ManualExecutionModels;
  const storage = options.storage ?? new ManualEvidenceStorage({ rootDir: process.env.MANUAL_EXECUTION_EVIDENCE_ROOT });
  return createManualExecutionService({ sequelize: sequelize as never, models, storage });
}

export default function manualExecutionsRoute(sequelize: unknown, options: RouteOptions = {}) {
  const router = express.Router();
  const service = createService(sequelize, options);
  const { verifySignedIn } = authMiddleware(sequelize);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_EVIDENCE_BYTES } });

  router.post('/run-cases/:runCaseId', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.start(id(req.params.runCaseId, 'runCaseId'), Number(req.userId), correlation(req));
      res.setHeader('X-Correlation-Id', result.correlationId);
      return res.status(201).json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.get('/run-cases/:runCaseId/active', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.active(id(req.params.runCaseId, 'runCaseId'), Number(req.userId));
      if (!result)
        return res.status(404).json({
          error: 'active_execution_not_found',
          code: 'active_execution_not_found',
          correlationId: correlation(req),
        });
      res.setHeader('X-Correlation-Id', result.correlationId);
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.get('/run-cases/:runCaseId/history', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.listHistory(
        id(req.params.runCaseId, 'runCaseId'),
        Number(req.userId),
        queryNumber(req.query.page, 'page', 1),
        queryNumber(req.query.limit, 'limit', 20)
      );
      res.setHeader('X-Correlation-Id', correlation(req));
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.get('/:executionId/evidence/:evidenceId', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.downloadEvidence(
        id(req.params.executionId, 'executionId'),
        id(req.params.evidenceId, 'evidenceId'),
        Number(req.userId)
      );
      res.setHeader('X-Correlation-Id', correlation(req));
      res.setHeader('Content-Type', result.evidence.mimeType);
      res.setHeader('Content-Length', String(result.bytes.byteLength));
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename(result.evidence.filename)}"`);
      return res.send(Buffer.from(result.bytes));
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.delete(
    '/:executionId/evidence/:evidenceId',
    verifySignedIn,
    async (req: RequestWithContext, res: Response) => {
      try {
        await service.deleteEvidence(
          id(req.params.executionId, 'executionId'),
          id(req.params.evidenceId, 'evidenceId'),
          Number(req.userId)
        );
        res.setHeader('X-Correlation-Id', correlation(req));
        return res.status(204).send();
      } catch (error) {
        return sendError(req, res, error);
      }
    }
  );

  router.get('/:executionId/evidence', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.listEvidence(id(req.params.executionId, 'executionId'), Number(req.userId));
      res.setHeader('X-Correlation-Id', correlation(req));
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.post(
    '/:executionId/evidence',
    verifySignedIn,
    (req, res, next) => uploadMiddleware(upload, req, res, next),
    async (req: RequestWithContext, res: Response) => {
      try {
        const file = req.file as UploadedFile | undefined;
        if (!file) throw new ManualExecutionError('evidence_file_required');
        const expectedSha256 = typeof req.body?.sha256 === 'string' ? req.body.sha256 : undefined;
        const result = await service.uploadEvidence(id(req.params.executionId, 'executionId'), Number(req.userId), {
          content: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname,
          expectedSha256,
        });
        res.setHeader('X-Correlation-Id', correlation(req));
        return res.status(201).json(result);
      } catch (error) {
        return sendError(req, res, error);
      }
    }
  );

  router.post('/:executionId/finish', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.finish(
        id(req.params.executionId, 'executionId'),
        Number(req.userId),
        req.body?.result,
        req.body?.report
      );
      res.setHeader('X-Correlation-Id', result.correlationId);
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.patch('/:executionId/report', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.updateReport(
        id(req.params.executionId, 'executionId'),
        Number(req.userId),
        req.body?.report
      );
      res.setHeader('X-Correlation-Id', result.correlationId);
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.post('/:executionId/cancel', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.cancel(id(req.params.executionId, 'executionId'), Number(req.userId));
      res.setHeader('X-Correlation-Id', result.correlationId);
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.get('/:executionId', verifySignedIn, async (req: RequestWithContext, res: Response) => {
    try {
      const result = await service.get(id(req.params.executionId, 'executionId'), Number(req.userId));
      res.setHeader('X-Correlation-Id', result.correlationId);
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  return router;
}
