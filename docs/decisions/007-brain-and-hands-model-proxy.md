# 007: The brain and the hands, with a stateless model proxy

- Status: accepted
- Date: 2026-09-28
- Phase: AI-1

## Context

CollabCode is getting an AI teammate (docs/PLAN-AI.md). AI-1 ships the first two helpers, Explain
or Edit a selection and Explain a crashed run, and lays the pipe that AI-2's agent will use.

Four constraints shape it:

- The server syncs and stores and **never runs user code** (ADR 006). The live document and the
  running project exist only in each person's browser.
- Infrastructure costs nothing. The only model access is Google's free Gemini tier, about 500
  requests a day per Google Cloud project, plus whatever key a visitor brings.
- A key must never leak. The server's key must never reach a browser, and a visitor's key must
  never be stored or logged.
- AI-4's evals must run the agent's core in Node, without a browser.

## Decision

**The model is the brain; the browser is the hands.** The model decides what to do next, and
everything it acts on (the `Y.Doc`, the WebContainer, the editor) lives in the browser. The server
places each model call and keeps nothing between calls.

- **`POST /api/ai/step` is stateless.** Every call carries everything the model needs; there is no
  session on the server. AI-2 will add tool definitions and a conversation to the same request and
  a `tool-call` event to the same stream.
- **Prompts are owned by the server** (`packages/shared/src/ai/prompts/`). A request names a
  prompt and sends its inputs, and there is no field for a system prompt, so the shared key is not
  a general-purpose relay. Each prompt has an id, a version and a zod schema that caps every field.
  A fingerprint test fails CI if a prompt changes without a version bump, so `id@version` always
  means the same prompt in the app and in evals.
- **Provider layer: the Vercel AI SDK (`ai` 7), server-side only, behind our own
  `ModelGateway`.** Only `ai-sdk-gateway.ts` imports the SDK. Four guardrails:
  - provider instances are always passed, because a plain string model id silently routes through
    Vercel's gateway;
  - telemetry is off on every call, because the SDK otherwise publishes to a Node diagnostics
    channel;
  - `maxRetries: 0`, because the default of 2 could spend three free requests on one click;
  - a provider error is reduced to `{ failure, statusCode }` before anything logs it, because the
    SDK's errors carry the whole prompt.
- **Our own stream protocol, over `fetch`.** The server sends `data: <json>` lines (`text-delta`,
  then one `finish` or `error`). The browser reads them with `fetch` and validates every event with
  zod. It does not use `EventSource`, which can only GET and cannot send a key header, and it does
  not use the SDK's UI stream, which would tie the browser (and AI-2's agent core) to the SDK. The
  HTTP status is committed on the model's first event, so a refused key or an exhausted quota is a
  plain HTTP error; a failure after that ends the stream with an `error` event. A client that
  disconnects aborts the model call, and every call has a 90 s limit.
- **Two ways to pay.**
  - **The shared tier** uses the server's Gemini key, with limits counted in memory: 400 a day
    for everyone (80% of the free 500), 30 per visitor, 60 per project, and 12 in any rolling
    minute for everyone together (80% of the free 15 RPM). Days follow Pacific time, when Google
    resets. The minute limit is checked before the daily ones and recorded only once they accept.
    A request Google refuses for rate or quota reasons before answering is refunded.
  - **Bring your own key:** Gemini, Anthropic or OpenAI, with the model chosen from a short
    allowlist. The key is kept in the tab's `sessionStorage` and sent only in the `x-ai-key`
    header. The server uses it for one provider instance and never stores or logs it. A log canary
    test sends a known key and prompt through the success and failure paths and fails if either shows up in a log line.
- **The helpers use the hands the person already has.** An AI edit is applied through the
  file's Monaco model, so y-monaco writes it with the person's binding as origin and their undo
  covers it as one step. The selection is anchored with Yjs relative positions when it is chosen,
  and Apply refuses if a collaborator has changed that text since.

## Alternatives

**The browser calls providers directly with the person's key.** That would mean two code paths
(the shared key must stay on a server anyway), provider SDKs in the page bundle, and Anthropic's
explicit "dangerous direct browser access" opt-in. Rejected for now.

**Thin hand-written adapters per provider.** Three streaming parsers and three tool-call formats
to write and maintain. On top of that, Gemini 3 needs its "thought signatures" echoed back on
function calls, which the SDK already handles. That is the core of AI-2, so the SDK wins, fenced
behind `ModelGateway` so an upgrade touches one file.

**A stateful server session per conversation.** It would need storage and a cleanup story, and it
would tie AI-2's agent to our server; AI-4's evals must run it without one.

**Non-streaming first.** Streaming was verified end to end through the Express-inside-Hocuspocus
mount (ADR 003) before any code was written, and the client works even when a proxy delivers
the whole stream at once. Nothing was gained by waiting.

## Consequences

- **The limits live in one process.** A restart resets the counts, and a second instance would
  need a shared store, the same single-instance constraint as the documents (ARCHITECTURE.md).
- **The free tier carries helpers, not agents.** 400 requests a day is plenty for one-shot
  helpers, but only a handful of AI-2 sessions of up to 25 steps. Bring-your-own-key is the
  expected path for regular agent use, and evals need their own Google project.
- **Free-tier content may be used by Google** to improve its products. A one-time, versioned
  privacy notice says so before the first request, and so does the README.
- **Our server holds a person's own key in memory while it relays the call.** The settings dialog
  says so. A script running on our own origin (XSS) could read it from `sessionStorage`, which is
  one more reason model output is only ever rendered as text.
- **Streaming through Render's proxy is unverified** until deployment; the launch checklist
  covers it. The worst case is an answer that appears all at once, not a broken one.
- **Stack traces from the container are approximate.** WebContainer shifts ES-module line
  numbers, so Explain this error sends an ES module whole, without a crash line. AI-2's tools and
  prompt must treat those line numbers as untrusted (PLAN-AI.md §4, §5).
- **A Monaco diff editor needs care in the standalone build.** Disposing one leaves Monaco's
  global hover factory pointing at its disposed services, and every context menu then fails to
  open. The diff view restores the factory when it closes, and an end-to-end test pins it.
