/**
 * WebContainer reports ES-module stack frames at the wrong line: it runs them
 * through a transform that shifts the line by an amount that depends on the
 * module (+11 and +13 measured, docs/PLAN-AI.md §4). Node in the sandbox
 * reports the right line, so a task that tests the agent against that trap
 * (fixing a crash by its code, not by the frame's line number) emulates the
 * shift on what the sandbox prints. Only project ES modules are shifted;
 * CommonJS frames are exact in WebContainer too.
 */
const PROJECT_FRAME = /(file:\/\/\/work\/project\/[^\s:()]+?\.m?js):(\d+):(\d+)/g;

export function shiftStackLines(text: string, lines: number): string {
  if (lines === 0) return text;
  return text.replace(
    PROJECT_FRAME,
    (_frame: string, file: string, line: string, column: string) =>
      `${file}:${String(Number(line) + lines)}:${column}`,
  );
}
