# src/lib/

**Parent:** [app-ai/CLAUDE.md](../../CLAUDE.md)

Shared library modules consumed by the handlers and the router. The Anthropic API
key (`env.CLAUDE_API_KEY`) is read only by callers of `anthropic.js` and never
leaves the worker.

## Files

| File               | Exports                                                                                  | Purpose                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anthropic.js`     | `uploadFile`, `listFiles`, `getFileMetadata`, `deleteFile`, `createMessage`, `streamMessage`, `countTokens`, `supportsEffort` | The ONE place that talks to `api.anthropic.com`. Owns base URLs, `anthropic-version`, beta flags, and `x-api-key` injection. `getFileMetadata(id)` GETs `/v1/files/{id}` (200 alive / 404 gone) — used by dedup to verify a cached id before reuse and by `chat.js` to type file blocks by mime. `supportsEffort(model)` is the effort-capability gate (Fable 5, Opus 4.8/4.7/4.6/4.5, Sonnet 4.6) — handlers use it before attaching `output_config.effort` so unsupported models (Haiku 4.5, Sonnet 4.5) don't 400. |
| `auth.js`          | `validateContextId`                                                                      | Validate `X-Personalizer-Context-ID` server→server against Brain. Throws on any failure (router → 500).                                                 |
| `cors.js`          | `getCorsHeaders`                                                                         | Build CORS headers from the request Origin. Echoes any merchant Origin without credentials; a dev allowlist may send credentialed requests.             |
| `responses.js`     | `jsonResponse`, `errorResponse`                                                          | One JSON / `{ error: { message } }` response shape so handlers don't hand-roll `new Response`.                                                          |
| `cache-control.js` | `manageCacheControl`, `EXTENDED_CACHE_CONTROL`                                           | Keep `/messages` within Anthropic's 4-block `cache_control` limit; the 1h extended-TTL breakpoint const for stable prefixes.                            |
| `agent-cache.js`   | `applyConversationBreakpoints`                                                           | Place cache breakpoints on the growing `/chat` conversation turns (last block + ~every-15-blocks), re-stripped each iteration. `maxBreakpoints` (default 3) + `reservedHeadBlocks` (protects the placement file prefix's own 1h breakpoint) keep the total ≤4. |
| `file-dedup.js`    | `dedupUpload`, `sha256Hex`, `KV_RECORD_TTL_SECONDS`                                       | Files API content-hash dedup: SHA-256 → `file_id` via the `FILES_KV` binding (bound in prod → LIVE). Verifies a cached id still exists before reuse (stale → re-upload); records carry a 30-day TTL. Graceful no-op (plain upload) when KV is unbound. |
| `logger.js`        | `createLogger`                                                                           | Scoped `console.*` logger (`[Scope] …`) — `console` IS the observability mechanism, read via `wrangler tail`.                                           |

## Conventions

- Every exported function carries a JSDoc block (params + return).
- Cache/effort/dedup levers are **additive** — they never change external
  request/response shapes (see the token-saving section in the root CLAUDE.md).
- Beta flags live only in `anthropic.js`: Files calls send `files-api-2025-04-14`;
  Messages calls send `prompt-caching-2024-07-31,files-api-2025-04-14`.
