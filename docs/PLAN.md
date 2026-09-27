# CollabCode: Engineering Plan (Phases 0–3)

## 0. How to use this document

This plan is written for Claude Code. Work one phase at a time, in order. For each phase:

1. Restate the phase plan in plain language, list files to create or change, and flag anything
   that conflicts with current library versions. Wait for approval.
2. Implement in small commits on a phase branch (for example `phase-1-crdt`).
3. Add and run tests. Everything must pass lint, typecheck and unit tests.
4. Hand over a manual test script that covers the phase's definition of done.
5. Update `docs/ARCHITECTURE.md` and add the ADRs listed for that phase.

Later phases (AI agent, checkpoints, GitHub push, accounts) are intentionally out of scope here.
Design choices below leave room for them, but do not build them yet.

Phases 0, 1 and 2 are **done**. Where reality diverged from the original plan — mostly because
installed library versions differ from what it assumed — this document has been corrected in
place so it stays the source of truth, and §14 lists every change with its reason.

---

## 1. Product vision

CollabCode is a multiplayer code workspace in the browser:

- Several people open the same project and edit different files (or the same file) at the
  same time, with live named cursors and presence in the file tree.
- Anyone can run the project's Node.js backend inside their own browser tab (WebContainers)
  and hit its endpoints from a built-in API console.
- Work is never lost: late joiners get the current state, offline edits merge on reconnect,
  and projects survive server restarts.

Future phases will add an AI agent that participates as a teammate inside the same sync
system. Keep the awareness model generic (`kind: 'human' | 'agent'`) for that reason.

---

## 2. Baseline (what the rewrite replaced)

**Deleted at the Phase 1 cutover.** It lives on at two tags, which is what the README's
before/after story links to:

- `v0-baseline` — `frontend/`: React 19 + Vite, Monaco, socket.io-client, Tailwind on Vercel;
  `backend/index.js`: Express 5 + Socket.IO relay with an in-memory user map on Render. Sync was
  last-write-wins full-document replacement on every keystroke: no persistence, no state sync on
  join, no reconnect re-join, language sync was dead code, cursors were never cleaned up.
- `v0.1-socketio-fixes` — the same architecture with the server owning the document and every
  boundary validated. Still last-write-wins.

`docs/ARCHITECTURE.md` documents both, defect by defect.

---

## 3. Target architecture

```
┌──────────────────────────── Browser (apps/web) ─────────────────────────────┐
│                                                                              │
│  React UI ── Monaco ── y-monaco binding ── Y.Doc ── HocuspocusProvider ──────┼──► wss://<server>/collab
│                                              │                               │
│                                              └── FS bridge (one-way) ──►     │
│                                                  WebContainer                │
│                                                  (Node, npm, terminal,       │
│                                                   preview, API console)      │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────── Render (apps/server) ───────────────┐      ┌──── Neon Postgres ────┐
│ Express:     GET /health, /api/projects             │      │ projects              │
│ Hocuspocus:  WebSocket upgrades on /collab          │─────►│   ydoc bytea snapshot │
└─────────────────────────────────────────────────────┘      └───────────────────────┘
```

Core principles:

- **The server syncs and stores. It never runs or interprets user code.** Code only runs in
  the browser of the person who clicks Run.
- **Yjs is the single source of truth for project content.** Monaco models, the file tree UI
  and the WebContainer file system are all projections of the Y.Doc.
- **Merging is automatic.** Text merges via the CRDT. File-tree anomalies caused by concurrent
  edits (duplicate names, cycles) are resolved deterministically at read time, so every client
  computes the same view without extra writes.

Analogy for the README: the old version emailed the whole file on every keystroke and the last
email won. The new version sends individual edits ("insert 'a' after this character") that
every copy can merge in any order and still end up identical.

---

## 4. Technology decisions

| Concern      | Choice                                                                                  | Reason                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language     | TypeScript **5.9** (strict) across all packages                                         | Shared types. Pinned below 7: typescript-eslint 8 peers cap at `<6.1.0`                                                                                               |
| Repo         | npm workspaces monorepo                                                                 | No extra tooling, supported by Vercel and Render                                                                                                                      |
| Frontend     | React 19 + **Vite 7** + **Tailwind 4**                                                  | Vite pinned to 7 repo-wide: `@vitejs/plugin-react` 6 requires Vite 8, and Vite 8's Rolldown pipeline plus Monaco worker bundling is not a risk worth taking mid-phase |
| Editor       | `monaco-editor` bundled locally, created with `monaco.editor.create` (no React wrapper) | CDN loading breaks under Phase 3's isolation headers; the wrapper's model cache fought ours (§9.3), so it was removed in Phase 2                                      |
| Panes        | `react-resizable-panels` 4 (`Group` / `Panel` / `Separator`)                            | Accessible, keyboard-resizable splitters with no dependencies. Tree, drag and drop, context menu and toasts are built in-house                                        |
| CRDT         | Yjs + `y-monaco`                                                                        | Mature, fast, awareness built in                                                                                                                                      |
| Sync server  | `@hocuspocus/server` + `@hocuspocus/provider`                                           | Yjs server with auth, persistence hooks, debounced storage                                                                                                            |
| Persistence  | Neon Postgres (free tier), `@hocuspocus/extension-database`                             | Survives Render spin-down; stores full doc snapshot                                                                                                                   |
| DB client    | `postgres` (porsager) with plain SQL migrations, `prepare: false`                       | No ORM needed for one table; Neon's pooler is pgbouncer in transaction mode                                                                                           |
| Validation   | zod                                                                                     | Env, HTTP bodies, params                                                                                                                                              |
| Logging      | pino                                                                                    | Structured logs on Render                                                                                                                                             |
| IDs          | nanoid                                                                                  | Project and file-node IDs                                                                                                                                             |
| Runtime      | `@webcontainer/api`                                                                     | Node.js in the browser at $0; free for personal/open-source use                                                                                                       |
| Terminal     | `@xterm/xterm` + fit addon                                                              | Standard web terminal                                                                                                                                                 |
| Tests        | Vitest (unit/integration), Playwright (e2e)                                             | Fast, TS-native                                                                                                                                                       |
| Server build | tsup (bundles `packages/shared` in)                                                     | Avoids publishing/building the shared package separately                                                                                                              |
| Node         | 24 (current LTS), pinned in `.nvmrc` and `engines`                                      | Reproducible builds. Its global `WebSocket` means tests need no `ws` polyfill                                                                                         |
| Lint         | ESLint 10 flat config + typescript-eslint 8, type-aware                                 | Catches floating promises and unsafe `any` flow                                                                                                                       |

