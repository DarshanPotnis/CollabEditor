/**
 * PLAN.md §10.3: an unsupported browser shows the banner and can still edit.
 *
 * The app decides from `window.crossOriginIsolated` (runtime-support.ts), so
 * the test makes the page report what an unsupported browser reports. It does
 * not strip the isolation headers instead: a document served through
 * Playwright's route.fulfill counts as public to Chrome's Local Network
 * Access checks, which then block every call to the local API server.
 */
import { expect, test } from '@playwright/test';
import { EDITOR, createProject, readEditorText, typeAtEnd } from './support.js';

test('without cross-origin isolation, Run is off, the banner explains, and editing works', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'crossOriginIsolated', { value: false });
  });

  await createProject(page);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);

  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await expect(page.getByText(/Running code needs a browser feature/)).toBeVisible();

  await typeAtEnd(page, '// still editable');
  await expect(page.locator(EDITOR)).toContainText('still editable');
  expect(await readEditorText(page)).toContain('// still editable');
});
