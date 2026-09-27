import { expect, test } from '@playwright/test';
import { EDITOR, openPair, setDisplayName } from './support.js';

test("clicking a collaborator's avatar opens their file and shows their cursor", async ({
  browser,
}) => {
  const { a, b } = await openPair(browser);
  await setDisplayName(a, 'Ada');

  // A long file of A's own, so B can only see A's cursor if the editor
  // actually scrolls to it (Monaco renders only the visible lines).
  await a.getByRole('button', { name: 'New file' }).click();
  await a.getByRole('textbox', { name: 'Name for the new file' }).fill('long.js');
  await a.keyboard.press('Enter');
  await a.locator(EDITOR).click();
  await a.keyboard.type(`${'\n'.repeat(80)}// ada-was-here`);

  await expect(b.getByRole('tab', { name: 'long.js' })).toHaveCount(0);
  await b.getByRole('button', { name: /^Ada, in long\.js/ }).click();

  await expect(b.getByRole('tab', { name: 'long.js', selected: true })).toBeVisible();
  await expect(b.locator(EDITOR)).toContainText('ada-was-here');
  await expect(b.locator('.yRemoteSelectionHead')).toHaveCount(1);
});
