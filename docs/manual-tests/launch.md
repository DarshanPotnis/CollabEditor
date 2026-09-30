# Launch: checks on the live deployment

The monorepo first went live on 2026-09-29 (`main` at `618f840`, PR #5): the web app at
`https://collab-editor-chi.vercel.app`, the server at `https://collabeditor-backend.onrender.com`,
the database on Neon's `production` branch. These are the README's launch checklists run against
it, what failed, and the test data the checks left in production.

## 1. Results, 2026-09-29 (`618f840`)

| Check                                             | How                                                                                                  | Result                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Render deploy                                     | `/health`                                                                                            | Pass: `{"ok":true}`; the build's migration step ran |
| Vercel deploy                                     | GitHub deployment status of `618f840`                                                                | Pass                                                |
| Isolation headers on the page                     | `curl -sI /`                                                                                         | Pass: `same-origin` / `require-corp`                |
| Isolation headers on the workers                  | `curl -sI` on `editor.worker`, `json.worker`, `ts.worker`                                            | Pass                                                |
| `crossOriginIsolated`, workers running            | `e2e/isolation.spec.ts` against the live site                                                        | Pass (3 tests)                                      |
| Client IPs behind Render                          | Two project creations with different forged `X-Forwarded-For` addresses                              | **Fail**: see 2.1                                   |
| AI answers stream through Render                  | One `explain-selection` request, each `data:` line timed                                             | Pass: 6 chunks from 0.87 s to 1.40 s, not buffered  |
| No `Origin` on the AI route                       | `POST /api/ai/step` without `Origin`                                                                 | Pass: 403                                           |
| Foreign `Origin`                                  | Project creation and AI step from `https://example.com`                                              | Pass: 403 both                                      |
| Two windows: cursors                              | `collaboration.spec.ts` "a named, coloured cursor…" against the live site                            | Pass                                                |
| Two windows: create, run, edit from both, preview | `runtime.spec.ts` "Express: Run, call it, edit it…" against the live site, real WebContainer         | Pass                                                |
| "Watch a demo", live replay                       | `runtime.spec.ts` "Watch a demo replays the recording live…"                                         | **Fail**: see 2.2                                   |
| Secrets in Render's logs                          | Render's log search for `AIza`, `postgres`, `npg_`, `GEMINI_API_KEY`; the start-up line's `sharedAi` | By the owner, in Render's dashboard                 |

The live-site runs used the repo's own specs with a config pointing `baseURL` at the site and no
local servers, one test at a time, `RUN_WEBCONTAINER_E2E=1`. The AI checks spent two shared-tier
requests.

## 2. Failures

### 2.1 Forged client addresses get their own rate-limit buckets

Every different forged leftmost `X-Forwarded-For` address started a fresh count (`r=19`), while
the same forged address twice counted down like a real one. Render appends to the header rather
than replacing its first entry, which is what `apps/server/src/http/client-ip.ts` assumed, so the
per-visitor limits (project creation, the shared AI tier's daily allowance) could be sidestepped.
The global AI limits still held.

Fix: `GET /debug/proxy-headers` (PR #6, temporary) shows which header or right-hand position
Render's proxies set; the fix reads that, never the leftmost entry or a header the client can set.
Then: the spoof check again with forged `X-Forwarded-For`, `CF-Connecting-IP` and `True-Client-IP`,
and the check from a phone on mobile data.

### 2.2 "Watch a demo" refused a Play clicked before the project loaded

The spec clicked Play right after the demo project opened and got "This recording was made on the
express-api template, and this project is not from a template." The session existed before the
document's first sync, and the replay checked the empty document. Clicking after the sync, the
live replay passed in 20 s: four checks verified again, no AI request.

Fix: PR #7. Play reads "Connecting…" and is disabled until the first sync;
`e2e/replay.spec.ts` delays the first sync to reproduce it.

## 3. Test projects in production

The checks above, and one manual "Watch a demo", created these 15 projects on 2026-09-29 between
23:25 and 23:31 UTC. They are test data; delete exactly these IDs.

| IDs                                                                                            | Created by                                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `c6xqmaa2atz5`, `8rw379dhde68`, `7bxnrsrs7n3z`, `k23jcukmuesz`, `cvxua8rjiyy2`, `pzpqmxvyb7i7` | The client-IP probes (`blank-node`)                                    |
| `sxgdctny3pe9`                                                                                 | The AI streaming and `Origin` checks (`blank-node`)                    |
| `wk9xnqusqxfv`                                                                                 | A manual "Watch a demo" (Demo — DELETE endpoint)                       |
| `mzezn744yy6n`, `uiwttr67svpw`, `dm9akh2pqmei`, `eybzvr2jcpky`, `uiftyhxsy9xf`, `qdcgyiamzsr3` | The live-site Playwright run (4 `blank-node`, 1 `express-api`, 1 demo) |
| `3npurgv8mwbr`                                                                                 | The demo replayed after the first sync (Demo — DELETE endpoint)        |

In Neon's SQL editor, on the `production` branch. First check that the list matches 15 rows:

```sql
select id, name, template, created_at
from projects
where id in (
  'c6xqmaa2atz5', '8rw379dhde68', '7bxnrsrs7n3z', 'k23jcukmuesz', 'cvxua8rjiyy2',
  'pzpqmxvyb7i7', 'sxgdctny3pe9', 'wk9xnqusqxfv', 'mzezn744yy6n', 'uiwttr67svpw',
  'dm9akh2pqmei', 'eybzvr2jcpky', 'uiftyhxsy9xf', 'qdcgyiamzsr3', '3npurgv8mwbr'
)
order by created_at;
```

Then delete them; it returns the IDs it deleted:

```sql
delete from projects
where id in (
  'c6xqmaa2atz5', '8rw379dhde68', '7bxnrsrs7n3z', 'k23jcukmuesz', 'cvxua8rjiyy2',
  'pzpqmxvyb7i7', 'sxgdctny3pe9', 'wk9xnqusqxfv', 'mzezn744yy6n', 'uiwttr67svpw',
  'dm9akh2pqmei', 'eybzvr2jcpky', 'uiftyhxsy9xf', 'qdcgyiamzsr3', '3npurgv8mwbr'
)
returning id;
```

A deleted project's link then shows "The server refused this project". A tab still open on one
cannot bring it back: the server saves with an `update`, which finds no row.
