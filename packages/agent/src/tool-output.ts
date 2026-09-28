/**
 * Shaping what tools return before the model reads it (docs/PLAN-AI.md §4).
 * The same for every ToolHost, which is why it lives in the core.
 *
 * - Output is capped, and a cut is always marked, so the model knows something
 *   is missing rather than reading a partial file as the whole.
 * - Output that carries a `file://` stack frame gets a note: WebContainer runs
 *   ES modules through a transform that shifts their stack-trace line numbers
 *   by an amount that depends on the module (+11 and +13 measured in AI-1), so
 *   the model must find the code by its content.
 */
import type { AgentToolName } from '@collabcode/shared';

/** Tools whose output comes from the running program, and so can carry stack traces. */
export const RUN_OUTPUT_TOOLS: ReadonlySet<AgentToolName> = new Set([
  'run_project',
  'read_terminal',
  'run_command',
  'http_request',
]);

export const STACK_TRACE_NOTE =
  'Note: line numbers in stack traces of ES modules (file:// paths) are wrong in this runtime. Find the code by its content with search_code or read_file, whose line numbers are right.';

/** A frame such as `at x (file:///home/project/routes/users.js:14:9)`. */
const FILE_FRAME = /file:\/\/\S+:\d+/;

export function withStackTraceNote(output: string): string {
  return FILE_FRAME.test(output) ? `${output}\n\n${STACK_TRACE_NOTE}` : output;
}

/**
 * Keep at most `maxChars`, cutting at a line break when there is one near the
 * limit, and say how much was left out.
 */
export function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const lineBreak = output.lastIndexOf('\n', maxChars);
  let cut = lineBreak > maxChars * 0.8 ? lineBreak : maxChars;
  // Never keep half of a surrogate pair.
  const last = output.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  const omitted = output.length - cut;
  return `${output.slice(0, cut)}\n…[truncated ${omitted.toLocaleString('en-US')} characters]`;
}
