import { test, expect, type Page } from '@playwright/test';

async function selectTemplate(page: Page, option: string) {
  await page.getByRole('dialog').getByLabel('Plantilla', { exact: true }).selectOption({ label: option });
}

async function selectKeyword(page: Page, option: string, index = 0) {
  const trigger = page.getByRole('button', { name: /Pasos$/ }).nth(index);
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  const optionLocator = page.getByRole('listbox').getByRole('option', { name: option, exact: true });
  await expect(optionLocator).toBeVisible();
  const optionBox = await optionLocator.boundingBox();
  expect(optionBox).not.toBeNull();
  if (optionBox) await page.mouse.click(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
  await expect(page.getByRole('button', { name: /Pasos$/ }).nth(index)).toContainText(option);
}

async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByLabel('Folder Name').fill(name);
  const createFolderResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/folders$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  const response = await createFolderResponse;
  expect(response.ok()).toBeTruthy();
  const folder = await response.json();
  return String(folder.id);
}

async function createSpanishCase(page: Page, title: string, template: string) {
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.getByLabel('Título del caso de prueba').fill(title);
  await selectTemplate(page, template);
  const createCaseResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/cases$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Crear', exact: true }).click();
  expect((await createCaseResponse).ok()).toBeTruthy();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
}

async function installFakeAutomationApi(page: Page) {
  let pollCount = 0;
  let createCount = 0;
  const cancelledExecutionId = 'fake-execution-cancelled';
  const passedExecutionId = 'fake-execution-1';
  await page.route('**/automation/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const authorization = request.headers().authorization;

    if (!authorization) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthenticated' }),
      });
      return;
    }

    if (path.endsWith('/projects/999/environments')) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden' }),
      });
      return;
    }

    if (request.method() === 'GET' && /\/projects\/\d+\/environments$/.test(path)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 3, name: 'Entorno de prueba', enabled: true }] }),
      });
      return;
    }

    if (request.method() === 'POST' && path.endsWith('/executions')) {
      createCount += 1;
      pollCount = 0;
      const executionId = createCount === 1 ? cancelledExecutionId : passedExecutionId;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ id: executionId, status: 'queued', attempt: 1, environmentId: 3 }),
      });
      return;
    }

    if (request.method() === 'GET' && path.endsWith(`/executions/${cancelledExecutionId}`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: cancelledExecutionId, status: 'running', attempt: 1 }),
      });
      return;
    }

    if (request.method() === 'GET' && path.endsWith(`/executions/${passedExecutionId}`)) {
      pollCount += 1;
      const running = pollCount < 4;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: passedExecutionId,
          status: running ? 'running' : 'passed',
          attempt: 1,
          summary: running ? undefined : 'Fake execution passed',
          durationMs: running ? undefined : 1250,
        }),
      });
      return;
    }

    if (request.method() === 'POST' && path.endsWith(`/executions/${cancelledExecutionId}/cancel`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: cancelledExecutionId, status: 'cancelled', durationMs: 100 }),
      });
      return;
    }

    if (request.method() === 'GET' && path.endsWith(`/executions/${passedExecutionId}/artifacts`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'artifact-1', kind: 'junit', mimeType: 'application/xml', size: 12 }] }),
      });
      return;
    }

    if (request.method() === 'GET' && /\/executions\/[^/]+\/artifacts$/.test(path)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
      return;
    }

    if (request.method() === 'GET' && /\/projects\/\d+\/executions$/.test(path)) {
      const caseId = Number(url.searchParams.get('caseId') ?? 1);
      const runCaseId = Number(url.searchParams.get('runCaseId') ?? 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ id: 'fake-execution-1', status: 'passed', caseId, runCaseId, durationMs: 1250 }],
        }),
      });
      return;
    }

    await route.continue();
  });
}

