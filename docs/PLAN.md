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

## 2. Baseline (what exists today)

- `frontend/`: React 19 + Vite, Monaco, socket.io-client, Tailwind. Deployed on Vercel.
- `backend/index.js`: Express 5 + Socket.IO relay, in-memory user map. Deployed on Render.
- Sync is last-write-wins full-document replacement on every keystroke. There is no
  persistence, no state sync on join, no reconnect re-join, language sync is dead code,
  and cursors are never cleaned up.

This baseline is the "before" in the README's before/after story. Tag it before changing
anything (see Phase 0).

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

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) across all packages | Shared types between client, server and schema |
| Repo | npm workspaces monorepo | No extra tooling, supported by Vercel and Render |
| Frontend | React 19 + Vite + Tailwind (keep) | Already in place |
| Editor | `monaco-editor` bundled locally, via `@monaco-editor/react` with `loader.config({ monaco })` | CDN loading breaks under the cross-origin isolation headers needed in Phase 3 |
| CRDT | Yjs + `y-monaco` | Mature, fast, awareness built in |
| Sync server | `@hocuspocus/server` + `@hocuspocus/provider` | Yjs server with auth, persistence hooks, debounced storage |
| Persistence | Neon Postgres (free tier), `@hocuspocus/extension-database` | Survives Render spin-down; stores full doc snapshot |
| DB client | `postgres` (porsager) or `pg` with plain SQL migrations | No ORM needed for one table |
| Validation | zod | Env, HTTP bodies, params |
| Logging | pino | Structured logs on Render |
| IDs | nanoid | Project and file-node IDs |
| Runtime | `@webcontainer/api` | Node.js in the browser at $0; free for personal/open-source use |
| Terminal | `@xterm/xterm` + fit addon | Standard web terminal |
| Tests | Vitest (unit/integration), Playwright (e2e) | Fast, TS-native |
| Server build | tsup (bundles `packages/shared` in) | Avoids publishing/building the shared package separately |
| Node | Current LTS, pinned in `.nvmrc` and `engines` | Reproducible builds |

---

## 5. Repository layout

Create the new structure alongside the old `frontend/` and `backend/` folders. Delete the old
folders only after the Phase 1 cutover works end to end.

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
│   │       │   ├── editor/    # Monaco setup, binding hook, remote-cursor styles
│   │       │   ├── file-tree/
│   │       │   ├── tabs/
│   │       │   ├── presence/
│   │       │   └── runtime/   # Phase 3: WebContainer, FS bridge, terminal, preview, API console
│   │       ├── lib/           # config (zod-parsed env), identity, api client
│   │       └── styles/
│   └── server/
│       └── src/
│           ├── index.ts       # composes HTTP server, Express, Hocuspocus, shutdown
│           ├── config.ts      # zod-validated env
│           ├── http/          # express app, routes/health.ts, routes/projects.ts
│           ├── collab/        # hocuspocus instance and hooks
│           ├── db/            # client, migrations/*.sql, migrate.ts, projects-repo.ts
│           └── lib/logger.ts
├── packages/
│   └── shared/
│       └── src/
│           ├── schema.ts      # Y.Doc shape, keys, node types, schema version
│           ├── ops.ts         # createFile, createFolder, rename, move, softDelete, restore
│           ├── resolve-tree.ts# deterministic read-time resolution (see 6.2)
│           ├── templates/     # starter projects as plain file maps
│           ├── limits.ts      # size and count limits
│           └── protocol.ts    # API DTOs (zod), awareness types
├── e2e/                       # Playwright specs
└── docs/
    ├── PLAN.md
    ├── ARCHITECTURE.md
    └── decisions/
```

Deployment changes (apply only when merging to `main`, documented in the README):

- Vercel: set the project root directory to `apps/web`; env `VITE_API_URL`, `VITE_COLLAB_URL`.
- Render: root at repo root; build `npm ci && npm run build -w apps/server`; start
  `npm run start -w apps/server`; env `DATABASE_URL`, `ALLOWED_ORIGINS`.
- Confirm both platforms install workspace dependencies correctly before switching `main`.

---

## 6. Data model

### 6.1 Project document (schema v1)

One Y.Doc per project. The document name in Hocuspocus is the project ID.

```ts
doc.getMap('meta')      // { schemaVersion: 1, name: string, template: string, createdAt: number }
doc.getMap('nodes')     // nodeId -> Y.Map<NodeFields>
doc.getMap('contents')  // fileId -> Y.Text

