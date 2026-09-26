# CollabCode: Architecture

A living description of how the system works **today**. Each phase updates this file.

Current state: **v0.1** — a Socket.IO relay with an authoritative server-side document.
The Yjs/Hocuspocus architecture described in `docs/PLAN.md` §3 does not exist yet; it lands in
Phase 1.

| Tag | What it is |
|---|---|
| `v0-baseline` | The original project, as first written. The "before" in the README story. |
| `v0.1-socketio-fixes` | The same architecture with its correctness and safety bugs fixed. |

---

## v0: original

### Shape

```
Browser (frontend/, Vercel)                    Render (backend/)
┌────────────────────────────┐                 ┌──────────────────────────────┐
│ React 19 + Vite            │                 │ Express 5                    │
│ @monaco-editor/react       │  socket.io      │ Socket.IO                    │
│   (Monaco loaded from CDN) │ ◄─────────────► │ users: { socketId -> {...} } │
│ module-scope socket        │  whole document │ (no document stored)         │
└────────────────────────────┘  per keystroke  └──────────────────────────────┘
```

Everything lived in two files: `frontend/src/pages/EditorPage.jsx` and `backend/index.js`.
A "room" was a URL segment (`/room/:roomId`) and nothing more — the server never held one.

### How sync worked

On every keystroke the editor emitted `code-change` with the **entire buffer**. The server
relayed that string to the other sockets in the room, which replaced their whole document with
it. There was no merge step: the last message to arrive won, for everybody.

The server kept one flat `users` object mapping socket id to `{ username, color, roomId }`, and
derived a room's roster by filtering it. That was the only server-side state.

### Defects

These are the reasons the rewrite exists, not a list of style complaints. Each one is
reproducible.

**Data loss**

1. **No server-side document.** The server relayed keystrokes but never stored the result, so
   there was nothing to hand a new arrival. A late joiner mounted with its local default
   (`// Welcome to CollabCode 🚀\n`), and its first keystroke broadcast that buffer to everyone
   — wiping whatever the room had written. Refreshing the page did the same thing.
2. **Last-write-wins on the whole document.** Two people typing at once did not merge; one
   person's message simply overwrote the other's text.
3. **No persistence.** A Render restart or spin-down erased every room.

**Broken lifecycle**

4. **Module-scope socket.** `const socket = io(BACKEND_URL)` ran at import time, so the
   connection was tied to the browser tab rather than to the component. Under React StrictMode
   the effect ran twice against that one shared socket, registering duplicate handlers.
5. **`join-room` on mount, not on connect.** A reconnect arrives with a *new* socket id, and
   the server had already dropped the old membership. The client showed "connected" and
   silently stopped receiving updates for the rest of the session.
6. **`socket.off()` with no arguments** in cleanup removed *every* listener on the socket,
   including Socket.IO's own internal ones.
7. **`isRemoteUpdate` as a boolean flag.** It was set before applying a remote update and
   cleared in `onChange`, to swallow the echo. But when the remote text was identical to the
   buffer, Monaco never fired `onChange`, so the flag stayed set and silently swallowed the
   user's next *real* keystroke.

**Trust and safety**

8. **Room id taken from the client payload.** Every handler read `roomId` from the incoming
   message instead of from the socket's own membership, so any client could write into any
   room it could name.
9. **No input validation.** Code length, username, language and cursor coordinates were
   relayed unchecked.
10. **CSS injection via `color`.** A peer's color string was interpolated straight into a
    stylesheet. It came from another client, through a server that never inspected it.
11. **`origin: "*"`** on the Socket.IO CORS config.

**Presence**

12. **Cursors never cleaned up.** `remoteCursors` was only ever written to. A user who left
    kept a caret in everyone else's editor until reload.
13. **Cursors were not per-user.** Every remote caret used one shared `remote-cursor` class, so
    the `color` carried in the roster was never actually applied to a cursor.
14. **Language sync was dead code.** The server relayed `language-change` and the client
    listened for `language-update`, but the dropdown only called `setLanguage` locally — the
    event was never emitted. The dropdown looked collaborative and was not.

---

## v0.1: Socket.IO fixes

Same transport, same last-write-wins sync model. What changed is that the **server now owns
the document**, and every boundary is validated. This is the honest "we fixed the bugs" step
before the architecture itself changes.

`docs/PLAN.md` §7 advised skipping this work on the grounds that Phase 1 deletes it. We did it
anyway, deliberately: it makes the before/after story demonstrable rather than asserted, and it
keeps `main` deployable while Phase 1 is built on a branch. The code is still discarded at the
Phase 1 cutover.

### Shape

