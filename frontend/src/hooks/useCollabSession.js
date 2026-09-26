import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

import {
  BACKEND_URL,
  DEFAULT_LANGUAGE,
  TYPING_EMIT_INTERVAL_MS,
  TYPING_IDLE_MS,
} from "../lib/constants";

/**
 * Owns the socket for one editing session.
 *
 * The connection is created inside the effect rather than at module scope, so
 * it is tied to the component's lifetime: React 18+ StrictMode mounts twice in
 * development, and the extra connection is torn down with the first mount
 * instead of leaking for the life of the tab.
 */
export function useCollabSession({ roomId, username, color }) {
  const [status, setStatus] = useState("connecting");
  const [synced, setSynced] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [users, setUsers] = useState([]);
  const [cursors, setCursors] = useState({});
  const [typingSocketId, setTypingSocketId] = useState(null);

  const socketRef = useRef(null);

  // Holds the exact string we last applied from the network. Monaco is a
  // controlled component here, so applying a remote update fires onChange; that
  // echo has to be swallowed or the two clients ping-pong forever.
  //
  // This is a value rather than a boolean flag on purpose: if the remote update
  // is identical to what is already in the buffer Monaco never fires onChange,
  // and a boolean would stay stuck and silently swallow the user's next real
  // keystroke. A stale value simply fails to match and corrects itself.
  const appliedRemoteCodeRef = useRef(null);

  const lastTypingEmitRef = useRef(0);
  const typingTimerRef = useRef(null);

  useEffect(() => {
    if (!roomId) return undefined;

    const socket = io(BACKEND_URL);
    socketRef.current = socket;

    const handlers = {
      connect: () => {
        setStatus("connected");
        setSelfId(socket.id);

        // Joining from the connect handler rather than on mount is what makes
        // reconnects work: a reconnect arrives with a brand new socket id, and
        // the server has already dropped the old membership, so without this
        // the client stays connected but silently stops receiving updates.
        socket.emit("join-room", { roomId, username, color });
      },

      disconnect: () => {
        setStatus("disconnected");
        // The document may move on without us; re-sync before trusting it again.
        setSynced(false);
        setCursors({});
      },

      connect_error: () => setStatus("disconnected"),

      "room-sync": ({ code: remoteCode, language: remoteLanguage }) => {
        appliedRemoteCodeRef.current = remoteCode;
        setCode(remoteCode);
        setLanguage(remoteLanguage);
        setSynced(true);
      },

      "code-update": (remoteCode) => {
        appliedRemoteCodeRef.current = remoteCode;
        setCode(remoteCode);
      },

      "language-update": (remoteLanguage) => setLanguage(remoteLanguage),

      "room-users": (roster) => {
        const list = Array.isArray(roster) ? roster : [];
        setUsers(list);

        // The roster is the single source of truth for who is present, so
        // cursors are pruned from it rather than from a separate leave event.
        // That also heals stale cursors if a message is ever missed.
        const present = new Set(list.map((user) => user.socketId));
        setCursors((previous) => {
          const next = {};
          let dropped = false;
          for (const [socketId, cursor] of Object.entries(previous)) {
            if (present.has(socketId)) next[socketId] = cursor;
            else dropped = true;
          }
          return dropped ? next : previous;
        });
      },

      "cursor-update": ({ socketId, cursor }) => {
        setCursors((previous) => ({ ...previous, [socketId]: cursor }));
      },

      "user-typing": ({ socketId } = {}) => {
        setTypingSocketId(socketId ?? null);
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setTypingSocketId(null), TYPING_IDLE_MS);
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      socket.on(event, handler);
    }

    return () => {
      // Remove our handlers individually. A bare socket.off() clears every
      // listener on the socket, including Socket.IO's own internal ones.
      for (const [event, handler] of Object.entries(handlers)) {
        socket.off(event, handler);
      }

      clearTimeout(typingTimerRef.current);
      socket.disconnect();
      socketRef.current = null;

      setStatus("connecting");
      setSynced(false);
      setSelfId(null);
      setUsers([]);
      setCursors({});
      setTypingSocketId(null);
    };
  }, [roomId, username, color]);

  const emitTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingEmitRef.current < TYPING_EMIT_INTERVAL_MS) return;

    lastTypingEmitRef.current = now;
    socketRef.current?.emit("typing");
  }, []);

  /** Apply a local edit: update the buffer and broadcast it, unless it's an echo. */
  const applyLocalCode = useCallback(
    (value) => {
      const next = value ?? "";
      setCode(next);

      if (next === appliedRemoteCodeRef.current) {
        appliedRemoteCodeRef.current = null;
        return;
      }
      appliedRemoteCodeRef.current = null;

      socketRef.current?.emit("code-change", { code: next });
      emitTyping();
    },
    [emitTyping],
  );

  const changeLanguage = useCallback((value) => {
    setLanguage(value);
    socketRef.current?.emit("language-change", { language: value });
  }, []);

  const publishCursor = useCallback((cursor) => {
    socketRef.current?.emit("cursor-change", { cursor });
  }, []);

  const typingUsername = useMemo(() => {
    if (!typingSocketId) return null;
    return users.find((user) => user.socketId === typingSocketId)?.username ?? "Someone";
  }, [typingSocketId, users]);

  return {
    status,
    synced,
    selfId,
    code,
    language,
    users,
    cursors,
    typingUsername,
    applyLocalCode,
    changeLanguage,
    publishCursor,
  };
}
