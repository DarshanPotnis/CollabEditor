# 012: agent@4, a finish whose checks are verified, and edits that say where they differ

- Status: accepted
- Date: 2026-09-29
- Phase: AI-4

## Context

The first Flash-Lite baseline (21 tasks, graders@2: 15 of 21) failed mostly on checking, not on
changing:

- **Unverified (3):** sessions checked one or two cases where the goal named four or five. agent@3's
  prompt asked for exactly that: "one request that should succeed and one that should fail".
- **Dishonest (1):** a summary said "Tested with valid and invalid requests returning 201 and 400"
  after one request, answered 400. Nothing but a grader, after the fact, could tell.
- **Ran out (1):** filter-by-role wrote its reasoning into the file as twenty lines of comments,
  then re-read the file five times and sent the same 24-line `oldText` each time, one word short on
  its seventh line. The refusal said only that "the lines after it differ".

## Decision

agent@4 makes three changes at once:

1. **`finish` lists its checks, and the loop verifies them.** `finish` takes `checkedRequests`
   (method, path, status) and `checkedCommands` (command, exit code). The loop, which handles
   `finish` itself, holds each one against the session's calls after its last change
   (`packages/agent/src/finish-checks.ts`). A finish that lists a check not made is refused once,
   naming each and why ("not sent", "it got 404", "sent before your last change"). After that, or
   on the last step, where a refusal would lose the summary, it is accepted with those checks set
   apart. The outcome carries both lists (trace format 4), and the agent panel shows the checks it
   made and, separately, the ones it listed but did not make.
2. **The prompt asks for every behaviour to be checked:** each case the goal names, every error
   case, and one thing that worked before, together in one answer. It also says never to write
   reasoning into the code, and that the summary says what changed and what is left while the
   checks go in finish's lists.
3. **Edit refusals say where the text differs.** When the copy's first line is found, the refusal
   quotes the first line that differs, as the file has it and as the copy has it (a window around
   the difference when the line is long). The same refusal a second time running adds: copy fewer
   lines, only those that change and one either side.

## The three are bundled

An improvement in the next run cannot be attributed to any one of these changes: the check rule,
the verified finish and the edit refusals all act on the same sessions (a session that checks more
also lists more, and a stuck edit uses steps the checks need). Measuring each alone takes a full
Flash-Lite run per change, about 130 requests and a day's noise each, for a difference that one
trial per task could not resolve anyway. With the eval project's quota, those ablations are not
worth it. The comparison measures agent@4 as a whole, against the re-graded agent@3 baseline and a
second agent@3 run on the same day for noise.

## Alternatives

- **Ask for an honest summary in the prompt only.** agent@3's prompt already asked for "how you
  checked it"; the overclaim happened anyway. A list the loop checks makes the claim verifiable.
- **Refuse every finish with an unmade check.** A model that keeps listing it would spend the rest
  of its steps, or run out and lose its summary. Once is enough to let it make the check or drop it.
- **Tell the model to re-read the file after a failed edit.** The refusal already said so, and the
  session did re-read, five times. It could not see which line its copy got wrong.
- **An edit by line numbers instead of text.** A new way to edit is a bigger change for small
  models, and live typing and the presence rule are built around text edits.

## Consequences

- The summary no longer has to say how the work was checked, so `claimed-checks` (which reads the
  summary) will find fewer claims to judge in agent@4 sessions. That is the design: check claims
  move where the loop can verify them. The comparison reports checks listed but not made, and
  refused finishes, beside the verdicts.
- Trace format 4. Older traces are still read, with a finished session's checks null; replays of
  them produce an empty list.
- A model that never lists its checks is not refused: an empty list claims nothing. Whether the
  checks were made is still graded by `verified`.

## Measured (2026-09-29)

Flash-Lite, all 21 tasks, one session each, judged by graders@3
([comparison](../evals/comparisons/2026-09-29-agent-3-vs-agent-4.md)): the agent@3 baseline 15, a
second agent@3 run the same day 18, agent@4 19. Every point of the bar set before the run holds
(unverified at most 1, dishonest 0, filter-by-role finishes, requests per task not up, no new
wrong-result or unsafe), but agent@4's lead over the same-day agent@3 run is one task, well inside
the three tasks between the two agent@3 runs: the pass rate does not show agent@4 is better.

What did change, and is not noise:

- **Checking.** Requests after the last change: 61 across the run, against 41 and 32 for agent@3.
  19 of 21 sessions listed their checks; every check listed in a finish that was accepted had been
  made.
- **A new wasted step.** 9 sessions listed `npm run dev → exit code 0` as a command check: the dev
  server `run_project` starts, not a `run_command`. Each finish was refused once, then accepted
  without it: 9 of agent@4's 18 wasted steps.
- **The edit refusal went untested.** No session copied a block wrong past its first line, so the
  first-differing-line refusal and the shorter-copy hint never fired.
