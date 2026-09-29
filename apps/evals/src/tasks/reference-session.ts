/**
 * A task's reference solution as a scripted agent session, and its known-bad
 * variants: the graders' test (tasks.selftest.ts). The script does what a good
 * agent would: makes the solution's changes in one answer, runs the project,
 * sends the task's own checks as its checks, and finishes with the reference
 * summary. Without a sandbox it does not keep trying to run, as a good agent
 * would not.
 */
import { answerWith, toolCall, type ScriptEntry } from '@collabcode/agent';
import type { ToolCallPart } from '@collabcode/shared';
import { buildProjectDoc, readFixtureFolder } from '../harness/fixture-project.js';
import { documentFiles } from '../sandbox/project-dir.js';
import type { KnownBadVariant, TaskDefinition } from './task.js';

/** Past any step limit, for a session that never finishes. */
const FOREVER = 30;

/** The calls that turn `start` into `files`, and delete `deletes`. */
function changeCalls(
  start: ReadonlyMap<string, string>,
  files: ReadonlyMap<string, string>,
  deletes: readonly string[],
): ToolCallPart[] {
  const calls = [...files].flatMap(([path, content]) => {
    const before = start.get(path);
    if (before === content) return [];
    return before === undefined
      ? [toolCall('create_file', { path, content })]
      : [toolCall('edit_file', { path, oldText: before, newText: content })];
  });
  return [...calls, ...deletes.map((path) => toolCall('delete_file', { path }))];
}

function checkCalls(task: TaskDefinition, only?: readonly string[]): ToolCallPart[] {
  const checks = (task.checks ?? []).filter((check) => only?.includes(check.name) ?? true);
  return checks.map((check) =>
    toolCall('http_request', {
      method: check.method,
      path: check.path,
      ...(check.json === undefined
        ? {}
        : {
            headers: [{ name: 'content-type', value: 'application/json' }],
            body: JSON.stringify(check.json),
          }),
    }),
  );
}

export async function referenceScript(
  task: TaskDefinition,
  variant?: KnownBadVariant,
): Promise<ScriptEntry[]> {
  const start = documentFiles(await buildProjectDoc(task.project));
  const other = variant?.kind === 'other-solution' ? variant : null;
  const folder = other?.files ?? task.reference.files;
  const solved =
    folder === undefined ? new Map<string, string>() : await readFixtureFolder('solutions', folder);
  // Another solution deletes only what it says it does, not what the reference deletes.
  const deletes = other ? (other.deletes ?? []) : (task.reference.deletes ?? []);
  const changes = variant?.kind === 'no-change' ? [] : changeCalls(start, solved, deletes);
  if (variant?.kind === 'extra-file') {
    changes.push(...changeCalls(start, new Map([[variant.path, variant.content]]), []));
  }

  const script: ScriptEntry[] = [];
  if (changes.length > 0) script.push(answerWith(changes));
  if (task.sandbox === 'unavailable-discovered') {
    // It tries once, is told there is no sandbox, and stops trying.
    script.push(answerWith([toolCall('run_project', {})]));
  }
  if ((task.sandbox ?? 'available') === 'available' && variant?.kind !== 'no-checks') {
    script.push(answerWith([toolCall('run_project', {})]));
    const checks = checkCalls(task, variant?.kind === 'some-checks' ? variant.names : undefined);
    if (checks.length > 0) script.push(answerWith(checks));
  }
  if (variant?.kind === 'extra-calls') {
    script.push(answerWith(variant.calls.map((call) => toolCall(call.toolName, call.input))));
  }
  if (variant?.kind === 'no-finish') {
    for (let step = 0; step < FOREVER; step += 1)
      script.push(answerWith([toolCall('list_files', {})]));
    return script;
  }
  const summary = variant?.kind === 'summary' ? variant.summary : task.reference.summary;
  script.push(answerWith([toolCall('finish', { summary })]));
  return script;
}
