import { Textarea, Button, Tooltip, Avatar, Select, SelectItem } from '@heroui/react';
import { Plus, Trash } from 'lucide-react';
import { gherkinKeywordStyles, gherkinKeywords } from '@/config/selection';
import type { GherkinKeyword, GherkinSection } from '@/types/base';
import { CaseMessages, StepType } from '@/types/case';
import { normalizeGherkinCaseSteps } from '@/utils/caseControl';

type Props = {
  isDisabled: boolean;
  steps: StepType[];
  onStepUpdate: (stepId: number, step: StepType) => void;
  onStepPlus: (newStepNo: number, section?: GherkinSection) => void;
  onStepDelete: (stepId: number) => void;
  messages: CaseMessages;
  scenarioTitle?: string;
  isGherkin?: boolean;
};

export default function StepsEditor({
  isDisabled,
  steps,
  onStepUpdate,
  onStepPlus,
  onStepDelete,
  messages,
  scenarioTitle,
  isGherkin = false,
}: Props) {
  const displaySteps = isGherkin ? normalizeGherkinCaseSteps(steps).steps : steps;
  const sortedSteps = displaySteps.slice().sort((a, b) => a.caseSteps.stepNo - b.caseSteps.stepNo);
  const activeSteps = sortedSteps.filter((entry) => entry.editState !== 'deleted');

  const renderStep = (step: StepType, section?: GherkinSection) => {
    const keyword = step.caseSteps.keyword;
    const keywordLabel = keyword ? messages[keyword] : messages.step;

    return (
      <div
        key={step.id}
        className="my-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border p-2"
      >
        <Avatar className="mt-2" size="sm" name={step.caseSteps.stepNo.toString()} />
        <div className="flex min-w-0 flex-col gap-2 md:flex-row">
          {isGherkin && (
            <div className="flex min-w-32 flex-col gap-1 md:w-36">
              <span
                className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
                  keyword ? gherkinKeywordStyles[keyword] : 'border-default-300 text-default-500'
                }`}
              >
                {keywordLabel}
              </span>
              <Select
                size="sm"
                variant="bordered"
                aria-label={messages.step}
                selectedKeys={keyword ? [keyword] : []}
                isDisabled={isDisabled}
                onSelectionChange={(newSelection) => {
                  if (newSelection !== 'all' && newSelection.size !== 0) {
                    const selectedKeyword = String(Array.from(newSelection)[0]) as GherkinKeyword;
                    onStepUpdate(step.id, {
                      ...step,
                      caseSteps: { ...step.caseSteps, keyword: selectedKeyword },
                    });
                  }
                }}
              >
                {gherkinKeywords.map((item) => (
                  <SelectItem key={item}>{messages[item]}</SelectItem>
                ))}
              </Select>
            </div>
          )}
          <div className={isGherkin ? 'min-w-0 flex-1' : 'w-full md:w-1/2'}>
            <Textarea
              size="sm"
              variant="bordered"
              label={messages.detailsOfTheStep}
              value={step.step}
              isDisabled={isDisabled}
              onValueChange={(changeValue) => {
                onStepUpdate(step.id, { ...step, step: changeValue });
              }}
            />
          </div>
          {!isGherkin && (
            <div className="w-full md:w-1/2">
              <Textarea
                size="sm"
                variant="bordered"
                label={messages.expectedResult}
                value={step.result}
                isDisabled={isDisabled}
                onValueChange={(changeValue) => {
                  onStepUpdate(step.id, { ...step, result: changeValue });
                }}
              />
            </div>
          )}
        </div>
        <div className="flex flex-col">
          <Tooltip content={messages.deleteThisStep} placement="left">
            <Button
              isIconOnly
              aria-label={messages.deleteThisStep}
              size="sm"
              isDisabled={isDisabled}
              className="rounded-full bg-transparent focus-visible:ring-2 focus-visible:ring-primary"
              onPress={() => onStepDelete(step.id)}
            >
              <Trash size={16} aria-hidden="true" />
            </Button>
          </Tooltip>
          <Tooltip content={messages.insertStep} placement="left">
            <Button
              isIconOnly
              aria-label={messages.insertStep}
              isDisabled={isDisabled}
              size="sm"
              className="rounded-full bg-transparent focus-visible:ring-2 focus-visible:ring-primary"
              onPress={() => onStepPlus(step.caseSteps.stepNo + 1, section ?? (isGherkin ? 'scenario' : undefined))}
            >
              <Plus size={16} aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  };

  if (!isGherkin) return <>{activeSteps.map((step) => renderStep(step))}</>;

  const newStepNo = activeSteps.length + 1;

  return (
    <div className="space-y-4">
      <section aria-labelledby="scenario-steps-heading">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h6 id="scenario-steps-heading" className="font-bold">
            {messages.scenario}: {scenarioTitle}
          </h6>
          <Button
            startContent={<Plus size={16} aria-hidden="true" />}
            aria-label={messages.newStep}
            size="sm"
            isDisabled={isDisabled}
            color="primary"
            onPress={() => onStepPlus(newStepNo, 'scenario')}
          >
            {messages.newStep}
          </Button>
        </div>
        {activeSteps.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-default-500">{messages.noScenarioSteps}</p>
        ) : (
          activeSteps.map((step) => renderStep(step, 'scenario'))
        )}
      </section>
    </div>
  );
}
