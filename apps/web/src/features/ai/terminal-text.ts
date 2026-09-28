/**
 * Run output for a prompt: the plain text a person saw (lib/terminal-text.ts),
 * and only its tail, from a line boundary, because the end of the output is
 * where a crash is reported.
 */
import { AI_INPUT_LIMITS } from '@collabcode/shared';
import { plainTerminalText } from '../../lib/terminal-text.js';

/** The end of the output as plain text, at most `maxChars`, starting on a whole line. */
export function terminalTail(
  raw: string,
  maxChars: number = AI_INPUT_LIMITS.terminalChars,
): string {
  const text = plainTerminalText(raw).trimEnd();
  if (text.length <= maxChars) return text.trimStart();
  const tail = text.slice(-maxChars);
  const firstBreak = tail.indexOf('\n');
  return (firstBreak === -1 ? tail : tail.slice(firstBreak + 1)).trimStart();
}

/** Raw output to read so that the plain tail can still fill the cap after codes are removed. */
export const RAW_OUTPUT_CHARS = AI_INPUT_LIMITS.terminalChars * 4;