type NodeFields = {
  id: string;
  kind: 'file' | 'folder';
  name: string;              // label only; never used as identity
  parentId: string | null;   // null = project root
  createdAt: number;
  createdBy: string;         // user id from awareness identity
  deletedAt: number | null;  // tombstone; content is kept so delete can be undone
};
```

Rules:

- **Stable IDs.** Node IDs are nanoids, never reused and never derived from paths.
  Rename sets `name`. Move sets `parentId`. Delete sets `deletedAt`. Restore clears it.
  Because identity doesn't change on rename, someone typing in a file that gets renamed keeps
  their cursor and their edits.
- **Single write path.** All mutations go through `packages/shared/src/ops.ts`, run inside
  `doc.transact(fn, origin)`, and validate names (non-empty, no `/`, not `.` or `..`) and limits.
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
4. **Duplicate names in one folder.** Sort siblings by `(createdAt, id)`. The first keeps its
   name. The others get display names `name (2)`, `name (3)` and are reported in `conflicts`,
   and the UI shows a conflict badge. Display names are what paths, Monaco URIs and the
   WebContainer use.

Output:

```ts
type ResolvedTree = {
  byId: Map<string, ResolvedNode>;        // includes displayName, path, depth
  childrenOf: Map<string | null, string[]>; // sorted: folders first, then name
  idByPath: Map<string, string>;
  conflicts: Array<{ nodeId: string; kind: 'duplicate-name' | 'cycle' | 'missing-parent' }>;
};
```

This function needs exhaustive unit tests (each rule, combinations, stability of ordering).
It is a portfolio highlight; document it in an ADR.

### 6.3 Awareness (presence)

```ts
type AwarenessUser = {
  id: string;
  name: string;
  color: string;             // from a fixed palette readable in light and dark themes
  kind: 'human' | 'agent';   // 'agent' reserved for a future phase
};

