/**
 * The Phase 2 definition of done (PLAN.md §9.5), in two browsers. Concurrent
 * cases take one window offline so that neither side can see the other's
 * write before making its own, which is what write-time checks cannot cover.
 */
import { expect, test } from '@playwright/test';
import {
  EDITOR,
  createRootFile,
  createRootFolder,
  openPair,
  readEditorText,
  setDisplayName,
  treeItem,
  treePaths,
  treeRow,
  typeAtEnd,
} from './support.js';

test.describe('multi-file workspace', () => {
  test('two people edit different files and see each other in the tree', async ({ browser }) => {
    const { a, b } = await openPair(browser, 'Express API');
    await setDisplayName(a, 'Ada');
    await setDisplayName(b, 'Bob');

    await treeRow(a, 'routes').click();
    await treeItem(a, 'users.js').click();
    await expect(a.getByRole('tab', { name: 'users.js', selected: true })).toBeVisible();

    await Promise.all([typeAtEnd(a, '// from ada'), typeAtEnd(b, '// from bob')]);

    await expect(treeItem(a, 'index.js')).toContainText('Open by Bob');
    await treeRow(b, 'routes').click();
    await expect(treeItem(b, 'users.js')).toContainText('Open by Ada');

    await b.getByRole('treeitem', { name: 'users.js' }).click();
    await expect(b.locator(EDITOR)).toContainText('// from ada');
    await a.getByRole('tab', { name: 'users.js' }).click();
    await treeItem(a, 'index.js').click();
    await expect(a.locator(EDITOR)).toContainText('// from bob');
  });

  test('renaming a file someone is typing in keeps their edits and cursor', async ({ browser }) => {
    const { a, b } = await openPair(browser);
    await typeAtEnd(b, 'typed-before ');

    await treeItem(a, 'index.js').click();
    await a.keyboard.press('F2');
    await a.keyboard.type('server');
    await a.keyboard.press('Enter');

    await expect(b.getByRole('tab', { name: 'server.js', selected: true })).toBeVisible();
    await expect(treeItem(b, 'server.js')).toBeVisible();
    await b.keyboard.type('typed-after');

    for (const page of [a, b]) {
      await expect.poll(() => readEditorText(page)).toContain('typed-before typed-after');
    }
    await expect(a.locator('.yRemoteSelectionHead')).toHaveCount(1);
  });

  test('a file deleted while someone has it open can be restored by them', async ({ browser }) => {
    const { a, b } = await openPair(browser);
    await setDisplayName(a, 'Ada');

    await treeItem(a, 'index.js').click();
    await a.keyboard.press('Delete');
    await expect(a.getByRole('button', { name: 'Undo' })).toBeVisible();

    await expect(
      b.getByText('Deleted by Ada. It is read-only until it is restored.'),
    ).toBeVisible();
    await expect(treeItem(b, 'index.js')).toHaveCount(0);
    await b.locator(EDITOR).click();
    await b.keyboard.type('ignored');
    expect(await readEditorText(b)).not.toContain('ignored');

    await b.getByRole('button', { name: 'Restore' }).click();
    await expect(treeItem(a, 'index.js')).toBeVisible();
    await typeAtEnd(b, 'after-restore');
    await expect.poll(() => readEditorText(a)).toContain('after-restore');
  });

  test('a file deleted forever while open leaves a tab that closes cleanly', async ({
    browser,
  }) => {
    const { a, b } = await openPair(browser);
    const errors: string[] = [];
    b.on('pageerror', (error) => errors.push(error.message));

    await treeItem(a, 'index.js').click();
    await a.keyboard.press('Delete');
    await a.getByRole('button', { name: /Recently deleted/ }).click();
    await a.getByRole('button', { name: 'Delete forever index.js' }).click();
    await expect(a.getByRole('dialog')).toContainText("can't be undone, for anyone");
    await a.getByRole('dialog').getByRole('button', { name: 'Delete forever' }).click();

    await expect(b.getByText(/permanently deleted, so it can't be restored/)).toBeVisible();
    await b.getByRole('button', { name: 'Close tab' }).click();
    await expect(b.getByRole('tab')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('creating a name a sibling already has is refused, including by case', async ({
    browser,
  }) => {
    const { a } = await openPair(browser);

    await a.getByRole('button', { name: 'New file' }).click();
    const input = a.getByRole('textbox', { name: 'Name for the new file' });
    await input.fill('index.js');
    await a.keyboard.press('Enter');
    await expect(a.locator('#inline-name-error')).toHaveText(
      'A file named "index.js" already exists in the project root.',
    );

    await input.fill('INDEX.js');
    await a.keyboard.press('Enter');
    await expect(a.locator('#inline-name-error')).toContainText('capitalisation');
    await a.keyboard.press('Escape');
    await expect(treeRow(a, 'INDEX.js')).toHaveCount(0);
  });

  test('two people creating utils.js at the same moment both keep their file', async ({
    browser,
  }) => {
    const { a, b, bContext } = await openPair(browser);

    await bContext.setOffline(true);
    await expect(b.getByRole('status')).toContainText(/offline|reconnecting/i);
    await createRootFile(a, 'utils.js');
    await typeAtEnd(a, '// ada');
    await createRootFile(b, 'utils.js');
    await typeAtEnd(b, '// bob');
    await bContext.setOffline(false);

    const expected = ['index.js', 'package.json', 'utils (2).js', 'utils.js'];
    await expect.poll(() => treePaths(a)).toEqual(expected);
    await expect.poll(() => treePaths(b)).toEqual(expected);

    // Identically on both screens: the same file carries the suffix for both.
    // Monaco marks the model it shows with data-uri; waiting for it, rather
    // than for the tab, avoids reading the previous file's text. It paints the
    // lines a frame later, so then wait for them too (both files have text).
    // URI.file encodes parentheses too (see model-uri.test.ts).
    const uris: Record<string, string> = {
      'utils.js': 'file:///utils.js',
      'utils (2).js': 'file:///utils%20%282%29.js',
    };
    const contentOf = async (page: typeof a, name: string): Promise<string> => {
      await treeRow(page, name).click();
      await expect(page.locator('.monaco-editor').first()).toHaveAttribute(
        'data-uri',
        uris[name] ?? '',
      );
      await expect.poll(() => readEditorText(page)).not.toBe('');
      return readEditorText(page);
    };
    const plainOnA = await contentOf(a, 'utils.js');
    const suffixedOnA = await contentOf(a, 'utils (2).js');
    expect([plainOnA, suffixedOnA].sort()).toEqual(['// ada', '// bob']);
    await expect.poll(() => contentOf(b, 'utils.js')).toBe(plainOnA);
    await expect.poll(() => contentOf(b, 'utils (2).js')).toBe(suffixedOnA);
  });

  test('moving two folders into each other at once gives both the same tree', async ({
    browser,
  }) => {
    const { a, b, bContext } = await openPair(browser);
    await createRootFolder(a, 'X');
    await createRootFolder(a, 'Y');
    await expect(treeRow(b, 'Y')).toBeVisible();

    await bContext.setOffline(true);
    await expect(b.getByRole('status')).toContainText(/offline|reconnecting/i);
    await treeRow(a, 'X').dragTo(treeRow(a, 'Y'));
    await treeRow(b, 'Y').dragTo(treeRow(b, 'X'));
    await bContext.setOffline(false);

    const notice = /“X” and “Y” were moved into each other at the same time/;
    await expect(a.getByText(notice)).toBeVisible();
    await expect(b.getByText(notice)).toBeVisible();
    for (const page of [a, b]) {
      const x = treeRow(page, 'X');
      await expect(x).toHaveAttribute('aria-level', '1');
      if ((await x.getAttribute('aria-expanded')) === 'false') await x.click();
      await expect(treeRow(page, 'X/Y')).toHaveAttribute('aria-level', '2');
    }
  });
});
