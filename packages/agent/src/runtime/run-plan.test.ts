import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@collabcode/shared';
import { installKey, needsInstall, runPlan } from './run-plan.js';

const pkg = (value: unknown): string => JSON.stringify(value);

describe('runPlan', () => {
  it('prefers dev, then start', () => {
    expect(runPlan(pkg({ scripts: { dev: 'a', start: 'b' } }))).toMatchObject({
      kind: 'ready',
      script: 'dev',
      args: ['run', 'dev'],
    });
    expect(runPlan(pkg({ scripts: { start: 'b' } }))).toMatchObject({
      script: 'start',
      args: ['start'],
    });
  });

  it.each([
    ['no package.json', undefined, /no package\.json/],
    ['invalid JSON', '{ "scripts": ', /not valid JSON/],
    ['a JSON array', '[]', /must be an object/],
    ['scripts that are not strings', pkg({ scripts: { dev: 42 } }), /must map names to commands/],
    ['no dev or start script', pkg({ scripts: { test: 'vitest' } }), /no "dev" or "start" script/],
    ['no scripts at all', pkg({ name: 'x' }), /no "dev" or "start" script/],
  ])('explains %s', (_label, input, message) => {
    const plan = runPlan(input);
    expect(plan.kind).toBe('problem');
    if (plan.kind === 'problem') expect(plan.message).toMatch(message);
  });

  it('runs every template', () => {
    for (const template of Object.values(TEMPLATES)) {
      const file = template.files.find((each) => each.path === 'package.json');
      expect(runPlan(file?.content)).toMatchObject({ kind: 'ready', script: 'dev' });
    }
  });
});

describe('installKey and needsInstall', () => {
  it('ignores scripts, formatting and key order', () => {
    const a = installKey({ scripts: { dev: 'x' }, dependencies: { b: '1', a: '2' } });
    const b = installKey({
      dependencies: { a: '2', b: '1' },
      scripts: { dev: 'y' },
      name: 'renamed',
    });
    expect(a).toBe(b);
  });

  it('changes when a dependency changes', () => {
    expect(installKey({ dependencies: { a: '1' } })).not.toBe(
      installKey({ dependencies: { a: '2' } }),
    );
    expect(installKey({ dependencies: { a: '1' } })).not.toBe(
      installKey({ dependencies: { a: '1' }, devDependencies: { t: '1' } }),
    );
  });

  it('skips install when there is nothing to install, or it is already done', () => {
    expect(needsInstall(installKey({ scripts: {} }), null)).toBe(false);
    const key = installKey({ dependencies: { express: '^5.2.1' } });
    expect(needsInstall(key, null)).toBe(true);
    expect(needsInstall(key, key)).toBe(false);
  });
});
