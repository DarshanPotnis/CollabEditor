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
| Client IPs behind Render                          | Two project creations with different forged `X-Forwarded-For` addresses                              | **Fail**, then fixed and passed: see 2.1            |
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

`GET /debug/proxy-headers` (PR #6, temporary, `58bc46b`) described the headers the server
receives, every address reduced to its kind. Seven probes on 2026-09-30, with forged values from
the documentation ranges:

| Forged                                  | What arrived                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Nothing                                 | `X-Forwarded-For`: client, public hop, private hop. `CF-Connecting-IP` = `True-Client-IP` = the client |
| `X-Forwarded-For`, one entry            | The forged entry, then the same three: the client still third from the right                           |
| `X-Forwarded-For`, two entries          | Both forged entries, then the same three                                                               |
| `CF-Connecting-IP`                      | Nothing: Cloudflare refused the request (403, "error code: 1000")                                      |
| `True-Client-IP`                        | Overwritten with the client                                                                            |
| `X-Real-IP`                             | Removed                                                                                                |
| All together, plus `CF-Connecting-IPv6` | Refused by Cloudflare (for `CF-Connecting-IP`); `CF-Connecting-IPv6` alone is removed                  |

Fix (ADR 015): `render` takes `CF-Connecting-IP` only when it is also the `X-Forwarded-For` entry
third from the right, and otherwise the proxy's address, shared by everyone, with a warning logged
once. It removes the diagnostic.

Re-checked on `874817a` (PR #11), where `/debug/proxy-headers` answers 404:

| Check                                                                                                        | Result                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Creations with nothing forged, then forged `X-Forwarded-For` (one entry, two), `True-Client-IP`, `X-Real-IP` | Pass: one allowance, `r=19, 18, 17, 16, 15` |
| Forged `CF-Connecting-IP` with a matching forged `X-Forwarded-For`                                           | Pass: 403 from Cloudflare                   |
| A second network: a GitHub Actions runner                                                                    | Pass: see below                             |
| No `client address headers not trusted` line in Render's logs                                                | By the owner, in Render's dashboard         |

The second network replaced the phone check. A temporary workflow on a branch of its own
(never merged, then deleted; Actions run `36801382393`) waited for an agreed second and created two
projects from a GitHub-hosted runner, while this machine created projects either side of it:

| Time (UTC, 2026-10-01) | From                    | `RateLimit` `r=`           |
| ---------------------- | ----------------------- | -------------------------- |
| 01:35:12–13            | This machine, 4 created | 19, 18, 17, 16             |
| 01:35:41               | The runner, 2 created   | **19, 18**: its own, fresh |
| 01:35:55               | This machine, 1 created | 15, in the same minute     |

Had either side fallen back to the proxy's shared address, the runner would have started near 15.

### 2.2 "Watch a demo" refused a Play clicked before the project loaded

The spec clicked Play right after the demo project opened and got "This recording was made on the
express-api template, and this project is not from a template." The session existed before the
document's first sync, and the replay checked the empty document. Clicking after the sync, the
live replay passed in 20 s: four checks verified again, no AI request.

Fix: PR #7. Play reads "Connecting…" and is disabled until the first sync;
`e2e/replay.spec.ts` delays the first sync to reproduce it. Re-checked on `58bc46b`
(2026-09-30): the unchanged live spec passed in 22.5 s.

## 3. Test projects in production

The checks above, and one manual "Watch a demo", created these 28 projects: 15 on 2026-09-29
between 23:25 and 23:31 UTC, one on 2026-09-30 re-checking the demo, and 12 re-checking the
client-IP fix (2026-09-30 and 2026-10-01). They are test data; delete exactly these IDs.

| IDs                                                                                            | Created by                                                             |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `c6xqmaa2atz5`, `8rw379dhde68`, `7bxnrsrs7n3z`, `k23jcukmuesz`, `cvxua8rjiyy2`, `pzpqmxvyb7i7` | The client-IP probes (`blank-node`)                                    |
| `sxgdctny3pe9`                                                                                 | The AI streaming and `Origin` checks (`blank-node`)                    |
| `wk9xnqusqxfv`                                                                                 | A manual "Watch a demo" (Demo — DELETE endpoint)                       |
| `mzezn744yy6n`, `uiwttr67svpw`, `dm9akh2pqmei`, `eybzvr2jcpky`, `uiftyhxsy9xf`, `qdcgyiamzsr3` | The live-site Playwright run (4 `blank-node`, 1 `express-api`, 1 demo) |
| `3npurgv8mwbr`                                                                                 | The demo replayed after the first sync (Demo — DELETE endpoint)        |
| `kyeruumxz5xd`                                                                                 | The demo re-check on `58bc46b` (Demo — DELETE endpoint)                |
| `thkk2be5xmj8`, `xdy5rv7bbfaa`, `nye9gdbgqkhi`, `ysnvfhy7yx2y`, `ta9ygwbgg2tn`                 | The README's client-IP checklist on `874817a` (`blank-node`)           |
| `fuecvb4isymy`, `peeqmxietdek`, `zyiieaev366a`, `8qnn6ccp8nax`, `upa9z54kemng`                 | The second-network check, this machine's side (`blank-node`)           |
| `wr2vrqc4yzkg`, `zm8mxsz5ccja`                                                                 | The second-network check, the runner's side (`blank-node`)             |

In Neon's SQL editor, on the `production` branch. First check that the list matches 28 rows (or
fewer, if some were deleted already):

```sql
select id, name, template, created_at
from projects
where id in (
  'c6xqmaa2atz5', '8rw379dhde68', '7bxnrsrs7n3z', 'k23jcukmuesz', 'cvxua8rjiyy2',
  'pzpqmxvyb7i7', 'sxgdctny3pe9', 'wk9xnqusqxfv', 'mzezn744yy6n', 'uiwttr67svpw',
  'dm9akh2pqmei', 'eybzvr2jcpky', 'uiftyhxsy9xf', 'qdcgyiamzsr3', '3npurgv8mwbr',
  'kyeruumxz5xd', 'thkk2be5xmj8', 'xdy5rv7bbfaa', 'nye9gdbgqkhi', 'ysnvfhy7yx2y',
  'ta9ygwbgg2tn', 'fuecvb4isymy', 'peeqmxietdek', 'zyiieaev366a', '8qnn6ccp8nax',
  'upa9z54kemng', 'wr2vrqc4yzkg', 'zm8mxsz5ccja'
)
order by created_at;
```

Then delete them; it returns the IDs it deleted:

```sql
delete from projects
where id in (
  'c6xqmaa2atz5', '8rw379dhde68', '7bxnrsrs7n3z', 'k23jcukmuesz', 'cvxua8rjiyy2',
  'pzpqmxvyb7i7', 'sxgdctny3pe9', 'wk9xnqusqxfv', 'mzezn744yy6n', 'uiwttr67svpw',
  'dm9akh2pqmei', 'eybzvr2jcpky', 'uiftyhxsy9xf', 'qdcgyiamzsr3', '3npurgv8mwbr',
  'kyeruumxz5xd', 'thkk2be5xmj8', 'xdy5rv7bbfaa', 'nye9gdbgqkhi', 'ysnvfhy7yx2y',
  'ta9ygwbgg2tn', 'fuecvb4isymy', 'peeqmxietdek', 'zyiieaev366a', '8qnn6ccp8nax',
  'upa9z54kemng', 'wr2vrqc4yzkg', 'zm8mxsz5ccja'
)
returning id;
```

A deleted project's link then shows "The server refused this project". A tab still open on one
cannot bring it back: the server saves with an `update`, which finds no row.
