'use client';
import { useState, useEffect, useContext, ChangeEvent, DragEvent } from 'react';
import { Input, Textarea, Select, SelectItem, Button, Divider, Tooltip, addToast, Badge } from '@heroui/react';
import { Save, Plus, ArrowLeft, Circle, Play, X, Download } from 'lucide-react';
import CaseStepsEditor from './CaseStepsEditor';
import CaseAttachmentsEditor from './CaseAttachmentsEditor';
import { updateSteps } from './stepControl';
import { fetchCreateAttachments, fetchDownloadAttachment, fetchDeleteAttachment } from './attachmentControl';
import CaseTagsEditor from './CaseTagsEditor';
import { fetchCase, hasValidGherkinKeywords, updateCase } from '@/utils/caseControl';
import { gherkinTemplate, priorities, testTypes, templates } from '@/config/selection';
import { useRouter } from '@/src/i18n/routing';
import { TokenContext } from '@/utils/TokenProvider';
import { useFormGuard } from '@/utils/formGuard';
import { CaseType, AttachmentType, CaseMessages, StepType } from '@/types/case';
import type {
  AutomationArtifact,
  AutomationEnvironment,
  AutomationExecution,
  AutomationStatus,
} from '@/types/automation';
import {
  cancelAutomationExecution,
  createAutomationExecution,
  downloadAutomationArtifact,
  fetchAutomationArtifacts,
  fetchAutomationEnvironments,
  fetchAutomationExecution,
  fetchAutomationHistory,
  formatAutomationDuration,
  isAutomationActive,
} from '@/utils/automationControl';
import { PriorityMessages } from '@/types/priority';
import { TestTypeMessages } from '@/types/testType';
import { logError } from '@/utils/errorHandler';
import { updateCaseTags } from '@/utils/caseTagsControls';

const defaultTestCase = {
  id: 0,
  title: '',
  state: 0,
  priority: 0,
  type: 0,
  automationStatus: 0,
  description: '',
  template: 0,
  preConditions: '',
  expectedResults: '',
  folderId: 0,
  Steps: [],
  Attachments: [],
  isIncluded: false,
  runStatus: 0,
  Tags: [],
};

type Props = {
  projectId: string;
  folderId: string;
  caseId: string;
  messages: CaseMessages;
  testTypeMessages: TestTypeMessages;
  priorityMessages: PriorityMessages;
  locale: string;
};

