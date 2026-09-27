# 002: Hocuspocus with whole-document Postgres snapshots

- Status: accepted
- Date: 2026-09-26
- Phase: 1

## Context

Projects have to survive Render's free instance spinning down, a deploy, and every client
leaving. The v0 and v0.1 servers kept rooms in memory and lost everything on restart.

Two things need deciding: what runs the sync protocol, and what we write to disk.

## Decision

**Sync server: `@hocuspocus/server`.** It implements the Yjs sync and awareness protocols,
multiplexes documents over one socket, and exposes the hooks we need — `onLoadDocument` to
authorise and load, `onStoreDocument` (debounced) to save, plus connect/disconnect events for
logging.

**Storage: one row per project, holding the whole document as `bytea`.**

```sql
create table projects (
  id text primary key, name text not null, template text not null,
  ydoc bytea, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`@hocuspocus/extension-database` calls `fetch` once when a document loads and `store` on a
debounce of 2s with a 10s ceiling. `store` writes `Y.encodeStateAsUpdate(doc)` over the previous
value. Access goes through a `ProjectsRepo` interface with a Postgres implementation and an
in-memory one for tests.

This is the brute-force version, chosen on purpose.

## Alternatives

**Append-only updates plus periodic compaction.** Store each update as a row and merge them into
a snapshot occasionally. Cheaper writes, better write amplification, and a natural path to
history. Rejected _for now_: it needs compaction scheduling, a read path that merges N rows, and
a story for partial failure — real complexity to buy a property (write cost) that does not bind
at our scale. A project is a few hundred kilobytes and saves at most every two seconds while
someone is actively typing.

**`@hocuspocus/extension-sqlite` or Redis.** SQLite means a disk, which the Render free tier does
not keep. Redis is another service to run and is not durable by default on free tiers.

**Write on every update.** Rejected: a keystroke would be a database round trip. The debounce is
the point.

## Consequences

- Each save rewrites the whole document. At Phase 2's "a few hundred small files in one Y.Doc"
  that is still small; if a project ever gets large, this is the first thing to change, and the
  `ProjectsRepo` interface is where the change lands.
- No history. We keep the current state, not the sequence that produced it. Checkpoints are a
  later phase and would likely arrive with the append-only model.
- The debounce is a data-loss window: an edit made and then lost to a hard crash within two
  seconds is gone. Graceful shutdown covers the ordinary cases (deploy, spin-down, last client
  leaving), and Hocuspocus flushes a pending store before unloading a document, so closing a tab
  mid-keystroke still saves. A `SIGKILL` would not be covered.
- Only one server instance can serve a project, since the live document lives in that process's
  memory. Horizontal scaling would need the Redis extension.
