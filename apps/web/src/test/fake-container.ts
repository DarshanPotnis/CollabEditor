/**
 * Test fixture: a container whose processes the test controls. `npm install`
 * exits on its own with `installExitCode` (or keeps running when it is null);
 * every other process runs until the test finishes it or the runner kills it.
 * Like a real process, a killed one can still deliver output it had buffered.
 */
import type { Container, ContainerProcess, PortListener } from '../features/runtime/container.js';
import { FakeContainerFs } from './fake-container-fs.js';

export class FakeProcess implements ContainerProcess {
  readonly exit: Promise<number>;
  readonly output: ReadableStream<string>;
  readonly input: WritableStream<string>;
  readonly received: string[] = [];
  readonly sizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  private exited = false;
  private closed = false;
  private resolveExit: (code: number) => void = () => undefined;
  private controller: ReadableStreamDefaultController<string> | null = null;

  constructor(
    readonly command: string,
    readonly args: readonly string[],
  ) {
    this.exit = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    this.output = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.input = new WritableStream({
      write: (chunk: string) => {
        this.received.push(chunk);
      },
    });
  }

  get commandLine(): string {
    return [this.command, ...this.args].join(' ');
  }

  print(text: string): void {
    if (!this.closed) this.controller?.enqueue(text);
  }

  /** Exit with a code and close the output stream. */
  finish(code: number): void {
    this.exitWith(code);
    if (this.closed) return;
    this.closed = true;
    this.controller?.close();
  }

  private exitWith(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.resolveExit(code);
  }

  /** Exits at once, but leaves output that was already on its way. */
  kill = (): void => {
    this.killed = true;
    this.exitWith(143);
  };

  resize = (size: { cols: number; rows: number }): void => {
    this.sizes.push(size);
  };
}

export class FakeContainer implements Container {
  readonly fs = new FakeContainerFs();
  readonly processes: FakeProcess[] = [];
  installExitCode: number | null = 0;
  private readonly portListeners = new Set<PortListener>();

  spawn = (command: string, args: string[]): Promise<ContainerProcess> => {
    const child = new FakeProcess(command, args);
    this.processes.push(child);
    if (child.commandLine === 'npm install') {
      child.print('added 64 packages\r\n');
      const code = this.installExitCode;
      if (code !== null) queueMicrotask(() => child.finish(code));
    }
    return Promise.resolve(child);
  };

  onPort = (listener: PortListener): (() => void) => {
    this.portListeners.add(listener);
    return () => {
      this.portListeners.delete(listener);
    };
  };

  emitPort(port: number, type: 'open' | 'close', url = `https://p-${String(port)}.example`): void {
    for (const listener of this.portListeners) listener(port, type, url);
  }

  commandLines(): string[] {
    return this.processes.map((each) => each.commandLine);
  }

  /** The most recent process started with this command line. */
  last(commandLine: string): FakeProcess {
    const found = this.processes.filter((each) => each.commandLine === commandLine).at(-1);
    if (!found) throw new Error(`no ${commandLine} was started`);
    return found;
  }
}
