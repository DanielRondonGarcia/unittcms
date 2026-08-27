import express from 'express';
const router = express.Router();
import { DataTypes } from 'sequelize';
import defineStep from '../../models/steps.js';
import defineCaseStep from '../../models/caseSteps.js';
import defineCase from '../../models/cases.js';
import authMiddleware from '../../middleware/auth.js';
import editableMiddleware from '../../middleware/verifyEditable.js';
import {
  gherkinTemplate,
  hasValidGherkinKeywords,
  hasValidGherkinStepOrder,
  normalizeGherkinSection,
} from '../../config/enums.js';

const editStates = new Set(['notChanged', 'changed', 'new', 'deleted']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateStepShape(step, index) {
  if (!isRecord(step)) return `Steps[${index}] must be an object`;
  if (!editStates.has(step.editState)) return `Steps[${index}].editState is invalid`;
  if (step.editState !== 'new' && (!Number.isInteger(Number(step.id)) || Number(step.id) <= 0)) {
    return `Steps[${index}].id must be a positive integer`;
  }
  if (step.editState === 'deleted') return null;
  if (!isRecord(step.caseSteps)) return `Steps[${index}].caseSteps is required`;
  if (!Number.isInteger(Number(step.caseSteps.stepNo)) || Number(step.caseSteps.stepNo) < 1) {
    return `Steps[${index}].caseSteps.stepNo must be a positive integer`;
  }
  if (typeof step.step !== 'string' || typeof step.result !== 'string') {
    return `Steps[${index}].step and result must be strings`;
  }
  return null;
}

function normalizeGherkinSteps(steps) {
  return {
    steps: steps.map((step) => {
      if (step.editState === 'deleted') return step;
      const section = normalizeGherkinSection(step.caseSteps.section) ?? 'scenario';
      if (normalizeGherkinSection(step.caseSteps.section) === section) return step;
      return {
        ...step,
        caseSteps: { ...step.caseSteps, section },
        editState: step.editState === 'notChanged' ? 'changed' : step.editState,
      };
    }),
  };
}

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

    if (!Array.isArray(steps)) {
      return res.status(400).json({ error: 'Steps must be an array' });
    }

    const shapeError = steps.map(validateStepShape).find(Boolean);
    if (shapeError) return res.status(400).json({ error: shapeError });

    if (testcase.template === gherkinTemplate && !hasValidGherkinStepOrder(steps)) {
      return res.status(400).json({ error: 'Gherkin step order must be unique, consecutive, and positive' });
    }

    if (testcase.template === gherkinTemplate && !hasValidGherkinKeywords(steps)) {
      return res.status(400).json({ error: 'Gherkin steps require Given, When, Then, and valid step keywords' });
    }

    const sourceSectionFor = (step) => normalizeGherkinSection(step?.caseSteps?.section);
    if (steps.some((step) => step.editState !== 'deleted' && sourceSectionFor(step) === null)) {
      return res.status(400).json({ error: 'Gherkin step section must be background or scenario' });
    }
    const sectionFor = (step) =>
      testcase.template === gherkinTemplate ? sourceSectionFor(step) ?? 'scenario' : sourceSectionFor(step);

    const normalized = testcase.template === gherkinTemplate ? normalizeGherkinSteps(steps) : { steps };
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    const stepsToSave = normalized.steps;

    const t = await sequelize.transaction();

    const createStep = async (step) => {
      const newStep = await Step.create(
        {
          step: step.step,
          result: step.result,
        },
        { transaction: t }
      );
      await CaseStep.create(
        {
          caseId: caseId,
          stepId: newStep.id,
          stepNo: step.caseSteps.stepNo,
          keyword: step.caseSteps.keyword ?? null,
          section: sectionFor(step),
        },
        { transaction: t }
      );
      return newStep;
    };

    const deleteStep = async (step) => {
      await CaseStep.destroy({
        where: { stepId: step.id },
        transaction: t,
      });
      await Step.destroy({
        where: { id: step.id },
        transaction: t,
      });
      return null;
    };

    const updateStep = async (step) => {
      await Step.update(
        {
          step: step.step,
          result: step.result,
        },
        {
          where: { id: step.id },
          transaction: t,
        }
      );
      await CaseStep.update(
        {
          stepNo: step.caseSteps.stepNo,
          keyword: step.caseSteps.keyword ?? null,
          section: sectionFor(step),
        },
        {
          where: { stepId: step.id },
          transaction: t,
        }
      );
      return step;
    };
    try {
      const results = await Promise.all(
        stepsToSave.map(async (step) => {
          if (step.editState === 'new') {
            return createStep(step);
          } else if (step.editState === 'deleted') {
            return deleteStep(step);
          } else if (step.editState === 'changed') {
            return updateStep(step);
          } else if (step.editState === 'notChanged') {
            return step;
          }
        })
      );

      if (typeof testcase.update === 'function') {
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
