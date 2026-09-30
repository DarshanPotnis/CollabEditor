# 015: Behind Render, the client is CF-Connecting-IP, checked against X-Forwarded-For

- Status: accepted (replaces "the first X-Forwarded-For entry" in PLAN-AI.md §6.1)
- Date: 2026-09-30
- Phase: launch

## Context

The per-IP limits (project creation, and the shared AI tier's per-visitor allowance and per-minute
limit) key on the visitor's address. The server sits behind Cloudflare and two Render hops, so the
socket address is a proxy's. The rule was that Render sets the first `X-Forwarded-For` entry to the
client, which a Render staff reply states. The launch check showed otherwise: every forged leftmost
entry got a fresh allowance.

A temporary endpoint (PR #6) described the headers the server receives, reducing every address to
its kind, with no address in the output. Probed on 2026-09-30 with forged values from the
documentation ranges:

- `X-Forwarded-For` is always `<the client's own entries…>, <client>, <public hop>, <private hop>`.
  The proxies only append, so the client is third from the right however many entries it sent.
- `CF-Connecting-IP` and `True-Client-IP` hold the client. A forged `True-Client-IP` is overwritten.
  A request carrying its own `CF-Connecting-IP` is refused by Cloudflare (403, "error code: 1000")
  and never arrives. Forged `X-Real-IP` and `CF-Connecting-IPv6` are removed.

## Decision

`CLIENT_IP_SOURCE=render` takes `CF-Connecting-IP` only when it equals the `X-Forwarded-For` entry
third from the right (`RENDER_HOPS_AFTER_CLIENT = 2` hops after it). When they differ, or either
is missing, the request is keyed by its socket address: the proxy's, one allowance shared by every
visitor. The server then logs a warning once per process, with the reason and no address. The
diagnostic endpoint is removed.

## Alternatives

- **The leftmost `X-Forwarded-For` entry.** The client writes it.
- **`CF-Connecting-IP` alone.** Right today, but if Cloudflare ever let a client's own value through,
  or left the path, a client could choose its allowance and nothing would notice.
- **`X-Forwarded-For` counted from the right alone.** Right today, but the entry moves if Render
  adds or removes a hop; one hop fewer and it is the client's own last entry.
- **Express `trust proxy: N`.** The same hop counting, applied to `req.ip`, with nothing to check it
  against.
- **Also require the hop after the client to be a Cloudflare address**, from Cloudflare's published
  ranges. That would refuse requests reaching Render without Cloudflare, but the ranges change, and a
  stale copy would put every visitor in the shared allowance. Not built; the launch checklist checks
  that Cloudflare still refuses a forged `CF-Connecting-IP` instead.

## Consequences

- Forged `X-Forwarded-For`, `True-Client-IP` and `X-Real-IP` values change nothing. The unit and
  integration tests forge each, and a forged `CF-Connecting-IP` that somehow arrived lands in the
  shared allowance.
- A hosting change that breaks either source fails closed. Every visitor then shares the proxy's
  allowance, which runs out quickly and visibly, and the warning says why. The README's launch
  checklist re-checks: forged headers, Cloudflare's refusal, a phone on another network, and no
  warning in the logs.
- The one case this cannot catch is a request that reaches Render's load balancer without passing
  Cloudflare. It could set both sources to agree. Render documents no such path, and Cloudflare
  refusing a forged `CF-Connecting-IP` shows requests to the service's address do pass it. If that
  refusal ever stops, set `CLIENT_IP_SOURCE=direct` until this is revisited.
