import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type {
  ReportAutomationExecution,
  ReportCounts,
  ReportEvidenceRef,
  ReportManualExecution,
  ReportModel,
  ReportScenario,
} from '../api/types.js';
import {
  assertRenderedOutput,
  displayValue,
  outputLimit,
  safeEvidenceHref,
  type ReportRenderOptions,
  ReportRenderError,
  wrapRenderError,
} from './render-common.js';

export const DOCX_REPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? displayValue(value);
  } catch {
    return 'Unavailable';
  }
}

function validateReport(report: ReportModel): void {
  try {
    if (JSON.stringify(report) === undefined) throw new ReportRenderError('docx', 'report_output_invalid');
  } catch (error) {
    throw error instanceof ReportRenderError ? error : new ReportRenderError('docx', 'report_render_failed', error);
  }
}

type DocxHeading = (typeof HeadingLevel)[keyof typeof HeadingLevel];

function heading(text: string, level: DocxHeading = HeadingLevel.HEADING_2, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    heading: level,
    pageBreakBefore,
    children: [new TextRun({ text })],
  });
}

function line(label: string, value: unknown): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: `${label}: ${displayValue(value)}` })] });
}

function fields(children: Paragraph[], entries: ReadonlyArray<readonly [string, unknown]>): void {
  entries.forEach(([label, value]) => children.push(line(label, value)));
}

function userName(user: { username?: string; email?: string } | null, id: number | null): string {
  return user?.username ?? user?.email ?? (id === null ? 'Unavailable' : `User #${id}`);
}

function evidence(item: ReportEvidenceRef): Paragraph {
  const href = safeEvidenceHref(item.href);
  const children: Array<TextRun | ExternalHyperlink> = [
    new TextRun({
      text: `${displayValue(item.source)} evidence #${item.id} for ${displayValue(item.executionId)}: ${displayValue(
        item.label
      )} [${displayValue(item.state)}]`,
    }),
  ];
  if (href) children.push(new ExternalHyperlink({ link: href, children: [new TextRun({ text: ` - ${href}` })] }));
  return new Paragraph({ children });
}

function manual(children: Paragraph[], record: ReportManualExecution): void {
  fields(children, [
    ['Manual execution', record.id],
    ['Status', record.status],
    ['Result', record.result],
    ['Actor ID', record.actorUserId],
    ['Actor', userName(record.actor, record.actorUserId)],
    ['Assignee ID', record.assigneeUserId],
    ['Assignee', userName(record.assignee, record.assigneeUserId)],
    ['Started', record.startedAt],
    ['Finished', record.finishedAt],
    ['Case revision', record.caseRevision],
    ['Snapshot hash', record.caseSnapshotHash],
    ['Correlation', record.correlationId],
    ['Snapshot', record.stale ? 'stale' : record.sourceDeleted ? 'deleted' : 'current'],
  ]);
  if (record.report) children.push(line('Report details', stringify(record.report)));
  record.evidence.forEach((item) => children.push(evidence(item)));
}

function automation(children: Paragraph[], record: ReportAutomationExecution): void {
  fields(children, [
    ['Automation execution', record.id],
    ['Status', record.status],
    ['Attempt', record.attempt],
    ['Example', record.exampleIndex],
    ['Engine', record.engine],
    ['Model', record.model],
    ['Assignee ID', record.assigneeUserId],
    ['Assignee', userName(record.assignee, record.assigneeUserId)],
    ['Queued', record.queuedAt],
    ['Started', record.startedAt],
    ['Finished', record.finishedAt],
    ['Duration ms', record.durationMs],
    ['Summary', record.summary],
    ['Error', record.error],
    ['Error kind', record.errorKind],
    ['Correlation', record.correlationId],
    ['Snapshot hash', record.snapshotHash],
  ]);
  if (record.snapshot) children.push(line('Snapshot details', stringify(record.snapshot)));
  record.evidence.forEach((item) => children.push(evidence(item)));
}

function counts(children: Paragraph[], label: string, value: ReportCounts): void {
  children.push(heading(label, HeadingLevel.HEADING_3));
  fields(children, Object.entries(value));
}

