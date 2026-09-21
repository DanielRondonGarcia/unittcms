import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineFolder from '../../models/folders.js';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinTemplate } from '../../config/enums.js';
import { CaseSaveValidationError, persistCaseSteps, validateAndNormalizeCaseSteps } from '../steps/persistence.js';
import createCaseOrderService, { CaseOrderError } from './orderService.js';

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromCaseId } = editableMiddleware(sequelize);
  const Case = defineCase(sequelize, DataTypes);
  const Folder = defineFolder(sequelize, DataTypes);
  const Step = defineStep(sequelize, DataTypes);
  const CaseStep = defineCaseStep(sequelize, DataTypes);
  const caseOrderService = createCaseOrderService({ sequelize, Case, Folder });
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

      const requestedPosition = updateCase.position;
      const hasPosition = requestedPosition !== undefined && requestedPosition !== null;
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
      delete values.id;
      delete values.folderId;
      delete values.position;
      delete values.createdAt;
      delete values.updatedAt;
      if (isGherkin) values.automationVersion = Number(testcase.automationVersion || 1) + 1;

      if (!hasSteps && !hasPosition) {
        await testcase.update(values);
        return res.json(testcase);
      }

      const t = await sequelize.transaction();
      try {
        if (hasSteps || Object.keys(values).length > 0) {
          await testcase.update(values, { transaction: t });
        }
        if (hasSteps) {
          await persistCaseSteps({
            caseId,
            steps: normalized.steps,
            isGherkin,
            Step,
            CaseStep,
            transaction: t,
          });
        }
        if (hasPosition) {
          const orderedCases = await caseOrderService.moveCase({
            caseId,
            position: requestedPosition,
            transaction: t,
          });
          const movedCase = Array.isArray(orderedCases)
            ? orderedCases.find((row) => Number(row.id) === Number(caseId))
            : null;
          if (movedCase) {
            if (typeof testcase.setDataValue === 'function') {
              testcase.setDataValue('position', movedCase.position);
            } else {
              testcase.position = movedCase.position;
            }
          }
        }
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
      if (error instanceof CaseOrderError && error.status < 500) {
        return res.status(error.status).json({ error: error.message, code: error.code });
      }
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
