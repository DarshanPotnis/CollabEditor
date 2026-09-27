import { aiStreamEventSchema } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import { encodeSseEvent } from './sse.js';

describe('encodeSseEvent', () => {
  it('writes one data line of JSON, then a blank line', () => {
    expect(encodeSseEvent({ type: 'text-delta', text: 'Hi' })).toBe(
      'data: {"type":"text-delta","text":"Hi"}\n\n',
    );
  });

  it('keeps model text containing line breaks and event syntax on one line', () => {
    const text = 'line one\n\ndata: {"type":"finish"}\r\nevent: error\n';
    const encoded = encodeSseEvent({ type: 'text-delta', text });

    const body = encoded.slice(0, -2);
    expect(body.includes('\n')).toBe(false);
    expect(body.includes('\r')).toBe(false);
    expect(aiStreamEventSchema.parse(JSON.parse(body.slice('data: '.length)))).toEqual({
      type: 'text-delta',
      text,
    });
  });
});
