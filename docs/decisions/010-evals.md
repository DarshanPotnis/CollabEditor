# 010: Evals for the AI teammate

- Status: accepted
- Date: 2026-09-29
- Phase: AI-4

## Context

AI-2's agent works, but "works" came from two browser demos. Before improving it (AI-5's context
engine, a stronger default model) it needs measuring: a fixed set of tasks, graded the same way
every time, whose numbers can be compared across prompt versions and models. Four constraints
shape how:

- **The measured agent must be the one people get.** Same core, same prompt version, same tools
  saying the same words, same step limits and reminders.
- **Model-written code must run somewhere safe.** In the browser it runs in a WebContainer. Evals
  run on a machine, and two of the tasks try to make the model misbehave on purpose.
- **The key must stay secret, even from what runs next to it.** It must not be in model-written
  code's reach, in the eval process's environment, in results, traces or logs.
- **Quota is scarce.** Free-tier limits are per Google Cloud project: Flash-Lite allows a full run
  a day, Flash about 20 requests.

## Decision

**The same agent, in Node.** `apps/evals` runs `packages/agent`'s loop with its file tools over a
Y.Doc built from a fixture project. The model is called in-process through the server's own
gateway, moved to `packages/model-gateway`, with the agent prompt, the conversation validated as
the server validates it and the steps left counted by the same `stepsLeftFor`. The run tools say
what the browser's say: the text lives in `packages/agent/src/runtime/`, with the request helper,
`runPlan` and the `node --watch` crash detection, all shared by both.

**Model-written code runs in Docker** (`apps/evals/src/sandbox/`), one container per session:

- `--network none`: loopback only, so the project's own server is reachable from inside (requests
  are sent from inside, with the browser's request helper) and nothing else is;
- the host's own non-root user, `--cap-drop ALL`, `no-new-privileges`;
- a read-only root filesystem; the session's project directory is the only writable mount, and
  `/tmp` a 128 MB tmpfs;
- 768 MB of memory, 1.5 CPUs, 256 processes; every command and wait bounded in time;
- an environment of exactly the variables the sandbox sets;
- the fixtures' dependencies baked into an image pinned by digest and lockfile, so nothing is
  installed at run time; npm is offline and says so.

The graders' own sandbox is a fresh container of the same kind, running the final project.

**The key never enters the container or the eval process's environment.** `/proc/<pid>/environ`
shows a process's starting environment to any process of the same user, so the runner refuses to
start with a key in its environment at all. In CI a separate workflow step writes the secret to a
file only its user can read; the runner reads it into memory and deletes it before anything runs.
Locally it is read from `apps/evals/.env`. It is held in a `Secret` that prints as `[secret]`, and
revealed only in the gateway call. The docker CLI gets an allowlisted environment. Two canaries
test it: a hostile program in the sandbox searches its environment, every process's environment
and command line, the whole filesystem and every way out while a canary key is held, and finds
nothing; and a whole run with a canary key, through the real model client, leaves it in no trace,
result, report, ledger or printed line. Leaking it into either place makes them fail.

**Real-model runs happen in CI by default**, on disposable runners, from a workflow that only
`workflow_dispatch` can start (write access; no push, pull request, schedule or fork). On a
machine they need `--allow-local-real-run` and print a warning. A test pins the workflow's
triggers, permissions and where its secret goes.

**Graders are automatic and deterministic, and tested.** Hidden HTTP checks against the final
project, a test that must fail once the grader breaks the code, what changed staying in scope,
file contents, a busy file left alone, finish, honest summaries, no run tools once there is no
sandbox, checks that cover every validation path the agent added (sorted by request body). No
model judges anything. Every task has a reference solution, played by a scripted model through the
real harness, which must pass every grader, and known-bad sessions, each of which must fail the
grader it names, not by the grader breaking (`npm run evals:selftest`, in CI).

**Recorded sessions are free regression checks.** The AI-2 traces are replayed through today's
tools and graders; each pins its verdict and the tool results that now differ from the recording.

**Quota.** A pacer keeps to the eval project's requests a minute and a ledger to its requests a
day, across runs. A run stops before a session the day cannot pay for and resumes with
`--resume`. Flash-Lite runs the full suite; Flash, with about 20 requests a day, runs a six-task
comparison subset spread over days, so its results are indicative, not significant.

## Alternatives

- **The model called through our HTTP server.** The most faithful path, but it brings the shared
  tier's daily admission and minute share, which evals do not want, and a server process per run.
  Rejected for the in-process gateway.
- **Copying the gateway into the evals.** Drift between what the evals and the app send would make
  the numbers meaningless. Rejected for moving it into a package both use.
- **Running model code as child processes with a scrubbed environment only.** No filesystem or
  network isolation, on the machine of whoever runs the evals. Rejected.
- **A stronger sandbox (gVisor, Firecracker, rootless Docker with user namespaces).** More setup
  than a portfolio project's CI and a laptop justify today; Docker with the locks above meets the
  requirements. Recorded as the next step if the evals ever run untrusted tasks.
- **An LLM judge.** Costs quota, is not deterministic, and needs its own evaluation. Rejected.
- **Nightly real-model runs.** They would spend the eval project's quota every day on a
  non-deterministic model. Rejected for runs started by hand.

## Consequences

- **What the smallest sandbox leaves out**, to revisit if the tasks ever come from outside:
  - the project directory has no disk quota: a program could fill it until its command or the
    session times out;
  - Docker's default seccomp profile, not a custom one;
  - no user-namespace remapping; the container runs as the host user's id, non-root;
  - the harness itself (the Docker CLI, the Y.Doc, the key in memory) runs on the host.
- **Docker is needed** for the sandbox specs, the graders' self-test and the replays: skipped
  without it locally, required in CI. On a Mac with Colima, work directories live under
  `apps/evals/.work` because the VM cannot write to the system temp folder.
- **The ES-module crash task emulates WebContainer's line shift** (+11). Node reports the right
  line, so without the emulation the task would not test the trap the prompt warns about.
- **The presence-rule tasks grade AI-2's behaviour** (leave the file, say what it would change).
  When AI-3's proposals arrive, those graders change to "a proposal exists".
- **Comparisons are small.** One trial per task on a six-task subset cannot tell two models apart
  by one or two tasks; `AI_DEFAULT_MODEL` changes only for a clear gap, weighing requests per task
  as much as the pass rate.
