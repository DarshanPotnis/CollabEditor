import { describe, expect, it } from 'vitest';
import { applyEnvFile } from './local-env.js';

const FILE = [
  '# Local settings',
  'DATABASE_URL=postgresql://local/db',
  'LOG_LEVEL="debug"',
  'PORT=8080',
  '',
].join('\n');

describe('applyEnvFile', () => {
  it('lets the file win over a variable already set, and names it', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: 'jdbc:postgresql://elsewhere/other' };
    expect(applyEnvFile(FILE, env)).toEqual(['DATABASE_URL']);
    expect(env['DATABASE_URL']).toBe('postgresql://local/db');
  });

  it('adds variables that were not set, without naming them', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(applyEnvFile(FILE, env)).toEqual([]);
    expect(env).toMatchObject({ LOG_LEVEL: 'debug', PORT: '8080' });
  });

  it('does not name a variable that already had the same value', () => {
    expect(applyEnvFile(FILE, { PORT: '8080' })).toEqual([]);
  });

  it('leaves variables the file does not mention alone', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/home/me' };
    applyEnvFile(FILE, env);
    expect(env['HOME']).toBe('/home/me');
  });
});
