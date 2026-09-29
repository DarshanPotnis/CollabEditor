/**
 * Helpers for driving Monaco from a test.
 *
 * Monaco renders only the visible lines, absolutely positioned, so reading its
 * text means collecting `.view-line` elements and sorting them by offset rather
 * than trusting DOM order.
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

export const EDITOR = '.monaco-editor .view-lines';

export async function createProject(page: Page, template = 'Blank Node'): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: template, exact: false }).first().click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/p\/[a-z0-9]+$/);
  await waitForEditor(page);
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

export function editor(page: Page): Locator {
  return page.locator(EDITOR);
}

/** Waits until the document has synced and Monaco has rendered its content. */
export async function waitForEditor(page: Page): Promise<void> {
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await expect(page.locator('.view-line').first()).not.toBeEmpty();
}

export async function readEditorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll<HTMLElement>('.view-line'));
    return lines
      .map((line) => ({
        top: Number.parseFloat(line.style.top || '0'),
        text: line.textContent ?? '',
      }))
      .sort((a, b) => a.top - b.top)
      .map((line) => line.text.replaceAll(' ', ' '))
      .join('\n');
  });
}

/** Puts the caret at the start of the first line, on any platform. */
export async function focusStartOfDocument(page: Page): Promise<void> {
  await page.locator('.view-line').first().click();
  await page.keyboard.press('Home');
}

export async function setDisplayName(page: Page, name: string): Promise<void> {
  const field = page.getByLabel('Your display name');
  await field.fill(name);
  await field.blur();
}

export type Pair = { a: Page; b: Page; aContext: BrowserContext; bContext: BrowserContext };

/** Two people in one fresh project, both with the editor ready. */
export async function openPair(browser: Browser, template = 'Blank Node'): Promise<Pair> {
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  const a = await aContext.newPage();
  const b = await bContext.newPage();
  const projectId = await createProject(a, template);
  await b.goto(`/p/${projectId}`);
  await waitForEditor(b);
  return { a, b, aContext, bContext };
}

/** Clicks into the editor and types at the very end of the document. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator(EDITOR).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

/**
 * The app's Ctrl/Cmd shortcuts follow the page's user agent, and Playwright's
 * Desktop Chrome profile reports Windows even on a Mac host, so the page
 * expects Ctrl everywhere. ControlOrMeta would send Cmd on a Mac and miss.
 */
export const MOD = 'Control';

/** Runs a command from the editor's command palette (F1) by its exact label. */
export async function runPaletteCommand(page: Page, label: string): Promise<void> {
  await page.locator(EDITOR).click();
  await page.keyboard.press('F1');
  await page.keyboard.type(label);
  await page.locator('.quick-input-list').getByRole('option', { name: label, exact: true }).click();
}

/**
 * A file tree row by (part of) its accessible name. The name also carries
 * presence ("index.js Open by Ada"), so use treeRow for an exact match.
 */
export function treeItem(page: Page, name: string): Locator {
  return page.getByRole('tree').getByRole('treeitem', { name });
}

/** The file tree row at exactly this path (rows carry their path as a title). */
export function treeRow(page: Page, path: string): Locator {
  return page.getByRole('tree').locator(`[role="treeitem"][title="${path}"]`);
}

/** Creates a file at the project root from the Files header, and waits for it. */
export async function createRootFile(page: Page, name: string): Promise<void> {
  await page.getByRole('tree').click({ button: 'right', position: { x: 40, y: 400 } });
  await page.getByRole('menuitem', { name: 'New file' }).click();
  await page.getByRole('textbox', { name: 'Name for the new file' }).fill(name);
  await page.keyboard.press('Enter');
}

/** Creates a folder at the project root. */
export async function createRootFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('tree').click({ button: 'right', position: { x: 40, y: 400 } });
  await page.getByRole('menuitem', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Name for the new folder' }).fill(name);
  await page.keyboard.press('Enter');
}

/** Every visible tree row's path (rows carry their path as a title), sorted. */
export async function treePaths(page: Page): Promise<string[]> {
  const titles = await page
    .getByRole('tree')
    .getByRole('treeitem')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('title') ?? ''));
  return titles.sort();
}

/** Replaces the open file's whole content, bypassing auto-closing brackets. */
export async function replaceEditorText(page: Page, text: string): Promise<void> {
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

/** Clicks Run and waits until the project's server is listening. */
export async function runProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText('Server running', {
    timeout: 120_000,
  });
}

/** Sends a request from the API console and returns the result's text. */
export async function sendFromApiConsole(
  page: Page,
  method: string,
  path: string,
  body = '',
): Promise<string> {
  await page.getByRole('tab', { name: 'API' }).click();
  const form = page.getByRole('form', { name: 'Request' });
  await form.getByLabel('Method').selectOption(method);
  await form.getByLabel('Path').fill(path);
  if (body !== '') await form.getByLabel('Body').fill(body);
  // A new history entry is the reliable sign that this send finished.
  const history = page.getByText(/^History \(\d+\)$/);
  const before =
    (await history.count()) === 0
      ? 0
      : Number(/\d+/.exec((await history.textContent()) ?? '')?.[0]);
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(`History (${String(before + 1)})`)).toBeVisible({ timeout: 45_000 });
  return (await page.getByLabel('API result').textContent()) ?? '';
}
