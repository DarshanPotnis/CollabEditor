import { describe, expect, it } from 'vitest';
import { PREVIEW_SANDBOX, previewUrl } from './preview-sandbox.js';

describe('PREVIEW_SANDBOX', () => {
  it('never lets the preview navigate the workspace or open windows', () => {
    const tokens = PREVIEW_SANDBOX.split(' ');
    expect(tokens.some((token) => token.startsWith('allow-top-navigation'))).toBe(false);
    expect(tokens).not.toContain('allow-popups');
    expect(tokens).not.toContain('allow-modals');
    expect(tokens.sort()).toEqual(['allow-forms', 'allow-same-origin', 'allow-scripts']);
  });
});

describe('previewUrl', () => {
  const server = 'https://abc--3000--def.local-corp.webcontainer-api.io';

  it('joins a path to the server URL', () => {
    expect(previewUrl(server, '/users?limit=2')).toBe(`${server}/users?limit=2`);
    expect(previewUrl(server, '')).toBe(`${server}/`);
  });

  it('refuses anything that would leave the preview server', () => {
    expect(previewUrl(server, '//evil.example/x')).toBeNull();
    expect(previewUrl(server, 'https://evil.example')).toBeNull();
    expect(previewUrl(server, 'users')).toBeNull();
    expect(previewUrl(server, '/a b')).toBeNull();
    expect(previewUrl('not a url', '/')).toBeNull();
  });
});
