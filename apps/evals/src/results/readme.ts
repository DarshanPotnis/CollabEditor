/**
 * The README's eval tables, from docs/evals/results/*.json, written between
 * the README's evals markers (npm run evals:readme). Generated, so they cannot
 * drift from the results. Headline numbers come only from runs with several
 * sessions per task, with how consistently each task passed; single-session
 * iteration runs are listed apart, as what they are.
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

/** Sessions per task for a run's numbers to be headline numbers, not iteration. */
export const HEADLINE_TRIALS = 3;

/** The latest run for each model, prompt version, task count and trials, newest first. */
export function latestRuns(runs: readonly RunResults[]): RunResults[] {
  const latest = new Map<string, RunResults>();
  for (const run of runs) {
    const key = `${run.run.model.id} ${run.run.prompt} ${String(run.run.tasks.length)} ${String(run.run.trials)}`;
    const seen = latest.get(key);
    if (!seen || seen.run.startedAt < run.run.startedAt) latest.set(key, run);
  }
  return [...latest.values()].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
}

const checks = (value: number | null): string => (value === null ? '—' : oneDecimal(value));
const report = (run: RunResults): string => `[${run.run.id}](docs/evals/results/${run.run.id}.md)`;

/** Several sessions per task: the pass rate, and how consistently each task passed. */
function headlineTable(runs: readonly RunResults[]): string[] {
  if (runs.length === 0) {
    return [
      `No run with ${String(HEADLINE_TRIALS)} sessions per task is recorded yet, so there is no headline pass rate.`,
    ];
  }
  return [
    `| Model | Prompt | Graders | Sessions passed | Tasks passed every time · some · never | Checks after the last change, per session | Requests per session | Report |`,
    '| --- | --- | --- | --: | --: | --: | --: | --- |',
    ...runs.map((run) => {
      const summary = summarize(run.results);
      const { every, some, none } = summary.byTask;
      const left = summary.unavailable.length;
      const leftOut = left === 0 ? '' : `, ${String(left)} left out (model never answered)`;
      return `| ${run.run.model.id} | ${run.run.prompt} | ${run.run.graders} | ${String(summary.passed)} of ${String(summary.sessions)} (${String(Math.round(summary.passRate * 100))}%)${leftOut} | ${String(every)} · ${String(some)} · ${String(none)} | ${checks(summary.checksAfterLastChangePerTask)} | ${oneDecimal(summary.requestsPerTask)} | ${report(run)} |`;
    }),
  ];
}

/** One session per task: for iterating, where a task or two either way is noise. */
function iterationTable(runs: readonly RunResults[]): string[] {
  return [
    '| Model | Date | Prompt | Graders | Passed | Checks after the last change | Wasted steps | Requests | Tokens | Report |',
    '| --- | --- | --- | --- | --: | --: | --: | --: | --: | --- |',
    ...runs.map((run) => {
      const summary = summarize(run.results);
      return `| ${run.run.model.id} | ${run.run.startedAt.slice(0, 10)} | ${run.run.prompt} | ${run.run.graders} | ${String(summary.passed)} of ${String(summary.sessions)} | ${checks(summary.checksAfterLastChangePerTask)} | ${oneDecimal(summary.wastedStepsPerTask)} | ${oneDecimal(summary.requestsPerTask)} | ${Math.round(summary.tokensPerTask).toLocaleString('en-US')} | ${report(run)} |`;
    }),
  ];
}

export function readmeTable(runs: readonly RunResults[]): string {
  if (runs.length === 0) return 'No eval run is recorded yet.';
  const latest = latestRuns(runs);
  const headline = latest.filter((run) => run.run.trials >= HEADLINE_TRIALS);
  const iteration = latest.filter((run) => run.run.trials === 1);
  const lines = [
    `**Headline** (${String(HEADLINE_TRIALS)} sessions per task):`,
    '',
    ...headlineTable(headline),
  ];
  if (iteration.length > 0) {
    lines.push(
      '',
      '**Iteration runs** (one session per task, so a task or two either way is noise):',
      '',
      ...iterationTable(iteration),
    );
  }
  return lines.join('\n');
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
