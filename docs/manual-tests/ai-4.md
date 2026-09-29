# Manual test: AI-4 definition of done

AI-4's definition of done (`docs/PLAN-AI.md` §7): the graders' self-test and the replays pass in
CI, and a baseline eval run is recorded in `docs/evals/`. These are the checks a person should do
before believing it; most have automated tests too (see the end). Sections 1 to 4 need no key and
spend nothing. Sections 5 and 6 spend a few requests of the eval project's quota; section 7 is the
baseline.

## Setup

1. Docker running (on a Mac with Colima: `colima start`), then from the repository root:

   ```bash
   npm install
   npm run build:shared
   ```

---

## 1. The free checks

```bash
npm test
npm run evals:selftest
```

- [ ] `npm test` passes, including `apps/evals`: the sandbox's specs (a real container: no network,
      read-only root, non-root user, its limits) and the key canary.
- [ ] `npm run evals:selftest` passes 56 tests in about a minute and a half: each of the 21 tasks'
      reference sessions passes every grader, each known-bad session fails the grader it names,
      the three recorded AI-2 sessions replay with their pinned verdicts, and the whole-run key
      canary finds the key nowhere.
- [ ] Afterwards `docker ps --all --filter label=collabcode-eval-run` lists nothing: every container
      a run started is gone.

## 2. The sandbox, by hand

Run one session's sandbox and look inside it while it idles:

```bash
docker run --rm --network none --read-only --user "$(id -u):$(id -g)" \
  "$(docker images --format '{{.Repository}}:{{.Tag}}' | grep collabcode-eval-sandbox | head -1)" \
  node -e "fetch('https://example.com').then(() => console.log('reached the internet'), (e) => console.log('no network:', e.cause?.code ?? e.message))"
```

- [ ] It prints `no network: ...` (for example `EAI_AGAIN`).
- [ ] The image's tag is the hash of `apps/evals/docker`: change nothing and it is reused; change the
      Dockerfile and the next run builds a new one.

## 3. Where a real run may happen

```bash
npm run evals -- --tasks already-done
```

- [ ] It refuses: "Real-model evals run in CI by default ... add --allow-local-real-run." No key is
      read and no request is made.

```bash
EVAL_GEMINI_API_KEY=not-a-real-key npm run evals -- --allow-local-real-run --tasks already-done
```

- [ ] It refuses before reading anything: "EVAL_GEMINI_API_KEY is set in this process's
      environment, where other processes of yours can read it ...". The message does not repeat the
      value.

## 4. The Evals workflow's safety

Open `.github/workflows/evals.yml`.

- [ ] Its only trigger is `workflow_dispatch`; its permissions are `contents: read` (and
      `actions: read` for resuming); its job only runs in `DarshanPotnis/CollabEditor`.
- [ ] The secret appears in exactly one step, which writes it to `$RUNNER_TEMP/eval-key` with
      `umask 077`; the run step passes `--key-file` and has no secret in its environment.
- [ ] Open any pull request: the Evals workflow is not among its checks (CI's `evals` job is, and it
      uses no secret).

## 5. The key, locally

Create the eval project and its key as `docs/evals/README.md` says, and put the key in
`apps/evals/.env` in your editor.

```bash
grep -q '^EVAL_GEMINI_API_KEY=.' apps/evals/.env && echo set
npm run evals -- --allow-local-real-run --tasks already-done
```

- [ ] `set` is printed, and nothing of the key.
- [ ] The run prints a warning about running on this machine, then one task: about 2 to 4 requests,
      a pass or a fail with its reason, and the report.
- [ ] `docs/evals/results/<run id>.json` and `.md` exist; `apps/evals/runs/<run id>/` has the trace.
      Searching all three and the terminal output for the key finds nothing
      (`grep -rF "$(grep '^EVAL_GEMINI_API_KEY=' apps/evals/.env | cut -d= -f2-)" docs/evals apps/evals/runs >/dev/null && echo FOUND || echo not found`).
- [ ] `apps/evals/.usage.json` counts the requests for today (Pacific time).

Delete that run's result files unless you want to keep them.

## 6. The key, in CI

```bash
gh secret set EVAL_GEMINI_API_KEY
```

(it asks for the value without showing it). Then Actions, **Evals**, **Run workflow**, with tasks
`already-done`.

- [ ] The run passes; its summary shows the report; the `eval-run` artifact holds the results,
      the trace and the ledger.
- [ ] Nothing in the run's log shows the key (GitHub also masks it, but the step that writes the
      file never prints it).

## 7. The baseline

Record the eval project's limits for both models in `apps/evals/src/model/model-limits.ts` first.

- [ ] **Flash-Lite, every task:** start the Evals workflow with the defaults. It takes about 20 to 40
      minutes and around 160 requests. If it stops at the day's limit, run it again the next day
      with its run id and workflow run number in the resume inputs.
- [ ] Download `docs/evals/results/` from the artifact, commit the run's `.json` and `.md`, and run
      `npm run evals:readme`: the README's Evals table shows it.
- [ ] **Flash, the comparison subset:** model `gemini-3.8-flash`, tasks `comparison`, over about
      three days with resume; and Flash-Lite on the same subset three times. Record the comparison in
      `docs/evals/` with its caveat: one trial per task cannot tell two models apart by a task or two.

## 8. The automated suites

- [ ] CI's `evals` job passes on the branch (Docker required, no secret).
- [ ] The Evals workflow's test (`apps/evals/src/ci/evals-workflow.test.ts`) passes: it pins the
      trigger, the permissions and where the secret goes.

## What this does not cover

- The browser: evals run the agent in Node. The browser-only parts (live typing, follow mode, the
  WebContainer itself) are AI-2's manual test.
- Proposals (AI-3): the presence-rule tasks grade leaving the file alone until they exist.
- WebContainer's own line shift is emulated, not reproduced.
- A disk quota for the sandbox's project directory: a program could fill it until its command or
  the session times out (ADR 010).