function scenario(value: ReportScenario, index: number): Paragraph[] {
  const children = [heading(`Scenario ${value.id}: ${displayValue(value.title)}`, HeadingLevel.HEADING_2, index > 0)];
  fields(children, [
    ['Path', value.path],
    ['Folder ID', value.folderId],
    ['State', value.state],
    ['Priority', value.priority],
    ['Type', value.type],
    ['Automation status', value.automationStatus],
    ['Template', value.template],
    ['Automation version', value.automationVersion],
    ['Created', value.createdAt],
    ['Updated', value.updatedAt],
    ['Description', value.description],
    ['Preconditions', value.preConditions],
    ['Expected results', value.expectedResults],
    ['Snapshot source', value.snapshot.source],
    ['Snapshot revision', value.snapshot.revision],
    ['Snapshot hash', value.snapshot.hash],
    ['Stale', value.stale],
    ['Deleted', value.deleted],
  ]);
  if (value.runCase)
    fields(children, [
      ['Run case ID', value.runCase.id],
      ['Run ID', value.runCase.runId],
      ['Run case scenario ID', value.runCase.caseId],
      ['Run status', value.runCase.status],
      ['Run assignee ID', value.runCase.assigneeUserId],
      ['Run assignee', userName(value.runCase.assignee, value.runCase.assigneeUserId)],
    ]);
  children.push(heading('Steps', HeadingLevel.HEADING_3));
  if (value.steps.length === 0) children.push(line('Steps', 'None'));
  value.steps.forEach((step) =>
    children.push(
      line(
        `Step ${step.position}`,
        `${displayValue(step.keyword)} ${displayValue(step.text)} -> ${displayValue(step.expectedResult)}`
      )
    )
  );
  children.push(heading('Manual source', HeadingLevel.HEADING_3));
  if (value.manual.length === 0) children.push(line('Manual executions', 'None'));
  value.manual.forEach((record) => manual(children, record));
  children.push(heading('Automation source', HeadingLevel.HEADING_3));
  if (value.automation.length === 0) children.push(line('Automation executions', 'None'));
  value.automation.forEach((record) => automation(children, record));
  children.push(heading('Evidence', HeadingLevel.HEADING_3));
  if (value.evidence.length === 0) children.push(line('Evidence references', 'None'));
  value.evidence.forEach((item) => children.push(evidence(item)));
  return children;
}

function documentChildren(report: ReportModel): Paragraph[] {
  const children = [heading('Functional scenario report', HeadingLevel.TITLE)];
  fields(children, [
    ['Project', report.project.name],
    ['Project ID', report.project.id],
    ['Project detail', report.project.detail],
    ['Project visibility', report.project.isPublic ? 'public' : 'private'],
    ['Project owner ID', report.project.ownerUserId],
    ['Project created', report.project.createdAt],
    ['Project updated', report.project.updatedAt],
    ['Execution', `${report.execution.name} (#${report.execution.id})`],
    ['Execution description', report.execution.description],
    ['Execution state', report.execution.state],
    ['Execution created', report.execution.createdAt],
    ['Execution updated', report.execution.updatedAt],
    ['Scenario count', report.scenarios.length],
  ]);
  children.push(heading('Aggregates', HeadingLevel.HEADING_1));
  counts(children, 'Manual source', report.aggregates.manual);
  counts(children, 'Automation source', report.aggregates.automation);
  children.push(line('Combined', report.aggregates.combined));
  children.push(heading('Scenarios', HeadingLevel.HEADING_1));
  if (report.scenarios.length === 0) children.push(line('Scenarios', 'None'));
  report.scenarios.forEach((value, index) => children.push(...scenario(value, index)));
  return children;
}

export async function renderDocx(report: ReportModel, options: ReportRenderOptions = {}): Promise<Buffer> {
  try {
    outputLimit('docx', options);
    validateReport(report);
    const document = new Document({ sections: [{ children: documentChildren(report) }] });
    return assertRenderedOutput('docx', await Packer.toBuffer(document), options);
  } catch (error) {
    throw wrapRenderError('docx', error);
  }
}
