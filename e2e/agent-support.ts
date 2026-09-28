/**
 * Helpers for driving the AI teammate's panel from a test. The goals the
 * scripted model reacts to are in apps/server/src/test/e2e-model-script.ts.
 */
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

/** Types the goal, starts the session, and accepts the privacy notice on first use. */
export async function startAgent(page: Page, goal: string): Promise<void> {
  await page.getByLabel('What should the AI teammate do?').fill(goal);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Before you use AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Clicks Download trace on an ended session and returns the file's text. */
export async function downloadTrace(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download trace' }).click();
  return readFile(await (await download).path(), 'utf8');
}

export type TraceToolCall = { toolName: string; isError: boolean; output: string };

/** Every tool call in a downloaded trace, in order. */
export function traceToolCalls(text: string): TraceToolCall[] {
  const trace = JSON.parse(text) as { steps: Array<{ toolCalls: TraceToolCall[] }> };
  return trace.steps.flatMap((step) => step.toolCalls);
}
