/**
 * "Watch a demo" and the trace viewer (docs/PLAN-AI.md, AI-5), without a
 * WebContainer: the demo project with the replay offered and labelled, the
 * recording as a labelled timeline, the fallback where the page cannot run
 * code, and "Open a trace…" for any format. No request may reach /api/ai: a
 * replay and a recording ask no model. Playing the replay runs the project,
 * so that is in the opt-in WebContainer suite (runtime.spec.ts).
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { waitForEditor } from './support.js';

const RECORDINGS = fileURLToPath(new URL('../packages/agent/fixtures/traces/', import.meta.url));

const notIsolated = (): void => {
  Object.defineProperty(window, 'crossOriginIsolated', { value: false });
};

/** Every request the page makes to the AI routes. */
function aiRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/ai')) seen.push(request.url());
  });
  return seen;
}

async function watchDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Watch a demo' }).click();
  await page.waitForURL(/\/p\/[a-z0-9]+$/);
  await waitForEditor(page);
}

const panel = (page: Page) => page.locator('section[aria-labelledby="agent-title"]');

test('"Watch a demo" opens a demo project with the replay offered and labelled, and asks no model', async ({
  page,
}) => {
  const ai = aiRequests(page);
  await watchDemo(page);
  // The demo flag is read once and taken out of the address, so a copied link opens the project.
  expect(page.url()).not.toContain('demo=');

  await expect(panel(page).getByLabel('Replay')).toHaveText(
    /^Replay of a recorded session \(recorded 2026-09-29 with agent@5 on gemini-3\.5-flash-lite\)\. No AI is running/,
  );
  await expect(panel(page).getByRole('button', { name: 'Play the replay' })).toBeVisible();
  await expect(panel(page)).toContainText('Add a DELETE /users/:id endpoint with validation');

  await panel(page).getByRole('button', { name: 'View the recorded session instead' }).click();
  const recording = panel(page).getByLabel('Recorded session');
  await expect(recording).toContainText('nothing in it is happening now');
  // The steps themselves, not the tool calls listed inside each.
  await expect(recording.getByRole('list', { name: 'Steps' }).locator(':scope > li')).toHaveCount(
    4,
  );
  await expect(recording.getByRole('list', { name: 'Checks it made' })).toContainText(
    'DELETE /users/1 → 204',
  );
  expect(ai).toEqual([]);
});

test('where the page cannot run code, the demo offers the recording, labelled, and never Play', async ({
  page,
}) => {
  await page.addInitScript(notIsolated);
  const ai = aiRequests(page);
  await watchDemo(page);

  const recording = panel(page).getByLabel('Recorded session');
  await expect(recording).toContainText('The live replay needs a browser that can run the project');
  await expect(recording).toContainText('Chrome, Edge or Arc');
  await expect(panel(page).getByRole('button', { name: 'Play the replay' })).toHaveCount(0);
  expect(ai).toEqual([]);
});

test('"Open a trace…" shows a trace of any format as a timeline, and refuses what is not one', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/p\/[a-z0-9]+$/);
  await waitForEditor(page);

  const file = panel(page).getByLabel('Trace file');
  await file.setInputFiles(`${RECORDINGS}model-busy-mid-session.json`);
  await expect(panel(page)).toContainText(
    'a recorded session, trace format 1. Nothing is running.',
  );
  await expect(panel(page).getByLabel('Trace timeline')).toContainText(
    'Busy: waited 5.4 s (the attempt’s own time was not recorded)',
  );

  await file.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a trace'),
  });
  await expect(panel(page).getByRole('alert')).toHaveText(
    'This file is not JSON, so it is not a trace.',
  );
});
