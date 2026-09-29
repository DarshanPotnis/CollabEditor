/**
 * Whether a stopped run may carry on in this command. A run spread over days
 * (a comparison on a model with a small daily allowance) must run the same
 * code, model, tier, tasks and trials, and be judged by the same graders, on
 * every day, or its sessions would not be comparable with each other. So a
 * resume from any other commit is refused: in CI, start it from the tag or
 * commit the run began at.
 */
import type { AgentTier } from '@collabcode/shared';
import type { RunResults } from '../results/run-results.js';

export type ResumingWith = {
  commit: string;
  model: string;
  graders: string;
  tier: AgentTier;
  tasks: readonly string[];
  trials: number;
};

export function resumeProblem(started: RunResults['run'], now: ResumingWith): string | null {
  const differences = [
    started.commit === now.commit ? null : `commit ${started.commit} (this is ${now.commit})`,
    started.model.id === now.model ? null : `model ${started.model.id} (not ${now.model})`,
    started.graders === now.graders ? null : `${started.graders} (this is ${now.graders})`,
    started.tier === now.tier ? null : `the ${started.tier} tier (not ${now.tier})`,
    started.tasks.join(',') === now.tasks.join(',')
      ? null
      : `tasks ${started.tasks.join(', ')} (not ${now.tasks.join(', ')})`,
    started.trials === now.trials
      ? null
      : `${String(started.trials)} trials (not ${String(now.trials)})`,
  ].filter((difference): difference is string => difference !== null);
  return differences.length === 0
    ? null
    : `Run ${started.id} started with ${differences.join(', ')}. Resume it with the same options, from the commit it started at.`;
}
