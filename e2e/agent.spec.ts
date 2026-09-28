/**
 * The AI teammate end to end (docs/PLAN-AI.md §7, AI-2), against the e2e
 * server's scripted model (apps/server/src/test/e2e-model-script.ts): it reads
 * routes/users.js, adds a DELETE route, and finishes. No network, no model and
 * no WebContainer: the file tools are what these tests exercise; running the
 * project is covered by the opt-in WebContainer suite and the manual test.
 */
import { expect, test, type Page } from '@playwright/test';
import { downloadTrace, startAgent } from './agent-support.js';
import { openPair, readEditorText, treeItem, treeRow, typeAtEnd } from './support.js';

/** What the scripted agent adds. */
const ROUTE = "usersRouter.delete('/:id', (req, res) => {";
/** A goal with this makes the scripted model answer slowly enough to stop. */
const SLOW_AGENT = 'e2e-slow-agent';
/** A goal with this makes a scratch file, deletes it, then edits routes/users.js. */
const SCRATCH_AGENT = 'e2e-scratch-agent';
const SUMMARY = 'Added DELETE /users/:id to routes/users.js.';

async function openUsersRoute(page: Page): Promise<void> {
  await treeRow(page, 'routes').click();
  await treeItem(page, 'users.js').click();
  await expect.poll(() => readEditorText(page)).toContain('usersRouter');
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

test('the agent types its edit in live, and the host follows it into the file', async ({
  browser,
}) => {
  const { a, b } = await openPair(browser, 'Express API');
  // The host stays in index.js; the collaborator watches routes/users.js.
  await openUsersRoute(b);
  expect(await readEditorText(a)).toContain('express.json()');

  const partlyTyped = b.waitForFunction(
    () => {
      const text = document.querySelector('.monaco-editor .view-lines')?.textContent ?? '';
      return text.includes('usersRouter.del') && !text.includes('res.status(204).end();});');
    },
    undefined,
    { polling: 'raf', timeout: 15_000 },
  );
  await startAgent(a, 'Add a DELETE /users/:id endpoint');
  await partlyTyped;
  await expect.poll(() => readEditorText(b)).toContain(ROUTE);

  // Follow mode opened the agent's file for the host.
  await expect(a.getByRole('tab', { name: /users\.js/, selected: true })).toBeVisible();
  await expect.poll(() => readEditorText(a)).toContain(ROUTE);
});

test('typing stops following the AI, and Follow AI resumes it', async ({ browser }) => {
  const { a } = await openPair(browser, 'Express API');
  await startAgent(a, `Take your time ${SLOW_AGENT}`);
  await expect(a.getByText('Following the AI. Type or open another file to stop.')).toBeVisible();
  await typeAtEnd(a, '// mine');
  await a.getByRole('button', { name: 'Follow AI' }).click();
  await expect(a.getByText('Following the AI. Type or open another file to stop.')).toBeVisible();
  await a.getByRole('button', { name: 'Stop' }).click();
});

test('follow mode steps out of a file the agent deletes, and Stop lists what it changed', async ({
  browser,
}) => {
  const { a } = await openPair(browser, 'Express API');
  const selected = (name: RegExp) => a.getByRole('tab', { name, selected: true });
  await expect(selected(/index\.js/)).toBeVisible();

  await startAgent(a, `Tidy up ${SCRATCH_AGENT}`);
  // Into the file the agent creates...
  await expect(selected(/scratch\.js/)).toBeVisible();
  // ...and out again when it deletes it: that tab closes, and the host is back in index.js.
  await expect(a.getByRole('tab', { name: /scratch\.js/ })).toHaveCount(0);
  await expect(selected(/index\.js/)).toBeVisible();
  await expect(a.getByText('Following the AI. Type or open another file to stop.')).toBeVisible();
  // Still following: on into its next file.
  await expect(selected(/users\.js/)).toBeVisible();
  await expect.poll(() => readEditorText(a)).toContain(ROUTE);

  await a.getByRole('button', { name: 'Stop' }).click();
  await expect(a.getByText('What it changed so far is still there.')).toBeVisible();
  // The scratch file it created and deleted comes to nothing.
  await expect(a.getByText('Edited routes/users.js.', { exact: true })).toBeVisible();
});

test('a busy model shows a countdown to the retry, then the session goes on', async ({
  browser,
}) => {
  const { a } = await openPair(browser, 'Express API');
  await startAgent(a, `Add a DELETE route e2e-busy-agent ${String(Date.now())}`);
  const status = a.getByRole('status').filter({ hasText: /Gemini is busy, retrying/ });
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/^Gemini is busy, retrying (in \d s|…)$/);
  await expect(a.getByText(SUMMARY)).toBeVisible({ timeout: 20_000 });
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
  const text = await downloadTrace(a);

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
