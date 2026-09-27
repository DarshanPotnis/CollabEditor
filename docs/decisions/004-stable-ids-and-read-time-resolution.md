# 004: Stable node IDs and deterministic read-time tree resolution

- Status: accepted
- Date: 2026-09-26
- Phase: 2

## Context

Phase 2 turns one file into a tree that several people edit at once. Text already merges through
the CRDT, but tree structure has its own conflicts. Two people can:

- create `utils.js` in the same folder before either has seen the other's file,
- move folder X into Y while the other moves Y into X,
- create a file inside a folder someone else is deleting,
- rename a file someone else is typing in.

Every client has to end up showing the same tree, and nobody's content may be lost.

## Decision

**Identity is a stable ID, never a path.** Each file and folder is a `Y.Map` under a nanoid in
`nodes`, and its content is a `Y.Text` under the same ID in `contents`. Rename writes `name`, move
writes `parentId`, delete writes a `deletedAt` tombstone (plus `deletedBy`), restore clears it.
Because a file's identity survives a rename, someone typing in it keeps their cursor and their
edits. Each field is a separate map key, so a concurrent rename and move of the same node both
apply.

**Anomalies are resolved when reading, not repaired by writing.** `resolveTree(nodes)` in
`packages/shared` is a pure function every client runs over the same data:

1. A parent that is missing or is a file resolves to root.
2. A cycle is broken by moving its oldest `(createdAt, id)` member to root. Each node has one
   parent, so every connected component holds at most one cycle, and breaking them in any order
   gives the same answer.
3. A node is hidden when it or any ancestor, after steps 1–2, is tombstoned.
4. Visible siblings with the same exact name are ordered by `(createdAt, id)`. The first keeps its
   name, and the others show as `name (n).ext` with the lowest `n` no sibling really has.
5. Siblings sort folders first, then by a fixed code-point comparison, never by the browser's
   locale, which differs between machines.

**Prevention comes first.** The tree ops refuse a name a live sibling already has (compared
case-insensitively, so a project cloned onto macOS or Windows cannot collide), refuse to move a
folder into itself, and keep the node count under a limit. Resolution exists only for what a
write cannot see: edits made offline or in flight at the same moment.

## Alternatives

**Repair on write.** The first client to notice a cycle or duplicate fixes the data. Several
clients notice at once, so the fixes race and can themselves conflict. Read-time resolution
needs no coordination and no extra writes.

**Paths as identity** (a map from path to content). Rename becomes delete-plus-create, which
throws away the CRDT history of the text, drops the cursor of anyone editing the file, and turns
a concurrent rename and edit into a lost edit.

**A tree CRDT with move semantics** (Kleppmann et al.'s move operation). Correct and elegant, but
Yjs does not ship one. Building it means an undo/redo log of moves ordered by a Lamport clock,
all to handle a case that a deterministic read-time rule already handles well enough.

**Case-insensitive resolution.** Resolution stays case-sensitive because the WebContainer's file
system is. Only the write-time guard is case-insensitive.

## Consequences

- The data can hold states nobody drew, such as a stored cycle. They stay in the data until
  someone moves one of the nodes again. That is harmless, because everyone reads through
  `resolveTree`.
- In a cross-move, one user sees their move "turned around". Both screens agree, and the UI
  explains it with a toast when a cycle appears.
- Display names (`utils (2).js`) are what paths, Monaco URIs and the WebContainer use. A
  display name can change when a sibling is renamed or deleted, so anything keyed by path
  (Monaco models) has to follow the resolved path, not the stored name.
- `createdAt` comes from client clocks. A skewed clock changes _which_ duplicate gets the suffix,
  never whether clients agree.
- Tombstones and their content are kept forever so deletes can be undone. The document only
  grows. A total-node cap bounds it. Purging old tombstones is future work.
- **Scale.** Every file lives in one Y.Doc, which is fine up to a few hundred small files. The
  known next step is one Yjs subdocument per file's content, loaded when opened, with the
  `nodes` map staying in the root document. Not built.
