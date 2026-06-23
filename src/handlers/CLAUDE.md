# src/handlers/

**Parent:** [app-ai/CLAUDE.md](../../CLAUDE.md)

Route handlers. `src/index.js` (the thin router) does CORS, the OPTIONS preflight,
and context-ID auth, then dispatches to one of these. Each handler owns one route
group and returns a `Response`; all Anthropic/Brain access goes through `../lib/`.

## Files

| File          | Route(s)                                          | Purpose                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health.js`   | `GET /health`                                     | Liveness check. No auth, no Anthropic call.                                                                                                                                                                                                              |
| `files.js`    | `POST /files`, `GET /files`, `DELETE /files/{id}` | Proxy to the Anthropic Files API. Upload routes through content-hash dedup (`lib/file-dedup.js`) so identical bytes reuse a `file_id`; response shape stays `{ id, type }`. List/delete proxy as-is; 500 upload errors get the beta-access hint.          |
| `messages.js` | `POST /messages`                                  | Single-shot Messages proxy — the **LIVE smart-image** surface. Injects the registry system prompt, uploads attachments (dedup), manages the 4-block `cache_control` limit, applies opt-in `effort`, best-effort `count_tokens` pre-flight, then proxies. |
| `chat.js`     | `POST /chat`                                      | Studio AI agent loop + SSE. Runs the Anthropic tool-use loop (`MAX_ITERATIONS=8`) against Brain AI-tools, streaming `text`/`tool_call`/`tool_result`/`done`/`error` events; non-streaming clients get the `done` payload as JSON. `fileIds` become `image`/`document` blocks (typed by Files-API mime), with a 1h cache breakpoint on the file prefix (placement screenshot + HTML). |

## Conventions

- Handlers receive `corsHeaders` from the router and spread them onto every `Response`.
- The context-ID is already validated by the router before any handler runs.
- Use `createLogger(scope)` from `../lib/logger.js` for scoped, tail-greppable logs.
- The live surface (`/files`, `/messages`) is in production — its routes, request/response
  shapes, headers, and status codes are a stable external contract; keep them identical.
