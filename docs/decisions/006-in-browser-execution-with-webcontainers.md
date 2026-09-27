# 006: Run projects in the browser with WebContainers

- Status: accepted
- Date: 2026-09-27
- Phase: 3

## Context

People want to run the Node backend they are writing together and call its endpoints. The
project has two hard constraints: infrastructure costs nothing, and **the server syncs and stores
but never runs user code**. Running arbitrary, collaborator-written code on our server would
break both: it costs compute, and it turns every project into a way to attack the host.

## Decision

**Each person runs the project in their own browser tab, in a WebContainer**
(`@webcontainer/api` 1.6.4): Node, npm and a shell compiled to run in the browser, provided by
StackBlitz. Nothing runs until that person clicks Run, and each person's run is separate.

- **Boot** on the first Run, not when a project opens; one container per page (the API allows no
  more); torn down when the person leaves the workspace. The API client (4.6 kB gzipped) and
  xterm (84 kB) load on that first Run only.
- **Cross-origin isolation.** WebContainers need `SharedArrayBuffer`, so every response carries
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, and
  the container boots with the matching `coep: 'require-corp'`. Not `credentialless`: we load no
  cross-origin resources that would need it, and Safari does not implement it, so Safari could
  never be isolated.
- **Files** flow one way, from the Y.Doc into the container (ADR 005).
- **Runs**: `npm install` when the dependency sections of `package.json` changed, then the `dev`
  script, else `start`. The templates use `node --watch`, so edits restart the server; a crashed
  run restarts itself when the next file syncs.
- **API console**: requests are made inside the container by a small helper started with
  `node -e`, so CORS never applies. Its answer is read only from its own process output, as one
  base64 line behind a per-request nonce, so nothing the server logs or returns can fake a
  response.
- **Preview**: an iframe sandboxed to `allow-scripts allow-same-origin allow-forms`. The page it
  shows lives on a StackBlitz origin, never ours; `allow-same-origin` is needed because previews
  are served by a service worker on that origin.

## Cost and licence

$0 for us. The npm package is MIT, but it relies on StackBlitz-hosted services, and using it
means accepting StackBlitz's Terms of Service. Their commercial-usage page says a licence is
required "for production usage of the API in a commercial, for-profit setting", and that
"prototypes or POCs do not require a commercial license"; their launch post calls the API free
for open-source use. CollabCode is a non-commercial open-source project, so it needs no licence
or API key. If that ever changes, a licence and `configureAPIKey` would be required first.

## Browser support

| Browser                      | Status (StackBlitz)          | In CollabCode                                                                                                         |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Chrome, Edge, other Chromium | Supported                    | Runs. Blocking third-party cookies can stop the runtime, which lives in a `stackblitz.com` iframe; the error says so. |
| Safari 16.4+                 | Beta                         | Runs, with a notice. Older Safari lacks `Atomics.waitAsync`.                                                          |
| Firefox                      | Alpha; previews may not load | Runs, with a notice. The API console does not need the preview.                                                       |
| No cross-origin isolation    | Cannot run                   | Run is disabled with an explanation; editing is unaffected.                                                           |

## What runs where

| Where                                                    | What                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Our page (our origin)                                    | React, Yjs, Monaco, the FS bridge, the terminal and console UIs                                      |
| StackBlitz's iframe and workers, in the person's browser | Node 22, npm, the project's server, the request helper, the shell                                    |
| StackBlitz's servers                                     | The runtime code (`stackblitz.com/headless`, `*.staticblitz.com`), npm install through their proxies |
| Our server                                               | Nothing new. It still only syncs and stores.                                                         |

The container's Node is **22** (22.22 when this was written) while the repository uses 24. The
templates declare `engines: { node: ">=22" }`, and CI runs the request helper's integration test
on Node 22 as well.

## Sandboxing

**Protected.** Project code runs on a StackBlitz origin in iframes and workers. It cannot read
our page, the Y.Doc, localStorage, cookies or the person's identity; it cannot reach their file
system; nothing runs on our server; and the preview cannot navigate the workspace, open windows or
show dialogs (verified against a real preview). Response bodies, headers and terminal output are
only ever rendered as text, and nothing in terminal output becomes a link. `xdg-open` and `code`
events from the container are ignored, so a program cannot open URLs or files.

**Not protected.** Code a collaborator wrote can use the person's CPU, memory and battery (Stop
and leaving the page end it); `npm install` runs whatever packages `package.json` lists, including
their install scripts, inside the same sandbox; it can make HTTP requests from the person's
browser and IP, within CORS rules, including to local network services that allow it (Chrome's
local network access checks narrow this); and the preview can show anything, including a fake
login form, which is why the pane says it is running project code. Project code and the packages
it installs are handled by StackBlitz's infrastructure under their terms.

## Alternatives

**Execution on our server** (containers, Firecracker, a sandboxed Node). Costs money per run,
needs real isolation engineering to host untrusted code safely, and breaks the rule that the
server never runs user code. Rejected.

**Third-party execution APIs** (hosted sandboxes). Per-minute pricing and another account to
manage, for something WebContainers do at no cost.

**Bundler sandboxes** (for example Sandpack). Good for front-end previews, but they do not run a
Node server with `npm install`, and their Node emulation has its own licensing.

**No execution.** The workspace would be an editor only; the API console, the main demo for
backend work, would be impossible.

## Consequences

- COOP `same-origin` means our page cannot talk to windows it opens on other origins. Future
  sign-in or GitHub-push popups must use redirects instead.
- Any cross-origin asset added later needs CORS or `Cross-Origin-Resource-Policy`, or it will not
  load. The e2e suite runs isolated, so a broken asset shows up there.
- Running depends on StackBlitz being available. Editing and collaboration never do.
- Each person's first Run in a session boots the runtime (about 1.5 s) and installs dependencies
  (a few seconds for Express). Neither is cached across page loads.
- WebContainer's `spawn` processes backslash escapes inside arguments, which real Node does not.
  Anything passed as an argument, like the request helper's script, must avoid shell-special
  characters; a test enforces this for the helper.
- The WebContainer end-to-end tests need the network and StackBlitz, so they are opt-in
  (`RUN_WEBCONTAINER_E2E=1`) rather than part of CI. Everything else is tested with a fake
  container and runs in CI.
