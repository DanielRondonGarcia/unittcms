import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
const png = Buffer.from('89504e470d0a1a0a', 'hex');

function appUrl(path: string): string {
  return new URL(path, baseUrl).toString();
}

function waitForApiResponse(page: Page, method: string, pathPattern: RegExp, query?: Record<string, string>) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === method &&
      pathPattern.test(url.pathname) &&
      (!query || Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value))
    );
  });
}

async function expectResponsiveDetail(page: Page, description: string): Promise<void> {
  const detailPane = page.getByTestId('run-case-detail-pane');
  await expect(detailPane).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  const dimensions = await detailPane.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function createProject(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await page.getByLabel('Project Name', { exact: true }).fill(name);
  const responsePromise = waitForApiResponse(page, 'POST', /\/projects$/);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  return String(project.id);
}

async function createFolder(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByLabel('Folder Name', { exact: true }).fill(name);
  const responsePromise = waitForApiResponse(page, 'POST', /\/folders$/);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const folder = await response.json();
  return String(folder.id);
}

async function createCase(page: Page, title: string, description: string): Promise<string> {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Test Case Title', { exact: true }).fill(title);
  await page.getByLabel('Test Case Description', { exact: true }).fill(description);
  const responsePromise = waitForApiResponse(page, 'POST', /\/cases$/);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const testcase = await response.json();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  return String(testcase.id);
}

async function createRun(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'New Run', exact: true }).click();
  await page.getByLabel('Run name', { exact: true }).fill(name);
  const responsePromise = waitForApiResponse(page, 'POST', /\/runs$/);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  return String(run.id);
}

