import { expect, test } from '@playwright/test';
import { openPair, typeAtEnd } from './support.js';

const REMOTE_CURSOR = '.yRemoteSelectionHead';

test.describe('tabs and cursors', () => {
  test('closing a background tab keeps my cursor visible to collaborators', async ({ browser }) => {
    const { a, b } = await openPair(browser);

    await a.getByRole('button', { name: 'New file' }).click();
    await a.getByRole('textbox', { name: 'Name for the new file' }).fill('other.js');
    await a.keyboard.press('Enter');
    await expect(a.getByRole('tab', { name: 'other.js' })).toBeVisible();

    await a.getByRole('tab', { name: 'index.js' }).click();
    await typeAtEnd(a, 'x');
    await expect(b.locator(REMOTE_CURSOR)).toHaveCount(1);

    // Destroying the background tab's binding must not clear awareness.
    await a.getByRole('tab', { name: 'other.js' }).click({ button: 'middle' });
    await expect(a.getByRole('tab', { name: 'other.js' })).toHaveCount(0);
    await typeAtEnd(a, 'y');
    await expect(b.locator(REMOTE_CURSOR)).toHaveCount(1);
  });

  test('switching files moves my cursor out of the file others are in', async ({ browser }) => {
    const { a, b } = await openPair(browser);
    await typeAtEnd(a, 'x');
    await expect(b.locator(REMOTE_CURSOR)).toHaveCount(1);

    await a.getByRole('treeitem', { name: 'package.json' }).click();
    await expect(b.locator(REMOTE_CURSOR)).toHaveCount(0);
  });
});
