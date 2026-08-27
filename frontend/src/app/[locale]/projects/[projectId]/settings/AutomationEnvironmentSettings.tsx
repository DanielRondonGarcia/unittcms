'use client';

import { useContext, useEffect, useState } from 'react';
import { addToast, Button, Card, CardBody, Input, Switch } from '@heroui/react';
import type { SettingsMessages } from '@/types/settings';
import { TokenContext } from '@/utils/TokenProvider';
import { fetchAutomationDefaultEnvironment, saveAutomationDefaultEnvironment } from '@/utils/automationControl';

type Props = {
  projectId: string;
  messages: SettingsMessages;
};

export default function AutomationEnvironmentSettings({ projectId, messages }: Props) {
  const context = useContext(TokenContext);
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [captureVideo, setCaptureVideo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const canEdit = context.isProjectManager(Number(projectId));

  useEffect(() => {
    if (!context.isSignedIn() || !context.token.access_token) {
      setIsLoading(false);
      return;
    }

    let disposed = false;
    setIsLoading(true);
    fetchAutomationDefaultEnvironment(context.token.access_token, Number(projectId))
      .then((environment) => {
        if (disposed) return;
        setBaseUrl(environment?.baseUrl ?? '');
        setEnabled(environment?.enabled ?? true);
        setCaptureVideo(environment?.captureVideo ?? false);
        setError('');
      })
      .catch(() => {
        if (!disposed) setError(messages.automationError);
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [context.token.access_token, messages.automationError, projectId]);

  const handleSave = async () => {
    if (!canEdit || !baseUrl.trim()) {
      setError(messages.automationError);
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const environment = await saveAutomationDefaultEnvironment(context.token.access_token, Number(projectId), {
        baseUrl: baseUrl.trim(),
        enabled,
        captureVideo,
      });
      setBaseUrl(environment.baseUrl);
      setEnabled(environment.enabled);
      setCaptureVideo(environment.captureVideo);
      addToast({ title: messages.automationSaved, color: 'success' });
    } catch {
      setError(messages.automationError);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full p-3">
      <Card>
        <CardBody className="gap-4">
          <div>
            <h3 className="font-bold">{messages.automationEnvironment}</h3>
            <p className="text-sm text-default-500">{messages.automationEnvironmentDescription}</p>
          </div>
          <Input
            type="url"
            label={messages.automationBaseUrl}
            value={baseUrl}
            isDisabled={!canEdit || isLoading}
            isInvalid={Boolean(error)}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <Switch isSelected={enabled} isDisabled={!canEdit || isLoading} onValueChange={setEnabled}>
            {messages.automationEnabled}
          </Switch>
          <Switch isSelected={captureVideo} isDisabled={!canEdit || isLoading} onValueChange={setCaptureVideo}>
            {messages.automationCaptureVideo}
          </Switch>
          {isLoading && <p className="text-sm text-default-500">{messages.automationLoading}</p>}
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
            {messages.automationSave}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
