/**
 * Run output as plain text for a prompt. Terminal output carries colour and
 * cursor codes, `\r\n` line ends, and progress lines that redraw themselves
 * with `\r`; a model reads the text a person saw, so those become what the
 * terminal finally showed. Only the tail is kept, from a line boundary,
 * because the end of the output is where a crash is reported.
 */
import { AI_INPUT_LIMITS } from '@collabcode/shared';

/** CSI sequences (colours, cursor moves), OSC sequences (titles, links) and other escapes. */
// eslint-disable-next-line no-control-regex -- matching terminal control codes is the point
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Control characters other than line feed and tab, left over after the escapes. */
// eslint-disable-next-line no-control-regex -- as above
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** What each line finally showed: text before a `\r` was drawn over. */
function lastDrawn(line: string): string {
  const carriageReturn = line.lastIndexOf('\r');
  return carriageReturn === -1 ? line : line.slice(carriageReturn + 1);
}

export function plainTerminalText(raw: string): string {
  return raw
    .replace(ESCAPES, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => lastDrawn(line).replace(CONTROLS, ''))
    .join('\n');
}

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
