# 013: The context engine is deferred until an eval shows retrieval failures

- Status: accepted
- Date: 2026-09-29
- Phase: AI-5 (revised)

## Context

AI-5 was planned as a context engine: a project map (files and their exported symbols) in the
agent's prompt, and ranked retrieval for `search_code`, keyword ranking first and embeddings only if
the evals showed a real gain. The evals now exist (ADR 010), and four Flash-Lite runs of all 21 tasks
have been graded with the same graders (graders@3): the agent@3 baseline, a second agent@3 run, and
agent@4 and agent@5.

Across those runs, every failure was about checking, honesty or scope: `unverified` (checks not
made after the last change), `dishonest` (a summary claiming a check never made), `ran-out` (a
session stuck re-sending a wrong edit), `off-task` and one `wrong-result` (a validation rule not
implemented). None was a failure to find the code that needed changing. The one task built to need
search, `large-rename-field` (a rename across a project too big to send whole), passed in all four
runs. agent@4's changes, which targeted checking, moved the failures that mattered.

## Decision

Defer the context engine. It stays in PLAN-AI.md as deferred, with this reason, and waits until an
eval shows retrieval failures: sessions that fail because the agent could not find or did not read
the code it needed.

## The evidence is weak, and what follows from that

"No retrieval failures" comes from a suite with **one** task that really needs retrieval, run once
per version. It shows that retrieval is not what fails today on these tasks; it does not show that
retrieval is good. A suite that barely tests retrieval cannot report retrieval failures.

So the follow-up is one or two multi-file retrieval tasks: for example, a change whose call sites
are spread over several files of a project too big to send whole, where the agent must search to
find them all. They are **not** added now: the three-session headline runs (agent@3 against the
current agent) need the task set frozen, and a new task changes the graders version and what a full
run measures. They come after those runs, and only then does "wait until an eval shows retrieval
failures" have a test behind it.

## Alternatives

- **Build the project map now.** It costs prompt tokens on every step of every session (the
  shared tier is short of both) for a gain no eval can show yet.
- **Build keyword-ranked `search_code` now.** Cheap, but unmeasurable with one retrieval task;
  better built with the tasks that can judge it.
- **Add the retrieval tasks now.** They would change the task set in the middle of the headline
  comparison.

## Consequences

- AI-5 becomes the trace viewer and "Watch a demo" (PLAN-AI.md), which show the agent's work.
- The prompt's inputs stay as they are: the file list, and every file's content for a small project.
- The retrieval tasks are the next change to the task set, with a graders version bump
  (ADR 011), after the headline runs.
