/**
 * The landing page leads with the AI teammate: "Watch a demo" and its looping
 * recording come first, then starting a project, then joining one, then who
 * built it. The recording is served from this site, so it loads although the
 * page is cross-origin isolated.
 */
import { expect, test } from '@playwright/test';

test('leads with Watch a demo and its recording, then Start a project, then Join', async ({
  page,
}) => {
  await page.goto('/');
  const top = async (name: string, role: 'button' | 'heading') =>
    (await page.getByRole(role, { name, exact: true }).boundingBox())?.y ?? Number.NaN;

  const demo = await top('Watch a demo', 'button');
  const start = await top('Start a project', 'heading');
  const join = await top('Join', 'button');
  expect(demo).toBeLessThan(start);
  expect(start).toBeLessThan(join);

  const recording = page.getByRole('img', { name: /A replay of the AI teammate/ });
  await expect(recording).toBeVisible();
  await expect
    .poll(() => recording.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});

test('says how it is measured, without a pass rate, and who built it', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Measured by a 21-task eval suite' }),
  ).toHaveAttribute('href', 'https://github.com/DarshanPotnis/CollabEditor/tree/main/docs/evals');
  await expect(page.locator('main')).not.toContainText('%');

  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('Built by Darshan Potnis');
  for (const [name, href] of [
    ['GitHub', 'https://github.com/DarshanPotnis/CollabEditor'],
    ['Portfolio', 'https://darshan-portfolio-fawn.vercel.app'],
    ['LinkedIn', 'https://www.linkedin.com/in/darshan-potnis-9304a3218'],
  ] as const) {
    const link = footer.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});
