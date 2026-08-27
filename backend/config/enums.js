// Enum mappings for database numeric values to human-readable labels
// These correspond to the frontend config/selection.ts configurations

// The status of each test case in test run
const testRunCaseStatus = ['untested', 'passed', 'failed', 'retest', 'skipped'];

// The status of each test run
const testRunStatus = ['new', 'inProgress', 'underReview', 'rejected', 'done', 'closed'];

// Priority levels
const priorities = ['critical', 'high', 'medium', 'low'];

// Test types
const testTypes = [
  'other',
  'security',
  'performance',
  'accessibility',
  'functional',
  'acceptance',
  'usability',
  'smokeSanity',
  'compatibility',
  'destructive',
  'regression',
  'automated',
  'manual',
];

// Automation status
const automationStatus = ['automated', 'automation-not-required', 'cannot-be-automated', 'obsolete'];

// Templates
const templates = ['text', 'step', 'gherkin'];
const gherkinKeywords = ['given', 'when', 'then', 'and', 'but'];
const gherkinSections = ['background', 'scenario'];
const gherkinTemplate = 2;

const normalizeGherkinSection = (section) => {
  if (section === undefined || section === null || section === '') return 'scenario';
  return gherkinSections.includes(section) ? section : null;
};

const hasValidGherkinKeywords = (steps) =>
  Array.isArray(steps) &&
  steps.filter((step) => step?.editState !== 'deleted').length > 0 &&
  steps
    .filter((step) => step?.editState !== 'deleted')
    .every(
      (step) =>
        gherkinKeywords.includes(step?.caseSteps?.keyword) && normalizeGherkinSection(step?.caseSteps?.section) !== null
    ) &&
  ['given', 'when', 'then'].every((keyword) =>
    steps.some((step) => step?.editState !== 'deleted' && step?.caseSteps?.keyword === keyword)
  );

const hasValidGherkinStepOrder = (steps) => {
  if (!Array.isArray(steps)) return false;

  const activeStepNumbers = steps
    .filter((step) => step?.editState !== 'deleted')
    .map((step) => Number(step?.caseSteps?.stepNo));

  if (activeStepNumbers.length === 0) return false;
  if (!activeStepNumbers.every((stepNo) => Number.isInteger(stepNo) && stepNo > 0)) return false;
  if (new Set(activeStepNumbers).size !== activeStepNumbers.length) return false;

  return activeStepNumbers
    .slice()
    .sort((left, right) => left - right)
    .every((stepNo, index) => stepNo === index + 1);
};

const hasValidGherkinExamples = (examples) => {
  if (examples === undefined || examples === null) return true;
  if (!examples || typeof examples !== 'object' || Array.isArray(examples)) return false;

  const headers = examples.headers;
  const rows = examples.rows;
  if (!Array.isArray(headers) || headers.length === 0 || !Array.isArray(rows) || rows.length === 0) return false;
  if (headers.some((header) => typeof header !== 'string' || header.trim() === '')) return false;
  if (new Set(headers).size !== headers.length) return false;

  return rows.every(
    (row) => Array.isArray(row) && row.length === headers.length && row.every((cell) => typeof cell === 'string')
  );
};

export {
  testRunCaseStatus,
  testRunStatus,
  priorities,
  testTypes,
  automationStatus,
  templates,
  gherkinKeywords,
  gherkinSections,
  gherkinTemplate,
  normalizeGherkinSection,
  hasValidGherkinKeywords,
  hasValidGherkinStepOrder,
  hasValidGherkinExamples,
};
