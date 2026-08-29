import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import defineCase from '../../models/cases.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinTemplate } from '../../config/enums.js';
import { persistCaseSteps, validateAndNormalizeCaseSteps, CaseSaveValidationError } from './persistence.js';

export default function (sequelize) {
  const Step = defineStep(sequelize, DataTypes);
  const CaseStep = defineCaseStep(sequelize, DataTypes);
  const Case = defineCase(sequelize, DataTypes);
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromCaseId } = editableMiddleware(sequelize);

  router.post('/update', verifySignedIn, verifyProjectDeveloperFromCaseId, async (req, res) => {
    const caseId = req.query.caseId;
    const steps = req.body;
    const testcase = await Case.findByPk(caseId);

    if (!testcase) {
      return res.status(404).json({ error: 'Case not found' });
    }

    let normalized;
    try {
      normalized = await validateAndNormalizeCaseSteps({
        caseId,
        title: testcase.title,
        template: testcase.template,
        automationVersion: testcase.automationVersion,
        gherkinExamples: testcase.gherkinExamples,
        steps,
      });
    } catch (error) {
      if (error instanceof CaseSaveValidationError) {
        return res
          .status(error.status)
          .json({ error: error.message, code: error.code, ...(error.fields.length ? { fields: error.fields } : {}) });
      }
      throw error;
    }

    const t = await sequelize.transaction();
    try {
      const results = await persistCaseSteps({
        caseId,
        steps: normalized.steps,
        isGherkin: testcase.template === gherkinTemplate,
        Step,
        CaseStep,
        transaction: t,
      });

      if (testcase.template === gherkinTemplate && typeof testcase.update === 'function') {
        await testcase.update({ automationVersion: Number(testcase.automationVersion || 1) + 1 }, { transaction: t });
      }
      await t.commit();
      res.json(results.filter((result) => result !== null));
    } catch (error) {
      console.error(error);
      await t.rollback();
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
