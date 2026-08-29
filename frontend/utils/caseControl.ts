import { getFilenameFromContentDisposition } from '@/utils/request';
import { logError } from '@/utils/errorHandler';
import Config from '@/config/config';
const apiServer = Config.apiServer;
import { CaseType, GherkinExamples, StepType } from '@/types/case';
import type { GherkinKeyword, GherkinSection } from '@/types/base';
import { gherkinKeywords } from '@/config/selection';

const gherkinSections = ['background', 'scenario'] as const;

export type GherkinValidationCode =
  | 'steps_required'
  | 'step_order'
  | 'keyword'
  | 'section'
  | 'step_text'
  | 'duplicate_step'
  | 'first_connector'
  | 'required_keywords'
  | 'examples_structure'
  | 'example_headers'
  | 'example_rows'
  | 'example_placeholder'
  | 'details_keyword';

export type GherkinValidationIssue = {
  code: GherkinValidationCode;
  field: string;
  stepIndex?: number;
  stepId?: number;
  rowIndex?: number;
  columnIndex?: number;
};

export type GherkinValidationResult = {
  valid: boolean;
  issues: GherkinValidationIssue[];
};

export type CaseErrorField = {
  field: string;
  code: string;
  message: string;
};

export class CaseRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly fields: CaseErrorField[] = []
  ) {
    super(code);
  }
}

type GherkinKeywordLabels = Partial<Record<GherkinKeyword, string>>;
type CaseErrorPayload = { error?: unknown; code?: unknown; fields?: unknown };

const canonicalKeywordLabels: Record<GherkinKeyword, string> = {
  given: 'Given',
  when: 'When',
  then: 'Then',
  and: 'And',
  but: 'But',
};

function issue(code: GherkinValidationCode, field: string, location: Partial<GherkinValidationIssue> = {}) {
  return { code, field, ...location };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeCaseErrorFields(value: unknown): CaseErrorField[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      const field = typeof item.field === 'string' ? item.field.trim().slice(0, 200) : '';
      const code = typeof item.code === 'string' ? item.code.trim().slice(0, 64) : '';
      const message = typeof item.message === 'string' ? item.message.trim().slice(0, 500) : '';
      return field && code && message ? [{ field, code, message }] : [];
    })
    .slice(0, 32);
}

function isGherkinKeyword(value: unknown): value is GherkinKeyword {
  return typeof value === 'string' && gherkinKeywords.includes(value as GherkinKeyword);
}

function isGherkinSection(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    gherkinSections.includes(value as (typeof gherkinSections)[number])
  );
}

