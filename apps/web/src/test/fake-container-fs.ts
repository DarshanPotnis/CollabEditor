/**
 * Test fixture: an in-memory file system that behaves like a real one where
 * the bridge depends on it (a write fails when the parent folder is missing,
 * removing a non-empty folder needs `recursive`), and records every call.
 */
import type { ContainerFs } from '../features/runtime/fs-bridge/container-fs.js';

class FsError extends Error {
  constructor(
    readonly code: string,
    path: string,
  ) {
    super(`${code}: ${path}`);
  }
}

const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/');

export class FakeContainerFs implements ContainerFs {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>(['']);
  readonly calls: string[] = [];
  /** Paths whose next write fails, once. */
  readonly failNextWrite = new Set<string>();

  private requireDir(path: string): void {
    if (!this.dirs.has(path)) throw new FsError('ENOENT', path);
  }

  writeFile = (path: string, data: string): Promise<void> => {
    this.calls.push(`write ${path}`);
    if (this.failNextWrite.delete(path)) return Promise.reject(new FsError('EIO', path));
    this.requireDir(parentOf(path));
    if (this.dirs.has(path)) return Promise.reject(new FsError('EISDIR', path));
    this.files.set(path, data);
    return Promise.resolve();
  };

  mkdir = (path: string, _options: { recursive: true }): Promise<unknown> => {
    this.calls.push(`mkdir ${path}`);
    const parts = path.split('/');
    for (let index = 1; index <= parts.length; index += 1) {
      const dir = parts.slice(0, index).join('/');
      if (this.files.has(dir)) return Promise.reject(new FsError('EEXIST', dir));
      this.dirs.add(dir);
    }
    return Promise.resolve(path);
  };

  rm = (path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> => {
    this.calls.push(`rm ${path}`);
    if (this.files.delete(path)) return Promise.resolve();
    if (!this.dirs.has(path)) {
      return options?.force ? Promise.resolve() : Promise.reject(new FsError('ENOENT', path));
    }
    const inside = [...this.files.keys(), ...this.dirs].filter((each) =>
      each.startsWith(`${path}/`),
    );
    if (inside.length > 0 && !options?.recursive)
      return Promise.reject(new FsError('ENOTEMPTY', path));
    for (const each of inside) {
      this.files.delete(each);
      this.dirs.delete(each);
    }
    this.dirs.delete(path);
    return Promise.resolve();
  };

  readdir = (path: string): Promise<string[]> => {
    this.requireDir(path);
    const prefix = path === '' ? '' : `${path}/`;
    const children = [...this.files.keys(), ...this.dirs]
      .filter(
        (each) =>
          each !== path && each.startsWith(prefix) && !each.slice(prefix.length).includes('/'),
      )
      .map((each) => each.slice(prefix.length));
    return Promise.resolve(children);
  };

  /** Every file path, sorted, for assertions. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}
