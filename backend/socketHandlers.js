"use strict";

const rooms = require("./rooms");

/**
 * Socket.IO event wiring.
 *
 * Every handler resolves its room from the socket's own membership rather than
 * from the incoming payload, so a client can only ever write into the room it
 * actually joined.
 */

function broadcastUsers(io, roomId) {
  io.to(roomId).emit("room-users", rooms.listUsers(roomId));
}

function leaveCurrentRoom(io, socket) {
  const roomId = rooms.leave(socket.id);
  if (!roomId) return;

  socket.leave(roomId);
  broadcastUsers(io, roomId);
}

function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", (payload = {}) => {
      const roomId = rooms.normalizeRoomId(payload.roomId);
      if (!roomId) return;

      // A socket belongs to exactly one room; re-joining tidies the old one up
      // (and tells the people still in it) before switching.
      const current = rooms.roomOf(socket.id);
      if (current && current !== roomId) leaveCurrentRoom(io, socket);

      const { code, language } = rooms.join(roomId, socket.id, {
        username: payload.username,
        color: payload.color,
      });

      socket.join(roomId);

      // The joiner gets the authoritative document before it can type.
      socket.emit("room-sync", { code, language });
      broadcastUsers(io, roomId);
    });

    socket.on("code-change", (payload = {}) => {
      const roomId = rooms.roomOf(socket.id);
      if (!roomId || !rooms.setCode(roomId, payload.code)) return;

      socket.to(roomId).emit("code-update", payload.code);
    });

    socket.on("language-change", (payload = {}) => {
      const roomId = rooms.roomOf(socket.id);
      if (!roomId || !rooms.setLanguage(roomId, payload.language)) return;

      socket.to(roomId).emit("language-update", payload.language);
    });

    socket.on("typing", () => {
      const roomId = rooms.roomOf(socket.id);
      if (!roomId) return;

      socket.to(roomId).emit("user-typing", { socketId: socket.id });
    });

    socket.on("cursor-change", (payload = {}) => {
      const roomId = rooms.roomOf(socket.id);
      if (!roomId || !rooms.isValidCursor(payload.cursor)) return;

      socket.to(roomId).emit("cursor-update", {
        socketId: socket.id,
        cursor: {
          lineNumber: payload.cursor.lineNumber,
          column: payload.cursor.column,
        },
      });
    });

    socket.on("disconnect", () => {
      leaveCurrentRoom(io, socket);
      console.log("User disconnected:", socket.id);
    });
  });
}

module.exports = registerSocketHandlers;
