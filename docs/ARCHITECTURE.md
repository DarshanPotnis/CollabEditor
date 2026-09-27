# CollabCode: Architecture

A living description of how the system works **today**. Each phase updates this file.

Current state: **v1 (Phase 1)** — a Yjs CRDT synced by Hocuspocus, persisted as Postgres
snapshots, with a single file per project. The multi-file workspace (Phase 2) and in-browser
execution (Phase 3) are described in `docs/PLAN.md` and are not built yet.

| Tag                   | What it is                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| `v0-baseline`         | The original project, as first written. The "before" in the README story. |
| `v0.1-socketio-fixes` | The same architecture with its correctness and safety bugs fixed.         |

The two sections at the end of this file describe those earlier versions. They are kept because
the point of Phase 1 is what changed between them and now.

---

## v1: today

### Shape

```
┌──────────────────────── Browser (apps/web) ─────────────────────────┐
│  React 19 + Vite                                                    │
│                                                                     │
│  Monaco ──► y-monaco MonacoBinding ──► Y.Text ─┐                    │
│  (bundled locally, not from a CDN)             │                    │
│                                                ├─ Y.Doc             │
│  React UI ──► packages/shared ops ─────────────┘   │                │
│                                                    │                │
│  Awareness (name, colour, activeFileId) ───────────┤                │
│                                                    ▼                │
│                                         HocuspocusProvider          │
└────────────────────────────────────────────────────┬────────────────┘
                                                     │
                     REST (fetch)                    │ WebSocket
                     /health, /api/projects          │ /collab
                                                     ▼
┌─────────────────────── Render (apps/server) ────────────────────────┐
│  @hocuspocus/server owns the Node HTTP server                       │
│    ├─ onRequest  ──► Express app (health, projects, CORS)           │
│    ├─ onUpgrade  ──► only /collab reaches the WebSocket layer        │
│    └─ extensions ──► project guard → Database → logging             │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ snapshot per project
                                         ▼
                            ┌──── Neon Postgres ────┐
                            │ projects.ydoc (bytea) │
                            └───────────────────────┘
```

**The server syncs and stores. It never runs or interprets user code.** Nothing in Phase 1
executes anything a user typed; Phase 3 runs code only in the browser of whoever clicks Run.

### Where the truth lives

One `Y.Doc` per project, named by the project ID. Schema v1 (`packages/shared/src/schema.ts`):

```ts
doc.getMap('meta'); // { schemaVersion, name, template, createdAt }
doc.getMap('nodes'); // nodeId -> Y.Map<NodeFields>
doc.getMap('contents'); // fileId -> Y.Text
```

Phase 1 only ever creates one file node, but it uses the full schema so Phase 2's file tree
needs no migration. Node IDs are nanoids and never derived from paths, so a rename cannot move
anyone's cursor or orphan their edits.

Reads are defensive. `readNode`, `readNodes` and `readMeta` parse with zod and return `null` or
skip the entry when another client has written something that does not match the schema; they
never throw. A malformed node cannot take the UI down.

### The write path, and its one exception

Every structural mutation goes through `packages/shared/src/ops.ts`, inside
`doc.transact(fn, OPS_ORIGIN)`. Phase 1 needs only `initProjectDoc`, which the server calls once
when a project is created. The tree ops arrive in Phase 2 with the UI that needs them.

**The exception is y-monaco.** It writes editor keystrokes straight into the file's `Y.Text`,
bypassing `ops.ts` entirely. That is why the per-file size limit is enforced at the editor
(`apps/web/src/features/editor/file-size-guard.ts`) rather than in `ops.ts`: insertions and
oversized pastes are refused at the limit with a message, and deletions always work so a file can
be brought back under. This exception is recorded in `CLAUDE.md`.

### Sync and persistence lifecycle

1. A provider connects to `/collab` and sends the project ID **in the sync message**, not in the
   URL. Hocuspocus 4 multiplexes documents over one socket, so the document name is not known at
   upgrade time.
2. `onLoadDocument` runs the **project guard** first: the ID must parse, and the project must
   exist in the repo. A failure throws a `CollabRejectionError`, which Hocuspocus turns into a
   permission-denied message carrying `error.reason`. The client surfaces it as
   "The server refused this project". An unknown project therefore never reaches storage.
3. The `@hocuspocus/extension-database` extension then loads the snapshot and applies it.
4. Edits broadcast to the other connections immediately. `onStoreDocument` is debounced 2s with
   a 10s ceiling, and writes the whole document as one `bytea` snapshot.
