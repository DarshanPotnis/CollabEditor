/**
 * Run output as the agent reads it: the plain text a person saw
 * (lib/terminal-text.ts), without the animation a person glances past, which
 * only costs tokens and attention.
 *
 * npm draws its spinner one frame at a time, each right after moving the
 * cursor to the first column and clearing the line (ESC[1G ESC[0K). In the
 * WebContainer's terminal the frames are ASCII (- \ | /), elsewhere braille.
 * The last frame is not always cleared, so it can end up in front of the next
 * line ("/28 packages are looking for funding"). A frame is therefore one
 * spinner character with such a cursor move on at least one side; a real "-"
 * or "|" line in a program's output has none, and is kept.
 */
import { plainTerminalText } from '../../lib/terminal-text.js';

const FRAME = '[-\\\\|/\u2800-\u28ff]';
const TO_FIRST_COLUMN = '\x1b\\[[01]?G(?:\x1b\\[[0-2]?K)?';
/** A frame drawn right after a move to the first column, and not followed by more text. */
const FRAME_AFTER_MOVE = new RegExp(`(${TO_FIRST_COLUMN})${FRAME}(?=\x1b|\r|\n|$)`, 'g');
/** A frame at the start of a line, cleared by the move that follows it. */
const FRAME_BEFORE_MOVE = new RegExp(`(^|[\r\n])${FRAME}(?=${TO_FIRST_COLUMN})`, 'g');

/** Braille-pattern spinner glyphs (⠋⠙⠹…) left on a line of their own, or leading one. */
const SPINNER_ONLY = /^\s*[\u2800-\u28ff]+\s*$/;
const LEADING_FRAMES = /^[\u2800-\u28ff]+\s?/;

export function agentTerminalText(raw: string): string {
  const withoutFrames = raw.replace(FRAME_AFTER_MOVE, '$1').replace(FRAME_BEFORE_MOVE, '$1');
  return plainTerminalText(withoutFrames)
    .split('\n')
    .filter((line) => !SPINNER_ONLY.test(line))
    .map((line) => line.replace(LEADING_FRAMES, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
