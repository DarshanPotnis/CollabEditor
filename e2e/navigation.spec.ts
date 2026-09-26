import { expect, test } from '@playwright/test';
import { createProject, waitForEditor } from './support.js';

test('creating a project from a template opens it with the template content', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Express API', exact: false }).click();
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/\/p\/[a-z0-9]+$/);
  await waitForEditor(page);
  await expect(page.locator('.view-lines')).toContainText('A small Express API');
  await expect(page.getByText('index.js')).toBeVisible();
});

test('an unknown project link shows the not-found page', async ({ page }) => {
  await page.goto('/p/zzzzzzzzzzzz');
  await expect(page.getByRole('heading', { name: /no project at this link/i })).toBeVisible();
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
});

test('an old /room/ link redirects to the project', async ({ page }) => {
  const projectId = await createProject(page);

  await page.goto(`/room/${projectId}`);
  await expect(page).toHaveURL(`/p/${projectId}`);
  await waitForEditor(page);
});

test('joining by pasted link works', async ({ page, browser }) => {
  const projectId = await createProject(page);

  const context = await browser.newContext();
  const joiner = await context.newPage();
  await joiner.goto('/');
  await joiner.getByLabel('Project link or ID').fill(`http://127.0.0.1:4173/p/${projectId}`);
  await joiner.getByRole('button', { name: 'Join' }).click();

  await expect(joiner).toHaveURL(`/p/${projectId}`);
  await waitForEditor(joiner);
  await context.close();
});

test('joining with nonsense is rejected without leaving the page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Project link or ID').fill('come join my project');
  await page.getByRole('button', { name: 'Join' }).click();

  await expect(page.getByText(/does not look like a project link/i)).toBeVisible();
  await expect(page).toHaveURL('/');
});
