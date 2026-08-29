import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinTemplate } from '../../config/enums.js';
import { CaseSaveValidationError, persistCaseSteps, validateAndNormalizeCaseSteps } from '../steps/persistence.js';

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromCaseId } = editableMiddleware(sequelize);
  const Case = defineCase(sequelize, DataTypes);
  const Step = defineStep(sequelize, DataTypes);
  const CaseStep = defineCaseStep(sequelize, DataTypes);
  Case.belongsToMany(Step, { through: CaseStep });
  Step.belongsToMany(Case, { through: CaseStep });

  router.put('/:caseId', verifySignedIn, verifyProjectDeveloperFromCaseId, async (req, res) => {
    const caseId = req.params.caseId;
    const updateCase = req.body;
    try {
      const testcase = await Case.findByPk(caseId, {
        include: [{ model: Step, through: { attributes: ['stepNo', 'keyword', 'section'] } }],
      });
      if (!testcase) {
        return res.status(404).send('Case not found');
      }

      const isGherkin = (updateCase.template ?? testcase.template) === gherkinTemplate;
      const hasSteps = Object.prototype.hasOwnProperty.call(updateCase, 'Steps');
      const values = { ...updateCase };
      const candidateSteps = hasSteps
        ? updateCase.Steps
        : (testcase.Steps ?? []).map((step) => ({ ...step, editState: step.editState ?? 'notChanged' }));
      const normalized = await validateAndNormalizeCaseSteps({
        caseId,
        title: updateCase.title ?? testcase.title,
        template: updateCase.template ?? testcase.template,
        automationVersion: Number(testcase.automationVersion || 1) + (isGherkin ? 1 : 0),
        gherkinExamples: Object.prototype.hasOwnProperty.call(updateCase, 'gherkinExamples')
          ? updateCase.gherkinExamples
          : testcase.gherkinExamples,
        steps: candidateSteps,
      });
      delete values.Steps;
      if (isGherkin) values.automationVersion = Number(testcase.automationVersion || 1) + 1;

      if (!hasSteps) {
        await testcase.update(values);
        return res.json(testcase);
      }

      const t = await sequelize.transaction();
      try {
        await testcase.update(values, { transaction: t });
        await persistCaseSteps({
          caseId,
          steps: normalized.steps,
          isGherkin,
          Step,
          CaseStep,
          transaction: t,
        });
        await t.commit();
      } catch (error) {
        await t.rollback();
        throw error;
      }
      res.json(testcase);
    } catch (error) {
      if (error instanceof CaseSaveValidationError) {
        return res.status(error.status).json({
          error: error.message,
          code: error.code,
          ...(error.fields.length ? { fields: error.fields } : {}),
        });
      }
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
