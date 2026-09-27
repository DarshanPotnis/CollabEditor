/**
 * Where a crash points in the project, read from Node's output, so Explain
 * with AI can send the code around it.
 *
 * Paths in the output are the container's (`/home/…/routes/users.js`, or a
 * `file://` URL for ES modules). The container's working directory is not
 * something to rely on, so a path is matched by its longest ending that is a
 * project file; anything under node_modules is never the project's.
 *
 * The latest error wins: output can hold several runs. From the last error
 * message line, the first project location after it is the innermost project
 * frame of its stack. If the stack has none, the `file:line` header Node
 * prints above an uncaught error's message is used instead.
 *
 * Line numbers are only exact for CommonJS. WebContainer runs ES modules
 * (the frames printed as `file://` URLs) through a transform that shifts
 * their lines by an amount that depends on the module: 11 and 13 lines in two
 * files measured in September 2026. Columns are right either way.
 */

export type StackLocation = {
  path: string;
  line: number;
  /** False for ES module frames, whose line numbers WebContainer shifts. */
  exactLine: boolean;
};

const LOCATION = /(file:\/\/)?(\/[^\s:()'"`]+):(\d+)(?::\d+)?/g;
const ERROR_MESSAGE = /^\s*(?:Uncaught\s+)?(?:[A-Z]\w*)?(?:Error|Exception)\b/;

/** The project path an absolute container path refers to, if any. */
export function projectPath(absolute: string, projectPaths: ReadonlySet<string>): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(absolute);
  } catch {
    // A malformed escape: the path as printed is the best there is.
    decoded = absolute;
  }
  if (decoded.includes('/node_modules/')) return null;
  const parts = decoded.split('/').filter((part) => part !== '');
  for (let start = 0; start < parts.length; start += 1) {
    const candidate = parts.slice(start).join('/');
    if (projectPaths.has(candidate)) return candidate;
  }
  return null;
}

function locationIn(line: string, projectPaths: ReadonlySet<string>): StackLocation | null {
  for (const match of line.matchAll(LOCATION)) {
    const path = projectPath(match[2] ?? '', projectPaths);
    const lineNumber = Number(match[3]);
    if (path !== null && lineNumber >= 1) {
      return { path, line: lineNumber, exactLine: match[1] === undefined };
    }
  }
  return null;
}

export function crashLocation(
  output: string,
  projectPaths: ReadonlySet<string>,
): StackLocation | null {
  const lines = output.split('\n');
  const lastMessage = lines.findLastIndex((line) => ERROR_MESSAGE.test(line));
  const from = lastMessage === -1 ? 0 : lastMessage;
  for (let index = from; index < lines.length; index += 1) {
    const found = locationIn(lines[index] ?? '', projectPaths);
    if (found) return found;
  }
  for (let index = from - 1; index >= 0; index -= 1) {
    const found = locationIn(lines[index] ?? '', projectPaths);
    if (found) return found;
  }
  return null;
}
