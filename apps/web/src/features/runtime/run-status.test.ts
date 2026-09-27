import { describe, expect, it } from 'vitest';
import { runStatus } from './run-status.js';

describe('runStatus', () => {
  it('describes each phase', () => {
    expect(runStatus({ phase: 'idle' })).toEqual({ text: 'Not running', tone: 'idle' });
    expect(runStatus({ phase: 'installing' }).tone).toBe('busy');
    expect(runStatus({ phase: 'starting', script: 'start' }).text).toMatch(/npm start/);
    expect(
      runStatus({ phase: 'serving', script: 'dev', server: { port: 3000, url: 'u' } }),
    ).toEqual({ text: 'Server running on port 3000', tone: 'ok' });
  });

  it('says how a crash recovers', () => {
    expect(runStatus({ phase: 'crashed', script: 'dev', reason: 'exited', exitCode: 1 }).text).toBe(
      'The program exited with code 1. Fix the error; the run restarts when a file changes.',
    );
    expect(runStatus({ phase: 'crashed', script: 'dev', reason: 'stopped-listening' }).tone).toBe(
      'error',
    );
  });

  it('shows a failure message as-is', () => {
    expect(runStatus({ phase: 'failed', message: 'No package.json' })).toEqual({
      text: 'No package.json',
      tone: 'error',
    });
  });
});
