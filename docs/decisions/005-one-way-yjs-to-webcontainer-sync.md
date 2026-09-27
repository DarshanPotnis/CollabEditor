# 005: One-way sync from the Y.Doc into the WebContainer

- Status: accepted
- Date: 2026-09-26
- Phase: 3

## Context

Phase 3 runs a project's Node backend in a WebContainer inside the browser of whoever clicks Run.
The project lives in the shared Y.Doc; the running server reads real files from the container's
file system. While it runs, collaborators keep editing, renaming and deleting, and the container
itself creates files of its own: `node_modules`, `package-lock.json`, logs, build output.

Every runner has a separate container, so there are as many file systems as people who clicked
Run, and one document.

## Decision

**Files flow one way: from the Y.Doc into the container, never back.**

The FS bridge (`apps/web/src/features/runtime/fs-bridge/`) observes the `nodes` and `contents`
maps. After changes have been quiet for 250 ms, and never more than 1 s after the first unsynced
change, it builds the whole project as it should be on disk (every visible file at its resolved
display path, every visible folder), compares that with what it last wrote, and applies the
difference in order: remove stale files, remove stale folders deepest first, create folders
shallowest first, write new and changed files. Syncs never overlap; a change during one is picked
up by a single follow-up. A rename is a remove plus a write.

**The bridge only removes what it wrote.** A file is removed only if the bridge wrote it; a folder
only if the bridge created it and it is empty. This is what keeps `node_modules`, lockfiles and
anything the program writes alive through deletes and renames in the project.

The first sync is the same diff, from "nothing written yet", rather than a separate `mount` call,
so there is one code path to test.

## Alternatives

**Two-way sync.** Watch the container and write its changes into the Y.Doc. Rejected: every
collaborator's `npm install` would push thousands of `node_modules` files and a machine-specific
lockfile into a shared document that has a node limit, and two runners would fight over build
output. Useful exceptions (a lockfile, generated code) can become explicit, opt-in actions later.

**Per-file debounce and rename detection** (the original plan). Per-file timers and detecting that
a node's path changed save a little work per sync, at the cost of more state that can disagree
with the document. A full diff over a few hundred small files is cheap, and a rename rewrites one
small file. `fs.rename` exists in the WebContainer API and can be adopted if measurements say so.

**`mount` on every change.** Rewrites everything each time and restarts watchers needlessly.

## Consequences

- A runner's container can be "ahead" of the document (it has `node_modules`) but never disagrees
  with it about a project file for longer than one sync.
- Collaborators' edits restart the runner's server through `node --watch`, including half-typed,
  syntactically invalid states. The runner sees the crash in their terminal, and the run is
  restarted automatically when the next file arrives (Phase 3 run state).
- Nothing written by the program is saved. A lockfile produced by `npm install` stays local to
  the runner. Saving it is future, opt-in work.
- Each sync reads every file's content from the Y.Doc. Fine at our node limit; tracking dirty
  files is the optimisation if it ever shows up in a profile.
