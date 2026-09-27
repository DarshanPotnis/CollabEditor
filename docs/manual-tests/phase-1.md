# Manual test: Phase 1 definition of done

Every item here also has an automated test, but these are the checks a person should do before
believing the phase is finished. Takes about ten minutes.

## Setup

```bash
npm install
npm run migrate -w @collabcode/server     # needs DATABASE_URL in apps/server/.env
npm run dev
```

Wait for `collabcode server listening` and Vite's `Local: http://localhost:5173/`.

Open **two windows side by side**:

- **Window A** — a normal window at http://localhost:5173
- **Window B** — a **private/incognito** window. This matters: identity lives in localStorage,
  so two normal windows would be the same person with the same name and colour.

> If a step says "wait", wait. Saves are debounced by two seconds on purpose.

---

## 1. Create a project

**In A:** click **Express API**, then **Create project**.

- [ ] The URL becomes `/p/<12 characters>`.
- [ ] The editor shows the Express template, starting `// A small Express API.`
- [ ] The header shows the project name, the file name `index.js`, one avatar, and **Just you**.
- [ ] There is **no language dropdown** anywhere. Language comes from the file name.

**In A:** click **Copy invite link**. Paste it into **B**'s address bar and load it.

- [ ] B shows the same content.
- [ ] Both windows now show **2 people here** and two differently-coloured avatars.

---

## 2. Named, coloured cursors

**In B:** change the name field in the header to `Grace` and press Enter.

- [ ] A's avatar tooltip for that person now reads `Grace`.

**In B:** click somewhere in the middle of line 1 and type a few characters.

- [ ] A shows a coloured caret at that position with the label **Grace** attached to it.
- [ ] The caret colour matches Grace's avatar colour.

**In A:** type on a different line.

- [ ] B shows A's caret, labelled with A's name, in A's colour.
- [ ] Neither caret jumps when the other person types above it.

---

## 3. Concurrent edits at the same position — the headline check

**Both windows:** click at the very start of line 1 and press `Home`.

**Now type at the same time**, as close to simultaneously as you can manage: `AAAA` in A and
`BBBB` in B.

- [ ] Both windows end up showing **exactly the same text**.
- [ ] All four A's and all four B's are present. Nothing was overwritten.
- [ ] **The characters are interleaved** — something like `BBAABBAA`, not `AAAABBBB`.

That interleaving is the point. It is both people's intent being merged. The old version would
have shown one person's text and silently discarded the other's.

---

## 4. A late joiner sees the current state

**In A:** type `// written before you arrived` on a new line.

**Open a third window** (another private window) and paste the project link.

- [ ] It loads showing that line, immediately, without anyone typing again.
- [ ] All three windows show **3 people here**.

Close the third window.

- [ ] A and B drop back to **2 people here**, and the third cursor disappears from both editors
      within a second or two. Nobody had to reload.

---

## 5. Offline, then back

**In B:** open DevTools → Network → set throttling to **Offline**.

- [ ] Within a few seconds B shows a banner: **Reconnecting…** or **Offline**, telling you your
      edits are kept and will merge.
- [ ] B's editor is still editable. This is deliberate.

**In B (still offline):** type `offline-edit ` at the start of line 1.
**In A (still online):** type `online-edit ` at the start of line 1.

- [ ] A does **not** show `offline-edit`. B does **not** show `online-edit`.

**In B:** set throttling back to **No throttling**.

- [ ] The banner disappears.
- [ ] Both windows now show **both** edits, and identical text.

---

## 6. Nothing is lost when you leave

**In A:** type `// typed then closed` and **immediately close the window** — within a second, no
pause.

Reopen the project link in a new window.

- [ ] `// typed then closed` is there.

This is the race worth checking by hand: the update has to reach storage before the server
unloads the document.

---

## 7. Surviving a restart

**In B:** type `// survives restart`, then wait **five seconds** (past the save debounce).

**In the terminal:** restart the server. If you started everything with `npm run dev`, Ctrl-C
stops the web server too — just run `npm run dev` again. (To restart only the server, run
`npm run dev:web` and `npm run dev:server` in two terminals from the start.)

- [ ] While the server is down, both windows show **Reconnecting…**.
- [ ] Once it is back, the banner disappears on its own. Neither window needed a reload.
- [ ] Now reload B. `// survives restart` is still there — it came from Postgres, not from
      memory, because the process that held it is gone.

---

## 8. Unknown and legacy links

Visit `http://localhost:5173/p/zzzzzzzzzzzz`.

- [ ] The 404 page appears: "There is no project at this link".
- [ ] No editor loads, and no error banner flashes first.

Visit `http://localhost:5173/room/<your project id>` (the old URL shape).

- [ ] It redirects to `/p/<id>` and loads the project.

On the landing page, paste nonsense into the join field and press **Join**.

- [ ] "That does not look like a project link or ID", and you stay on the page.

---

## 9. Cold start wording (optional, needs a deployed server)

Against a Render instance that has been idle for fifteen minutes or more:

- [ ] The landing page loads immediately and looks normal.
- [ ] Creating or opening a project shows **Waking up the server…** with the explanation that it
      **can take up to a minute**, rather than a bare spinner.
- [ ] It does eventually connect, and the banner disappears.

---

## What this does not cover

- Two people editing **different files** — Phase 2. There is only one file per project.
- Running the code — Phase 3.
- Offline edits surviving a **reload**. They do not; the merge only works while the tab stays
  open. That is out of scope for phases 0–3.
