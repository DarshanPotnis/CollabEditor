import { describe, expect, it } from 'vitest';
import { aiTextBlocks, inlineSpans } from './ai-text-blocks.js';

describe('inlineSpans', () => {
  it('splits out inline code', () => {
    expect(inlineSpans('Use `===` with `req.params.id`.')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: '===' },
      { kind: 'text', text: ' with ' },
      { kind: 'code', text: 'req.params.id' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps a backtick without a partner as text', () => {
    expect(inlineSpans('a ` b')).toEqual([{ kind: 'text', text: 'a ` b' }]);
  });

  it('does not let inline code cross a line break', () => {
    expect(inlineSpans('a `b\nc` d')).toEqual([{ kind: 'text', text: 'a `b\nc` d' }]);
  });
});

describe('aiTextBlocks', () => {
  it('turns blank-line separated prose into paragraphs, keeping single line breaks', () => {
    expect(aiTextBlocks('First line\nsame paragraph.\n\n  \nSecond.')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'First line\nsame paragraph.' }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Second.' }] },
    ]);
  });

  it('keeps code blocks apart from the prose around them', () => {
    expect(aiTextBlocks('Try this:\n```javascript\nconst x = 1;\n```\nDone.')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Try this:' }] },
      { kind: 'code', language: 'javascript', code: 'const x = 1;', complete: true },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Done.' }] },
    ]);
  });

  it('shows a code block that is still streaming', () => {
    expect(aiTextBlocks('```js\nconst x')).toEqual([
      { kind: 'code', language: 'js', code: 'const x', complete: false },
    ]);
  });

  it('takes the language from the first word of the info string', () => {
    expect(aiTextBlocks('```ts title="a.ts"\nx\n```')[0]).toMatchObject({ language: 'ts' });
    expect(aiTextBlocks('```\nx\n```')[0]).toMatchObject({ language: '' });
  });

  it('leaves markup as text for the page to show, not interpret', () => {
    expect(aiTextBlocks('<img src=x onerror=alert(1)> **bold**')).toEqual([
      {
        kind: 'paragraph',
        spans: [{ kind: 'text', text: '<img src=x onerror=alert(1)> **bold**' }],
      },
    ]);
  });

  it('returns nothing for an empty answer', () => {
    expect(aiTextBlocks('')).toEqual([]);
  });
});
