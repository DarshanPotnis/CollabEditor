# CLAUDE.md

## Project

CollabCode (repo: CollabEditor) is a multiplayer code workspace. Several people edit a whole
project together in real time, see each other's cursors, and run a Node.js backend inside the
browser. It is an open-source portfolio project built to startup/production quality at $0
infrastructure cost.

The full engineering plan lives in `docs/PLAN.md`. Read it before doing any work. It is the
source of truth for architecture, data model, phase scope and definitions of done.

## Working agreement

1. **Plan before code.** Before implementing anything non-trivial, explain the approach in
   plain language (use an analogy where it helps), list every file you will create or change,
   describe the data flow, and wait for an explicit "go".
2. **One phase at a time.** Only work on the phase I name. At the end of a phase, stop and give
   me a step-by-step manual test script (two browser windows, what to click, what to expect).
3. **Brute force first, then optimize.** Ship the simplest correct version first and label it
   as such. Propose the optimization separately, with the trade-off.
4. **New focused modules over growing existing files.** Prefer creating a new, well-named file
   to piling logic into an existing one.
5. **Verify library APIs against installed versions.** Hocuspocus, y-monaco, Monaco and
   @webcontainer/api have changed between major versions. Check the installed package's types
   and docs instead of relying on memory. If the plan conflicts with the current API, say so
   and propose the correct approach.
6. **Push back.** If something in `docs/PLAN.md` is wrong, risky or over-engineered, tell me
   before building it.

## Code standards

- TypeScript `strict` everywhere. No `any`, no non-null assertions without a comment saying why.
- Validate every external boundary with zod: env vars, HTTP bodies, params.
- Small, single-purpose functions and modules. No dead code, no commented-out code.
- No silent `catch`. Errors are typed, logged with context, and surfaced to the UI when the
  user needs to know.
- Server logging goes through the pino logger. No `console.log` in committed code.
- All Yjs mutations go through the operation functions in `packages/shared` and run inside
  `doc.transact()` with an origin tag. UI components never mutate Y types directly.
- **The one exception is y-monaco.** `MonacoBinding` writes editor keystrokes straight into the
  bound file's `Y.Text`, bypassing `ops.ts` entirely. That is inherent to the binding, not a
  shortcut, and it has two consequences worth remembering: limits that apply to file content are
  enforced at the editor (`apps/web/src/features/editor/file-size-guard.ts`), not in `ops.ts`;
  and a `Y.Text` change may carry no ops origin tag, so never assume one. Do not add other
  exceptions without an ADR.
- Undo is per person and never uses Monaco's own undo stack, which also holds collaborators'
  edits. Every Monaco model must be created through the model registry
  (`apps/web/src/features/editor/model-registry.ts`), which routes `model.undo()`/`redo()` to the
  file's `Y.UndoManager`. That manager writes to `Y.Text` outside `packages/shared`, but it only
  reverts the binding's own edits, so it falls under the y-monaco exception above, not a new one.
- The AI agent has no editor, so it is not under the y-monaco exception: its content edits go
  through `packages/shared/src/text-ops.ts` and its tree changes through the tree ops, all tagged
  `agentOrigin(sessionId)`, and "Undo AI changes" is `agent-undo.ts`. Keep it that way.
- `packages/agent` must stay runnable in both the browser and Node: its build config has no DOM or
  Node types. Time and stopping come in through its `Clock` and `StopSignal`.
- React: effects must be StrictMode-safe (create and destroy resources in the same effect).
- Pure logic (tree resolution, path mapping, diffing) gets unit tests in the same change.

## Git

- Work on feature branches off `upgrade`. Never push to or change deploy settings for `main`.
- Small commits with Conventional Commit messages (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- Chain checks and the commit with `&&` (for example `npm test && npm run lint && git commit …`),
  never `;`, so a commit can never happen after a failing check.
- Never commit `.env` files or secrets.

## Secrets

- Never print any part of a secret (API keys, tokens, passwords, connection strings) in command
  output, messages, logs or commits: not a prefix, suffix or other fragment, and not a hash.
- To check that a secret is set, print only whether it is (for example
  `grep -q '^GEMINI_API_KEY=.' apps/server/.env && echo set`). When searching output for a leaked
  secret, report found or not found without echoing any of it.

## Docs to keep current

- `docs/ARCHITECTURE.md`: living description of how the system works today.
- `docs/decisions/NNN-title.md`: one short ADR (context, decision, alternatives, consequences)
  per significant decision.

## Commands

Run from the repository root.

| Command                                  | What it does                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm install`                            | Installs every workspace                                                                     |
| `npm run dev`                            | Shared package in watch mode, server on :8080, web on :5173                                  |
| `npm run dev:server` / `npm run dev:web` | One of them on its own                                                                       |
| `npm run build`                          | Builds the packages, then server (tsup), then web (vite)                                     |
| `npm run build:shared`                   | `packages/shared`, `agent`, `model-gateway`. Lint and typecheck need it                      |
| `npm test`                               | Unit + integration (Vitest). Needs no database                                               |
| `npm run typecheck`                      | Every workspace, plus the root and e2e configs                                               |
| `npm run lint`                           | ESLint, type-aware                                                                           |
| `npm run format`                         | Prettier                                                                                     |
| `npm run e2e`                            | Playwright. Builds the web app and starts an in-memory server itself                         |
| `npm run evals:selftest`                 | Eval graders against reference and known-bad sessions, and the replays. Needs Docker, no key |
| `npm run evals -- --help`                | Real-model evals: in CI by default, `--allow-local-real-run` here                            |
| `npm run evals:readme`                   | Rewrites the README's eval table from `docs/evals/results`                                   |
| `npm run migrate -w @collabcode/server`  | Applies SQL migrations to `DATABASE_URL`                                                     |

Notes:

- `TEST_DATABASE_URL` enables the Postgres-backed specs; without it they skip.
- `npm run dev` and `npm run migrate` preload `apps/server/src/load-local-env.ts`, so
  `apps/server/.env` wins over variables already in the environment (Node's `--env-file` never
  overrides them, and a shell profile here exports a `DATABASE_URL` for another project). It
  logs the names of the variables it replaced. `npm start` keeps the environment's values, as
  production should.
