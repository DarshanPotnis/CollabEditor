import { describe, expect, it } from 'vitest';
import { WebConfigError, loadWebConfig } from './config.js';

const valid = {
  VITE_API_URL: 'http://localhost:8080',
  VITE_COLLAB_URL: 'ws://localhost:8080/collab',
};

describe('loadWebConfig', () => {
  it('accepts a valid pair', () => {
    expect(loadWebConfig(valid)).toEqual({
      apiUrl: 'http://localhost:8080',
      collabUrl: 'ws://localhost:8080/collab',
    });
  });

  it('strips trailing slashes so built URLs do not double up', () => {
    expect(
      loadWebConfig({
        VITE_API_URL: 'https://api.example.com/',
        VITE_COLLAB_URL: 'wss://api.example.com/collab/',
      }),
    ).toEqual({ apiUrl: 'https://api.example.com', collabUrl: 'wss://api.example.com/collab' });
  });

  it.each([
    ['a missing api url', { VITE_COLLAB_URL: valid.VITE_COLLAB_URL }],
    ['a missing collab url', { VITE_API_URL: valid.VITE_API_URL }],
    ['an http collab url', { ...valid, VITE_COLLAB_URL: 'http://localhost:8080/collab' }],
    ['a ws api url', { ...valid, VITE_API_URL: 'ws://localhost:8080' }],
    ['a bare host', { ...valid, VITE_API_URL: 'localhost:8080' }],
  ])('rejects %s', (_label, env) => {
    expect(() => loadWebConfig(env)).toThrow(WebConfigError);
  });

  it('names the offending variable', () => {
    expect(() => loadWebConfig({ ...valid, VITE_COLLAB_URL: 'nope' })).toThrow(/VITE_COLLAB_URL/);
  });
});
