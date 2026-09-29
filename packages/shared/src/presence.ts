/**
 * Awareness (presence) types, and the validation that treats every remote
 * awareness state as untrusted input.
 *
 * Awareness states are written by other browsers and relayed by the server
 * without inspection. They end up in the DOM and in generated CSS for remote
 * cursors, so nothing from a peer is used before it has been parsed here, and
 * names are escaped again at the point they enter CSS.
 */
import { z } from 'zod';
import { MAX_AGENT_STATUS_LENGTH, MAX_USER_NAME_LENGTH } from './limits.js';

/**
 * The only colors a collaborator may have. Restricting to a fixed palette
 * means no peer-supplied string ever reaches a stylesheet, and every color is
 * legible with white text in both themes.
 */
export const PRESENCE_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#e11d48',
  '#ea580c',
  '#a16207',
  '#16a34a',
  '#0891b2',
] as const;

export type PresenceColor = (typeof PRESENCE_COLORS)[number];

export const presenceColorSchema = z.enum(PRESENCE_COLORS);

/** 'agent' is an AI teammate working for one of the humans in the room. */
export const awarenessUserKindSchema = z.enum(['human', 'agent']);
export type AwarenessUserKind = z.infer<typeof awarenessUserKindSchema>;

/** Characters that are invisible or can reorder rendered text. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Make peer-supplied text safe to render on one line: collapse whitespace (so
 * text split over lines reads as one line), drop invisible and
 * direction-changing characters, cap the length. Truncation walks code points
 * so a surrogate pair is never split.
 */
function sanitizeLine(raw: string, max: number): string {
  const collapsed = raw.replace(/\s+/g, ' ').replace(UNSAFE_NAME_CHARS, '').trim();
  const codePoints = Array.from(collapsed);
  return codePoints.length <= max ? collapsed : codePoints.slice(0, max).join('');
}

/** Make a peer-supplied display name safe to render. */
export function sanitizeUserName(raw: string): string {
  return sanitizeLine(raw, MAX_USER_NAME_LENGTH);
}

/**
 * One line of peer-written text. The .max() guards against absurd input before
 * any string work; ordinary over-long text is truncated instead.
 */
function peerLineSchema(max: number) {
  return z
    .string()
    .max(4096)
    .transform((raw) => sanitizeLine(raw, max))
    .pipe(z.string().min(1).max(max));
}

const identifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const awarenessUserSchema = z.object({
  id: identifierSchema,
  name: peerLineSchema(MAX_USER_NAME_LENGTH),
  color: presenceColorSchema,
  kind: awarenessUserKindSchema,
});
export type AwarenessUser = z.infer<typeof awarenessUserSchema>;

/**
 * What an AI agent says about itself. It is a claim like any other awareness
 * field: it decides how the agent is shown, never what anyone may do.
 */
export const agentInfoSchema = z.object({
  /** The awareness user id of the person who started the agent. */
  hostUserId: identifierSchema,
  hostName: peerLineSchema(MAX_USER_NAME_LENGTH),
  sessionId: identifierSchema,
  /** What it is doing, such as "Editing routes/users.js". */
  status: peerLineSchema(MAX_AGENT_STATUS_LENGTH),
});
export type AgentInfo = z.infer<typeof agentInfoSchema>;

/**
 * What we publish and read. y-monaco keeps its own `selection` field on the
 * same state; unknown keys are stripped here rather than rejected so a peer
 * running a newer client still shows up in the presence bar. The optional
 * fields drop a malformed value rather than the whole peer.
 */
export const awarenessStateSchema = z.object({
  user: awarenessUserSchema,
  activeFileId: identifierSchema.nullable().default(null),
  /** When this peer last edited a file, in milliseconds since the epoch by its own clock. */
  lastEditAt: z.number().int().nonnegative().optional().catch(undefined),
  /** Only an AI agent sets this. */
  agent: agentInfoSchema.optional().catch(undefined),
});
export type AwarenessState = z.infer<typeof awarenessStateSchema>;

/** Parse a remote awareness state. Returns null for anything malformed. */
export function parseAwarenessState(raw: unknown): AwarenessState | null {
  const parsed = awarenessStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Escape a string for use inside a CSS string literal, such as the `content`
 * of a remote cursor label. Quotes and backslashes are escaped so the literal
 * cannot be closed early, and control characters become hex escapes because a
 * raw newline ends a CSS string. Safe for both quote styles.
 */
export function escapeCssString(value: string): string {
  let escaped = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      escaped += `\\${code.toString(16)} `;
    } else if (char === '\\' || char === '"' || char === "'") {
      escaped += `\\${char}`;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

/** Stable palette choice for an id, so the same user keeps the same color. */
export function presenceColorFor(seed: string): PresenceColor {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 0xffffffff;
  }
  const color = PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
  // The modulo above is always in range; this keeps the type honest.
  return color ?? PRESENCE_COLORS[0];
}
