# Manual test: Phase 2 definition of done

Every item in `docs/PLAN.md` §9.5 also has an automated test, but these are the checks a person
should do before believing the phase is finished. Takes about twenty-five minutes.

Shortcuts are written for a Mac. Elsewhere, read **Cmd** as **Ctrl**.

## Setup

```bash
npm install
npm run migrate -w @collabcode/server     # needs DATABASE_URL in apps/server/.env
npm run dev
```

Wait for `collabcode server listening` and Vite's `Local: http://localhost:5173/`.

Open **two windows side by side**:

- **Window A** — a normal window at http://localhost:5173
- **Window B** — a **private/incognito** window, so it is a different person with a different
  name and colour.

**In each window**, set a name in the header field (`Ada` in A, `Bob` in B) and press Enter. The
steps below use those names.

> "Go offline" means DevTools → Network → throttling **Offline**. "Back online" means **No
> throttling**. The offline steps are how you make two edits _at the same moment_: neither window
> can see the other's change before making its own.

---

## 1. The workspace

**In A:** click **Express API**, then **Create project**.

- [ ] Three panes: **Files** on the left, the editor in the middle, **Run** on the right.
- [ ] The tree shows a `routes` folder, then `index.js` and `package.json`. Folders come first.
- [ ] `index.js` is open in a tab and highlighted in the tree.
- [ ] Drag the two pane dividers. Reload. The sizes are kept.
- [ ] Tab to a divider and press the arrow keys: it moves.

**In A:** click **Copy invite link** and open it in **B**.

- [ ] B shows the same tree and the same open file.

---

## 2. Two people, two files, presence in the tree

**In A:** expand `routes` and click `users.js`. **In B:** stay in `index.js`.

**Both:** type a comment at the end of your file at the same time.

- [ ] In A's tree, `index.js` has a dot in Bob's colour. Hovering it says **Open by Bob**.
- [ ] In B's tree (expand `routes`), `users.js` has a dot in Ada's colour.
- [ ] Each person's typing appears in the other window when they open that file.
- [ ] Moving your cursor around does not make the dots flicker.

---

## 3. Creating, renaming, refused names

**In A:** click the **New file** icon in the Files header, type `utils.js`, press Enter.

- [ ] `utils.js` appears in both windows and opens in a new tab in A.

**In A:** click **New file** again and type `utils.js`. Press Enter.

- [ ] The box stays open with **A file named "utils.js" already exists in the project root.**

Change it to `Utils.js` and press Enter.

- [ ] Refused again, explaining that names differing only in capitalisation are the same file
      on macOS and Windows. Press Escape: nothing was created.

**In A:** right-click the empty area below the files → **New folder** → `lib`.
**In A:** select `utils.js`, press **F2**, type `helpers`, press Enter.

- [ ] The name box selected only `utils`, not `.js`.
- [ ] Both windows show `helpers.js`, and A's tab is renamed too.

**Keyboard only, in A:** click a tree row, then use the arrow keys, Enter, and **Shift+F10**.

- [ ] Up/Down move, Right opens a folder then enters it, Left closes it then goes to the parent.
- [ ] Enter opens a file. Shift+F10 opens the context menu at the row; Escape closes it and focus
      returns to the row.

---

## 4. Renaming a file someone is typing in — the headline check

**In B:** open `index.js` and **keep typing** a line of text, slowly and continuously.

**In A, while B is typing:** select `index.js` in the tree, press **F2**, rename it to
`server.js`.

- [ ] B's tab becomes `server.js` without B doing anything.
- [ ] B's text keeps going into the file without a break. Nothing typed before, during or after
      the rename is lost, in either window.
- [ ] A still sees Bob's labelled cursor where B is typing.
- [ ] **In B:** press **Cmd+Z** a few times. B's own typing is undone, including what B typed
      before the rename.

---

## 5. Undo is per person

**Both open `helpers.js`.** In A type `AAA`, then in B type `BBB`.

**In A:** press **Cmd+Z**.

- [ ] `AAA` disappears in both windows. `BBB` stays.
- [ ] **Cmd+Shift+Z** brings `AAA` back.

**In A:** press **F1** to open the command palette and type `undo`.

- [ ] The list shows **Undo** (and Monaco's **Cursor Undo**, which only moves the cursor).
- [ ] Choosing **Undo** removes A's text only, exactly like Cmd+Z.

**In A:** type `CCC`, then use the browser's own menu bar: **Edit ▸ Undo**.

- [ ] Nothing happens to anyone's text. (Monaco does not handle the browser's native undo; this
      is read from its source, not covered by an automated test, so it is worth seeing.)

---

## 6. Deleting a file someone has open

