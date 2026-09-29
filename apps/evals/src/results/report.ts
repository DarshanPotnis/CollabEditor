/**
 * A run's results as markdown: the summary line, one row per task with why it
 * failed, and the failure categories. Written next to the results JSON in
 * docs/evals/results, and to CI's job summary.
 */
import {
  summarize,
  unanswered,
  type Regraded,
  type RunResults,
  type RunSummary,
  type TaskResult,
} from './run-results.js';

const percent = (value: number): string => `${String(Math.round(value * 100))}%`;
const oneDecimal = (value: number): string => value.toFixed(1);
const thousands = (value: number): string => Math.round(value).toLocaleString('en-US');

/** Table cells cannot hold a pipe or a line break. */
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function why(result: TaskResult): string {
  if (result.passed) return '';
  const first = result.grades.find((grade) => !grade.passed);
  return first ? `${result.category ?? ''}: ${first.id}: ${first.detail}` : (result.category ?? '');
}

const verdict = (after: Regraded['changes'][number]['after']): string =>
  after.passed ? 'pass' : `fail (${after.category ?? ''})`;

/** Which grading this is, and which verdicts it changed. */
function regradedNote(results: RunResults, regraded: Regraded): string[] {
  const { run } = results;
  const title = (task: string): string =>
    results.results.find((result) => result.task === task)?.title ?? task;
  const changed = regraded.changes.length;
  return [
    '',
    `Graded again with ${run.graders} at commit ${regraded.commit} on ${regraded.at.slice(0, 10)}, from the saved traces; it ran at commit ${run.commit} and was last graded with ${regraded.from}. ${changed === 0 ? 'No verdict changed.' : `${String(changed)} verdict${changed === 1 ? '' : 's'} changed:`}`,
    ...(changed === 0 ? [] : ['']),
    ...regraded.changes.map(
      (change) =>
        `- ${title(change.task)}${run.trials > 1 ? ` (trial ${String(change.trial)})` : ''}: ${verdict(change.before)} → ${verdict(change.after)}`,
    ),
  ];
}

/** With several trials: how many sessions passed, and on how many tasks every, some or none did. */
function passedLine(summary: RunSummary, trials: number): string {
  if (trials === 1) {
    return `**${String(summary.passed)} of ${String(summary.sessions)} passed (${percent(summary.passRate)})**`;
  }
  const { tasks, every, some, none } = summary.byTask;
  return `**${String(summary.passed)} of ${String(summary.sessions)} sessions passed (${percent(summary.passRate)})** · every session passed on ${String(every)} of ${String(tasks)} tasks, some on ${String(some)}, none on ${String(none)}`;
}

/** Each task's sessions: how many passed, and the failures' categories. */
function consistencyTable(results: readonly TaskResult[]): string[] {
  const tasks = [...new Set(results.map((result) => result.task))];
  return [
    '',
    '| Task | Passed | Failures |',
    '| --- | --: | --- |',
    ...tasks.map((task) => {
      const sessions = results.filter((result) => result.task === task);
      const failed = sessions.filter((result) => !result.passed);
      return `| ${cell(sessions[0]?.title ?? task)} | ${String(sessions.length - failed.length)} of ${String(sessions.length)} | ${failed.map((result) => result.category ?? '').join(', ')} |`;
    }),
  ];
}

export function reportMarkdown(results: RunResults): string {
  const { run } = results;
  const summary = summarize(results.results);
  const lines = [
    `# Eval run ${run.id}`,
    '',
    `${run.model.provider}/${run.model.id} · ${run.prompt} · ${run.graders} · ${run.tier} tier (up to ${run.tier === 'shared' ? '15' : '25'} steps) · commit ${run.commit} · ${run.startedAt.slice(0, 10)}${run.local ? ' · run locally' : ''}`,
    '',
    `${passedLine(summary, run.trials)} · median ${oneDecimal(summary.medianSteps)} steps · ${oneDecimal(summary.wastedStepsPerTask)} wasted steps, ${oneDecimal(summary.requestsPerTask)} requests, ${thousands(summary.tokensPerTask)} tokens and ${oneDecimal(summary.wallSecondsPerTask)} s per task`,
  ];
  if (run.stoppedEarly !== null) lines.push('', `Stopped early: ${run.stoppedEarly}`);
  if (summary.unavailable.length > 0) {
    const title = (task: string): string =>
      results.results.find((result) => result.task === task)?.title ?? task;
    const named = summary.unavailable.map(
      ({ task, trial }) => `${title(task)}${run.trials > 1 ? ` (trial ${String(trial)})` : ''}`,
    );
    lines.push(
      '',
      `Left out, the model never answered (not the agent's failure): ${named.join('; ')}.`,
    );
  }
  if (run.regraded !== null) lines.push(...regradedNote(results, run.regraded));
  if (run.trials > 1) {
    lines.push(...consistencyTable(results.results.filter((result) => !unanswered(result))));
  }
  lines.push(
    '',
    '| Task | Result | Steps | Wasted | Requests | Tokens | Time | Why it failed |',
    '| --- | --- | --: | --: | --: | --: | --: | --- |',
    ...results.results.map((result) =>
      [
        '',
        `${cell(result.title)}${run.trials > 1 ? ` (trial ${String(result.trial)})` : ''}`,
        result.passed ? 'pass' : 'fail',
        String(result.metrics.steps),
        String(result.metrics.wastedSteps),
        String(result.metrics.requests),
        thousands(result.metrics.inputTokens + result.metrics.outputTokens),
        `${oneDecimal(result.metrics.wallMs / 1000)} s`,
        cell(why(result)),
        '',
      ]
        .join(' | ')
        .trim(),
    ),
  );
  const categories = Object.entries(summary.categories);
  if (categories.length > 0) {
    lines.push(
      '',
      'Failures by category:',
      '',
      ...categories.map(([name, count]) => `- ${name}: ${String(count)}`),
    );
  }
  return `${lines.join('\n')}\n`;
}
