import { useTranslations } from 'next-intl';
import DetailPane from './DetailPane';
import type { RunDetailMessages } from '@/types/run';
import type { PriorityMessages } from '@/types/priority';
import type { TestTypeMessages } from '@/types/testType';

export default function Page({
  params,
}: {
  params: { projectId: string; runId: string; caseId: string; locale: string };
}) {
  const t = useTranslations('Run');
  const ui = useTranslations('UI');
  const gherkinT = useTranslations('Gherkin');
  const caseT = useTranslations('Case');
  const messages: RunDetailMessages = {
    title: t('title'),
    description: t('description'),
    priority: t('priority'),
    type: t('type'),
    tags: t('tags'),
    testDetail: t('test_detail'),
    steps: t('steps'),
    preconditions: t('preconditions'),
    expectedResult: t('expected_result'),
    detailsOfTheStep: t('details_of_the_step'),
    caseDetail: t('case_detail'),
    comments: t('comments'),
    history: t('history'),
    loading: ui('loading_lowercase'),
    historyUnavailable: ui('history_unavailable'),
    historyNotice: ui('history_notice'),
    options: ui('options'),
    given: gherkinT('given'),
    when: gherkinT('when'),
    then: gherkinT('then'),
    and: gherkinT('and'),
    but: gherkinT('but'),
    background: gherkinT('background'),
    scenario: gherkinT('scenario'),
    examples: gherkinT('examples'),
    noScenarioSteps: caseT('no_scenario_steps'),
    automation: caseT('automation'),
    automationEnvironment: caseT('automation_environment'),
    selectAutomationEnvironment: caseT('select_automation_environment'),
    noAutomationEnvironments: caseT('no_automation_environments'),
    runAutomatically: caseT('run_automatically'),
    automationLoading: caseT('automation_loading'),
    automationQueued: caseT('automation_queued'),
    automationRunning: caseT('automation_running'),
    automationPassed: caseT('automation_passed'),
    automationFailed: caseT('automation_failed'),
    automationError: caseT('automation_error'),
    automationEvidenceInsufficient: caseT('automation_evidence_insufficient'),
    automationCancelled: caseT('automation_cancelled'),
    automationSummary: caseT('automation_summary'),
    automationErrorDetail: caseT('automation_error_detail'),
    automationDuration: caseT('automation_duration'),
    automationEvidence: caseT('automation_evidence'),
    automationHistory: caseT('automation_history'),
    cancelAutomation: caseT('cancel_automation'),
    downloadAutomationArtifact: caseT('download_automation_artifact'),
    automationUnavailable: caseT('automation_unavailable'),
    automationNoEvidence: caseT('automation_no_evidence'),
    automationHistoryLoading: caseT('automation_history_loading'),
    automationHistoryEmpty: caseT('automation_history_empty'),
    automationViewDetail: caseT('automation_view_detail'),
    automationExecutionDetail: caseT('automation_execution_detail'),
    automationQueuedAt: caseT('automation_queued_at'),
    automationStartedAt: caseT('automation_started_at'),
    automationFinishedAt: caseT('automation_finished_at'),
    automationAttempt: caseT('automation_attempt'),
    automationAttemptHistory: caseT('automation_attempt_history'),
    automationExample: caseT('automation_example'),
    automationEngine: caseT('automation_engine'),
    automationModel: caseT('automation_model'),
    automationEnvironmentId: caseT('automation_environment_id'),
    automationCorrelationId: caseT('automation_correlation_id'),
    automationSnapshotHash: caseT('automation_snapshot_hash'),
    automationWorkerStatus: caseT('automation_worker_status'),
    automationSnapshot: caseT('automation_snapshot'),
    automationVideo: caseT('automation_video'),
    automationBackToHistory: caseT('automation_back_to_history'),
    automationNoVideo: caseT('automation_no_video'),
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

  const ct = useTranslations('Comments');
  const commentMessages = {
    comments: ct('comments'),
    noComments: ct('no_comments'),
    addComment: ct('add_comment'),
    save: ct('save'),
    cancel: ct('cancel'),
    placeholder: ct('placeholder'),
    notIncludedInRun: ct('not_included_in_run'),
    commentAdded: ct('comment_added'),
    failedToAddComment: ct('failed_to_add_comment'),
    commentUpdated: ct('comment_updated'),
    failedToUpdateComment: ct('failed_to_update_comment'),
    commentDeleted: ct('comment_deleted'),
    failedToDeleteComment: ct('failed_to_delete_comment'),
    editComment: ui('edit_comment'),
    deleteComment: ui('delete_comment'),
    unknownState: ui('unknown_state'),
    success: ui('success'),
    error: ui('error'),
  };

  return (
    <DetailPane
      projectId={params.projectId}
      runId={params.runId}
      caseId={params.caseId}
      locale={params.locale}
      messages={messages}
      priorityMessages={priorityMessages}
      testTypeMessages={testTypeMessages}
      commentMessages={commentMessages}
    />
  );
}
