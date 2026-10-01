/**
 * The AI panel shares the right-hand column with the Run panel, so at common
 * laptop sizes an ended session's footer (Undo AI changes, Download trace,
 * Done, What it did) can be taller than the panel. The actions stay in view
 * (they stick to the panel's bottom edge) and the rest scrolls, the way a
 * person scrolls: with the wheel over the panel. Playwright's own clicks
 * scroll elements into view even inside a box that cannot scroll, so these
 * tests measure without clicking and scroll only with the wheel.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { startAgent } from './agent-support.js';
import { createProject } from './support.js';

const SUMMARY = 'Added DELETE /users/:id to routes/users.js.';

/** Whether `inner` lies wholly within the visible part of `outer`. */
async function within(inner: Locator, outer: Locator): Promise<boolean> {
  const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()]);
  if (a === null || b === null) return false;
  return (
    a.y >= b.y && a.y + a.height <= b.y + b.height && a.x >= b.x && a.x + a.width <= b.x + b.width
  );
}

/** Scrolls the panel with the mouse wheel until `target` is in view, or gives up. */
async function reachByWheel(page: Page, panel: Locator, target: Locator): Promise<boolean> {
  const box = await panel.boundingBox();
  if (box === null) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let turn = 0; turn < 10; turn += 1) {
    if (await within(target, panel)) return true;
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(50);
  }
  return within(target, panel);
}

/** Drags the divider between the AI and Run panels until the AI panel is about `height` tall. */
async function shrinkTo(page: Page, panel: Locator, height: number): Promise<void> {
  const divider = page.getByRole('separator', { name: 'Resize the AI and Run panels' });
  const [line, box] = await Promise.all([divider.boundingBox(), panel.boundingBox()]);
  if (line === null || box === null)
    throw new Error('The AI panel or its divider is not on screen.');
  const x = line.x + line.width / 2;
  await page.mouse.move(x, line.y + line.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + height, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeLessThan(height + 20);
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`at ${String(size.width)}×${String(size.height)}, an ended session's footer is in view or a scroll away`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await createProject(page, 'Express API');
    await startAgent(page, 'Add a DELETE /users/:id endpoint');
    await expect(page.getByText(SUMMARY)).toBeVisible();

    const panel = page.getByRole('region', { name: 'AI', exact: true });
    // A short AI panel, as after dragging the divider up: the scripted session's summary and
    // stats then fill it, as a replay's longer footer does at the default split.
    await shrinkTo(page, panel, 150);
    // The actions are in view without scrolling; the timeline below them is a scroll away.
    for (const control of [
      page.getByRole('button', { name: 'Undo AI changes' }),
      page.getByRole('button', { name: 'Download trace' }),
      page.getByRole('button', { name: 'Done', exact: true }),
    ]) {
      expect(await within(control, panel), `${String(control)} in view`).toBe(true);
    }
    expect(await reachByWheel(page, panel, page.getByText('What it did'))).toBe(true);
  });
}

test.describe('a finished "Watch a demo" replay (real WebContainer)', () => {
  test.skip(
    !process.env['RUN_WEBCONTAINER_E2E'],
    'Boots a real WebContainer over the network; set RUN_WEBCONTAINER_E2E=1 to run it.',
  );
  test.setTimeout(300_000);

  for (const size of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    test(`at ${String(size.width)}×${String(size.height)}, its footer is in view or a scroll away`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(size);
      await page.goto('/');
      await page.getByRole('button', { name: 'Watch a demo' }).click();
      await page.waitForURL(/\/p\/[a-z0-9]+$/);
      const agent = page.locator('section[aria-labelledby="agent-title"]');
      await agent.getByRole('button', { name: 'Play the replay' }).click();
      await expect(agent.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 240_000 });
      await page.screenshot({ path: testInfo.outputPath('ai-panel.png') });

      const panel = page.getByRole('region', { name: 'AI', exact: true });
      for (const control of [
        page.getByRole('button', { name: 'Undo AI changes' }),
        page.getByRole('button', { name: 'Download the recording' }),
        page.getByRole('button', { name: 'View the recorded session' }),
        page.getByRole('button', { name: 'Done', exact: true }),
      ]) {
        expect(await within(control, panel), `${String(control)} in view`).toBe(true);
      }
    });
  }
});
