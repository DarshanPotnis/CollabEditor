# CollabCode: Architecture

A living description of how the system works **today**. Each phase updates this file.

Current state: **v3 (Phase 3) plus AI-1 and AI-2** — a multi-file workspace on a Yjs CRDT synced
by Hocuspocus and persisted as Postgres snapshots (file tree with presence, tabs, per-person undo,
deterministic resolution of concurrent tree edits), and each person can run the project's Node
backend in their own browser tab with WebContainers, call it from an API console, open a shell
and see a preview. AI-1 adds one-shot AI helpers: explain or edit a selection, and explain a
crashed run, through a stateless model proxy on the free Gemini tier or the person's own key.
AI-2 adds an AI teammate: an agent that joins the room as its own CRDT peer, edits files live,
runs the project in the person's browser and calls its API, and can be undone in one click.

| Tag                   | What it is                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| `v0-baseline`         | The original project, as first written. The "before" in the README story. |
| `v0.1-socketio-fixes` | The same architecture with its correctness and safety bugs fixed.         |

The two sections at the end of this file describe those earlier versions. They are kept because
the point of Phase 1 is what changed between them and now.

---

## v3: today

### Shape

```
┌──────────────────────────── Browser (apps/web) ─────────────────────────────┐
│  React 19 + Vite                                                            │
│                                                                             │
│  file tree ◄── tree store ◄── resolveTree ◄── nodes (Y.Map) ──┐             │
│      │         (observes nodes only)                          │             │
│      └──► tree ops (packages/shared) ── transact ────────────►├─ Y.Doc      │
│                                                               │   │         │
│  tabs ──► model registry: per open tab                        │   │         │
│           Monaco model ◄─ y-monaco binding ─► contents[id] ───┘   │         │
│           + a Y.UndoManager per file (only your binding)          │         │
│                                                                   │         │
│  Awareness (name, colour, activeFileId, selection) ───────────────┤         │
│                                                                   ▼         │
│                                                        HocuspocusProvider   │
└───────────────────────────────────────────────────────────────────┬─────────┘
                                                                    │
                     REST (fetch)                                   │ WebSocket
                     /health, /api/projects, /api/ai/step (stream)  │ /collab
                                                                    ▼
┌─────────────────────── Render (apps/server) ────────────────────────┐
│  @hocuspocus/server owns the Node HTTP server                       │
│    ├─ onRequest  ──► Express app (health, projects, AI, CORS)       │
│    ├─ onUpgrade  ──► only /collab reaches the WebSocket layer        │
│    └─ extensions ──► project guard → Database → logging             │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ snapshot per project
                                         ▼
                            ┌──── Neon Postgres ────┐
                            │ projects.ydoc (bytea) │
                            └───────────────────────┘
```

**The server syncs and stores. It never runs or interprets user code.** It does not even
interpret the file tree: every structural rule lives in `packages/shared` and runs in the
browsers. Code runs only in the browser of whoever clicks Run (see "Running the project").

### Where the truth lives

One `Y.Doc` per project, named by the project ID. Schema v1 (`packages/shared/src/schema.ts`):

```ts
doc.getMap('meta'); // { schemaVersion, name, template, createdAt }
doc.getMap('nodes'); // nodeId -> Y.Map<NodeFields>
doc.getMap('contents'); // fileId -> Y.Text
```

Each node is `{ id, kind, name, parentId, createdAt, createdBy, deletedAt, deletedBy,
deletedByName }`. Node IDs are nanoids and never derived from paths: rename writes `name`, move
writes `parentId`, delete writes a tombstone, restore clears it. Because identity survives a
rename, someone typing in a file that gets renamed keeps their cursor, their edits and their undo
history. `deletedBy` and `deletedByName` were added in Phase 2 as optional fields that read as
`null` when absent, so Phase 1 documents need no migration.

Reads are defensive. `readNode`, `readAllNodes` and `readMeta` parse with zod and return `null` or
skip the entry when another client has written something that does not match the schema; they
never throw. A malformed node cannot take the UI down, and `deletedByName`, which is peer-written
text, is sanitised like an awareness name and reads as `null` rather than hiding the node.

### The write path, and its one exception

Every structural mutation goes through `packages/shared`, inside `doc.transact(fn, OPS_ORIGIN)`:
`initProjectDoc` in `ops.ts` (called once, on the server, from a template), the tree ops in
`tree-ops.ts` (`createFile`, `createFolder`, `rename`, `move`, `softDelete`, `restore`) and
`purgeDeleted` in `purge-ops.ts`. The UI calls them through one hook, `useTreeActions`, and a
refusal comes back as an `OpError` whose message is written to be shown as-is.

Each tree op resolves the tree as this client sees it and checks the write first
(`tree-rules.ts`, shared with the UI so a drag only offers valid drop targets):

