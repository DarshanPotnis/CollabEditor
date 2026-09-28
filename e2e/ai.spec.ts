/**
 * The AI helpers end to end, against the e2e server's scripted model
 * (apps/server/src/test/e2e-model-script.ts): no network, no real model and
 * no quota. The markers below must match that script.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  EDITOR,
  MOD,
  createProject,
  openPair,
  readEditorText,
  replaceEditorText,
} from './support.js';

/** Appended by the scripted model to the first line of the code it edits. */
const EDIT_MARK = '// edited by AI';
/** Code containing this gets a slowly streaming answer. */
const SLOW_MARKER = 'e2e-slow-answer';
/** An own key the scripted provider refuses. */
const REFUSED_KEY = 'sk-e2e-refused-0000';
const EXPLANATION = 'This code is explained by the fake model.';

const CODE = ['const a = 1;', 'const b = 2;', 'console.log(a + b);'].join('\n');

/** Selects the text of one line (1-based). */
async function selectLine(page: Page, line: number): Promise<void> {
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+Home`);
  for (let at = 1; at < line; at += 1) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

/**
 * Right-clicks a line near its start, inside the selection selectLine made,
 * and picks an item from the editor's context menu. The line is found by its
 * text: Monaco redraws its layers constantly (a collaborator's cursor is
 * enough), and a locator click re-finds an element that was replaced.
 *
 * Monaco ignores mouse clicks on a menu for its first 100 ms, against
 * accidental picks, and a test clicks sooner than that; hovering focuses the
 * item and Enter chooses it, as it would for someone using the keyboard.
 */
async function chooseFromMenu(page: Page, lineText: string, label: string): Promise<void> {
  await page
    .locator('.view-line', { hasText: lineText })
    .click({ button: 'right', position: { x: 8, y: 6 } });
  const item = page.getByRole('menuitem', { name: label });
  await item.hover();
  await expect(item).toBeFocused();
  await page.keyboard.press('Enter');
}

async function acceptPrivacyNotice(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Before you use AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function askForEdit(page: Page, lineText: string, instruction: string): Promise<void> {
  await chooseFromMenu(page, lineText, 'Edit with AI…');
  await page.getByRole('dialog').getByRole('textbox').fill(instruction);
  await page.keyboard.press('Enter');
}

const review = (page: Page) => page.getByRole('region', { name: 'AI edit to review' });

test('Explain: the privacy notice comes first, then the answer streams in', async ({ page }) => {
  await createProject(page);
  await replaceEditorText(page, CODE);
  await selectLine(page, 3);
  await chooseFromMenu(page, 'console.log(a + b);', 'Explain with AI');

  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await acceptPrivacyNotice(page);
  await expect(page.getByText(EXPLANATION)).toBeVisible();
  await expect(page.getByText('Answer complete.')).toBeVisible();
  await expect(page.getByText(/free requests left today/)).toBeVisible();

  // Accepted once, the notice does not come back.
  await page.getByRole('button', { name: 'Clear' }).click();
  await selectLine(page, 1);
  await chooseFromMenu(page, 'const a = 1;', 'Explain with AI');
  await expect(page.getByText(EXPLANATION)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Before you use AI' })).toHaveCount(0);
});

test('Edit with AI: review, apply for everyone, and one undo takes it back', async ({
  browser,
}) => {
  const { a, b } = await openPair(browser);
  await replaceEditorText(a, CODE);
  await expect.poll(() => readEditorText(b)).toContain('console.log(a + b);');

  await selectLine(a, 3);
  await askForEdit(a, 'console.log(a + b);', 'Add a comment.');
  await acceptPrivacyNotice(a);
  await expect(review(a)).toBeVisible();
  await expect(a.getByText(/ready to review over the editor/)).toBeVisible();
  expect(await readEditorText(b)).not.toContain(EDIT_MARK);

  await review(a).getByRole('button', { name: 'Apply' }).click();
  await expect(review(a)).toHaveCount(0);
  for (const page of [a, b]) {
    await expect.poll(() => readEditorText(page)).toContain(`console.log(a + b); ${EDIT_MARK}`);
  }

  await a.keyboard.press(`${MOD}+z`);
  for (const page of [a, b]) {
    await expect.poll(() => readEditorText(page)).not.toContain(EDIT_MARK);
    expect(await readEditorText(page)).toContain('console.log(a + b);');
  }
});

test("a stale edit is refused, and the collaborator's change is kept", async ({ browser }) => {
  const { a, b } = await openPair(browser);
  await replaceEditorText(a, CODE);
  await expect.poll(() => readEditorText(b)).toContain('console.log(a + b);');

  await selectLine(a, 3);
  await askForEdit(a, 'console.log(a + b);', 'Add a comment.');
  await acceptPrivacyNotice(a);
  await expect(review(a)).toBeVisible();

  // B edits inside the selected code while A is reviewing.
  await selectLine(b, 3);
  await b.keyboard.press('Home');
  await b.keyboard.press('ArrowRight');
  await b.keyboard.type('X');
  await expect.poll(() => readEditorText(a)).toContain('cXonsole.log');

  await review(a).getByRole('button', { name: 'Apply' }).click();
  await expect(review(a).getByRole('alert')).toContainText('The selected code changed');
  await expect(review(a).getByRole('button', { name: 'Apply' })).toBeDisabled();
  expect(await readEditorText(b)).not.toContain(EDIT_MARK);

  await review(a).getByRole('button', { name: 'Discard' }).click();
  await expect(review(a)).toHaveCount(0);
  expect(await readEditorText(a)).toContain('cXonsole.log(a + b);');
});

test('the editor context menu still opens after an AI diff was shown and closed', async ({
  page,
}) => {
  await createProject(page);
  await replaceEditorText(page, CODE);

  // Closing a Monaco diff editor used to leave every context menu unable to open.
  await selectLine(page, 3);
  await askForEdit(page, 'console.log(a + b);', 'Add a comment.');
  await acceptPrivacyNotice(page);
  await expect(review(page)).toBeVisible();
  await review(page).getByRole('button', { name: 'Discard' }).click();
  await expect(review(page)).toHaveCount(0);

  await selectLine(page, 2);
  await askForEdit(page, 'const b = 2;', 'Add a comment.');
  await expect(review(page)).toBeVisible();
  await review(page).getByRole('button', { name: 'Apply' }).click();
  await expect(review(page)).toHaveCount(0);

  await selectLine(page, 1);
  await chooseFromMenu(page, 'const a = 1;', 'Explain with AI');
  await expect(page.getByText(EXPLANATION)).toBeVisible();
});

test('Stop keeps what arrived and offers Try again', async ({ page }) => {
  await createProject(page);
  await replaceEditorText(page, `// ${SLOW_MARKER}\n${CODE}`);
  await selectLine(page, 1);
  await chooseFromMenu(page, SLOW_MARKER, 'Explain with AI');
  await acceptPrivacyNotice(page);

  await expect(page.getByText(/Part 1\./)).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText(/Part 60\./)).toHaveCount(0);
});

test('an own key the provider refuses says so and points to the settings', async ({ page }) => {
  await createProject(page);
  await replaceEditorText(page, CODE);
  await page.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: 'AI settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('Provider').selectOption('gemini');
  await settings.getByLabel('API key').fill(REFUSED_KEY);
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your Google Gemini key · gemini-3.5-flash-lite')).toBeVisible();

  await selectLine(page, 1);
  await chooseFromMenu(page, 'const a = 1;', 'Explain with AI');
  await acceptPrivacyNotice(page);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Google Gemini refused your key' }),
  ).toHaveText('Google Gemini refused your key. Check it in AI settings.');
  await page.getByRole('button', { name: 'Check your key' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
