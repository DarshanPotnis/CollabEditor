/**
 * Size caps and field schemas shared by the prompts' input schemas. The caps
 * bound what one request can cost; the browser uses the same numbers to trim
 * context before sending, so a request is only refused when the part the user
 * chose (a selection, an instruction) is itself too long.
 */
import { z } from 'zod';

export const AI_INPUT_LIMITS = {
  pathChars: 1_024,
  selectionChars: 12_000,
  contextChars: 4_000,
  instructionChars: 1_000,
  terminalChars: 12_000,
  excerptChars: 8_000,
} as const;

/** Highest line number a prompt accepts, far beyond what the file-size limit allows. */
const MAX_LINE = 1_000_000;

export const promptPathSchema = z.string().min(1).max(AI_INPUT_LIMITS.pathChars);

/** A Monaco language id such as `javascript`, or empty when unknown. */
export const promptLanguageSchema = z.string().regex(/^[\w.+#-]{0,40}$/, 'Unknown language.');

export const promptLineSchema = z.number().int().min(1).max(MAX_LINE);

/** Text of at most `max` characters, with a message a person can act on. */
export function cappedText(max: number, what: string): z.ZodString {
  return z
    .string()
    .max(
      max,
      `${what} is too long for the AI helper (at most ${max.toLocaleString('en-US')} characters).`,
    );
}
