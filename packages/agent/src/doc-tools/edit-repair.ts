/**
 * edit_file's text as models get it wrong by copying read_file's numbered
 * lines ("14| usersRouter.post(…"). A recorded session sent oldText starting
 * " usersRouter.post": the number and bar left out, the space after them kept,
 * and missed three edits in a row that way.
 *
 * When oldText is not in the file, two repairs are tried, each still needing
 * exactly one match: the whole "N| " prefix taken off every line, or the one
 * space it leaves at the start taken off. The same repair is made to newText,
 * which the model builds from the same copy. When neither fits, the refusal
 * says what is most likely wrong instead of only that the text is missing:
 * when the copy starts where the file does, the first line that differs, both
 * ways.
 */
import { occurrences } from '@collabcode/shared';

export type RepairKind = 'line-numbers' | 'separator-space';

export type ResolvedEdit =
  /** oldText is in the file as sent (or is empty): the edit goes ahead unchanged. */
  | { kind: 'as-sent' }
  | { kind: 'repaired'; repair: RepairKind; oldText: string; newText: string }
  | { kind: 'no-match'; message: string };

/** Added to a mismatch refused a second time running: a shorter copy has fewer places to slip. */
export const SHORTER_TEXT_HINT =
  'This edit was refused the same way before. Copy fewer lines: only the lines you change, with one line either side, exactly as read_file shows them.';

/** read_file's prefix: the number padded to the widest one, a bar, and a space (none on an empty line). */
const NUMBERED_LINE = /^ *\d+\|(?: |$)/;

/** Said after "Edited …" so the model stops making the same mistake. */
export const REPAIR_NOTES: Readonly<Record<RepairKind, string>> = {
  'line-numbers':
    'oldText included read_file\'s line numbers ("14| "), which were left out to find it. Leave them out of oldText and newText.',
  'separator-space':
    'oldText started with a space the file does not have, left over from read_file\'s "N| " prefix; it matched without it. Leave that space out.',
};

function withoutNumbers(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(NUMBERED_LINE, ''))
    .join('\n');
}

type Repair = { repair: RepairKind; oldText: string; newText: string };

function repairs(oldText: string, newText: string): Repair[] {
  const found: Repair[] = [];
  if (oldText.split('\n').every((line) => NUMBERED_LINE.test(line))) {
    found.push({
      repair: 'line-numbers',
      oldText: withoutNumbers(oldText),
      newText: withoutNumbers(newText),
    });
  }
  if (oldText.startsWith(' ')) {
    found.push({
      repair: 'separator-space',
      oldText: oldText.slice(1),
      newText: newText.startsWith(' ') ? newText.slice(1) : newText,
    });
  }
  return found;
}

/** The 1-based lines that match `lines` with every line's surrounding spaces ignored, if exactly one run does. */
function matchIgnoringIndentation(
  contentLines: readonly string[],
  lines: readonly string[],
): { from: number; to: number } | null {
  const wanted = lines.map((line) => line.trim());
  let found: number | null = null;
  for (let start = 0; start + wanted.length <= contentLines.length; start += 1) {
    if (!wanted.every((line, offset) => contentLines[start + offset]?.trim() === line)) continue;
    if (found !== null) return null;
    found = start;
  }
  return found === null ? null : { from: found + 1, to: found + wanted.length };
}

/** Characters of a long line shown around where it differs. */
const SHOWN_CHARS = 160;
const LEAD_CHARS = 60;

/** Both lines quoted, cut to the same window around their first differing character when long. */
function quotedPair(fileLine: string, textLine: string): [string, string] {
  let column = 0;
  while (column < fileLine.length && fileLine[column] === textLine[column]) column += 1;
  const longest = Math.max(fileLine.length, textLine.length);
  const start = longest <= SHOWN_CHARS ? 0 : Math.max(0, column - LEAD_CHARS);
  const cut = (line: string): string =>
    longest <= SHOWN_CHARS
      ? line
      : `${start > 0 ? '…' : ''}${line.slice(start, start + SHOWN_CHARS)}${start + SHOWN_CHARS < line.length ? '…' : ''}`;
  return [JSON.stringify(cut(fileLine)), JSON.stringify(cut(textLine))];
}

/**
 * Where a copy whose first line is at `at` (1-based) stops matching the file,
 * with both versions of that line: a model that re-reads and copies again
 * tends to make the same slip, which it cannot see without being shown.
 */
function firstDifference(
  contentLines: readonly string[],
  lines: readonly string[],
  at: number,
): string {
  const offset = lines.findIndex((line, index) => contentLines[at - 1 + index] !== line);
  const lineNumber = at + offset;
  const fileLine = contentLines[lineNumber - 1];
  const textLine = lines[offset] ?? '';
  const where =
    offset === 0
      ? `Its first line is line ${String(at)} of the file, but differs from it in spacing.`
      : `Its first line is line ${String(at)} of the file, but line ${String(lineNumber)} differs.`;
  if (fileLine === undefined) {
    return `${where}\nThe file has:  nothing: it ends at line ${String(contentLines.length)}\nYour text has: ${JSON.stringify(textLine)}\nCopy the lines exactly as the file has them.`;
  }
  const [file, text] = quotedPair(fileLine, textLine);
  return `${where}\nThe file has:  ${file}\nYour text has: ${text}\nCopy the lines exactly as the file has them.`;
}

/** Why oldText is most likely not in the file, as advice the model can act on. */
function missHint(content: string, oldText: string): string {
  const lines = oldText.split('\n');
  if (lines.some((line) => NUMBERED_LINE.test(line))) {
    return 'It contains read_file\'s line numbers ("14| "): copy only the code after them, with its own indentation.';
  }
  const contentLines = content.split('\n');
  const loose = matchIgnoringIndentation(contentLines, lines);
  if (loose) {
    return `Lines ${String(loose.from)}–${String(loose.to)} match it except for indentation: copy each line's leading spaces exactly as the file has them.`;
  }
  const first = lines.find((line) => line.trim() !== '')?.trim();
  const at =
    first === undefined
      ? []
      : contentLines.flatMap((line, index) => (line.trim() === first ? [index + 1] : []));
  if (at[0] !== undefined && at.length === 1 && lines.length > 1) {
    return firstDifference(contentLines, lines, at[0]);
  }
  return 'It may have changed since it was read.';
}

/** What to do with an edit whose oldText may have been copied with read_file's formatting. */
export function resolveEdit(content: string, oldText: string, newText: string): ResolvedEdit {
  if (oldText === '' || occurrences(content, oldText).count > 0) return { kind: 'as-sent' };
  for (const candidate of repairs(oldText, newText)) {
    if (occurrences(content, candidate.oldText).count === 1) {
      return { kind: 'repaired', ...candidate };
    }
  }
  return {
    kind: 'no-match',
    message: `The text to replace is not in the file. ${missHint(content, oldText)}`,
  };
}
