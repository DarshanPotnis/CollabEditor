/**
 * Running the project for real (PLAN.md §10.3). Opt-in: this boots a real
 * WebContainer, which downloads StackBlitz's runtime and installs npm
 * packages over the network, so it is not part of the default suite or CI.
 *
 *   RUN_WEBCONTAINER_E2E=1 npm run e2e -- runtime.spec.ts
 */
import { expect, test } from '@playwright/test';
import {
  EDITOR,
  createProject,
  replaceEditorText,
  runProject,
  sendFromApiConsole,
  waitForEditor,
} from './support.js';

test.skip(
  !process.env['RUN_WEBCONTAINER_E2E'],
  'Boots a real WebContainer over the network; set RUN_WEBCONTAINER_E2E=1 to run it.',
);
test.setTimeout(240_000);

const route = (reply: string): string =>
  [
    "import { Router } from 'express';",
    'export const usersRouter = Router();',
    `usersRouter.get('/', (req, res) => res.json({ reply: '${reply}' }));`,
  ].join('\n');

test('Express: Run, call it, edit it, and a collaborator edits it', async ({ browser }) => {
  const mine = await browser.newContext();
  const page = await mine.newPage();
  const projectId = await createProject(page, 'Express API');

  await runProject(page);
  const users = await sendFromApiConsole(page, 'GET', '/users');
  expect(users).toContain('200 OK');
  expect(users).toContain('Ada Lovelace');

  // My edit restarts the server and the next request shows it.
  await page.getByRole('treeitem', { name: 'routes' }).click();
  await page.getByRole('treeitem', { name: 'users.js' }).click();
  await replaceEditorText(page, route('edited by me'));
  await expect
    .poll(() => sendFromApiConsole(page, 'GET', '/users'), { timeout: 60_000 })
    .toContain('edited by me');

  // A collaborator's edit in their browser reaches my running server.
  const theirs = await (await browser.newContext()).newPage();
  await theirs.goto(`/p/${projectId}`);
  await waitForEditor(theirs);
  await theirs.getByRole('treeitem', { name: 'routes' }).click();
  await theirs.getByRole('treeitem', { name: 'users.js' }).click();
  await expect(theirs.locator(EDITOR)).toContainText('edited by me');
  await replaceEditorText(theirs, route('edited by a collaborator'));
  await expect
    .poll(() => sendFromApiConsole(page, 'GET', '/users'), { timeout: 60_000 })
    .toContain('edited by a collaborator');

  // The preview shows the same server.
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.getByLabel('Preview path').fill('/users');
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(
    page.frameLocator('iframe[title="Preview of the running project"]').locator('body'),
  ).toContainText('edited by a collaborator', { timeout: 30_000 });
});

test('a crash restarts by itself once the file is fixed', async ({ page }) => {
  await createProject(page, 'Express API');
  await runProject(page);
  await page.getByRole('treeitem', { name: 'routes' }).click();
  await page.getByRole('treeitem', { name: 'users.js' }).click();

  await replaceEditorText(page, 'this is not javascript');
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText(/stopped|exited/, {
    timeout: 30_000,
  });

  await replaceEditorText(page, route('fixed'));
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText('Server running', {
    timeout: 60_000,
  });
  expect(await sendFromApiConsole(page, 'GET', '/users')).toContain('fixed');
});

test('the container runs Node 22 or later, as the templates declare', async ({ page }) => {
  await createProject(page, 'Blank Node');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText(
    /Running npm run dev/,
    {
      timeout: 120_000,
    },
  );
  await page.getByRole('tab', { name: 'Shell' }).click();
  await page.getByRole('button', { name: 'Open a shell' }).click();
  const shell = page.getByRole('region', { name: 'Shell' });
  await expect(shell).toBeVisible();
  await expect(shell).toContainText('project', { timeout: 30_000 });
  await shell.click();
  await page.keyboard.type('node -v\n');
  await expect(shell).toContainText(/v(2[2-9]|[3-9]\d)\.\d+\.\d+/, { timeout: 30_000 });
});