test('executes a manual RunCase with cancel, reload, private evidence, and an overall result', async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const username = `manual${suffix.replace(/\D/g, '').slice(-10)}`;
  const email = `${username}@example.com`;
  const password = `manual-password-${suffix}`;
  const projectName = `Manual execution project ${suffix}`;
  const folderName = `Manual execution folder ${suffix}`;
  const caseTitle = `Manual execution case ${suffix}`;
  const longDescription = `Long detail ${suffix}: ${'preserve this value across a narrow viewport '.repeat(12)}`;
  const runName = `Manual execution run ${suffix}`;

  await page.goto(appUrl('/en/account/signup'));
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('User name', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password (confirm)', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);

  await page.getByRole('button', { name: 'Find projects', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/projects$/);
  const projectId = await createProject(page, projectName);
  await expect(page.getByRole('link', { name: projectName, exact: true })).toBeVisible();
  await page.getByRole('link', { name: projectName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/en/projects/${projectId}/home$`));

  await page.goto(appUrl(`/en/projects/${projectId}/folders`));
  const folderId = await createFolder(page, folderName);
  await page.goto(appUrl(`/en/projects/${projectId}/folders/${folderId}/cases`));
  const caseId = await createCase(page, caseTitle, longDescription);

  await page.goto(appUrl(`/en/projects/${projectId}/runs`));
  const runId = await createRun(page, runName);
  await expect(page.getByRole('link', { name: runName, exact: true })).toBeVisible();
  await page.getByRole('link', { name: runName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/en/projects/${projectId}/runs/${runId}$`));

  await page.getByText(folderName, { exact: true }).click();
  const runCaseRow = page.locator('tr').filter({ hasText: caseTitle });
  await expect(runCaseRow).toBeVisible();
  await runCaseRow.getByRole('button').last().click();
  const includeCase = page.getByRole('menuitem', { name: 'Include in run', exact: true });
  await expect(includeCase).toBeVisible();
  const includeCaseBox = await includeCase.boundingBox();
  expect(includeCaseBox).not.toBeNull();
  if (includeCaseBox)
    await page.mouse.click(includeCaseBox.x + includeCaseBox.width / 2, includeCaseBox.y + includeCaseBox.height / 2);
  const runCaseUpdate = waitForApiResponse(page, 'POST', /\/runcases\/update$/);
  await page.getByRole('button', { name: 'Update', exact: true }).first().click();
  const runCaseUpdateResponse = await runCaseUpdate;
  expect(runCaseUpdateResponse.ok()).toBeTruthy();
  const runCaseUpdates = (await runCaseUpdateResponse.json()) as Array<{
    id?: unknown;
    caseId?: unknown;
    runId?: unknown;
  }>;
  const createdRunCase = runCaseUpdates.find((runCase) => String(runCase.caseId) === caseId);
  expect(createdRunCase).toBeDefined();
  if (!createdRunCase) throw new Error(`RunCase for case ${caseId} was not created`);
  expect(Number(createdRunCase.caseId)).toBe(Number(caseId));
  expect(Number(createdRunCase.runId)).toBe(Number(runId));
  const expectedRunCaseId = Number(createdRunCase.id);
  expect(Number.isInteger(expectedRunCaseId) && expectedRunCaseId > 0).toBeTruthy();
  await expect(page.getByText('Updated test run', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 520, height: 900 });
  await runCaseRow.getByText(caseTitle, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/en/projects/${projectId}/runs/${runId}/cases/${caseId}$`));
  await expectResponsiveDetail(page, longDescription);
  await expect(page.getByRole('heading', { name: 'Manual execution', exact: true })).toBeVisible();
  await expect(page.getByText('No manual execution is active for this RunCase.', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expectResponsiveDetail(page, longDescription);

  const startResponsePromise = waitForApiResponse(page, 'POST', /\/manual-executions\/run-cases\/\d+$/);
  await page.getByRole('button', { name: 'Start manual execution', exact: true }).click();
  const startResponse = await startResponsePromise;
  expect(startResponse.status()).toBe(201);
  const started = await startResponse.json();
  expect(started.status).toBe('running');
  await expect(page.getByText('Running', { exact: true })).toBeVisible();

  const cancelResponsePromise = waitForApiResponse(page, 'POST', /\/manual-executions\/\d+\/cancel$/);
  await page.getByRole('button', { name: 'Cancel execution', exact: true }).click();
  const cancelResponse = await cancelResponsePromise;
  expect(cancelResponse.ok()).toBeTruthy();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('No manual execution is active for this RunCase.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start manual execution', exact: true })).toBeVisible();

  const secondStartPromise = waitForApiResponse(page, 'POST', /\/manual-executions\/run-cases\/\d+$/);
  await page.getByRole('button', { name: 'Start manual execution', exact: true }).click();
  const secondStart = await secondStartPromise;
  expect(secondStart.status()).toBe(201);
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Evidence is available only to authorized project members.', { exact: true })
  ).toBeVisible();

  const evidenceInput = page.getByLabel('Upload PNG or JPEG evidence', { exact: true });
  await expect(evidenceInput).toBeAttached();
  const uploadResponsePromise = waitForApiResponse(page, 'POST', /\/manual-executions\/\d+\/evidence$/);
  await evidenceInput.setInputFiles({ name: 'manual-proof.png', mimeType: 'image/png', buffer: png });
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  const uploaded = await uploadResponse.json();
  expect(uploaded.mimeType).toBe('image/png');
  expect(JSON.stringify(uploaded)).not.toMatch(/public|storageKey|url/i);
  await expect(page.getByText('manual-proof.png (1 KB)', { exact: true })).toBeVisible();

  const downloadResponsePromise = waitForApiResponse(page, 'GET', /\/manual-executions\/\d+\/evidence\/\d+$/);
  await page.getByRole('button', { name: 'Download: manual-proof.png', exact: true }).click();
  const downloadResponse = await downloadResponsePromise;
  expect(downloadResponse.ok()).toBeTruthy();
  expect(downloadResponse.headers()['content-type']).toMatch(/^image\/png/);
  expect(new URL(downloadResponse.url()).pathname).toMatch(/\/manual-executions\/\d+\/evidence\/\d+$/);
  expect(new URL(downloadResponse.url()).pathname).not.toMatch(/\/uploads?\//);
  const unauthenticatedDownloadStatus = await page.evaluate(
    async (url) => (await fetch(url)).status,
    downloadResponse.url()
  );
  expect(unauthenticatedDownloadStatus).toBe(401);

  const finishResponsePromise = waitForApiResponse(page, 'POST', /\/manual-executions\/\d+\/finish$/);
  await page.getByRole('button', { name: 'Finish as passed', exact: true }).click();
  const finishResponse = await finishResponsePromise;
  expect(finishResponse.ok()).toBeTruthy();
  const finished = await finishResponse.json();
  expect(finished).toEqual(expect.objectContaining({ status: 'finished', result: 'passed' }));
  await expect(page.getByRole('region', { name: 'Manual execution', exact: true }).getByRole('status')).toHaveText(
    'Passed'
  );
  await expect(page.getByRole('button', { name: 'Delete: manual-proof.png', exact: true })).toHaveCount(0);

  const finalCasesResponsePromise = waitForApiResponse(page, 'GET', /\/cases\/byproject$/, { projectId, runId });
  await page.goto(appUrl(`/en/projects/${projectId}/runs/${runId}`));
  const finalCasesResponse = await finalCasesResponsePromise;
  expect(finalCasesResponse.ok()).toBeTruthy();
  const finalCases = (await finalCasesResponse.json()) as Array<{
    id?: unknown;
    RunCases?: Array<{ id?: unknown; runId?: unknown; status?: unknown }>;
  }>;
  const finalCase = finalCases.find((testCase) => String(testCase.id) === caseId);
  expect(finalCase).toBeDefined();
  if (!finalCase) throw new Error(`Case ${caseId} was not returned for project ${projectId} and run ${runId}`);
  expect(Number(finalCase.id)).toBe(Number(caseId));
  const finalRunCase = finalCase.RunCases?.find((runCase) => Number(runCase.id) === expectedRunCaseId);
  expect(finalRunCase).toBeDefined();
  if (!finalRunCase) throw new Error(`RunCase ${expectedRunCaseId} was not returned for case ${caseId}`);
  expect(Number(finalRunCase.id)).toBe(expectedRunCaseId);
  expect(Number(finalRunCase.runId)).toBe(Number(runId));
  expect(finalRunCase.status).toBe(1);
  await page.getByText(folderName, { exact: true }).click();
  const refreshedRunCaseRow = page.locator('tr').filter({ hasText: caseTitle });
  await expect(refreshedRunCaseRow.getByRole('button', { name: 'Passed', exact: true })).toBeVisible();
});
