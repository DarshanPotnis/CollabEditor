import { describe, expect, it } from 'vitest';
import { NOTHING_APPLIED, planSync } from './fs-plan.js';
import type { ProjectSnapshot } from './project-snapshot.js';

function snapshot(files: Record<string, string>, dirs: string[] = []): ProjectSnapshot {
  return { files: new Map(Object.entries(files)), dirs: new Set(dirs) };
}

describe('planSync', () => {
  it('writes everything on the first sync, creating folders shallowest first', () => {
    const desired = snapshot({ 'index.js': 'a', 'routes/v1/users.js': 'b' }, [
      'routes',
      'routes/v1',
    ]);
    expect(planSync(NOTHING_APPLIED, desired)).toEqual([
      { kind: 'mkdir', path: 'routes' },
      { kind: 'mkdir', path: 'routes/v1' },
      { kind: 'write', path: 'index.js', content: 'a' },
      { kind: 'write', path: 'routes/v1/users.js', content: 'b' },
    ]);
  });

  it('writes only what changed', () => {
    const applied = snapshot({ 'a.js': '1', 'b.js': '2' });
    expect(planSync(applied, snapshot({ 'a.js': '1', 'b.js': '3' }))).toEqual([
      { kind: 'write', path: 'b.js', content: '3' },
    ]);
  });

  it('does nothing when nothing changed', () => {
    const same = snapshot({ 'a.js': '1' }, ['lib']);
    expect(planSync(same, same)).toEqual([]);
  });

  it('turns a rename into a remove and a write', () => {
    expect(planSync(snapshot({ 'old.js': 'x' }), snapshot({ 'new.js': 'x' }))).toEqual([
      { kind: 'rm', path: 'old.js' },
      { kind: 'write', path: 'new.js', content: 'x' },
    ]);
  });

  it('removes folders it created deepest first, and only if empty', () => {
    const applied = snapshot({ 'a/b/c.js': 'x' }, ['a', 'a/b']);
    expect(planSync(applied, NOTHING_APPLIED)).toEqual([
      { kind: 'rm', path: 'a/b/c.js' },
      { kind: 'rmdir-if-empty', path: 'a/b' },
      { kind: 'rmdir-if-empty', path: 'a' },
    ]);
  });

  it('never removes a file it did not write', () => {
    // node_modules and package-lock.json were written by npm, not the bridge.
    const applied = snapshot({ 'package.json': '{}' });
    const ops = planSync(applied, snapshot({}));
    expect(ops).toEqual([{ kind: 'rm', path: 'package.json' }]);
  });

  it('lets a path change from a file to a folder in one sync', () => {
    const applied = snapshot({ lib: 'I was a file' });
    const desired = snapshot({ 'lib/index.js': 'now a folder' }, ['lib']);
    expect(planSync(applied, desired)).toEqual([
      { kind: 'rm', path: 'lib' },
      { kind: 'mkdir', path: 'lib' },
      { kind: 'write', path: 'lib/index.js', content: 'now a folder' },
    ]);
  });

  it('lets a path change from a folder to a file in one sync', () => {
    const applied = snapshot({ 'lib/index.js': 'x' }, ['lib']);
    const desired = snapshot({ lib: 'now a file' });
    expect(planSync(applied, desired)).toEqual([
      { kind: 'rm', path: 'lib/index.js' },
      { kind: 'rmdir-if-empty', path: 'lib' },
      { kind: 'write', path: 'lib', content: 'now a file' },
    ]);
  });
});
