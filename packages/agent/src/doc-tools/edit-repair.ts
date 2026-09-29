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
 * says what is most likely wrong instead of only that the text is missing.
 */
import { occurrences } from '@collabcode/shared';

export type RepairKind = 'line-numbers' | 'separator-space';

export type ResolvedEdit =
  /** oldText is in the file as sent (or is empty): the edit goes ahead unchanged. */
  | { kind: 'as-sent' }
  | { kind: 'repaired'; repair: RepairKind; oldText: string; newText: string }
  | { kind: 'no-match'; message: string };

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
  if (at.length === 1 && lines.length > 1) {
    return `Its first line is line ${String(at[0])} of the file, but the lines after it differ: read that part of the file again and copy it exactly.`;
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
