import { useTranslations } from 'next-intl';
import AutomationExecutionDetail from './AutomationExecutionDetail';
import type { RunDetailMessages } from '@/types/run';

export default function Page({
  params,
}: {
  params: { projectId: string; runId: string; caseId: string; executionId: string; locale: string };
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
    automationSnapshot: caseT('automation_snapshot'),
    automationVideo: caseT('automation_video'),
    automationBackToHistory: caseT('automation_back_to_history'),
    automationNoVideo: caseT('automation_no_video'),
  };

  return (
    <AutomationExecutionDetail
      projectId={params.projectId}
      runId={params.runId}
      caseId={params.caseId}
      executionId={params.executionId}
      locale={params.locale}
      messages={messages}
    />
  );
}
