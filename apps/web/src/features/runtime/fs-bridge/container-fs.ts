/**
 * The part of a file system the bridge uses. WebContainer's `fs` satisfies it
 * as-is; tests use an in-memory fake. Paths are relative to the working
 * directory.
 */
export type ContainerFs = {
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
};
