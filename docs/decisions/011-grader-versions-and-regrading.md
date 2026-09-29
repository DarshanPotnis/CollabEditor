# 011: Graders versions, and grading a run again from its traces

- Status: accepted
- Date: 2026-09-29
- Phase: AI-4

## Context

The first baseline (gemini-3.5-flash-lite, 21 tasks, 120 requests) showed two grader problems. A
pattern failed an honest summary ("Sandbox execution wasn't available in this session, so please
click Run to check it"), and nothing failed a summary that claimed a check it never made ("Tested
with valid and invalid requests returning 201 and 400", after one request answered 400).

Fixing graders changes verdicts, which raises three questions: how to tell which graders judged a
result, how to fix a recorded run without spending quota on it again, and how to keep a
comparison that spreads over six days (Flash allows one session a day) from being judged, or run,
differently from one day to the next.

## Decision

- **A graders version in every result.** `apps/evals/src/graders/version.ts` holds
  `GRADERS_VERSION`, with a line per version saying what changed, and results record it as
  `graders@N` next to the prompt version. A test hashes the files that decide verdicts (graders,
  tasks, fixture projects) and fails on any change until the recorded fingerprint is updated, so a
  bump cannot be forgotten silently.
- **Graders say what they read.** A `TraceGrader` gets only the trace, by type; a `ProjectGrader`
  gets the files and a sandbox running the final project.
- **Grading again from traces.** `npm run evals:regrade -- <run id>` runs today's trace graders on
  the saved traces and keeps the project graders' verdicts from the run. It refuses a task that
  has gained a project grader, since that grader never saw the project. The results record the
  graders that judged them before, the commit that judged them again and every verdict that
  changed.
- **One run, one commit.** `--resume` refuses a commit, model, graders version, tier, task list or
  trial count other than the run's own; in CI the run starts from a tag and each resume starts from
  it too.

## Rule: fixing a grader after seeing results

Graders get fixed after someone has read a run's results, which is exactly when a fix can be bent
toward the answer one hoped for. So a grader fix made after viewing results:

1. **is justified on its own terms.** The grader was wrong about a session, whichever run or agent
   version that session came from, and a test built from that session shows it. "It makes the new
   version look better" is never the reason.
2. **applies to every run.** Every recorded run that is compared is graded again from its traces
   with the fixed graders (`npm run evals:regrade`), not just the run the fix was found in. The
   graders version is bumped, so no run judged by the old graders sits beside one judged by the
   new.
3. **is recorded.** The version's line in `graders/version.ts` says what changed, each run's results
   list the verdicts it flipped, and the comparison reports the result with the fix, stating that
   it was applied.

graders@3 was such a fix: found in the agent@4 comparison, it flipped agent@4's presence-busy-target
and json-404 and the same-day agent@3 run's json-404 alike, and left the baseline unchanged.

## Alternatives

- **Run the baseline again.** It costs a day's requests, and the model would produce different
  sessions: it measures noise as much as the grader change.
- **Replay the traces through the tools to rebuild the final files**, so project graders can judge
  again too. Replays drift (ADR 010): tool behaviour changes and the collaborator's timing differs,
  so the rebuilt project is not the one the model left. Worth it only if a project grader changes.
- **Only a content hash, no version number.** It detects changes but gives readers nothing to
  compare by eye, and cosmetic edits would split comparable runs.
- **No version.** Results graded by different graders would sit side by side in the README.

## Consequences

- A cosmetic edit to a grader or task file needs a fingerprint update (not a bump). The test
  message says what to do.
- A change to a project grader (the hidden checks, scope, file graders) cannot be applied to old
  runs; it needs a new run, and the version bump says the old ones are not comparable.
- `claimed-checks` reads claims by text rules, conservatively: it misses claims made without check
  words and never guesses. Enforcing honest summaries in the agent itself is a separate proposal
  (agent@4), which these graders would measure.
- The first baseline is recorded re-graded: 15 of 21 with graders@2, where graders@1 said 14.
