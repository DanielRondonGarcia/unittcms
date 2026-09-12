'use client';

import { Chip } from '@heroui/react';
import { gherkinKeywordStyles, gherkinTemplate, templates, testTypes } from '@/config/selection';
import type { CaseType } from '@/types/case';
import type { RunDetailMessages } from '@/types/run';
import type { PriorityMessages } from '@/types/priority';
import type { TestTypeMessages } from '@/types/testType';
import TestCasePriority from '@/components/TestCasePriority';
import MarkdownContent from '@/components/MarkdownContent';
import { Link, NextUiLinkClasses } from '@/src/i18n/routing';

type Props = {
  projectId: string;
  testCase: CaseType;
  locale: string;
  messages: RunDetailMessages;
  testTypeMessages: TestTypeMessages;
  priorityMessages: PriorityMessages;
  scenarioHeadingId?: string;
  compact?: boolean;
};

function isPositiveIdentifier(value: string | number): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function CaseMarkdown({
  content,
  messages,
  className,
}: {
  content?: string | null;
  messages: RunDetailMessages;
  className?: string;
}) {
  return (
    <MarkdownContent
      content={content}
      copyLabel={messages.copyCode}
      copiedLabel={messages.codeCopied}
      copyFailedLabel={messages.copyCodeFailed}
      className={className}
    />
  );
}

function ReadOnlyMarkdownField({
  label,
  content,
  messages,
}: {
  label: string;
  content?: string | null;
  messages: RunDetailMessages;
}) {
  return (
    <div role="group" aria-label={label} className="min-w-0 rounded-lg bg-default-100 p-2 dark:bg-content2">
      <p className="mb-1 text-small font-medium text-default-600 dark:text-default-300">{label}</p>
      <CaseMarkdown content={content} messages={messages} className="text-small" />
    </div>
  );
}