function isValidExamplesShape(examples: unknown): boolean {
  if (examples === null || examples === undefined) return true;
  if (!isRecord(examples) || !Array.isArray(examples.headers) || !Array.isArray(examples.rows)) return false;
  const headers = examples.headers;
  const rows = examples.rows;
  if (headers.length === 0 || rows.length === 0) return false;
  if (headers.some((header) => typeof header !== 'string' || header.trim() === '')) return false;
  if (new Set(headers.map((header) => header.trim())).size !== headers.length) return false;
  return rows.every(
    (row) => Array.isArray(row) && row.length === headers.length && row.every((cell) => typeof cell === 'string')
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startsWithKeyword(text: string, keyword: GherkinKeyword, labels: GherkinKeywordLabels): boolean {
  const candidates = [canonicalKeywordLabels[keyword], labels[keyword]]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  return candidates.some((candidate) => new RegExp(`^${escapeRegExp(candidate)}(?:\\s+|:|$)`, 'iu').test(text));
}

function placeholderNames(text: string): { names: string[]; malformed: boolean } {
  const names = Array.from(text.matchAll(/<([^<>]*)>/g), (match) => match[1].trim());
  const remaining = text.replace(/<[^<>]*>/g, '');
  const malformed = /[<>]/.test(remaining);
  return { names, malformed: malformed || names.some((name) => !name) };
}

export function validateGherkinCase(
  steps: StepType[] = [],
  examples: GherkinExamples | null | undefined = null,
  labels: GherkinKeywordLabels = {}
): GherkinValidationResult {
  const issues: GherkinValidationIssue[] = [];
  const activeEntries = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.editState !== 'deleted');

  if (activeEntries.length === 0) issues.push(issue('steps_required', 'Steps'));

  const orderedEntries = activeEntries.slice().sort((left, right) => {
    const leftStepNo = Number(left.step.caseSteps?.stepNo);
    const rightStepNo = Number(right.step.caseSteps?.stepNo);
    const leftOrder = Number.isFinite(leftStepNo) ? leftStepNo : Number.POSITIVE_INFINITY;
    const rightOrder = Number.isFinite(rightStepNo) ? rightStepNo : Number.POSITIVE_INFINITY;
    return leftOrder - rightOrder || left.index - right.index;
  });
  const validOrderEntries = orderedEntries.filter(({ step }) => {
    const stepNo = Number(step.caseSteps?.stepNo);
    return Number.isInteger(stepNo) && stepNo > 0;
  });
  const orderCounts = new Map<number, number>();

  activeEntries.forEach(({ step, index }) => {
    const stepNo = Number(step.caseSteps?.stepNo);
    const stepField = `Steps[${index}]`;
    if (!Number.isInteger(stepNo) || stepNo < 1) {
      issues.push(issue('step_order', `${stepField}.caseSteps.stepNo`, { stepIndex: index, stepId: step.id }));
    } else {
      orderCounts.set(stepNo, (orderCounts.get(stepNo) ?? 0) + 1);
    }

    const keyword = step.caseSteps?.keyword;
    const section = step.caseSteps?.section;
    if (!isGherkinKeyword(keyword)) {
      issues.push(issue('keyword', `${stepField}.caseSteps.keyword`, { stepIndex: index, stepId: step.id }));
    }
    if (!isGherkinSection(section)) {
      issues.push(issue('section', `${stepField}.caseSteps.section`, { stepIndex: index, stepId: step.id }));
    }

    const rawText = typeof step.step === 'string' ? step.step : '';
    const text = rawText.trim();
    if (!text || /[\r\n]/.test(rawText)) {
      issues.push(issue('step_text', `${stepField}.step`, { stepIndex: index, stepId: step.id }));
    }

    if (text && gherkinKeywords.some((candidate) => startsWithKeyword(text, candidate, labels))) {
      issues.push(issue('details_keyword', `${stepField}.step`, { stepIndex: index, stepId: step.id }));
    }
  });

  orderCounts.forEach((count, stepNo) => {
    if (count > 1) {
      activeEntries.forEach(({ step, index }) => {
        if (Number(step.caseSteps?.stepNo) === stepNo) {
          issues.push(issue('step_order', `Steps[${index}].caseSteps.stepNo`, { stepIndex: index, stepId: step.id }));
        }
      });
    }
  });

  if (validOrderEntries.length === activeEntries.length && new Set(orderCounts.keys()).size === activeEntries.length) {
    validOrderEntries
      .map(({ step }) => Number(step.caseSteps.stepNo))
      .sort((left, right) => left - right)
      .forEach((stepNo, index) => {
        if (stepNo !== index + 1) {
          const entry = activeEntries.find(({ step }) => Number(step.caseSteps.stepNo) === stepNo);
          if (entry) {
            issues.push(
              issue('step_order', `Steps[${entry.index}].caseSteps.stepNo`, {
                stepIndex: entry.index,
                stepId: entry.step.id,
              })
            );
          }
        }
      });
  }

  const seenRows = new Set<string>();
  const firstBySection = new Set<string>();
  orderedEntries.forEach(({ step, index }) => {
    const keyword = step.caseSteps?.keyword;
    const section = step.caseSteps?.section === 'background' ? 'background' : 'scenario';
    const text = typeof step.step === 'string' ? step.step.trim() : '';
    if (isGherkinKeyword(keyword) && text && isGherkinSection(step.caseSteps?.section)) {
      const rowKey = JSON.stringify([section, keyword, typeof step.step === 'string' ? step.step : '']);
      if (seenRows.has(rowKey)) {
        issues.push(issue('duplicate_step', `Steps[${index}]`, { stepIndex: index, stepId: step.id }));
      }
      seenRows.add(rowKey);

      if (!firstBySection.has(section)) {
        if (keyword === 'and' || keyword === 'but') {
          issues.push(
            issue('first_connector', `Steps[${index}].caseSteps.keyword`, { stepIndex: index, stepId: step.id })
          );
        }
        firstBySection.add(section);
      }
    }
  });

  const keywords = new Set(
    activeEntries
      .map(({ step }) => step.caseSteps?.keyword)
      .filter((keyword): keyword is GherkinKeyword => isGherkinKeyword(keyword))
  );
  if (!['given', 'when', 'then'].every((keyword) => keywords.has(keyword as GherkinKeyword))) {
    issues.push(issue('required_keywords', 'Steps'));
  }

  if (examples !== null && examples !== undefined) {
    if (!isRecord(examples) || !Array.isArray(examples.headers) || !Array.isArray(examples.rows)) {
      issues.push(issue('examples_structure', 'gherkinExamples'));
    } else {
      const headers = examples.headers;
      const rows = examples.rows;
      if (
        headers.length === 0 ||
        headers.some((header) => typeof header !== 'string' || header.trim() === '') ||
        new Set(headers.map((header) => (typeof header === 'string' ? header.trim() : header))).size !== headers.length
      ) {
        issues.push(issue('example_headers', 'gherkinExamples.headers'));
      }
      if (
        rows.length === 0 ||
        rows.some((row, rowIndex) => {
          const invalid =
            !Array.isArray(row) || row.length !== headers.length || row.some((cell) => typeof cell !== 'string');
          if (invalid) issues.push(issue('example_rows', `gherkinExamples.rows[${rowIndex}]`, { rowIndex }));
          return invalid;
        })
      ) {
        if (!issues.some((entry) => entry.code === 'example_rows'))
          issues.push(issue('example_rows', 'gherkinExamples.rows'));
      }

      if (isValidExamplesShape(examples)) {
        const headerSet = new Set(headers.map((header) => header.trim()));
        const names = activeEntries.flatMap(({ step, index }) => {
          const parsed = placeholderNames(typeof step.step === 'string' ? step.step : '');
          if (parsed.malformed) {
            issues.push(issue('example_placeholder', `Steps[${index}].step`, { stepIndex: index, stepId: step.id }));
          }
          parsed.names
            .filter((name) => !headerSet.has(name))
            .forEach(() =>
              issues.push(issue('example_placeholder', `Steps[${index}].step`, { stepIndex: index, stepId: step.id }))
            );
          return parsed.names;
        });
        if (names.length === 0) issues.push(issue('example_placeholder', 'gherkinExamples'));
      }
    }
  } else {
    activeEntries.forEach(({ step, index }) => {
      const parsed = placeholderNames(typeof step.step === 'string' ? step.step : '');
      if (parsed.names.length > 0 || parsed.malformed) {
        issues.push(issue('example_placeholder', `Steps[${index}].step`, { stepIndex: index, stepId: step.id }));
      }
    });
  }

  return { valid: issues.length === 0, issues };
}

export function normalizeGherkinCaseSteps(steps: StepType[] = []) {
  let migrated = false;

  const activeSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.editState !== 'deleted')
    .sort((left, right) => {
      const leftStepNo = Number(left.step.caseSteps.stepNo);
      const rightStepNo = Number(right.step.caseSteps.stepNo);
      const leftOrder = Number.isFinite(leftStepNo) ? leftStepNo : Number.POSITIVE_INFINITY;
      const rightOrder = Number.isFinite(rightStepNo) ? rightStepNo : Number.POSITIVE_INFINITY;

      return leftOrder - rightOrder || left.index - right.index;
    });

  const normalizedActiveSteps = activeSteps.map(({ step }, index) => {
    const stepNo = index + 1;
    const section: GherkinSection = step.caseSteps.section === 'background' ? 'background' : 'scenario';
    const orderChanged = step.caseSteps.stepNo !== stepNo;
    const sectionChanged = step.caseSteps.section !== section;

    if (!orderChanged && !sectionChanged) return step;

    migrated = true;
    return {
      ...step,
      caseSteps: { ...step.caseSteps, stepNo, section },
      editState: step.editState === 'notChanged' ? 'changed' : step.editState,
    };
  });

  let activeIndex = 0;
  const normalizedSteps = steps.map((step) => {
    if (step.editState === 'deleted') return step;
    return normalizedActiveSteps[activeIndex++];
  });

  return { steps: normalizedSteps, migrated };
}

