import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://127.0.0.1:4173';
const API_URL = 'http://127.0.0.1:8081';

/**
 * The suite runs against the production bundle (vite preview), not the dev
 * server, because the fragile part of this app is exactly what bundling
 * produces: Monaco and its web workers.
 *
 * The API it talks to is the real Express + Hocuspocus composition with
 * in-memory storage, so the suite needs no database.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run e2e-server -w @collabcode/server',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env['CI'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    },
    {
      command: 'npm run build:e2e -w @collabcode/web && npm run preview:e2e -w @collabcode/web',
      url: WEB_URL,
      reuseExistingServer: !process.env['CI'],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 180_000,
    },
  ],
});