export default function CaseDetail({
  projectId,
  testCase,
  locale,
  messages,
  testTypeMessages,
  priorityMessages,
  scenarioHeadingId = 'scenario-detail-heading',
  compact = false,
}: Props) {
  const canNavigateToCase =
    isPositiveIdentifier(projectId) && isPositiveIdentifier(testCase.folderId) && isPositiveIdentifier(testCase.id);
  const caseLabel = `#${testCase.id} ${testCase.title}`;
  const selectedTemplate = templates[testCase.template];
  const selectedType = testTypes[testCase.type];
  const activeSteps = (testCase.Steps ?? [])
    .filter((step) => step.editState !== 'deleted')
    .slice()
    .sort((a, b) => a.caseSteps.stepNo - b.caseSteps.stepNo);

  return (
    <div className={`${compact ? 'min-w-0 p-2' : 'min-w-0 p-3 sm:p-4'} text-default-500 dark:bg-background`}>
      <div className="mb-4 min-w-0">
        {canNavigateToCase ? (
          <Link
            href={`/projects/${projectId}/folders/${testCase.folderId}/cases/${testCase.id}`}
            locale={locale}
            className={`${NextUiLinkClasses} block min-w-0 max-w-full`}
            aria-label={caseLabel}
            title={caseLabel}
          >
            <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{caseLabel}</span>
          </Link>
        ) : (
          <span className="block break-words text-sm text-default-500" role="status">
            {messages.noCaseSelected}
          </span>
        )}
      </div>

      <dl className="grid min-w-0 gap-3">
        <div
          className={`min-w-0 rounded-lg border border-default-200 ${compact ? 'p-2' : 'p-3'} dark:border-divider dark:bg-content1`}
        >
          <dt className="font-bold">{messages.description}</dt>
          <dd className="mt-1 min-w-0">
            <CaseMarkdown content={testCase.description} messages={messages} />
          </dd>
        </div>
      </dl>

      <details
        className={`${compact ? 'mt-2' : 'mt-3'} min-w-0 rounded-lg border border-default-200 dark:border-divider dark:bg-content1`}
      >
        <summary
          className={`cursor-pointer break-words ${compact ? 'p-2' : 'p-3'} font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset`}
        >
          {messages.metadata}
        </summary>
        <dl
          className={`grid min-w-0 ${compact ? 'gap-2 p-2' : 'gap-3 p-3'} border-t border-default-200 dark:border-divider sm:grid-cols-2`}
        >
          <div className="min-w-0">
            <dt className="font-bold">{messages.priority}</dt>
            <dd className="mt-1">
              <TestCasePriority priorityValue={testCase.priority} priorityMessages={priorityMessages} />
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="font-bold">{messages.type}</dt>
            <dd className="mt-1 break-words">{selectedType ? testTypeMessages[selectedType.uid] : '-'}</dd>
          </div>

          <div className="min-w-0 sm:col-span-2">
            <dt className="font-bold">{messages.tags}</dt>
            <dd className="mt-1 flex min-w-0 flex-wrap gap-1">
              {testCase.Tags && testCase.Tags.length > 0
                ? testCase.Tags.map((tag) => (
                    <Chip key={tag.id} size="sm" variant="flat">
                      <span className="break-words">{tag.name}</span>
                    </Chip>
                  ))
                : '-'}
            </dd>
          </div>
        </dl>
      </details>

      {selectedTemplate?.uid === 'text' ? (
        <>
          <p className="mt-2 font-bold">{messages.testDetail}</p>
          <div className="my-2 min-w-0 flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 w-full sm:w-1/2">
              <ReadOnlyMarkdownField
                label={messages.preconditions}
                content={testCase.preConditions}
                messages={messages}
              />
            </div>
            <div className="min-w-0 w-full sm:w-1/2">
              <ReadOnlyMarkdownField
                label={messages.expectedResult}
                content={testCase.expectedResults}
                messages={messages}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {testCase.template === gherkinTemplate ? (
            <section className={compact ? 'mt-3' : 'mt-4'} aria-labelledby={scenarioHeadingId}>
              <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-2">
                <h3 id={scenarioHeadingId} className="min-w-0 text-base font-bold text-foreground">
                  {messages.scenario}:
                </h3>
                <span className="min-w-0 break-words text-base text-foreground">{testCase.title}</span>
              </div>
              <div className="space-y-2">
                {activeSteps.length > 0 ? (
                  activeSteps.map((step) => {
                    const keyword = step.caseSteps.keyword;
                    const keywordLabel = keyword ? messages[keyword] : messages.steps;
                    return (
                      <article
                        key={step.id}
                        className={`flex items-start gap-3 rounded-lg border ${compact ? 'p-2' : 'p-3'} dark:border-divider/60 dark:bg-content1/70`}
                      >
                        <span
                          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-xs font-semibold ${
                            keyword ? gherkinKeywordStyles[keyword] : 'border-default-300 text-default-500'
                          }`}
                        >
                          {keywordLabel}
                        </span>
                        <CaseMarkdown content={step.step} messages={messages} className="pt-1 text-sm" />
                      </article>
                    );
                  })
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-sm text-default-500 dark:border-divider/60 dark:bg-content2">
                    {messages.noScenarioSteps}
                  </p>
                )}
              </div>
              {testCase.gherkinExamples && (
                <div
                  className={`${compact ? 'mt-3 p-2' : 'mt-5 p-3'} min-w-0 overflow-x-auto rounded-lg border dark:border-divider/60 dark:bg-content2`}
                >
                  <h4 className="mb-2 font-semibold text-foreground">{messages.examples}</h4>
                  <table
                    className="w-full min-w-max border-collapse text-sm dark:text-foreground"
                    aria-label={messages.examples}
                  >
                    <thead>
                      <tr className="border-b dark:border-divider/60">
                        {testCase.gherkinExamples.headers.map((header, index) => (
                          <th key={`header-${index}`} scope="col" className="p-2 text-start text-foreground">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {testCase.gherkinExamples.rows.map((row, rowIndex) => (
                        <tr key={`row-${rowIndex}`} className="border-b last:border-b-0 dark:border-divider/60">
                          {row.map((cell, columnIndex) => (
                            <td
                              key={`cell-${rowIndex}-${columnIndex}`}
                              className="whitespace-pre-wrap break-words p-2 dark:text-foreground"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : (
            <>
              <p className="mt-2 font-bold">{messages.steps}</p>
              {(testCase.Steps ?? []).map((step) => (
                <div key={step.id} className="my-2 min-w-0 flex flex-col gap-2 sm:flex-row">
                  <div className="min-w-0 w-full sm:w-1/2">
                    <ReadOnlyMarkdownField label={messages.detailsOfTheStep} content={step.step} messages={messages} />
                  </div>
                  <div className="min-w-0 w-full sm:w-1/2">
                    <ReadOnlyMarkdownField label={messages.expectedResult} content={step.result} messages={messages} />
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
