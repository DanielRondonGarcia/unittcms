import { useTranslations } from 'next-intl';
import DetailPane from './DetailPane';
import type { RunDetailMessages } from '@/types/run';
import type { PriorityMessages } from '@/types/priority';
import type { TestTypeMessages } from '@/types/testType';
import type { ManualExecutionMessages } from '@/types/manualExecution';
import Config from '@/config/config';

export default function Page({
  params,
}: {
  params: { projectId: string; runId: string; caseId: string; locale: string };
}) {
  const t = useTranslations('Run');
  const ui = useTranslations('UI');
  const gherkinT = useTranslations('Gherkin');
  const caseT = useTranslations('Case');
  const manualExecutionEnabled = Config.manualExecutionEnabled;
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
    metadata: t('metadata'),
    comments: t('comments'),
    history: t('history'),
    loading: ui('loading_lowercase'),
    requestError: t('request_error'),
    retry: t('retry'),
    retryAfter: t('retry_after'),
    correlationId: t('correlation_id'),
    noCaseSelected: t('no_case_selected'),
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
    automationRetrying: caseT('automation_retrying'),
    automationRunning: caseT('automation_running'),
    automationPassed: caseT('automation_passed'),
    automationFailed: caseT('automation_failed'),
    automationError: caseT('automation_error'),
    automationEvidenceInsufficient: caseT('automation_evidence_insufficient'),
    automationCancelled: caseT('automation_cancelled'),
    automationTechnicalFailure: caseT('automation_technical_failure'),
    automationFunctionalFailure: caseT('automation_functional_failure'),
    automationEvidenceFailure: caseT('automation_evidence_failure'),
    automationCancelledDetail: caseT('automation_cancelled_detail'),
    automationGenericFailure: caseT('automation_generic_failure'),
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
    automationTimeline: caseT('automation_timeline'),
    automationDiagnostics: caseT('automation_diagnostics'),
    automationExitCode: caseT('automation_exit_code'),
    automationSignal: caseT('automation_signal'),
    automationOutput: caseT('automation_output'),
    automationNoDiagnostics: caseT('automation_no_diagnostics'),
    automationTimeout: caseT('automation_timeout'),
    automationTimeoutDetail: caseT('automation_timeout_detail'),
    automationDiagnosticsAvailable: caseT('automation_diagnostics_available'),
    automationVideoDescription: caseT('automation_video_description'),
  };

  const pt = useTranslations('Priority');
  const priorityMessages: PriorityMessages = {
    critical: pt('critical'),
    high: pt('high'),
    medium: pt('medium'),
    low: pt('low'),
  };

  const manualExecutionMessages: ManualExecutionMessages = {
    requestError: t('request_error'),
    retry: t('retry'),
    retryAfter: t('retry_after'),
    correlationId: t('correlation_id'),
    manualExecution: caseT('manual_execution'),
    manualExecutionStart: caseT('manual_execution_start'),
    manualExecutionLoading: caseT('manual_execution_loading'),
    manualExecutionEmpty: caseT('manual_execution_empty'),
    manualExecutionRunning: caseT('manual_execution_running'),
    manualExecutionPassed: caseT('manual_execution_passed'),
    manualExecutionFailed: caseT('manual_execution_failed'),
    manualExecutionCancelled: caseT('manual_execution_cancelled'),
    manualExecutionFinished: caseT('manual_execution_finished'),
    manualExecutionStatus: caseT('manual_execution_status'),
    manualExecutionResult: caseT('manual_execution_result'),
    manualExecutionExpand: caseT('manual_execution_expand'),
    manualExecutionCollapse: caseT('manual_execution_collapse'),
    manualExecutionFinishPassed: caseT('manual_execution_finish_passed'),
    manualExecutionFinishFailed: caseT('manual_execution_finish_failed'),
    manualExecutionFinishFailedConfirm: caseT('manual_execution_finish_failed_confirm'),
    manualExecutionReportBack: caseT('manual_execution_report_back'),
    manualExecutionCancel: caseT('manual_execution_cancel'),
    manualExecutionActor: caseT('manual_execution_actor'),
    manualExecutionAssignee: caseT('manual_execution_assignee'),
    manualExecutionStartedAt: caseT('manual_execution_started_at'),
    manualExecutionFinishedAt: caseT('manual_execution_finished_at'),
    manualExecutionRevision: caseT('manual_execution_revision'),
    manualExecutionStale: caseT('manual_execution_stale'),
    manualExecutionHistorical: caseT('manual_execution_historical'),
    manualExecutionSourceDeleted: caseT('manual_execution_source_deleted'),
    manualExecutionEvidence: caseT('manual_execution_evidence'),
    manualExecutionEvidencePrivate: caseT('manual_execution_evidence_private'),
    manualExecutionEvidenceEmpty: caseT('manual_execution_evidence_empty'),
    manualExecutionEvidenceUpload: caseT('manual_execution_evidence_upload'),
    manualExecutionEvidenceDownload: caseT('manual_execution_evidence_download'),
    manualExecutionEvidenceDelete: caseT('manual_execution_evidence_delete'),
    manualExecutionEvidenceDeleteConfirm: caseT('manual_execution_evidence_delete_confirm'),
    manualExecutionEvidenceDeleteCancel: t('close'),
    manualExecutionUnavailable: caseT('manual_execution_unavailable'),
    manualExecutionUnauthorized: caseT('manual_execution_unauthorized'),
    manualExecutionEvidenceType: caseT('manual_execution_evidence_type'),
    manualExecutionEvidenceSize: caseT('manual_execution_evidence_size'),
    manualExecutionEvidenceLimit: caseT('manual_execution_evidence_limit'),
    manualExecutionReport: caseT('manual_execution_report'),
    manualExecutionReportDescription: caseT('manual_execution_report_description'),
    manualExecutionReportFailureReason: caseT('manual_execution_report_failure_reason'),
    manualExecutionReportHowToFix: caseT('manual_execution_report_how_to_fix'),
    manualExecutionReportReproductionSteps: caseT('manual_execution_report_reproduction_steps'),
    manualExecutionReportBrowser: caseT('manual_execution_report_browser'),
    manualExecutionReportEnvironment: caseT('manual_execution_report_environment'),
    manualExecutionReportFieldLimit: caseT('manual_execution_report_field_limit'),
    manualExecutionReportSave: caseT('manual_execution_report_save'),
    manualExecutionReportSaving: caseT('manual_execution_report_saving'),
    manualExecutionReportSaved: caseT('manual_execution_report_saved'),
    manualExecutionReportUnsaved: caseT('manual_execution_report_unsaved'),
    manualExecutionReportEmpty: caseT('manual_execution_report_empty'),
    manualExecutionReportComments: caseT('manual_execution_report_comments'),
    manualExecutionReportTooLong: caseT('manual_execution_report_too_long'),
    manualExecutionActorHint: caseT('manual_execution_actor_hint'),
    manualExecutionEvidencePaste: caseT('manual_execution_evidence_paste'),
    manualExecutionEvidenceDrop: caseT('manual_execution_evidence_drop'),
    manualExecutionEvidenceUploading: caseT('manual_execution_evidence_uploading'),
    manualExecutionEvidenceUploaded: caseT('manual_execution_evidence_uploaded'),
    manualExecutionEvidenceUploadFailed: caseT('manual_execution_evidence_upload_failed'),
    manualExecutionEvidencePreview: caseT('manual_execution_evidence_preview'),
    manualExecutionEvidenceOpen: caseT('manual_execution_evidence_open'),
    manualExecutionEvidenceClose: caseT('manual_execution_evidence_close'),
    manualExecutionReportUnavailable: caseT('manual_execution_report_unavailable'),
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
      manualExecutionMessages={manualExecutionMessages}
      manualExecutionEnabled={manualExecutionEnabled}
      priorityMessages={priorityMessages}
      testTypeMessages={testTypeMessages}
      commentMessages={commentMessages}
    />
  );
}
