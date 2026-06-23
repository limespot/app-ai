# Contributing — app-ai

This is a single-`main`, dependency-free Cloudflare Worker. Read [CLAUDE.md](CLAUDE.md)
for the architecture and the documentation-propagation rule before changing
code; read [docs/DECISIONS.md](docs/DECISIONS.md) for why the worker is shaped
the way it is.

## ⚠️ Pushing `main` is a production deploy

Cloudflare's GitHub integration auto-deploys `main` to production. There is one
branch and no staging. **A push to `main` is live.** Commit locally; push only
with intent. Docs/test-only changes are deploy-safe (no runtime behavior
change), but they still deploy — there is no "safe" branch to stage on.

## Commit message convention

`type(scope): subject`, where `scope` is `app-ai`. Use a conventional `type`:
`feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `chore`.

```
docs(app-ai): add standalone-project docs (TESTING / DECISIONS / KNOWN-ISSUES)
test(app-ai): pre-release token-savings gate (verify:caching)
fix(app-ai): only send output_config.effort on models that support it
```

End every commit message with the trailer:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## Validate before you push

Run the full offline gate locally — it mirrors CI
(`.github/workflows/ci.yml`), which runs lint → format-check → `vitest run` on
every push and PR:

```bash
npm run lint            # ESLint over src/** + test/**  (must be 0)
npm run format-check    # Prettier check
npx vitest run          # unit + integration + contract (must be green)
npx wrangler deploy --dry-run   # build the bundle (verifies imports + the .md Text rule)
```

For any change touching prompt text, the tool definitions, or cache-control
code, also run the live token-savings gate against the deployed worker — the
offline suite cannot prove caching actually engages (it mocks `fetch`):

```bash
npm run verify:caching  # asserts cache_read > 0 on a repeat call (see docs/TESTING.md)
```

The gate is a required pre-release step. It needs a master context-ID and a
reachable target; it throws loudly (never silently skips) if either is missing.
See [docs/TESTING.md](docs/TESTING.md) for credentials/target resolution and CI
vs manual rationale.

## Documentation rule

Any code change MUST update the affected folder's `CLAUDE.md`
(`src/handlers/CLAUDE.md`, `src/lib/CLAUDE.md`), then propagate up to the root
[CLAUDE.md](CLAUDE.md). Adding/renaming a handler, lib module, prompt, route, or
doc updates the relevant sections. Keep the documentation tree valid. Docs are
present-state only — describe what the code IS, never what it was (no
"previously", "now", "refactored from", before→after framing).

## Hard rules

- **No new npm dependencies. No TypeScript.** (JSDoc for types.)
- **The Anthropic API key never leaves the worker** — only `lib/anthropic.js`
  reads `env.CLAUDE_API_KEY`.
- **The live surface is a stable external contract.** `/files`, `/messages`
  (image-selection), `/chat`, context validation, CORS, and `cache_control`
  serve production — routes, request/response shapes, headers, and status codes
  stay identical.
- **Brain is the source of truth** for the `/v2/ai-tools/*` and
  validate-context-id request/response shapes — mirror Brain's C# exactly
  (verify in the `brain` repo); never invent fields in `tools.js` / `auth.js`.
- Prompt `.md` text must match the intended prompt byte-for-byte.
