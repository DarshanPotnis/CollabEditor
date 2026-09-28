/**
 * Running the project for real (PLAN.md §10.3). Opt-in: this boots a real
 * WebContainer, which downloads StackBlitz's runtime and installs npm
 * packages over the network, so it is not part of the default suite or CI.
 *
 *   RUN_WEBCONTAINER_E2E=1 npm run e2e -- runtime.spec.ts
 */
import { expect, test } from '@playwright/test';
import { downloadTrace, startAgent, traceToolCalls } from './agent-support.js';
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
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText(
    /crashed|stopped|exited/,
    { timeout: 30_000 },
  );

  await replaceEditorText(page, route('fixed'));
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText('Server running', {
    timeout: 60_000,
  });
  expect(await sendFromApiConsole(page, 'GET', '/users')).toContain('fixed');
});

test('Explain with AI explains a crash, sending the whole ES module', async ({ page }) => {
  await createProject(page, 'Express API');
  await runProject(page);
  await page.getByRole('treeitem', { name: 'routes' }).click();
  await page.getByRole('treeitem', { name: 'users.js' }).click();
  await replaceEditorText(
    page,
    "import { Router } from 'express';\nconst settings = undefined;\nexport const usersRouter = Router(settings.options);",
  );
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText('crashed', {
    timeout: 30_000,
  });

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/ai/step'));
  await page.getByRole('button', { name: 'Explain with AI' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('This code is explained by the fake model.')).toBeVisible();

  // WebContainer shifts ES module line numbers, so the file goes whole, with no crash line.
  const body = (await sent).postDataJSON() as {
    promptId: string;
    inputs: { terminalOutput: string; excerpt?: { path: string; focusLine?: number } };
  };
  expect(body.promptId).toBe('explain-error');
  expect(body.inputs.terminalOutput).toContain('TypeError');
  expect(body.inputs.excerpt).toMatchObject({ path: 'routes/users.js' });
  expect(body.inputs.excerpt).not.toHaveProperty('focusLine');
});

test('a program that crashes before it ever listens shows as crashed', async ({ page }) => {
  await createProject(page, 'Express API');
  await replaceEditorText(page, 'const settings = undefined;\nconsole.log(settings.port);');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText(
    'The program crashed',
    { timeout: 120_000 },
  );
  await expect(page.getByRole('button', { name: 'Explain with AI' })).toBeVisible();

  await replaceEditorText(
    page,
    "import express from 'express';\nexpress().listen(3000, () => console.log('up'));",
  );
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText('Server running', {
    timeout: 60_000,
  });
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

test('the AI teammate edits the route, runs the project and calls it', async ({ page }) => {
  await createProject(page, 'Express API');
  await startAgent(page, 'Add DELETE e2e-run-agent');

  // The scripted model reports what the real server in the container answered.
  await expect(page.getByText('DELETE /users/1 answered 204.')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText('Server running');

  // What the model read from the real npm install: its result, without the spinner's frames.
  const run = traceToolCalls(await downloadTrace(page)).find(
    (call) => call.toolName === 'run_project',
  );
  expect(run?.output).toMatch(/added \d+ packages/);
  // Leftovers look like a run of frames ("\\|/-\\|"), a frame alone on a line, or a frame
  // stuck to the next line ("/28 packages"); npm's own "--watch" flags are not.
  expect(run?.output).not.toMatch(/\\\||\|\/|^[\\|/-]$|^[\\|/]\S|[\u2800-\u28ff]/m);
});
