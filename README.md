# App AI Service

Cloudflare Worker that provides secure access to Anthropic's Claude API with context validation and system prompt management for LimeSpot applications.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.dev.vars` file for local development (gitignored):

```bash
echo "CLAUDE_API_KEY=sk-ant-api03-your-key-here" > .dev.vars
```

Get your API key from [Anthropic Console](https://console.anthropic.com/) → API Keys.

**Note:** `.dev.vars` is gitignored and never committed. Production uses Cloudflare encrypted secrets.

### 3. Start Development Server

```bash
npm run dev
```

Server runs at `http://localhost:8787`

### 4. Test

```bash
# Health check
curl http://localhost:8787/health

# Expected response:
# {"status":"ok","message":"App AI service is running","timestamp":"..."}
```

## API Endpoints

All endpoints except `/health` require `X-Personalizer-Context-ID` header for authentication.

| Method | Endpoint      | Description                             | Auth Required |
| ------ | ------------- | --------------------------------------- | ------------- |
| GET    | `/health`     | Health check                            | No            |
| POST   | `/files`      | Upload file to Claude                   | Yes           |
| GET    | `/files`      | List uploaded files                     | Yes           |
| DELETE | `/files/{id}` | Delete file                             | Yes           |
| POST   | `/messages`   | Send message to Claude (single-shot)    | Yes           |
| POST   | `/chat`       | Studio AI chat agent loop (SSE + tools) | Yes           |

### `POST /chat` — Studio AI agent runtime

The chat/onboarding/placement runtime for LimeSpot Studio. Runs the Anthropic
tool-use **agent loop** (model ↔ tool iterations, capped at `MAX_ITERATIONS`=8)
and streams the result as **Server-Sent Events**. Tool calls are dispatched
server→server to Brain's read-only AI tool proxy (`/v2/ai-tools/*`), forwarding
the merchant's `X-Personalizer-Context-ID`. The Anthropic key never leaves the
worker.

- **`X-Personalizer-System-Prompt`** selects the server-side prompt: `chat`
  (default), `onboarding`, or `placement`.
- **`Accept: text/event-stream`** → SSE (events: `text`, `tool_call`,
  `tool_result`, `done`, `error`). Otherwise → a single JSON object (same shape
  as the `done` payload).
- Request body: `{ messages, context?, model?, max_tokens?, fileIds? }`.
  `messages` is the full history the client wants the model to see (the client
  owns history; persistence lives in Brain). `context` carries grounding
  (`hostPage`, validated placement `candidates`, best-practice `grounding`).

The frozen cross-repo contract is in the lib repo at
`packages/storefront/src/admin/ai/CONTRACTS.md` (§1 SSE protocol, §2 tools).
Source: `src/handlers/chat.js` (agent loop + SSE), `src/tools.js` (tool defs +
Brain dispatch), `src/prompts.js` (system prompts). Tests: `test/chat.test.js`
(`npm test`).

### Headers

- **`X-Personalizer-Context-ID`** (required for protected endpoints): Authentication token validated against Brain API
- **`X-Personalizer-System-Prompt`** (optional): System prompt name (e.g., "image-selection")

### Example Request

```bash
curl -X POST http://localhost:8787/messages \
  -H "Content-Type: application/json" \
  -H "X-Personalizer-Context-ID: your-context-id" \
  -H "X-Personalizer-System-Prompt: image-selection" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Development

### Local Setup

```bash
# Start dev server
npm run dev

# Watch logs
# (logs appear in same terminal)

# Test endpoints
curl http://localhost:8787/health
```

### File Structure

```
app-ai/
├── src/
│   ├── index.js              # Entry + router only (CORS, OPTIONS, auth, dispatch)
│   ├── handlers/
│   │   ├── health.js         # GET  /health
│   │   ├── files.js          # POST/GET /files, DELETE /files/{id}
│   │   ├── messages.js       # POST /messages (single-shot proxy)
│   │   └── chat.js           # POST /chat (Studio AI agent loop + SSE)
│   ├── lib/
│   │   ├── anthropic.js      # The Anthropic client (files + messages + streaming + count_tokens)
│   │   ├── auth.js           # Context-ID validation against Brain
│   │   ├── cors.js           # CORS headers
│   │   ├── responses.js      # JSON / error response helpers
│   │   ├── cache-control.js  # 4-block prompt-cache management + 1h extended-TTL const
│   │   ├── agent-cache.js    # /chat conversation-turn cache breakpoints (≤3, ~15-block intervals)
│   │   ├── file-dedup.js     # Files API SHA-256 → file_id dedup (KV-backed, graceful no-op)
│   │   └── logger.js         # Scoped console logger
│   ├── prompts.js            # System-prompt registry (name → text + metadata)
│   ├── prompts/*.md          # Prompt text (one .md per prompt, bundled at build time)
│   └── tools.js              # /chat tool definitions + Brain dispatch
├── test/
│   ├── chat.test.js          # /chat agent loop + SSE
│   ├── proxy.test.js         # files/messages/health + anthropic client + cors/auth/cache
│   └── token-saving.test.js  # caching/dedup/count_tokens/effort levers
├── scripts/
│   └── verify-caching.mjs    # live token-savings GATE (npm run verify:caching) — see docs/TESTING.md
├── docs/                     # Standalone-project docs (TESTING / DECISIONS / KNOWN-ISSUES)
├── CONTRIBUTING.md           # Commit convention + push-to-main deploy rule + validate loop
├── prompts/                  # Prompt-authoring drafts (NOT bundled; see note below)
├── wrangler.toml             # Configuration + the `[[rules]] type = "Text"` prompt-bundling rule
├── vitest.config.js          # Inline Vite plugin loading .md prompts as raw text in tests
├── .dev.vars                 # Local secrets (gitignored)
└── package.json
```

Architecture detail lives in [CLAUDE.md](CLAUDE.md).

### Environment Variables

**Local Development:**

- Public config in `wrangler.toml` `[env.dev.vars]` section
- Secrets in `.dev.vars` file (gitignored):
  ```bash
  CLAUDE_API_KEY=sk-ant-api03-...
  ```

**Production:**

- Public config in `wrangler.toml` `[vars]` section (default)
- Secrets set via Cloudflare Dashboard:
  - Workers > app-ai > Settings > Variables > Encrypt
  - Add `CLAUDE_API_KEY` as encrypted secret

### Updating System Prompts

Each system prompt is a **registry entry** in [src/prompts.js](src/prompts.js) whose
TEXT lives in a sibling `.md` file under [src/prompts/](src/prompts/). The registry maps
`name → { prompt, model, maxTokens, usesTools, description, attachments, effort? }` and is
the single source of truth for each prompt's model / token / tool choices (consumed by both
`handlers/chat.js` and `handlers/messages.js`). `effort` is optional — see Token-Saving below.

> The top-level `prompts/` directory (`prompts/image-selection/*.md`) holds prompt-authoring
> drafts. It is NOT imported by the worker and NOT bundled — the live prompt text the worker
> bundles lives only under `src/prompts/`.

To change a prompt's wording: edit its `.md` file (e.g. `src/prompts/chat.md`) — pure text.
To add a prompt: create a `prompts/<name>.md` file and add a registry entry that imports it.
To change a prompt's model / token budget / whether it uses tools: edit the metadata in
`src/prompts.js`.

The `.md` files are bundled at **build time** (Workers have no runtime filesystem) — the
`[[rules]] type = "Text"` rule in `wrangler.toml` makes `import x from './prompts/x.md'`
resolve to the file's string contents; `vitest.config.js` mirrors this for tests with the
same import specifier.

1. Edit the `.md` text and/or the `src/prompts.js` metadata
2. `npx vitest run` and `npx wrangler deploy --dry-run` to verify
3. Commit and push to GitHub (auto-deploys to production)

### Token-Saving Levers

Cost-reduction is additive and never changes external request/response shapes.

**What caches, live-measured against the deployed worker** (proven by `npm run verify:caching` — see [docs/TESTING.md](docs/TESTING.md)):

- **chat + onboarding (Opus 4.8):** the `tools` (TOOL_DEFINITIONS, ~6.4KB JSON)
  - `buildSystem` base block cache at **~1351 input tokens**; a repeat call reads
    the full prefix from cache (`cache_read_input_tokens: 1351`). The
    TOOL_DEFINITIONS block is what clears Opus 4.8's cacheable floor.
- **placement file blocks (Haiku 4.5) — the dominant cost and the big win:** the
  uploaded screenshot + cleaned HTML file prefix is **tens of thousands of
  tokens** (e.g. a ~24.9K-token screenshot+HTML prefix). Call 1 writes the cache
  (`cache_creation_input_tokens` ≈ the prefix size); the repeat call on the same
  page reads it at 0.1× (`cache_read_input_tokens` > 0). Same bytes map to the
  same `file_id` via the `/files` content-hash dedup, so both calls hit one cache
  entry.
- **placement _system_ prompt (~370 tokens, Haiku 4.5) is NOT cached — by
  design:** it is below Haiku's minimum cacheable prefix, so a marker would be a
  silent no-op and padding it would cost more than it saves. The placement win is
  the file blocks, not the system prompt. See [docs/DECISIONS.md](docs/DECISIONS.md) #8.

**The levers:**

- **Extended 1h prompt cache.** Stable prefixes (the system prompt, reused file
  attachments, the `/chat` base prompt block) carry `cache_control: { type: 'ephemeral', ttl:
'1h' }` (GA — no beta header). Conversation turns use the 5-minute default. See
  `src/lib/cache-control.js` (`EXTENDED_CACHE_CONTROL`).
- **Agent-loop breakpoints.** `src/lib/agent-cache.js` re-applies ≤3 conversation breakpoints
  each iteration (last block + ~every-15-blocks); the system base block holds the 4th, so the
  total never exceeds Anthropic's 4-block limit.
- **Files API checksum dedup.** `src/lib/file-dedup.js` hashes upload bytes (SHA-256) and, when
  the optional `FILES_KV` namespace is bound, reuses the stored `file_id` instead of
  re-uploading (the Files API does NOT dedup by content). **Graceful no-op until KV is
  provisioned** — uploads still work.
- **`count_tokens` pre-flight.** Large `/messages` payloads log a free token estimate (warn-only;
  never gates the request).
- **Opt-in output effort (model-gated).** A registry entry may set `effort` → handlers add
  `output_config: { effort }` **only when the resolved model supports it** (`supportsEffort` in
  `lib/anthropic.js`: Fable 5, Opus 4.8/4.7/4.6/4.5, Sonnet 4.6). On a model that doesn't support
  effort (e.g. Haiku 4.5, Sonnet 4.5) the worker omits it — sending it returns a 400. `placement`
  runs on Haiku 4.5, so it carries no `effort`.

**Provisioning `FILES_KV`** (one-time — dedup no-ops until then):

```bash
npx wrangler kv namespace create FILES_KV
npx wrangler kv namespace create FILES_KV --preview
```

Then uncomment the `[[kv_namespaces]]` stanza in `wrangler.toml` and paste the returned ids.

**Needs live validation:** the 1h `ttl` and `count_tokens` are offline-verified only (tests +
dry-run). A real deploy is required to confirm the Anthropic API accepts them in production.
`output_config.effort` is live-validated via the placement smoke test.

### CORS Configuration

Allowed origins live in [src/lib/cors.js](src/lib/cors.js). The AI endpoints carry no
cookies (auth is the `X-Personalizer-Context-ID` header, validated against Brain), so any
merchant Origin is echoed back without credentials; the `CREDENTIALED_ORIGINS` allowlist
additionally permits known dev origins to send credentialed requests. Update that allowlist
to add a credentialed dev origin.

## Deployment

### Automated Deployment (GitHub Integration)

This project uses Cloudflare's GitHub integration for automatic deployment:

- **Commits to `main` branch** → Auto-deploy to production environment

**Setup:**

1. Connect repository to Cloudflare via dashboard
2. Configure branch-to-environment mapping (`main` → `app-ai`)
3. Set `CLAUDE_API_KEY` secret in Cloudflare Dashboard:
   - Workers > app-ai > Settings > Variables > Encrypt
   - Add secret with key `CLAUDE_API_KEY`

**No manual deployment needed** - push to GitHub and Cloudflare auto-deploys.

### Manual Deployment (Testing Only)

For testing changes before committing to GitHub:

```bash
# Test manual deploy to development environment
npm run deploy

# View logs
npm run tail
```

**Note:** Manual deployment should only be used for:

- Testing deployment process
- Emergency hotfixes
- Validating changes before pushing to GitHub

### Environments

All configured in [wrangler.toml](wrangler.toml):

- **Local** (`wrangler dev --env dev` or `npm run dev`): `http://localhost:8787`

  - Config: `wrangler.toml` `[env.dev.vars]` section
  - Secrets: `.dev.vars` file (gitignored)
  - Brain API: `https://local.personalizer.io`

- **Production** (Cloudflare auto-deploy): `https://app-ai.personalizer.io`
  - Config: `wrangler.toml` `[vars]` section (default)
  - Secrets: Cloudflare Dashboard (encrypted)
  - Brain API: `https://personalizer.io`
  - Auto-deploys from `main` branch

Each environment configuration includes:

- `ENVIRONMENT` - Environment name
- `BRAIN_API_URL` - Backend API URL
- `CLAUDE_API_KEY` - Anthropic API key

### View Live Logs

```bash
# Production logs
npm run tail
```

## Security

### Best Practices

1. **API Keys**

   - Never commit API keys to git
   - Local: Store in `.dev.vars` (gitignored)
   - Production: Use Cloudflare encrypted secrets
   - Rotate keys regularly

2. **CORS**

   - The allow-listed first-party origins (`lib/cors.js`) receive
     `Access-Control-Allow-Credentials: true`.
   - Other origins (embedded merchant storefronts) are echoed back **without**
     credentials, with `Vary: Origin`. These endpoints are authenticated by the
     `X-Personalizer-Context-ID` header, not cookies, so credential-less
     cross-origin access is safe and intended — the worker must serve arbitrary
     merchant domains, so a fixed allow-list is deliberately not used here.

3. **Context Validation**

   - All protected endpoints validate the context ID against the Brain API
     before dispatch (`lib/auth.js`).
   - A failed validation (missing ID, Brain unreachable, or a non-2xx Brain
     response) throws; the router maps the throw to **HTTP 500** with an
     `{ error: { message } }` body. Brain's own status (e.g. 401/403) and detail
     are preserved in the message text, not the worker's status code. See
     [docs/DECISIONS.md](docs/DECISIONS.md) #7.

4. **Input Validation**
   - File upload size limits enforced
   - Request payloads validated
   - Appropriate error codes returned

### Development Dependencies

Some npm audit warnings exist for development dependencies (esbuild, vite). These are:

- **Not in production** (dev-only tools)
- **Not critical** (development server vulnerabilities)
- **Mitigated** by not exposing dev server to internet

**For production:** No action needed - vulnerabilities don't affect deployed workers.

### Security Checklist

Before deploying:

- [ ] API keys set as Cloudflare encrypted secrets (not in code)
- [ ] `.dev.vars` is gitignored
- [ ] CORS origins restricted to production domains
- [ ] No sensitive data in logs
- [ ] Context validation working
- [ ] Dependencies updated

## Troubleshooting

### Port 8787 already in use

```bash
lsof -i :8787
kill -9 <PID>
```

### API key not working

- Check `.dev.vars` file exists with `CLAUDE_API_KEY`
- Verify API key starts with `sk-ant-api03-`
- Ensure no extra spaces or quotes in `.dev.vars`
- Restart dev server after changes

### CORS errors

- Verify app origin in allowed list ([src/lib/cors.js](src/lib/cors.js))
- Restart dev server after changes
- Check browser console for specific error

### Context validation failing

- Verify context ID is valid in Brain API
- Check `BRAIN_API_URL` environment variable
- Review validation logs in worker output

### Deployment issues

```bash
# Check account ID in wrangler.toml
wrangler whoami

# Verify configuration
cat wrangler.toml | grep -A3 "\[vars\]"

# Check deployment logs
wrangler tail
```

## Commands Reference

```bash
# Development
npm run dev              # Start local server (port 8787)
npm run test             # Run tests

# Deployment (Manual - for testing only)
npm run deploy           # Deploy to default environment

# Monitoring
npm run tail             # View production logs

# Maintenance
npm run update-deps      # Update dependencies and run audit fix
npm audit                # Check security
wrangler whoami          # Check authentication

# Note: Staging and production deploy automatically via GitHub integration
```

## Platform Details

### Cloudflare Workers

- **Runtime:** V8 Isolates (not Node.js) — Web-standard `fetch` / `Request` /
  `Response` / `FormData`, no Node APIs, no runtime filesystem.
- **APIs:** Web Standards (fetch, Request, Response, FormData)
- **Limits:** 50,000ms CPU time per request (configured in `wrangler.toml`).
- **Deploy:** `main` auto-deploys to production via Cloudflare's GitHub
  integration (see [docs/DECISIONS.md](docs/DECISIONS.md) #6).

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Brain API](https://personalizer.io)

## Project Docs

- [CLAUDE.md](CLAUDE.md) — architecture + the documentation-propagation rule
- [CONTRIBUTING.md](CONTRIBUTING.md) — commit convention, the push-to-main
  deploy rule, the validate-before-push loop
- [docs/TESTING.md](docs/TESTING.md) — the four test layers + the live
  token-savings gate
- [docs/DECISIONS.md](docs/DECISIONS.md) — numbered decision log
- [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) — current limitations

---

**Platform:** Cloudflare Workers (V8 Isolates)
**Live surface:** `/files` + `/messages` serve the production smart-image
feature; `/chat` serves LimeSpot Studio AI.
**Deploy:** pushing `main` deploys to production.
