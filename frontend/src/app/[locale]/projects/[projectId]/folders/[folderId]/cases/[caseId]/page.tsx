import { useTranslations } from 'next-intl';
import CaseEditor from './CaseEditor';
import { PriorityMessages } from '@/types/priority';
import { TestTypeMessages } from '@/types/testType';

export default function Page({
  params,
}: {
  params: {
    projectId: string;
    folderId: string;
    caseId: string;
    locale: string;
  };
}) {
  const t = useTranslations('Case');
  const gherkinT = useTranslations('Gherkin');
  const ui = useTranslations('UI');
  const messages = {
    backToCases: t('back_to_cases'),
    loading: t('loading'),
    requestError: t('request_error'),
    retry: t('retry'),
    retryAfter: t('retry_after'),
    correlationId: t('correlation_id'),
    updating: t('updating'),
    update: t('update'),
    updatedTestCase: t('updated_test_case'),
    basic: t('basic'),
    title: t('title'),
    pleaseEnterTitle: t('please_enter_title'),
    description: t('description'),
    testCaseDescription: t('test_case_description'),
    priority: t('priority'),
    type: t('type'),
    template: t('template'),
    testDetail: t('test_detail'),
    preconditions: t('preconditions'),
    expectedResult: t('expected_result'),
    step: t('step'),
    text: t('text'),
    steps: t('steps'),
    newStep: t('new_step'),
    detailsOfTheStep: t('details_of_the_step'),
    deleteThisStep: t('delete_this_step'),
    insertStep: t('insert_step'),
    attachments: t('attachments'),
    delete: t('delete'),
    download: t('download'),
    deleteFile: t('delete_file'),
    clickToUpload: t('click_to_upload'),
    orDragAndDrop: t('or_drag_and_drop'),
    maxFileSize: t('max_file_size'),
    areYouSureLeave: t('are_you_sure_leave'),
    tags: t('tags'),
    createTag: t('create_tag'),
    maxTagsLimit: t('max_tags_limit'),
    tagAlreadyExists: t('tag_already_exists'),
    tagCreatedAndAdded: t('tag_created_and_added'),
    errorCreatingTag: t('error_creating_tag'),
    errorUpdatingTestCase: t('error_updating_test_case'),
    searchOrCreateTag: t('search_or_create_tag'),
    noTagsSelected: t('no_tags_selected'),
    gherkin: gherkinT('template'),
    given: gherkinT('given'),
    when: gherkinT('when'),
    then: gherkinT('then'),
    and: gherkinT('and'),
    but: gherkinT('but'),
    background: gherkinT('background'),
    scenario: gherkinT('scenario'),
    examples: gherkinT('examples'),
    addExamples: t('add_examples'),
    removeExamples: t('remove_examples'),
    addExampleRow: t('add_example_row'),
    removeExampleRow: t('remove_example_row'),
    addExampleColumn: t('add_example_column'),
    removeExampleColumn: t('remove_example_column'),
    exampleHeader: t('example_header'),
    exampleValue: t('example_value'),
    noExamples: t('no_examples'),
    noScenarioSteps: t('no_scenario_steps'),
    gherkinValidationStepsRequired: t('gherkin_validation_steps_required'),
    gherkinValidationStepOrder: t('gherkin_validation_step_order'),
    gherkinValidationKeyword: t('gherkin_validation_keyword'),
    gherkinValidationSection: t('gherkin_validation_section'),
    gherkinValidationStepText: t('gherkin_validation_step_text'),
    gherkinValidationDuplicateStep: t('gherkin_validation_duplicate_step'),
    gherkinValidationFirstConnector: t('gherkin_validation_first_connector'),
    gherkinValidationRequiredKeywords: t('gherkin_validation_required_keywords'),
    gherkinValidationExamples: t('gherkin_validation_examples'),
    gherkinValidationPlaceholder: t('gherkin_validation_placeholder'),
    gherkinValidationDetailsKeyword: t('gherkin_validation_details_keyword'),
    successTitle: ui('success'),
    errorTitle: ui('error'),
    warningTitle: ui('warning'),
    errorFetchingTags: ui('error_fetching_tags'),
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

  const priorityTranslation = useTranslations('Priority');
  const priorityMessages: PriorityMessages = {
    critical: priorityTranslation('critical'),
    high: priorityTranslation('high'),
    medium: priorityTranslation('medium'),
    low: priorityTranslation('low'),
  };

  return (
    <CaseEditor
      projectId={params.projectId}
      folderId={params.folderId}
      caseId={params.caseId}
      messages={messages}
      testTypeMessages={testTypeMessages}
      priorityMessages={priorityMessages}
      locale={params.locale}
    />
  );
}
