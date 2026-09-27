# 003: Hocuspocus owns the HTTP server, Express is mounted inside it

- Status: accepted
- Date: 2026-09-26
- Phase: 1

## Context

`docs/PLAN.md` §8.2 assumed the usual Node arrangement: create an `http.Server` around an
Express app, then attach a WebSocket server to its `upgrade` event and route `/collab` to
Hocuspocus. That is how `@hocuspocus/server` v1 worked.

The installed version is **4.7.0**, and it does not work that way. `Server` creates its own
`http.Server` in its constructor and wires the upgrade handling to an internal `crossws`
instance:

```js
this.httpServer = createServer(this.requestHandler);
this.crossws = crossws({ serverOptions: this.configuration.websocketOptions, hooks: { ... } });
this.setupHttpUpgrade();
```

There is no configuration option to supply an existing server, and `httpServer` is assigned
before any user code runs. Render gives us one port, so the REST API and the WebSocket endpoint
have to share it.

Two related facts from the same source read:

- `requestHandler` runs the `onRequest` hooks and then, if none of them threw, writes its own
  `"Welcome to Hocuspocus!"` response. It catches rejections and rethrows only truthy ones:
  `catch (error) { if (error) throw error; }`.
- Every upgrade goes to `crossws` unless an `onUpgrade` hook stops the chain first — the path is
  not checked.

## Decision

Let Hocuspocus own the server, and mount Express inside it.

```ts
const httpMount: Extension = {
  onRequest({ request, response }) {
    app(request, response); // Express owns the response from here
    return stopHookChain();
  },
  onUpgrade({ request, socket }) {
    const path = (request.url ?? '').split('?')[0];
    if (path === COLLAB_PATH) return Promise.resolve();
    if (socket instanceof Socket) socket.destroy();
    return stopHookChain();
  },
};
```

`stopHookChain()` returns `Promise.reject()` with **no value**. A falsy rejection stops the hook
chain without Hocuspocus rethrowing it, which is its convention for "this hook handled the
request". It is the one place in the codebase that rejects with a non-Error, and it carries a
comment and a scoped lint exception saying why.

`stopOnSignals: false` is set for a related reason: Hocuspocus's own signal handler calls
`process.exit(0)` immediately after `destroy()`, which would kill the process before the Postgres
pool closed. We install our own handler instead.

## Alternatives

**Two ports.** Express on one, Hocuspocus on another. Render's free web service exposes a single
port, so this would mean two services — and the free tier sleeps each independently, doubling
cold starts for a project that needs both.

**A reverse proxy in front.** Another moving part and another deploy, to solve a problem one hook
solves.

**Pin `@hocuspocus/server` v1** so the plan's arrangement works. Rejected: staying on an
unmaintained major to preserve a wiring detail is the wrong trade, and v4's session multiplexing
and unauthenticated-queue limits are worth having.

**Run Express as the owner and call `hocuspocus.handleConnection`.** `Hocuspocus` does expose
`handleConnection(websocket, request)`, so in principle we could run our own `ws` server. That
means reimplementing what `Server` and `crossws` already do — upgrade handling, ping/pong
timeouts, close bookkeeping — and keeping it in step with a library that has changed this area
between majors. Rejected as more code with a larger compatibility surface.

## Consequences

- The composition reads backwards from the usual Node app: the collab server is the entry point
  and the web framework is a hook. `apps/server/src/collab/server.ts` says so at the top.
- Express never calls `listen`. It is built as a plain request handler, which also makes it
  trivial to test.
- Anything Express does not route returns our 404 shape rather than Hocuspocus's welcome text —
  there is an integration test asserting the string "Hocuspocus" does not appear at `/`.
- WebSocket upgrades outside `/collab` get their socket destroyed instead of reaching the Yjs
  layer.
- We depend on an undocumented-ish convention (falsy rejection). If a future Hocuspocus major
  changes it, the symptom is loud and immediate: every request would get "Welcome to Hocuspocus!"
  and the integration tests fail on the first run.
- The renumbering: this ADR took the number the plan had reserved for Phase 2's "stable IDs and
  read-time resolution", which becomes 004. Phase 3's ADRs shift to 005 and 006.
