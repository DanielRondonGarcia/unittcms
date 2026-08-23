import { Textarea, Button, Tooltip, Avatar, Select, SelectItem } from '@heroui/react';
import { Plus, Trash } from 'lucide-react';
import { gherkinKeywords } from '@/config/selection';
import type { GherkinKeyword } from '@/types/base';
import { CaseMessages, StepType } from '@/types/case';

type Props = {
  isDisabled: boolean;
  steps: StepType[];
  onStepUpdate: (stepId: number, step: StepType) => void;
  onStepPlus: (newStepNo: number) => void;
  onStepDelete: (stepId: number) => void;
  messages: CaseMessages;
  isGherkin?: boolean;
};

export default function StepsEditor({
  isDisabled,
  steps,
  onStepUpdate,
  onStepPlus,
  onStepDelete,
  messages,
  isGherkin = false,
}: Props) {
  // sort steps by junction table's column
  const sortedSteps = steps.slice().sort((a, b) => {
    const stepNoA = a.caseSteps.stepNo;
    const stepNoB = b.caseSteps.stepNo;
    return stepNoA - stepNoB;
  });

  // filter steps
  const filteredSteps = sortedSteps.filter((entry) => entry.editState !== 'deleted');

  return (
    <>
      {filteredSteps.map((step, index) => (
        <div key={index} className="flex items-center my-1">
          <Avatar className="me-2" size="sm" name={step.caseSteps.stepNo.toString()} />
          <div key={step.id} className="grow flex gap-2">
            {isGherkin && (
              <Select
                className="w-1/4"
                size="sm"
                variant="bordered"
                label={messages.step}
                selectedKeys={step.caseSteps.keyword ? [step.caseSteps.keyword] : []}
                onSelectionChange={(newSelection) => {
                  if (newSelection !== 'all' && newSelection.size !== 0) {
                    const keyword = String(Array.from(newSelection)[0]) as GherkinKeyword;
                    onStepUpdate(step.id, {
                      ...step,
                      caseSteps: { ...step.caseSteps, keyword },
                    });
                  }
                }}
              >
                {gherkinKeywords.map((keyword) => (
                  <SelectItem key={keyword}>{messages[keyword]}</SelectItem>
                ))}
              </Select>
            )}
            <div className="w-1/2">
              <Textarea
                size="sm"
                variant="bordered"
                label={messages.detailsOfTheStep}
                value={step.step}
                onValueChange={(changeValue) => {
                  onStepUpdate(step.id, { ...step, step: changeValue });
                }}
              />
            </div>
            <div className="w-1/2">
              <Textarea
                size="sm"
                variant="bordered"
                label={messages.expectedResult}
                value={step.result}
                onValueChange={(changeValue) => {
                  onStepUpdate(step.id, { ...step, result: changeValue });
                }}
              />
            </div>
          </div>
          <div className="flex flex-col">
            <Tooltip content={messages.deleteThisStep} placement="left">
              <Button
                isIconOnly
                size="sm"
                isDisabled={isDisabled}
                className="bg-transparent rounded-full"
                onPress={() => onStepDelete(step.id)}
              >
                <Trash size={16} />
              </Button>
            </Tooltip>
            <Tooltip content={messages.insertStep} placement="left">
              <Button
                isIconOnly
                isDisabled={isDisabled}
                size="sm"
                className="bg-transparent rounded-full"
                onPress={() => onStepPlus(step.caseSteps.stepNo + 1)}
              >
                <Plus size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
      ))}
    </>
  );
}
