# app-ai — Anthropic Proxy (Cloudflare Worker)

**CLAUDE.md Rule:** Any code change MUST update the CLAUDE.md of the affected folder (`src/handlers/CLAUDE.md`, `src/lib/CLAUDE.md`), then propagate the change up to this root file. If you add/rename a handler, lib module, prompt, or route, update the relevant section here AND the matching folder doc. Keep the documentation tree always valid.

A Cloudflare Worker that is a secure proxy in front of Anthropic. It holds the Anthropic API key, validates the merchant's `X-Personalizer-Context-ID` against the Brain backend, and proxies to Anthropic. Parts of it serve **production** (the live smart-image feature depends on `/files` + `/messages`).

## Project docs

Standalone-project documentation lives at the repo root and under `docs/`:

| Document                                     | Purpose                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| [README.md](README.md)                       | Quick start, endpoints, deployment, token-saving levers (with live-measured numbers) |
| [CONTRIBUTING.md](CONTRIBUTING.md)           | Commit convention, push-to-main deploy rule, validate-before-push loop               |
| [docs/TESTING.md](docs/TESTING.md)           | The four test layers (unit / integration / contract / live token-savings gate)       |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Numbered decision log with rationale                                                 |
| [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) | Honest current limitations                                                           |

Adding or renaming a `docs/*` file updates this table (propagation rule below).

## Documentation conventions

Two rules govern every `CLAUDE.md`, `README.md`, and code comment/JSDoc in this repo:

1. **CLAUDE.md propagation.** Any code change MUST update the affected folder's `CLAUDE.md` (`src/handlers/CLAUDE.md`, `src/lib/CLAUDE.md`), then propagate the change up to this root file. Adding/renaming a handler, lib module, prompt, or route updates the relevant section here AND the matching folder doc. Keep the documentation tree always valid.
2. **Current state only — no historical or chronological framing.** Docs and comments describe what the code IS, never what it was or how it got here. Do not write "previously", "now / no longer", "used to", "refactored from", "moved from X", "renamed", "preserved verbatim from the original", "behavior preserved", before→after comparisons, or any reference to a prior structure. A reader should learn only the current behavior. (Forward-looking operational status — KV provisioning steps, "needs live validation" notes — is current-state information and is allowed, phrased as present-tense state rather than a change log.)

## Tech / Constraints

- **Plain JavaScript (ES modules), no TypeScript.** JSDoc for types/clarity.
- Cloudflare Workers runtime (V8 isolates, Web-standard `fetch`/`Request`/`Response`/`FormData`) — **no Node.js, no runtime filesystem.**
- No production npm dependencies. Dev: `wrangler`, `vitest`.
- **The Anthropic API key never leaves the worker.** Only `src/lib/anthropic.js` reads `env.CLAUDE_API_KEY`.
- Deploy is automatic from `main` via Cloudflare's GitHub integration — **pushing `main` deploys to production.** Commit locally; do not push casually.

## Architecture

Entry/router → handlers → shared lib. The router is thin; all logic lives in `handlers/` and `lib/`.

```
src/
├── index.js              # Entry + router only: CORS, OPTIONS, context-ID auth, dispatch
├── handlers/             # Route handlers (see handlers/CLAUDE.md)
│   ├── health.js         # GET  /health (no auth)
│   ├── files.js          # POST/GET /files, DELETE /files/{id}
│   ├── messages.js       # POST /messages — single-shot proxy (LIVE smart-image)
│   └── chat.js           # POST /chat — Studio AI agent loop + SSE
├── lib/                  # Shared modules (see lib/CLAUDE.md)
│   ├── anthropic.js      # THE Anthropic client: files + messages + streaming + countTokens (headers/beta in one place)
│   ├── auth.js           # validateContextId() against Brain
│   ├── cors.js           # getCorsHeaders()
│   ├── responses.js      # jsonResponse() / errorResponse() — one { error: { message } } shape
│   ├── cache-control.js  # manageCacheControl() — the 4-block prompt-cache limit; EXTENDED_CACHE_CONTROL (1h TTL) const
│   ├── agent-cache.js    # applyConversationBreakpoints() — cache breakpoints on /chat conversation turns (≤3, ~15-block intervals)
│   ├── file-dedup.js     # dedupUpload() / sha256Hex() — Files API contentHash→file_id dedup (KV-backed LIVE, stale-id verify, 30d TTL, graceful no-op)
│   └── logger.js         # createLogger(scope) — scoped console.* (read via `wrangler tail`)
├── prompts.js            # System-prompt REGISTRY: name → { prompt, model, maxTokens, usesTools, description, attachments }
├── prompts/*.md          # Prompt TEXT (one .md per prompt; pure text, bundled at build time)
└── tools.js              # /chat tool definitions + Brain AI-tool dispatch
```