```
Browser (frontend/)                            Render (backend/)
┌────────────────────────────┐                 ┌──────────────────────────────────────┐
│ useCollabSession  ─ socket │                 │ index.js         wiring + CORS       │
│ useRemoteCursors  ─ carets │  socket.io      │ socketHandlers.js  event handlers    │
│ EditorPage        ─ UI     │ ◄─────────────► │ rooms.js         authoritative state │
│ lib/{room,identity,consts} │  whole document │   roomId -> { code, language, users }│
└────────────────────────────┘  per keystroke  │   socketId -> roomId                 │
                                               └──────────────────────────────────────┘
```

The single files were split into focused modules: `backend/rooms.js` (state),
`backend/socketHandlers.js` (events), `backend/index.js` (wiring), and on the client
`hooks/useCollabSession.js`, `hooks/useRemoteCursors.js`, `lib/room.js`, `lib/identity.js`.

### What the server now holds

```js
rooms:       Map<roomId, { code, language, users: Map<socketId, User>, reapTimer }>
socketRooms: Map<socketId, roomId>   // a socket's room, never read from a payload
```

### Fixes, against the list above

| # | Fix |
|---|---|
| 1 | `rooms.js` stores each room's `code` and `language`. `join` returns them, and the server emits **`room-sync`** to the joiner before it is allowed to type. |
| 2 | Not fixed — see *Remaining limitations*. This is what Phase 1 replaces. |
| 3 | Not fixed. State is process-local and dies with the process. Phase 1 adds Postgres. |
| 4 | The socket is created **inside** the effect and destroyed in its cleanup, so it lives and dies with the component and is StrictMode-safe. |
| 5 | `join-room` is emitted **from the `connect` handler**, so every reconnect re-joins with its new socket id. |
| 6 | Cleanup calls `socket.off(event, handler)` per handler, leaving Socket.IO's internals alone. |
| 7 | The echo guard stores the **last applied string** rather than a boolean. An identical remote update that fires no `onChange` leaves a stale value that simply fails to match the next keystroke and corrects itself. |
| 8 | Every handler resolves its room via `rooms.roomOf(socket.id)`. The client cannot name a room it did not join. Re-joining leaves the previous room first and tells the people still in it. |
| 9 | Room ids match `/^[A-Za-z0-9_-]{1,64}$/`; code is capped at 1 MB; usernames are collapsed and truncated to 32 chars; language is capped at 32 chars; cursor line/column must be positive integers. Anything invalid is dropped rather than relayed. |
| 10 | Color must match `/^#[0-9a-fA-F]{6}$/`, checked on the server **and** again in the browser before it reaches a stylesheet. |
| 11 | CORS reads an `ALLOWED_ORIGINS` allowlist, falling back to `*` only when it is unset. |
| 12 | The `room-users` roster is the single source of truth for presence. Cursors are pruned against it on every roster change, so a stale cursor heals even if a message is missed. |
| 13 | One `<style>` element is rebuilt per roster change with a rule per socket id, giving each person their own caret color. Decorations use `createDecorationsCollection`, and positions are clamped with `model.validatePosition` because cursor and code updates race. |
| 14 | `language-change` is now actually emitted, and the server validates, stores and relays it. Phase 1 deletes the dropdown entirely: language becomes a property of the file. |

### Two safeguards worth naming

Both exist to compensate for last-write-wins. Both are scheduled for removal in Phase 1.

- **Read-only until synced.** Monaco is `readOnly` and shows a "Syncing with room…" overlay
  until `room-sync` arrives. Without it, typing into the empty pre-sync buffer would broadcast
  that buffer and wipe the room — defect #1 all over again.
- **60-second empty-room grace period (`EMPTY_ROOM_TTL_MS`).** A room's document outlives its
  last user by a minute. Dropping it the instant it empties would mean a lone user with a flaky
  connection loses everything on every blip: the disconnect empties the room, the room is
  discarded, and the reconnect a second later syncs them back an empty document. The timer is
  `unref`'d so it never holds the process open.

### Remaining limitations

**These are the point of Phase 1.**

1. **Sync is still last-write-wins over the whole document.** Two people typing at the same
   moment still clobber each other; the server just makes the *result* consistent for everyone
   rather than letting clients diverge. Concurrent edits are not merged, because a full-buffer
   replace carries no information about *what* changed.
2. **Cursors jump on remote edits.** A remote update replaces Monaco's entire model, so the
   local caret is re-anchored by offset rather than by position in the text. Someone typing
   above you moves your cursor. Remote carets are absolute line/column numbers with no relation
   to the text they were sitting in, so they land in the wrong place until their owner moves
   again. A CRDT fixes this properly: relative positions move with the characters they are
   attached to.
3. **No persistence.** A Render restart or a 60-second empty room loses the document.
4. **Single instance only.** `rooms` is process-local; a second Render instance would serve a
   different document for the same room id.
5. **One file per room.** There is no project, no file tree and no way to run anything.
6. **Monaco is loaded from a CDN** by `@monaco-editor/react`'s default loader, so the exact
   version is not pinned by the lockfile — and it will not work under the cross-origin
   isolation headers that Phase 3 requires.