5. When the last client disconnects, Hocuspocus flushes a pending store before unloading the
   document, so closing a tab immediately after typing still persists the edit. There is an
   integration test and an e2e test for exactly that race.
6. On `SIGTERM` (every Render deploy and spin-down) the server stops accepting connections,
   closes the open ones, flushes pending stores, then closes the database pool — all under a
   timeout. `stopOnSignals: false` is set because Hocuspocus's own handler calls
   `process.exit(0)` and would kill the process before the pool closed.

Storage is deliberately the simple version: the full document, rewritten on each debounced save.
See `docs/decisions/002-persistence.md` for the trade-off and the optimisation we did not build.

### One HTTP server

Hocuspocus 4 creates and owns the Node `http.Server`, and offers no way to hand it one. Express
is therefore mounted _inside_ it through the `onRequest` hook, and `onUpgrade` rejects WebSocket
upgrades on any path but `/collab`. Both hooks stop the hook chain by rejecting with a falsy
value, which is the Hocuspocus convention for "handled" — a truthy rejection would be rethrown.
See `docs/decisions/003-hocuspocus-owns-the-http-server.md`.

Routes:

| Route                   | Behaviour                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`           | `{ ok, uptimeSeconds }`. Never touches the database, so it answers the moment the process is up. The landing page pings it on load to start a cold start early. |
| `POST /api/projects`    | Validates `{ name?, template }`, builds the initial `Y.Doc` from the template, stores it, returns the summary. Rate limited per IP.                             |
| `GET /api/projects/:id` | Summary or 404. The workspace calls it before opening a socket, so an unknown ID shows a 404 page instead of a refused connection.                              |
| anything else           | 404 in our error shape, never Hocuspocus's default response.                                                                                                    |

### Trust boundaries

Every boundary is validated, and the awkward one is presence.

- **Remote awareness states are untrusted input.** They are written by other browsers and
  relayed without inspection. `parseAwarenessState` parses each one and drops anything
  malformed; colours must be members of a fixed palette; names are stripped of control,
  zero-width and bidi characters and capped; unknown keys (such as y-monaco's own `selection`)
  are ignored rather than rejected, so a peer on a newer client still appears.
- **Nothing from a peer is interpolated into CSS or HTML.** Remote cursor rules are generated
  per client id (checked with `Number.isSafeInteger`), and names pass through `escapeCssString`
  before entering a CSS string. There are unit tests for hostile names and colours.
- **localStorage is untrusted too.** The stored guest identity is parsed with the same schema
  and replaced if it does not match.
- **HTTP:** zod on every body and param; a CORS allowlist with no wildcard; an origin guard that
  refuses a request from an unlisted `Origin` with 403 before any route runs. A request with no
  `Origin` is not a browser request and is left alone.
- **Transport:** `websocketOptions.maxPayload` caps a single WebSocket frame as a safety net
  against a runaway client. It is far above the per-file limit because one frame can carry a
  whole document's initial sync. Hitting it closes the socket with code 1009, which the client
  recognises and explains rather than showing a mystery disconnect.

### Connection states

`apps/web/src/collab/connection-state.ts` is a pure reducer, so the states that are hard to
reach in a browser are easy to test:

| State               | When                                 | What the user is told                                        |
| ------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `connecting`        | first connection in flight           | "Connecting…"                                                |
| `waking`            | first connection still open after 2s | "Waking up the server… this can take up to a minute"         |
| `synced`            | document received                    | nothing                                                      |
| `reconnecting`      | dropped after a successful sync      | "Keep typing — your edits will merge when you are back"      |
| `offline`           | the browser reports offline          | "Your edits are kept and will sync when you are back online" |
| `payload-too-large` | closed with 1009                     | what to do next (undo the paste, reload)                     |
| `refused`           | permission denied from the guard     | "The server refused this project"                            |

A drop _before_ the first sync keeps the waiting message rather than claiming a reconnect, and a
refusal is final.

### What is deliberately missing

- **Offline edits do not survive a reload.** Yjs merges on reconnect while the tab stays open;
  there is no IndexedDB persistence. Out of scope for phases 0–3.
- **One server instance.** Hocuspocus holds documents in memory per process, so a second Render
  instance would serve a different live document for the same project. Fine on the free tier,
  and the reason there is no horizontal scaling story yet.
- **No file tree, no tabs, no running code.** Phases 2 and 3.
- **`resolveTree` does not exist yet.** Deterministic read-time resolution of concurrent tree
  anomalies lands with the tree in Phase 2.

### How it is verified

| Layer                                | What it covers                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (`packages/shared`, `apps/web`) | Document schema and ops, awareness hardening including hostile names and colours, CSS escaping, the connection state machine, the file-size guard, identity storage, language mapping, config parsing                                                                    |
| Integration (`apps/server`)          | The real Hocuspocus + Express composition against an in-memory repo: convergence, late joiners, offline merge, refusal of unknown and malformed IDs, the store beating document unload, restart survival, the Express mount, CORS preflight and rejection, rate limiting |
| Postgres (`apps/server`)             | The SQL, the `bytea` round trip and the migration runner against a real Postgres. Skipped unless `TEST_DATABASE_URL` is set; CI provides one                                                                                                                             |
| End-to-end (`e2e`)                   | Two browser contexts against the production bundle: concurrent typing, late join, offline merge, named cursors appearing and leaving, persistence across reload and across closing the tab, 404, redirect, join-by-link                                                  |

---

# Before

The rest of this file describes the versions Phase 1 replaced. Nothing here is still running.

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
5. **`join-room` on mount, not on connect.** A reconnect arrives with a _new_ socket id, and
   the server had already dropped the old membership. The client showed "connected" and
   silently stopped receiving updates for the rest of the session.
6. **`socket.off()` with no arguments** in cleanup removed _every_ listener on the socket,
   including Socket.IO's own internal ones.
7. **`isRemoteUpdate` as a boolean flag.** It was set before applying a remote update and
   cleared in `onChange`, to swallow the echo. But when the remote text was identical to the
   buffer, Monaco never fired `onChange`, so the flag stayed set and silently swallowed the
   user's next _real_ keystroke.

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

| #   | Fix                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `rooms.js` stores each room's `code` and `language`. `join` returns them, and the server emits **`room-sync`** to the joiner before it is allowed to type.                                                                                                           |
| 2   | Not fixed — see _Remaining limitations_. This is what Phase 1 replaces.                                                                                                                                                                                              |
| 3   | Not fixed. State is process-local and dies with the process. Phase 1 adds Postgres.                                                                                                                                                                                  |
| 4   | The socket is created **inside** the effect and destroyed in its cleanup, so it lives and dies with the component and is StrictMode-safe.                                                                                                                            |
| 5   | `join-room` is emitted **from the `connect` handler**, so every reconnect re-joins with its new socket id.                                                                                                                                                           |
| 6   | Cleanup calls `socket.off(event, handler)` per handler, leaving Socket.IO's internals alone.                                                                                                                                                                         |
| 7   | The echo guard stores the **last applied string** rather than a boolean. An identical remote update that fires no `onChange` leaves a stale value that simply fails to match the next keystroke and corrects itself.                                                 |
| 8   | Every handler resolves its room via `rooms.roomOf(socket.id)`. The client cannot name a room it did not join. Re-joining leaves the previous room first and tells the people still in it.                                                                            |
| 9   | Room ids match `/^[A-Za-z0-9_-]{1,64}$/`; code is capped at 1 MB; usernames are collapsed and truncated to 32 chars; language is capped at 32 chars; cursor line/column must be positive integers. Anything invalid is dropped rather than relayed.                  |
| 10  | Color must match `/^#[0-9a-fA-F]{6}$/`, checked on the server **and** again in the browser before it reaches a stylesheet.                                                                                                                                           |
| 11  | CORS reads an `ALLOWED_ORIGINS` allowlist, falling back to `*` only when it is unset.                                                                                                                                                                                |
| 12  | The `room-users` roster is the single source of truth for presence. Cursors are pruned against it on every roster change, so a stale cursor heals even if a message is missed.                                                                                       |
| 13  | One `<style>` element is rebuilt per roster change with a rule per socket id, giving each person their own caret color. Decorations use `createDecorationsCollection`, and positions are clamped with `model.validatePosition` because cursor and code updates race. |
| 14  | `language-change` is now actually emitted, and the server validates, stores and relays it. Phase 1 deletes the dropdown entirely: language becomes a property of the file.                                                                                           |

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

**These were the point of Phase 1, and all but one are now fixed.** 1 and 2 are gone: the CRDT
merges concurrent edits and relative positions keep cursors anchored to the text they sit in.
3 is gone: Postgres snapshots. 5 is gone as far as one file goes; the file tree is Phase 2.
6 is gone: Monaco is bundled locally. 4 stands — see "One server instance" above.

1. **Sync is still last-write-wins over the whole document.** Two people typing at the same
   moment still clobber each other; the server just makes the _result_ consistent for everyone
   rather than letting clients diverge. Concurrent edits are not merged, because a full-buffer
   replace carries no information about _what_ changed.
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
