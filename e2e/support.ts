/**
 * Helpers for driving Monaco from a test.
 *
 * Monaco renders only the visible lines, absolutely positioned, so reading its
 * text means collecting `.view-line` elements and sorting them by offset rather
 * than trusting DOM order.
 */
import { expect, type Locator, type Page } from '@playwright/test';

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