- names are valid, NFC-normalised, and **do not clash with a visible sibling, compared
  case-insensitively**, so a project cloned onto macOS or Windows cannot collide;
- a folder cannot be moved into itself or below itself;
- at most 500 visible nodes, and at most 2,000 counting deleted ones, whose content is kept so
  they can be restored. The second limit's message points to Recently deleted.

`restore` clears the tombstone on the node and on any deleted ancestor hiding it; if the name has
been taken meanwhile it takes the next free `name (n)`, for real, and says so.

**The exception is y-monaco.** It writes editor keystrokes straight into the file's `Y.Text`,
bypassing `ops.ts` entirely. That is why the per-file size limit is enforced at the editor
(`apps/web/src/features/editor/file-size-guard.ts`) rather than in `ops.ts`: insertions and
oversized pastes are refused at the limit with a message, and deletions always work so a file can
be brought back under. This exception is recorded in `CLAUDE.md`. An AI edit applied with Apply
goes through the file's Monaco model too, so it falls under the same exception rather than adding
one (see "The AI helpers"). The AI teammate has no editor, so its edits go through
`text-ops.ts` instead, which enforces the same limit (see "The AI teammate").

### Concurrent tree edits: read-time resolution

Write-time checks see only this client's copy. Two people creating `utils.js` in the same folder
before either has seen the other, or moving folder X into Y while the other moves Y into X, produce
states nobody drew. Nobody repairs them with a write, because several clients repairing at once
would race. Instead every client runs the same pure function, `resolveTree`
(`packages/shared/src/resolve-tree.ts`), over the same nodes, and draws the same tree:

1. a parent that is missing or is a file resolves to the root;
2. a cycle is broken by moving its oldest `(createdAt, id)` member to the root;
3. a node is hidden when it or an ancestor is tombstoned;
4. visible siblings with the same exact name keep it in `(createdAt, id)` order and the rest show
   as `name (2).ext`, skipping any suffix a sibling really has;
5. folders sort first, then names by a fixed code-point comparison, never the browser's locale.

The output also records, for every hidden node, which tombstone hid it and who made it, which is
what the "Deleted by …" banner and Recently deleted use. Display names are what paths, Monaco URIs
and (in Phase 3) the WebContainer see. A seeded test has two replicas make random offline edits,
exchange them, and requires identical output. See `docs/decisions/004-stable-ids-and-read-time-resolution.md`.

When a cycle appears, both people get a toast naming the folders, because one of them sees their
move "turned around".

### Deleting, restoring, and deleting forever

Delete is a tombstone: the node and its content stay, and an Undo toast restores it. Recently
deleted lists the top of each deleted subtree with where it was, who deleted it and when, and
offers Restore, Delete forever and Empty all. The last two go through a confirmation that states
how many items go and that it cannot be undone for anyone.

`purgeDeleted` is the only hard delete. It removes the node maps and content of what **this
client** sees as deleted, and nothing else, so a file someone creates inside a purged folder at
the same moment survives and shows at the root. If a restore and a purge of the same item race,
the purge wins everywhere: the restore writes into a `Y.Map` that the purge deleted, and Yjs
discards changes to deleted types. Both outcomes are pinned by tests.

### The editor: tabs, models, bindings and undo

Tabs are local to each browser tab and hold node IDs, so they follow a file through renames and
moves. `features/editor/model-registry.ts` keeps, for every open tab, a Monaco model and a
y-monaco binding; switching tabs is `editor.setModel`. Keeping every open tab bound, not only the
active one, matters: an unbound model falls behind remote edits, and rebinding it calls
`setValue`, which wipes its undo stack and moves the cursor. y-monaco supports several bindings on
one editor because each handler checks `editor.getModel() === model`; the same check is why remote
cursors only ever draw in the file they belong to.

- **URIs** are `URI.file('/' + path)`, which percent-encodes `#`, `?`, `%`, spaces and
  parentheses, so the TypeScript worker can resolve imports between open files. A URI cannot
  change, so a new resolved path (rename, move, parent rename, a duplicate gaining `(2)`) means a
  new model, with view state and focus carried across. A deleted file moves to a
  `collabcode-deleted:` URI keyed by its ID, since a new file may take its old path while it is
  still open; it is read-only, with the deleter's name and Restore.
- **Undo is per person.** y-monaco tags its transactions with the binding itself as the origin,
  so a `Y.UndoManager` per file that tracks only this person's binding undoes their typing and
  never a collaborator's. It lives on the file, so when a rename forces a new binding, the new one
  joins its tracked origins and history carries over. Every Monaco undo path (keybindings, menus,
  `editor.trigger`, the suggest and paste widgets) ends in `model.undo()`, and each model routes
  that to the file's manager (`route-history.ts`); the command palette gets Undo and Redo backed
  by the same manager. Monaco's own stack is never used: it would undo collaborators' edits, and
  since remote edits arrive through `applyEdits` without being recorded there, replaying it after
  remote changes would apply old edits at shifted offsets.