### Routes

| Method | Path          | Handler            | Auth |
| ------ | ------------- | ------------------ | ---- |
| GET    | `/health`     | `handleHealth`     | No   |
| POST   | `/files`      | `handleFileUpload` | Yes  |
| GET    | `/files`      | `handleListFiles`  | Yes  |
| DELETE | `/files/{id}` | `handleDeleteFile` | Yes  |
| POST   | `/messages`   | `handleMessages`   | Yes  |
| POST   | `/chat`       | `handleChat`       | Yes  |

Auth = the router calls `validateContextId(X-Personalizer-Context-ID, env)` for every non-`/health` route before dispatch; a throw becomes a 500 with the error message.

### The Anthropic client (`lib/anthropic.js`)

The single place that talks to `api.anthropic.com`. It owns the base URLs, `anthropic-version`, the `x-api-key` injection, and the beta flags:

- Files API calls send `anthropic-beta: files-api-2025-04-14`.
- Messages API calls send `anthropic-beta: prompt-caching-2024-07-31,files-api-2025-04-14`.

Exports: `uploadFile`, `listFiles`, `deleteFile`, `createMessage` (non-streaming), `streamMessage` (forces `stream: true`, returns the raw `Response` for the caller to read SSE), `countTokens` (POST `/messages/count_tokens` — free pre-flight estimate; forwards only count-accepted fields: model/system/messages/tools). No handler re-implements fetch/header logic.

### Token-saving levers (prompt caching, dedup, count_tokens, effort)

Cost-reduction is additive and never changes external request/response shapes.

**What caches, measured live (Opus 4.8 / Haiku 4.5):**

- **`/chat` + onboarding (Opus 4.8) cache.** The cached prefix is `tools` (TOOL_DEFINITIONS, ~6.4KB JSON) + the `buildSystem` base prompt block, ~1351 input tokens. A repeat call reads the full ~1351 from cache (`cache_read_input_tokens: 1351`, `input_tokens: 89`). The effective Opus-4.8 cacheable prefix is therefore ≤1351 tokens — the TOOL_DEFINITIONS block is what clears the floor (a tool-less prompt this small would not cache). The agent-loop conversation breakpoints (below) extend this to the growing turns.
- **Placement file blocks (Haiku 4.5) cache — the big win.** The placement flow uploads a screenshot + cleaned HTML via `POST /files`, referenced as `fileIds` in `POST /chat`. Those file blocks (thousands of tokens — they dwarf the ~370-token placement system prompt) carry a 1h breakpoint on the LAST block, so a repeat placement call on the same page reads them at 0.1× (`cache_read_input_tokens` > 0 on call 2). Same-page reuse maps to the same `file_id` via the `/files` content-hash dedup, so the bytes hit the same cache entry.
- **Placement _system_ prompt (~370 tokens) does NOT cache and is left uncached — by design.** It is well under Haiku 4.5's minimum cacheable prefix; a `cache_control` marker on it would be a silent no-op, and padding it to clear the floor would cost more than it saves. The placement win is the file blocks, not the system prompt. (`buildSystem` still attaches the 1h marker to the base block because chat/onboarding share that path and DO clear the floor via tools; on placement the marker is harmless — the API ignores an unmet prefix — but it is genuinely inert there.)

**The levers:**