export default function CaseEditor({
  projectId,
  folderId,
  caseId,
  messages,
  testTypeMessages,
  priorityMessages,
  locale,
}: Props) {
  const tokenContext = useContext(TokenContext);
  const [testCase, setTestCase] = useState<CaseType>(defaultTestCase);
  const [isTitleInvalid] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [idCounter, setIdCounter] = useState<number>(0);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedTags, setSelectedTags] = useState<{ id: number; name: string }[]>([]);
  const [automationEnvironments, setAutomationEnvironments] = useState<AutomationEnvironment[]>([]);
  const [selectedAutomationEnvironment, setSelectedAutomationEnvironment] = useState('');
  const [automationExecution, setAutomationExecution] = useState<AutomationExecution | null>(null);
  const [automationHistory, setAutomationHistory] = useState<AutomationExecution[]>([]);
  const [automationArtifacts, setAutomationArtifacts] = useState<AutomationArtifact[]>([]);
  const [automationEnvironmentLoading, setAutomationEnvironmentLoading] = useState(false);
  const [automationActionLoading, setAutomationActionLoading] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const isGherkin = testCase.template === gherkinTemplate;
  const accessToken = tokenContext.token.access_token;
  const isSignedIn = tokenContext.isSignedIn();
  const isAutomationAuthorized = tokenContext.isProjectDeveloper(Number(projectId));
  const automationUnavailableMessage = messages.automationUnavailable;

  const router = useRouter();
  useFormGuard(isDirty, messages.areYouSureLeave);

  const statusLabel = (status: AutomationStatus) =>
    ({
      queued: messages.automationQueued,
      running: messages.automationRunning,
      passed: messages.automationPassed,
      failed: messages.automationFailed,
      error: messages.automationError,
      cancelled: messages.automationCancelled,
    })[status];

  useEffect(() => {
    if (!isGherkin || !isSignedIn || !accessToken) {
      setAutomationEnvironments([]);
      setSelectedAutomationEnvironment('');
      setAutomationError(null);
      return;
    }

    let disposed = false;
    setAutomationEnvironmentLoading(true);
    setAutomationError(null);
    fetchAutomationEnvironments(accessToken, Number(projectId))
      .then((items) => {
        if (!disposed) setAutomationEnvironments(items);
      })
      .catch(() => {
        if (!disposed) {
          setAutomationEnvironments([]);
          setAutomationError(automationUnavailableMessage);
        }
      })
      .finally(() => {
        if (!disposed) setAutomationEnvironmentLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [accessToken, automationUnavailableMessage, isGherkin, isSignedIn, projectId]);

  useEffect(() => {
    const executionId = automationExecution?.id;
    if (!executionId || !accessToken || !isAutomationActive(automationExecution.status)) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await fetchAutomationExecution(accessToken, executionId);
        if (disposed) return;
        setAutomationExecution(next);
        if (isAutomationActive(next.status)) {
          timer = setTimeout(poll, 750);
        }
      } catch {
        if (!disposed) setAutomationError(automationUnavailableMessage);
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    accessToken,
    automationExecution?.id,
    automationExecution?.status,
    automationUnavailableMessage,
    caseId,
    projectId,
  ]);

  useEffect(() => {
    const executionId = automationExecution?.id;
    const status = automationExecution?.status;
    if (!executionId || !accessToken || !status || isAutomationActive(status)) return;

    let disposed = false;
    Promise.all([
      fetchAutomationArtifacts(accessToken, executionId),
      fetchAutomationHistory(accessToken, Number(projectId), Number(caseId)),
    ])
      .then(([artifacts, history]) => {
        if (disposed) return;
        setAutomationArtifacts(artifacts);
        setAutomationHistory(history.filter((item) => Number(item.caseId) === Number(caseId) || !item.caseId));
      })
      .catch(() => {
        if (!disposed) setAutomationError(automationUnavailableMessage);
      });

    return () => {
      disposed = true;
    };
  }, [
    accessToken,
    automationExecution?.id,
    automationExecution?.status,
    automationUnavailableMessage,
    caseId,
    projectId,
  ]);

  const handleAutomationRun = async () => {
    if (!isGherkin || !isAutomationAuthorized || !selectedAutomationEnvironment || !accessToken) return;
    setAutomationActionLoading(true);
    setAutomationError(null);
    setAutomationArtifacts([]);
    setAutomationHistory([]);
    try {
      const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const execution = await createAutomationExecution(accessToken, {
        projectId: Number(projectId),
        caseId: Number(caseId),
        environmentId: Number(selectedAutomationEnvironment),
        idempotencyKey: `case-${caseId}-${random}`,
      });
      setAutomationExecution(execution);
    } catch {
      setAutomationError(automationUnavailableMessage);
    } finally {
      setAutomationActionLoading(false);
    }
  };

  const handleAutomationCancel = async () => {
    if (!automationExecution || !accessToken || !isAutomationActive(automationExecution.status)) return;
    setAutomationActionLoading(true);
    try {
      setAutomationExecution(await cancelAutomationExecution(accessToken, automationExecution.id));
    } catch {
      setAutomationError(automationUnavailableMessage);
    } finally {
      setAutomationActionLoading(false);
    }
  };

  const handleArtifactDownload = async (artifact: AutomationArtifact) => {
    if (!accessToken) return;
    try {
      const result = await downloadAutomationArtifact(accessToken, artifact.id);
      if (!result.content || result.encoding !== 'base64') return;
      const bytes = Uint8Array.from(atob(result.content), (character) => character.charCodeAt(0));
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType ?? 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = artifact.filename ?? `${artifact.kind}.evidence`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setAutomationError(automationUnavailableMessage);
    }
  };

  const onPlusClick = async (newStepNo: number) => {
    if (!testCase.Steps) {
      return;
    }
    setIsDirty(true);
    const nextId = idCounter + 1;
    const newStep: StepType = {
      // hypothetical ID
      id: nextId,
      step: '',
      result: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      caseSteps: {
        stepNo: newStepNo,
        keyword: isGherkin ? 'given' : null,
      },
      uid: `uid${nextId}`,
      editState: 'new',
    };

    const updatedSteps = testCase.Steps.map((step) => {
      if (step.caseSteps.stepNo >= newStepNo) {
        return {
          ...step,
          editState: step.editState === 'notChanged' ? 'changed' : step.editState,
          caseSteps: {
            ...step.caseSteps,
            stepNo: step.caseSteps.stepNo + 1,
          },
        };
      }
      return step;
    });

    updatedSteps.push(newStep);

    setTestCase({
      ...testCase,
      Steps: updatedSteps,
    });
    setIdCounter(nextId);
  };

  const onDeleteClick = async (stepId: number) => {
    setIsDirty(true);
    if (!testCase.Steps) {
      return;
    }
    // find deletedStep's stepNo

    const deletedStep = testCase.Steps.find((step) => step.id === stepId);
    if (!deletedStep) {
      return;
    }
    const deletedStepNo = deletedStep.caseSteps.stepNo;
    deletedStep.editState = 'deleted';

    const updatedSteps = testCase.Steps.map((step) => {
      if (step.caseSteps.stepNo > deletedStepNo) {
        return {
          ...step,
          editState: step.editState === 'notChanged' ? 'changed' : step.editState,
          caseSteps: {
            ...step.caseSteps,
            stepNo: step.caseSteps.stepNo - 1,
          },
        };
      }
      return step;
    });

    setTestCase({
      ...testCase,
      Steps: updatedSteps,
    });
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) {
      const filesArray = Array.from(event.dataTransfer.files);
      handleFetchCreateAttachments(Number(caseId), filesArray);
    }
  };

  const handleInput = (event: ChangeEvent) => {
    if (event.target) {
      const input = event.target as HTMLInputElement;
      if (input.files) {
        const filesArray = Array.from(input.files);
        handleFetchCreateAttachments(Number(caseId), filesArray);
      }
    }
  };

  const handleFetchCreateAttachments = async (caseId: number, files: File[]) => {
    const newAttachments = await fetchCreateAttachments(caseId, files);

    if (newAttachments) {
      const newAttachmentsWithJoinTable = [];
      newAttachments.forEach((attachment: AttachmentType) => {
        attachment.caseAttachments = {
          createdAt: new Date(),
          updatedAt: new Date(),
          caseId: 0,
          attachmentId: attachment.id,
        };
        newAttachmentsWithJoinTable.push(attachment);
      });
      const updatedAttachments = testCase.Attachments;
      if (updatedAttachments) {
        updatedAttachments.push(...newAttachments);

        setTestCase({
          ...testCase,
          Attachments: updatedAttachments,
        });
      }
    }
  };

  const onAttachmentDelete = async (attachmentId: number) => {
    await fetchDeleteAttachment(attachmentId);
    if (testCase.Attachments) {
      const filteredAttachments = testCase.Attachments.filter((attachment) => attachment.id !== attachmentId);

      setTestCase({
        ...testCase,
        Attachments: filteredAttachments,
      });
    }
  };

  const onStepUpdate = (stepId: number, changeStep: StepType) => {
    setIsDirty(true);
    if (changeStep.editState === 'notChanged') {
      changeStep.editState = 'changed';
    }

    if (!testCase.Steps) {
      return;
    }

    setTestCase({
      ...testCase,
      Steps: testCase.Steps.map((step) => {
        if (step.id === stepId) {
          return changeStep;
        } else {
          return step;
        }
      }),
    });
  };

  useEffect(() => {
    const fetchAndSetCase = async () => {
      if (!tokenContext.isSignedIn()) return;
      try {
        const data = await fetchCase(tokenContext.token.access_token, Number(caseId));
        data.Steps.forEach((step: StepType) => {
          step.editState = 'notChanged';
        });

        // set idCounter to the max step id to avoid id conflict for new steps
        // id is not reflected on database
        const maxStepId = data.Steps.reduce((maxId: number, step: StepType) => Math.max(maxId, step.id), 0);
        setIdCounter(maxStepId);
        setTestCase(data);
        if (data.Tags) {
          setSelectedTags(Array.isArray(data.Tags) ? data.Tags : []);
        }
      } catch (error: unknown) {
        logError('Error fetching case data', error);
      }
    };
    fetchAndSetCase();
  }, [tokenContext, caseId]);

  return (
    <>
      <div className="border-b-1 dark:border-neutral-700 w-full p-3 flex items-center justify-between">
        <div className="flex items-center">
          <Tooltip content={messages.backToCases} placement="left">
            <Button
              isIconOnly
              size="sm"
              className="rounded-full bg-neutral-50 dark:bg-neutral-600"
              onPress={() => router.push(`/projects/${projectId}/folders/${folderId}/cases`, { locale: locale })}
            >
              <ArrowLeft size={16} />
            </Button>
          </Tooltip>
          <h3 className="font-bold ms-2">{testCase.title}</h3>
        </div>
        <div className="flex items-center">
          <Button
            startContent={
              <Badge isInvisible={!isDirty} color="danger" size="sm" content="" shape="circle">
                <Save size={16} />
              </Badge>
            }
            size="sm"
            isDisabled={!tokenContext.isProjectDeveloper(Number(projectId))}
            color="primary"
            isLoading={isUpdating}
            onPress={async () => {
              if (isGherkin && !hasValidGherkinKeywords(testCase.Steps)) {
                addToast({
                  title: messages.errorTitle,
                  description: messages.errorUpdatingTestCase,
                  color: 'danger',
                });
                return;
              }

              setIsUpdating(true);
              try {
                await updateCase(tokenContext.token.access_token, testCase);
                if (testCase.Steps) {
                  await updateSteps(tokenContext.token.access_token, Number(caseId), testCase.Steps);
                }

                const tagIds = selectedTags.map((tag) => tag.id);
                await updateCaseTags(tokenContext.token.access_token, Number(caseId), tagIds, projectId);

                addToast({
                  title: messages.successTitle,
                  color: 'success',
                  description: messages.updatedTestCase,
                });
                setIsDirty(false);
              } catch (error) {
                logError('Error updating test case', error);
                addToast({
                  title: messages.errorTitle,
                  description: messages.errorUpdatingTestCase,
                  color: 'danger',
                });
              } finally {
                setIsUpdating(false);
              }
            }}
          >
            {isUpdating ? messages.updating : messages.update}
          </Button>
        </div>
      </div>

      <div className="p-5">
        <h6 className="font-bold">{messages.basic}</h6>
        <Input
          size="sm"
          type="text"
          variant="bordered"
          label={messages.title}
          value={testCase.title}
          isInvalid={isTitleInvalid}
          errorMessage={isTitleInvalid ? messages.pleaseEnterTitle : ''}
          onChange={(e) => {
            setTestCase({ ...testCase, title: e.target.value });
          }}
          className="mt-3"
        />

        <Textarea
          size="sm"
          variant="bordered"
          label={messages.description}
          placeholder={messages.testCaseDescription}
          value={testCase.description}
          onValueChange={(changeValue) => {
            setTestCase({ ...testCase, description: changeValue });
          }}
          className="mt-3"
        />

        <CaseTagsEditor
          projectId={projectId}
          selectedTags={selectedTags}
          onChange={(tags) => {
            setSelectedTags(tags);
            setIsDirty(true);
          }}
          messages={messages}
        />

        <div>
          <Select
            size="sm"
            variant="bordered"
            selectedKeys={[priorities[testCase.priority].uid]}
            onSelectionChange={(newSelection) => {
              if (newSelection !== 'all' && newSelection.size !== 0) {
                const selectedUid = Array.from(newSelection)[0];
                const index = priorities.findIndex((priority) => priority.uid === selectedUid);
                setTestCase({ ...testCase, priority: index });
              }
            }}
            startContent={
              <Circle size={8} color={priorities[testCase.priority].color} fill={priorities[testCase.priority].color} />
            }
            label={messages.priority}
            className="mt-3 max-w-xs"
          >
            {priorities.map((priority) => (
              <SelectItem key={priority.uid}>{priorityMessages[priority.uid]}</SelectItem>
            ))}
          </Select>
        </div>

        <div>
          <Select
            size="sm"
            variant="bordered"
            selectedKeys={[testTypes[testCase.type].uid]}
            onSelectionChange={(newSelection) => {
              if (newSelection !== 'all' && newSelection.size !== 0) {
                const selectedUid = Array.from(newSelection)[0];
                const index = testTypes.findIndex((type) => type.uid === selectedUid);
                setTestCase({ ...testCase, type: index });
              }
            }}
            label={messages.type}
            className="mt-3 max-w-xs"
          >
            {testTypes.map((type) => (
              <SelectItem key={type.uid}>{testTypeMessages[type.uid]}</SelectItem>
            ))}
          </Select>
        </div>

        <div>
          <Select
            size="sm"
            variant="bordered"
            selectedKeys={[templates[testCase.template].uid]}
            onSelectionChange={(newSelection) => {
              if (newSelection !== 'all' && newSelection.size !== 0) {
                const selectedUid = Array.from(newSelection)[0];
                const index = templates.findIndex((template) => template.uid === selectedUid);
                setTestCase({ ...testCase, template: index });
                setIsDirty(true);
              }
            }}
            label={messages.template}
            className="mt-3 max-w-xs"
          >
            {templates.map((template) => (
              <SelectItem key={template.uid}>{messages[template.uid]}</SelectItem>
            ))}
          </Select>
        </div>

        <Divider className="my-6" />
        {templates[testCase.template].uid === 'text' ? (
          <div>
            <h6 className="font-bold">{messages.testDetail}</h6>
            <div className="flex">
              <Textarea
                size="sm"
                variant="bordered"
                label={messages.preconditions}
                value={testCase.preConditions}
                onValueChange={(changeValue) => {
                  setTestCase({ ...testCase, preConditions: changeValue });
                }}
                className="mt-3 pe-1"
              />

              <Textarea
                size="sm"
                variant="bordered"
                label={messages.expectedResult}
                value={testCase.expectedResults}
                onValueChange={(changeValue) => {
                  setTestCase({ ...testCase, expectedResults: changeValue });
                }}
                className="mt-3 ps-1"
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center mb-3">
              <h6 className="font-bold">{messages.steps}</h6>
              <Button
                startContent={<Plus size={16} />}
                size="sm"
                isDisabled={!tokenContext.isProjectDeveloper(Number(projectId))}
                color="primary"
                className="ms-3"
                onPress={() => onPlusClick(1)}
              >
                {messages.newStep}
              </Button>
            </div>
            {testCase.Steps && (
              <CaseStepsEditor
                isDisabled={!tokenContext.isProjectDeveloper(Number(projectId))}
                steps={testCase.Steps}
                onStepUpdate={onStepUpdate}
                onStepPlus={onPlusClick}
                onStepDelete={onDeleteClick}
                messages={messages}
                isGherkin={isGherkin}
              />
            )}
          </div>
        )}

        {isGherkin && (
          <div className="mt-6 rounded-md border p-4" aria-labelledby="automation-heading">
            <div className="flex items-center justify-between gap-3">
              <h6 id="automation-heading" className="font-bold">
                {messages.automation}
              </h6>
              {automationExecution && (
                <span role="status" aria-live="polite">
                  {statusLabel(automationExecution.status)}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Select
                size="sm"
                variant="bordered"
                label={messages.automationEnvironment}
                placeholder={messages.selectAutomationEnvironment}
                selectedKeys={selectedAutomationEnvironment ? [selectedAutomationEnvironment] : []}
                onSelectionChange={(selection) => {
                  if (selection !== 'all' && selection.size > 0)
                    setSelectedAutomationEnvironment(String(Array.from(selection)[0]));
                }}
                isDisabled={
                  !isAutomationAuthorized || automationEnvironmentLoading || automationEnvironments.length === 0
                }
                className="min-w-64"
              >
                {automationEnvironments.map((environment) => (
                  <SelectItem key={String(environment.id)}>{environment.name}</SelectItem>
                ))}
              </Select>
              <Button
                color="primary"
                size="sm"
                startContent={<Play size={15} />}
                isDisabled={!isAutomationAuthorized || !selectedAutomationEnvironment || automationActionLoading}
                isLoading={automationActionLoading && !automationExecution}
                onPress={handleAutomationRun}
              >
                {messages.runAutomatically}
              </Button>
            </div>

            {automationEnvironmentLoading && <p className="mt-2 text-sm">{messages.automationLoading}</p>}
            {!automationEnvironmentLoading && automationEnvironments.length === 0 && !automationError && (
              <p className="mt-2 text-sm">{messages.noAutomationEnvironments}</p>
            )}
            {automationError && (
              <p className="mt-2 text-sm text-danger" role="alert">
                {automationError}
              </p>
            )}

            {automationExecution && (
              <div className="mt-4 space-y-2 text-sm">
                {isAutomationActive(automationExecution.status) && (
                  <Button
                    color="warning"
                    variant="flat"
                    size="sm"
                    startContent={<X size={15} />}
                    isLoading={automationActionLoading}
                    onPress={handleAutomationCancel}
                  >
                    {messages.cancelAutomation}
                  </Button>
                )}
                {automationExecution.summary && (
                  <p>
                    <strong>{messages.automationSummary}:</strong> {automationExecution.summary}
                  </p>
                )}
                {automationExecution.error && (
                  <p role="alert">
                    <strong>{messages.automationErrorDetail}:</strong> {automationExecution.error}
                  </p>
                )}
                {(automationExecution.finishedAt || automationExecution.durationMs !== undefined) && (
                  <p>
                    <strong>{messages.automationDuration}:</strong>{' '}
                    {formatAutomationDuration(automationExecution.durationMs)}
                  </p>
                )}
                <div>
                  <strong>{messages.automationEvidence}</strong>
                  {automationArtifacts.length === 0 ? (
                    <p>{messages.automationNoEvidence}</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {automationArtifacts.map((artifact) => (
                        <li key={String(artifact.id)} className="flex items-center gap-2">
                          <span>{artifact.filename ?? artifact.kind}</span>
                          <Button
                            size="sm"
                            variant="light"
                            startContent={<Download size={14} />}
                            onPress={() => handleArtifactDownload(artifact)}
                          >
                            {messages.downloadAutomationArtifact}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {automationHistory.length > 0 && (
                  <div>
                    <strong>{messages.automationHistory}</strong>
                    <ul className="mt-1 space-y-1">
                      {automationHistory.map((historyItem) => (
                        <li key={String(historyItem.id)}>
                          {statusLabel(historyItem.status)} — {formatAutomationDuration(historyItem.durationMs)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <Divider className="my-6" />
        <h6 className="font-bold">{messages.attachments}</h6>
        {testCase.Attachments && (
          <CaseAttachmentsEditor
            isDisabled={!tokenContext.isProjectDeveloper(Number(projectId))}
            attachments={testCase.Attachments}
            onAttachmentDownload={(attachmentId: number, downloadFileName: string) =>
              fetchDownloadAttachment(attachmentId, downloadFileName)
            }
            onAttachmentDelete={onAttachmentDelete}
            onFilesDrop={handleDrop}
            onFilesInput={handleInput}
            messages={messages}
          />
        )}
      </div>
    </>
  );
}
