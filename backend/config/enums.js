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
const templates = ['text', 'step'];
const gherkinKeywords = ['given', 'when', 'then'];
const gherkinTemplate = 2;

const hasValidGherkinKeywords = (steps) =>
  Array.isArray(steps) &&
  steps.every((step) => step?.editState === 'deleted' || gherkinKeywords.includes(step?.caseSteps?.keyword));

export {
  testRunCaseStatus,
  testRunStatus,
  priorities,
  testTypes,
  automationStatus,
  templates,
  gherkinKeywords,
  gherkinTemplate,
  hasValidGherkinKeywords,
};
