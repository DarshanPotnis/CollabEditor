# Manual test: AI-1 definition of done

AI-1's definition of done (`docs/PLAN-AI.md` §7): both helpers work on the free tier and with
your own key, the limits give the right messages, and no content appears in the server logs.
Almost every step also has an automated test (see the end). These are the checks a person
should do before believing the phase is finished. It takes about thirty minutes and uses about
fifteen of the day's free Gemini requests.

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
   a private window (a different person, and a first-time AI user).
4. In A, create an **Express API** project and open its link in B.

- [ ] The server's log starts with `sharedAi: "gemini-3.5-flash-lite"` and shows no key.
- [ ] If your shell sets its own `DATABASE_URL`, the log names it under "apps/server/.env takes
      precedence", without its value, and the server still starts.

---

## 1. The Run and AI views, and AI settings

- [ ] The right-hand pane has **Run** and **AI** tabs. Run shows the status ("Not running") next
      to the Run button, with no separate "RUN" heading.
- [ ] **AI** says "Ask AI about your code." and, at the top, **Shared free tier**.

**In A:** click the gear (**AI settings**). Choose **Anthropic**, type `abc` as the key, and click
**Save**.

- [ ] "That doesn't look like an API key." appears and the dialog stays open.

Type a made-up key such as `sk-ant-made-up-key-12345` and click **Save**.

- [ ] The dialog closes and the top of the AI view reads **Your Anthropic key · claude-sonnet-5**.
      The key itself is never shown.

Open the settings again, pick **claude-opus-5-5** with the key field left empty, and **Save**.

- [ ] The model changes and the key is kept.

Open the settings once more and click **Forget my key**.

- [ ] Back to **Shared free tier**.

---

## 2. The privacy notice, then Explain

**In A:** open `index.js`, select lines 10 to 12 (the `app.get('/'` route), right-click and
choose **Explain with AI**.

- [ ] The pane switches to **AI** and shows **Before you use AI**, with the four points about
      where your request goes.

Click **Continue**.

- [ ] "Explain index.js, lines 10–12" at the top, then the answer streams in within a second or
      two, with inline code shown as code.
- [ ] It ends with "Answer complete." and "gemini-3.5-flash-lite · N free requests left today".

Click **Clear** and explain another selection.

- [ ] No notice this time. **In B**, the first Explain shows the notice: it is per browser.

---

## 3. Stop mid-answer

**In A:** open `routes/users.js`, select the whole file (**Cmd+A**), and choose **Explain with
AI**. Click **Stop** as soon as it appears; Gemini is quick.

- [ ] What arrived stays, the status says **Stopped.**, and there are **Try again** and **Clear**
      buttons.
- [ ] **Try again** asks again and completes.

---

## 4. Edit with AI, apply, undo

**In A:** in `index.js`, select lines 10 to 12, right-click, choose **Edit with AI…**, type
`Add a version: 1 field to the JSON response` and press **Enter**.

- [ ] A diff titled **AI edit to review** covers the editor, with the old lines in red, the new
      in green, and the file's real line numbers. The AI view says the change is ready to review.
- [ ] **B**'s editor is unchanged.

Click **Apply**.

- [ ] The diff closes, the new code is selected in A, and a toast says it was applied and how
      to undo it.
- [ ] **B** sees the change within a second.

**In B:** type a word somewhere else in `index.js`. **In A:** press **Cmd+Z** once.

- [ ] The whole AI edit goes, in both windows, in one step. B's word stays.
- [ ] **Cmd+Shift+Z** brings the edit back.
- [ ] Right-clicking in the editor still opens the menu after the diff has come and gone.

---

## 5. A stale edit is refused

**In A:** select lines 10 to 12 again and ask **Edit with AI…** to `Rename req to request`.
Wait for the diff, and do not apply it yet.

**In B:** type something on line 11, inside A's selection.

**In A:** click **Apply**.

- [ ] A red message: "The selected code changed after you asked, so the edit was not applied."
      **Apply** is greyed out, and B's typing is intact in both windows.
- [ ] **Discard** closes the diff.

Repeat, but this time **B** types on line 2, outside the selection.

- [ ] **Apply** works, and the edit lands in the right place.

---

## 6. Explain this error

**In A:** click **Run** and wait for **Server running on port 3000**. Then change the line
`const port = Number(process.env.PORT ?? 3000);` to `const port = undefined.port;`.

- [ ] Within a few seconds the status reads **The program crashed. Fix the error; the run
      restarts when a file changes.**, with an **Explain with AI** button under it.

Click **Explain with AI**.

- [ ] The AI view explains the crash and names the line you changed, even though the output
      shows a different line number (WebContainer shifts ES-module line numbers).

Undo the change (**Cmd+Z**).

- [ ] The run restarts by itself and returns to **Server running**.

Now break the project **before** running it: click **Stop**, add `undefined.port;` as a new
first line of `index.js`, and click **Run**.

- [ ] Instead of waiting forever at "no server is listening yet", the status turns to **The
      program crashed** and **Explain with AI** appears.
- [ ] Removing the line restarts the run and it serves again.

---

## 7. Limits and their messages

These need the server restarted with different settings. Edit `apps/server/.env`, then stop and
start `npm run dev` each time, and put the lines back at the end.

**Per visitor:** add `AI_PER_IP_DAILY_REQUESTS=1`. Explain twice.

- [ ] The second one says "You've used your shared free AI requests for today. They reset at
      midnight Pacific time…" with an **Add your own key** button that opens AI settings.

**Everyone per minute:** remove that line, add `AI_GLOBAL_REQUESTS_PER_MINUTE=1`. Explain twice
within a minute.

- [ ] The second one says "The shared free AI is busy right now. Try again in about N seconds…"
      with a real number of seconds.

**Shared tier off:** remove that line and comment out `GEMINI_API_KEY`.

- [ ] The startup log shows `sharedAi: "off"`, and Explain says the shared free AI is not set up
      on this server, suggesting your own key.

Restore `GEMINI_API_KEY` and restart.

---

## 8. Your own key

**In A:** in AI settings choose **OpenAI**, enter `sk-made-up-key-1234567`, and save. Explain
something.

- [ ] "OpenAI refused your key. Check it in AI settings." and a **Check your key** button that
      opens the settings.

If you have a real key for any of the three providers, save it and Explain.

- [ ] The answer ends with "<model> · your <provider> key", and no free requests are used.

Forget the key afterwards.

---

## 9. Nothing sensitive in the server log

Look at the `npm run dev` output from the steps above.

- [ ] Each AI request logged one `ai step` line (or `ai step timed out` / `ai step failed`) with
      the prompt id and version, provider, model, whether it was your own key, tokens and timings.
- [ ] Searching the output for a piece of the code you selected, an instruction you typed, or
      any key finds nothing.

---

## 10. The automated suites

```bash
npm test
npm run e2e
RUN_WEBCONTAINER_E2E=1 npm run e2e -- runtime.spec.ts
```

- [ ] `npm test` passes without a database or an AI key.
- [ ] `npm run e2e` passes, including the six AI specs, which run against a scripted model.
- [ ] The opt-in WebContainer suite passes its five tests, including Explain with AI on a real
      crash and a crash before the server listens.

---

## After deploying

Follow the README's **Launch checklist: AI** against the deployed server: the startup log, an
answer that streams through Render's proxy, a request without an `Origin` refused, and metadata-
only log lines.

## What this does not cover

- Streaming through Render's proxy, until the service is deployed.
- Safari and Firefox.
- The daily limits across a restart: they are counted in memory and start over.
- The agent (AI-2): no tools, no multi-step sessions, and nothing the AI does on its own.
