# Known Issues — app-ai

**Parent:** [../CLAUDE.md](../CLAUDE.md)

Honest current limitations. Each entry is a present-state constraint, not a bug
to be ashamed of — most are deliberate trade-offs documented so a reviewer
isn't surprised.

## Active

### Placement system prompt is not cacheable on Haiku 4.5

The placement system prompt (~370 tokens) sits below Haiku 4.5's minimum
cacheable prefix, so it is left uncached. The caching win on the placement path
is the uploaded file blocks (thousands of tokens), not the system prompt.
Padding the prompt to clear the floor would cost more than it saves. See
[DECISIONS.md](DECISIONS.md) #8. Not a defect — a measured choice.

### `count_tokens` pre-flight is advisory only

`handlers/messages.js` calls the free `count_tokens` endpoint for large payloads
and logs the estimate (warning past a soft threshold). It NEVER gates or rejects
the live request — it is wrapped in try/catch and a failure is swallowed with a
log line. So a payload that would exceed the model's context window is not
blocked here; the live Messages call surfaces that as the real error. By design:
the pre-flight is observability, not a guard.

### Image-block typing adds a metadata GET per fileId

To choose `image` vs `document` for each `/chat` `fileId`, `buildFileBlock`
issues a Files API metadata GET per file (mime-type lookup). For the placement
flow that's typically two extra GETs (screenshot + HTML) per call. The cost is
small and the lookups run in parallel (`Promise.all`), but they are real extra
round-trips. A lookup failure falls back to `document`. This is the price of
sending images as `image` blocks (Anthropic 400s an image inside a `document`
block); the typing is not yet cached across calls within a session.

### Live token-savings gate requires manual credentials

`scripts/verify-caching.mjs` proves caching engages against the deployed worker,
but it needs a master `X-Personalizer-Context-ID` and a reachable target. It
cannot run in plain push-CI (no secrets) — it is a manual pre-release step, or a
`workflow_dispatch` job guarded on a repo secret. See [TESTING.md](TESTING.md).
This is an inherent property of integration-testing a deployed, authenticated
target, not a gap to close.

### Offline tests can't catch a silent cache invalidator

The unit/integration suite mocks `fetch`, so it verifies the worker _attaches_
`cache_control` breakpoints correctly — it cannot verify Anthropic actually
_reads_ from cache. Only the live gate catches a real silent invalidator (a
per-request byte sneaking into a cached prefix). Run the gate before a release
that touches `prompts/*.md`, the tool definitions, or any cache-control code.

### `FILES_KV` must be bound for dedup to be active

Content-hash dedup is LIVE only when `env.FILES_KV` is bound (it is, in
production — see `wrangler.toml`). If the binding is ever removed, dedup
gracefully no-ops to a plain upload: uploads keep working, but identical bytes
mint fresh `file_id`s and the placement file-block cache entry won't be shared
across calls (each upload is a distinct cache key). Not a failure mode — a
degradation that the code handles silently.
