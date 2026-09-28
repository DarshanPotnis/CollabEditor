/**
 * The AI teammate end to end (docs/PLAN-AI.md §7, AI-2), against the e2e
 * server's scripted model (apps/server/src/test/e2e-model-script.ts): it reads
 * routes/users.js, adds a DELETE route, and finishes. No network, no model and
 * no WebContainer: the file tools are what these tests exercise; running the
 * project is covered by the opt-in WebContainer suite and the manual test.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { openPair, readEditorText, treeItem, treeRow, typeAtEnd } from './support.js';

/** What the scripted agent adds. */
const ROUTE = "usersRouter.delete('/:id', (req, res) => {";
/** A goal with this makes the scripted model answer slowly enough to stop. */
const SLOW_AGENT = 'e2e-slow-agent';
const SUMMARY = 'Added DELETE /users/:id to routes/users.js.';

async function openUsersRoute(page: Page): Promise<void> {
  await treeRow(page, 'routes').click();
  await treeItem(page, 'users.js').click();
  await expect.poll(() => readEditorText(page)).toContain('usersRouter');
}

async function startAgent(page: Page, goal: string): Promise<void> {
  await page.getByLabel('What should the AI teammate do?').fill(goal);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Before you use AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test("the AI teammate works as a peer, and undo keeps a collaborator's edit", async ({
  browser,
}) => {
  const { a, b } = await openPair(browser, 'Express API');
  await openUsersRoute(a);
  await openUsersRoute(b);

  await startAgent(a, 'Add a DELETE /users/:id endpoint');

  // The collaborator sees an AI in the room, working for the person who started it.
  const aiAvatar = b.getByRole('button', { name: /^AI teammate \(AI, working for / });
  await expect(aiAvatar).toBeVisible();
  await expect(b.getByText(/and an AI teammate here/)).toBeVisible();
  // Its edit reaches both editors as a remote edit.
  for (const page of [a, b]) await expect.poll(() => readEditorText(page)).toContain(ROUTE);
  await expect(a.getByText(SUMMARY)).toBeVisible();
  await expect(aiAvatar).toHaveAccessibleName(/: Finished/);

  // The collaborator edits the file after the agent did.
  await typeAtEnd(b, '// kept by B');
  await expect.poll(() => readEditorText(a)).toContain('// kept by B');

  await a.getByRole('button', { name: 'Undo AI changes' }).click();
  const confirm = a.getByRole('alertdialog', { name: 'Undo AI changes?' });
  await expect(confirm).toContainText(
    '1 file the AI changed has been edited by someone else since:',
  );
  await expect(confirm).toContainText('routes/users.js');
  await confirm.getByRole('button', { name: 'Undo anyway' }).click();
  await expect(a.getByText("Undid the AI's changes in 1 file.")).toBeVisible();

  for (const page of [a, b]) {
    await expect.poll(() => readEditorText(page)).not.toContain(ROUTE);
    expect(await readEditorText(page)).toContain('// kept by B');
  }

  // Done: the agent leaves the room.
  await a.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(aiAvatar).toHaveCount(0);
  await expect(a.getByLabel('What should the AI teammate do?')).toBeVisible();
});

test('Stop ends a session part way through', async ({ browser }) => {
  const { a } = await openPair(browser, 'Express API');
  await startAgent(a, `Think for a long time ${SLOW_AGENT}`);
  await expect(a.getByRole('status').filter({ hasText: /^Step 1 of 15/ })).toBeVisible();
  await a.getByRole('button', { name: 'Stop' }).click();
  await expect(a.getByText('You stopped the AI teammate.')).toBeVisible();
  // It was stopped while thinking, before it changed anything.
  await expect(a.getByText('It did not change any files.')).toBeVisible();
  await expect(a.getByRole('button', { name: 'Undo AI changes' })).toHaveCount(0);
});

test('Download trace saves the whole session, and never the own key', async ({ browser }) => {
  const ownKey = 'sk-ant-e2e-trace-canary-3141';
  const { a } = await openPair(browser, 'Express API');
  await a.getByRole('button', { name: 'AI settings' }).click();
  const settings = a.getByRole('dialog');
  await settings.getByLabel('Provider').selectOption('anthropic');
  await settings.getByLabel('API key').fill(ownKey);
  await settings.getByRole('button', { name: 'Save' }).click();

  await startAgent(a, 'Add a DELETE /users/:id endpoint');
  await expect(a.getByText(SUMMARY)).toBeVisible();
  const download = a.waitForEvent('download');
  await a.getByRole('button', { name: 'Download trace' }).click();
  const file = await (await download).path();
  const text = await readFile(file, 'utf8');

  expect(text).not.toContain(ownKey);
  const trace = JSON.parse(text) as {
    format: string;
    tier: string;
    project: { template: string };
    inputs: { goal: string };
    steps: Array<{ model: { message: unknown } | null }>;
    outcome: { kind: string };
  };
  expect(trace).toMatchObject({
    format: 'collabcode-agent-trace',
    tier: 'ownKey',
    project: { template: 'express-api' },
    inputs: { goal: 'Add a DELETE /users/:id endpoint' },
    outcome: { kind: 'finished' },
  });
  expect(trace.steps).toHaveLength(3);
  expect(trace.steps.every((step) => step.model?.message !== undefined)).toBe(true);
});
