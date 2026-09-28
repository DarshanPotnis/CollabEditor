import { describe, expect, it } from 'vitest';
import {
  PRESENCE_COLORS,
  escapeCssString,
  parseAwarenessState,
  presenceColorFor,
  sanitizeUserName,
} from './presence.js';
import { MAX_AGENT_STATUS_LENGTH, MAX_USER_NAME_LENGTH } from './limits.js';

const validState = {
  user: { id: 'user-1', name: 'Ada', color: PRESENCE_COLORS[0], kind: 'human' },
  activeFileId: 'abc123',
};

describe('parseAwarenessState', () => {
  it('accepts a well-formed state', () => {
    expect(parseAwarenessState(validState)).toEqual(validState);
  });

  it('defaults a missing activeFileId to null', () => {
    const parsed = parseAwarenessState({ user: validState.user });
    expect(parsed?.activeFileId).toBeNull();
  });

  it('strips unknown keys instead of rejecting, so newer clients still show up', () => {
    const parsed = parseAwarenessState({
      ...validState,
      selection: { anchor: 1, head: 2 },
      somethingNew: true,
    });
    expect(parsed).toEqual(validState);
  });

  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['no user', { activeFileId: null }],
    ['user is not an object', { user: 'Ada' }],
    ['missing color', { user: { id: 'u', name: 'Ada', kind: 'human' } }],
    ['unknown kind', { user: { ...validState.user, kind: 'robot' } }],
    ['id with a quote', { user: { ...validState.user, id: 'a"b' } }],
    ['activeFileId with a slash', { ...validState, activeFileId: '../etc/passwd' }],
  ])('rejects %s', (_label, raw) => {
    expect(parseAwarenessState(raw)).toBeNull();
  });

  describe('agents and edit times', () => {
    const agentState = {
      user: { id: 'agent-s1', name: 'AI teammate', color: PRESENCE_COLORS[1], kind: 'agent' },
      activeFileId: 'abc123',
      lastEditAt: 1_700_000_000_000,
      agent: { hostUserId: 'user-1', hostName: 'Ada', sessionId: 's1', status: 'Editing a.js' },
    };

    it('accepts an agent with its host, session and status', () => {
      expect(parseAwarenessState(agentState)).toEqual(agentState);
    });

    it('drops a malformed edit time or agent info, but keeps the peer', () => {
      const parsed = parseAwarenessState({
        ...agentState,
        lastEditAt: 'yesterday',
        agent: { ...agentState.agent, hostUserId: 'a"b' },
      });
      expect(parsed).toEqual({ user: agentState.user, activeFileId: 'abc123' });
    });

    it('sanitises and caps the host name and status like a name', () => {
      const parsed = parseAwarenessState({
        ...agentState,
        agent: { ...agentState.agent, hostName: 'Ada‮\n', status: `Running\n${'x'.repeat(200)}` },
      });
      expect(parsed?.agent?.hostName).toBe('Ada');
      expect(parsed?.agent?.status).toHaveLength(MAX_AGENT_STATUS_LENGTH);
      expect(parsed?.agent?.status.startsWith('Running x')).toBe(true);
    });

    it('drops agent info whose status is empty after sanitising', () => {
      const parsed = parseAwarenessState({
        ...agentState,
        agent: { ...agentState.agent, status: '​' },
      });
      expect(parsed?.agent).toBeUndefined();
    });
  });

  describe('malicious colors', () => {
    it.each([
      '#000000',
      'red',
      'red; } body { display: none } .x {',
      'url(javascript:alert(1))',
      'rgb(0,0,0)',
      '#2563eb; background: url(https://evil.test/pixel)',
      '',
    ])('rejects %j', (color) => {
      expect(
        parseAwarenessState({ ...validState, user: { ...validState.user, color } }),
      ).toBeNull();
    });

    it('rejects a color that only differs by case, so the palette stays exact', () => {
      expect(
        parseAwarenessState({ ...validState, user: { ...validState.user, color: '#2563EB' } }),
      ).toBeNull();
    });
  });

  describe('malicious names', () => {
    it('strips control characters', () => {
      const parsed = parseAwarenessState({
        ...validState,
        user: { ...validState.user, name: 'Ada\u0000\u001b[31m' },
      });
      expect(parsed?.user.name).toBe('Ada[31m');
    });

    it('strips zero-width and direction-changing characters', () => {
      const parsed = parseAwarenessState({
        ...validState,
        user: { ...validState.user, name: 'Ada\u200b\u202egnitide' },
      });
      expect(parsed?.user.name).toBe('Adagnitide');
    });

    it('collapses newlines and tabs into single spaces', () => {
      const parsed = parseAwarenessState({
        ...validState,
        user: { ...validState.user, name: 'Ada\n\tLovelace' },
      });
      expect(parsed?.user.name).toBe('Ada Lovelace');
    });

    it('truncates an over-long name rather than dropping the peer', () => {
      const parsed = parseAwarenessState({
        ...validState,
        user: { ...validState.user, name: 'a'.repeat(200) },
      });
      expect(parsed?.user.name).toHaveLength(MAX_USER_NAME_LENGTH);
    });

    it('rejects an absurdly long name outright', () => {
      expect(
        parseAwarenessState({
          ...validState,
          user: { ...validState.user, name: 'a'.repeat(5000) },
        }),
      ).toBeNull();
    });

    it('rejects a name that is only unsafe characters', () => {
      expect(
        parseAwarenessState({
          ...validState,
          user: { ...validState.user, name: '\u0000\u200b  ' },
        }),
      ).toBeNull();
    });

    it('keeps a script-like name as inert text rather than rejecting it', () => {
      const parsed = parseAwarenessState({
        ...validState,
        user: { ...validState.user, name: '<script>alert(1)</script>' },
      });
      expect(parsed?.user.name).toBe('<script>alert(1)</script>');
    });
  });
});

describe('sanitizeUserName', () => {
  it('never splits a surrogate pair when truncating', () => {
    const sanitized = sanitizeUserName('🙂'.repeat(40));
    expect(Array.from(sanitized)).toHaveLength(MAX_USER_NAME_LENGTH);
    expect(sanitized.endsWith('🙂')).toBe(true);
  });
});

describe('escapeCssString', () => {
  it('escapes a payload that tries to close the string and add rules', () => {
    const payload = '"; } body { display: none } .x::after { content: "';
    const escaped = escapeCssString(payload);
    expect(escaped).not.toMatch(/(^|[^\\])"/);
    expect(escaped).toBe('\\"; } body { display: none } .x::after { content: \\"');
  });

  it('escapes single quotes too, so either quote style is safe', () => {
    expect(escapeCssString("it's")).toBe("it\\'s");
  });

  it('escapes backslashes so an escape cannot be forged', () => {
    expect(escapeCssString('a\\"b')).toBe('a\\\\\\"b');
  });

  it('hex-escapes characters that would end a CSS string', () => {
    expect(escapeCssString('a\nb')).toBe('a\\a b');
    expect(escapeCssString('a\rb')).toBe('a\\d b');
    expect(escapeCssString('a\u007fb')).toBe('a\\7f b');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeCssString('Ada Lovelace')).toBe('Ada Lovelace');
  });
});

describe('presenceColorFor', () => {
  it('is stable for the same seed', () => {
    expect(presenceColorFor('user-1')).toBe(presenceColorFor('user-1'));
  });

  it('only ever returns palette colors', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(PRESENCE_COLORS).toContain(presenceColorFor(`user-${index}`));
    }
  });
});
