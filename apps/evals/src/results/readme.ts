/**
 * The README's eval table: the latest recorded run for each model, from
 * docs/evals/results/*.json, written between the README's evals markers
 * (npm run evals:readme). Generated, so it cannot drift from the results.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResultsSchema, summarize, type RunResults } from './run-results.js';

export const RESULTS_DIR = fileURLToPath(
  new URL('../../../../docs/evals/results/', import.meta.url),
);
const README = fileURLToPath(new URL('../../../../README.md', import.meta.url));
export const README_START = '<!-- evals:start -->';
export const README_END = '<!-- evals:end -->';

const oneDecimal = (value: number): string => value.toFixed(1);

/** The latest run for each model and task count, newest first. */
export function latestRuns(runs: readonly RunResults[]): RunResults[] {
  const latest = new Map<string, RunResults>();
  for (const run of runs) {
    const key = `${run.run.model.id} ${String(run.run.tasks.length)}`;
    const seen = latest.get(key);
    if (!seen || seen.run.startedAt < run.run.startedAt) latest.set(key, run);
  }
  return [...latest.values()].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
}

export function readmeTable(runs: readonly RunResults[]): string {
  if (runs.length === 0) return 'No eval run is recorded yet.';
  const rows = latestRuns(runs).map((run) => {
    const summary = summarize(run.results);
    return `| ${run.run.model.id} | ${run.run.startedAt.slice(0, 10)} | ${run.run.prompt} | ${run.run.graders} | ${String(summary.passed)} of ${String(summary.tasks)} | ${oneDecimal(summary.medianSteps)} | ${oneDecimal(summary.wastedStepsPerTask)} | ${oneDecimal(summary.requestsPerTask)} | ${Math.round(summary.tokensPerTask).toLocaleString('en-US')} | [${run.run.id}](docs/evals/results/${run.run.id}.md) |`;
  });
  return [
    '| Model | Date | Prompt | Graders | Passed | Median steps | Wasted steps | Requests | Tokens | Report |',
    '| --- | --- | --- | --- | --: | --: | --: | --: | --: | --- |',
    ...rows,
  ].join('\n');
}

export function withTable(readme: string, table: string): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end < start)
    throw new Error(`README.md needs ${README_START} and ${README_END}.`);
  return `${readme.slice(0, start + README_START.length)}\n\n${table}\n\n${readme.slice(end)}`;
}

export async function recordedRuns(dir = RESULTS_DIR): Promise<RunResults[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    // No results folder yet: nothing recorded.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const runs: RunResults[] = [];
  for (const name of names.filter((file) => file.endsWith('.json')).sort()) {
    runs.push(runResultsSchema.parse(JSON.parse(await readFile(join(dir, name), 'utf8'))));
  }
  return runs;
}

export async function updateReadme(): Promise<void> {
  const readme = await readFile(README, 'utf8');
  await writeFile(README, withTable(readme, readmeTable(await recordedRuns())));
}