---

## 5. Repository layout

The old `frontend/` and `backend/` folders were built alongside this structure and deleted at
the Phase 1 cutover, once it worked end to end.

```
/
├── CLAUDE.md
├── package.json               # workspaces: apps/*, packages/*
├── .nvmrc
├── tsconfig.base.json
├── apps/
│   ├── web/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── vercel.json        # SPA rewrites (+ isolation headers in Phase 3)
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── app/           # router, top-level providers, error boundary
│   │       ├── collab/        # Y.Doc + provider lifecycle, connection status, doc hooks
│   │       ├── features/
│   │       │   ├── landing/
│   │       │   ├── workspace/ # three-pane layout
│   │       │   ├── editor/    # Monaco setup, model registry, URIs, undo routing, cursor CSS
│   │       │   ├── file-tree/ # tree, rows, keyboard, drag and drop, tree actions
│   │       │   ├── tabs/      # tab state, tab bar, editor pane, deleted-file banners
│   │       │   ├── recently-deleted/
│   │       │   ├── notifications/ # toasts
│   │       │   ├── ui/        # context menu, confirm dialog
│   │       │   ├── presence/
│   │       │   └── runtime/   # Phase 3: WebContainer, FS bridge, terminal, preview, API console
│   │       ├── lib/           # config (zod-parsed env), identity, api client
│   │       └── styles/
│   └── server/
│       └── src/
│           ├── index.ts       # composes config, storage, Express, Hocuspocus, shutdown
│           ├── config.ts      # zod-validated env
│           ├── http/          # express app, routes/health.ts, routes/projects.ts, errors.ts
│           ├── collab/        # hocuspocus instance, http mount, project guard, logging
│           ├── db/            # client, migrations/*.sql, migrate.ts, projects-repo.ts,
│           │                  #   memory-projects-repo.ts
│           ├── test/          # e2e-server.ts (in-memory harness), support.ts
│           └── lib/logger.ts
├── packages/
│   └── shared/
│       └── src/
│           ├── schema.ts      # Y.Doc shape, keys, node types, zod-validated readers
│           ├── ops.ts         # initProjectDoc (templates → document)
│           ├── tree-ops.ts    # createFile, createFolder, rename, move, softDelete, restore
│           ├── purge-ops.ts   # purgeDeleted: the one hard delete
│           ├── tree-rules.ts  # write-time checks, shared with the UI
│           ├── resolve-tree.ts # deterministic read-time resolution (§6.2)
│           ├── deleted-items.ts # what Recently deleted lists
│           ├── display-name.ts, node-writer.ts, op-error.ts
│           ├── presence.ts    # awareness schema, palette, sanitising, CSS escaping
│           ├── ids.ts         # project, node and user ids
│           ├── templates/     # starter projects as path → content maps, plus layout.ts
│           ├── limits.ts      # size and count limits
│           └── protocol.ts    # API DTOs (zod)
├── e2e/                       # Playwright specs
├── .github/workflows/ci.yml
├── README.md
└── docs/
    ├── PLAN.md
    ├── ARCHITECTURE.md
    ├── manual-tests/          # per-phase definition-of-done scripts
    └── decisions/
```

Deployment changes (apply only when merging to `main`, documented in the README):

- Vercel: set the project root directory to `apps/web`; env `VITE_API_URL`, `VITE_COLLAB_URL`.
- Render: root at repo root; build
  `npm ci && npm run build -w @collabcode/shared && npm run build -w @collabcode/server`; start
  `npm run start -w @collabcode/server`; run `npm run migrate -w @collabcode/server` on deploy;
  env `DATABASE_URL`, `ALLOWED_ORIGINS`, `LOG_LEVEL`.
- Confirm both platforms install workspace dependencies correctly before switching `main`.
- **Still outstanding.** Neither platform has been reconfigured yet; `main` still deploys the
  deleted layout.

---

## 6. Data model

### 6.1 Project document (schema v1)

One Y.Doc per project. The document name in Hocuspocus is the project ID.

```ts
doc.getMap('meta'); // { schemaVersion: 1, name: string, template: string, createdAt: number }
doc.getMap('nodes'); // nodeId -> Y.Map<NodeFields>
doc.getMap('contents'); // fileId -> Y.Text

type NodeFields = {
  id: string;
  kind: 'file' | 'folder';
  name: string; // label only; never used as identity
  parentId: string | null; // null = project root
  createdAt: number;
  createdBy: string; // user id from awareness identity
  deletedAt: number | null; // tombstone; content is kept so delete can be undone
  deletedBy: string | null; // Phase 2, optional in storage: reads as null when absent
  deletedByName: string | null; // the deleter's name then, sanitised like an awareness name
};
```

