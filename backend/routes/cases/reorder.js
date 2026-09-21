import express from 'express';
const router = express.Router();
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import createCaseOrderService, { CaseOrderError } from './orderService.js';

function exposeBodyFolderIdToEditableMiddleware(req, _res, next) {
  req.query = { ...req.query, folderId: req.body?.folderId };
  return next();
}

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromFolderId } = editableMiddleware(sequelize);
  const caseOrderService = createCaseOrderService({ sequelize });

  router.put(
    '/reorder',
    verifySignedIn,
    exposeBodyFolderIdToEditableMiddleware,
    verifyProjectDeveloperFromFolderId,
    async (req, res) => {
      const { folderId, orderedCaseIds } = req.body ?? {};

      try {
        const committedCases = await caseOrderService.reorderFolder({ folderId, orderedCaseIds });

        return res.status(200).json({
          folderId: Number(folderId),
          orderedCaseIds: orderedCaseIds.map((caseId) => Number(caseId)),
          committed: committedCases.map((testcase) => ({
            id: Number(testcase.id),
            position: Number(testcase.position),
          })),
        });
      } catch (error) {
        if (error instanceof CaseOrderError && error.status >= 400 && error.status < 500) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }

        console.error('Error reordering cases:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  );

  return router;
}
