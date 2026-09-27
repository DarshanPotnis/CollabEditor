/**
 * An interactive shell (`jsh`, WebContainer's shell) in the running project's
 * container. Its output has its own buffer, so switching away from the Shell
 * tab and back replays the session instead of losing it.
 */
import type { Container } from './container.js';
import { createOutputBuffer, type OutputBuffer } from './output-buffer.js';

export type ShellSession = {
  output: OutputBuffer;
  write: (data: string) => void;
  resize: (size: { cols: number; rows: number }) => void;
  /** Resolves with the exit code when the shell ends (for example, `exit`). */
  exited: Promise<number>;
  dispose: () => void;
};

const DEFAULT_SIZE = { cols: 80, rows: 24 };

export async function startShell(
  container: Container,
  onError: (error: unknown) => void,
): Promise<ShellSession> {
  const shell = await container.spawn('jsh', [], { terminal: DEFAULT_SIZE });
  const output = createOutputBuffer();
  const input = shell.input.getWriter();
  let disposed = false;

  shell.output
    .pipeTo(new WritableStream({ write: (chunk) => output.write(chunk) }))
    .catch((error: unknown) => {
      if (!disposed) onError(error);
    });

  return {
    output,
    write(data) {
      if (disposed) return;
      input.write(data).catch((error: unknown) => {
        if (!disposed) onError(error);
      });
    },
    resize(size) {
      if (!disposed && size.cols > 0 && size.rows > 0) shell.resize(size);
    },
    exited: shell.exit,
    dispose() {
      if (disposed) return;
      disposed = true;
      input.releaseLock();
      shell.kill();
    },
  };
}
