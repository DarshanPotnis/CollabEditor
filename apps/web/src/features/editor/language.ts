/**
 * The editor language comes from the file name, never from a dropdown. That
 * removes a whole class of bug by design: there is no language setting to get
 * out of sync between collaborators.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  sql: 'sql',
};

const LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

export const DEFAULT_LANGUAGE = 'plaintext';

export function languageForFileName(fileName: string): string {
  const name = fileName.trim().toLowerCase();
  if (name === '') return DEFAULT_LANGUAGE;

  const byName = LANGUAGE_BY_FILENAME[name];
  if (byName) return byName;

  const lastDot = name.lastIndexOf('.');
  // A leading dot means a dotfile (.env), not an extension.
  if (lastDot <= 0) return DEFAULT_LANGUAGE;

  return LANGUAGE_BY_EXTENSION[name.slice(lastDot + 1)] ?? DEFAULT_LANGUAGE;
}
