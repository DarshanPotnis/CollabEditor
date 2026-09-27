/**
 * Helpers for putting project text into a prompt without it breaking out of
 * its block, and for reading a fenced block back out of an answer.
 */

export type FencedBlock = { info: string; content: string };

/**
 * Wrap text in a Markdown code fence longer than any backtick run inside it,
 * so code that itself contains ``` cannot close the block early.
 */
export function fence(text: string, info = ''): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marker = '`'.repeat(Math.max(3, longestRun + 1));
  return `${marker}${info}\n${text}\n${marker}`;
}

/** Number of lines in text, where an empty string is one empty line. */
export function lineCount(text: string): number {
  return text.split('\n').length;
}

/** Prefix each line with its line number, right-aligned: ` 9| a` / `10| b`. */
export function numberLines(text: string, firstLine: number): string {
  const lines = text.split('\n');
  const width = String(firstLine + lines.length - 1).length;
  return lines
    .map((line, index) => `${String(firstLine + index).padStart(width, ' ')}| ${line}`)
    .join('\n');
}

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * The complete fenced code blocks in a Markdown answer, in order. A block that
 * is never closed (an answer cut off mid-way) is not returned. Follows the
 * CommonMark rules that matter here: a closing fence uses the same character
 * and is at least as long, a backtick fence's info string has no backticks, and
 * the opening fence's indentation is removed from the content.
 */
export function fencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: FencedBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const opening = OPENING_FENCE.exec(lines[index] ?? '');
    index += 1;
    if (!opening) continue;
    const [, indent = '', marker = '', rest = ''] = opening;
    if (marker.startsWith('`') && rest.includes('`')) continue;

    const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    const content: string[] = [];
    let closed = false;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      index += 1;
      if (closing.test(line)) {
        closed = true;
        break;
      }
      content.push(stripIndent(line, indent.length));
    }
    if (closed) blocks.push({ info: rest.trim(), content: content.join('\n') });
  }
  return blocks;
}

function stripIndent(line: string, count: number): string {
  let removed = 0;
  while (removed < count && line[removed] === ' ') removed += 1;
  return line.slice(removed);
}
