# CollabCode

A multiplayer code workspace in the browser. Several people open the same project, edit at the
same time, and see each other's named cursors. Nothing is lost when someone joins late, drops
offline, or closes the tab mid-keystroke.

It runs entirely on free infrastructure: Vercel for the web app, Render for the sync server, Neon
for Postgres.

**Status: Phase 1 complete.** Real-time collaboration and persistence work on a single file per
project. The multi-file workspace (Phase 2) and running a Node backend in the browser via
WebContainers (Phase 3) are specified in [`docs/PLAN.md`](docs/PLAN.md) and not built yet.

---

## The problem this solves

The first version of this project did what a lot of "real-time collaborative editor" tutorials
do: on every keystroke it sent the **entire document** over a WebSocket, and every other client
replaced its whole buffer with whatever arrived last.

That looks like collaboration in a demo with one person. With two, it loses work:

- Two people typing at once did not merge — one person's message overwrote the other's text, and
  neither of them could tell.
- A late joiner had no way to receive the current state, so their first keystroke broadcast their
  empty starting buffer and wiped the room.
- Remote cursors were absolute line/column numbers, so someone typing above you moved your caret.

Tag [`v0-baseline`](../../tree/v0-baseline) is that version.
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) documents all fourteen defects, each reproducible.

The rewrite replaces whole-document replacement with a **CRDT**. The unit of sync becomes the
operation — "insert this character after that one" — and operations commute, so every client that
has seen the same edits computes the same document no matter what order they arrive in. Cursors
are anchored to characters rather than offsets, so they stay put while other people type around
them.

The analogy: the old version emailed the whole file on every keystroke and the last email won.
The new one sends individual edits that every copy can apply in any order and still agree.

## How it works

```
Browser                                  Render                       Neon
┌─────────────────────────┐   REST      ┌──────────────────────┐    ┌──────────┐
│ Monaco ── y-monaco ──┐  │  ────────►  │ Hocuspocus owns the  │───►│ projects │
│                      ▼  │             │ HTTP server:         │    │  .ydoc   │
│ React UI ──────► Y.Doc ─┼─ WebSocket ►│  onRequest → Express │    │  (bytea) │
│                      ▲  │  /collab    │  onUpgrade → /collab │    └──────────┘
│ Awareness ───────────┘  │             │  extensions → guard, │
└─────────────────────────┘             │    database, logging │
                                        └──────────────────────┘
```

The server syncs and stores. It never runs or interprets user code.

Three decisions are written up in full:

- [001 — a CRDT instead of last-write-wins, and why not operational transformation](docs/decisions/001-crdt-over-last-write-wins.md)
- [002 — Hocuspocus with whole-document Postgres snapshots](docs/decisions/002-persistence.md)
- [003 — Hocuspocus owns the HTTP server, Express is mounted inside it](docs/decisions/003-hocuspocus-owns-the-http-server.md)

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the system as it stands today,
including the trust boundaries and what is deliberately missing.

## Running it locally

**Prerequisites:** Node 24 (see `.nvmrc`) and a Postgres database. The free
[Neon](https://neon.tech) tier is what this is built against; any Postgres works.

```bash
npm install

# Server configuration
cp apps/server/.env.example apps/server/.env
#   then set DATABASE_URL to your Postgres connection string
npm run migrate -w @collabcode/server

# Web configuration (the defaults point at the local server)
cp apps/web/.env.example apps/web/.env

npm run dev
```

`npm run dev` starts the shared package in watch mode, the sync server on
`http://localhost:8080` and the web app on `http://localhost:5173`. Open the web app in two
windows to see collaboration; the second window can be a private window, since identity is
per-browser.

To run just one piece: `npm run dev:server` or `npm run dev:web`.

### Environment variables

| Variable          | App    | Purpose                                                                             |
| ----------------- | ------ | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`    | server | Postgres connection string. Use Neon's **pooled** endpoint with `?sslmode=require`  |
| `ALLOWED_ORIGINS` | server | Comma-separated web origins allowed to call the API. No wildcard, no trailing slash |
| `PORT`            | server | Injected by Render; defaults to 8080                                                |
| `LOG_LEVEL`       | server | pino level; `info` in production                                                    |
| `VITE_API_URL`    | web    | Base URL of the REST API                                                            |
| `VITE_COLLAB_URL` | web    | WebSocket URL, e.g. `wss://your-server/collab`                                      |

Configuration is parsed with zod at start-up, so a missing or malformed value fails immediately
and names the variable rather than breaking at the first request.

## Testing

```bash
npm run lint
npm run typecheck
npm test          # unit + integration
npm run e2e       # Playwright, two browser contexts against the production bundle
```

`npm test` runs without a database. The integration tests start the real Express + Hocuspocus
composition on an ephemeral port against an in-memory repository, so they exercise the production
wiring rather than a stub. The Postgres repository, the `bytea` round trip and the migration
runner are covered by a spec that skips unless `TEST_DATABASE_URL` is set; CI provides one.

`npm run e2e` builds the web app and serves it with `vite preview`, because the fragile part of
the frontend is what bundling produces — Monaco and its web workers.

## Deploying

**Vercel** (web): set the project's root directory to `apps/web`. Build command
`npm run build`, output `dist`. Set `VITE_API_URL` and `VITE_COLLAB_URL` to the Render service.
SPA rewrites come from `apps/web/vercel.json`.

**Render** (server): root directory is the repository root. Build
`npm ci && npm run build -w @collabcode/shared && npm run build -w @collabcode/server`, start
`npm run start -w @collabcode/server`, and run `npm run migrate -w @collabcode/server` on deploy.
Set `DATABASE_URL`, `ALLOWED_ORIGINS` and `LOG_LEVEL`.

A free Render instance sleeps when idle, so the first connection after a quiet period can take up
to a minute. The app expects this: the landing page pings `/health` on load to start the wake
early, and the workspace explains the wait instead of showing a spinner.

## Layout

```
apps/web/          React + Vite + Monaco. Provider lifecycle, editor binding, presence
apps/server/       Hocuspocus + Express + Postgres
packages/shared/   Document schema, write-path ops, awareness validation, templates, limits
e2e/               Playwright specs
docs/              PLAN.md, ARCHITECTURE.md, decisions/
```

## Roadmap

- **Phase 2** — multi-file workspace: file tree, tabs, and deterministic read-time resolution of
  concurrent tree edits (duplicate names, cycles, orphans) so every client computes the same view.
- **Phase 3** — run the project's Node backend inside the browser with WebContainers, with a
  terminal, a preview and an API console.

Later, deliberately out of scope for now: accounts, an AI agent participating through the same
sync system, checkpoints, and pushing to GitHub.

## Licence

MIT.