export const hasValidGherkinStepOrder = (steps: StepType[] = []) => {
  const activeStepNumbers = steps
    .filter((step) => step.editState !== 'deleted')
    .map((step) => Number(step.caseSteps.stepNo));

  if (activeStepNumbers.length === 0) return false;
  if (!activeStepNumbers.every((stepNo) => Number.isInteger(stepNo) && stepNo > 0)) return false;
  if (new Set(activeStepNumbers).size !== activeStepNumbers.length) return false;

  return activeStepNumbers
    .slice()
    .sort((left, right) => left - right)
    .every((stepNo, index) => stepNo === index + 1);
};

function withStepNo(step: StepType, stepNo: number) {
  if (step.caseSteps.stepNo === stepNo) return step;

  return {
    ...step,
    caseSteps: { ...step.caseSteps, stepNo },
    editState: step.editState === 'notChanged' ? 'changed' : step.editState,
  };
}

export function insertGherkinCaseStep(steps: StepType[], newStep: StepType, requestedStepNo: number) {
  const normalizedSteps = normalizeGherkinCaseSteps(steps).steps;
  const activeStepCount = normalizedSteps.filter((step) => step.editState !== 'deleted').length;
  const requested = Number(requestedStepNo);
  const stepNo = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), activeStepCount + 1)
    : activeStepCount + 1;

  const shiftedSteps = normalizedSteps.map((step) => {
    if (step.editState === 'deleted' || step.caseSteps.stepNo < stepNo) return step;
    return withStepNo(step, step.caseSteps.stepNo + 1);
  });

  const insertedStep = {
    ...newStep,
    caseSteps: {
      ...newStep.caseSteps,
      stepNo,
      section: newStep.caseSteps.section === 'background' ? ('background' as const) : ('scenario' as const),
    },
  };

  return normalizeGherkinCaseSteps([...shiftedSteps, insertedStep]).steps;
}

