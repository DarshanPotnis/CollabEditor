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

/** A run of prose, or a fenced code block with whether its closing fence has arrived. */
export type MarkdownSegment =
  | { kind: 'text'; text: string }
  | { kind: 'fence'; info: string; content: string; closed: boolean };

/**
 * Splits a Markdown answer into prose and fenced code blocks, in order. A
 * block that is never closed runs to the end, which is what a streaming
 * answer looks like part way through. Follows the CommonMark rules that
 * matter here: a closing fence uses the same character and is at least as
 * long, a backtick fence's info string has no backticks, and the opening
 * fence's indentation is removed from the content.
 */
export function markdownSegments(markdown: string): MarkdownSegment[] {
  const lines = markdown.split(/\r?\n/);
  const segments: MarkdownSegment[] = [];
  let prose: string[] = [];
  const endProse = (): void => {
    if (prose.length > 0) segments.push({ kind: 'text', text: prose.join('\n') });
    prose = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    index += 1;
    const opening = OPENING_FENCE.exec(line);
    const [, indent = '', marker = '', rest = ''] = opening ?? [];
    if (!opening || (marker.startsWith('`') && rest.includes('`'))) {
      prose.push(line);
      continue;
    }

    endProse();
    const closing = new RegExp(
      `^ {0,3}${marker[0] === '`' ? '`' : '~'}{${String(marker.length)},}\\s*$`,
    );
    const content: string[] = [];
    let closed = false;
    while (index < lines.length) {
      const inner = lines[index] ?? '';
      index += 1;
      if (closing.test(inner)) {
        closed = true;
        break;
      }
      content.push(stripIndent(inner, indent.length));
    }
    segments.push({ kind: 'fence', info: rest.trim(), content: content.join('\n'), closed });
  }
  endProse();
  return segments;
}

/**
 * The complete fenced code blocks in a Markdown answer, in order. A block that
 * is never closed (an answer cut off mid-way) is not returned.
 */
export function fencedBlocks(markdown: string): FencedBlock[] {
  return markdownSegments(markdown).flatMap((segment) =>
    segment.kind === 'fence' && segment.closed
      ? [{ info: segment.info, content: segment.content }]
      : [],
  );
}

function stripIndent(line: string, count: number): string {
  let removed = 0;
  while (removed < count && line[removed] === ' ') removed += 1;
  return line.slice(removed);
}