- **Cursors on tab switch.** Monaco fires no cursor event on `setModel`, so the registry
  publishes the new selection itself, in y-monaco's awareness format. Otherwise collaborators
  would keep seeing your caret in the file you left.
- **Follow.** Clicking a collaborator's avatar opens the file they are in and scrolls to their
  cursor.

### Keeping React off the keystroke path

The tree store observes only `nodes`. Keystrokes change `contents`, so typing never re-resolves the
tree or re-renders it; a rename or move does, synchronously, so the tree, the tabs and the models
see one snapshot. Presence dots use a map that keeps its identity while only cursors move.

### Running the project

```
┌─────────────────────────── one person's browser tab ───────────────────────────┐
│                                                                                │
│  Y.Doc (nodes, contents), shared with everyone                                 │
│     │  FS bridge, one way: after 250 ms of quiet, at most 1 s                  │
│     ▼  mkdir · writeFile · rm (only what it wrote)                             │
│  ┌──────────── WebContainer: StackBlitz iframe and workers ─────────────┐      │
│  │  project files, plus node_modules and a lockfile that stay local     │      │
│  │  npm install → npm run dev (node --watch)   jsh   node -e <helper>   │      │
│  └───┬────────────────┬───────────────┬──────────────────┬──────────────┘      │
│      │ output         │ port events   │ one base64 line  │ preview URL         │
│      ▼                ▼               ▼ per request      ▼                     │
│   Output, Shell    runner and       API console       Preview: sandboxed       │
│   (xterm)          run state        (text only)       iframe, never our origin │
└────────────────────────────────────────────────────────────────────────────────┘
```

Nothing runs until the person clicks Run, and every person's run is their own: a separate
container in their tab, fed from the shared document. ADR 006 covers the choice of WebContainers,
their cost, licence, browser support and sandbox; ADR 005 covers the file sync.

- **Booting.** The first Run boots the page's single WebContainer with `coep: 'require-corp'`,
  matching the page headers. The API client and xterm are loaded then, not with the page. Leaving
  the workspace tears the container down; a boot that finishes after that is discarded.
- **Files.** The FS bridge (`features/runtime/fs-bridge/`) diffs the whole project against what it
  last wrote and applies the difference. It removes only files it wrote and empty folders it
  created, so `node_modules`, the lockfile and whatever the program writes survive deletes and
  renames in the project. Nothing flows back into the document.
- **The run** (`process-runner.ts`, lifecycle in `run-state.ts`). Read `package.json` from the
  document, parsed defensively; run `npm install` only when its dependency sections changed; start
  `dev`, else `start`; follow the server through the container's port events. A port that closes
  is a restart; one that stays closed for 3 s, a dev process that exits, or the watcher printing
  that the program crashed (`watch-signals.ts`) is a crash. That last one is the only sign of a
  program that crashes before it ever listens: under `node --watch` the dev process keeps running
  and no port ever closes. **A crashed
  run restarts itself when the bridge next writes a file**, which covers what `node --watch` cannot:
  after a crash it watches only the files it had loaded, so a restored file would otherwise go
  unnoticed. Every run has a generation; output and exits from a replaced process are dropped, so
  Restart never reads the old process's exit as a crash.
- **Node 22.** The container runs Node 22 (22.22 at the time of writing), not the repository's 24.
  Template `package.json` files declare `engines: { node: ">=22" }`, and CI runs the request
  helper's integration test on Node 22 too.

### Cross-origin isolation

WebContainers need `SharedArrayBuffer`, so every response is served with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
(`apps/web/src/lib/isolation-headers.ts`, used by the Vite dev and preview servers and checked
against `vercel.json` by a test). What that changes:

- Monaco and its workers are same-origin and carry the headers; the e2e suite runs isolated and
  checks that the workers really run rather than falling back to the main thread.
- The Hocuspocus WebSocket is unaffected, and the REST calls to Render are `cors`-mode fetches,
  which COEP does not block. The app loads no third-party fonts, scripts or images.
- Our page cannot talk to windows it opens on other origins. Future sign-in popups must redirect.
- A page without isolation gets a disabled Run button and the reason, which decides the fix: not
  HTTPS or localhost, inside another site's frame, a browser without the feature, or a page loaded
  without the headers (`runtime-support.ts`). Every boot checks first (`webcontainer.ts`), so
  nothing boots into a `SharedArrayBuffer` error, and the third-party cookie hint is kept for a
  boot that fails on an isolated page. Editing works either way.

