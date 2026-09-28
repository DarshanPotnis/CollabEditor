# Manual test: AI-2 definition of done

AI-2's definition of done (`docs/PLAN-AI.md` §7): the demo task works end to end in one window;
a second window sees the AI avatar, cursor and live typing; Undo AI changes reverts only the
agent's work while keeping a human edit made during the session; Stop works mid-run. Almost every
step also has an automated test (see the end). These are the checks a person should do before
believing the phase is finished.

It takes about fifty minutes. A shared-tier session uses up to 15 of the day's free requests, and
you get 30, so do sections 2 to 6 on the shared tier, then save your own key (the first step of
section 10) for sections 7 to 10 if you have one, or continue on another day. When Gemini is busy (HTTP 503, "high demand"), the agent waits and retries twice; if a
session still ends on "busy", wait a few minutes, or use your own key.

Use **Chrome or Edge**. Shortcuts are written for a Mac; elsewhere read **Cmd** as **Ctrl**.

## Setup

1. `apps/server/.env` needs `DATABASE_URL` and a `GEMINI_API_KEY` from a Google Cloud project
   used only for this app (README, Deploying).
2. Run:

   ```bash
   npm install
   npm run dev
   ```

3. Open **two windows side by side**: **A**, a normal window at http://localhost:5173, and **B**,
   a private window (a different person).
4. In A, create an **Express API** project and open its link in B. In **B**, set the display name
   to `Bob` (top right).

- [ ] The server's log starts with `sharedAi: "gemini-3.5-flash-lite"` and
      `sharedAiFallback: "none"` (or your fallback), and shows no key.

---

## 1. The layout

- [ ] The right-hand pane shows the **AI** panel on top and the Run views (Output, Shell, API,
      Preview) below, both at once. Dragging the line between them resizes them, and the sizes
      are kept after a reload.
- [ ] The AI panel starts with **AI teammate**: "What should the AI teammate do?", a **Start**
      button, "Up to 15 steps and 5 minutes. Uses 15 of your free AI requests at most.", and a
      ticked **Type edits live** box. Below it, the one-shot helpers' hint.

---

## 2. The demo task, watched from a second window

**In B:** open `routes/users.js` from the tree. **In A:** stay in `index.js`.

**In A:** type `Add a DELETE /users/:id endpoint with validation` and click **Start**. If this
browser has not used AI before, the privacy notice appears first: click **Continue**.

