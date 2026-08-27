import { useTranslations } from 'next-intl';
import RunEditor from './RunEditor';
import ResizablePanes from '@/components/ResizablePane';
import { RunMessages } from '@/types/run';
import { PriorityMessages } from '@/types/priority';
import { RunStatusMessages, TestRunCaseStatusMessages } from '@/types/status';
import { TestTypeMessages } from '@/types/testType';

export default function RunLayout({
  children,
  params: { projectId, runId, locale },
}: {
  children: React.ReactNode;
  params: { projectId: string; runId: string; locale: string };
}) {
  const t = useTranslations('Run');
  const ui = useTranslations('UI');
  const messages: RunMessages = {
    backToRuns: t('back_to_runs'),
    updating: t('updating'),
    update: t('update'),
    updatedTestRun: t('updated_test_run'),
    export: t('export'),
    progress: t('progress'),
    refresh: t('refresh'),
    id: t('id'),
    title: t('title'),
    pleaseEnter: t('please_enter'),
    description: t('description'),
    priority: t('priority'),
    actions: t('actions'),
    status: t('status'),
    selectTestCase: t('select_test_case'),
    testCaseSelection: t('test_case_selection'),
    includeInRun: t('include_in_run'),
    excludeFromRun: t('exclude_from_run'),
    runCaseStatus: t('run_case_status'),
    included: t('included'),
    excluded: t('excluded'),
    runIncludedGherkin: t('run_included_gherkin'),
    runGherkinCasesDescription: t('run_gherkin_cases_description'),
    runGherkinCasesProgress: t('run_gherkin_cases_progress'),
    runGherkinCasesSkipped: t('run_gherkin_cases_skipped'),
    runGherkinCasesComplete: t('run_gherkin_cases_complete'),
    runGherkinCasesError: t('run_gherkin_cases_error'),
    automationEnvironment: t('automation_environment'),
    automationQueued: t('automation_queued'),
    automationRunning: t('automation_running'),
    automationPassed: t('automation_passed'),
    automationFailed: t('automation_failed'),
    automationError: t('automation_error'),
    automationCancelled: t('automation_cancelled'),
    noCasesFound: t('no_cases_found'),
    areYouSureLeave: t('are_you_sure_leave'),
    type: t('type'),
    testDetail: t('test_detail'),
    steps: t('steps'),
    preconditions: t('preconditions'),
    expectedResult: t('expected_result'),
    detailsOfTheStep: t('details_of_the_step'),
    close: t('close'),
    filter: t('filter'),
    clearAll: t('clear_all'),
    apply: t('apply'),
    selectStatus: t('select_status'),
    pleaseSave: t('please_save'),
    caseTitleOrDescription: t('case_title_or_description'),
    selected: t('selected'),
    tags: t('tags'),
    selectTags: t('select_tags'),
    comments: t('comments'),
    assignee: t('assignee'),
    unassigned: t('unassigned'),
    assignTo: t('assign_to'),
    assignedToMe: t('assigned_to_me'),
    assignSelected: t('assign_selected'),
    filterByAssignee: t('filter_by_assignee'),
    selectAssignee: ui('select_assignee'),
    searchAssignee: t('search_assignee'),
    successTitle: ui('success'),
    errorTitle: ui('error'),
     saveError: ui('save_run_error'),
     exportOptions: ui('export_options'),
     expandFolder: ui('expand_folder'),
     collapseFolder: ui('collapse_folder'),
     testCaseActions: ui('test_case_actions'),
    testCaseSelectActions: ui('test_case_select_actions'),
    includeExcludeActions: ui('include_exclude_actions'),
    testCasesTable: ui('test_cases_table'),
    statusFilterAria: ui('status_filter'),
    tagFilterAria: ui('tag_filter'),
    assigneeFilterAria: ui('assignee_filter'),
    selectAssigneeAria: ui('select_assignee'),
    errorFetchingTags: ui('error_fetching_tags'),
  };

  const rst = useTranslations('RunStatus');
  const runStatusMessages: RunStatusMessages = {
    new: rst('new'),
    inProgress: rst('inProgress'),
    underReview: rst('underReview'),
    rejected: rst('rejected'),
    done: rst('done'),
    closed: rst('closed'),
  };

  const rcst = useTranslations('RunCaseStatus');
  const testRunCaseStatusMessages: TestRunCaseStatusMessages = {
    untested: rcst('untested'),
    passed: rcst('passed'),
    failed: rcst('failed'),
    retest: rcst('retest'),
    skipped: rcst('skipped'),
  };

  const pt = useTranslations('Priority');
  const priorityMessages: PriorityMessages = {
    critical: pt('critical'),
    high: pt('high'),
    medium: pt('medium'),
    low: pt('low'),
  };

  const tt = useTranslations('Type');
  const testTypeMessages: TestTypeMessages = {
    other: tt('other'),
    security: tt('security'),
    performance: tt('performance'),
    accessibility: tt('accessibility'),
    functional: tt('functional'),
    acceptance: tt('acceptance'),
    usability: tt('usability'),
    smokeSanity: tt('smoke_sanity'),
    compatibility: tt('compatibility'),
    destructive: tt('destructive'),
    regression: tt('regression'),
    automated: tt('automated'),
    manual: tt('manual'),
  };

  return (
    <ResizablePanes
      leftPane={
        <RunEditor
          projectId={projectId}
          runId={runId}
          messages={messages}
          runStatusMessages={runStatusMessages}
          testRunCaseStatusMessages={testRunCaseStatusMessages}
          priorityMessages={priorityMessages}
          testTypeMessages={testTypeMessages}
          locale={locale}
        />
      }
      rightPane={children}
    />
  );
}
