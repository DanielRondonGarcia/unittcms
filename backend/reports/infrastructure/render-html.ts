import { Buffer } from 'node:buffer';
import type {
  ReportAutomationExecution,
  ReportCounts,
  ReportEvidenceRef,
  ReportManualExecution,
  ReportModel,
  ReportScenario,
  ReportStep,
} from '../api/types.js';
import {
  assertRenderedOutput,
  displayValue,
  optionalValue,
  outputLimit,
  safeEvidenceHref,
  type ReportRenderOptions,
  wrapRenderError,
} from './render-common.js';

export const HTML_REPORT_CONTENT_TYPE = 'text/html; charset=utf-8';

const COUNT_FIELDS: Array<keyof Omit<ReportCounts, 'total'>> = [
  'passed',
  'failed',
  'untested',
  'retest',
  'skipped',
  'queued',
  'running',
  'error',
  'cancelled',
  'unavailable',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(value: unknown): string {
  return escapeHtml(displayValue(value));
}

function optionalText(value: unknown): string {
  return escapeHtml(optionalValue(value));
}

function inlineJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? displayValue(value);
  } catch {
    return 'Unavailable';
  }
}

function metadataRow(label: string, value: unknown): string {
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${optionalText(value)}</td></tr>`;
}

function countTable(counts: ReportCounts): string {
  const rows = COUNT_FIELDS.map((field) => metadataRow(field, counts[field])).join('');
  return `<table class="counts"><caption>Counts</caption><tbody>${metadataRow('total', counts.total)}${rows}</tbody></table>`;
}

function stepTable(steps: ReportStep[]): string {
  if (steps.length === 0) return '<p>No steps.</p>';
  const rows = steps
    .map(
      (step) =>
        `<tr><td>${optionalText(step.id)}</td><td>${step.position}</td><td>${optionalText(step.keyword)}</td><td>${optionalText(
          step.section
        )}</td><td>${text(step.text)}</td><td>${text(step.expectedResult)}</td></tr>`
    )
    .join('');
  return `<table class="steps"><caption>Ordered steps</caption><thead><tr><th scope="col">Step ID</th><th scope="col">Position</th><th scope="col">Keyword</th><th scope="col">Section</th><th scope="col">Step</th><th scope="col">Expected result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function userName(user: { username?: string; email?: string } | null, id: number | null): string {
  return user?.username ?? user?.email ?? (id === null ? 'Unavailable' : `User #${id}`);
}

function manualTable(records: ReportManualExecution[]): string {
  if (records.length === 0) return '<p>No manual executions.</p>';
  const rows = records
    .map(
      (record) =>
        `<tr><td>${record.id}</td><td>${optionalText(record.result)}</td><td>${record.actorUserId}</td><td>${text(
          userName(record.actor, record.actorUserId)
        )}</td><td>${optionalText(record.assigneeUserId)}</td><td>${text(userName(record.assignee, record.assigneeUserId))}</td><td>${optionalText(
          record.startedAt
        )}</td><td>${optionalText(record.finishedAt)}</td><td>${text(record.status)}</td><td>${record.caseRevision}</td><td>${text(
          record.caseSnapshotHash
        )}</td><td>${text(record.correlationId)}</td><td>${record.stale ? 'stale' : 'current'}${record.sourceDeleted ? ', deleted' : ''}</td></tr>`
    )
    .join('');
  return `<table class="manual-results"><caption>Manual results</caption><thead><tr><th scope="col">Execution</th><th scope="col">Result</th><th scope="col">Actor ID</th><th scope="col">Actor</th><th scope="col">Assignee ID</th><th scope="col">Assignee</th><th scope="col">Started</th><th scope="col">Finished</th><th scope="col">Status</th><th scope="col">Revision</th><th scope="col">Snapshot hash</th><th scope="col">Correlation</th><th scope="col">Snapshot</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function automationTable(records: ReportAutomationExecution[]): string {
  if (records.length === 0) return '<p>No automation executions.</p>';
  const rows = records
    .map(
      (record) =>
        `<tr><td>${text(record.id)}</td><td>${text(record.status)}</td><td>${record.attempt}</td><td>${optionalText(
          record.exampleIndex
        )}</td><td>${text(record.engine)}</td><td>${text(record.model)}</td><td>${text(
          userName(record.assignee, record.assigneeUserId)
        )}</td><td>${optionalText(record.assigneeUserId)}</td><td>${optionalText(
          record.queuedAt
        )}</td><td>${optionalText(record.startedAt)}</td><td>${optionalText(record.finishedAt)}</td><td>${optionalText(
          record.durationMs
        )}</td><td>${text(record.summary)}</td><td>${text(record.error)}</td><td>${text(record.errorKind)}</td><td>${text(
          record.correlationId
        )}</td><td>${text(record.snapshotHash)}</td></tr>`
    )
    .join('');
  return `<table class="automation-results"><caption>Automation results</caption><thead><tr><th scope="col">Execution</th><th scope="col">Status</th><th scope="col">Attempt</th><th scope="col">Example</th><th scope="col">Engine</th><th scope="col">Model</th><th scope="col">Assignee</th><th scope="col">Assignee ID</th><th scope="col">Queued</th><th scope="col">Started</th><th scope="col">Finished</th><th scope="col">Duration ms</th><th scope="col">Summary</th><th scope="col">Error</th><th scope="col">Error kind</th><th scope="col">Correlation</th><th scope="col">Snapshot hash</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function evidenceReference(item: ReportEvidenceRef): string {
  const href = safeEvidenceHref(item.href);
  if (!href) return '<span>Unavailable</span>';
  return `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
}

function evidenceTable(evidence: ReportEvidenceRef[]): string {
  if (evidence.length === 0) return '<p>No evidence references.</p>';
  const rows = evidence
    .map(
      (item) =>
        `<tr><td>${item.id}</td><td>${text(item.source)}</td><td>${text(item.executionId)}</td><td>${text(
          item.label
        )}</td><td>${text(item.state)}</td><td>${optionalText(item.mimeType)}</td><td>${optionalText(item.size)}</td><td>${optionalText(
          item.expiresAt
        )}</td><td>${evidenceReference(item)}</td></tr>`
    )
    .join('');
  return `<table class="evidence"><caption>Evidence references</caption><thead><tr><th scope="col">Evidence</th><th scope="col">Source</th><th scope="col">Execution</th><th scope="col">Label</th><th scope="col">State</th><th scope="col">MIME</th><th scope="col">Size</th><th scope="col">Expires</th><th scope="col">Reference</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function manualDetails(records: ReportManualExecution[]): string {
  return records
    .map(
      (record) =>
        `<details><summary>Manual execution ${record.id}</summary><p>Correlation: ${text(
          record.correlationId
        )}</p><p>Case revision: ${record.caseRevision}; snapshot hash: ${text(record.caseSnapshotHash)}</p>${
          record.report ? `<pre>${escapeHtml(inlineJson(record.report))}</pre>` : ''
        }</details>`
    )
    .join('');
}

function automationDetails(records: ReportAutomationExecution[]): string {
  return records
    .map(
      (record) =>
        `<details><summary>Automation execution ${text(record.id)}</summary><p>Summary: ${text(
          record.summary
        )}</p><p>Error: ${text(record.error)}; kind: ${text(record.errorKind)}</p><p>Snapshot hash: ${text(
          record.snapshotHash
        )}</p>${record.snapshot ? `<pre>${escapeHtml(inlineJson(record.snapshot))}</pre>` : ''}</details>`
    )
    .join('');
}

function scenarioSection(scenario: ReportScenario): string {
  const title = optionalText(scenario.title);
  const runCase = scenario.runCase;
  return `<section class="scenario" data-scenario-id="${scenario.id}"><h2>${title} <small>#${scenario.id}</small></h2><p><strong>Path:</strong> ${optionalText(
    scenario.path
  )}</p><table class="scenario-metadata"><caption>Scenario metadata</caption><tbody>${metadataRow(
    'Folder ID',
    scenario.folderId
  )}${metadataRow('State', scenario.state)}${metadataRow('Priority', scenario.priority)}${metadataRow('Type', scenario.type)}${metadataRow(
    'Automation status',
    scenario.automationStatus
  )}${metadataRow('Template', scenario.template)}${metadataRow('Automation version', scenario.automationVersion)}${metadataRow(
    'Created',
    scenario.createdAt
  )}${metadataRow('Updated', scenario.updatedAt)}${metadataRow(
    'Description',
    scenario.description
  )}${metadataRow('Preconditions', scenario.preConditions)}${metadataRow(
    'Expected results',
    scenario.expectedResults
  )}${metadataRow('Run case ID', runCase?.id)}${metadataRow('Run ID', runCase?.runId)}${metadataRow(
    'Run case scenario ID',
    runCase?.caseId
  )}${metadataRow('Run status', runCase?.status)}${metadataRow(
    'Run assignee ID',
    runCase?.assigneeUserId
  )}${metadataRow(
    'Run assignee',
    userName(runCase?.assignee ?? null, runCase?.assigneeUserId ?? null)
  )}${metadataRow('Snapshot source', scenario.snapshot.source)}${metadataRow('Snapshot revision', scenario.snapshot.revision)}${metadataRow(
    'Snapshot hash',
    scenario.snapshot.hash
  )}${metadataRow('Stale', scenario.stale)}${metadataRow('Deleted', scenario.deleted)}</tbody></table><h3>Steps</h3>${stepTable(
    scenario.steps
  )}<h3>Manual source</h3>${manualTable(scenario.manual)}${manualDetails(scenario.manual)}<h3>Automation source</h3>${automationTable(
    scenario.automation
  )}${automationDetails(scenario.automation)}<h3>Evidence</h3>${evidenceTable(scenario.evidence)}</section>`;
}

function reportHtml(report: ReportModel): string {
  const scenarioSections = report.scenarios.map(scenarioSection).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    report.project.name
  )} — Functional scenario report</title><style>body{font-family:system-ui,sans-serif;line-height:1.4;margin:2rem;color:#17202a}main{max-width:1100px;margin:auto}table{border-collapse:collapse;width:100%;margin:0 0 1.25rem}th,td{border:1px solid #b8c2cc;padding:.4rem;text-align:left;vertical-align:top}th{background:#edf2f7}h1,h2,h3{break-after:avoid}.scenario{break-before:page;margin-top:2rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}.counts{max-width:30rem}a{overflow-wrap:anywhere}</style></head><body><main><header><h1>Functional scenario report</h1><table class="report-metadata"><caption>Report metadata</caption><tbody>${metadataRow(
    'Project',
    report.project.name
  )}${metadataRow('Project ID', report.project.id)}${metadataRow('Project detail', report.project.detail)}${metadataRow(
    'Project visibility',
    report.project.isPublic ? 'public' : 'private'
  )}${metadataRow('Project owner ID', report.project.ownerUserId)}${metadataRow('Project created', report.project.createdAt)}${metadataRow(
    'Project updated',
    report.project.updatedAt
  )}${metadataRow('Execution', `${report.execution.name} (#${report.execution.id})`)}${metadataRow(
    'Execution description',
    report.execution.description
  )}${metadataRow('Execution state', report.execution.state)}${metadataRow('Execution created', report.execution.createdAt)}${metadataRow(
    'Execution updated',
    report.execution.updatedAt
  )}${metadataRow('Scenario count', report.scenarios.length)}</tbody></table></header><section><h2>Aggregates</h2><h3>Manual source</h3>${countTable(
    report.aggregates.manual
  )}<h3>Automation source</h3>${countTable(report.aggregates.automation)}<p><strong>Combined:</strong> ${text(
    report.aggregates.combined
  )}</p></section><section><h2>Scenarios</h2>${scenarioSections || '<p>No scenarios.</p>'}</section></main></body></html>`;
}

export function renderHtml(report: ReportModel, options: ReportRenderOptions = {}): Buffer {
  try {
    outputLimit('html', options);
    return assertRenderedOutput('html', Buffer.from(reportHtml(report), 'utf8'), options);
  } catch (error) {
    throw wrapRenderError('html', error);
  }
}
