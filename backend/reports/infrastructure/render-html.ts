import { Buffer } from 'node:buffer';
import type {
  ReportEvidenceRef,
  ReportManualExecution,
  ReportModel,
  ReportScenario,
  ReportStep,
} from '../api/types.js';
import {
  assertRenderedOutput,
  humanDate,
  humanExpectedResult,
  humanStatus,
  humanStepKeyword,
  humanUserName,
  hasExpectedResults,
  latestManualExecution,
  manualNoteEntries,
  outputLimit,
  reportCopy,
  safeEvidenceHref,
  scenarioEvidence,
  scenarioStatus,
  statusTone,
  type ReportCopy,
  type ReportRenderOptions,
  wrapRenderError,
} from './render-common.js';

export const HTML_REPORT_CONTENT_TYPE = 'text/html; charset=utf-8';

type HtmlRow = readonly string[];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function value(value: unknown, copy: ReportCopy): string {
  return escapeHtml(value === null || value === undefined || value === '' ? copy.notAvailable : String(value));
}

function statusBadge(valueToRender: unknown, copy: ReportCopy): string {
  return `<span class="badge badge-${statusTone(valueToRender)}">${escapeHtml(
    humanStatus(valueToRender, copy)
  )}</span>`;
}

function tableMarkup(className: string, caption: string, headers: readonly string[], rows: readonly HtmlRow[]): string {
  const headerMarkup = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('');
  const bodyMarkup = rows
    .map(
      (row, rowIndex) =>
        `<tr class="${rowIndex % 2 === 1 ? 'is-striped' : ''}">${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`
    )
    .join('');
  return `<div class="table-wrap"><table class="${className}"><caption>${escapeHtml(caption)}</caption><thead><tr>${headerMarkup}</tr></thead><tbody>${bodyMarkup}</tbody></table></div>`;
}

function definitionGrid(className: string, entries: ReadonlyArray<readonly [string, string]>): string {
  return `<dl class="${className}">${entries
    .map(([label, content]) => `<div><dt>${escapeHtml(label)}</dt><dd>${content}</dd></div>`)
    .join('')}</dl>`;
}

function stepTable(steps: ReportStep[], copy: ReportCopy): string {
  if (steps.length === 0) return `<p class="empty-state">${escapeHtml(copy.noSteps)}</p>`;
  const includeExpectedResults = hasExpectedResults(steps);
  const headers = [copy.stepNumber, copy.action];
  if (includeExpectedResults) headers.push(copy.expectedResult);
  const rows: HtmlRow[] = steps.map((step) => {
    const row = [value(step.position, copy), `${escapeHtml(humanStepKeyword(step, copy))} ${value(step.text, copy)}`];
    if (includeExpectedResults) row.push(escapeHtml(humanExpectedResult(step.expectedResult, copy)));
    return row;
  });
  return tableMarkup('steps-table', copy.steps, headers, rows);
}

function manualDetails(record: ReportManualExecution, copy: ReportCopy): string {
  const entries: Array<readonly [string, string]> = [
    [copy.result, statusBadge(record.result, copy)],
    [copy.status, statusBadge(record.status, copy)],
  ];
  const tester = humanUserName(record.actor);
  const assignee = humanUserName(record.assignee);
  if (tester) entries.push([copy.tester, escapeHtml(tester)]);
  if (assignee) entries.push([copy.assignee, escapeHtml(assignee)]);
  if (record.startedAt) entries.push([copy.started, escapeHtml(humanDate(record.startedAt, copy))]);
  if (record.finishedAt) entries.push([copy.finished, escapeHtml(humanDate(record.finishedAt, copy))]);

  const noteEntries = manualNoteEntries(record, copy).map(([label, content]) => [label, escapeHtml(content)] as const);

  return `${definitionGrid('manual-facts', entries)}${
    noteEntries.length > 0
      ? `<div class="manual-notes"><h4>${escapeHtml(copy.manualNotes)}</h4>${definitionGrid(
          'narrative-details',
          noteEntries
        )}</div>`
      : ''
  }`;
}

function manualSection(scenario: ReportScenario, copy: ReportCopy): string {
  const latest = latestManualExecution(scenario.manual);
  const evidenceMarkup = evidenceSection(scenario, copy);
  if (!latest)
    return `<article class="manual-execution"><p class="empty-state">${escapeHtml(
      copy.noManualExecution
    )}</p>${evidenceMarkup}</article>`;
  return `<article class="manual-execution"><h4>${escapeHtml(copy.latestManualExecution)}</h4>${manualDetails(
    latest,
    copy
  )}${evidenceMarkup}</article>`;
}