type AwarenessState = {
  user: AwarenessUser;
  activeFileId: string | null;
  // y-monaco manages its own `selection` field for the bound editor
};
```

Identity is a guest identity (random friendly name + palette color) generated on first visit,
stored in localStorage, and editable from the UI. There are no accounts in these phases.

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

- Migrations are plain numbered SQL files run by `db/migrate.ts` on deploy.
- Wrap DB access in a `ProjectsRepo` interface with a Postgres implementation and an in-memory
  implementation for tests.
- Brute force: store the full document snapshot on each debounced save. Record the future
  optimization (append-only updates plus periodic compaction) in the ADR, but do not build it.

---

## 7. Phase 0: Baseline capture (short)

Skip the old Socket.IO bug fixes. Phase 1 replaces that code, so fixing it is wasted work.

1. `git tag v0-baseline` on the current state and push the tag.
2. Record a short screen capture of the last-write-wins bug: window A types, window B joins
   late and types, and A's work is wiped. Save it for the README "before" section.
3. Add `docs/ARCHITECTURE.md` describing the baseline in a "Before" section.

---

## 8. Phase 1: Real collaboration engine + persistence (single file)

**Goal:** replace last-write-wins with Yjs on the existing single-file experience, and make
projects persistent and real (server-issued, validated IDs).

### 8.1 Scaffold

- Root workspaces, `tsconfig.base.json`, ESLint, Prettier, Vitest, `.nvmrc`, root scripts
  (`dev`, `build`, `test`, `lint`, `typecheck`).
- `packages/shared`: `schema.ts`, `ops.ts`, `resolve-tree.ts`, `limits.ts`, `protocol.ts`,
  the `express-api` and `blank-node` templates, and full unit tests for ops and resolution.

### 8.2 Server (`apps/server`)

- `config.ts`: zod-parsed env (`PORT`, `DATABASE_URL`, `ALLOWED_ORIGINS` as a comma list,
  `LOG_LEVEL`). Fail fast on invalid config.
- Express:
  - `GET /health` returns `{ ok: true }` quickly and never touches the DB.
  - `POST /api/projects` with body `{ name?, template }` creates the project row and its
    initial Y.Doc from the template, returns `{ id }`. Rate-limited per IP (express-rate-limit).
  - `GET /api/projects/:id` returns metadata or 404.
  - CORS allowlist from `ALLOWED_ORIGINS`. No wildcard origin.
- Hocuspocus attached to the same HTTP server; WebSocket upgrades on `/collab` go to
  Hocuspocus, everything else to Express. Check the installed Hocuspocus version's API for
  the correct way to do this.
  - Reject connections to project IDs that don't exist (auth or load hook).
  - Database extension: `fetch` loads the snapshot, `store` upserts it and `updated_at`.
    Use debounce around 2s with a max debounce around 10s.
  - Reject oversized incoming updates before applying them (limit from `limits.ts`).
- Graceful shutdown on `SIGTERM` (Render sends it on deploy and spin-down): stop accepting
  connections, flush pending document stores, close the DB pool, then exit.
- pino request and collab logging (connect, disconnect, load, store, reject), with project ID.

### 8.3 Web (`apps/web`)

- Routes: `/` landing, `/p/:projectId` workspace, `/room/:id` redirects to `/p/:id` so old
  links keep working, and a 404 page for unknown projects.
- `collab/useProject(projectId)`: creates the Y.Doc and HocuspocusProvider inside an effect
  and destroys both on cleanup (StrictMode-safe). Exposes a status of `waking` (health check
  slow, likely Render cold start), `connecting`, `synced`, `reconnecting` or `offline`.
- Status UI:
  - "Waking up the server…" with a friendly explanation during cold starts.
  - "Reconnecting…" and "Offline — your edits are kept and will sync when you're back"
    (true while the tab stays open; Yjs merges on reconnect).
- Editor: Monaco bundled locally (worker setup via Vite `?worker` imports). Bind the active
  file's `Y.Text` with `MonacoBinding(ytext, model, new Set([editor]), provider.awareness)`.
- Remote cursors: generate per-client CSS for y-monaco's remote-selection classes (verify the
  class names in the installed version) using each user's color, plus a name label on the
  cursor head. Cursors disappear automatically when a user leaves (awareness removal).
- Presence bar: avatars and names from awareness; count of people online.
- Language comes from the file extension. Remove the language dropdown: language is a
  property of the file, which removes the old language-sync bug by design.
- Landing page: "Create project" (template picker: Express API, Blank Node) and "Join"
  (paste a link or ID; validated via `GET /api/projects/:id`).

### 8.4 Cutover

Once the new apps pass the definition of done, delete `frontend/` and `backend/`, and update
the README run instructions.

### 8.5 Definition of done

- Two windows type at the same position at the same time: both converge, nothing is lost.
- A late joiner immediately sees the current content.
- One window goes offline (DevTools), both keep typing, it reconnects: edits merge.
- Restarting the server loses nothing.
- An unknown project URL shows the 404 page.
- Named, colored remote cursors; a leaving user's cursor disappears.

### 8.6 Tests

- Unit: all of `packages/shared`.
- Integration (Vitest, Node): start Hocuspocus in-process with the in-memory repo, connect two
  providers (use the `ws` package as the WebSocket implementation), make concurrent edits,
  assert convergence; assert store/fetch round-trips; assert unknown IDs are rejected.
- E2E (Playwright): two browser contexts on one project, type in both, assert identical text.
- GitHub Actions: lint, typecheck, unit + integration on every push and PR.

### 8.7 ADRs

- 001: CRDT (Yjs) over last-write-wins, and why not operational transformation.
- 002: Hocuspocus + Postgres snapshot persistence; snapshot now, incremental later.

---

## 9. Phase 2: Multi-file workspace

**Goal:** a real project workspace where people work in different files at once and can see
where everyone is.

### 9.1 Layout

Three resizable panes: file tree | tabbed editor | run panel (placeholder until Phase 3).

### 9.2 File tree

- Create file and folder, inline rename, delete (soft, with an undo toast), move by drag and
  drop, right-click context menu, basic keyboard navigation.
- Rendered from `resolveTree`. Conflict badges for resolved duplicates.
- Presence dots on files showing who has each file open (from `activeFileId`).

### 9.3 Tabs and editor

- Open tabs are local to each user (not synced).
- One Monaco model per open file with URI `file:///<path>`. When a rename changes the path,
  recreate the model (Monaco URIs are immutable) and carry over view state.
