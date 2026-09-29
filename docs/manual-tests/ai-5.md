# Manual test: AI-5, the trace viewer and "Watch a demo"

AI-5's definition of done (`docs/PLAN-AI.md` §7): "Watch a demo" plays the recording end to end in
the browser, labelled, with zero model requests and its checks verified; the trace viewer opens
every trace format. Two windows, A and B. Use Chrome, Edge or Arc: the replay runs the project in
the page. A replay spends no model requests and needs no key.

## 1. Setup

- [ ] `npm run dev`. Keep the server's terminal visible: every model call logs an `ai step` line.
- [ ] In A, open `http://localhost:5173` with DevTools on the Network tab, filtered to `api/ai`.

## 2. Watch a demo

- [ ] In A, click **Watch a demo**. A project named **Demo — DELETE endpoint** opens (Express API
      template). The address has no `?demo=` left in it.
- [ ] The AI panel shows a violet banner: "Replay of a recorded session (recorded 2026-09-29 with
      agent@5 on gemini-3.5-flash-lite). No AI is running…", the goal, **Play the replay** and
      **View the recorded session instead**.
- [ ] Copy A's address into B. B opens the project as it is: no banner, no Play.
- [ ] In B, open `routes/users.js`.
- [ ] In A, click **Play the replay**.
  - B sees an avatar **AI teammate (replay)**, with its status starting "Replay ·".
  - The project boots and installs in A's Run panel, and the server starts.
  - The route is typed live into `routes/users.js`, in both windows.
  - The panel shows four requests go out together.
- [ ] When it ends (about 20 to 60 seconds, most of it npm install), A's panel shows:
  - the banner still there;
  - the summary, and under it four ticks: `DELETE /users/abc → 400`, `DELETE /users/999 → 404`,
    `DELETE /users/1 → 204`, `GET /users → 200`;
  - no "The replay stopped" message;
  - the buttons **Undo AI changes**, **Download the recording**, **View the recorded session** and
    **Done**.
- [ ] **What it did** shows this replay's timeline: four steps, each with its tool calls, the
      requests with the statuses they got just now.
- [ ] **View the recorded session** shows the recording, labelled "Recorded session… nothing in it
      is happening now".
- [ ] **Download the recording**: the file is identical to
      `packages/agent/fixtures/traces/demo-agent-5.json` (`cmp` it).
- [ ] DevTools shows **no** request to `api/ai`; the server's terminal shows **no** new `ai step`
      line.
- [ ] **Undo AI changes** removes the route in both windows.

## 3. A replay stops when the project no longer matches

- [ ] From the home page, **Watch a demo** again. Before pressing Play, type a character in
      `routes/users.js`, then press **Play the replay**. It does not start: "This project does not
      have the files the recording started with…", with **View the recorded session** and **Done**.
- [ ] Once more, a fresh demo, with B in it on `routes/users.js`. Press **Play the replay** in A,
      and while the project installs (step 1), type a comment at the end of `routes/users.js` in B
      and keep typing. Typing before Play would change the starting files, which the check above
      refuses. The replay's edit (step 2) is refused because someone is working in the file, and it
      stops: "The replay stopped at step 2: today's code answered edit_file differently from the
      recording… Recorded: edited lines …. Now: error: Someone else is editing routes/users.js
      right now…".

## 4. Where the live replay cannot run

- [ ] In Firefox or Safari (or any page that is not cross-origin isolated), **Watch a demo**. The
      panel offers no Play: it shows the recording as a timeline, headed "Recorded session. This is
      the recording of a past session… The live replay needs a browser that can run the project in
      the page (Chrome, Edge or Arc)." Nothing in it claims to be happening now.

## 5. The trace viewer

- [ ] In a normal project's AI panel, **Open a trace…** and pick each file in
      `packages/agent/fixtures/traces`:
  - `model-busy-mid-session.json` says "trace format 1", and its waits say the attempt's own time
    was not recorded;
  - `runtime-unavailable-agent-loops.json` (format 2) ends at the step limit, with no finish;
  - `successful-demo.json` (format 3) says its checks were not recorded in this format;
  - `demo-agent-5.json` (format 4) shows the four checks.
- [ ] Open a file that is not a trace (any `.txt`): "This file is not JSON, so it is not a trace."
- [ ] Run a real AI teammate session. When it ends, **What it did** shows its timeline, with each
      model call's tokens and latency.

## What this does not cover

- A recording made on a template that has since changed: the replay refuses it the same way as
  section 3's changed file. CI catches it first: the demo's replay tests fail, and the fix is a new
  recording.
- Cleaning up demo projects: they are named "Demo — DELETE endpoint" so a later cleanup can find
  them. There is no cleanup yet.
