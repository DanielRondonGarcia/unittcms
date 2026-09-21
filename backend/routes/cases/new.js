import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineFolder from '../../models/folders.js';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinTemplate, hasValidGherkinExamples } from '../../config/enums.js';
import { CaseSaveValidationError, persistCaseSteps, validateAndNormalizeCaseSteps } from '../steps/persistence.js';
import createCaseOrderService, { CaseOrderError } from './orderService.js';

const requiredFields = ['title', 'state', 'priority', 'type', 'automationStatus', 'template'];

function isEmpty(value) {
  if (value === null || value === undefined) {
    return true;
  } else {
    return false;
  }
}

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromFolderId } = editableMiddleware(sequelize);
  const Case = defineCase(sequelize, DataTypes);
  const Folder = defineFolder(sequelize, DataTypes);
  const Step = defineStep(sequelize, DataTypes);
  const CaseStep = defineCaseStep(sequelize, DataTypes);
  const caseOrderService = createCaseOrderService({ sequelize, Case, Folder });

  router.post('/', verifySignedIn, verifyProjectDeveloperFromFolderId, async (req, res) => {
    const folderId = req.query.folderId;

    try {
      if (
        requiredFields.some((field) => {
          return isEmpty(req.body[field]);
        })
      ) {
        return res.status(400).json({
          error: 'Title, state, priority, type, automationStatus, and template are required',
        });
      }

      const {
        title,
        state,
        priority,
        type,
        automationStatus,
        description,
        template,
        preConditions,
        expectedResults,
        gherkinExamples,
        Steps,
        position,
      } = req.body;

      if (template === gherkinTemplate && !hasValidGherkinExamples(gherkinExamples)) {
        return res.status(400).json({ error: 'Gherkin examples must contain unique headers and matching data rows' });
      }

      const caseAttributes = {
        title,
        state,
        priority,
        type,
        automationStatus,
        description,
        template,
        preConditions,
        expectedResults,
        ...(template === gherkinTemplate ? { gherkinExamples: gherkinExamples ?? null } : {}),
        folderId,
      };

      const hasSteps = Object.prototype.hasOwnProperty.call(req.body, 'Steps');
      const newCase = await sequelize.transaction(async (transaction) => {
        const createdCase = await caseOrderService.createCase({
          attributes: caseAttributes,
          folderId,
          position,
          transaction,
        });

        if (!(template === gherkinTemplate && hasSteps)) return createdCase;

        const normalized = await validateAndNormalizeCaseSteps({
          caseId: createdCase.id,
          title,
          template,
          automationVersion: Number(createdCase.automationVersion || 1),
          gherkinExamples: gherkinExamples ?? null,
          steps: Steps,
        });
        await persistCaseSteps({
          caseId: createdCase.id,
          steps: normalized.steps,
          isGherkin: true,
          Step,
          CaseStep,
          transaction,
        });
        return createdCase;
      });

      res.json(newCase);
    } catch (error) {
      if (error instanceof CaseSaveValidationError) {
        return res.status(error.status).json({
          error: error.message,
          code: error.code,
          ...(error.fields.length ? { fields: error.fields } : {}),
        });
      }
      if (error instanceof CaseOrderError && error.status < 500) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      console.error('Error creating new case:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
