# 008: The AI agent as a separate CRDT peer

- Status: accepted
- Date: 2026-09-28
- Phase: AI-2

## Context

AI-2 adds an AI teammate: given a goal, it reads the project, edits files, runs the project in the
person's WebContainer, calls its API and fixes what fails (docs/PLAN-AI.md §7). ADR 007 already
fixed the shape of model access: the server places each model call and keeps nothing between
calls; everything the agent acts on lives in the browser.

What this ADR decides is how the agent acts in a room that other people are editing at the same
time. The constraints:

- **Visible.** Collaborators must see who is editing: the agent needs its own avatar, status and
  caret, and its edits must look like someone else's edits, never like the person's own.
- **Reversible.** One click must undo everything the agent did and nothing anyone else did,
  including edits a person made inside the agent's text while it worked.
- **Bounded.** Steps, time, tokens and the shared free tier (400 requests a day, 30 per visitor,
  12 a minute) all need limits, and the server stays stateless per step.
- **Portable.** AI-4's evals run the same agent in Node, with no browser.
- **No new write-path exception.** CLAUDE.md allows exactly one: y-monaco.

## Decision

**The agent is its own CRDT peer.** It gets a second `Y.Doc` in the person's tab with its own
`HocuspocusProvider` and WebSocket (`apps/web/src/features/agent/agent-peer.ts`). It therefore has
its own Yjs client id and awareness state, and its edits reach everyone, the person who started it
included, as remote edits. The sync layer has no special case: the server sees one more connection
(an integration test pins this).

Hocuspocus 4.7 could multiplex both providers on one socket (`sessionAwareness: true`), but both
providers would have to opt in (the server falls back to the plain document name, so mixing the two
modes misroutes messages), which means rewriting the person's own provider and its tested
connection states; and one socket failing (a closed connection, an oversized frame) would take down
both. A second idle WebSocket per running session costs nothing that matters.

**Every agent write goes through `packages/shared`**, tagged with `agentOrigin(sessionId)`:
`text-ops.ts` for content (replace one exact match with the smallest change; insert and delete for
live typing; each re-checks the per-file limit, which the editor would otherwise enforce) and the
tree ops, which take an origin. The agent never writes into a `Y.Text` directly, so the one
exception stays y-monaco.

**Undo AI changes** (`packages/shared/src/agent-undo.ts`) is a `Y.UndoManager` that tracks only the
session's origin, scoped to the texts the agent edited, plus a log of its tree actions reversed
newest first with soft ops: a file it created is soft-deleted (a person's edits inside it survive in
Recently deleted), a rename goes back only if nobody renamed it since, and a deleted file is
restored unless its folder was deleted by someone else. Before undoing, the panel says which files
someone else has changed since and asks. The undo writes through the agent's connection, so it is
available until the person dismisses the agent (Done) or reloads.

**The core is environment-agnostic** (`packages/agent`). The loop talks only to a `ModelClient`, a
`ToolHost`, a `Clock` and a `StopSignal`; its build config has no DOM or Node types, so the
compiler rejects anything else. The file tools, the presence rule, typing, limits, retries, output
shaping and the trace are all there, so AI-4's Node harness reuses them and supplies only its own
runtime tools and model client.

**A settle barrier guards everything that runs code.** The WebContainer is fed from the person's
document (ADR 005), and the agent's edits reach that document through the server. Before
`run_project`, `http_request` or `run_command`, the person's document must have the agent's edits
(compared by state vector), then the runner writes them to the container at once and waits out the
watcher's restart. Every wait is bounded: edits that do not arrive, or writes that do not finish,
give the model "sync is delayed" and the person a notice.

**The presence rule lives in the ToolHost**, not only in the prompt: a file that any peer other
than the host and the agent itself has open and edited in the last 30 seconds is refused. Edit
times are taken on the reading browser's clock (a peer's clock can be off), a peer's claim to be an
agent earns nothing, and the refusal names no one, since a name is text a stranger chose.

