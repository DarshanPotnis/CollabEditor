# CollabCode

A multiplayer code workspace in the browser. Several people open the same project, work in the
same or different files at the same time, and see each other's named cursors and where everyone
is in the file tree. Anyone can run the project's Node backend in their own browser tab and call
its endpoints while everyone keeps editing. Nothing is lost when someone joins late, drops
offline, or closes the tab mid-keystroke.

It runs entirely on free infrastructure: Vercel for the web app, Render for the sync server, Neon
for Postgres.

**Status: Phase 3, AI-1 and AI-2 complete.** Projects are multi-file workspaces (a file tree with
presence, drag-and-drop moves and a Recently deleted bin, tabs, per-person undo, following a
collaborator to their cursor), and each person can run the backend in their browser with
WebContainers: run output, a shell, an API console and a preview. AI helpers explain or edit a
selection and explain a crashed run, and an **AI teammate** joins the room as its own peer: it
types its edits in live, runs the project and calls its API, and one click undoes its work. It
runs on a free shared tier or your own key. The plans are
[`docs/PLAN.md`](docs/PLAN.md) and [`docs/PLAN-AI.md`](docs/PLAN-AI.md).

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

A file tree has conflicts of its own. Two people can create `utils.js` in the same folder before
either sees the other's, or move two folders into each other at the same moment. Files are
identified by stable IDs rather than paths, so a rename never disturbs someone typing in the file,
and every browser runs the same pure function over the same data to draw the tree: both
`utils.js` files survive, one shown as `utils (2).js`, identically on every screen. Undo is per
person, so undoing never removes a collaborator's work.

## How it works

```
Browser                                  Render                       Neon
┌─────────────────────────┐   REST      ┌──────────────────────┐    ┌──────────┐
│ Monaco ── y-monaco ──┐  │  ────────►  │ Hocuspocus owns the  │───►│ projects │
│                      ▼  │             │ HTTP server:         │    │  .ydoc   │
│ React UI ──────► Y.Doc ─┼─ WebSocket ►│  onRequest → Express │    │  (bytea) │
│                   │  ▲  │  /collab    │  onUpgrade → /collab │    └──────────┘
│ Awareness ────────┼──┘  │             │  extensions → guard, │
│                   ▼     │             │    database, logging │
│ WebContainer (on Run):  │             └──────────────────────┘
│ Node, npm, your server  │
└─────────────────────────┘
```

The server syncs and stores. It never runs or interprets user code: running happens only in the
browser of the person who clicks Run, in a WebContainer that the project's files are copied into,
one way.

Eight decisions are written up in full:

- [001 — a CRDT instead of last-write-wins, and why not operational transformation](docs/decisions/001-crdt-over-last-write-wins.md)
- [002 — Hocuspocus with whole-document Postgres snapshots](docs/decisions/002-persistence.md)
- [003 — Hocuspocus owns the HTTP server, Express is mounted inside it](docs/decisions/003-hocuspocus-owns-the-http-server.md)
- [004 — stable node IDs and deterministic read-time resolution of the file tree](docs/decisions/004-stable-ids-and-read-time-resolution.md)
- [005 — one-way sync from the document into the WebContainer](docs/decisions/005-one-way-yjs-to-webcontainer-sync.md)
- [006 — running projects in the browser with WebContainers](docs/decisions/006-in-browser-execution-with-webcontainers.md)
- [007 — the model as the brain, the browser as the hands, and a stateless model proxy](docs/decisions/007-brain-and-hands-model-proxy.md)
- [008 — the AI agent as a separate CRDT peer](docs/decisions/008-agent-as-a-crdt-peer.md)

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the system as it stands today,
including the trust boundaries and what is deliberately missing.

## Running a project in your browser

