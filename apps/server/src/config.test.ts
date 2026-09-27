import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pw@host/db?sslmode=require',
  ALLOWED_ORIGINS: 'http://localhost:5173,https://collabcode.example',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(validEnv);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 8080,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      CLIENT_IP_SOURCE: 'render',
    });
  });

  it('accepts direct as the client IP source for running without a proxy', () => {
    expect(loadConfig({ ...validEnv, CLIENT_IP_SOURCE: 'direct' }).CLIENT_IP_SOURCE).toBe('direct');
  });

  it('splits and trims the origin list', () => {
    expect(
      loadConfig({ ...validEnv, ALLOWED_ORIGINS: ' http://a.test , https://b.test ' }),
    ).toMatchObject({ ALLOWED_ORIGINS: ['http://a.test', 'https://b.test'] });
  });

  it('treats an empty origin list as no allowed origins', () => {
    expect(loadConfig({ ...validEnv, ALLOWED_ORIGINS: '' }).ALLOWED_ORIGINS).toEqual([]);
  });

  it('coerces PORT from a string, as the platform provides it', () => {
    expect(loadConfig({ ...validEnv, PORT: '10000' }).PORT).toBe(10_000);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: 'http://localhost:5173' })).toThrow(ConfigError);
  });

  it.each([
    ['a non-postgres DATABASE_URL', { DATABASE_URL: 'mysql://host/db' }],
    ['a port that is not a number', { PORT: 'http' }],
    ['a port out of range', { PORT: '70000' }],
    ['an unknown log level', { LOG_LEVEL: 'chatty' }],
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }],
    ['an origin with a path', { ALLOWED_ORIGINS: 'https://a.test/app' }],
    ['an origin with a trailing slash', { ALLOWED_ORIGINS: 'https://a.test/' }],
    ['an origin that is not a URL', { ALLOWED_ORIGINS: 'a.test' }],
    ['an unknown client IP source', { CLIENT_IP_SOURCE: 'cloudflare' }],
  ])('fails fast on %s', (_label, overrides) => {
    expect(() => loadConfig({ ...validEnv, ...overrides })).toThrow(ConfigError);
  });

  it('names the offending variable in the error', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'nope' })).toThrow(/DATABASE_URL/);
  });
});