- **Extended 1h prompt cache (`EXTENDED_CACHE_CONTROL` in `cache-control.js`).** The STABLE prefix uses `{ type: 'ephemeral', ttl: '1h' }` (GA — no beta header): `messages.js` system block + reused file-attachment blocks; `chat.js` `buildSystem` base prompt block (volatile context block stays uncached); the placement file-prefix block (last `fileIds` block); and the user blocks `manageCacheControl` KEEPS. Conversation turns use the 5-min default (short-lived).
- **Agent-loop breakpoints (`agent-cache.js`).** `runAgentLoop` calls `applyConversationBreakpoints(conversation, { maxBreakpoints, reservedHeadBlocks })` each iteration: strips stale breakpoints (except the reserved file-prefix head blocks), then re-applies last-block + intermediates every ~15 blocks so the 20-block lookback never misses. Budget ≤4 total: 1 system + (1 file-prefix when `fileIds` present, so `maxBreakpoints` drops to 2) + conversation; otherwise system + 3 conversation.
- **Files API checksum dedup (`file-dedup.js`) — LIVE.** `dedupUpload({content,mimeType,filename}, env)` SHA-256s the bytes; on `env.FILES_KV` hit it VERIFIES the cached `file_id` still exists (Files API metadata, `getFileMetadata`) before reuse — a 404 drops the stale record and re-uploads, so a dead id is never vended. Misses upload and store `hash → { fileId, createdAt }` with a 30-day TTL (`KV_RECORD_TTL_SECONDS`). Both `handlers/files.js::handleFileUpload` (the real screenshot/HTML path) and `messages.js` attachment upload route through it. `FILES_KV` is bound in production, so dedup is active; it GRACEFULLY NO-OPS (plain upload) if the binding is ever absent.
- **Image vs document block typing (`chat.js::buildFileBlock`).** Each `fileId` is resolved to `image` (mime `image/*`) or `document` by its Files API metadata. Images MUST be `image` blocks — Anthropic 400s an image inside a `document` block ("Only PDF and plaintext documents are supported"), which is exactly the placement screenshot. Lookup failure falls back to `document`.
- **count_tokens pre-flight.** `messages.js` best-effort logs an estimate (warns past a soft threshold) for large payloads — wrapped in try/catch, NEVER gates/rejects the live request.
- **Opt-in output effort (model-gated).** A registry entry MAY carry `effort: 'low'|'medium'|'high'|'xhigh'`. Handlers add `output_config: { effort }` only when the effort is set AND the resolved model supports it (`supportsEffort` in `lib/anthropic.js`): Fable 5, Opus 4.8/4.7/4.6/4.5, Sonnet 4.6. On any other model the worker omits it — `output_config.effort` returns a 400 on e.g. Haiku 4.5 / Sonnet 4.5. `chat.js` gates on the per-call model; `messages.js` gates on `claudePayload.model || entry.model` and only applies when the client hasn't already set `output_config`. No registry entry currently sets `effort` — `placement` runs on Haiku 4.5 (effort-unsupported), so it deliberately carries none.

### The `/chat` agent loop (`handlers/chat.js` + `tools.js`)

`POST /chat` runs the Anthropic tool-use agent loop:

```
model → (tool_use?) → execute Brain AI-tool → tool_result → model → …   (capped at MAX_ITERATIONS = 8)
```

streaming text out as it arrives. Response shape is chosen by `Accept`:

- `Accept: text/event-stream` → SSE protocol (events: `text`, `tool_call`, `tool_result`, `done`, `error`).
- otherwise → a single JSON object identical to the `done` payload.

`X-Personalizer-System-Prompt` selects the prompt (`chat` default, `onboarding`, `placement`). Per-prompt model / max_tokens / whether tools are sent all come from the prompt registry (see below) — not hardcoded in the loop. Tools (`tools.js`) call Brain's read-only AI-tool proxy (`/v2/ai-tools/*`) server→server, forwarding the merchant's context-ID. The frozen cross-repo contract is in the lib repo at `packages/storefront/src/admin/ai/CONTRACTS.md` (§1 SSE protocol, §2 tools).

### Prompt registry (`prompts.js` + `prompts/*.md`)

`prompts.js` is a thin registry mapping prompt name → metadata:

```
{ prompt, model, maxTokens, usesTools, description, attachments, effort? }
```

(`effort` is optional — see Token-saving levers above.)

It is the **single source of truth** for each prompt's model / token / tool choices — both `handlers/chat.js` (agent loop) and `handlers/messages.js` (system-prompt injection) read text + metadata from here. The prompt TEXT lives in a sibling `.md` file per prompt (`prompts/chat.md`, etc.) — pure text, no JS. `prompts.js` imports each `.md` as a string.

**Bundler text rule (no runtime fs):** `import x from './prompts/chat.md'` resolves to the file's string contents at BUILD time, in both targets with the SAME import specifier (no `?raw`):

- **Worker** — `[[rules]] type = "Text"` (`globs = ["**/*.md"]`) in `wrangler.toml` makes esbuild emit each `.md` as a text module.
- **Tests** — an inline Vite plugin in `vitest.config.js` does the same (`transform` turns `.md` into `export default "<contents>"`).

To add/edit a prompt: create/edit the `.md` file, add/update its registry entry in `prompts.js`. If a prompt needs runtime `${}` interpolation it can't be a static `.md` — keep that dynamic bit in JS.

> The repo-root `prompts/` directory (`prompts/image-selection/*.md`) is a prompt-authoring draft area — NOT imported, NOT bundled, NOT prettier-checked. The live prompt text the worker bundles lives only under `src/prompts/`. Don't confuse the two.

### Logging

`console.*` IS the observability mechanism (read via `wrangler tail`) — do not strip it. Use `createLogger(scope)` from `lib/logger.js` so each line is prefixed (`[Messages] …`) and a tail grep can isolate one subsystem.

## Commands

- `npm run dev` — local dev server (`wrangler dev --env dev`, port 8787)
- `npm test` — vitest (watch). One-shot: `npx vitest run`.
- `npx wrangler deploy --dry-run` — build the bundle without deploying (verifies imports + the Text rule)
- `npm run tail` — live production logs

