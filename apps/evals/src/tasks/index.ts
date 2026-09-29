/** Every eval task, in the order a run takes them. */
import { CONDUCT_TASKS } from './conduct-tasks.js';
import { ENDPOINT_TASKS } from './endpoint-tasks.js';
import { FIX_TASKS } from './fix-tasks.js';
import { STRUCTURE_TASKS } from './structure-tasks.js';
import type { TaskDefinition } from './task.js';

export const TASKS: readonly TaskDefinition[] = [
  ...ENDPOINT_TASKS,
  ...FIX_TASKS,
  ...STRUCTURE_TASKS,
  ...CONDUCT_TASKS,
];

/** The 6 tasks used to compare models on few requests (docs/evals/README.md). */
export const COMPARISON_TASKS: readonly TaskDefinition[] = TASKS.filter(
  (task) => task.comparison === true,
);