- Brute force: bind only the active file (dispose the binding on tab switch, bind the new one).
  Make sure remote selections only render for the active file (check how the installed
  y-monaco resolves positions against its own `Y.Text`; filter by `activeFileId` if needed).
- If an open file is deleted by someone else, show "Deleted by <name> · Restore" in its tab.
- Clicking a collaborator's avatar opens their file and reveals their cursor.

### 9.4 Limits and scale

- Enforce max file size and max node count in `ops.ts` (client) and keep the server-side
  update-size rejection from Phase 1.
- Brute force keeps every file in one Y.Doc, which is fine up to a few hundred small files.
  Record the future optimization (Yjs subdocuments per file, loaded lazily) in an ADR. Do not
  build it.

### 9.5 Definition of done

- Two users edit different files at the same time; both see each other's presence in the tree.
- User A renames a file while user B types in it: B's cursor and edits survive.
- User A deletes a file B is editing: B sees the deleted state and can restore it.
- Both users create `utils.js` in the same folder at the same moment: both files survive,
  one is shown as `utils (2).js` with a conflict badge, identically on both screens.
- Concurrent cross-moves of two folders produce the same resolved tree on both screens.

### 9.6 Tests and ADR

- Unit tests for every new op and resolution case.
- E2E for concurrent rename-while-editing and duplicate-create.
- ADR 003: stable IDs + read-time deterministic resolution.

---

## 10. Phase 3: Run the backend in the browser (WebContainers)

**Goal:** anyone in the project can run the Node backend in their own tab and call its
endpoints, and it reloads as collaborators edit.

### 10.1 Prerequisites

- **Cross-origin isolation.** Serve `Cross-Origin-Embedder-Policy: require-corp` and
  `Cross-Origin-Opener-Policy: same-origin` on every route: in `apps/web/vercel.json` for
  production and in Vite `server.headers` / `preview.headers` locally.
- Audit every cross-origin asset (fonts, images, analytics scripts). Self-host them or make
  sure they send the right headers. Monaco is already bundled locally from Phase 1.
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
    Execute requests *inside the container* with a helper script written once to the
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
- ADR 004: one-way Yjs → WebContainer sync.
- ADR 005: in-browser execution with WebContainers (cost, sandboxing, browser support, license).

---

## 11. Cross-cutting standards

- **Performance:** subscribe React to Yjs through small selector hooks
  (`useSyncExternalStore`) so a keystroke doesn't re-render the whole workspace. Debounce
  expensive derived work (tree resolution, FS sync).
- **Accessibility:** keyboard-reachable controls, visible focus states, sufficient contrast in
  both themes, and remote-cursor labels that stay readable.
- **Error handling:** an error boundary per pane; user-facing errors are specific and
  actionable.
- **Environment variables:**

| Variable | App | Purpose |
|---|---|---|
| `VITE_API_URL` | web | Base URL for the REST API |
| `VITE_COLLAB_URL` | web | WebSocket URL for Hocuspocus (`wss://…/collab`) |
| `PORT` | server | Injected by Render |
| `DATABASE_URL` | server | Neon Postgres connection string |
| `ALLOWED_ORIGINS` | server | Comma-separated allowed web origins |
| `LOG_LEVEL` | server | pino log level |

Provide `.env.example` files for both apps. Make sure `.env` is gitignored in every package.

---

## 12. Out of scope for phases 0–3

Accounts and auth, AI agent features, checkpoints and GitHub push, shared terminals, Yjs
subdocuments, persistence of offline edits across page reloads (IndexedDB), and a mobile
layout beyond "doesn't break".

---

## 13. Documentation deliverables

- `docs/ARCHITECTURE.md`: kept current each phase, with the diagram from section 3.
- ADRs 001–005 as listed in each phase.
- README (update at the end of Phase 3): pitch, demo GIF, before/after story, architecture
  diagram, how to run locally, deployment notes, WebContainer license note, roadmap.