function evidenceReference(item: ReportEvidenceRef, copy: ReportCopy): string {
  const href = item.state === 'available' ? safeEvidenceHref(item.href) : undefined;
  return href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.openEvidence)}</a>`
    : `<span class="muted">${escapeHtml(copy.noReference)}</span>`;
}

function evidenceSection(scenario: ReportScenario, copy: ReportCopy): string {
  const evidence = scenarioEvidence(scenario);
  if (evidence.length === 0) return `<p class="empty-state">${escapeHtml(copy.noEvidence)}</p>`;
  const rows = evidence.map((item) => [
    value(item.label, copy),
    statusBadge(item.state, copy),
    evidenceReference(item, copy),
  ]);
  return tableMarkup('evidence-table', copy.manualEvidence, [copy.titleLabel, copy.state, copy.reference], rows);
}

function scenarioFacts(scenario: ReportScenario, copy: ReportCopy): string {
  return definitionGrid('scenario-facts', [
    [copy.scenarioNumber, value(scenario.id, copy)],
    [copy.titleLabel, value(scenario.title, copy)],
    [copy.path, value(scenario.path, copy)],
    [copy.status, statusBadge(scenarioStatus(scenario), copy)],
  ]);
}

function scenarioSection(scenario: ReportScenario, index: number, total: number, copy: ReportCopy): string {
  const headingId = `scenario-title-${index}`;
  return `<section class="scenario" aria-labelledby="${headingId}"><div class="scenario-kicker">${escapeHtml(
    copy.scenarioProgress(index + 1, total)
  )}</div><h2 id="${headingId}">${escapeHtml(copy.scenario)} ${value(scenario.id, copy)}${
    scenario.title ? ` <span class="scenario-title-separator">—</span> ${value(scenario.title, copy)}` : ''
  }</h2>${scenarioFacts(scenario, copy)}<h3>${escapeHtml(copy.steps)}</h3>${stepTable(
    scenario.steps,
    copy
  )}<h3>${escapeHtml(copy.latestManualExecution)}</h3>${manualSection(scenario, copy)}</section>`;
}

const REPORT_STYLES = `
:root {
  --ink: #17233c;
  --navy: #23456f;
  --teal: #0f766e;
  --teal-soft: #e7f5f2;
  --blue-soft: #edf4fb;
  --surface: #f6f8fb;
  --border: #d7e0ea;
  --muted: #66758a;
  --positive: #0f766e;
  --positive-soft: #e8f6f1;
  --negative: #b42318;
  --negative-soft: #fff0ee;
  --warning: #a15c07;
  --warning-soft: #fff6e5;
}