`require-corp`, not `credentialless`: we have no cross-origin `no-cors` resources for it to help
with, and Safari does not implement `credentialless` at all.

### The API console, the shell and the preview

- **API console.** Each request starts a helper with `node -e` inside the container
  (`packages/agent/src/runtime/request-script.ts`, shared with the agent and the evals), which calls `http://localhost:<port>`, so CORS never applies.
  It reads at most 2 MB of the body, never follows redirects and gives up after 30 s. The answer is
  read **only from the helper's own process output**, never the server's, as one line: a
  per-request random nonce, then the whole response (status, headers, body bytes, timing) as
  base64 JSON. Base64 cannot contain a line break or a marker, the nonce cannot be guessed, a
  second line with the right prefix is treated as tampering, and the decoded JSON is validated
  before use. Bodies arrive byte for byte; they are shown as pretty JSON, text or a hex preview,
  never as HTML. Send waits out a restart for up to 10 s. The helper script contains no backslash,
  `$`, backtick or double quote, because WebContainer's `spawn` was found to process escapes inside
  arguments.
- **Shell.** `jsh` in the same container, with its own output buffer so switching tabs keeps the
  session.
- **Preview.** An iframe with `sandbox="allow-scripts allow-same-origin allow-forms"` on the
  server's preview URL, which is a StackBlitz origin, never ours. `allow-same-origin` is needed
  because previews are served by a service worker on that origin. Verified in Chromium: scripts
  and forms work, top navigation throws, `window.open` is blocked, and without `allow-same-origin`
  nothing loads. The pane says plainly that it is running project code.

### The AI helpers

```
┌──────────────────────────── one person's browser tab ────────────────────────────┐
│  editor context menu                   Run view, when a run crashed or failed    │
│  Explain with AI · Edit with AI…       Explain with AI                           │
│     │ selection + context lines           │ plain-text output tail + the file    │
│     ▼ (anchored with relative positions)  ▼                                      │
│  useAiRequest: privacy notice first; own key read from sessionStorage at send    │
│     │ ai-client: fetch POST, reads data: lines, zod-validates every event        │
└─────┼────────────────────────────────────────────────────────────────────────────┘
      │ body { projectId, promptId, inputs, byok? }   header x-ai-key (own key only)
      ▼
  POST /api/ai/step  (apps/server)
    Origin required → per-visitor minute limit → zod → project exists
    → shared tier: minute limit for everyone, then daily limits │ or the caller's own key
    → server-owned prompt → ModelGateway (Vercel AI SDK) → Gemini, Anthropic or OpenAI
    → text-delta … finish | error          one metadata-only log line per call
```

**The model is the brain, the browser is the hands** (ADR 007). The server places each model
call and keeps nothing between calls; everything the helpers act on, the document, the editor and
the running project, is in the browser.

- **The request** names a server-owned prompt (`packages/shared/src/ai/prompts/`:
  `explain-selection`, `edit-selection`, `explain-error`) and carries its inputs. There is no
  field for a system prompt, so the shared key is not a general-purpose relay. Every prompt has an
  id, a version and a zod schema that caps each field; the browser trims context to the same caps
  and validates with the same schema, so it refuses with the server's wording. A fingerprint test
  fails CI when a prompt changes without a version bump.
