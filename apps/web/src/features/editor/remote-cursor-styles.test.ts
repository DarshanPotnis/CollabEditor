import { describe, expect, it } from 'vitest';
import { PRESENCE_COLORS, type AwarenessUser } from '@collabcode/shared';
import { remoteCursorStyles, type RemoteCursor } from './remote-cursor-styles.js';

function user(overrides: Partial<AwarenessUser> = {}): AwarenessUser {
  return { id: 'u1', name: 'Ada', color: PRESENCE_COLORS[0], kind: 'human', ...overrides };
}

function cursor(overrides: Partial<RemoteCursor> = {}): RemoteCursor {
  return { clientId: 42, user: user(), ...overrides };
}

describe('remoteCursorStyles', () => {
  it('is empty when nobody else is here', () => {
    expect(remoteCursorStyles([])).toBe('');
  });

  it('writes one rule set per client, keyed by the y-monaco class names', () => {
    const css = remoteCursorStyles([cursor({ clientId: 1 }), cursor({ clientId: 2 })]);
    expect(css).toContain('.yRemoteSelection-1');
    expect(css).toContain('.yRemoteSelectionHead-1');
    expect(css).toContain('.yRemoteSelection-2');
    expect(css).toContain('.yRemoteSelectionHead-2');
  });

  it('uses the collaborator colour for the caret and the label', () => {
    const css = remoteCursorStyles([cursor({ user: user({ color: PRESENCE_COLORS[3] }) })]);
    expect(css).toContain(`border-left: 2px solid ${PRESENCE_COLORS[3]}`);
    expect(css).toContain(`background-color: ${PRESENCE_COLORS[3]};`);
  });

  it('puts the name in the label', () => {
    expect(remoteCursorStyles([cursor({ user: user({ name: 'Grace Hopper' }) })])).toContain(
      'content: "Grace Hopper"',
    );
  });

  describe('hostile input', () => {
    it('escapes a name that tries to close the CSS string and add rules', () => {
      const css = remoteCursorStyles([
        cursor({ user: user({ name: '"; } body { display: none } .x { content: "' }) }),
      ]);
      // The payload survives as inert text inside a quoted string; what
      // matters is that it can never close that string.
      expect(css).toContain('content: "\\"; } body { display: none } .x { content: \\""');
    });

    it('escapes a name containing a backslash, so the escape cannot be forged', () => {
      const css = remoteCursorStyles([cursor({ user: user({ name: 'a\\"; }' }) })]);
      expect(css).toContain('content: "a\\\\\\"; }"');
    });

    it('escapes a name with a newline, which would otherwise end the string', () => {
      expect(remoteCursorStyles([cursor({ user: user({ name: 'a\nb' }) })])).toContain(
        'content: "a\\a b"',
      );
    });

    it('escapes single quotes as well', () => {
      expect(remoteCursorStyles([cursor({ user: user({ name: "O'Neil" }) })])).toContain(
        'content: "O\\\'Neil"',
      );
    });

    it('never emits an unescaped quote inside a content declaration', () => {
      const names = ['"', "'", '\\', '"};', 'a"b\'c\\d', '</style><script>'];
      for (const name of names) {
        const css = remoteCursorStyles([cursor({ user: user({ name }) })]);
        const content = /content: "(.*)";/.exec(css)?.[1] ?? '';
        expect(content).not.toMatch(/(^|[^\\])"/);
        expect(content).not.toMatch(/(^|[^\\])'/);
      }
    });

    it('drops a client id that could not have come from Yjs', () => {
      expect(remoteCursorStyles([cursor({ clientId: Number.NaN })])).toBe('');
      expect(remoteCursorStyles([cursor({ clientId: 1.5 })])).toBe('');
      expect(remoteCursorStyles([cursor({ clientId: -1 })])).toBe('');
    });
  });
});
