import { describe, expect, it, vi } from 'vitest';
import { FakeContainer } from '../../test/fake-container.js';
import { startShell } from './shell-session.js';

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('startShell', () => {
  it('starts jsh with a terminal and forwards keystrokes and output', async () => {
    const container = new FakeContainer();
    const shell = await startShell(container, vi.fn());
    const process = container.last('jsh');

    shell.write('ls\r');
    process.print('index.js  package.json\r\n');
    await tick();

    expect(process.received).toEqual(['ls\r']);
    let seen = '';
    shell.output.attach({ write: (text) => (seen += text) });
    expect(seen).toBe('index.js  package.json\r\n');
  });

  it('passes on terminal resizes, ignoring an empty size from a hidden tab', async () => {
    const container = new FakeContainer();
    const shell = await startShell(container, vi.fn());
    shell.resize({ cols: 120, rows: 30 });
    shell.resize({ cols: 0, rows: 0 });
    expect(container.last('jsh').sizes).toEqual([{ cols: 120, rows: 30 }]);
  });

  it('reports when the shell exits', async () => {
    const container = new FakeContainer();
    const shell = await startShell(container, vi.fn());
    container.last('jsh').finish(0);
    await expect(shell.exited).resolves.toBe(0);
  });

  it('kills the shell on dispose and ignores input afterwards', async () => {
    const container = new FakeContainer();
    const onError = vi.fn();
    const shell = await startShell(container, onError);
    shell.dispose();
    shell.write('echo late\r');
    await tick();
    expect(container.last('jsh').killed).toBe(true);
    expect(container.last('jsh').received).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
});