- [ ] A's panel shows "Step 1 of 15 · …", the goal, and **Following the AI**. As the session goes,
      the log lists what it does ("Reading routes/users.js", "Editing routes/users.js", "Running
      the project", "Calling DELETE /users/1"), each with a result you can expand.
- [ ] B's presence bar shows a robot avatar and "2 people and an AI teammate here". Hovering the
      robot reads "AI teammate (AI, working for <A's name>): <what it is doing>".
- [ ] In B's editor, the new route is **typed in over about a second**, with a dashed caret
      labelled "AI teammate" moving along with it.
- [ ] A's editor switched to `routes/users.js` by itself, and scrolls to the AI's caret when it
      goes off screen.
- [ ] A's Output tab shows `npm install`, then the server starting, without npm's spinner frames
      in the agent's log results.
- [ ] If the server errors on its first try, the log shows the agent reading the output, editing
      again, and calling the endpoint again.
- [ ] It keeps to the goal: it changes `routes/users.js` (and at most the route list in
      `index.js`), and does not create test files, edit `package.json`, install packages, or
      remove comments. It calls the new endpoint with at least one request that should succeed
      and one that should fail, then finishes without spending more steps.
- [ ] The session ends with a green summary of what it changed and how it checked it, a line such
      as "7 steps · 41,203 tokens · 1 min 12 s · 16 free requests left today", and the buttons
      **Undo AI changes**, **Download trace** and **Done**.
- [ ] B's avatar for the AI now reads "…: Finished", and its caret is gone.

**In A:** in the API tab, send `DELETE /users/1`, then `DELETE /users/abc`.

- [ ] The first answers 204 (or whatever the summary said), the second a 4xx with an error.

---

## 3. A busy model

If Gemini answered "busy" at any point, or when it does:

- [ ] The status line reads "Gemini is busy, retrying in 5 s", counting down each second, then
      "Gemini is busy, retrying…" until it answers. It never says "Thinking" during the wait.
- [ ] After a third busy answer the session ends with "The shared free AI model is busy right
      now…", and what it changed so far can still be undone.

---

## 4. Undo keeps a collaborator's edit

**In B:** in `routes/users.js`, type a line at the end: `// Bob was here`.

**In A:** click **Undo AI changes**.

- [ ] A box says "1 file the AI changed has been edited by someone else since:
      routes/users.js", "Undo removes only the AI's changes. Their edits stay.", with **Undo
      anyway** and **Cancel**.

Click **Undo anyway**.

- [ ] Both windows lose the AI's route; `// Bob was here` stays in both.
- [ ] The panel says "Undid the AI's changes in 1 file." and the AI's status in B reads "Its
      changes were undone".
- [ ] A file the AI created, if any, is in **Recently deleted**, deleted by "AI teammate".

---

## 5. Download trace, then Done

Click **Download trace** and open the file.

- [ ] It is JSON with `"format": "collabcode-agent-trace"`, `"version": 3`, the goal, the
      template `express-api`, and one entry per step with the model's message, each tool call and
      result, and a `"reminder"` (null on a step with nothing to remind).
- [ ] Searching it for your key (section 10) or for `x-ai-key` finds nothing.

Click **Done**.

- [ ] The robot avatar disappears from B, and A's panel is back to the goal box.

---

## 6. Follow mode and Stop

**In A:** start `Add a GET /users/:id endpoint`. While it runs, click into the editor and type a
character.

- [ ] **Following the AI** turns into a **Follow AI** button, and A's editor stays where you are.

Click **Follow AI**.

- [ ] A's editor jumps back to the file the AI is in. Opening another file from the tree pauses
      following again.

Click **Stop** while it is still working.

- [ ] The session ends at once with "You stopped the AI teammate." A command or request that was
      running stops; an edit being typed is finished, not left half-written.
- [ ] If it had changed something, "What it changed so far is still there.", then the files it
      changed ("Edited routes/users.js."), and **Undo AI changes** are shown; if not, "It did not
      change any files."

Undo if needed, then **Done**.

---

## 7. Follow mode and a file the agent deletes

**In A:** open `index.js`, then start `Create notes.txt containing hello, then delete notes.txt,
then add a one-line comment at the top of routes/users.js saying what it handles`.

- [ ] A's editor follows the AI into `notes.txt` (if it creates and deletes it in one answer,
      this can be too quick to see).
- [ ] Once `notes.txt` is deleted, its tab is gone and A is back in `index.js`, not looking at a
      deleted file; **Following the AI** is still shown.
- [ ] Then A's editor follows it into `routes/users.js`.
- [ ] If the session ends without the AI's own summary, the panel lists `routes/users.js` as
      edited and does not list `notes.txt`.

Undo, then **Done**.

---

## 8. It leaves a busy file alone

**In B:** open `index.js` and keep typing a comment slowly (a character every few seconds)
through this section.

**In A:** open `routes/users.js`, then start `Add a comment at the top of index.js saying what
the app does`.

- [ ] The log shows the edit to `index.js` refused, and the summary says what it would have
      changed there instead. `index.js` in B has only Bob's typing.
- [ ] Nothing names Bob in the refusal (it says "Someone else is editing index.js").

Stop typing in B, wait 30 seconds, and run the same goal again.

- [ ] Now it edits `index.js`.

Undo, then **Done**.

---

## 9. A page that can't run code

This makes window A's page load without cross-origin isolation, the way a misconfigured host would.
Chrome's DevTools overrides apply only while DevTools is open.

**In A:** open DevTools, then **Network**, and reload. Right-click the first request (the project's
page) and choose **Override headers**; the first time, Chrome asks for a folder to keep overrides
in: pick an empty one and click **Allow**. Change `Cross-Origin-Embedder-Policy` to `unsafe-none`,
then reload with DevTools still open.

- [ ] Typing `crossOriginIsolated` in the console prints `false`.
- [ ] The Run panel's **Run** is disabled, with "Running code needs cross-origin isolation, and
      this page was loaded without the headers that turn it on (…). You can still edit." Nothing
      mentions third-party cookies.

