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

export default function CaseDetail({
  projectId,
  testCase,
  locale,
  messages,
  testTypeMessages,
  priorityMessages,
}: Props) {
  return (
    <div className="h-full min-w-0 p-4 text-default-500">
      <div className="mb-4 min-w-0">
        <Link
          href={`/projects/${projectId}/folders/${testCase.folderId}/cases/${testCase.id}`}
          locale={locale}
          className={`${NextUiLinkClasses}`}
        >
          <span className="break-words">
            #{testCase.id} {testCase.title}
          </span>
        </Link>
      </div>

      <div className="mb-4">
        <p className="font-bold">{messages.description}</p>
        <div className="break-words whitespace-pre-wrap">{testCase.description}</div>
      </div>

      <div className="mb-4">
        <p className="font-bold">{messages.priority}</p>
        <TestCasePriority priorityValue={testCase.priority} priorityMessages={priorityMessages} />
      </div>

      <div className="mb-4">
        <p className="font-bold">{messages.type}</p>
        <div>{testTypeMessages[testTypes[testCase.type].uid]}</div>
      </div>

      <div className="mb-4">
        <p className="font-bold">{messages.tags}</p>
        <div className="flex gap-1 flex-wrap mt-1">
          {testCase.Tags &&
            testCase.Tags.length > 0 &&
            testCase.Tags.map((tag) => (
              <Chip key={tag.id} size="sm" variant="flat">
                {tag.name}
              </Chip>
            ))}
        </div>
      </div>

      {templates[testCase.template].uid === 'text' ? (
        <>
          <p className="font-bold mt-2">{messages.testDetail}</p>
          <div className="my-2 flex flex-col gap-2 sm:flex-row">
            <div className="w-full sm:w-1/2">
              <Textarea
                isReadOnly
                size="sm"
                variant="flat"
                label={messages.preconditions}
                value={testCase.preConditions}
              />
            </div>
            <div className="w-full sm:w-1/2">
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
              <div className="mb-3 flex flex-wrap items-baseline gap-2">
                <h3 id="scenario-detail-heading" className="text-base font-bold text-foreground">
                  {messages.scenario}:
                </h3>
                <span className="break-words text-base text-foreground">{testCase.title}</span>
              </div>
              <div className="space-y-2">
                {(testCase.Steps ?? [])
                  .filter((step) => step.editState !== 'deleted')
                  .slice()
                  .sort((a, b) => a.caseSteps.stepNo - b.caseSteps.stepNo)
                  .map((step) => {
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
                  })}
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
              {testCase.Steps?.map((step) => (
                <div key={step.id} className="my-2 flex flex-col gap-2 sm:flex-row">
                  <div className="w-full sm:w-1/2">
                    <Textarea isReadOnly size="sm" variant="flat" label={messages.detailsOfTheStep} value={step.step} />
                  </div>
                  <div className="w-full sm:w-1/2">
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
