'use client';

import { useContext, useEffect, useState } from 'react';
import { addToast, Button, Card, CardBody, Input, Switch, Textarea } from '@heroui/react';
import type { SettingsMessages } from '@/types/settings';
import type { AutomationErrorField } from '@/types/automation';
import { TokenContext } from '@/utils/TokenProvider';
import {
  AutomationRequestError,
  fetchAutomationDefaultEnvironment,
  saveAutomationDefaultEnvironment,
} from '@/utils/automationControl';

type Props = {
  projectId: string;
  messages: SettingsMessages;
};

function baseHostname(value: string): string {
  try {
    return new URL(value).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
  } catch {
    return '';
  }
}

function cleanHostList(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/\r?\n/).flatMap((line) => {
    const host = line.trim();
    const key = host.toLowerCase().replace(/\.$/, '');
    if (!host || seen.has(key)) return [];
    seen.add(key);
    return [host];
  });
}

function additionalHostsText(baseUrl: string, allowedHosts: unknown): string {
  const baseHost = baseHostname(baseUrl);
  if (!Array.isArray(allowedHosts)) return '';
  return allowedHosts
    .filter((host): host is string => typeof host === 'string')
    .filter(
      (host) =>
        host
          .toLowerCase()
          .replace(/^\[|\]$/g, '')
          .replace(/\.$/, '') !== baseHost
    )
    .join('\n');
}

export default function AutomationEnvironmentSettings({ projectId, messages }: Props) {
  const context = useContext(TokenContext);
  const [baseUrl, setBaseUrl] = useState('');
  const [allowedHosts, setAllowedHosts] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [captureVideo, setCaptureVideo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [errorFields, setErrorFields] = useState<AutomationErrorField[]>([]);
  const canEdit = context.isProjectManager(Number(projectId));

  const fieldError = (field: string) => errorFields.find((item) => item.field === field)?.message;

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
        setAllowedHosts(additionalHostsText(environment?.baseUrl ?? '', environment?.allowedHosts));
        setEnabled(environment?.enabled ?? true);
        setCaptureVideo(environment?.captureVideo ?? false);
        setError('');
        setErrorFields([]);
      })
      .catch(() => {
        if (!disposed) {
          setError(messages.automationError);
          setErrorFields([]);
        }
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [context, messages.automationError, projectId]);

  const handleSave = async () => {
    if (!canEdit || !baseUrl.trim()) {
      setError(messages.automationError);
      setErrorFields([{ field: 'baseUrl', code: 'required', message: messages.automationError }]);
      return;
    }

    setIsSaving(true);
    setError('');
    setErrorFields([]);
    try {
      const environment = await saveAutomationDefaultEnvironment(context.token.access_token, Number(projectId), {
        baseUrl: baseUrl.trim(),
        allowedHosts: cleanHostList(allowedHosts),
        enabled,
        captureVideo,
      });
      setBaseUrl(environment.baseUrl);
      setAllowedHosts(additionalHostsText(environment.baseUrl, environment.allowedHosts));
      setEnabled(environment.enabled);
      setCaptureVideo(environment.captureVideo);
      setErrorFields([]);
      addToast({ title: messages.automationSaved, color: 'success' });
    } catch (error) {
      setError(messages.automationError);
      setErrorFields(error instanceof AutomationRequestError ? error.fields : []);
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
            isInvalid={Boolean(fieldError('baseUrl')) || (Boolean(error) && errorFields.length === 0)}
            errorMessage={fieldError('baseUrl')}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setErrorFields((current) => current.filter((item) => item.field !== 'baseUrl'));
            }}
          />
          <Textarea
            label={messages.automationAllowedHosts}
            description={messages.automationAllowedHostsDescription}
            value={allowedHosts}
            minRows={4}
            isDisabled={!canEdit || isLoading}
            isInvalid={Boolean(fieldError('allowedHosts')) || (Boolean(error) && errorFields.length === 0)}
            errorMessage={fieldError('allowedHosts')}
            onChange={(event) => {
              setAllowedHosts(event.target.value);
              setErrorFields((current) => current.filter((item) => item.field !== 'allowedHosts'));
            }}
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