**In B:** open `helpers.js`. **In A:** select `helpers.js` in the tree and press **Delete**
(on a Mac laptop, **Cmd+Backspace**).

- [ ] A sees a toast: **Deleted "helpers.js".** with **Undo**.
- [ ] `helpers.js` disappears from B's tree. B's tab stays open with its name struck through and
      a banner: **Deleted by Ada. It is read-only until it is restored.**
- [ ] Typing in B does nothing except show a "This file was deleted" hint.

**In B:** click **Restore** in the banner.

- [ ] `helpers.js` is back in both trees, and B can type in it again.

**In A:** delete the `routes` folder (right-click → **Delete**).

- [ ] The toast says it deleted the folder and everything in it. **Undo** brings it all back.

---

## 7. Recently deleted, and deleting forever

**In A:** delete `helpers.js` again. **In B:** keep `helpers.js` open.

**In A:** click the **bin** icon in the Files header (it shows a count).

- [ ] **Recently deleted** lists `helpers.js`: in the project root, deleted by you, just now.
- [ ] **Restore** puts it back. Delete it again.

**In A:** click **Delete forever** on `helpers.js`.

- [ ] A dialog names the file and says it **can't be undone, for anyone in this project**.
      Cancel closes it and nothing happens.

Confirm this time.

- [ ] B's tab now says **"helpers.js" was permanently deleted, so it can't be restored**, with
      **Close tab**. Closing it works, and no error appears anywhere.

**In A:** delete two more files, then use **Empty all**.

- [ ] The dialog counts every file and folder that will go, including those inside folders.

---

## 8. Two people create the same name at the same moment

**In B:** go offline. Wait for B's banner to say it is offline or reconnecting.

**In A:** create `utils.js` and type `// ada` in it.
**In B (offline):** create `utils.js` too — B cannot know A just did — and type `// bob`.

**In B:** back online.

- [ ] Both files survive. Both trees show `utils.js` **and** `utils (2).js`.
- [ ] The same file carries the `(2)` in both windows: opening `utils.js` shows the same text in
      A and B, and so does `utils (2).js`.

---

## 9. Two folders moved into each other at the same moment

**In A:** create folders `X` and `Y`. Wait until B shows them.

**In B:** go offline.

**In A:** drag `X` onto `Y`. **In B (offline):** drag `Y` onto `X`.

**In B:** back online.

- [ ] Both windows show the **same** tree: `X` at the top level with `Y` inside it.
- [ ] Both windows show a toast: **"X" and "Y" were moved into each other at the same time, so
      "X" was kept at the top level. Nothing was lost.**

---

## 10. Moving files

**In A:** drag `package.json` onto the `lib` folder.

- [ ] While dragging, `lib` highlights. Hovering a closed folder for a moment opens it.
- [ ] Dropping moves the file, in both windows.
- [ ] Dragging a folder onto one of its own subfolders offers no drop (no highlight).

**Keyboard:** select `lib/package.json`, press **Cmd+X**, select any root-level file, press
**Cmd+V**.

- [ ] The file moves back to the root. (Right-click → **Cut** / **Paste here** does the same.)

---

## 11. Tabs

**In A:** create `lib/index.js` and open both `index.js` files.

- [ ] Both tabs say `index.js`, each with its folder next to it (`lib`, `project root`).

**In A:** switch between tabs and type in each.

- [ ] Each file keeps its own cursor and scroll position when you come back to it.
- [ ] When A switches files, Ada's cursor disappears from the file B is in (if B was there).

**In A:** with a file open and your cursor in it, middle-click a **different** tab to close it.

- [ ] B still sees Ada's cursor in the file A is editing.

---

## 12. Following someone

**In B:** open a long file (paste 80 blank lines into one if needed) and put the cursor at the
bottom.

**In A:** hover Bob's avatar in the header, then click it.

- [ ] The tooltip says where Bob is, for example **Bob, in routes/users.js. Go to their cursor**.
- [ ] A opens that file and scrolls to Bob's labelled cursor.

---

## 13. It all persists, and old projects still open

Wait five seconds, then reload both windows.

- [ ] The tree, file names and contents are exactly as you left them. Tabs are not restored: the
      template's root `index.js` opens if it still exists (step 4 renamed it), otherwise the
      first file in the tree.

Open a project you created during Phase 1 testing, if you still have its link.

- [ ] It opens with its single `index.js`, and you can add files to it.

---

## What this does not cover

- Running the code — Phase 3. The Run pane is a placeholder.
- Offline edits surviving a **reload**. They still do not; the merge only works while the tab
  stays open.
- Touch devices. Drag and drop uses native HTML5 events, which mobile browsers do not fire from
  touch; a mobile layout is out of scope for phases 0–3.
