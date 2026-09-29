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
import { downloadTrace, startAgent, traceToolCalls } from './agent-support.js';
import { EDITOR, createProject, readEditorText, typeAtEnd } from './support.js';

const notIsolated = (): void => {
  Object.defineProperty(window, 'crossOriginIsolated', { value: false });
};

test('without cross-origin isolation, Run is off, the banner explains, and editing works', async ({
  page,
}) => {
  await page.addInitScript(notIsolated);

  await createProject(page);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);

  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await expect(page.getByText(/loaded without the headers that turn it on/)).toBeVisible();

  await typeAtEnd(page, '// still editable');
  await expect(page.locator(EDITOR)).toContainText('still editable');
  expect(await readEditorText(page)).toContain('// still editable');
});

test('the AI teammate is told there is no sandbox, and every run tool says the same', async ({
  page,
}) => {
  await page.addInitScript(notIsolated);
  await createProject(page, 'Express API');
  // Scripted: edit, run_project, http_request, then finish with what the request answered.
  await startAgent(page, 'Add DELETE e2e-run-agent');
  await expect(page.getByText('DELETE /users/1 answered nothing.')).toBeVisible();

  // It knew before its first step, so nothing tried to boot.
  const text = await downloadTrace(page);
  expect((JSON.parse(text) as { inputs: { sandbox?: string } }).inputs.sandbox).toBe('unavailable');
  await expect(page.getByRole('status', { name: 'Run status' })).not.toContainText('failed');
  const calls = traceToolCalls(text);
  const run = calls.find((call) => call.toolName === 'run_project');
  const request = calls.find((call) => call.toolName === 'http_request');
  expect(run).toMatchObject({ isError: true });
  expect(run?.output).toMatch(/^The sandbox isn't available in this session/);
  expect(run?.output).toContain('loaded without the headers that turn it on');
  expect(run?.output).not.toMatch(/cookie/i);
  expect(request && { isError: request.isError, output: request.output }).toEqual({
    isError: true,
    output: run?.output,
  });
});
