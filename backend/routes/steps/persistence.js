import { composeCanonicalSnapshot } from '../../automation/domain/index.js';
import { lintGherkinFeature } from '../../automation/infrastructure/gherkin-lint.js';
import {
  gherkinTemplate,
  hasValidGherkinKeywords,
  hasValidGherkinStepOrder,
  normalizeGherkinSection,
} from '../../config/enums.js';

const editStates = new Set(['notChanged', 'changed', 'new', 'deleted']);

export class CaseSaveValidationError extends Error {
  constructor(code, message, fields = [], status = 400) {
    super(message);
    this.code = code;
    this.fields = fields;
    this.status = status;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function field(fieldName, code, message) {
  return { field: fieldName, code, message };
}

export function validateStepShape(step, index) {
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
  return steps.map((step) => {
    if (step.editState === 'deleted') return step;
    const sourceSection = normalizeGherkinSection(step.caseSteps.section);
    const section = sourceSection ?? 'scenario';
    if (sourceSection === section) return step;
    return {
      ...step,
      caseSteps: { ...step.caseSteps, section },
      editState: step.editState === 'notChanged' ? 'changed' : step.editState,
    };
  });
}

function lintFields(errors) {
  return errors.slice(0, 32).map(({ line, rule, message }) => field(`line ${line}`, rule, message));
}

function isGherkinLintUnavailable(error) {
  return error !== null && typeof error === 'object' && error.code === 'gherkin_lint_unavailable';
}

export async function validateAndNormalizeCaseSteps({
  caseId,
  title,
  template,
  automationVersion,
  gherkinExamples,
  steps,
}) {
  if (!Array.isArray(steps)) {
    throw new CaseSaveValidationError('steps_invalid', 'Steps must be an array');
  }

  const shapeError = steps.map(validateStepShape).find(Boolean);
  if (shapeError) throw new CaseSaveValidationError('step_shape_invalid', shapeError);

  const sourceSectionFor = (step) => normalizeGherkinSection(step?.caseSteps?.section);
  if (steps.some((step) => step.editState !== 'deleted' && sourceSectionFor(step) === null)) {
    throw new CaseSaveValidationError('section_invalid', 'Gherkin step section must be background or scenario', [
      field('Steps', 'section', 'section must be background or scenario'),
    ]);
  }

  const isGherkin = template === gherkinTemplate;
  const normalizedSteps = isGherkin ? normalizeGherkinSteps(steps) : steps;
  if (!isGherkin) return { steps: normalizedSteps };

  if (!hasValidGherkinStepOrder(normalizedSteps)) {
    throw new CaseSaveValidationError(
      'step_order_invalid',
      'Gherkin step order must be unique, consecutive, and positive',
      [field('Steps', 'step_order', 'step order must be unique, consecutive, and positive')]
    );
  }
  if (!hasValidGherkinKeywords(normalizedSteps)) {
    throw new CaseSaveValidationError(
      'keywords_invalid',
      'Gherkin steps require Given, When, Then, and valid step keywords',
      [field('Steps', 'keyword', 'Gherkin steps require Given, When, Then, and valid step keywords')]
    );
  }

  const candidateSteps = normalizedSteps.filter((step) => step.editState !== 'deleted');
  const snapshot = composeCanonicalSnapshot({
    id: caseId,
    title,
    template,
    automationVersion,
    gherkinExamples,
    Steps: candidateSteps,
  });
  if (!snapshot.ok) {
    throw new CaseSaveValidationError('gherkin_invalid', 'Gherkin case is invalid', snapshot.errors);
  }

  let lintErrors;
  try {
    lintErrors = await lintGherkinFeature(snapshot.snapshot.feature);
  } catch (error) {
    if (!isGherkinLintUnavailable(error)) throw error;
    throw new CaseSaveValidationError('gherkin_lint_unavailable', 'Gherkin lint is unavailable', [], 503);
  }
  if (lintErrors.length > 0) {
    throw new CaseSaveValidationError('gherkin_lint_failed', 'Gherkin lint failed', lintFields(lintErrors));
  }

  return { steps: normalizedSteps, snapshot: snapshot.snapshot };
}

function sectionFor(step, isGherkin) {
  const sourceSection = normalizeGherkinSection(step?.caseSteps?.section);
  return isGherkin ? (sourceSection ?? 'scenario') : sourceSection;
}

export async function persistCaseSteps({ caseId, steps, isGherkin, Step, CaseStep, transaction }) {
  const createStep = async (step) => {
    const newStep = await Step.create(
      {
        step: step.step,
        result: step.result,
      },
      { transaction }
    );
    await CaseStep.create(
      {
        caseId,
        stepId: newStep.id,
        stepNo: step.caseSteps.stepNo,
        keyword: step.caseSteps.keyword ?? null,
        section: sectionFor(step, isGherkin),
      },
      { transaction }
    );
    return newStep;
  };

  const deleteStep = async (step) => {
    await CaseStep.destroy({ where: { stepId: step.id }, transaction });
    await Step.destroy({ where: { id: step.id }, transaction });
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
        transaction,
      }
    );
    await CaseStep.update(
      {
        stepNo: step.caseSteps.stepNo,
        keyword: step.caseSteps.keyword ?? null,
        section: sectionFor(step, isGherkin),
      },
      {
        where: { stepId: step.id },
        transaction,
      }
    );
    return step;
  };

  const results = await Promise.all(
    steps.map((step) => {
      if (step.editState === 'new') return createStep(step);
      if (step.editState === 'deleted') return deleteStep(step);
      if (step.editState === 'changed') return updateStep(step);
      return step;
    })
  );
  return results.filter((result) => result !== null);
}
