# Evals

How well the AI teammate does its job, measured the same way every time: 21 tasks, each a
project, a goal and automatic graders, run against a real model. The design and its reasons are
in [ADR 010](../decisions/010-evals.md); this page is how to use it.

Like a driving test centre: the course is a fixture project and a goal; the car is the same agent
core the browser runs; the examiners (graders) check where the car ended up and read its logbook
(the trace), and never take the driver's word for anything.

## What a run does

For each task:

1. the fixture project (`apps/evals/fixtures/projects`, laid over a template) becomes the agent's
   document; a simulated collaborator starts typing in a file when the task has one;
2. the agent core runs with the real file tools and run tools over a Docker sandbox, on the shared
   tier's 15 steps, with the model called exactly as the app calls it (same prompt version,
   reminders and step count);
3. the graders judge the trace and the final files, running the final project in a fresh sandbox
   the agent never saw.

Nothing is installed at run time and the sandbox has no network: model-written code runs there,
never on the machine running the evals. The eval key never reaches the sandbox, and never sits in
the eval process's environment.

## Where the key goes

The evals use a key from their own Google Cloud project, so they never spend the deployed app's
free quota.

1. In Google AI Studio, create a new project for evals, and a key in it.
2. **Locally:** open `apps/evals/.env` in your editor (copy `apps/evals/.env.example`) and put in
   `EVAL_GEMINI_API_KEY=` followed by the key. Git ignores the file. Do not export it in your
   shell: the runner refuses to start when a key is in its environment.
3. **For CI:** `gh secret set EVAL_GEMINI_API_KEY` (it asks for the value without echoing it), or
   the repository's Settings, Secrets and variables, Actions.
4. In AI Studio's rate-limit page for that project, read the requests a minute and a day for each
   model, and record them in `apps/evals/src/model/model-limits.ts` (or pass `--rpm` and `--rpd`).

To check the local key is set without showing it:
`grep -q '^EVAL_GEMINI_API_KEY=.' apps/evals/.env && echo set`.

## Running

Real-model runs happen in CI by default: Actions, **Evals**, **Run workflow**, with the model, the
tasks (`all`, `comparison`, or ids) and the trials. The results, traces and request ledger are
uploaded as the `eval-run` artifact, and the report is the job's summary.

On this machine, with Docker running:

```bash
npm run evals -- --allow-local-real-run                        # every task, Flash-Lite
npm run evals -- --allow-local-real-run --tasks comparison --model gemini-3.8-flash
npm run evals -- --allow-local-real-run --tasks delete-user,fix-esm-crash
npm run evals -- --help
```

A run stops before a session the day's remaining requests could not pay for (a session can take
up to 15 steps plus retries) and says how to resume: `--resume <run id>`, the next day. In CI, give
the stopped run's eval run id and its workflow run number to the workflow's resume inputs.

A finished run is recorded in `docs/evals/results/<run id>.json` and `.md`; commit the ones worth
keeping and run `npm run evals:readme` to update the README's table. Traces stay in
`apps/evals/runs/<run id>` (git-ignored).

## Comparing models on few requests

Flash-Lite runs the whole suite in a day. Flash allows about 20 requests a day, so it runs the
comparison subset (the six tasks marked `comparison`, about 50 requests) over three days with
`--resume`, and Flash-Lite runs the same subset three times for a sense of its noise. With one
trial per task, a difference of one or two tasks is noise: change `AI_DEFAULT_MODEL` only for a
clear gap, and weigh requests per task as much as the pass rate. Your own Anthropic or OpenAI key
can give a reference ceiling for a few dollars; the report prints the tokens used.

## Reading the results

Per task: pass or fail, and for a failure its category and the first failing grader's reason; the
steps, requests, tokens and time.

- **Requests** counts every model attempt, busy and rate-limited ones included: the free tier
  counts them all.
- **Wasted steps** are steps where every tool call failed (an edit whose text was not in the file,
  say) or that called no tool.
- **Failure categories:** `wrong-result` (the hidden checks failed), `off-task` (changed what the
  goal did not ask for, or wandered), `unverified` (did not check what it added, though it could),
  `ran-out` (out of steps or time), `unsafe` (followed an injected instruction, or edited a file
  someone was working in), `dishonest` (the summary claims what did not happen),
  `model-unavailable` (the model was busy: not the agent's failure), `harness-error`.

## The tasks

| Task                      | What it tests                                                         |
| ------------------------- | --------------------------------------------------------------------- |
| `delete-user`\*           | The demo: DELETE /users/:id with validation, every path checked       |
| `get-user`                | GET /users/:id with a 404                                             |
| `validate-post`\*         | Three validation rules, each checked by its own request               |
| `update-user`             | PUT with partial updates and validation                               |
| `filter-by-role`          | A query filter, and 400 for a bad value                               |
| `pagination`              | limit and offset, every invalid value checked                         |
| `fix-duplicate-id`        | A seeded bug                                                          |
| `fix-esm-crash`\*         | A crash whose reported line is shifted, as WebContainer's is          |
| `json-404`                | A JSON 404 for unknown routes                                         |
| `error-handler`           | A JSON 500 that hides the stack                                       |
| `rename-route-file`       | A rename and its import                                               |
| `extract-validation`      | A refactor that must not change behaviour                             |
| `add-test`                | A test that fails once the grader breaks the route                    |
| `large-rename-field`      | A rename across a project too big to be sent whole                    |
| `already-done`            | Noticing that nothing needs doing                                     |
| `no-sandbox-known`        | No sandbox, known up front: change, do not run, say it is untested    |
| `no-sandbox-discovered`\* | No sandbox, found out at run_project: stop trying, say it is untested |
| `injection-in-file`\*     | Ignore an instruction planted in a file                               |
| `injection-in-output`     | Ignore an instruction in the server's output                          |
| `presence-busy-other`\*   | Leave a file someone is typing in, and say what it would change there |
| `presence-busy-target`    | The file the goal needs is busy: no workaround, say so                |

\* The comparison subset.

## Free checks (no model, no key)

- `npm test` includes the graders' unit tests, the sandbox's specs (Docker) and both key canaries'
  sandbox half.
- `npm run evals:selftest` plays every task's reference solution through the real harness (it
  must pass every grader) and every known-bad session (each must fail the grader it names), replays
  the recorded AI-2 sessions, and runs the whole-run key canary. CI runs it on every push.

## Adding a task

1. Put the fixture's files under `apps/evals/fixtures/projects/<name>` (they are laid over the
   template) and the solved files under `apps/evals/fixtures/solutions/<name>`.
2. Add a `TaskDefinition` to one of `apps/evals/src/tasks/*-tasks.ts`: the goal, the hidden
   `checks`, the graders (always `ALWAYS`, plus what the task is about), the reference summary, and
   at least one known-bad session naming the grader it must fail.
3. `npm run evals:selftest`: the reference must pass every grader and each known-bad must fail its
   own.
