"use strict";

/**
 * In-memory room registry.
 *
 * The server is authoritative for a room's document: clients no longer carry
 * the only copy, so a late joiner can be handed the current state instead of
 * starting from a blank buffer and clobbering everyone on its first keystroke.
 *
 * This store is process-local. Running more than one backend instance requires
 * moving it behind a shared cache and adding a Socket.IO adapter.
 */

const DEFAULT_CODE = "// Welcome to CollabCode 🚀\n";
const DEFAULT_LANGUAGE = "javascript";
const DEFAULT_COLOR = "#94a3b8";

// How long a room's document outlives its last user. Dropping the room the
// instant it empties would mean a lone user with a flaky connection loses their
// work on every blip: the disconnect empties the room, the room is discarded,
// and the reconnect a second later syncs them back an empty document.
const EMPTY_ROOM_TTL_MS = 60_000;

const MAX_CODE_LENGTH = 1_000_000;
const MAX_USERNAME_LENGTH = 32;
const MAX_LANGUAGE_LENGTH = 32;

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** @type {Map<string, {code: string, language: string, users: Map<string, object>, reapTimer: NodeJS.Timeout|null}>} */
const rooms = new Map();

/** socketId -> roomId, so a room is never taken from a client-supplied payload. */
const socketRooms = new Map();

function normalizeRoomId(value) {
  const roomId = typeof value === "string" ? value.trim() : "";
  return ROOM_ID_PATTERN.test(roomId) ? roomId : null;
}

function sanitizeUsername(value) {
  const username = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return username ? username.slice(0, MAX_USERNAME_LENGTH) : "Anonymous";
}

// Peers interpolate this straight into a stylesheet to color the cursor, so
// anything that isn't a plain hex color is replaced rather than passed along.
function sanitizeColor(value) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value : DEFAULT_COLOR;
}

function isValidCursor(cursor) {
  return (
    !!cursor &&
    Number.isInteger(cursor.lineNumber) &&
    Number.isInteger(cursor.column) &&
    cursor.lineNumber > 0 &&
    cursor.column > 0
  );
}

function cancelReap(room) {
  if (room.reapTimer) {
    clearTimeout(room.reapTimer);
    room.reapTimer = null;
  }
}

function scheduleReap(roomId, room) {
  cancelReap(room);
  room.reapTimer = setTimeout(() => {
    const current = rooms.get(roomId);
    if (current && current.users.size === 0) rooms.delete(roomId);
  }, EMPTY_ROOM_TTL_MS);

  // A pending cleanup should never be the reason the process stays alive.
  if (typeof room.reapTimer.unref === "function") room.reapTimer.unref();
}

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      code: DEFAULT_CODE,
      language: DEFAULT_LANGUAGE,
      users: new Map(),
      reapTimer: null,
    };
    rooms.set(roomId, room);
  }
  cancelReap(room);
  return room;
}

/** The room a socket currently belongs to, or null. */
function roomOf(socketId) {
  return socketRooms.get(socketId) ?? null;
}

/**
 * Register a socket in a room. Returns the room's current document state so the
 * caller can sync the joiner before it is allowed to type.
 */
function join(roomId, socketId, { username, color } = {}) {
  const room = getOrCreateRoom(roomId);

  room.users.set(socketId, {
    socketId,
    username: sanitizeUsername(username),
    color: sanitizeColor(color),
  });
  socketRooms.set(socketId, roomId);

  return { code: room.code, language: room.language };
}

/** Remove a socket from whatever room it was in. Returns the room id, or null. */
function leave(socketId) {
  const roomId = socketRooms.get(socketId);
  if (!roomId) return null;
  socketRooms.delete(socketId);

  const room = rooms.get(roomId);
  if (!room) return null;

  room.users.delete(socketId);
  if (room.users.size === 0) scheduleReap(roomId, room);

  return roomId;
}

function setCode(roomId, code) {
  const room = rooms.get(roomId);
  if (!room) return false;
  if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) return false;

  room.code = code;
  return true;
}

function setLanguage(roomId, language) {
  const room = rooms.get(roomId);
  if (!room) return false;
  if (typeof language !== "string" || !language || language.length > MAX_LANGUAGE_LENGTH) {
    return false;
  }

  room.language = language;
  return true;
}

/** The room roster, as plain objects safe to broadcast. */
function listUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.users.values()].map((user) => ({ ...user }));
}

module.exports = {
  DEFAULT_CODE,
  DEFAULT_LANGUAGE,
  EMPTY_ROOM_TTL_MS,
  normalizeRoomId,
  isValidCursor,
  roomOf,
  join,
  leave,
  setCode,
  setLanguage,
  listUsers,
};
