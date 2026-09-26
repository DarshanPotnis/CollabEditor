// Kept in step with ROOM_ID_PATTERN in backend/rooms.js.
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const ROOM_ID_LENGTH = 10;

export function createRoomId() {
  // randomUUID needs a secure context, which excludes plain-http access over a
  // LAN IP — worth supporting, since that is how you test on a phone.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, ROOM_ID_LENGTH);
  }
  return Math.random().toString(36).slice(2, 2 + ROOM_ID_LENGTH);
}

/**
 * Accepts a bare room id or anything containing a `/room/<id>` path, so a
 * pasted invite link works as well as a typed id.
 *
 * @returns {string|null} the room id, or null if nothing valid was found.
 */
export function parseRoomId(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;

  const fromLink = raw.match(/\/room\/([^/?#\s]+)/);
  let candidate = fromLink ? fromLink[1] : raw;

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // A malformed escape sequence just means this isn't a link; use it as typed.
  }

  return ROOM_ID_PATTERN.test(candidate) ? candidate : null;
}
