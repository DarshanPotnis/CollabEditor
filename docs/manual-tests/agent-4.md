# Manual test: agent@4

What agent@4 changes in the browser (ADR 012): the panel lists the checks a finished session made,
and any it listed without making; the agent checks every case it added; an edit refused for a
wrong copy shows the line that differs. Two browser windows, A (the host) and B (a collaborator),
on the same project. It spends a few real requests: use your own key, or the shared tier with
`GEMINI_API_KEY` set for the server.

## 1. Setup

- [ ] `npm run dev`. In A, create an **Express API** project and copy its link into B.
- [ ] In A, open the AI panel. Make sure the page can run code (the Run view's **Run** works).

## 2. A finished session lists its checks

- [ ] In A, start the AI teammate with this goal:

  ```text
  Add a DELETE /users/:id endpoint with validation: 204 when deleted, 404 when there is no such user, 400 for an id that is not a number.
  ```

- [ ] While it works, B sees the AI's caret in `routes/users.js`, as before.
- [ ] After its edit, the log (**What it did**) shows one answer with several `http_request` calls
      together: a delete that works, a missing user and a non-numeric id, and something that worked
      before (such as `GET /users`).
- [ ] When it finishes, the summary says what changed and what is left, and under it a list with a
      tick per check, such as `✓ DELETE /users/1 → 204`, `✓ DELETE /users/99 → 404`,
      `✓ DELETE /users/abc → 400`.
- [ ] Each ticked check appears in the log as a request with that status, after the last edit.
- [ ] **Download trace**: the file says `"version": 4`, and `outcome.checks.made` holds the same
      checks; `outcome.checks.notMade` is empty.

## 3. No sandbox: nothing to list

- [ ] Open the project in a window without cross-origin isolation (the AI-2 manual test says how),
      and give the same goal.
- [ ] It edits, does not run anything, and finishes saying the change is not tested and to click
      Run. Under the summary: "It listed no checks."

## 4. What only the tests cover

These cannot be caused on purpose with a real model; the automated suites cover them.

- A finish listing a check it did not make: refused once, then shown under "Listed, but not made"
  with the reason (`e2e/agent.spec.ts`, and `packages/agent/src/loop.test.ts`).
- An edit refused because the copy differs, quoting the first line that differs both ways, and the
  shorter-copy hint when it is refused the same way again
  (`packages/agent/src/doc-tools/edit-repair.test.ts`, `file-tools.test.ts`).
