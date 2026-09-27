/**
 * The parts of a prompt that describe a selection and the lines around it,
 * shared by "Explain" and "Edit with AI".
 */
import { fence, lineCount, numberLines } from '../prompt-text.js';

export function selectionHeader(path: string, language: string): string {
  return `File: ${path}\nLanguage: ${language === '' ? 'unknown' : language}`;
}

type ContextSectionInput = {
  selection: string;
  startLine: number;
  before: string;
  after: string;
  language: string;
  /**
   * Line numbers help an explanation point at lines. An edit leaves them out,
   * so the model copies clean code back.
   */
  numbered: boolean;
};

export function contextSection({
  selection,
  startLine,
  before,
  after,
  language,
  numbered,
}: ContextSectionInput): string {
  const endLine = startLine + lineCount(selection) - 1;
  const show = (text: string, firstLine: number): string =>
    fence(numbered ? numberLines(text, firstLine) : text, language);

  const sections = [
    `${numbered ? `Selected code (lines ${String(startLine)}-${String(endLine)})` : 'Selected code to replace'}:\n${show(selection, startLine)}`,
  ];
  if (before !== '') {
    sections.push(
      `Lines before the selection, for context only:\n${show(before, Math.max(1, startLine - lineCount(before)))}`,
    );
  }
  if (after !== '') {
    sections.push(`Lines after the selection, for context only:\n${show(after, endLine + 1)}`);
  }
  return sections.join('\n\n');
}
