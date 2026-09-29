/**
 * Model output as blocks the panel can render as plain React elements:
 * paragraphs with inline code, and code blocks. There is no Markdown library
 * and no HTML: whatever the model writes ends up as text in the page, never as
 * markup (docs/PLAN-AI.md §8). Brute force: headings, lists and emphasis stay
 * as the characters the model wrote.
 *
 * Fences are read by the same parser the edit prompt uses to extract its
 * answer, so the app and the evals agree on what counts as a code block.
 */
import { markdownSegments } from '@collabcode/shared';

export type AiTextSpan = { kind: 'text' | 'code'; text: string };

export type AiTextBlock =
  | { kind: 'paragraph'; spans: AiTextSpan[] }
  /** `complete` is false while the block's closing fence has not arrived. */
  | { kind: 'code'; language: string; code: string; complete: boolean };

const INLINE_CODE = /`([^`\n]+)`/g;

/** Text with `inline code` split out. A backtick without a partner stays text. */
export function inlineSpans(text: string): AiTextSpan[] {
  const spans: AiTextSpan[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_CODE)) {
    if (match.index > last) spans.push({ kind: 'text', text: text.slice(last, match.index) });
    spans.push({ kind: 'code', text: match[1] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) });
  return spans;
}

function paragraphs(prose: string): AiTextBlock[] {
  return prose
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => ({ kind: 'paragraph', spans: inlineSpans(paragraph) }));
}

export function aiTextBlocks(markdown: string): AiTextBlock[] {
  return markdownSegments(markdown).flatMap((segment): AiTextBlock[] =>
    segment.kind === 'text'
      ? paragraphs(segment.text)
      : [
          {
            kind: 'code',
            language: segment.info.split(/\s/)[0] ?? '',
            code: segment.content,
            complete: segment.closed,
          },
        ],
  );
}
