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

  it('applies the AI defaults, with the shared tier off when there is no key', () => {
    const config = loadConfig(validEnv);
    expect(config.GEMINI_API_KEY).toBeUndefined();
    expect(config).toMatchObject({
      AI_DEFAULT_MODEL: 'gemini-3.5-flash-lite',
      AI_GLOBAL_DAILY_REQUESTS: 400,
      AI_PER_IP_DAILY_REQUESTS: 30,
      AI_PER_PROJECT_DAILY_REQUESTS: 60,
      AI_GLOBAL_REQUESTS_PER_MINUTE: 12,
      AI_AGENT_REQUESTS_PER_MINUTE: 6,
    });
  });

  it('treats an empty or blank key as no key, and trims a pasted one', () => {
    expect(loadConfig({ ...validEnv, GEMINI_API_KEY: '' }).GEMINI_API_KEY).toBeUndefined();
    expect(loadConfig({ ...validEnv, GEMINI_API_KEY: '   ' }).GEMINI_API_KEY).toBeUndefined();
    expect(loadConfig({ ...validEnv, GEMINI_API_KEY: ' AIzaTest \n' }).GEMINI_API_KEY).toBe(
      'AIzaTest',
    );
  });

  it('reads daily limits from strings, and an empty value as the default', () => {
    const config = loadConfig({
      ...validEnv,
      AI_GLOBAL_DAILY_REQUESTS: '10',
      AI_PER_IP_DAILY_REQUESTS: '',
      AI_PER_PROJECT_DAILY_REQUESTS: '0',
      AI_GLOBAL_REQUESTS_PER_MINUTE: '5',
      AI_AGENT_REQUESTS_PER_MINUTE: '2',
    });
    expect(config.AI_GLOBAL_REQUESTS_PER_MINUTE).toBe(5);
    expect(config.AI_AGENT_REQUESTS_PER_MINUTE).toBe(2);
    expect(config.AI_GLOBAL_DAILY_REQUESTS).toBe(10);
    expect(config.AI_PER_IP_DAILY_REQUESTS).toBe(30);
    expect(config.AI_PER_PROJECT_DAILY_REQUESTS).toBe(0);
  });

  it('never repeats the key in a configuration error', () => {
    const secret = 'AIza-SECRET-VALUE';
    expect(() =>
      loadConfig({ ...validEnv, GEMINI_API_KEY: secret, AI_DEFAULT_MODEL: 'gpt-5' }),
    ).toThrow(/AI_DEFAULT_MODEL/);
    try {
      loadConfig({ ...validEnv, GEMINI_API_KEY: secret, AI_DEFAULT_MODEL: 'gpt-5' });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('has no fallback model unless one is set, and takes only a Gemini one', () => {
    expect(loadConfig(validEnv).AI_FALLBACK_MODEL).toBeUndefined();
    expect(loadConfig({ ...validEnv, AI_FALLBACK_MODEL: '' }).AI_FALLBACK_MODEL).toBeUndefined();
    expect(
      loadConfig({ ...validEnv, AI_FALLBACK_MODEL: ' gemini-3.1-flash-lite ' }).AI_FALLBACK_MODEL,
    ).toBe('gemini-3.1-flash-lite');
    expect(() => loadConfig({ ...validEnv, AI_FALLBACK_MODEL: 'claude-haiku-4-5' })).toThrow(
      /AI_FALLBACK_MODEL/,
    );
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
    ['a default model that is not Gemini', { AI_DEFAULT_MODEL: 'claude-sonnet-5' }],
    ['a negative daily limit', { AI_PER_IP_DAILY_REQUESTS: '-1' }],
    ['a fractional daily limit', { AI_GLOBAL_DAILY_REQUESTS: '2.5' }],
  ])('fails fast on %s', (_label, overrides) => {
    expect(() => loadConfig({ ...validEnv, ...overrides })).toThrow(ConfigError);
  });

  it('names the offending variable in the error', () => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: 'nope' })).toThrow(/DATABASE_URL/);
  });
});
