# Manual test: Phase 3 definition of done

Every item in `docs/PLAN.md` §10.3 also has an automated test; three of them need the network,
so they are opt-in (see the end). These are the checks a person should do before believing the
phase is finished. Takes about twenty-five minutes.

Use **Chrome or Edge**. Shortcuts are written for a Mac; elsewhere read **Cmd** as **Ctrl**.

## Setup

```bash
npm install
npm run migrate -w @collabcode/server     # needs DATABASE_URL in apps/server/.env
npm run dev
```

Open **two windows side by side**: **A**, a normal window at http://localhost:5173, and **B**, a
private window (a different person). Set names `Ada` in A and `Bob` in B.

The first Run in a session downloads StackBlitz's runtime and installs packages, so it needs the
internet.

---

## 1. The page is cross-origin isolated

**In A:** open DevTools → Console and type `crossOriginIsolated`.

- [ ] It prints `true`.
- [ ] In a terminal, `curl -sI http://localhost:5173/ | grep -i cross-origin` shows
      `cross-origin-opener-policy: same-origin` and `cross-origin-embedder-policy: require-corp`.
- [ ] Editing, the file tree, presence and the other Phase 2 features still work as before.

---

## 2. Run the Express template

**In A:** create an **Express API** project and open its link in **B**.

- [ ] Nothing is running in either window. The Run panel says **Not running** and "Output
      appears here when you run the project."

**In A:** click **Run**.

- [ ] The status moves through **Starting the runtime…**, **Copying the project…**,
      **Installing dependencies…** and ends at **Server running on port 3000** in green, within
      about fifteen seconds.
- [ ] **Output** shows `$ npm install`, npm's summary, `$ npm run dev`, and
      `API listening on http://localhost:3000`.
- [ ] **B** is still **Not running**. A's run is A's alone.

---

## 3. The API console

**In A:** open the **API** tab. It starts with `GET /users`; click **Send**.

- [ ] A green **200 OK** with a time and a size, and the users as pretty-printed JSON.
- [ ] **Headers** expands to show `content-type: application/json; charset=utf-8` and others.

Switch the method to **POST**, enter the body `{ "name": "Grace" }`, and **Send**.

- [ ] **201 Created**, with Grace in the body.

Switch back to **GET** (the body field disappears) and **Send**.

- [ ] It is sent without complaint, and the list now includes Grace.

Try a path of `users` (no slash), then `http://localhost:3000/users`.

- [ ] Both are refused with a message saying to enter a path like `/users`.

- [ ] **History** lists the requests; clicking one puts it back in the form and shows its
      response.

---

## 4. Editing a route while it runs

**In A:** open `routes/users.js` and change `'Ada Lovelace'` to `'Ada King'`.

- [ ] The status briefly says **Restarting after a change…**, then **Server running** again.
- [ ] **Send** `GET /users` again: the response says `Ada King`.

---

## 5. A collaborator's edit reaches your running server

**In B:** open `routes/users.js` and change `'Grace Hopper'` to `'Grace Brewster Hopper'`.

- [ ] **In A**, without touching anything, the status restarts, and the next `GET /users` shows
      `Grace Brewster Hopper`.

---

## 6. Crashes, and restarting by themselves

**In A:** type `this is not javascript` on the first line of `routes/users.js`.

- [ ] **Output** shows a `SyntaxError` and `Failed running 'index.js'. Waiting for file changes`.
- [ ] Within a few seconds the status turns red: **The server stopped. Fix the error; the run
      restarts when a file changes.**
- [ ] **Send** in the API console says there is no server because the program crashed.

Press **Cmd+Z** to undo the line.

- [ ] The run restarts by itself and returns to **Server running**.

**In A:** delete `routes/users.js` from the tree. Wait for the red status. Then restore it from
the Undo toast (or Recently deleted).

- [ ] The run restarts by itself. (`node --watch` alone would not have noticed the file coming
      back.)

---

## 7. Changed dependencies

**In A:** in `package.json`, add `"zod": "^4.0.0"` to `dependencies`.

- [ ] The Run panel says **package.json dependencies changed since the last install** with
      **Restart to install**.
- [ ] Clicking it runs `npm install` again (visible in Output) and starts the server.

Change only the `start` script's text, then click **Restart**.

- [ ] This time `npm install` is **not** run again: only the dependency sections count.

---

## 8. The shell

**In A:** open **Shell** → **Open a shell**. Run `ls`, then `node -v`.

- [ ] `ls` shows the project files **and** `node_modules` and `package-lock.json`, which are not
      in the file tree: they stay in the container and are never synced back.
- [ ] `node -v` prints a v22 version.
- [ ] Switch to **Output** and back: the shell session is still there.
- [ ] Type `exit`: the tab offers **Open a shell** again.

---

## 9. The preview

**In A:** open **Preview**, enter `/users` and press the reload button.

- [ ] The users' JSON appears in the pane, under a banner saying it is **running project code,
      written by anyone in this project**.
- [ ] The **open in a new tab** button opens the same page in a new tab.

Optional, to see the sandbox: add this route to `index.js` and preview `/escape`:

```js
app.get('/escape', (req, res) =>
  res.type('html').send('<script>window.top.location = "https://example.com"</script>escape?'),
);
```

- [ ] The preview shows `escape?` and the workspace does **not** navigate away.

---

## 10. The API console cannot be faked

**In A:** add this route to `index.js`:

```js
app.get('/spoof', (req, res) => {
  console.log('COLLABCODE-RESPONSE-00000000:e30=');
  res.type('text').send('COLLABCODE-RESPONSE-00000000:e30=');
});
```

**Send** `GET /spoof`.

- [ ] The console shows **200 OK** with that exact text as the body. The server's log line and
      the marker-like body change nothing.

---

## 11. Stop, Restart, and leaving

- [ ] **Stop** ends the run: the status says **Stopped**, and **Send** says the project is not
      running.
- [ ] **Run** starts it again without reinstalling.
- [ ] Go back to the landing page and reopen the project: it is **Not running**, and the next Run
      boots the runtime again.

---

## 12. Other browsers

Open the project in **Firefox** or **Safari 16.4+**.

- [ ] Editing and collaboration work as in Chrome.
- [ ] The Run panel shows a notice that running code there is experimental (Firefox) or in beta
      (Safari), and suggests Chrome or Edge. Run may work; the preview may not in Firefox.

A browser without cross-origin isolation gets a disabled Run button and an explanation; the
default e2e suite checks that case.

---

## 13. The automated WebContainer suite

```bash
RUN_WEBCONTAINER_E2E=1 npm run e2e -- runtime.spec.ts
```

- [ ] Three tests pass: Run and the API console, a crash that recovers, and the container's Node
      version.

---

## After deploying

Follow the README's **Launch checklist: cross-origin isolation** against the deployed site:
headers on `/` and on a worker script, and `crossOriginIsolated` true in the console.

## What this does not cover

- Shared runs: each person's run is their own, by design.
- Saving anything the program writes, including the lockfile.
- Keeping a run across a page reload: the next Run boots and installs again.