- **The stream** is our own protocol: one `data: <json>` line per event, `text-delta`s then one
  `finish` (reason, token usage, `id@version`, model, what is left of today's free requests) or
  one `error`. The status is committed on the model's first event, so a refused key or an
  exhausted allowance is a plain HTTP error. A disconnect aborts the model call, and a call gives
  up after 90 s, logged as a warning with whether the provider had started answering. The browser
  reads it with `fetch`, not `EventSource`, and handles an answer that arrives in one piece, which
  is what a buffering proxy delivers.
- **Paying for it.** The shared tier uses the server's Gemini key: 400 requests a day for everyone,
  30 per visitor, 60 per project, and 12 in any rolling minute for everyone together, counted in
  memory. Days follow Pacific time, when Google resets. The minute limit is checked before the
  daily ones and recorded only once they accept, so neither a busy minute nor a visitor who is out
  of requests costs anyone else. A request Google refuses for rate or quota reasons before
  answering is refunded. With their own key (Gemini, Anthropic or OpenAI, from a short model
  allowlist) a person skips the shared limits but not the per-visitor minute limit.
- **The panel.** The right-hand pane stacks the AI panel above the Run views, both visible and
  resizable, since the agent's work is mostly running the project and reading its output. The AI
  panel holds the AI teammate, then the helpers' answer. The first request waits behind a one-time, versioned
  privacy notice. A request is a pure reducer (`ai-request-state.ts`), where each request has an
  id, so a late event from one that was stopped or replaced is dropped. Answers are rendered as
  paragraphs, inline code and code blocks built as React elements, never as HTML.
- **Explain and Edit** start from the editor's context menu or command palette. Explain sends the
  selection with up to 30 whole lines on each side. Edit anchors the selection with Yjs relative
  positions when it is chosen, asks for an instruction, and shows the answer as a read-only Monaco
  diff over the editor once it is complete. **Apply** goes through the file's Monaco model
  (`model-registry.ts` `applyEdit`), so y-monaco writes it with the person's binding as origin and
  their undo manager records it as one step of its own. Apply refuses if the anchored text changed
  since it was chosen (a collaborator's edit is never overwritten) or if the file would pass its
  size limit.
- **Explain this error** appears in the Run view when a run crashed or failed. It sends the end of
  the output as the plain text a person saw (`packages/agent/src/runtime/terminal-text.ts`) and the file the latest stack
  trace points at, found by the longest ending of the container path that is a project file.
  CommonJS line numbers are exact, so the lines around the crash are sent. WebContainer shifts
  ES-module line numbers by an amount that depends on the module, so an ES module (a `file://`
  frame) is sent whole, without a crash line, and the prompt says to trust the code's own
  numbering.
- **A Monaco diff editor in the standalone build.** Every standalone editor points a global hover
  factory at its own services when created, and a diff editor's inner editors' services die with
  it. After one closes, every context menu would throw and never open, so the diff view points the
  factory back at Monaco's global services by creating and dropping a top-level editor. An
  end-to-end test pins it.

### The AI teammate

```
┌──────────────────────────────── the person's browser tab ──────────────────────────────────┐
│ AgentPanel ── useAgentSession ── agent-session.ts                                          │
│                                     │                                                      │
│      packages/agent: runAgent (loop, limits, retries, trace) ─────── fetch ─► /api/ai/step │
│                                     │ tool calls                     agent@3, 13 tools     │
│                 ┌───────────────────┴──────────────────┐                                   │
│   doc tools (packages/agent)              runtime tools (settle barrier first)             │
│   over the agent's own Y.Doc              the person's runner, output, API console helper  │
│                 │                                      │                                   │
│   agent Y.Doc + its own provider ──WebSocket──┐        │ reads the person's Y.Doc          │
│   (own client id, awareness: avatar,          │        ▼                                   │
│    status, caret)                             │   WebContainer                             │
└───────────────────────────────────────────────┼────────────────────────────────────────────┘
                                                ▼
                     Hocuspocus: one more connection; everyone, the person included,
                     receives the agent's edits as remote edits
```

ADR 008 has the reasoning. The pieces:

- **A peer of its own** (`features/agent/agent-peer.ts`). A second `Y.Doc` in the person's tab with
  its own `HocuspocusProvider` and WebSocket, so it has its own client id and awareness state. The
  server has no special case for it. Its awareness (`agent-presence.ts`) says it is an agent, whom
  it works for and what it is doing, from fixed phrases such as "Editing routes/users.js", and
  carries a caret in y-monaco's own `selection` format, so every editor draws it. Presence shows a
  robot avatar, "working for" the host by the name the host shows, and a dashed caret.
- **The core** (`packages/agent`), environment-agnostic: its build config has no DOM or Node types.
  `runAgent` asks the model for a step, carries out its tool calls, and repeats until `finish`, a
  limit, a failure or Stop; every ending is an outcome, never an exception. Limits: 15 steps on the
  shared tier and 25 with an own key, 5 minutes, input tokens, 8 calls per step, and a conversation
  of at most 120,000 characters, kept there by removing the oldest tool outputs (never the model's
  own messages). A model busy before answering is retried twice (about 5 s, then 15 s, jittered);
  a per-minute limit is waited out; the panel counts the wait down. Unknown tools and invalid input
  go back to the model as errors; three answers in a row with nothing runnable, or two without a
  tool call, end the session. Tool output is capped with a marker, and output with an ES-module
  stack frame carries the note that its line numbers are wrong.
- **The prompt** (`agent@3`, `packages/shared/src/ai/prompts/agent.ts`) keeps the agent to the
  smallest change the goal needs (no tests, dependencies, files or refactors unless asked; nothing
  unrelated touched), edit first, then check with `run_project` and `http_request`, then `finish`.
  Its inputs are the goal, the file list, every file's content for a project under 24,000
  characters, and `sandbox: 'unavailable'` when the page cannot run code; that input can only take
  the sandbox away.
- **Reminders** (`agent-reminders.ts`): after the conversation, the server adds fixed words on a
  step that needs them: on each of the last 3 steps, to call `finish` with a summary, and, when a
  tool call has just failed exactly as an earlier one did, not to repeat it. Nothing from the
  conversation is quoted. The server counts steps left from the conversation and the tier's cap;
  after tool results the reminder is a user turn of its own, after a nudge it joins the nudge. The
  core runs the same function to record each step's reminder in the trace.
- **File tools** (`packages/agent/src/doc-tools/`), over the agent's own replica: list, read (real
  line numbers, long files in parts), search, edit (one exact match), create (with missing
  folders), rename or move, and delete (soft only). Paths are display paths looked up among the
  tree's own nodes. Every write goes through the shared ops with `agentOrigin(sessionId)` and is
  recorded for undo. Edits are typed in live over about a second (`typist.ts`), each piece
  anchored just after the last with a relative position; a hidden tab, or a very long insertion,
  types at once, and Stop finishes an edit at once.
- **The presence rule** (`presence-rule.ts`): a file that anyone but the host and the agent itself
  has open and edited in the last 30 seconds is refused, and the refusal names no one. People
  publish a throttled `lastEditAt` when they type; the agent reads it on its own clock
  (`awareness-presence.ts`), so a peer whose clock is off cannot make a file look busy or quiet.
- **Runtime tools** (`features/agent/runtime-tools.ts`): run, stop, read the terminal, call the API
  and run `node` or `npm`, with the Run view's own runner, output and API console helper, so the
  person watches them happen. The model reads the output as plain text without npm's spinner.
  A sandbox that cannot start (the page is not isolated, or the boot fails) stays unavailable for
  the rest of the session: `run_project`, `run_command` and `http_request` then give one fixed
  answer at once, saying why and to finish and tell the person to click Run. When isolation is
  missing at the start, the tools begin that way and nothing tries to boot.
- **The settle barrier.** The container is fed from the person's document, which receives the
  agent's edits through the server. Before anything runs, the person's document must have them
  (compared by state vector, `doc-sync.ts`), then the runner writes them to the container and
  waits out the watcher's restart (`process-runner.ts` `settle`). Edits that do not arrive within
  10 s, or writes that do not finish, give the model "sync is delayed" and the person a notice.
- **The model** (`http-model-client.ts`): one step per request. The session's key choice is fixed
  at the start; the key travels only in its header. On the shared tier, steps after the first name
  the model the first used (`sharedModel`), since its thought signatures are in the conversation.
- **Undo AI changes** (`packages/shared/src/agent-undo.ts`): the agent's text edits through an
  UndoManager tracking only its origin, and its tree actions reversed with soft ops. The panel
  first says which files someone else has changed since. It lasts until **Done** or a reload.
- **Follow mode** (`useFollowAgent.ts`): the host's editor opens the agent's file and keeps its
  caret in view, until the host types or opens another file; **Follow AI** resumes. When the agent
  deletes the file being followed, follow mode goes back to the file shown before, closes the tab
  if it had opened it, and keeps following.
- **The trace** (`packages/agent/src/trace.ts`, format version 3): each model answer verbatim, every
  call and result, waits and attempt times, the raw finish reason, each step's reminder, the inputs
  (the sandbox one included), the template and a fingerprint of the starting files. **Download
  trace** saves it; `scriptFromTrace` replays it with no model; versions 1 and 2 are still read.
  `sessionChanges` works out from it what the session changed, which the panel lists when a session
  ends without `finish`. Recorded sessions kept as regressions are in
  `packages/agent/fixtures/traces`.

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

| Route                   | Behaviour                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`           | `{ ok, uptimeSeconds }`. Never touches the database, so it answers the moment the process is up. The landing page pings it on load to start a cold start early.                                                                 |
| `POST /api/projects`    | Validates `{ name?, template }`, builds the initial `Y.Doc` from the template, stores it, returns the summary. Rate limited per IP.                                                                                             |
| `GET /api/projects/:id` | Summary or 404. The workspace calls it before opening a socket, so an unknown ID shows a 404 page instead of a refused connection.                                                                                              |
| `POST /api/ai/step`     | One model call for a server-owned prompt, streamed back (see "The AI helpers"); an agent step also carries the conversation. Requires an `Origin`; limited per visitor per minute, and on the shared tier by the shared limits. |
| anything else           | 404 in our error shape, never Hocuspocus's default response.                                                                                                                                                                    |

### Trust boundaries

Every boundary is validated, and the awkward one is presence.

- **Remote awareness states are untrusted input.** They are written by other browsers and
  relayed without inspection. `parseAwarenessState` parses each one and drops anything
  malformed; colours must be members of a fixed palette; names are stripped of control,
  zero-width and bidi characters and capped; unknown keys are ignored rather than rejected, so a
  peer on a newer client still appears.
- **A peer's cursor position is parsed before it touches the document.** Following someone reads
  y-monaco's `selection` from their awareness state. Positions must name an item or a type, and a
  `tname` is refused outright: resolving one makes Yjs call `doc.get(tname)`, which would let a
  peer create root types in your document.
- **Nothing from a peer is interpolated into CSS or HTML.** Remote cursor rules are generated
  per client id (checked with `Number.isSafeInteger`), and names pass through `escapeCssString`
  before entering a CSS string. There are unit tests for hostile names and colours.
- **localStorage is untrusted too.** The stored guest identity is parsed with the same schema
  and replaced if it does not match.
- **HTTP:** zod on every body and param; a CORS allowlist with no wildcard; an origin guard that
  refuses a request from an unlisted `Origin` with 403 before any route runs. A request with no
  `Origin` is not a browser request and is left alone.
- **Client addresses for per-IP limits.** On Render a request passes through Cloudflare and then
  Render's load balancers, so the socket address is a proxy's, and the length of the
  `X-Forwarded-For` chain depends on what the client sent. Render sets the first entry to the
  real client, so the limiters key on that (`http/client-ip.ts`, `CLIENT_IP_SOURCE=render`),
  with IPv6 grouped by /56; `direct` ignores the header entirely. Express's `trust proxy` is left
  unset, so `req.ip` is never used for limits.
- **Code a collaborator wrote runs only in the browser of whoever clicks Run**, inside
  StackBlitz's cross-origin sandbox: it cannot read our page, the document, storage or identity.
  It can use that person's CPU, make HTTP requests from their browser within CORS rules, run
  npm install scripts inside the sandbox, and show anything in the preview. ADR 006 has the full
  list of what the sandbox does and does not protect.
- **Everything the running program produces is displayed as text.** Terminal output goes through
  xterm with no link handling; API responses are text, JSON or hex, never HTML; the container's
  `xdg-open` and `code` events are ignored.
- **API console responses cannot be faked** by the server's logs or bodies (see above), and a
  collaborator-written `package.json` is parsed defensively before its scripts are chosen.
- **AI keys.** The server's Gemini key never reaches a browser. A person's own key lives in
  their tab's `sessionStorage`, travels only in the `x-ai-key` header (never a body), is used for
  one provider instance and is never stored or logged: request logs keep an allowlist of fields
  and no headers, pino redacts key-like headers as a second layer, provider errors are reduced to
  a failure kind and status before logging, and a canary test fails if a known key or prompt
  appears in any log line. People only see messages we write, never a provider's own text, which
  can echo part of a key.
- **The AI teammate.** Everything it reads (files, names, terminal output, HTTP responses) may
  have been written by anyone in the project, so the prompt treats it as data, and what matters is
  enforced in the ToolHost whatever the model says: the presence rule, soft deletes only, paths
  looked up in the tree, the file-size limit, `node` and `npm` only, localhost only, timeouts and
  caps. Its worst case is an edit everyone can see and undo, or code run in the person's own
  sandbox, which already runs collaborators' code. Its awareness claims (being an agent, working for
  someone) only decide how it is drawn; the host is named by what the host shows. The conversation
  a client sends is validated like any input, and the tools come from the prompt, never the request.
- **AI requests.** `/api/ai/step` refuses requests with no `Origin`. That stops casual scripts,
  not determined ones, so the limits are what protect the free quota. Prompt inputs are capped
  by schema, and the prompts tell the model that code, output and file paths are data, never
  instructions. Model output is rendered only as text.
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
- **Runs are per person.** There is no shared run, and a run's container (with its
  `node_modules`) does not survive a page reload; the next Run boots and installs again.
- **Nothing the program writes is saved**, including the lockfile `npm install` produces. Opt-in
  lockfile sync is future work (ADR 005).
- **Running depends on StackBlitz** being reachable; editing and collaboration never do.
- **The Monaco bundle is not split.** Measured in Phase 3: a lean import saved 0.6%, so it was not
  kept (PLAN.md §11).
- **Every file lives in one `Y.Doc`.** Fine up to a few hundred small files, which the node
  limits keep us under. The next step, one subdocument per file loaded when opened, is recorded
  in ADR 004 and not built.
- **Tabs are not remembered across a reload**, and closing a tab discards that file's undo
  history, as in most editors. Pane sizes and expanded folders are remembered per browser.
- **A stored cycle stays in the data** until someone moves one of its folders again. Everyone
  reads through `resolveTree`, so nobody sees it.
- **AI limits are counted in memory**, like documents per process: a restart resets them, and a
  second instance would need a shared store.
- **AI answers are per person and not kept.** One request at a time, no follow-up questions, and
  nothing is shared with collaborators except edits someone applies.
- **The AI teammate leaves busy files alone** rather than proposing a change there; proposals are
  AI-3. One session per tab, and its undo lasts only while it is in the room (until Done or a
  reload). Traces are kept only by downloading one.
- **Streaming through Render's proxy is unverified** until deployment (README launch checklist).
  If a proxy buffers the stream, the answer appears all at once rather than breaking.
- **y-monaco 0.1.6 leaks one cursor listener per binding it creates**, because `destroy()` does
  not remove it. The leftover listeners do nothing (they check the model first) and the count grows
  only with tabs opened and files renamed, not tab switches. Vendoring the binding would fix it;
  deferred as an optimisation.

### How it is verified

| Layer                                        | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (`packages/shared`, `apps/web`)         | Document schema and ops; every `resolveTree` rule, combinations, input-order independence and a seeded two-replica convergence run; tree ops, limits, restore and purge including their races; tree rows and keyboard, tabs, model URIs and plans, remote cursor parsing; awareness hardening, CSS escaping, the connection state machine, the file-size guard, identity storage, language mapping, config parsing                                                                                                                                                                                                                                                                                                                               |
| Integration (`apps/server`)                  | The real Hocuspocus + Express composition against an in-memory repo: convergence, late joiners, offline merge, refusal of unknown and malformed IDs, the store beating document unload, restart survival, the Express mount, CORS preflight and rejection, rate limiting                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Postgres (`apps/server`)                     | The SQL, the `bytea` round trip and the migration runner against a real Postgres. Skipped unless `TEST_DATABASE_URL` is set; CI provides one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Runtime (`apps/web`, Node)                   | The FS bridge against a real Y.Doc and a fake file system (renames, folder renames, deletes, restores, purges, npm-written files left alone, coalescing, retries); the run lifecycle and auto-restart against a fake container (install skipping, Restart, Stop mid-install, crashes, stale output, waiting for the server); the API console codec against forged and binary output; the request helper under real Node against a real HTTP server, on Node 24 and, in CI, Node 22                                                                                                                                                                                                                                                               |
| End-to-end (`e2e`)                           | Two browser contexts against the production bundle: concurrent typing, late join, offline merge, named cursors, persistence, 404, redirect; and Phase 2's definition of done: presence in the tree, rename while typing, delete and restore, delete forever while open, duplicate refusal, concurrent duplicate create and cross-move (one window offline), per-person undo from keys and the command palette, undo across a rename, cursor behaviour on tab switch and close, following a collaborator; and Phase 3's: the whole suite runs cross-origin isolated, the headers are on the page and the worker scripts, Monaco's workers really run, and a browser without isolation gets a disabled Run and can still edit                      |
| AI (unit and integration)                    | Prompt inputs, caps and version fingerprints; the stream protocol and the browser's parser against chunked and buffered streams; request state, key storage and consent; selection prompts, anchors against two real Y.Docs (edits elsewhere, inside, at the edges), edit proposals, terminal text, stack locations and error prompts; the route through the real server with a scripted model: statuses, limits and refunds, the shared minute limit, timeouts, disconnects, and a log canary across the success and failure paths                                                                                                                                                                                                              |
| AI end-to-end (`e2e/ai.spec.ts`)             | Against a scripted model in the e2e server: the privacy notice, Explain streaming, Edit applied for both people and undone in one step, a stale edit refused, Stop, a refused own key, and the context menu still opening after a diff closes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AI teammate (unit and integration)           | The core with a scripted model and a fake clock: the loop, every limit, Stop mid-answer and mid-tool, tool errors and crashes, unknown tools, invalid input, cut-off answers, nudges, busy and rate-limit retries, conversation fitting, the trace and its replay; the file tools over a real template project, paths, the presence rule and live typing against a collaborator typing alongside; undo against two replicas (a person's edits inside and after the agent's); the settle barrier and runtime tools against the real runner and a fake container; the server route with its caps, admission, minute share, fallback and pinning; a Gemini thought signature through the real Google provider; the log canary, the console included |
| AI teammate end-to-end (`e2e/agent.spec.ts`) | Against a scripted agent: two windows see its avatar and its live-typed edit, the host follows it, and out of a file it deletes, undo keeps a collaborator's later edit after asking, Stop works part way and lists what it changed, a busy model counts down and recovers, typing pauses following, a downloaded trace never holds the own key, and (`runtime-unsupported.spec.ts`) on a page without isolation every run tool gives the one "sandbox isn't available" answer                                                                                                                                                                                                                                                                   |
| WebContainer end-to-end (opt-in)             | `RUN_WEBCONTAINER_E2E=1`: Run, then the API console against the real server; my edit and a collaborator's reach it; the preview shows it; a crash recovers once fixed; a crash before the server listens shows as crashed; Explain with AI on a crash sends the whole ES module; the container's Node version; a scripted AI teammate adds a route, runs the project and gets 204 from DELETE /users/1. Needs the network, so not in CI                                                                                                                                                                                                                                                                                                          |

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
3 is gone: Postgres snapshots. 5 is gone: projects have a file tree (Phase 2).
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
