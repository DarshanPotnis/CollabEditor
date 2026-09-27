# 001: A CRDT (Yjs) instead of last-write-wins, and not operational transformation

- Status: accepted
- Date: 2026-09-26
- Phase: 1

## Context

v0 broadcast the entire editor buffer on every keystroke, and each client replaced its whole
document with whatever arrived last. Three consequences, all reproducible:

- Two people typing at once did not merge. One person's message simply overwrote the other's
  text, and neither could tell.
- There was no way for a late joiner to receive the current state, because a full-buffer replace
  carries no information about _what_ changed and the server stored nothing.
- Remote cursors were absolute line/column numbers with no relation to the characters they sat
  beside, so someone typing above you moved your caret.

v0.1 made the server authoritative, which made everyone _consistent_, but consistent about a
document where one person's edit had still erased another's. The merge problem is not a
transport problem.

## Decision

Use Yjs as the single source of truth for project content, synced by Hocuspocus, with
`y-monaco` binding the editor to a `Y.Text`.

The unit of sync becomes the operation ("insert 'a' after this character"), not the buffer.
Operations commute, so every replica that has seen the same set of operations computes the same
document regardless of arrival order, and a replica that has been offline can catch up by
receiving the operations it missed.

Cursors come along for free: Yjs relative positions are anchored to characters rather than to
offsets, so a remote caret stays attached to the text it was sitting in while other people edit
around it.

## Alternatives

**Operational transformation.** OT reaches the same goal and is what Google Docs uses. We did
not choose it because every practical OT deployment needs a central server that transforms each
operation against concurrent ones and hands out a total order. That server is the hard part: the
transformation functions are notoriously difficult to get right for anything richer than plain
text, and the correctness burden lands on us. A CRDT pushes that burden into a library whose
merge is a mathematical property of the data structure, and it lets the server stay a relay plus
a store — which is exactly the shape that survives Render's free tier sleeping.

**Keep last-write-wins, but diff.** Sending a diff instead of the whole buffer shrinks the
messages without changing the semantics: concurrent diffs against different bases still conflict,
and we would be writing a merge algorithm by hand.

**Automerge.** A reasonable CRDT alternative. Yjs won on editor integration (`y-monaco` exists
and is maintained), on the availability of a batteries-included server with persistence hooks
(Hocuspocus), and on document size for text-heavy workloads.

## Consequences

- Concurrent edits at the same position interleave rather than one winning. That is the merge
  working — both intents are preserved — but it means our tests assert convergence and character
  counts, not contiguous runs of typed text.
- The server never needs to understand the document to sync it. It stores opaque bytes.
- Yjs is now a hard dependency of the data model, and the document encoding is our storage
  format. A future migration would be a Yjs-level migration.
- Text merges automatically; _structure_ does not. Concurrent tree edits can still produce
  states nobody intended (two files with one name, a folder cycle). Phase 2 resolves those
  deterministically at read time rather than by writing more data.
- Offline editing works while the tab is open, because the local replica is complete. Surviving
  a reload would need IndexedDB persistence, which is out of scope for phases 0–3.