Rules:

- **Stable IDs.** Node IDs are nanoids, never reused and never derived from paths.
  Rename sets `name`. Move sets `parentId`. Delete sets `deletedAt`. Restore clears it.
  Because identity doesn't change on rename, someone typing in a file that gets renamed keeps
  their cursor and their edits.
- **Single write path, with one exception.** All _structural_ mutations go through
  `packages/shared` (`ops.ts`, `tree-ops.ts`, `purge-ops.ts`), run inside
  `doc.transact(fn, origin)`, and validate names (non-empty, NFC, no `/`, not `.` or `..`) and
  limits. The exception is **y-monaco**, which writes
  editor keystrokes straight into a file's `Y.Text`. That is why the per-file size limit is
  enforced at the editor rather than in `ops.ts` (see §8.3). The exception is recorded in
  `CLAUDE.md`.
- **Reads never throw.** `readNode`, `readNodes` and `readMeta` parse with zod and skip or return
  `null` for anything another client wrote that does not match the schema.
- **Schema from day one.** Phase 1 uses one file, but it still uses this full schema (one
  `index.js` node) so Phase 2 needs no migration.
- **Templates.** Project creation builds the initial Y.Doc on the server from a template in
  `packages/shared/src/templates`, encodes it, and stores it.

### 6.2 Deterministic read-time resolution

Concurrent tree edits can produce states that no single user created. `resolveTree(nodes)` is
a pure function that every client runs on the same data and gets the same answer:

1. **Deletion cascade.** A node whose ancestor is deleted is treated as deleted.
2. **Missing parent.** A `parentId` that doesn't exist resolves to root.
3. **Cycles.** Two users concurrently moving A into B and B into A creates a cycle. Walk the
   ancestors; for any cycle, re-parent the node in the cycle with the smallest
   `(createdAt, id)` to root.
