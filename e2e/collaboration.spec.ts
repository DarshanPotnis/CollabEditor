import { expect, test } from '@playwright/test';
import {
  createProject,
  focusStartOfDocument,
  readEditorText,
  setDisplayName,
  waitForEditor,
} from './support.js';

test.describe('two people in one project', () => {
  test('concurrent edits at the same position both survive', async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const pageA = await first.newPage();
    const pageB = await second.newPage();

    const projectId = await createProject(pageA);
    await pageB.goto(`/p/${projectId}`);
    await waitForEditor(pageB);

    // Both carets sit at the very start of the document.
    await focusStartOfDocument(pageA);
    await focusStartOfDocument(pageB);

    // Markers that do not occur in the template, so they can be counted.
    await Promise.all([pageA.keyboard.type('@@@@'), pageB.keyboard.type('####')]);

    // Convergence first: the same text on both screens, not merely "nothing
    // crashed".
    await expect
      .poll(async () => (await readEditorText(pageA)) === (await readEditorText(pageB)), {
        message: 'the two clients should converge on identical text',
      })
      .toBe(true);

    // Then: nothing was lost. Typing at the same position at the same moment
    // interleaves the characters (BBAABBAA, not AAAABBBB) — that is the CRDT
    // merging both intents rather than one client overwriting the other, so
    // count the characters instead of expecting contiguous runs.
    const converged = await readEditorText(pageA);
    const occurrences = (text: string, marker: string): number =>
      Array.from(text).filter((character) => character === marker).length;

    expect(occurrences(converged, '@')).toBe(4);
    expect(occurrences(converged, '#')).toBe(4);
    expect(converged).toContain('A blank Node.js project');

    await first.close();
    await second.close();
  });

  test('a late joiner sees what was already written', async ({ browser }) => {
    const first = await browser.newContext();
    const pageA = await first.newPage();

    const projectId = await createProject(pageA);
    await focusStartOfDocument(pageA);
    await pageA.keyboard.type('// written before you arrived\n');
    await expect(pageA.locator('.view-lines')).toContainText('written before you arrived');

    const second = await browser.newContext();
    const pageB = await second.newPage();
    await pageB.goto(`/p/${projectId}`);
    await waitForEditor(pageB);

    await expect(pageB.locator('.view-lines')).toContainText('written before you arrived');

    await first.close();
    await second.close();
  });

  test('edits made while offline merge on reconnect', async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const pageA = await first.newPage();
    const pageB = await second.newPage();

    const projectId = await createProject(pageA);
    await pageB.goto(`/p/${projectId}`);
    await waitForEditor(pageB);

    await second.setOffline(true);
    await expect(pageB.getByRole('status')).toContainText(/offline|reconnecting/i);

    await focusStartOfDocument(pageA);
    await pageA.keyboard.type('online-edit ');
    await focusStartOfDocument(pageB);
    await pageB.keyboard.type('offline-edit ');

    // The offline window cannot have seen the other edit yet.
    await expect(pageB.locator('.view-lines')).not.toContainText('online-edit');

    await second.setOffline(false);

    await expect(pageB.locator('.view-lines')).toContainText('online-edit');
    await expect(pageA.locator('.view-lines')).toContainText('offline-edit');
    await expect
      .poll(async () => (await readEditorText(pageA)) === (await readEditorText(pageB)))
      .toBe(true);

    await first.close();
    await second.close();
  });
});

test.describe('presence', () => {
  test('a named, coloured cursor appears and leaves with its owner', async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const pageA = await first.newPage();
    const pageB = await second.newPage();

    const projectId = await createProject(pageA);
    await pageB.goto(`/p/${projectId}`);
    await waitForEditor(pageB);

    await setDisplayName(pageB, 'Grace');
    await expect(pageA.getByLabel('Grace')).toBeVisible();
    await expect(pageA.getByText('2 people here')).toBeVisible();

    // A remote selection only renders once the other caret exists.
    await focusStartOfDocument(pageB);
    await pageB.keyboard.type('hello from Grace');

    const remoteCaret = pageA.locator('[class*="yRemoteSelectionHead-"]');
    await expect(remoteCaret.first()).toBeVisible();

    // A <style> element has no rendered text, so read its contents directly.
    await expect
      .poll(
        async () =>
          pageA
            .locator('style[data-collabcode="remote-cursors"]')
            .evaluate((element) => element.textContent ?? ''),
        { message: 'the injected cursor CSS should label the caret' },
      )
      .toContain('content: "Grace"');

    await second.close();

    // Awareness removal cleans up both the avatar and the caret.
    await expect(pageA.getByText('Just you')).toBeVisible();
    await expect(remoteCaret).toHaveCount(0);

    await first.close();
  });
});