## Tests (`test/`)

- `test/chat.test.js` — the `/chat` agent loop, SSE protocol, tool-use loop, MAX_ITERATIONS, placement no-tools path, non-streaming JSON, prompt selection.
- `test/proxy.test.js` — the proxy surface: CORS, response/error shape, context validation, the Anthropic client (headers/beta/URLs), `manageCacheControl`, and the `/files` + `/messages` + `/health` handlers.
- `test/token-saving.test.js` — the cost-reduction levers: 1h-TTL placement (system/context/kept user blocks), `applyConversationBreakpoints` (last-block, ~15-block intervals, cap + `reservedHeadBlocks`, stale-strip), `file-dedup` (sha256Hex vector, KV hit + stale-id verify/re-upload + miss + no-op, 30d TTL), `fileIds` document/image block typing + 1h file-prefix breakpoint + ≤4-breakpoint-with-file-prefix invariant, `countTokens` body/header, model+effort routing, and an end-to-end agent-loop breakpoint-count ≤4 assertion.

Tests mock `fetch` and `env` — no real network. Don't weaken assertions to pass.

A fourth layer, the **live token-savings gate** (`scripts/verify-caching.mjs`, `npm run verify:caching`), runs against the DEPLOYED worker — it needs a master context-ID + a reachable target, so it is OUT of `vitest run`. It asserts `cache_read_input_tokens > 0` on a repeat call for the chat tools+system prefix and the placement file-block prefix, and throws loudly (never silently skips) on a 0-read regression or missing creds. It is a required pre-release step. See [docs/TESTING.md](docs/TESTING.md).

## CI + deploy

- **CI** (`.github/workflows/ci.yml`) runs on every push + PR (Node 20): `npm run lint` → `npm run format-check` → `npx vitest run`. All three must be green. `lint`/`format-check` cover `src/**`, `test/**`, and root `*.js`/`*.cjs`/`*.json`/`*.md` (so README.md + this file are prettier-checked; the top-level draft `prompts/*.md` and `docs/*.md` are not). The `scripts/*.mjs` gate is outside the lint/format globs (it's an `.mjs` integration tool, not part of the worker bundle).
- **Caching gate workflow** (`.github/workflows/verify-caching.yml`) is a `workflow_dispatch` job guarded on the `APP_AI_CONTEXT_ID` repo secret — it runs the live token-savings gate against the deployed worker. The guard step exits cleanly when the secret is absent, so it never fails a fork or unconfigured repo, and it is never wired into the push/PR `build` job (which has no secrets). Otherwise the gate is the manual pre-release step (`npm run verify:caching`).
- **Deploy** is automatic from `main` via Cloudflare's GitHub integration — **pushing `main` deploys to production.** No manual step. `npx wrangler deploy --dry-run` builds the bundle (verifies imports + the Text rule) without deploying.
- **Tooling baseline:** ESLint flat config (`eslint.config.js`) + Prettier (`prettier.config.cjs`) + `.editorconfig`. No production npm dependencies; dev-only `wrangler` + `vitest`.

## Hard rules

- **The live surface is a stable external contract.** `/files`, `/messages` (image-selection), context validation, CORS, and cache_control serve production. Their routes, request/response shapes, headers, and status codes must stay identical.
- **Brain is the source of truth** for the `/v2/ai-tools/*` request/response shapes (`tools.js`) and the `/v2/administrator-authentication/validate-context-id` shape (`auth.js`). Mirror Brain's C# exactly — verify the route, query params, and fields against the sibling `brain` repo (`Controllers/V2/AiToolsController.cs` `[Route("v2/ai-tools")]` → `store-analytics` / `segments` / `campaigns` / `store-config`; `AdministratorAuthenticationController.cs` → `validate-context-id`). Never invent, narrow, or rename a field in `tools.js` / `auth.js`; never assume the shape from the legacy app TS (it can be stale).
- **One error shape, status mapped from the failure.** Every error response is `{ error: { message } }` (Anthropic-compatible), built by `errorResponse` in `lib/responses.js`. The router (`index.js`) wraps each route in try/catch; a thrown error — including a failed Brain context-ID validation — becomes `errorResponse(message)`, which defaults to **HTTP 500**. Brain's own status (e.g. 401/403) and detail are carried in the message text, not the worker's status code. `/files` upload preserves the upstream Anthropic status (a 500 also appends the Files-API-beta-access hint); `handleMessages` passes Anthropic's status + body through on a non-ok response. Handlers do not invent per-route error envelopes. See [docs/DECISIONS.md](docs/DECISIONS.md) #7.
- Prompt `.md` text must match the intended prompt byte-for-byte.
- No new npm dependencies. No TypeScript.
- Commit locally; **never push without explicit intent** (push = production deploy).
