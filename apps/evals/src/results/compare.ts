/**
 * Eval runs side by side (npm run evals:compare): each run gets a letter, and
 * A is the one the others are held against.
 *
 * Runs compare fairly only when the same graders judged them, so runs with
 * different graders versions are refused: grade the older ones again first
 * (npm run evals:regrade). Only tasks every run has are compared; the others
 * are named. With one session per task, a difference of a task or two can be
 * noise, which the report says.
 */
import { FAILURE_CATEGORIES } from '../graders/grader.js';
import { summarize, type RunResults, type TaskResult } from './run-results.js';

export class CompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompareError';
  }
}

const LETTERS = 'ABCDEFGHIJ';
const oneDecimal = (value: number): string => value.toFixed(1);
const thousands = (value: number): string => Math.round(value).toLocaleString('en-US');
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const row = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`;
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

function verdict(results: readonly TaskResult[]): string {
  if (results.length === 1) {
    const [only] = results;
    return only?.passed ? 'pass' : `fail (${only?.category ?? ''})`;
  }
  const passed = results.filter((result) => result.passed).length;
  return `${String(passed)} of ${String(results.length)} passed`;
}

function sharedTasks(runs: readonly RunResults[]): { tasks: string[]; leftOut: string[] } {
  const ids = runs.map((run) => new Set(run.results.map((result) => result.task)));
  const first = [...new Set(runs[0]?.results.map((result) => result.task))];
  const all = [...new Set(runs.flatMap((run) => run.results.map((result) => result.task)))];
  return {
    tasks: first.filter((task) => ids.every((set) => set.has(task))),
    leftOut: all.filter((task) => !ids.every((set) => set.has(task))),
  };
}

export function compareRuns(runs: readonly RunResults[]): string {
  if (runs.length < 2) throw new CompareError('Compare at least two runs.');
  if (runs.length > LETTERS.length) {
    throw new CompareError(`Compare at most ${String(LETTERS.length)} runs.`);
  }
  const graders = [...new Set(runs.map((run) => run.run.graders))];
  if (graders.length > 1) {
    throw new CompareError(
      `These runs were judged by different graders (${graders.join(', ')}). Grade the older ones again first: npm run evals:regrade -- <run id>.`,
    );
  }
  const letters = runs.map((_, index) => LETTERS[index] ?? '');
  const { tasks, leftOut } = sharedTasks(runs);
  const scoped = runs.map((run) => run.results.filter((result) => tasks.includes(result.task)));
  const summaries = scoped.map((results) => summarize(results));
  /** Per task, or a dash for a run recorded before it was measured. */
  const perTask = (key: 'repeatedErrors' | 'refusedFinishes') =>
    scoped.map((results) => {
      const values = results.map((result) => result.metrics[key]);
      return values.every((value) => value !== undefined) ? oneDecimal(mean(values)) : '—';
    });
  const notMade = scoped.map((results) => {
    const values = results.map((result) => result.metrics.checksNotMade);
    return values.every((value) => value !== undefined)
      ? String(values.reduce((total, value) => total + value, 0))
      : '—';
  });

  const lines = [
    `# ${runs.map((run) => run.run.prompt).join(' vs ')}: ${String(tasks.length)} tasks`,
    '',
    `Judged by ${graders[0] ?? ''}. One session per task: a difference of a task or two can be noise.`,
    '',
    row(['Run', 'Id', 'Model', 'Prompt', 'Graders', 'Commit', 'Date']),
    row(['---', '---', '---', '---', '---', '---', '---']),
    ...runs.map((run, index) =>
      row([
        letters[index] ?? '',
        run.run.id,
        run.run.model.id,
        run.run.prompt,
        run.run.graders,
        run.run.commit,
        run.run.startedAt.slice(0, 10),
      ]),
    ),
  ];
  if (leftOut.length > 0) lines.push('', `Left out, not in every run: ${leftOut.join(', ')}.`);

  lines.push(
    '',
    row(['', ...letters]),
    row(['---', ...letters.map(() => '--:')]),
    row([
      'Passed',
      ...summaries.map(
        (summary) =>
          `${String(summary.passed)} of ${String(summary.tasks)} (${String(Math.round(summary.passRate * 100))}%)`,
      ),
    ]),
    row(['Median steps', ...summaries.map((summary) => oneDecimal(summary.medianSteps))]),
    row([
      'Wasted steps per task',
      ...summaries.map((summary) => oneDecimal(summary.wastedStepsPerTask)),
    ]),
    row(['Repeated errors per task', ...perTask('repeatedErrors')]),
    row(['Refused finishes per task', ...perTask('refusedFinishes')]),
    row(['Checks listed but not made', ...notMade]),
    row(['Requests per task', ...summaries.map((summary) => oneDecimal(summary.requestsPerTask))]),
    row(['Tokens per task', ...summaries.map((summary) => thousands(summary.tokensPerTask))]),
    row([
      'Seconds per task',
      ...summaries.map((summary) => oneDecimal(summary.wallSecondsPerTask)),
    ]),
  );

  const categories = FAILURE_CATEGORIES.filter((category) =>
    summaries.some((summary) => (summary.categories[category] ?? 0) > 0),
  );
  if (categories.length > 0) {
    lines.push(
      '',
      'Failures by category:',
      '',
      row(['Category', ...letters]),
      row(['---', ...letters.map(() => '--:')]),
      ...categories.map((category) =>
        row([category, ...summaries.map((summary) => String(summary.categories[category] ?? 0))]),
      ),
    );
  }

  lines.push(
    '',
    row(['Task', ...letters, 'Differs from A']),
    row(['---', ...letters.map(() => '---'), '---']),
    ...tasks.map((task) => {
      const verdicts = scoped.map((results) =>
        verdict(results.filter((result) => result.task === task)),
      );
      const title = scoped[0]?.find((result) => result.task === task)?.title ?? task;
      const differs = verdicts.flatMap((each, index) =>
        index > 0 && each !== verdicts[0] ? [letters[index] ?? ''] : [],
      );
      return row([title, ...verdicts, differs.join(', ')]);
    }),
  );
  return `${lines.join('\n')}\n`;
}