4. **Duplicate names in one folder.** Prevented at write time first: `createFile`, `createFolder`,
   `rename` and `move` refuse a name that a live sibling already has — **compared
   case-insensitively**, since a project may later be cloned onto macOS or Windows — so the
   ordinary case never reaches resolution. (Resolution itself stays case-sensitive, like the
   WebContainer's file system.) `restore` never refuses: a restored node whose name was taken
   meanwhile really renames itself to the next free `name (n)`. Resolution then handles the case writes cannot — two clients creating the same
   name concurrently, where neither saw the other. Sort siblings by `(createdAt, id)`. The first
   keeps its name. The others get display names `name (2).ext`, `name (3).ext` — skipping any
   suffix a sibling really has as its name — and are reported in `conflicts`. Display names are
   what paths, Monaco URIs and the WebContainer use.

   The conflict **badge** is not a must-have. Once duplicates are prevented at write time the
   badge explains a state most users will never see, and the display name already communicates
   it. Build it only if the resolved case turns out to be confusing in practice.

Output:

```ts
type ResolvedTree = {
  byId: Map<string, ResolvedNode>; // visible only; includes displayName, path, depth
  childrenOf: Map<string | null, string[]>; // sorted: folders first, then a fixed code-point order
  idByPath: Map<string, string>;
  hidden: Map<string, HiddenNode>; // for each hidden node, the tombstone that hid it, and who
  conflicts: Array<
    | { nodeId: string; kind: 'duplicate-name' | 'missing-parent' }
    | { nodeId: string; kind: 'cycle'; others: string[] } // so the UI can name both folders
  >;
};
```

The rules run in the order 1–2 (parents, cycles), then 3 (cascade along the resolved parents),
then 4, so a node in a broken cycle still cascades correctly. Sorting never uses the browser's
locale, which differs between machines.

This function has exhaustive unit tests (each rule, combinations, input-order independence) and
a seeded convergence test: two replicas make random offline edits, exchange them, and must
resolve identically. ADR 004 documents it.

**Purge.** Tombstones keep content forever, so the document only grows. `purgeDeleted` (behind a
confirmation in Recently deleted) is the one hard delete. It removes only what the purging client
sees as deleted, so a file created concurrently inside a purged folder survives via rule 2. A
restore racing a purge loses: it writes into a `Y.Map` the purge deleted, which Yjs discards.

### 6.3 Awareness (presence)

```ts
type AwarenessUser = {
  id: string;
  name: string;
  color: string; // from a fixed palette readable in light and dark themes
  kind: 'human' | 'agent'; // 'agent' reserved for a future phase
};

type AwarenessState = {
  user: AwarenessUser;
  activeFileId: string | null;
  // y-monaco manages its own `selection` field for the bound editor
};
```

Identity is a guest identity (random friendly name + palette color) generated on first visit,
stored in localStorage, and editable from the UI. There are no accounts in these phases.

**Every remote awareness state is untrusted input.** It is written by another browser and relayed
by a server that does not inspect it, and it ends up in the DOM and in generated CSS. So:

- Parse each state with zod (`parseAwarenessState`) and ignore anything malformed, rather than
  rendering it. A state that fails to parse is simply not a collaborator.
- `color` must be a member of the fixed palette — an enum, not a hex pattern. No peer-supplied
  string ever reaches a stylesheet.
- `name` is stripped of control, zero-width and bidi-override characters, has its whitespace
  collapsed, and is capped at 32 code points (truncating on code points, not UTF-16 units).
  Sanitise rather than reject, so a long name does not make someone vanish from the presence bar.
- Unknown keys are **stripped, not rejected** — y-monaco keeps its own `selection` field on the
  same state, and a peer on a newer client should still appear.
- Names are escaped again with `escapeCssString` at the point they enter a CSS string, and
  client ids are checked with `Number.isSafeInteger` before becoming class-name suffixes.
- Our own localStorage is untrusted too: the stored identity is parsed with the same schema.

Unit tests cover hostile names and colours at both layers.

### 6.4 Database

```sql
create table projects (
  id          text primary key,
  name        text not null,
  template    text not null,
  ydoc        bytea,                -- Y.encodeStateAsUpdate(doc)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

- Migrations are plain numbered SQL files run by `db/migrate.ts` on deploy, applied in filename
  order inside a transaction and recorded in a `schema_migrations` table, so re-running is a
  no-op.
- Wrap DB access in a `ProjectsRepo` interface with a Postgres implementation and an in-memory
  implementation for tests. Because every other test uses the in-memory one, the Postgres
  implementation, the `bytea` round trip and the migration runner get their own spec that skips
  unless `TEST_DATABASE_URL` is set; CI provides a Postgres service.
- Brute force: store the full document snapshot on each debounced save. Record the future
  optimization (append-only updates plus periodic compaction) in the ADR, but do not build it.

---

## 7. Phase 0: Baseline capture — **done**

1. `v0-baseline` tagged. ✅
2. Screen capture of the last-write-wins bug, for the README "before" section. **Outstanding** —
   the tag still makes it reproducible, but the recording has not been made.
3. `docs/ARCHITECTURE.md` describing the baseline. ✅

**Deviation, on purpose.** This section originally said to skip the Socket.IO bug fixes because
Phase 1 replaces that code. They were done anyway and tagged `v0.1-socketio-fixes`: it makes the
before/after story demonstrable rather than asserted, and it kept `main` deployable while Phase 1
was built on a branch. The code was still discarded at the cutover, as predicted.

---

## 8. Phase 1: Real collaboration engine + persistence (single file) — **done**

**Goal:** replace last-write-wins with Yjs on the existing single-file experience, and make
projects persistent and real (server-issued, validated IDs).

### 8.1 Scaffold

- Root workspaces, `tsconfig.base.json`, ESLint, Prettier, Vitest, `.nvmrc`, root scripts
  (`dev`, `build`, `test`, `lint`, `typecheck`, `e2e`).
- `packages/shared`, trimmed to what Phase 1 uses: `schema.ts`, `ops.ts` (just
  `initProjectDoc`), `presence.ts`, `ids.ts`, `limits.ts`, `protocol.ts`, the `express-api` and
  `blank-node` templates, and unit tests. `resolve-tree.ts` and the tree ops move to Phase 2 —
  see §6.2. Phase 1 templates hold exactly one file each, since there is no tree to show a
  second one in.

### 8.2 Server (`apps/server`)

- `config.ts`: zod-parsed env (`PORT`, `DATABASE_URL`, `ALLOWED_ORIGINS` as a comma list,
  `LOG_LEVEL`). Fail fast on invalid config.
- Express:
  - `GET /health` returns `{ ok: true }` quickly and never touches the DB.
  - `POST /api/projects` with body `{ name?, template }` creates the project row and its
    initial Y.Doc from the template, returns `{ id }`. Rate-limited per IP (express-rate-limit).
  - `GET /api/projects/:id` returns metadata or 404.
  - CORS allowlist from `ALLOWED_ORIGINS`. No wildcard origin.
  - The per-IP creation limit is a `createApp` option, not a constant: the e2e harness creates
    far more projects per minute from one IP than a person ever would.
- **Hocuspocus owns the HTTP server, and Express is mounted inside it.** The original plan had
  this backwards. `@hocuspocus/server` 4.7 creates its own `http.Server` in its constructor and
  offers no way to hand it one, so Express is mounted through the `onRequest` hook and
  `onUpgrade` destroys any upgrade whose path is not `/collab`. Both hooks stop the hook chain
  by rejecting with a **falsy** value — Hocuspocus rethrows only truthy rejections, so that is
  its convention for "handled". Full reasoning in ADR 003.
  - **Reject unknown projects in `onLoadDocument`, not `onAuthenticate`.** Hocuspocus 4
    multiplexes documents over one socket and carries the document name in the _sync message_,
    not the URL, so the project ID is unknown at upgrade time. The guard extension is registered
    **before** the database extension, so a rejected project never reaches storage. Throwing a
    `CollabRejectionError` makes Hocuspocus send a permission-denied carrying `error.reason`,
    which the client turns into a specific message.
  - Database extension: `fetch` loads the snapshot, `store` upserts it and `updated_at`.
    Debounce 2s, max debounce 10s.
  - `websocketOptions.maxPayload` caps a single WebSocket frame as a transport safety net. It
    sits far above the per-file limit, because one frame can carry a whole document's initial
    sync; the real per-file rule is enforced at the editor (§8.3).
- Graceful shutdown on `SIGTERM` (Render sends it on deploy and spin-down): stop accepting
  connections, flush pending document stores, close the DB pool, then exit — all under a
  timeout. This needs **`stopOnSignals: false`**, because Hocuspocus's own signal handler calls
  `process.exit(0)` immediately after `destroy()` and would kill the process before the pool
  closed.
- pino request and collab logging (connect, disconnect, load, store, reject), with project ID.

### 8.3 Web (`apps/web`)

- Routes: `/` landing, `/p/:projectId` workspace, `/room/:id` redirects to `/p/:id` so old
  links keep working, and a 404 page for unknown projects.
- `collab/useProject(projectId)`: creates the Y.Doc and HocuspocusProvider inside an effect
  and destroys both on cleanup (StrictMode-safe). Exposes a status of `waking` (health check
  slow, likely Render cold start), `connecting`, `synced`, `reconnecting` or `offline`.
- Status UI:
  - "Waking up the server…" during cold starts, saying the wait **can take up to a minute**, so
    a 40-second first connection reads as expected rather than broken. The landing page also
    fires a fire-and-forget `GET /health` on load, so the instance starts waking while the
    visitor is still reading.
  - "Reconnecting…" and "Offline — your edits are kept and will sync when you're back"
    (true while the tab stays open; Yjs merges on reconnect).
- Editor: Monaco bundled locally (worker setup via Vite `?worker` imports). Bind the active
  file's `Y.Text` with `MonacoBinding(ytext, model, new Set([editor]), provider.awareness)`.
  - Two import facts, both load-bearing: **monaco-editor 0.57 ships an exports map**, so deep
    paths are `monaco-editor/<path under esm/vs>`; and **y-monaco 0.1.6 predates it** and still
    imports `monaco-editor/esm/vs/editor/editor.api.js`, which needs a Vite `resolve.alias` or
    the build fails outright.
- **Enforce the per-file size limit at the editor.** y-monaco bypasses `ops.ts` (§6.1), so this
  is the only place a human can be told what happened. At the limit, block text-inserting keys
  and oversized pastes with a friendly message; never block deletion, or the file could not be
  brought back under. Detect the server's `maxPayload` close (code 1009) and explain it rather
  than letting it look like a random disconnect.
- Remote cursors: generate per-client CSS for y-monaco's remote-selection classes (verified in
  the installed version: `yRemoteSelection-<clientID>` and `yRemoteSelectionHead-<clientID>`)
  using each user's color, plus a name label on the cursor head. Escape the name (§6.3).
  Cursors disappear automatically when a user leaves (awareness removal).
- Presence bar: avatars and names from awareness; count of people online.
- Language comes from the file extension. Remove the language dropdown: language is a
  property of the file, which removes the old language-sync bug by design.
- Landing page: "Create project" (template picker: Express API, Blank Node) and "Join"
  (paste a link or ID; validated via `GET /api/projects/:id`).

### 8.4 Cutover — done

`frontend/`, `backend/` and the root `vercel.json` were deleted once the definition of done
passed, and the README was written. Lint, typecheck, unit, integration, build and e2e were all
re-run _after_ the deletion.

### 8.5 Definition of done — met

- Two windows type at the same position at the same time: both converge, nothing is lost.
  Note that the characters **interleave** (`BBAABBAA`, not `AAAABBBB`) — that is both intents
  being merged, and it is what the tests assert rather than contiguous runs.
- A late joiner immediately sees the current content.
- One window goes offline (DevTools), both keep typing, it reconnects: edits merge.
- Restarting the server loses nothing.
- An unknown project URL shows the 404 page.
- Named, colored remote cursors; a leaving user's cursor disappears.

The manual script that walks through these in two browser windows is
`docs/manual-tests/phase-1.md`. Each item also has an automated test (§8.6).

### 8.6 Tests

- Unit: `packages/shared` and the pure logic in `apps/web` (connection state machine, cursor
  CSS, file-size guard, identity, language mapping, config).
- Integration (Vitest, Node): start the real Express + Hocuspocus composition in-process with
  the in-memory repo on an ephemeral port, connect two providers, make concurrent edits, assert
  convergence; assert store/fetch round-trips; assert unknown and malformed IDs are rejected;
  assert an edit followed by an **immediate** disconnect still persists (the store must beat
  document unload); assert the Express mount beyond `/health` — a JSON `POST /api/projects`,
  malformed JSON, CORS preflight from allowed origins, and rejection of a disallowed one.
  No `ws` package needed: Node 24 has a global `WebSocket`.
- Postgres (Vitest, Node): the SQL, the `bytea` round trip and the migration runner against a
  real database. Skipped unless `TEST_DATABASE_URL` is set.
- E2E (Playwright): two browser contexts against the **production bundle** served by
  `vite preview`, not the dev server — Monaco and its workers are what bundling makes fragile.
  The API is the same real composition with in-memory storage, so the suite needs no database.
- GitHub Actions: one job for lint, typecheck, tests and build (with a Postgres service), one
  for e2e, on every push and PR.

### 8.7 ADRs — written

- 001: CRDT (Yjs) over last-write-wins, and why not operational transformation.
- 002: Hocuspocus + Postgres snapshot persistence; snapshot now, incremental later.
- 003: Hocuspocus owns the HTTP server, Express is mounted inside it. **New** — this number was
  originally reserved for Phase 2's resolution ADR, which becomes 004; Phase 3's become 005
  and 006.

---

## 9. Phase 2: Multi-file workspace — **done**

**Goal:** a real project workspace where people work in different files at once and can see
where everyone is.

**Inherited from Phase 1** (all built). These were deliberately deferred here, because Phase 1
had no tree to exercise them against:

- `packages/shared/src/resolve-tree.ts` and its exhaustive unit tests (§6.2).
- The tree ops in `ops.ts`: `createFile`, `createFolder`, `rename`, `move`, `softDelete`,
  `restore` — including refusing a duplicate name among live siblings at write time.
- Templates with more than one file (Phase 1's hold exactly one each), which Phase 3 needs for
  `package.json`.

### 9.1 Layout

Three resizable panes: file tree | tabbed editor | run panel (placeholder until Phase 3).

### 9.2 File tree

- Create file and folder, inline rename, delete (soft, with an undo toast), move by drag and
  drop (native HTML5, offered only where the move op would accept it) or keyboard cut/paste,
  right-click context menu (also Shift+F10), WAI-ARIA treeview keyboard navigation.
- **Recently deleted:** each deleted item with where it was, who deleted it and when; Restore,
  Delete forever and Empty all, the last two behind a confirmation that states the count and that
  it cannot be undone for anyone. This is also the only way back to a deleted file whose tab was
  closed, and the way under the total node limit.
- When resolution breaks a cycle, both people get a toast naming the folders.
- Rendered from `resolveTree`. Duplicates are refused at write time; the display name
  (`utils (2).js`) carries the concurrent case. The conflict badge is optional — see §6.2.
- Presence dots on files showing who has each file open (from `activeFileId`).

### 9.3 Tabs and editor

- Open tabs are local to each user (not synced).
- One Monaco model **and binding** per open tab, with URI `URI.file('/' + path)` (encoded, never
  concatenated). When the resolved path changes (rename, move, parent rename, a duplicate gaining
  `(2)`), recreate the model (Monaco URIs are immutable) and carry over view state and focus.
- Every open tab stays bound, not only the active one: an unbound model falls behind remote
  edits, and rebinding calls `setValue`, which wipes undo and moves the cursor. Switching tabs is
  `setModel`. No `activeFileId` filter is needed for remote selections: y-monaco 0.1.6 already
  draws only positions that resolve into its own `Y.Text`.
- **Undo is per person:** a `Y.UndoManager` per file tracking only this user's binding (y-monaco's
  transaction origin), kept across renames. Every Monaco undo path ends in `model.undo()`, which
  each model routes to that manager; the command palette gets Undo/Redo on the same manager.
- If an open file is deleted by someone else, it stays open read-only with "Deleted by <name>"
  and Restore. If it is deleted forever, the tab says so and can be closed.
- Clicking a collaborator's avatar opens their file and reveals their cursor.

### 9.4 Limits and scale

- Enforce limits in the tree ops (client): at most 500 visible nodes and 2,000 including deleted
  ones, and `createFile` content within the per-file limit. Typed content stays guarded at the
  editor (§8.3). Keep the server-side update-size rejection from Phase 1.
- Brute force keeps every file in one Y.Doc, which is fine up to a few hundred small files.
  The future optimization (Yjs subdocuments per file, loaded lazily) is recorded in ADR 004's
  consequences rather than a separate ADR, to avoid renumbering 005/006 again. Not built.

### 9.5 Definition of done — met

Each item has an e2e test (`e2e/workspace.spec.ts`, `undo.spec.ts`, `tabs.spec.ts`,
`follow.spec.ts`), and `docs/manual-tests/phase-2.md` walks through them in two windows.

- Two users edit different files at the same time; both see each other's presence in the tree.
- User A renames a file while user B types in it: B's cursor and edits survive.
- User A deletes a file B is editing: B sees the deleted state and can restore it.
- Creating `utils.js` when a live sibling already has that name is refused at write time, with
  a message.
- Both users create `utils.js` in the same folder at the same moment — neither having seen the
  other, so write-time prevention cannot apply: both files survive, one is shown as
  `utils (2).js`, identically on both screens.
- Concurrent cross-moves of two folders produce the same resolved tree on both screens.

### 9.6 Tests and ADR

- Unit tests for every new op and resolution case, including the restore/purge races.
- E2E for concurrent rename-while-editing and duplicate-create, plus cross-move, delete/restore,
  delete forever while open, per-person undo (keys, palette, across a rename), tab and cursor
  behaviour, and following a collaborator.
- ADR **004**: stable IDs + read-time deterministic resolution — written. (Renumbered from 003,
  which Phase 1 used for the HTTP server decision.)

---

## 10. Phase 3: Run the backend in the browser (WebContainers)

**Goal:** anyone in the project can run the Node backend in their own tab and call its
endpoints, and it reloads as collaborators edit.

### 10.1 Prerequisites

- **Cross-origin isolation.** Serve `Cross-Origin-Embedder-Policy: require-corp` and
  `Cross-Origin-Opener-Policy: same-origin` on every route: in `apps/web/vercel.json` for
  production and in Vite `server.headers` / `preview.headers` locally.
- Audit every cross-origin asset (fonts, images, analytics scripts). Self-host them or make
  sure they send the right headers. Monaco is already bundled locally from Phase 1, and the app
  currently loads no cross-origin assets at all.
- **Feature detection.** If `window.crossOriginIsolated` is false or booting fails, show a
  banner ("Running code needs a Chromium browser like Chrome, Edge or Arc"). Editing keeps
  working.
- **License.** Add a README note: the WebContainer API is free for personal and open-source use,
  and this project is non-commercial open source.

### 10.2 Runtime module (`apps/web/src/features/runtime`)

- `webcontainer.ts`: boot once per page behind a module-level promise (only one instance is
  allowed; StrictMode-safe). Tear down when leaving the workspace.
- **FS bridge, one-way from Yjs to the WebContainer:**
  - Brute force first: on Run, build a `FileSystemTree` from the resolved tree snapshot and
    `mount` it.
  - Then live sync: observe `nodes` and `contents` deeply, debounce per file (~250 ms), and
    apply `writeFile` / `rm` / rename (rm + write if rename is unavailable) through a serial
    queue so operations apply in order. Map by resolved display paths.
  - Never sync the container back into Yjs (`node_modules`, lockfiles and build output stay
    local). Record opt-in lockfile sync as future work.
  - Put the diff/queue logic behind a small FS interface so it can be unit-tested with a fake.
- **Process manager:** Run = `npm install` (skipped if the hash of `package.json` hasn't changed
  since the last install), then `npm run dev`, falling back to `npm start`. Stop and Restart
  buttons. Stream output to the terminal, and show exit codes. Templates use `node --watch`
  so edits from any collaborator restart the server.
- **Terminal:** xterm.js with the fit addon. One "Run output" tab and one interactive shell
  tab (`jsh`) with resize handling.
- **Preview and API console:** listen for `server-ready` and store `{ port, url }`.
  - Preview tab: iframe for HTML responses.
  - API console tab (the key demo for backend work): method, path, headers, JSON body, Send.
    Execute requests _inside the container_ with a helper script written once to the
    container (for example `/.collabcode/request.mjs`) that takes the request as a base64 JSON
    argument and calls `fetch('http://localhost:<port>…')`. This avoids CORS entirely. Show
    status, timing, headers and a pretty-printed body, plus per-user request history.
- **Safety and UX:** code never runs automatically on join. It runs only when the local user
  clicks Run, and the Run panel notes that the code includes edits from collaborators. Run
  state is per user in this phase.

### 10.3 Definition of done

- Express template: Run → install → server ready → `GET /users` in the API console returns JSON.
- Editing a route while it runs restarts the server and the next request shows the change.
- A collaborator edits a file in their browser, and your running server picks it up.
- Unsupported browsers show the banner and can still edit.

### 10.4 Tests and ADRs

- Unit tests for the FS bridge diff and ordering logic with a fake file system.
- Optional Chromium-only Playwright smoke test for Run + API console.
- ADR **005**: one-way Yjs → WebContainer sync.
- ADR **006**: in-browser execution with WebContainers (cost, sandboxing, browser support,
  license). (Both renumbered by one — see §8.7.)

---

## 11. Cross-cutting standards

- **Performance:** subscribe React to Yjs through small selector hooks
  (`useSyncExternalStore`) so a keystroke doesn't re-render the whole workspace. Tree resolution
  is not debounced: it observes only `nodes`, which keystrokes never change, so it runs only on
  structural edits, and a debounce would only delay renames on screen. Debounce the FS sync.
- **Known optimisation, deliberately not built: the Monaco bundle.** Importing all of
  `monaco-editor` produces a 4.36 MB main chunk (**1.14 MB gzipped**). Importing
  `monaco-editor/editor/editor.api` plus only the language contributions we use would cut that
  roughly in half. It is deferred until **after Phase 2**, when the real set of file types the
  workspace supports is known — doing it now would mean guessing that set and then revisiting
  it, and every new language would become a registration someone has to remember. Revisit it as
  part of the Phase 3 asset audit, since cross-origin isolation touches the same loading path.
- **Accessibility:** keyboard-reachable controls, visible focus states, sufficient contrast in
  both themes, and remote-cursor labels that stay readable.
- **Error handling:** an error boundary per pane; user-facing errors are specific and
  actionable.
- **Environment variables:**

| Variable            | App            | Purpose                                                  |
| ------------------- | -------------- | -------------------------------------------------------- |
| `VITE_API_URL`      | web            | Base URL for the REST API                                |
| `VITE_COLLAB_URL`   | web            | WebSocket URL for Hocuspocus (`wss://…/collab`)          |
| `PORT`              | server         | Injected by Render; defaults to 8080                     |
| `HOST`              | server         | Bind address; defaults to `0.0.0.0`                      |
| `TEST_DATABASE_URL` | server (tests) | Enables the Postgres-backed specs; unset means they skip |
| `DATABASE_URL`      | server         | Neon Postgres connection string                          |
| `ALLOWED_ORIGINS`   | server         | Comma-separated allowed web origins                      |
| `LOG_LEVEL`         | server         | pino log level                                           |

Provide `.env.example` files for both apps. Make sure `.env` is gitignored in every package.

---

## 12. Out of scope for phases 0–3

Accounts and auth, AI agent features, checkpoints and GitHub push, shared terminals, Yjs
subdocuments, persistence of offline edits across page reloads (IndexedDB), and a mobile
layout beyond "doesn't break".

---

## 13. Documentation deliverables

- `docs/ARCHITECTURE.md`: kept current each phase, with the diagram from section 3.
- ADRs 001–006 as listed in each phase (renumbered — see §8.7).
- `docs/manual-tests/<phase>.md`: the definition-of-done script for each phase.
- README: written at the Phase 1 cutover, since deleting `frontend/` and `backend/` changed how
  the project is run. Still to add at the end of Phase 3: demo GIF, WebContainer licence note,
  and the architecture diagram once it stops changing.

---

## 14. Revision log

What changed in this document during implementation, and why. Everything here is already
corrected in place above.

**Phase 1 (2026-09-26)**

| Change                                                                                       | Reason                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Hocuspocus owns the HTTP server; Express is mounted via `onRequest` (§8.2)                   | `@hocuspocus/server` 4.7 builds its own `http.Server` and cannot be handed one. ADR 003                                                       |
| Unknown projects rejected in `onLoadDocument`, not `onAuthenticate` (§8.2)                   | The document name arrives in the sync message, not the URL, so it is unknown at upgrade time                                                  |
| `stopOnSignals: false` (§8.2)                                                                | Hocuspocus's own handler calls `process.exit(0)` before our DB pool can close                                                                 |
| `resolve-tree.ts` and the tree ops deferred to Phase 2 (§6.2, §8.1, §9)                      | Phase 1 has one file and no tree; they would have been dead code                                                                              |
| Phase 1 templates hold exactly one file (§8.1)                                               | Same reason — a second file would be unreachable                                                                                              |
| Duplicate names prevented at write time; conflict badge dropped from must-haves (§6.2, §9.2) | Prevention handles the ordinary case; resolution is only needed for the genuinely concurrent one, which the display name already communicates |
| Per-file size limit enforced at the editor (§6.1, §8.3)                                      | y-monaco writes into `Y.Text` directly and bypasses `ops.ts`. Recorded as the one exception in `CLAUDE.md`                                    |
| `maxPayload` reframed as a transport safety net, with 1009 detection (§8.2, §8.3)            | It cannot be the file-size rule: one frame carries a whole initial sync. Hitting it kills the socket, so the client has to explain it         |
| Awareness hardening spelled out (§6.3)                                                       | Remote states are peer-supplied and reach the DOM and generated CSS                                                                           |
| Cold-start copy says "can take up to a minute"; landing page pings `/health` (§8.3)          | A 40-second first connection has to read as expected, and the wait can start before the user acts                                             |
| Project creation rate limit made configurable (§8.2)                                         | The e2e suite exhausts a hardcoded 20/minute from one IP                                                                                      |
| ADRs renumbered: 003 is the HTTP server decision; Phase 2 → 004, Phase 3 → 005/006 (§8.7)    | A Phase 1 decision needed writing up and took the next free number                                                                            |
| Postgres-backed test spec added (§6.4, §8.6)                                                 | Every other test uses the in-memory repo, leaving the SQL, `bytea` and migrations uncovered                                                   |
| Node 24; no `ws` package in tests (§4, §8.6)                                                 | Node's global `WebSocket` is enough                                                                                                           |
| TypeScript pinned to 5.9, Vite to 7 (§4)                                                     | typescript-eslint 8 peers cap TS below 6.1; `@vitejs/plugin-react` 6 requires Vite 8, which changes the bundler under Monaco                  |
| Monaco bundle-size optimisation recorded as post-Phase-2 (§11)                               | The language set is not known until the workspace is multi-file                                                                               |
| Phase 0's "skip the Socket.IO fixes" not followed (§7)                                       | Doing them made the before/after demonstrable and kept `main` deployable                                                                      |
| README written at the Phase 1 cutover rather than Phase 3 (§13)                              | Deleting the old folders changed how the project is run                                                                                       |

**Phase 2 (2026-09-26)**

| Change                                                                                           | Reason                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every open tab keeps its model and binding, not only the active one (§9.3)                       | "One model per open file" plus "bind only the active file" left unbound models stale, and rebinding calls `setValue`, which wipes undo and moves the cursor            |
| No `activeFileId` filter for remote selections (§9.3)                                            | Verified in y-monaco 0.1.6: it draws only positions that resolve into its own `Y.Text`                                                                                 |
| `@monaco-editor/react` removed; the editor is created directly (§4, §9.3)                        | Its `path` prop caches models by URI, never disposes the old one on a path change, keys view state by the old path, and disposes our models on unmount                 |
| Models follow the resolved path, built with `URI.file` (§9.3)                                    | Paths change on parent renames, moves and duplicate suffixes, not only renames, and names may contain `#`, `?`, `%`                                                    |
| Deleted files keep an open tab, read-only, under their own URI scheme (§9.3)                     | A new file can take the deleted file's path while its tab is open, and two models cannot share a URI                                                                   |
| Per-person undo on a `Y.UndoManager` per file; every Monaco undo path routed to it (§9.3)        | Monaco's own stack undoes collaborators' edits, and since remote edits are applied with `applyEdits` (not recorded there) it would replay old edits at shifted offsets |
| Write-time name checks are case-insensitive; resolution stays case-sensitive (§6.2)              | A project may be cloned onto a case-insensitive file system; the WebContainer's is case-sensitive                                                                      |
| `deletedBy` and `deletedByName` added to nodes as optional fields, no schema bump (§6.1)         | "Deleted by <name>" and Recently deleted need the deleter, usually after they have left                                                                                |
| `resolveTree` also returns `hidden` and names every member of a cycle (§6.2)                     | The deleted-file banner and restore need the tombstone that hid a node; the cycle toast names both folders                                                             |
| Recently deleted, `purgeDeleted` and a total node cap including deleted nodes (§6.2, §9.2, §9.4) | Tombstones grow the document forever; a cap without a way to purge would be a dead end                                                                                 |
| Restore renames on a clash instead of refusing (§6.2)                                            | Restoring must not fail because someone reused the name meanwhile                                                                                                      |
| No debounce on tree resolution (§11)                                                             | It observes only `nodes`, which typing never changes                                                                                                                   |
| Subdocument optimisation recorded in ADR 004 rather than its own ADR (§9.4)                      | Avoids renumbering Phase 3's 005/006 again                                                                                                                             |
| Templates are path → content maps with an `entryPath` (§6.1)                                     | Folders and a `package.json` for Phase 3; the old "earliest file" entry rule is arbitrary once files share a `createdAt`                                               |
| E2E presses Ctrl, not Cmd, even on a Mac host                                                    | Playwright's Desktop Chrome profile reports a Windows user agent, and the app follows the page's platform                                                              |