**The prompt and the tools are the server's** (`agent@2`, `packages/shared/src/ai/prompts/agent.ts`).
A request names the prompt and carries its inputs (the goal, the file list and, for a project under
24,000 characters, every file's content) and the conversation so far; there is no field for tools
or a system prompt. The conversation is validated like any input: plain JSON, capped at 120,000
characters the model reads, and ordered like a real exchange. The model's messages come back from
`finish` and go back to the provider unchanged, `providerOptions` included, which is where Gemini 3
carries its thought signatures (confirmed live, and pinned by a test through the real Google
provider). Every answer must call a tool; one that does not gets a fixed nudge.

**Sessions fit the free tier by counting steps**, since requests are what Google counts:

- at most 15 steps on the shared tier, 25 with one's own key, counted from the conversation;
- a shared-tier session starts only when the visitor and the project have 15 requests left today
  and everyone together has 15 plus a reserve of 40 for the one-shot helpers;
- agent steps may take 6 of the tier's 12 a minute (`AI_AGENT_REQUESTS_PER_MINUTE`);
- a model busy before answering (503) is the `busy` error, refunded, and retried twice by the core
  (about 5 s, then 15 s, jittered) within the session's 5 minutes; a failure after the model began
  answering is never retried;
- `AI_FALLBACK_MODEL`, when set, answers a busy default for helpers and an agent session's first
  step only; later steps name the model their session started on, since the conversation carries its
  signatures.

**People watch the agent work.** Edits are typed in live over about a second, anchored with
relative positions so a collaborator typing next to them is never split or moved; Stop finishes an
edit at once. The person who started the agent follows it into its files until they type or open
another file themselves.

**Every session leaves a trace**: a versioned JSON file with each model answer verbatim, every
tool call and result, waits, timings, the template and a fingerprint of the starting files. A
scripted `ModelClient` replays it with no model, which AI-5's demo and AI-4's regressions use. It
never holds a key: the model client keeps that and sends it only in its header.

**A fifth SDK guardrail** joins ADR 007's four: `streamText` gets an `onError` that prints nothing,
because the SDK's default prints every stream error with `console.error`, and an `APICallError`
carries the whole prompt and a provider message that can echo a key. The log canary now watches the
console as well as the logs.

## Alternatives

**The agent edits through the person's own document and connection.** No second socket, but no
avatar or caret of its own, its edits would look like the person's, and undoing them without
undoing the person's typing would need origins threaded through y-monaco. Rejected.

**One socket for both, with Hocuspocus session multiplexing.** See above: it changes the person's
provider and couples the two connections' failures. Rejected for now; it is an optimisation if
sockets ever become scarce.

**One UndoManager over the whole `nodes` map.** Simpler, but undoing a create removes the node
outright, taking a person's edits in that file with it, and breaks "soft delete only". Rejected.

**Writing into `Y.Text` from the ToolHost.** A second write-path exception, and the per-file limit
would have to be enforced in yet another place. Rejected.

**A server-side agent, or a server session per conversation.** It would need state, cleanup and a
second place to run tools, and AI-4's evals must run without our server. Rejected (ADR 007).

**Counting whole sessions against the free tier.** Google meters requests: a session budget either
lets 15 × sessions requests through a 30-request allowance or needs a reservation table on the
server. Rejected.

**A first-chunk timeout per agent step.** On the Gemini API a tool call's arguments are not
streamed, so "nothing yet" cannot tell a queued request from a long `create_file` being written;
cutting at, say, 45 s would fail legitimate edits. The 90 s cap per attempt stays.

## Consequences

- **One more WebSocket per running session**, from the same browser; the server cannot tell an
  agent from a person, and does not need to.
- **Undo lasts as long as the agent is in the room.** Done or a reload ends it; the edits stay, and
  Recently deleted still has what it deleted or created.
- **The agent edits the person's own open files, and leaves busy files alone** by refusing, until
  AI-3 lets it propose a change there instead.
- **The free tier carries about two sessions per visitor a day.** Own keys are the path for regular
  use, and every step resends the conversation, which is what a long session costs.
- **Traces contain project code and output.** They stay in the browser unless the person downloads
  one.
- **Container stack traces stay approximate for ES modules** (ADR 007): tool results say so, and the
  prompt says to find code by its content.
- **Awareness claims are cosmetic.** Anyone can claim to be an agent working for anyone; the badge
  names the host by what the host shows, and nothing is granted by a claim.