export function deleteGherkinCaseStep(steps: StepType[], stepId: number) {
  const normalizedSteps = normalizeGherkinCaseSteps(steps).steps;
  const orderedActiveSteps = normalizedSteps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.editState !== 'deleted')
    .sort((left, right) => left.step.caseSteps.stepNo - right.step.caseSteps.stepNo || left.index - right.index);
  const deletedStep = orderedActiveSteps.find(({ step }) => step.id === stepId);

  if (!deletedStep) return normalizedSteps;

  let nextStepNo = 1;
  const renumberedActiveSteps = orderedActiveSteps
    .filter(({ step }) => step.id !== stepId)
    .map(({ step }) => withStepNo(step, nextStepNo++));
  let activeIndex = 0;

  return normalizedSteps.map((step) => {
    if (step.editState === 'deleted') return step;
    if (step.id === stepId) return { ...deletedStep.step, editState: 'deleted' as const };
    return renumberedActiveSteps[activeIndex++];
  });
}

export const hasValidGherkinKeywords = (steps: StepType[] = []) => {
  const activeSteps = steps.filter((step) => step.editState !== 'deleted');

  return (
    activeSteps.length > 0 &&
    activeSteps.every(
      (step) =>
        Boolean(step.caseSteps.keyword && gherkinKeywords.includes(step.caseSteps.keyword)) &&
        (step.caseSteps.section === undefined ||
          step.caseSteps.section === null ||
          gherkinSections.includes(step.caseSteps.section))
    ) &&
    activeSteps.some((step) => step.caseSteps.keyword === 'given') &&
    activeSteps.some((step) => step.caseSteps.keyword === 'when') &&
    activeSteps.some((step) => step.caseSteps.keyword === 'then')
  );
};

