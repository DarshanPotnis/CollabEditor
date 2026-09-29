import { describe, expect, it } from 'vitest';
import {
  MAX_REQUEST_BODY_BYTES,
  buildRequest,
  parseHeadersText,
  type RequestForm,
} from './request-form.js';

const form = (overrides: Partial<RequestForm>): RequestForm => ({
  method: 'GET',
  path: '/users',
  headersText: '',
  body: '',
  ...overrides,
});

describe('parseHeadersText', () => {
  it('reads name: value lines, skipping blanks and trimming', () => {
    expect(parseHeadersText('Accept: application/json\n\n  X-Trace :  abc  \n')).toEqual({
      ok: true,
      headers: [
        ['Accept', 'application/json'],
        ['X-Trace', 'abc'],
      ],
    });
  });

  it('keeps colons in values', () => {
    expect(parseHeadersText('X-Time: 12:30:00')).toEqual({
      ok: true,
      headers: [['X-Time', '12:30:00']],
    });
  });

  it.each([
    ['a line without a colon', 'Accept application/json', /needs a colon/],
    ['a name with spaces', 'My Header: x', /not a valid header name/],
    ['a header set automatically', 'Content-Length: 5', /set automatically/],
    ['Host', 'host: evil.example', /set automatically/],
  ])('refuses %s', (_label, text, message) => {
    const result = parseHeadersText(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});

describe('buildRequest', () => {
  it('builds a GET with no body', () => {
    expect(buildRequest(form({}))).toEqual({
      ok: true,
      request: { method: 'GET', path: '/users', headers: [], body: null },
    });
  });

  it('adds a JSON content type to a JSON body', () => {
    const built = buildRequest(form({ method: 'POST', body: '{"name":"Grace"}' }));
    expect(built).toMatchObject({
      ok: true,
      request: { headers: [['Content-Type', 'application/json']], body: '{"name":"Grace"}' },
    });
  });

  it('sends a non-JSON body as text when no content type was given', () => {
    const built = buildRequest(form({ method: 'POST', body: 'hello' }));
    expect(built).toMatchObject({
      request: { headers: [['Content-Type', 'text/plain; charset=utf-8']] },
    });
  });

  it('refuses invalid JSON when the content type says JSON', () => {
    const built = buildRequest(
      form({ method: 'POST', headersText: 'Content-Type: application/json', body: '{"name":' }),
    );
    expect(built).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^The body is not valid JSON/) as unknown,
    });
  });

  it.each([
    ['a full URL', form({ path: 'http://localhost:3000/users' }), /Enter a path like \/users/],
    ['a path without a slash', form({ path: 'users' }), /must start with \//],
    ['a path with spaces', form({ path: '/a b' }), /no spaces/],
    ['a GET with a body', form({ body: '{}' }), /GET requests can't have a body/],
    [
      'an oversized body',
      form({ method: 'PUT', body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1) }),
      /over 256 KB/,
    ],
  ])('refuses %s', (_label, input, message) => {
    const built = buildRequest(input);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.message).toMatch(message);
  });
});
