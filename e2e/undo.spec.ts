import { expect, test } from '@playwright/test';
import { EDITOR, MOD, openPair, readEditorText, typeAtEnd } from './support.js';

test.describe('undo is per person', () => {
  test("undo removes only your own typing, never a collaborator's", async ({ browser }) => {
    const { a, b } = await openPair(browser);

    await typeAtEnd(a, 'AAA');
    await expect.poll(() => readEditorText(b)).toContain('AAA');
    await typeAtEnd(b, 'BBB');
    await expect.poll(() => readEditorText(a)).toContain('BBB');

    await a.locator(EDITOR).click();
    await a.keyboard.press(`${MOD}+z`);

    for (const page of [a, b]) {
      await expect.poll(() => readEditorText(page)).not.toContain('AAA');
      expect(await readEditorText(page)).toContain('BBB');
    }

    await a.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(() => readEditorText(b)).toContain('AAA');
  });

  test('undo history survives the file being renamed by someone else', async ({ browser }) => {
    const { a, b } = await openPair(browser);
    await typeAtEnd(b, 'before-rename ');

    await a.getByRole('treeitem', { name: 'index.js' }).click();
    await a.keyboard.press('F2');
    await a.keyboard.type('server');
    await a.keyboard.press('Enter');
    await expect(b.getByRole('tab', { name: 'server.js' })).toBeVisible();

    // B's editor keeps focus through the rename, and typing continues.
    await b.keyboard.type('after-rename');
    await expect.poll(() => readEditorText(a)).toContain('before-rename after-rename');

    await b.keyboard.press(`${MOD}+z`);
    await expect.poll(() => readEditorText(a)).not.toContain('after-rename');
    await b.keyboard.press(`${MOD}+z`);
    await expect.poll(() => readEditorText(a)).not.toContain('before-rename');
  });
});
