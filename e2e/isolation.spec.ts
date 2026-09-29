/**
 * Cross-origin isolation (PLAN.md §10.1). The whole suite runs against a
 * `vite preview` build served with the production headers, so every other spec
 * also proves the app still works isolated; this one checks the isolation
 * itself, and that Monaco's workers survive it.
 */
import { expect, test } from '@playwright/test';
import { EDITOR, createProject, createRootFile } from './support.js';

const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

test('the app is cross-origin isolated, so SharedArrayBuffer is available', async ({ page }) => {
  await createProject(page);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
});

test('the page and the Monaco worker scripts are served with the isolation headers', async ({
  page,
}) => {
  await createProject(page);

  const root = await page.request.get('/');
  expect(root.headers()).toMatchObject(ISOLATION);

  // Monaco starts its workers shortly after the editor appears.
  const workerUrls = (): Promise<string[]> =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('.worker')),
    );
  await expect.poll(async () => (await workerUrls()).length).toBeGreaterThan(0);
  const workers = await workerUrls();
  for (const url of workers) {
    expect((await page.request.get(url)).headers()).toMatchObject(ISOLATION);
  }
});

test('Monaco workers still run under isolation: invalid JSON is underlined', async ({ page }) => {
  // If a worker cannot start, Monaco quietly runs its code on the main thread
  // and logs a warning, so the underline alone would not prove anything.
  const workerWarnings: string[] = [];
  page.on('console', (message) => {
    if (/web worker/i.test(message.text())) workerWarnings.push(message.text());
  });

  await createProject(page);
  await createRootFile(page, 'broken.json');
  await page.locator(EDITOR).click();
  await page.keyboard.type('{ "a": ');

  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible();
  const loaded = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  );
  expect(loaded.some((name) => name.includes('json.worker'))).toBe(true);
  expect(workerWarnings).toEqual([]);
});
