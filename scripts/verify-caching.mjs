/**
 * Pre-release token-savings GATE — proves prompt caching engages against a
 * DEPLOYED worker.
 *
 * This is an INTEGRATION check, not a unit test: it needs network, a valid
 * master `X-Personalizer-Context-ID`, and a deployed `/chat` + `/files` target.
 * It is kept OUT of the default `vitest run` set for that reason (run it via
 * `npm run verify:caching`).
 *
 * It makes two identical requests for each of the two cached prefixes the worker
 * relies on for its cost reduction and ASSERTS the second call reads from cache:
 *
 *   (i)  chat tools+system prefix (Opus 4.8) — the TOOL_DEFINITIONS + base
 *        system block. Repeat call ⇒ `cache_read_input_tokens > 0`.
 *   (ii) placement file-block prefix (Haiku 4.5) — an uploaded HTML file block.
 *        Call 1 writes the cache (`cache_creation_input_tokens > 0`), call 2
 *        reads it (`cache_read_input_tokens > 0`).
 *
 * FAIL LOUDLY — never silently skip:
 *   - Missing creds / target  → THROW with setup instructions (exit 1).
 *   - `cache_read` is 0 on a repeat call → THROW (a caching regression).
 *
 * Credentials + target resolution (first match wins):
 *   - Context-ID: `APP_AI_CONTEXT_ID` env, else the cached master context at
 *     `/tmp/storefront-test/shop-context.lsdev1.myshopify.com.json` (the same
 *     master-login fixture the lib E2E suite mints — see the lib admin
 *     `studio-e2e-auth` notes). Context-IDs are subscriber-scoped; this gate
 *     targets the lsdev1 dev store.
 *   - Target worker: `APP_AI_TARGET` env, else the production worker URL.
 */

import { readFileSync } from 'node:fs';

const DEFAULT_TARGET = 'https://app-ai.personalizer.io';
const DEFAULT_CONTEXT_FILE = '/tmp/storefront-test/shop-context.lsdev1.myshopify.com.json';
const REQUEST_TIMEOUT_MS = 120000;

/** Resolve the deployed worker base URL (env override, else production). */
function resolveTarget() {
  return (process.env.APP_AI_TARGET || DEFAULT_TARGET).replace(/\/$/, '');
}

/**
 * Resolve a master context-ID. Throws (with actionable instructions) when none
 * is available — never returns a placeholder, never silently skips.
 */
function resolveContextId() {
  if (process.env.APP_AI_CONTEXT_ID) {
    return process.env.APP_AI_CONTEXT_ID;
  }
  const file = process.env.APP_AI_CONTEXT_FILE || DEFAULT_CONTEXT_FILE;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && parsed.contextID) {
      return parsed.contextID;
    }
    throw new Error(`no "contextID" field in ${file}`);
  } catch (error) {
    throw new Error(
      `No master context-ID available. The caching gate needs a valid ` +
        `X-Personalizer-Context-ID for a dev store.\n` +
        `  • Set APP_AI_CONTEXT_ID=<id>, or\n` +
        `  • Provide a context fixture at ${file} (the lib E2E suite mints these ` +
        `via the aidin@limespot.com master login).\n` +
        `Underlying error: ${error.message}`,
    );
  }
}

/** POST /chat (non-streaming) and return the parsed `done` payload. */
async function chat(target, contextId, promptName, body) {
  const response = await fetch(`${target}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Personalizer-Context-ID': contextId,
      'X-Personalizer-System-Prompt': promptName,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST /chat (${promptName}) → HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`POST /chat (${promptName}) returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (parsed.error) {
    throw new Error(`POST /chat (${promptName}) error: ${parsed.error.message || text}`);
  }
  return parsed;
}

/** Upload bytes to /files and return the file_id. */
async function uploadFile(target, contextId, bytes, mimeType, filename) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), filename);
  const response = await fetch(`${target}/files`, {
    method: 'POST',
    headers: { 'X-Personalizer-Context-ID': contextId },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST /files → HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  const parsed = JSON.parse(text);
  if (!parsed.id) {
    throw new Error(`POST /files returned no file_id: ${text.slice(0, 200)}`);
  }
  return parsed.id;
}

const cacheRead = (usage) => (usage && usage.cache_read_input_tokens) || 0;
const cacheCreate = (usage) => (usage && usage.cache_creation_input_tokens) || 0;

/** Assert + report one prefix's two-call result, throwing on a 0-read regression. */
function assertCached(label, first, second) {
  const f = first.usage || {};
  const s = second.usage || {};
  console.log(
    `  call 1: input=${f.input_tokens ?? '?'} cache_creation=${cacheCreate(f)} cache_read=${cacheRead(f)}`,
  );
  console.log(
    `  call 2: input=${s.input_tokens ?? '?'} cache_creation=${cacheCreate(s)} cache_read=${cacheRead(s)}`,
  );
  if (cacheRead(s) <= 0) {
    throw new Error(
      `CACHING REGRESSION — ${label}: call 2 read 0 tokens from cache ` +
        `(cache_read_input_tokens=${cacheRead(s)}). The cached prefix is not engaging. ` +
        `Check for a silent prefix invalidator (per-request bytes in tools/system/file blocks), ` +
        `a dropped cache_control breakpoint, or a content-hash dedup miss on the file path.`,
    );
  }
  console.log(`  ✓ ${label}: cache engaged (call 2 cache_read=${cacheRead(s)} > 0)\n`);
}

/** Build a sizable HTML payload — must clear Haiku 4.5's min cacheable prefix. */
function buildHtmlFixture() {
  let body = '';
  for (let i = 0; i < 400; i++) {
    body +=
      `<div class="p${i}"><h2>Product ${i}</h2>` +
      `<p>Descriptive marketing copy about product number ${i} that takes up tokens. ` +
      `Lorem ipsum dolor sit amet consectetur adipiscing elit.</p>` +
      `<button>Buy ${i}</button></div>`;
  }
  return `<html><body>${body}</body></html>`;
}

async function main() {
  const target = resolveTarget();
  const contextId = resolveContextId();

  console.log(`Token-savings gate → ${target}\n`);

  // (i) chat tools+system prefix (Opus 4.8). Identical bodies on both calls.
  console.log('[1/2] chat tools+system prefix (Opus 4.8)');
  const chatBody = { messages: [{ role: 'user', content: 'Say hello in one short sentence.' }] };
  const chat1 = await chat(target, contextId, 'chat', chatBody);
  const chat2 = await chat(target, contextId, 'chat', chatBody);
  assertCached('chat tools+system prefix', chat1, chat2);

  // (ii) placement file-block prefix (Haiku 4.5). Upload one file, reference it
  // by fileId in two identical placement calls. Same bytes → same file_id (via
  // the /files content-hash dedup) → same cache entry.
  console.log('[2/2] placement file-block prefix (Haiku 4.5)');
  const fileId = await uploadFile(
    target,
    contextId,
    new TextEncoder().encode(buildHtmlFixture()),
    'text/plain',
    'caching-gate.html',
  );
  console.log(`  uploaded fixture → ${fileId}`);
  const placementBody = {
    messages: [{ role: 'user', content: 'Where should a recommendation box go?' }],
    fileIds: [fileId],
  };
  const place1 = await chat(target, contextId, 'placement', placementBody);
  const place2 = await chat(target, contextId, 'placement', placementBody);
  assertCached('placement file-block prefix', place1, place2);

  console.log('GATE PASSED — both cached prefixes engage against the deployed worker.');
}

main().catch((error) => {
  console.error(`\nGATE FAILED: ${error.message}`);
  process.exit(1);
});
