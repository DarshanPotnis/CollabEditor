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
- React: effects must be StrictMode-safe (create and destroy resources in the same effect).
- Pure logic (tree resolution, path mapping, diffing) gets unit tests in the same change.

## Git

- Work on feature branches off `upgrade`. Never push to or change deploy settings for `main`.
- Small commits with Conventional Commit messages (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- Never commit `.env` files or secrets.

## Docs to keep current

- `docs/ARCHITECTURE.md`: living description of how the system works today.
- `docs/decisions/NNN-title.md`: one short ADR (context, decision, alternatives, consequences)
  per significant decision.

## Commands

Run from the repository root.

| Command                                  | What it does                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `npm install`                            | Installs every workspace                                             |
| `npm run dev`                            | Shared package in watch mode, server on :8080, web on :5173          |
| `npm run dev:server` / `npm run dev:web` | One of them on its own                                               |
| `npm run build`                          | Builds shared, then server (tsup), then web (vite)                   |
| `npm run build:shared`                   | Just the shared package. Lint and typecheck need its output to exist |
| `npm test`                               | Unit + integration (Vitest). Needs no database                       |
| `npm run typecheck`                      | Every workspace, plus the root and e2e configs                       |
| `npm run lint`                           | ESLint, type-aware                                                   |
| `npm run format`                         | Prettier                                                             |
| `npm run e2e`                            | Playwright. Builds the web app and starts an in-memory server itself |
| `npm run migrate -w @collabcode/server`  | Applies SQL migrations to `DATABASE_URL`                             |

Notes:

- `TEST_DATABASE_URL` enables the Postgres-backed specs; without it they skip.
- A machine-global `DATABASE_URL` shadows `apps/server/.env`, because Node's `--env-file` does
  not override variables that are already set. Prefix with `env -u DATABASE_URL` when that
  happens.
