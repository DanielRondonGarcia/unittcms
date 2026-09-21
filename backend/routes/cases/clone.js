import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineCase from '../../models/cases.js';
import defineFolder from '../../models/folders.js';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinTemplate, normalizeGherkinSection } from '../../config/enums.js';
import createCaseOrderService from './orderService.js';

function cloneCaseAttributes(sourceCase, targetFolderId) {
  const attributes = { ...sourceCase };
  delete attributes.id;
  delete attributes.createdAt;
  delete attributes.updatedAt;
  delete attributes.position;
  delete attributes.folderId;
  delete attributes.Steps;
  return { ...attributes, folderId: targetFolderId };
}

function cloneStepAttributes(sourceStep) {
  const attributes = { ...sourceStep };
  delete attributes.id;
  delete attributes.createdAt;
  delete attributes.updatedAt;
  delete attributes.caseSteps;
  return attributes;
}

export default function (sequelize) {
  const { verifySignedIn } = authMiddleware(sequelize);
  const { verifyProjectDeveloperFromProjectId } = editableMiddleware(sequelize);
  const Case = defineCase(sequelize, DataTypes);
  const Folder = defineFolder(sequelize, DataTypes);
  const Step = defineStep(sequelize, DataTypes);
  const CaseStep = defineCaseStep(sequelize, DataTypes);
  Case.belongsToMany(Step, { through: 'caseSteps' });
  Step.belongsToMany(Case, { through: 'caseSteps' });
  const caseOrderService = createCaseOrderService({ sequelize, Case, Folder });

  // TODO:  Implement a safer middleware to check permissions based on the actual caseId (in this case, multiples case ids)
  router.post('/clone', verifySignedIn, verifyProjectDeveloperFromProjectId, async (req, res) => {
    const { caseIds, targetFolderId } = req.body;

    if (!Array.isArray(caseIds) || caseIds.length === 0 || !targetFolderId) {
      return res.status(400).json({ error: 'caseIds(array) and targetFolderId are required' });
    }

    try {
      const caseRecords = await Case.findAll({
        where: { id: caseIds },
        order: [
          ['position', 'ASC'],
          ['id', 'ASC'],
        ],
        include: [{ model: Step, through: { attributes: ['stepNo', 'keyword', 'section'] } }],
      });

      if (caseRecords.length !== caseIds.length) {
        return res.status(404).json({ error: 'Some cases not found' });
      }

      const cases = caseRecords.map((c) => c.get({ plain: true }));
      if (
        cases.some((c) => (c.Steps ?? []).some((step) => normalizeGherkinSection(step.caseSteps?.section) === null))
      ) {
        return res.status(400).json({ error: 'Invalid Gherkin step section' });
      }

      await sequelize.transaction(async (t) => {
        for (const sourceCase of cases) {
          const sourceSteps = sourceCase.Steps ?? [];
          const newCase = await caseOrderService.createCase({
            attributes: cloneCaseAttributes(sourceCase, targetFolderId),
            folderId: targetFolderId,
            transaction: t,
          });

          if (sourceSteps.length > 0) {
            const clonedSteps = sourceSteps.map(cloneStepAttributes);

            const newStep = await Step.bulkCreate(clonedSteps, { transaction: t });
            const newCaseSteps = newStep.map((step, index) => ({
              caseId: newCase.id,
              stepId: step.id,
              stepNo: sourceSteps[index].caseSteps.stepNo,
              keyword: sourceSteps[index].caseSteps.keyword ?? null,
              section:
                sourceCase.template === gherkinTemplate
                  ? 'scenario'
                  : normalizeGherkinSection(sourceSteps[index].caseSteps?.section),
            }));

            await CaseStep.bulkCreate(newCaseSteps, { transaction: t });
          }
        }
      });

      res.status(200).json({ message: 'Cases cloned successfully' });
    } catch (error) {
      console.error('Error cloning cases:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
