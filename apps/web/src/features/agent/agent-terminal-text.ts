/**
 * Run output as the agent reads it: the plain text a person saw
 * (lib/terminal-text.ts), without the animation a person glances past. npm's
 * spinner can leave frames of its own on a line; they only cost tokens and
 * attention, so lines that are nothing but spinner glyphs go, and so do runs
 * of blank lines.
 */
import { plainTerminalText } from '../../lib/terminal-text.js';

/** Braille-pattern spinner frames (⠋⠙⠹…), as npm and many CLIs draw them. */
const SPINNER_ONLY = /^\s*[⠀-⣿]+\s*$/;
const LEADING_FRAMES = /^[⠀-⣿]+\s?/;

export function agentTerminalText(raw: string): string {
  return plainTerminalText(raw)
    .split('\n')
    .filter((line) => !SPINNER_ONLY.test(line))
    .map((line) => line.replace(LEADING_FRAMES, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