test('manual Gherkin lifecycle stays localized and preserves legacy templates', async ({ page }) => {
  test.setTimeout(180_000);
  await installFakeAutomationApi(page);
  const suffix = Date.now().toString();
  const username = `gherkin${suffix.slice(-8)}`;
  const email = `${username}@example.com`;
  const projectName = `Gherkin project ${suffix}`;
  const sourceFolder = `Gherkin source ${suffix}`;
  const cloneFolder = `Gherkin clone ${suffix}`;
  const caseTitle = `Localized Gherkin case ${suffix}`;
  const textTitle = `Legacy text case ${suffix}`;
  const stepsTitle = `Legacy steps case ${suffix}`;
  const runName = `Gherkin run ${suffix}`;
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:8000';
  const appUrl = (path: string) => new URL(path, baseUrl).toString();

  await page.goto(appUrl('/en/account/signup'));
  await page.getByRole('textbox', { name: 'Email*' }).fill(email);
  await page.getByRole('textbox', { name: 'User name*' }).fill(username);
  await page.getByRole('textbox', { name: 'Password Password' }).fill('password');
  await page.getByRole('textbox', { name: 'Password (confirm)' }).fill('password');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);

  await page.getByRole('button', { name: 'Find projects', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/projects$/);
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await page.getByLabel('Project Name').fill(projectName);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('link', { name: projectName, exact: true }).click();
  await expect(page).toHaveURL(/\/en\/projects\/\d+\/home$/);

  const projectId = page.url().match(/\/projects\/(\d+)\//)?.[1];
  expect(projectId).toBeTruthy();

  await page.goto(appUrl(`/en/projects/${projectId}/folders`));
  await expect(page).toHaveURL(/\/en\/projects\/\d+\/folders/);
  const sourceFolderId = await createFolder(page, sourceFolder);
  await page.goto(appUrl(`/en/projects/${projectId}/folders/${sourceFolderId}/cases`));
  await expect(page).toHaveURL(/\/en\/projects\/\d+\/folders\/\d+\/cases$/);

  const cloneFolderId = await createFolder(page, cloneFolder);
  await page.goto(appUrl(`/en/projects/${projectId}/folders/${cloneFolderId}/cases`));
  await expect(page).toHaveURL(/\/en\/projects\/\d+\/folders\/\d+\/cases$/);

  await page.goto(appUrl(`/es/projects/${projectId}/folders/${sourceFolderId}/cases`));
  await expect(page.getByRole('button', { name: 'Nuevo', exact: true })).toBeVisible();
  await createSpanishCase(page, caseTitle, 'Dado / Cuando / Entonces');
  await page.getByRole('link', { name: caseTitle, exact: true }).click();
  await expect(page).toHaveURL(/\/es\/projects\/\d+\/folders\/\d+\/cases\/\d+$/);

  const keywordSelects = page.getByRole('button', { name: /Pasos$/ });
  await expect(keywordSelects).toHaveCount(3);
  await expect(keywordSelects.nth(0)).toContainText('Dado');
  await expect(keywordSelects.nth(1)).toContainText('Cuando');
  await expect(keywordSelects.nth(2)).toContainText('Entonces');

  await selectKeyword(page, 'Entonces', 0);
  await selectKeyword(page, 'Dado', 1);
  await selectKeyword(page, 'Entonces', 2);

  const stepDetails = page.getByRole('textbox', { name: 'Detalles del paso' });
  await stepDetails.nth(0).fill('Repeated then condition');
  await stepDetails.nth(1).fill('Given condition');
  await stepDetails.nth(2).fill('Repeated then outcome');
  await page.getByRole('button', { name: 'Nuevo paso', exact: true }).last().click();
  await expect(stepDetails).toHaveCount(4);
  await selectKeyword(page, 'Cuando', 0);
  await stepDetails.nth(0).fill('When condition');

  const updateCase = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && /\/cases\/\d+$/.test(new URL(response.url()).pathname)
  );
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  expect((await updateCase).ok()).toBeTruthy();
  await expect(page.getByText('Caso de prueba actualizado', { exact: true })).toBeVisible();
  await expect(page.getByText('Automatización', { exact: true })).toHaveCount(0);

  const unauthenticated = await page.evaluate(
    async () => (await fetch('/api/automation/projects/999/environments')).status
  );
  expect(unauthenticated).toBe(401);
  const crossProject = await page.evaluate(
    async () =>
      (await fetch('/api/automation/projects/999/environments', { headers: { Authorization: 'Bearer fixture' } }))
        .status
  );
  expect(crossProject).toBe(403);

  await page.goto(appUrl(`/es/projects/${projectId}/folders/${sourceFolderId}/cases`));
  await page.getByRole('link', { name: caseTitle, exact: true }).click();
  const reopenedKeywordSelects = page.getByRole('button', { name: /Pasos$/ });
  await expect(reopenedKeywordSelects).toHaveCount(4);
  await expect(reopenedKeywordSelects.nth(0)).toContainText('Cuando');
  await expect(reopenedKeywordSelects.nth(1)).toContainText('Entonces');
  await expect(reopenedKeywordSelects.nth(2)).toContainText('Dado');
  await expect(reopenedKeywordSelects.nth(3)).toContainText('Entonces');
  await expect(page.getByRole('textbox', { name: 'Detalles del paso' }).nth(0)).toHaveValue('When condition');
  await expect(page.getByRole('textbox', { name: 'Detalles del paso' }).nth(1)).toHaveValue('Repeated then condition');

  await page.goto(appUrl(`/es/projects/${projectId}/folders/${sourceFolderId}/cases`));
  const sourceCaseRow = page.locator('tr').filter({ has: page.getByRole('link', { name: caseTitle, exact: true }) });
  await sourceCaseRow.dragTo(page.getByRole('treeitem', { name: cloneFolder, exact: true }));
  await page.getByRole('dialog').getByRole('button', { name: 'Clonar', exact: true }).click();
  await expect(page.getByText('Casos de prueba clonados', { exact: true })).toBeVisible();

  await page.goto(appUrl(`/es/projects/${projectId}/folders/${cloneFolderId}/cases`));
  await expect(page.getByRole('link', { name: caseTitle, exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: caseTitle, exact: true }).click();
  const clonedKeywordSelects = page.getByRole('button', { name: /Pasos$/ });
  await expect(clonedKeywordSelects).toHaveCount(4);
  await expect(clonedKeywordSelects.nth(0)).toContainText('Cuando');
  await expect(clonedKeywordSelects.nth(1)).toContainText('Entonces');
  await expect(clonedKeywordSelects.nth(2)).toContainText('Dado');
  await expect(clonedKeywordSelects.nth(3)).toContainText('Entonces');
  await expect(page.getByRole('textbox', { name: 'Detalles del paso' }).nth(3)).toHaveValue('Repeated then outcome');

  await page.goto(appUrl(`/es/projects/${projectId}/folders/${sourceFolderId}/cases`));
  await createSpanishCase(page, textTitle, 'Texto');
  await page.getByRole('link', { name: textTitle, exact: true }).click();
  await expect(page.getByLabel('Precondiciones')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo paso', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Pasos$/ })).toHaveCount(0);

  await page.goto(appUrl(`/es/projects/${projectId}/folders/${sourceFolderId}/cases`));
  await createSpanishCase(page, stepsTitle, 'Pasos');
  await page.getByRole('link', { name: stepsTitle, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nuevo paso', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pasos$/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ejecuciones de prueba', exact: true }).click();
  await expect(page).toHaveURL(/\/es\/projects\/\d+\/runs$/);
  await page.getByRole('button', { name: 'Nueva ejecución', exact: true }).click();
  await page.getByLabel('Nombre de la ejecución').fill(runName);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByRole('link', { name: runName, exact: true }).click();
  await expect(page).toHaveURL(/\/es\/projects\/\d+\/runs\/\d+$/);

  await page.getByText(sourceFolder, { exact: true }).click();
  const runCaseRow = page.locator('tr').filter({ has: page.getByRole('link', { name: caseTitle, exact: true }) });
  await expect(runCaseRow).toBeVisible();
  await runCaseRow.getByRole('button').last().click();
  const includeCase = page.getByRole('menuitem', { name: 'Incluir en la ejecución', exact: true });
  await expect(includeCase).toBeVisible();
  const includeCaseBox = await includeCase.boundingBox();
  expect(includeCaseBox).not.toBeNull();
  if (includeCaseBox)
    await page.mouse.click(includeCaseBox.x + includeCaseBox.width / 2, includeCaseBox.y + includeCaseBox.height / 2);
  await page.getByRole('button', { name: 'Actualizar', exact: true }).first().click();
  await expect(page.getByText('Ejecución de prueba actualizada', { exact: true })).toBeVisible();

  await runCaseRow.getByRole('link', { name: caseTitle, exact: true }).click();
  await expect(page).toHaveURL(/\/es\/projects\/\d+\/runs\/\d+\/cases\/\d+$/);
  const automationEnvironment = page.getByRole('button', { name: /Selecciona un entorno de ejecución/ });
  await expect(automationEnvironment).toBeVisible();
  await automationEnvironment.click();
  const environmentOption = page.getByRole('listbox').getByRole('option', { name: 'Entorno de prueba', exact: true });
  await expect(environmentOption).toBeVisible();
  const environmentBox = await environmentOption.boundingBox();
  expect(environmentBox).not.toBeNull();
  if (environmentBox)
    await page.mouse.click(environmentBox.x + environmentBox.width / 2, environmentBox.y + environmentBox.height / 2);
  await page.getByRole('button', { name: 'Ejecutar automáticamente', exact: true }).click();
  await expect(page.getByText('En ejecución', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar ejecución', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar ejecución', exact: true }).click();
  await expect(page.getByText('Cancelado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ejecutar automáticamente', exact: true }).click();
  await expect(page.getByText('En ejecución', { exact: true })).toBeVisible();
  await expect(page.getByText('Aprobado', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Resumen:', { exact: true }).locator('..')).toContainText('Fake execution passed');
  await expect(page.getByText('Duración:', { exact: true }).locator('..')).toContainText('1.25s');
  await expect(page.getByText('junit', { exact: true })).toBeVisible();
  await expect(page.getByText('Historial de ejecuciones', { exact: true })).toBeVisible();
  await expect(page.getByText('Dado', { exact: true })).toBeVisible();
  await expect(page.getByText('Cuando', { exact: true })).toBeVisible();
  await expect(page.getByText('Entonces', { exact: true })).toHaveCount(2);
});
