import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinKeywords, gherkinTemplate } from '../../config/enums.js';

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
  const Step = defineStep(sequelize, DataTypes);
  const CaseStep = defineCaseStep(sequelize, DataTypes);

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

      const { title, state, priority, type, automationStatus, description, template, preConditions, expectedResults } =
        req.body;

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
        folderId,
      };

      const newCase =
        template === gherkinTemplate
          ? await sequelize.transaction(async (transaction) => {
              const createdCase = await Case.create(caseAttributes, { transaction });
              for (const [index, keyword] of gherkinKeywords.entries()) {
                const step = await Step.create({ step: '', result: '' }, { transaction });
                await CaseStep.create(
                  { caseId: createdCase.id, stepId: step.id, stepNo: index + 1, keyword },
                  { transaction }
                );
              }
              return createdCase;
            })
          : await Case.create(caseAttributes);

      res.json(newCase);
    } catch (error) {
      console.error('Error creating new case:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