**In A:** start the demo task on a fresh Express project.

- [ ] It makes the change without running anything. If it calls `run_project`, `run_command` or
      `http_request`, the result says at once "The sandbox isn't available in this session…", and
      it does not keep calling them.
- [ ] It finishes with a summary saying the change is untested and that you can click Run to
      check it.
- [ ] The downloaded trace has `"sandbox": "unavailable"` in its `inputs`.

Remove the override (DevTools **Sources**, **Overrides**, right-click the folder, **Remove**),
close DevTools and reload. Then **Done**, and Undo if you like.

---

## 10. Your own key, and a stronger model

**In A:** in AI settings, save your own key (for example Anthropic with `claude-sonnet-5`).

- [ ] The goal box now says "Up to 25 steps and 5 minutes. Uses your own key."

Run the demo task again on a fresh Express project.

- [ ] It works as in section 2; the summary line has no "free requests left today".
- [ ] During a busy or rate-limited wait (if any), the status names the provider ("Claude is busy,
      retrying in 5 s").

Download its trace.

- [ ] Searching the trace for any part of your key finds nothing.

Forget the key afterwards. To try a stronger Gemini model on the shared tier instead, set
`AI_DEFAULT_MODEL=gemini-3.8-flash` in `apps/server/.env` and restart; Flash models get only about
20 free requests a day.

---

## 11. Limits on the shared tier

These need the server restarted with different settings. Edit `apps/server/.env`, then stop and
start `npm run dev` each time, and put the lines back at the end.

**A session the visitor could not finish:** add `AI_PER_IP_DAILY_REQUESTS=10` and Start.

- [ ] It does not start: "An AI teammate session needs 15 of your shared free AI requests, and you
      have 10 left today…" The one-shot helpers still work.

**The agent's share of the minute:** remove that line, add `AI_AGENT_REQUESTS_PER_MINUTE=1`, and
Start.

- [ ] Between steps the status reads "Waiting N s for the free AI tier", counting down, and the
      session carries on after each wait.

**A fallback model (optional):** add `AI_FALLBACK_MODEL=` with a second Gemini model id. The
startup log shows it. When the default is busy, a helper or a session's first step is answered by
the fallback; later steps stay on whichever model the session started with (the server log's
`model` field for that session).

Restore the settings and restart.

---

## 12. Nothing sensitive in the server log

Look at the `npm run dev` output from the steps above.

- [ ] Each agent step logged one `ai step` line with `promptId: "agent"`, `promptVersion: 3`, the
      model, `agent: { sessionId, step }`, tokens, timings, `rawFinishReason` and `attempts`.
- [ ] Searching the output for your goal's text, a piece of the project's code, or any key finds
      nothing, and there is no printed `APICallError`.

---

## 13. The automated suites

```bash
npm test
npm run e2e
RUN_WEBCONTAINER_E2E=1 npm run e2e -- runtime.spec.ts
```

- [ ] `npm test` passes without a database or an AI key.
- [ ] `npm run e2e` passes, including the seven AI teammate specs (`e2e/agent.spec.ts`) and the
      AI teammate on a page without isolation (`e2e/runtime-unsupported.spec.ts`), all against a
      scripted model.
- [ ] The opt-in WebContainer suite passes its six tests, including the scripted AI teammate that
      adds a route, runs the project and gets 204 from `DELETE /users/1`.

---

## After deploying

Follow the README's **Launch checklist: AI**, including an AI teammate session on the deployed
site.

## What this does not cover

- Proposals for files someone else is editing (AI-3): here the agent only leaves them alone.
- Evals and the eval harness (AI-4), and the trace viewer and replayed demo (AI-5).
- The steps-left reminder, which needs a session that reaches its last three steps. Unit tests
  cover it, a replay of a recorded 15-step session shows where it fires, and one live request
  confirmed Gemini accepts it and calls `finish`. If one of your sessions runs long, its trace
  shows `"reminder"` on its last three steps.
- Safari and Firefox.
- The limits across a restart: they are counted in memory and start over.
- An agent session in a background tab for long: browsers slow a hidden tab's timers, so it types
  at once and may take longer between steps.
