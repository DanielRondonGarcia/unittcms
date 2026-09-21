import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineFolder from '../../models/folders.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import createCaseOrderService, { CaseOrderError } from './orderService.js';

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromProjectId } = editableMiddleware(sequelize);
  const Case = defineCase(sequelize, DataTypes);
  const Folder = defineFolder(sequelize, DataTypes);
  const caseOrderService = createCaseOrderService({ sequelize, Case, Folder });

  router.put('/move', verifySignedIn, verifyProjectDeveloperFromProjectId, async (req, res) => {
    const { caseIds, targetFolderId } = req.body;

    if (!Array.isArray(caseIds) || caseIds.length === 0 || !targetFolderId) {
      return res.status(400).json({ error: 'caseIds(array) and targetFolderId are required' });
    }

    try {
      await caseOrderService.moveCasesToFolder({ caseIds, targetFolderId });

      res.status(200).json({
        message: 'Cases moved successfully',
        movedCaseIds: caseIds,
        targetFolderId,
      });
    } catch (error) {
      if (error instanceof CaseOrderError && error.status < 500) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      console.error('Error moving cases:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
