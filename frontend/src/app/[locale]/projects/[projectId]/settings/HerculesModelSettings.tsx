'use client';

import { useContext, useEffect, useState } from 'react';
import { addToast, Button, Card, CardBody, Input } from '@heroui/react';
import type { SettingsMessages } from '@/types/settings';
import type { AutomationErrorField } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import {
  AutomationRequestError,
  fetchAutomationOrganizationModel,
  saveAutomationOrganizationModel,
} from '@/utils/automationControl';

type Props = {
  projectId: string;
  messages: SettingsMessages;
};

export default function HerculesModelSettings({ projectId, messages }: Props) {
  const context = useContext(TokenContext);
  const [model, setModel] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [errorFields, setErrorFields] = useState<AutomationErrorField[]>([]);
  const canEdit = context.isProjectOwner(Number(projectId));

  const fieldError = (field: string) => errorFields.find((item) => item.field === field)?.message;

  useEffect(() => {
    if (!context.isSignedIn() || !context.token.access_token) {
      setIsLoading(false);
      return;
    }

    let disposed = false;
    setIsLoading(true);
    fetchAutomationOrganizationModel(context.token.access_token, Number(projectId))
      .then((organization) => {
        if (disposed) return;
        setOrganizationName(organization?.name ?? '');
        setModel(organization?.herculesModel ?? '');
        setError('');
        setErrorFields([]);
      })
      .catch(() => {
        if (!disposed) {
          setError(messages.automationModelError);
          setErrorFields([]);
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [context, messages.automationModelError, projectId]);

  const handleSave = async () => {
    if (!canEdit) return;
    setIsSaving(true);
    setError('');
    setErrorFields([]);
    try {
      const organization = await saveAutomationOrganizationModel(
        context.token.access_token,
        Number(projectId),
        model.trim() || null
      );
      setOrganizationName(organization.name);
      setModel(organization.herculesModel ?? '');
      addToast({ title: messages.automationModelSaved, color: 'success' });
    } catch (caught) {
      setError(messages.automationModelError);
      setErrorFields(caught instanceof AutomationRequestError ? caught.fields : []);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full p-3">
      <Card>
        <CardBody className="gap-4">
          <div>
            <h3 className="font-bold">{messages.automationModel}</h3>
            <p className="text-sm text-default-500">
              {organizationName ? `${organizationName}: ` : ''}
              {messages.automationModelDescription}
            </p>
          </div>
          <Input
            label={messages.automationModel}
            name="hercules-model"
            autoComplete="off"
            spellCheck="false"
            placeholder={messages.automationModelPlaceholder}
            value={model}
            isDisabled={!canEdit || isLoading}
            isInvalid={Boolean(fieldError('model')) || (Boolean(error) && errorFields.length === 0)}
            errorMessage={fieldError('model')}
            onChange={(event) => {
              setModel(event.target.value);
              setErrorFields((current) => current.filter((item) => item.field !== 'model'));
            }}
          />
          {isLoading && <p className="text-sm text-default-500">{messages.automationModelLoading}</p>}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <Button
            color="primary"
            className="self-start"
            isDisabled={!canEdit || isLoading || isSaving}
            isLoading={isSaving}
            onPress={handleSave}
          >
            {messages.automationModelSave}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
