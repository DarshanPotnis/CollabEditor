/**
 * The part of a WebContainer the runner uses. webcontainer.ts adapts the real
 * one; tests use a fake. Keeping the runner behind this also keeps
 * @webcontainer/api out of the main bundle: it is imported only on first Run.
 */
import type { ContainerFs } from './fs-bridge/container-fs.js';

export type ContainerProcess = {
  exit: Promise<number>;
  output: ReadableStream<string>;
  input: WritableStream<string>;
  kill: () => void;
  resize: (size: { cols: number; rows: number }) => void;
};

export type SpawnOptions = { terminal?: { cols: number; rows: number } };

export type PortListener = (port: number, type: 'open' | 'close', url: string) => void;

export type Container = {
  fs: ContainerFs;
  spawn: (command: string, args: string[], options?: SpawnOptions) => Promise<ContainerProcess>;
  /** Returns an unsubscribe function. */
  onPort: (listener: PortListener) => () => void;
};