@page { size: A4; margin: 16mm 14mm 17mm; }
* { box-sizing: border-box; }
html { background: #edf1f6; }
body {
  margin: 0;
  color: var(--ink);
  background: #edf1f6;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
main { max-width: 1180px; min-height: 100vh; margin: 0 auto; padding: 34px 42px 56px; background: #fff; }
h1, h2, h3, h4, p { margin-top: 0; }
h1 { margin-bottom: 10px; color: var(--navy); font-size: clamp(2rem, 4vw, 3rem); letter-spacing: -0.04em; line-height: 1.1; }
h2 { margin-bottom: 14px; color: var(--navy); font-size: 1.55rem; letter-spacing: -0.02em; }
h3 { margin: 30px 0 12px; padding-bottom: 7px; border-bottom: 2px solid var(--teal-soft); color: var(--navy); font-size: 0.86rem; letter-spacing: 0.1em; text-transform: uppercase; }
h4 { margin: 0 0 12px; color: var(--navy); font-size: 0.98rem; }
.cover { display: flex; min-height: calc(297mm - 16mm - 17mm); flex-direction: column; align-items: center; justify-content: center; break-inside: avoid; page-break-inside: avoid; text-align: center; }
.cover > .eyebrow, .cover > h1, .cover > .cover-lede, .cover > .cover-context { width: 100%; }
.eyebrow, .scenario-kicker { color: var(--teal); font-size: 0.72rem; font-weight: 750; letter-spacing: 0.14em; text-transform: uppercase; }
.cover-lede { max-width: 760px; margin: 0 auto 24px; color: var(--muted); font-size: 1rem; }
.cover-context { max-width: 760px; margin: 0 auto; padding: 12px 16px; border-left: 4px solid var(--teal); background: var(--teal-soft); color: var(--ink); }
.cover-context strong { color: var(--navy); }
.report-section { margin-top: 30px; }
.report-section.has-scenarios { break-before: page; page-break-before: always; }
.section-intro { margin-bottom: 16px; color: var(--muted); }
.scenario { padding-top: 8px; }
.scenario + .scenario { break-before: page; page-break-before: always; margin-top: 0; }
.scenario-title-separator { color: var(--teal); }
.scenario-facts { display: grid; grid-template-columns: minmax(120px, 0.7fr) minmax(180px, 1.35fr) minmax(180px, 1.6fr) minmax(130px, 0.8fr); gap: 1px; margin: 0 0 22px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--border); }
.scenario-facts > div { min-width: 0; padding: 11px 13px; background: #fff; }
dl { margin: 0; }
dt { color: var(--muted); font-size: 0.7rem; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
dd { margin: 4px 0 0; overflow-wrap: anywhere; }
.narrative-details { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 6px; }
.narrative-details > div { padding: 12px 14px; border-left: 3px solid var(--border); border-radius: 4px; background: var(--surface); }
.narrative-details dd { white-space: pre-wrap; }
.manual-facts { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--border); }
.manual-facts > div { min-width: 0; padding: 10px 12px; background: #fff; }
.manual-notes { margin-top: 14px; }
.manual-notes .narrative-details { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.table-wrap { width: 100%; margin: 0 0 17px; overflow-x: auto; }
table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border); border-radius: 7px; background: #fff; font-size: 0.84rem; }
caption { padding: 0 0 7px; color: var(--navy); font-size: 0.76rem; font-weight: 750; letter-spacing: 0.08em; text-align: left; text-transform: uppercase; }
th, td { padding: 9px 10px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
th:last-child, td:last-child { border-right: 0; }
tbody tr:last-child td, tbody tr:last-child th { border-bottom: 0; }
thead th { border-color: var(--navy); background: var(--navy); color: #fff; font-size: 0.7rem; letter-spacing: 0.04em; text-transform: uppercase; }
tbody tr.is-striped td, tbody tr.is-striped th { background: var(--surface); }
.steps-table { min-width: 620px; }
.evidence-table { min-width: 520px; }
.empty-state { margin: 0 0 17px; padding: 12px 14px; border: 1px dashed var(--border); border-radius: 6px; background: var(--surface); color: var(--muted); }
.badge { display: inline-block; padding: 2px 7px; border: 1px solid transparent; border-radius: 999px; font-size: 0.71rem; font-weight: 750; line-height: 1.35; white-space: nowrap; }
.badge-positive { border-color: #a8ded0; background: var(--positive-soft); color: var(--positive); }
.badge-negative { border-color: #f1b8b1; background: var(--negative-soft); color: var(--negative); }
.badge-warning { border-color: #f1d49b; background: var(--warning-soft); color: var(--warning); }
.badge-info { border-color: #b7d5ef; background: var(--blue-soft); color: var(--navy); }
.badge-neutral { border-color: var(--border); background: var(--surface); color: var(--muted); }
.muted { color: var(--muted); }
a { color: var(--teal); font-weight: 750; text-decoration: none; }
a:hover, a:focus { text-decoration: underline; }
@media (max-width: 760px) {
  main { padding: 22px 18px 42px; }
  .scenario-facts, .narrative-details, .manual-facts, .manual-notes .narrative-details { grid-template-columns: 1fr 1fr; }
}
@media print {
  html, body { background: #fff; }
  body { font-size: 10px; }
  main { max-width: none; min-height: auto; padding: 0; }
  .cover { min-height: calc(297mm - 16mm - 17mm); }
  .report-section.has-scenarios { margin-top: 0; }
  .scenario { break-before: auto; page-break-before: auto; padding-top: 0; }
  .scenario + .scenario { break-before: page; page-break-before: always; }
  .table-wrap { overflow: visible; }
  table { break-inside: auto; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3, h4, caption { break-after: avoid; page-break-after: avoid; }
  a { color: inherit; }
}
`;

function reportHtml(report: ReportModel, copy: ReportCopy): string {
  const scenarioSections = report.scenarios.map((scenario, index) =>
    scenarioSection(scenario, index, report.scenarios.length, copy)
  );
  const scenarios =
    scenarioSections.length > 0
      ? scenarioSections.join('')
      : `<p class="empty-state">${escapeHtml(copy.noScenarios)}</p>`;
  const reportSectionClass = scenarioSections.length > 0 ? 'report-section has-scenarios' : 'report-section';
  return `<!doctype html><html lang="${copy.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${value(
    report.project.name,
    copy
  )} — ${escapeHtml(copy.title)}</title><style>${REPORT_STYLES}</style></head><body><main><header class="cover"><div class="eyebrow">${escapeHtml(
    copy.coverEyebrow
  )}</div><h1>${escapeHtml(copy.title)}</h1><p class="cover-lede">${escapeHtml(
    copy.coverLead
  )}</p><p class="cover-context"><strong>${escapeHtml(copy.project)}:</strong> ${value(
    report.project.name,
    copy
  )} <span aria-hidden="true">·</span> <strong>${escapeHtml(copy.execution)}:</strong> ${value(
    report.execution.name,
    copy
  )}</p></header><section class="${reportSectionClass}" aria-labelledby="scenario-list-title"><h2 id="scenario-list-title">${escapeHtml(
    copy.scenarios
  )}</h2>${scenarios}</section></main></body></html>`;
}

export function renderHtml(report: ReportModel, options: ReportRenderOptions = {}): Buffer {
  try {
    outputLimit('html', options);
    const copy = reportCopy(options.locale);
    return assertRenderedOutput('html', Buffer.from(reportHtml(report, copy), 'utf8'), options);
  } catch (error) {
    throw wrapRenderError('html', error);
  }
}
