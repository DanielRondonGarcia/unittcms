'use client';

import { Textarea, Chip } from '@heroui/react';
import { gherkinKeywordStyles, gherkinTemplate, templates, testTypes } from '@/config/selection';
import type { CaseType } from '@/types/case';
import type { RunDetailMessages } from '@/types/run';
import type { PriorityMessages } from '@/types/priority';
import type { TestTypeMessages } from '@/types/testType';
import TestCasePriority from '@/components/TestCasePriority';
import { Link, NextUiLinkClasses } from '@/src/i18n/routing';

type Props = {
  projectId: string;
  testCase: CaseType;
  locale: string;
  messages: RunDetailMessages;
  testTypeMessages: TestTypeMessages;
  priorityMessages: PriorityMessages;
};

function isPositiveIdentifier(value: string | number): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

export default function CaseDetail({
  projectId,
  testCase,
  locale,
  messages,
  testTypeMessages,
  priorityMessages,
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
    <div className="min-w-0 p-3 text-default-500 sm:p-4">
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
        <div className="min-w-0 rounded-lg border border-default-200 p-3">
          <dt className="font-bold">{messages.description}</dt>
          <dd className="mt-1 break-words whitespace-pre-wrap">{testCase.description || '-'}</dd>
        </div>
      </dl>

      <details className="mt-3 min-w-0 rounded-lg border border-default-200">
        <summary className="cursor-pointer break-words p-3 font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset">
          {messages.metadata}
        </summary>
        <dl className="grid min-w-0 gap-3 border-t border-default-200 p-3 sm:grid-cols-2">
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
              <Textarea
                isReadOnly
                size="sm"
                variant="flat"
                label={messages.preconditions}
                value={testCase.preConditions}
              />
            </div>
            <div className="min-w-0 w-full sm:w-1/2">
              <Textarea
                isReadOnly
                size="sm"
                variant="flat"
                label={messages.expectedResult}
                value={testCase.expectedResults}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {testCase.template === gherkinTemplate ? (
            <section className="mt-4" aria-labelledby="scenario-detail-heading">
              <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-2">
                <h3 id="scenario-detail-heading" className="min-w-0 text-base font-bold text-foreground">
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
                      <article key={step.id} className="flex items-start gap-3 rounded-lg border p-3">
                        <span
                          className={`mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-xs font-semibold ${
                            keyword ? gherkinKeywordStyles[keyword] : 'border-default-300 text-default-500'
                          }`}
                        >
                          {keywordLabel}
                        </span>
                        <p className="min-w-0 whitespace-pre-wrap break-words pt-1 text-sm text-foreground">
                          {step.step}
                        </p>
                      </article>
                    );
                  })
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-sm text-default-500">
                    {messages.noScenarioSteps}
                  </p>
                )}
              </div>
              {testCase.gherkinExamples && (
                <div className="mt-5 min-w-0 overflow-x-auto rounded-lg border p-3">
                  <h4 className="mb-2 font-semibold text-foreground">{messages.examples}</h4>
                  <table className="w-full min-w-max border-collapse text-sm" aria-label={messages.examples}>
                    <thead>
                      <tr className="border-b">
                        {testCase.gherkinExamples.headers.map((header, index) => (
                          <th key={`header-${index}`} scope="col" className="p-2 text-start text-foreground">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {testCase.gherkinExamples.rows.map((row, rowIndex) => (
                        <tr key={`row-${rowIndex}`} className="border-b last:border-b-0">
                          {row.map((cell, columnIndex) => (
                            <td key={`cell-${rowIndex}-${columnIndex}`} className="whitespace-pre-wrap break-words p-2">
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
                    <Textarea isReadOnly size="sm" variant="flat" label={messages.detailsOfTheStep} value={step.step} />
                  </div>
                  <div className="min-w-0 w-full sm:w-1/2">
                    <Textarea isReadOnly size="sm" variant="flat" label={messages.expectedResult} value={step.result} />
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
