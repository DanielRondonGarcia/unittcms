import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineFolder from '../../models/folders.js';
import defineCase from '../../models/cases.js';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import { gherkinTemplate, normalizeGherkinSection } from '../../config/enums.js';
import createCaseOrderService from '../cases/orderService.js';

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
  const { verifyProjectDeveloperFromFolderId } = editableMiddleware(sequelize);

  const Folder = defineFolder(sequelize, DataTypes);
  const Case = defineCase(sequelize, DataTypes);
  const Step = defineStep(sequelize, DataTypes);
  const CaseStep = defineCaseStep(sequelize, DataTypes);
  Case.belongsTo(Folder);
  Case.belongsToMany(Step, { through: 'caseSteps' });
  Step.belongsToMany(Case, { through: 'caseSteps' });
  const caseOrderService = createCaseOrderService({ sequelize, Case, Folder });

  async function _cloneFolderRecursive(sourceFolder, targetParent, transaction) {
    const folderToCreate = {
      name: sourceFolder.name,
      detail: sourceFolder.detail,
      parentFolderId: targetParent.id,
      projectId: targetParent.projectId,
    };

    const clonedFolder = await Folder.create(folderToCreate, { transaction });

    await _cloneCasesAndSteps(sourceFolder.id, clonedFolder.id, transaction);

    const childFolders = await Folder.findAll({
      where: { parentFolderId: sourceFolder.id },
      order: [['id', 'ASC']],
      transaction,
    });

    for (const child of childFolders) {
      await _cloneFolderRecursive(child, clonedFolder, transaction);
    }

    return clonedFolder;
  }

  async function _cloneCasesAndSteps(folderId, targetFolderId, transaction) {
    const folderCases = await Case.findAll({
      where: { folderId },
      order: [
        ['position', 'ASC'],
        ['id', 'ASC'],
      ],
      include: [{ model: Step, through: { attributes: ['stepNo', 'keyword', 'section'] } }],
      transaction,
    });

    if (folderCases.length === 0) return;

    const cases = folderCases.map((c) => c.get({ plain: true }));
    if (cases.some((c) => (c.Steps ?? []).some((step) => normalizeGherkinSection(step.caseSteps?.section) === null))) {
      throw new Error('invalid_case_step_section');
    }

    for (const sourceCase of cases) {
      const sourceSteps = sourceCase.Steps ?? [];
      const newCase = await caseOrderService.createCase({
        attributes: cloneCaseAttributes(sourceCase, targetFolderId),
        folderId: targetFolderId,
        transaction,
      });

      if (sourceSteps.length > 0) {
        const clonedSteps = sourceSteps.map(cloneStepAttributes);

        const newSteps = await Step.bulkCreate(clonedSteps, { transaction });
        const caseSteps = newSteps.map((step, index) => ({
          caseId: newCase.id,
          stepId: step.id,
          stepNo: sourceSteps[index].caseSteps.stepNo,
          keyword: sourceSteps[index].caseSteps.keyword ?? null,
          section:
            sourceCase.template === gherkinTemplate
              ? 'scenario'
              : normalizeGherkinSection(sourceSteps[index].caseSteps?.section),
        }));

        await CaseStep.bulkCreate(caseSteps, { transaction });
      }
    }
  }

  router.post('/:folderId/clone', verifySignedIn, verifyProjectDeveloperFromFolderId, async (req, res) => {
    const folderId = req.params.folderId;
    const { targetFolderId } = req.body;

    try {
      const sourceFolder = await Folder.findByPk(folderId);
      const targetFolder = await Folder.findByPk(targetFolderId);

      if (!sourceFolder || !targetFolder) {
        return res.status(404).send('Folder or target folder not found');
      }

      await sequelize.transaction(async (t) => {
        await _cloneFolderRecursive(sourceFolder, targetFolder, t);
      });

      res.status(201).send({ message: 'Folder cloned successfully' });
    } catch (err) {
      if (err instanceof Error && err.message === 'invalid_case_step_section') {
        return res.status(400).json({ error: 'Invalid Gherkin step section' });
      }
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
}