export const hasValidGherkinExamples = (examples: GherkinExamples | null | undefined) => {
  return isValidExamplesShape(examples);
};

async function fetchCase(jwt: string, caseId: number) {
  const url = `${apiServer}/cases/${caseId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data', error);
  }
}

async function fetchCases(
  jwt: string,
  folderId: number,
  search?: string,
  priority?: number[],
  type?: number[],
  tag?: number[]
) {
  const queryParams = [`folderId=${folderId}`];

  if (search) {
    queryParams.push(`search=${search}`);
  }

  if (priority && priority.length > 0) {
    queryParams.push(`priority=${priority.join(',')}`);
  }

  if (type && type.length > 0) {
    queryParams.push(`type=${type.join(',')}`);
  }

  if (tag && tag.length > 0) {
    queryParams.push(`tag=${tag.join(',')}`);
  }

  const query = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

  const url = `${apiServer}/cases${query}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data || [];
  } catch (error: unknown) {
    logError('Error fetching data', error);
    return [];
  }
}

async function createCase(jwt: string, folderId: string, title: string, description: string, template = 0) {
  const newCase = {
    title: title,
    state: 0,
    priority: 2,
    type: 0,
    automationStatus: 0,
    description: description,
    template,
    preConditions: '',
    expectedResults: '',
  };

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(newCase),
  };

  const url = `${apiServer}/cases?folderId=${folderId}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error creating case', error);
  }
}

async function updateCase(jwt: string, updateCaseData: CaseType) {
  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(updateCaseData),
  };

  const url = `${apiServer}/cases/${updateCaseData.id}`;
  try {
    const response = await fetch(url, fetchOptions);
    const payload = (await response.json().catch(() => ({}))) as CaseErrorPayload;
    if (!response.ok) {
      const code =
        typeof payload.code === 'string'
          ? payload.code
          : typeof payload.error === 'string'
            ? payload.error
            : 'case_update_failed';
      throw new CaseRequestError(response.status, code, safeCaseErrorFields(payload.fields));
    }
    return payload;
  } catch (error: unknown) {
    logError('Error updating case', error);
    throw error;
  }
}

export async function moveCases(jwt: string, moveCaseIds: number[], targetFolderId: number, projectId: number) {
  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ caseIds: moveCaseIds, targetFolderId }),
  };
  const url = `${apiServer}/cases/move?projectId=${projectId}`;
  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error updating project', error);
  }
}

async function deleteCases(jwt: string, deleteCaseIds: number[], projectId: number) {
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ caseIds: deleteCaseIds }),
  };

  const url = `${apiServer}/cases/bulkdelete?projectId=${projectId}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
  } catch (error: unknown) {
    logError('Error deleting cases', error);
  }
}

async function cloneCases(jwt: string, moveCaseIds: number[], targetFolderId: number, projectId: number) {
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ caseIds: moveCaseIds, targetFolderId }),
  };
  const url = `${apiServer}/cases/clone?projectId=${projectId}`;
  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error cloning project', error);
  }
}

async function exportCases(jwt: string, folderId: number, type: string) {
  if (type !== 'json' && type !== 'csv') {
    console.error('export type error. type:', type);
    return;
  }
  const url = `${apiServer}/cases/download?folderId=${folderId}&type=${type}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const disposition = response.headers.get('content-disposition');
    const filename = getFilenameFromContentDisposition(disposition) ?? `cases.${type}`;

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error: unknown) {
    logError('Error fetching data', error);
  }
}

async function importCases(jwt: string, folderId: number, file: File) {
  const url = `${apiServer}/cases/import?folderId=${folderId}`;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      body: formData,
    });

    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error importing data', error);
  }
}

export { fetchCase, fetchCases, updateCase, createCase, deleteCases, cloneCases, exportCases, importCases };