Click **Run** in a project. The first Run boots a [WebContainer](https://webcontainers.io), a
Node runtime by StackBlitz that runs inside the browser, copies the project into it, runs
`npm install` when the dependencies changed, then `npm run dev`. The Run panel has the output, an
interactive shell, an **API console** that calls your server from inside the container (no CORS
set-up), and a sandboxed **preview**. Collaborators' edits restart your server; if it crashes, the
next file change restarts it.

- **Nothing runs until you click Run**, and your run is yours alone. The code may include edits
  from anyone in the project; it runs in StackBlitz's sandbox in your browser, which cannot reach
  this page, your storage or the project's server. [ADR 006](docs/decisions/006-in-browser-execution-with-webcontainers.md)
  lists what the sandbox does and does not protect.
- **Browsers:** Chrome, Edge and other Chromium browsers are fully supported. Safari 16.4+ (beta)
  and Firefox (alpha) may work, with a notice. Without cross-origin isolation Run is disabled and
  editing still works. If your browser blocks third-party cookies, allow them for
  `stackblitz.com`; the runtime lives in an iframe from there.
- **Node 22.** The container runs Node 22, not the Node 24 this repository uses, so templates
  declare `engines: { node: ">=22" }`.
- **Privacy:** running sends nothing to this project's server, but the runtime is served by
  StackBlitz and `npm install` goes through their infrastructure.

**Licence.** The WebContainer API's npm package is MIT, but using it means accepting
[StackBlitz's Terms of Service](https://stackblitz.com/terms-of-service). Their
[commercial usage page](https://webcontainers.io/enterprise) says a licence is required "for
production usage of the API in a commercial, for-profit setting", and that prototypes do not need
one. CollabCode is a non-commercial open-source project and uses no API key; a commercial fork
would need a licence first.

## AI helpers

- **Explain with AI** and **Edit with AI…**: select code, right-click, and choose one. An
  explanation streams into the **AI** panel, above the Run views. An edit asks what to change,
  then shows the suggestion as a diff over the editor with **Apply** and **Discard**. An applied
  edit reaches everyone like your own typing, and one undo takes it back. If a collaborator
  changes the selected code before you apply, Apply refuses instead of overwriting their work.
- **Explain with AI** on a run: when your run crashes or fails, the Run view offers it. It sends
  the end of the output and the code of the file the crash points at.
- **Who pays.** By default requests use a shared free tier on Google Gemini, with a daily limit
  for everyone and per visitor; the app says how many you have left. In **AI settings** you can
  use your own Gemini, Anthropic or OpenAI key instead. It is kept in that browser tab only, sent
  with each request, used by the server for that one call and never stored or logged.
- **Privacy.** Before your first request the app shows a one-time notice: your request and the
  code or output it is about go through this project's server to the AI provider, and on the
  free tier Google may use what you send to improve its products. Leave out secrets and code you
  cannot share; your own key avoids the shared tier. This project's server does not store or log
  what you send.

How it works, and why, is in [ADR 007](docs/decisions/007-brain-and-hands-model-proxy.md).

## The AI teammate

Tell it what to do in the AI panel ("Add a DELETE /users/:id endpoint with validation") and press
**Start**. An **AI teammate** appears in everyone's presence bar, working for you. It reads the
code, types its edits in live with its own caret, runs the project in your browser, calls the
endpoints it changed, reads the errors and fixes them, then says what it did. Your editor follows
it into its files until you type or open another file (**Follow AI** resumes).

- **It works around people.** A file someone else is typing in is left alone: it says what it
  would have changed there instead. Your own open files are fair game.
- **Everything is reversible.** **Undo AI changes** removes its edits and nothing anyone else
  wrote, even inside its text; files it created go to Recently deleted. If someone has edited
  those files since, it asks first. Undo is there until you click **Done**.
- **It is bounded.** Up to 15 steps on the shared free tier (25 with your own key) and 5 minutes;
  **Stop** ends it at once. A shared-tier session needs 15 of your 30 free requests a day, so
  your own key is the way to use it often. When Gemini is busy it waits and tries twice more. It
  is told to make the smallest change the goal needs and to finish once it has checked it; if it
  ends without finishing, the panel lists the files it changed.
- **No sandbox, no guessing.** If this page can't run code, the Run panel says why, and the AI
  teammate makes its change without running it and tells you to click Run yourself.
- **It is recorded.** **Download trace** saves the session as JSON: every model answer and tool
  call, for replaying or for evals. It never contains your key.
- **Prompt injection.** Files, output and responses may have been written by anyone in the
  project. The agent treats them as data, and its tools cannot do more than a collaborator could:
  edit or soft-delete this project's files, and run code in your own sandbox.

[ADR 008](docs/decisions/008-agent-as-a-crdt-peer.md) explains the design.

## Evals

The AI teammate is measured on 21 tasks: endpoints with validation, seeded bugs, a crash whose
stack trace points at the wrong line, refactors, a test that must be able to fail, instructions
planted in files and output, and people working in the files it needs. Each task runs the same
agent the browser runs, against a real model, with model-written code in a locked-down Docker
sandbox, and automatic graders check the result, not the agent's word for it. The graders are
tested too: every task's reference solution must pass them and deliberately bad sessions must
fail them. How it works and how to run it: [docs/evals](docs/evals/README.md).

What the evals show so far, on `gemini-3.5-flash-lite`:

- **It checks what it changed.** Since agent@4 the agent is told to check every behaviour it
  added, each error case and one thing that worked before. After its last change it made 2.8 and
  3.0 checks per session (agent@5, agent@4), against 1.6 and 2.0 in two agent@3 runs.
- **Its list of checks is verified, not taken on trust.** `finish` lists the requests and commands
  the agent says it checked, and the agent core holds each against what the session actually did
  ([ADR 012](docs/decisions/012-agent-4-verified-finish.md)). In the agent@4 and agent@5 runs (42
  sessions), no accepted `finish` listed a check that was not made. The core refused 11 finishes
  that did, and each of those sessions then made the check or left it out.
- **A better pass rate is not shown yet.** The runs below have one session per task, and two
  agent@3 runs on the same day differed by three tasks. The headline will come from three sessions
  per task for agent@3 and the current agent, and a pass-rate difference is claimed only if those
  runs support it.

<!-- prettier-ignore-start -->
<!-- evals:start -->

**Headline** (3 sessions per task):

No run with 3 sessions per task is recorded yet, so there is no headline pass rate.

**Iteration runs** (one session per task, so a task or two either way is noise):

| Model | Date | Prompt | Graders | Passed | Checks after the last change | Wasted steps | Requests | Tokens | Report |
| --- | --- | --- | --- | --: | --: | --: | --: | --: | --- |
| gemini-3.5-flash-lite | 2026-09-29 | agent@5 | graders@3 | 19 of 21 | 2.8 | 0.4 | 5.4 | 25,092 | [2026-09-29-gemini-3.5-flash-lite-edca946](docs/evals/results/2026-09-29-gemini-3.5-flash-lite-edca946.md) |
| gemini-3.5-flash-lite | 2026-09-29 | agent@4 | graders@3 | 19 of 21 | 3.0 | 0.9 | 5.6 | 25,778 | [2026-09-29-gemini-3.5-flash-lite-f04d870](docs/evals/results/2026-09-29-gemini-3.5-flash-lite-f04d870.md) |
| gemini-3.5-flash-lite | 2026-09-29 | agent@3 | graders@3 | 18 of 21 | 2.0 | 0.5 | 6.0 | 23,943 | [2026-09-29-gemini-3.5-flash-lite-a7f0a02](docs/evals/results/2026-09-29-gemini-3.5-flash-lite-a7f0a02.md) |

<!-- evals:end -->
<!-- prettier-ignore-end -->

## Running it locally

**Prerequisites:** Node 24 (see `.nvmrc`) and a Postgres database. The free
[Neon](https://neon.tech) tier is what this is built against; any Postgres works.

```bash
npm install

# Server configuration
cp apps/server/.env.example apps/server/.env
#   then set DATABASE_URL to your Postgres connection string,
#   and GEMINI_API_KEY if you want the shared AI tier (optional)
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

`npm run dev` and `npm run migrate` read `apps/server/.env` with its values taking precedence
over variables already set in your shell, and log the names (never the values) of any they
replace. Node's own `--env-file` would let a machine-wide `DATABASE_URL` win.

### Environment variables

| Variable                        | App    | Purpose                                                                                                                           |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | server | Postgres connection string. Use Neon's **pooled** endpoint with `?sslmode=require`                                                |
| `ALLOWED_ORIGINS`               | server | Comma-separated web origins allowed to call the API. No wildcard, no trailing slash                                               |
| `PORT`                          | server | Injected by Render; defaults to 8080                                                                                              |
| `LOG_LEVEL`                     | server | pino level; `info` in production                                                                                                  |
| `CLIENT_IP_SOURCE`              | server | Where per-IP limits read the client address: `render` (default) or `direct`                                                       |
| `GEMINI_API_KEY`                | server | Key for the shared free AI tier (Google AI Studio). Optional: unset turns the shared tier off; people can still use their own key |
| `AI_DEFAULT_MODEL`              | server | The shared tier's Gemini model; `gemini-3.5-flash-lite` by default                                                                |
| `AI_FALLBACK_MODEL`             | server | Optional second Gemini model, tried when the default is busy; one-shot helpers and an agent session's first step only             |
| `AI_GLOBAL_DAILY_REQUESTS`      | server | Shared-tier requests a day for everyone together; 400 by default (80% of the free 500)                                            |
| `AI_PER_IP_DAILY_REQUESTS`      | server | Shared-tier requests a day per visitor; 30 by default                                                                             |
| `AI_PER_PROJECT_DAILY_REQUESTS` | server | Shared-tier requests a day per project; 60 by default                                                                             |
| `AI_GLOBAL_REQUESTS_PER_MINUTE` | server | Shared-tier requests in any 60 seconds, everyone together; 12 by default (80% of the free 15)                                     |
| `AI_AGENT_REQUESTS_PER_MINUTE`  | server | How many of those may be AI agent steps; 6 by default, so the one-shot helpers keep the rest                                      |
| `VITE_API_URL`                  | web    | Base URL of the REST API                                                                                                          |
| `VITE_COLLAB_URL`               | web    | WebSocket URL, e.g. `wss://your-server/collab`                                                                                    |

Configuration is parsed with zod at start-up, so a missing or malformed value fails immediately
and names the variable rather than breaking at the first request.

## Testing

```bash
npm run lint
npm run typecheck
npm test          # unit + integration
npm run e2e       # Playwright, two browser contexts against the production bundle

# Boots real WebContainers, so it needs the network; not part of CI:
RUN_WEBCONTAINER_E2E=1 npm run e2e -- runtime.spec.ts

# The evals' graders against their reference and known-bad sessions, and the recorded
# sessions replayed: no model or key, but Docker. CI runs it:
npm run evals:selftest
```

`npm test` runs without a database or an AI key. The integration tests start the real Express + Hocuspocus
composition on an ephemeral port against an in-memory repository, so they exercise the production
wiring rather than a stub. The Postgres repository, the `bytea` round trip and the migration
runner are covered by a spec that skips unless `TEST_DATABASE_URL` is set; CI provides one.

`npm run e2e` builds the web app and serves it with `vite preview`, because the fragile part of
the frontend is what bundling produces — Monaco and its web workers. It is served cross-origin
isolated, exactly like production, so every spec also checks the app still works under those
headers. The AI specs, the AI teammate's included, run against a scripted model built into the
e2e server, so they need no key and spend no quota. CI also runs the API console's request helper on Node 22, the version inside the
WebContainer.

## Deploying

**Vercel** (web): set the project's root directory to `apps/web`. Build command
`npm run build`, output `dist`. Set `VITE_API_URL` and `VITE_COLLAB_URL` to the Render service.
SPA rewrites come from `apps/web/vercel.json`.

**Render** (server): root directory is the repository root. Build
`npm ci && npm run build -w @collabcode/shared && npm run build -w @collabcode/server`, start
`npm run start -w @collabcode/server`, and run `npm run migrate -w @collabcode/server` on deploy.
Set `DATABASE_URL`, `ALLOWED_ORIGINS` and `LOG_LEVEL`, and `GEMINI_API_KEY` for the shared AI
tier. `CLIENT_IP_SOURCE` defaults to `render`, which is what Render needs. Create the Gemini key
in a Google Cloud project used only for this app: the free limits are per project, not per key,
and the AI limit defaults assume that project's page at
[aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit) shows 15 requests a
minute and 500 a day for the model.

### Launch checklist: cross-origin isolation

Running code needs the web app to be cross-origin isolated. `apps/web/vercel.json` sends the
headers, and the e2e suite checks them against a local production build, but check the real
deployment after every change to hosting:

1. `curl -sI https://<your-site>/ | grep -i cross-origin` shows
   `cross-origin-opener-policy: same-origin` and `cross-origin-embedder-policy: require-corp`.
2. The same for a worker script: open the site, find a `…worker-….js` request in DevTools →
   Network, and `curl -sI` its URL. Workers need the headers too, or Monaco falls back to running
   their code on the main thread.
3. In the browser console on the site, `crossOriginIsolated` is `true`.

### Launch checklist: client IPs behind Render

Requests reach the server through Cloudflare and Render's load balancers, so per-IP limits use the
first `X-Forwarded-For` entry, which Render sets to the real client address
(`apps/server/src/http/client-ip.ts`). Check that Render still does this after every change to
hosting:

1. Send two project creations with different forged addresses and compare the remaining count
   (`r=`) in the `RateLimit` header. It must go down by one, because Render replaces the forged
   first entry with your real address and both requests land in your allowance:

   ```bash
   for ip in 203.0.113.1 198.51.100.7; do
     curl -s -o /dev/null -D - -X POST https://<your-server>/api/projects \
       -H 'content-type: application/json' -H "x-forwarded-for: $ip" \
       -d '{"template":"blank-node"}' | grep -i '^ratelimit:'
   done
   ```

   If the count starts over for the second request, the forged address is being trusted: stop
   and fix `clientIp()` before launch.

2. From a different network (a phone on mobile data), the count starts at the full limit, so
   visitors are not sharing one proxy address.

### Launch checklist: AI

1. The server's start-up log shows `sharedAi: "gemini-3.5-flash-lite"` (or your model), and no
   key anywhere in it.
2. Answers stream through Render's proxy. With a project ID from the site:

   ```bash
   curl -sN -X POST https://<your-server>/api/ai/step \
     -H 'content-type: application/json' -H 'origin: https://<your-site>' \
     -d '{"projectId":"<id>","promptId":"explain-selection","inputs":{"path":"index.js","language":"javascript","startLine":1,"selection":"console.log(1);"}}'
   ```

   `data:` lines should arrive over a second or two, not all at once. All at once still works, but
   means a proxy is buffering.

3. The same request without the `origin` header is refused with 403.
4. Render's logs show one `ai step` line per request, with ids, model, tokens and timings, and no
   code, prompt or key. An AI teammate session's lines also carry its session id and step.
5. An AI teammate session on the shared tier finishes the demo task on a new Express project.

A free Render instance sleeps when idle, so the first connection after a quiet period can take up
to a minute. The app expects this: the landing page pings `/health` on load to start the wake
early, and the workspace explains the wait instead of showing a spinner.

## Layout

```
apps/web/          React + Vite + Monaco. File tree, tabs, editor models and undo, presence,
                   the runtime (WebContainer, file sync, terminal, API console, preview) and
                   the AI panel, helpers and client
apps/server/       Hocuspocus + Express + Postgres, and the model proxy
packages/shared/   Document schema, tree resolution, write-path ops (tree, text, agent undo),
                   awareness validation, templates, limits, AI prompts, tools and the
                   model-proxy contract
packages/agent/    The AI teammate's core, with no browser or Node dependency: the loop,
                   limits, retries, file tools, presence rule, typing, traces, and what the
                   run tools say
packages/model-gateway/  Model calls through the Vercel AI SDK, for the server and the evals
apps/evals/        The evals: tasks, graders, the Docker sandbox and the eval runner
e2e/               Playwright specs
docs/              PLAN.md, ARCHITECTURE.md, decisions/, manual-tests/, evals/
```

## Roadmap

- **Phase 2** (done) — multi-file workspace: file tree, tabs, per-person undo, and deterministic
  read-time resolution of concurrent tree edits so every client computes the same view.
- **Phase 3** (done) — run the project's Node backend inside the browser with WebContainers, with
  run output, a shell, an API console and a sandboxed preview.
- **AI-1** (done) — a stateless model proxy, and helpers that explain or edit a selection and
  explain a crashed run.
- **AI-2** (done) — an AI teammate that joins the project as its own CRDT peer, types live, runs
  and calls the project, and is undone in one click.
- **AI-3 to AI-5** (planned, [`docs/PLAN-AI.md`](docs/PLAN-AI.md)) — presence-aware proposals,
  evals, and a context engine with a trace viewer and a replayed demo.

Later, deliberately out of scope for now: accounts, checkpoints, and pushing to GitHub.

## Licence

MIT.
