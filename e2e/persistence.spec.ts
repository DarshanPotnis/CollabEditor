import { expect, test } from '@playwright/test';
import { createProject, focusStartOfDocument, waitForEditor } from './support.js';

test('a reload shows what you typed, from the server', async ({ page }) => {
  const projectId = await createProject(page);

  await focusStartOfDocument(page);
  await page.keyboard.type('// survives a reload\n');
  await expect(page.locator('.view-lines')).toContainText('survives a reload');

  // Long enough for the debounced store (2s) to have run at least once.
  await page.waitForTimeout(3_000);
  await page.reload();
  await waitForEditor(page);

  await expect(page.locator('.view-lines')).toContainText('survives a reload');
  expect(new URL(page.url()).pathname).toBe(`/p/${projectId}`);
});

test('closing the tab right after typing does not lose the edit', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const projectId = await createProject(page);

  await focusStartOfDocument(page);
  await page.keyboard.type('// typed then closed');
  await expect(page.locator('.view-lines')).toContainText('typed then closed');

  // No pause: close the tab immediately, as someone would.
  await context.close();

  const second = await browser.newContext();
  const reopened = await second.newPage();
  await reopened.goto(`/p/${projectId}`);
  await waitForEditor(reopened);
  await expect(reopened.locator('.view-lines')).toContainText('typed then closed');
  await second.close();
});
