'use client';
import { useState } from 'react';
import {
  Button,
  Input,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Switch,
} from '@heroui/react';
import { CasesMessages } from '@/types/case';
import { templates } from '@/config/selection';

type Props = {
  isOpen: boolean;
  onCancel: () => void;
  onSubmit: (title: string, description: string, template: number, createMore: boolean) => void;
  messages: CasesMessages;
};

export default function CaseDialog({ isOpen, onCancel, onSubmit, messages }: Props) {
  const [caseTitle, setCaseName] = useState({
    text: 'Untitled Case',
    isValid: false,
    errorMessage: '',
  });

  const [caseDescription, setCaseDescription] = useState({
    text: '',
    isValid: false,
    errorMessage: '',
  });

  const [createMore, setCreateMore] = useState(false);
  const [template, setTemplate] = useState(0);

  const clear = () => {
    setCaseName({
      isValid: false,
      text: 'Untitled Case',
      errorMessage: '',
    });
    setCaseDescription({
      isValid: false,
      text: '',
      errorMessage: '',
    });
    setTemplate(0);
  };

  const validate = () => {
    if (!caseTitle.text) {
      setCaseName({
        text: '',
        isValid: true,
        errorMessage: messages.pleaseEnter,
      });

      return;
    }

    onSubmit(caseTitle.text, caseDescription.text, template, createMore);

    if (!createMore) {
      clear();
    } else {
      // Reset form fields but keep dialog open
      setCaseName({
        isValid: false,
        text: 'Untitled Case',
        errorMessage: '',
      });
      setCaseDescription({
        isValid: false,
        text: '',
        errorMessage: '',
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={() => {
        onCancel();
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">{messages.newTestCase}</ModalHeader>
        <ModalBody>
          <Input
            type="text"
            label={messages.caseTitle}
            value={caseTitle.text}
            isInvalid={caseTitle.isValid}
            errorMessage={caseTitle.errorMessage}
            onChange={(e) => {
              setCaseName({
                ...caseTitle,
                text: e.target.value,
              });
            }}
          />
          <Textarea
            label={messages.caseDescription}
            value={caseDescription.text}
            isInvalid={caseDescription.isValid}
            errorMessage={caseDescription.errorMessage}
            onChange={(e) => {
              setCaseDescription({
                ...caseDescription,
                text: e.target.value,
              });
            }}
          />
          <label className="flex flex-col gap-1 text-small text-foreground-500">
            {messages.template}
            <select
              aria-label={messages.template}
              className="rounded-medium border border-default-200 bg-default-100 px-3 py-2 text-foreground"
              value={templates[template].uid}
              onChange={(event) => {
                const selectedTemplate = templates.findIndex(({ uid }) => uid === event.target.value);
                if (selectedTemplate >= 0) setTemplate(selectedTemplate);
              }}
            >
              {templates.map((option) => (
                <option key={option.uid} value={option.uid}>
                  {messages[option.uid]}
                </option>
              ))}
            </select>
          </label>
        </ModalBody>
        <ModalFooter>
          <Switch size="sm" isSelected={createMore} onValueChange={setCreateMore}>
            {messages.createMore}
          </Switch>
          <Button color="primary" onPress={validate}>
            {messages.create}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
