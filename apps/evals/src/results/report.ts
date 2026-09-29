/**
 * A run's results as markdown: the summary line, one row per task with why it
 * failed, and the failure categories. Written next to the results JSON in
 * docs/evals/results, and to CI's job summary.
 */
import { summarize, type RunResults, type TaskResult } from './run-results.js';

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

export function reportMarkdown(results: RunResults): string {
  const { run } = results;
  const summary = summarize(results.results);
  const lines = [
    `# Eval run ${run.id}`,
    '',
    `${run.model.provider}/${run.model.id} · ${run.prompt} · ${run.tier} tier (up to ${run.tier === 'shared' ? '15' : '25'} steps) · commit ${run.commit} · ${run.startedAt.slice(0, 10)}${run.local ? ' · run locally' : ''}`,
    '',
    `**${String(summary.passed)} of ${String(summary.tasks)} passed (${percent(summary.passRate)})** · median ${oneDecimal(summary.medianSteps)} steps · ${oneDecimal(summary.wastedStepsPerTask)} wasted steps, ${oneDecimal(summary.requestsPerTask)} requests, ${thousands(summary.tokensPerTask)} tokens and ${oneDecimal(summary.wallSecondsPerTask)} s per task`,
  ];
  if (run.stoppedEarly !== null) lines.push('', `Stopped early: ${run.stoppedEarly}`);
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
