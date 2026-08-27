import { AutomationStatusType, GlobalRoleType, GherkinKeyword, MemberRoleType, TemplateType } from '@/types/base';
import { RunStatusType, TestRunCaseStatusType } from '@/types/status';
import { TestTypeType } from '@/types/testType';
import { PriorityType } from '@/types/priority';
import { LocaleType } from '@/types/locale';

const roles: GlobalRoleType[] = [{ uid: 'administrator' }, { uid: 'user' }];
const memberRoles: MemberRoleType[] = [{ uid: 'manager' }, { uid: 'developer' }, { uid: 'reporter' }];

const categoricalPalette = ['#fba91e', '#6ea56c', '#3ac6e1', '#feda2f', '#f15f47', '#244470', '#9c80bb', '#f595a6'];

/**
 * Locales are grouped by script: Latin-based locales first, followed by CJK.
 * Within Latin-based group, entries are sorted lexicographically by their BCP 47 codes.
 * This matches common UI patterns.
 */
const locales: LocaleType[] = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'pt-BR', name: 'Português' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'ja', name: '日本語' },
];

// The status of each test run
const testRunStatus: RunStatusType[] = [
  { uid: 'new' },
  { uid: 'inProgress' },
  { uid: 'underReview' },
  { uid: 'rejected' },
  { uid: 'done' },
  { uid: 'closed' },
];

// The status of each test case in test run
const testRunCaseStatus: TestRunCaseStatusType[] = [
  {
    uid: 'untested',
    color: 'primary',
    chartColor: '#3ac6e1',
  },
  { uid: 'passed', color: 'success', chartColor: '#6ea56c' },
  { uid: 'failed', color: 'danger', chartColor: '#f15f47' },
  { uid: 'retest', color: 'warning', chartColor: '#fba91e' },
  { uid: 'skipped', color: 'primary', chartColor: '#805aab' },
];

const priorities: PriorityType[] = [
  { uid: 'critical', color: '#bb3e03', chartColor: '#bb3e03' },
  { uid: 'high', color: '#ca6702', chartColor: '#ca6702' },
  { uid: 'medium', color: '#ee9b00', chartColor: '#ee9b00' },
  { uid: 'low', color: '#94d2bd', chartColor: '#94d2bd' },
];

const testTypes: TestTypeType[] = [
  { uid: 'other', chartColor: categoricalPalette[0] },
  { uid: 'security', chartColor: categoricalPalette[1] },
  { uid: 'performance', chartColor: categoricalPalette[2] },
  { uid: 'accessibility', chartColor: categoricalPalette[3] },
  { uid: 'functional', chartColor: categoricalPalette[4] },
  { uid: 'acceptance', chartColor: categoricalPalette[5] },
  { uid: 'usability', chartColor: categoricalPalette[6] },
  { uid: 'smokeSanity', chartColor: categoricalPalette[7] },
  { uid: 'compatibility', chartColor: categoricalPalette[0] },
  { uid: 'destructive', chartColor: categoricalPalette[1] },
  { uid: 'regression', chartColor: categoricalPalette[2] },
  { uid: 'automated', chartColor: categoricalPalette[3] },
  { uid: 'manual', chartColor: categoricalPalette[4] },
];

const automationStatus: AutomationStatusType[] = [
  { uid: 'automated' },
  { uid: 'automation-not-required' },
  { uid: 'cannot-be-automated' },
  { uid: 'obsolete' },
];

const templates: TemplateType[] = [{ uid: 'text' }, { uid: 'step' }, { uid: 'gherkin' }];
const gherkinTemplate = 2;
const gherkinKeywords: GherkinKeyword[] = ['given', 'when', 'then', 'and', 'but'];

const gherkinKeywordStyles: Record<GherkinKeyword, string> = {
  given:
    'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-200',
  when: 'border-sky-600 bg-sky-50 text-sky-800 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-200',
  then: 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200',
  and: 'border-amber-600 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-200',
  but: 'border-rose-600 bg-rose-50 text-rose-800 dark:border-rose-400 dark:bg-rose-950/40 dark:text-rose-200',
};

export {
  roles,
  memberRoles,
  locales,
  priorities,
  testTypes,
  automationStatus,
  templates,
  gherkinTemplate,
  gherkinKeywords,
  gherkinKeywordStyles,
  testRunStatus,
  testRunCaseStatus,
};
