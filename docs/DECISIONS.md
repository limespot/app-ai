# Decisions — app-ai

**Parent:** [../CLAUDE.md](../CLAUDE.md)

Architectural decisions for the worker, with rationale. Present-tense — each
entry describes the choice that stands and why, not a change history.

### 1. Plain JavaScript (ES modules), no TypeScript

The worker is small, dependency-free, and runs on the Workers runtime. JSDoc
covers types and editor hints without a build step or a type-checker in CI.
Keeps the toolchain to `wrangler` + `vitest` and the bundle to hand-auditable
JS. New code is JS with JSDoc; `@ts-*` directives and a `tsconfig` are not part
of the project.

### 2. GA 1-hour prompt cache on stable prefixes

Stable, reused prefixes carry `cache_control: { type: 'ephemeral', ttl: '1h' }`
(`EXTENDED_CACHE_CONTROL` in `lib/cache-control.js`): the `/messages` system
block + reused file attachments, the `/chat` `buildSystem` base block, and the
placement file-block prefix. The 1h TTL is GA — no beta header. A 1h write costs
2× base input and reads cost 0.1×, so it breaks even at ≥3 reuses; the cached
prefixes (system prompt, per-page screenshot/HTML) are reused far more often
than that across a session. Volatile per-call content (the `/chat` context
block, conversation turns) is left uncached or on the 5-minute default.

### 3. Effort lever is model-gated

`output_config.effort` is a real output-token control, but it is valid only on a
specific model set (`supportsEffort` in `lib/anthropic.js`: Fable 5, Opus
4.8/4.7/4.6/4.5, Sonnet 4.6). Sending it to a model that doesn't support it
(e.g. Haiku 4.5, Sonnet 4.5) returns a 400. The handlers gate on the resolved
model's capability and omit `output_config` otherwise, so a registry entry can
carry `effort` without risking a 400 on a model swap. Placement runs on Haiku
4.5, so it carries no `effort` — the guard would drop it regardless, and setting
it would be dead config.

### 4. No-filesystem `.md` text bundling

Prompt text lives in one `.md` file per prompt under `src/prompts/`; the
registry (`prompts.js`) imports each as a string. Workers have no runtime
filesystem, so the text is bundled at BUILD time, identically in both targets
with the same import specifier (no `?raw` suffix):

- **Worker** — the `[[rules]] type = "Text"` rule in `wrangler.toml` makes
  esbuild emit each `.md` as a text module.
- **Tests** — an inline Vite plugin in `vitest.config.js` does the same
  (`transform` turns `.md` into `export default "<contents>"`).

This keeps prompt wording out of JS (pure text, byte-for-byte) while staying
filesystem-free. A prompt needing runtime `${}` interpolation can't be a static
`.md` — that dynamic piece stays in JS.

### 5. KV dedup is a graceful no-op, with a 30-day TTL and an existence check

The Files API does not dedup by content — re-uploading identical bytes mints a
fresh `file_id`. `lib/file-dedup.js` hashes the bytes (SHA-256) and, when
`env.FILES_KV` is bound, reuses the stored `file_id` on a hash hit. Three
decisions:

- **Graceful no-op.** When the binding is absent, dedup falls back to a plain
  upload — the live path never depends on KV being provisioned.
- **30-day record TTL** (`KV_RECORD_TTL_SECONDS`). Files persist until explicitly
  deleted, so the record TTL is deliberately shorter than a file's lifetime: a
  mapping that outlives common churn (key rotation, manual cleanup) ages out on
  its own, and the TTL also bounds KV growth.
- **Live existence check.** On a KV hit the cached `file_id` is verified against
  the Files API metadata endpoint before reuse; a 404 drops the stale record and
  re-uploads, so dedup never vends a dead `file_id` that would 400 a later
  `/chat` request.

### 6. Single-`main` auto-deploy

There is one branch. Cloudflare's GitHub integration auto-deploys `main` to
production, so **pushing `main` is a production deploy**. There is no staging
environment and no manual deploy step in the normal flow. Commit locally;
docs/test-only changes are deploy-safe, but any push is live. `npx wrangler
deploy --dry-run` builds the bundle (verifying imports + the Text rule) without
deploying.

### 7. `{ error: { message } }` response shape, status mapped from the failure

Every error response is `{ error: { message } }` (Anthropic-compatible, so
clients parse worker errors the same way they parse Anthropic's), built by
`errorResponse` in `lib/responses.js`. Status mapping:

- The router (`index.js`) wraps each route in a try/catch. A thrown error —
  including a failed Brain context-ID validation (`lib/auth.js` throws on a
  missing ID, an unreachable Brain, or a non-2xx validate response) — becomes
  `errorResponse(message)`, which defaults to **HTTP 500** with
  `{ error: { message } }`. The message carries the underlying detail (e.g.
  `Context validation failed: 401 Unauthorized - ...`), so the upstream 401/403
  from Brain is preserved in the text, but the worker's own status is 500.
- `/files` upload preserves the upstream Anthropic status (a 500 also appends the
  Files-API-beta-access hint); a missing file is a 400.
- `handleMessages` passes Anthropic's own status + body through on a non-ok
  Anthropic response.

The single shape and the throw-to-500 mapping are a stated contract — handlers
do not invent per-route error envelopes.

### 8. Placement system prompt is left uncached on Haiku — by design

The placement system prompt (~370 tokens) is well under Haiku 4.5's minimum
cacheable prefix. A `cache_control` marker on it would be a silent no-op, and
padding it to clear the floor would cost more than it saves. The placement
caching win is the file blocks (thousands of tokens — they dwarf the system
prompt), not the system prompt. `buildSystem` still attaches the 1h marker to
the base block because chat/onboarding share that path and DO clear the floor
via `TOOL_DEFINITIONS`; on placement the marker is harmless (the API ignores an
unmet prefix) but genuinely inert.

### 9. File-block dedup + cache design

The placement flow uploads a screenshot + cleaned HTML via `/files`, referenced
as `fileIds` in `/chat`. Two cooperating mechanisms keep the cost down:

- **Cache.** `normalizeMessages` prepends the file blocks to the first user turn
  and marks the LAST file block with the 1h breakpoint, so the whole file prefix
  caches at 0.1× on the repeat call (prefix match). The breakpoint budget stays
  ≤4: 1 system + 1 file-prefix + ≤2 conversation (`applyConversationBreakpoints`
  drops its cap to 2 when a file prefix is present, and reserves the file-prefix
  head blocks so they aren't stripped or recounted).
- **Dedup.** Same-page reuse maps to the same `file_id` via the `/files`
  content-hash dedup, so the same bytes hit the same cache entry across calls.
- **Block typing.** Each `fileId` is resolved to an `image` block (mime
  `image/*`) or a `document` block by its Files API metadata. Images MUST be
  `image` blocks — Anthropic 400s an image inside a `document` block, which is
  exactly the placement screenshot. A metadata-lookup failure falls back to
  `document`.

This is verified live by the token-savings gate (see [TESTING.md](TESTING.md)).
