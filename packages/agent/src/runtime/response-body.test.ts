import { describe, expect, it } from 'vitest';
import { formatBody } from './response-body.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const json: Array<[string, string]> = [['content-type', 'application/json; charset=utf-8']];

describe('formatBody', () => {
  it('pretty-prints JSON', () => {
    expect(formatBody(utf8('{"a":[1,2]}'), json)).toEqual({
      kind: 'json',
      text: '{\n  "a": [\n    1,\n    2\n  ]\n}',
    });
  });

  it('recognises JSON sent without a JSON content type', () => {
    expect(formatBody(utf8('[1]'), []).kind).toBe('json');
  });

  it('shows invalid JSON exactly as it came', () => {
    expect(formatBody(utf8('{"a":'), json)).toEqual({ kind: 'text', text: '{"a":' });
  });

  it('shows HTML as text, never as markup', () => {
    expect(formatBody(utf8('<script>alert(1)</script>'), [['content-type', 'text/html']])).toEqual({
      kind: 'text',
      text: '<script>alert(1)</script>',
    });
  });

  it('shows non-UTF-8 bytes as binary with a hex preview', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(formatBody(bytes, [['content-type', 'image/jpeg']])).toEqual({
      kind: 'binary',
      size: 5,
      preview: 'ff d8 ff e0 00',
    });
  });

  it('says when there is no body', () => {
    expect(formatBody(new Uint8Array(), json)).toEqual({ kind: 'empty' });
  });
});
