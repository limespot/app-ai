/**
 * Token-saving / cost-reduction coverage (research-verified 2026 levers):
 *   1. Extended 1h TTL on the stable prefix (system + attachments + kept user blocks).
 *   2. Agent-loop conversation breakpoints (lib/agent-cache.js) — last-block,
 *      ~15-block intermediate rule, 4-breakpoint cap, stale-strip.
 *   3. Files API checksum dedup (lib/file-dedup.js) — sha256Hex, KV hit/miss, no-op.
 *   4. count_tokens pre-flight helper (lib/anthropic.js).
 *   5. Model/effort routing (prompts.js + handlers).
 *
 * fetch + KV mocked; Web Crypto comes from the vitest (Node) runtime.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { applyConversationBreakpoints } from '../src/lib/agent-cache.js';
import { sha256Hex, dedupUpload, KV_RECORD_TTL_SECONDS } from '../src/lib/file-dedup.js';
import * as anthropic from '../src/lib/anthropic.js';
import { buildSystem } from '../src/handlers/chat.js';
import { handleChat } from '../src/handlers/chat.js';
import { getSystemPrompt } from '../src/prompts.js';

const ENV = { CLAUDE_API_KEY: 'test-key', BRAIN_API_URL: 'https://brain.test' };
const CORS = { 'Access-Control-Allow-Origin': '*' };

afterEach(() => vi.restoreAllMocks());

function jsonOk(data, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

// ── LEVER 1: extended 1h TTL on the stable prefix ───────────────────────────

describe('LEVER 1 — extended 1h TTL on the stable prefix', () => {
  it('chat buildSystem: base prompt block is 1h-cached, volatile context block is uncached', () => {
    const entry = getSystemPrompt('chat');
    const blocks = buildSystem(entry, { hostPage: 'Home', candidates: [{ index: 0 }] });
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    // The volatile context block (page/candidates) must NOT be cached.
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[blocks.length - 1].cache_control).toBeUndefined();
  });

  it('chat buildSystem: with no context there is only the cached base block', () => {
    const blocks = buildSystem(getSystemPrompt('chat'), undefined);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

// ── LEVER 2: agent-loop conversation breakpoints ────────────────────────────

describe('LEVER 2 — applyConversationBreakpoints', () => {
  /** Build a conversation of N total content blocks spread across messages. */
  function buildConversation(blockCounts) {
    return blockCounts.map((count, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: Array.from({ length: count }, (_unused, j) => ({
        type: 'text',
        text: `m${i}b${j}`,
      })),
    }));
  }

  function flatBlocks(messages) {
    const flat = [];
    messages.forEach((m) => Array.isArray(m.content) && m.content.forEach((b) => flat.push(b)));
    return flat;
  }

  it('places a breakpoint on the last block of the last message', () => {
    const messages = buildConversation([2, 3]);
    applyConversationBreakpoints(messages);
    const last = messages[1].content[2];
    expect(last.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('the ~15-block intermediate rule keeps breakpoints ≤20 apart on a long conversation', () => {
    // 50 total blocks across messages.
    const messages = buildConversation([10, 10, 10, 10, 10]);
    applyConversationBreakpoints(messages);
    const flat = flatBlocks(messages);
    const marked = [];
    flat.forEach((b, idx) => b.cache_control && marked.push(idx));
    // Last block is always marked.
    expect(marked).toContain(flat.length - 1);
    // No two consecutive breakpoints (and the tail) more than 20 apart.
    const sorted = [...marked].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeLessThanOrEqual(20);
    }
  });

  it('never exceeds the message-breakpoint cap (default 3 → system holds the 4th)', () => {
    const messages = buildConversation([20, 20, 20, 20, 20]); // 100 blocks
    applyConversationBreakpoints(messages);
    const marked = flatBlocks(messages).filter((b) => b.cache_control);
    expect(marked.length).toBeLessThanOrEqual(3);
  });

  it('strips stale breakpoints before re-applying (no accumulation across iterations)', () => {
    const messages = buildConversation([10, 10, 10, 10]); // 40 blocks
    applyConversationBreakpoints(messages);
    const firstCount = flatBlocks(messages).filter((b) => b.cache_control).length;
    // Re-run (simulating the next loop iteration) — count must not grow.
    applyConversationBreakpoints(messages);
    const secondCount = flatBlocks(messages).filter((b) => b.cache_control).length;
    expect(secondCount).toBe(firstCount);
    expect(secondCount).toBeLessThanOrEqual(3);
  });

  it('tolerates string-content messages and empty input', () => {
    const messages = [{ role: 'user', content: 'plain string' }];
    expect(() => applyConversationBreakpoints(messages)).not.toThrow();
    expect(messages[0].content).toBe('plain string');
    expect(() => applyConversationBreakpoints([])).not.toThrow();
  });
});

// ── LEVER 3: Files API checksum dedup ───────────────────────────────────────

describe('LEVER 3 — file-dedup', () => {
  it('sha256Hex matches the known vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes equal bytes identically regardless of string vs Uint8Array', async () => {
    const fromStr = await sha256Hex('hello');
    const fromBytes = await sha256Hex(new TextEncoder().encode('hello'));
    expect(fromStr).toBe(fromBytes);
  });

  it('KV hit verifies the file still exists, then returns it without re-uploading', async () => {
    // On a hit, dedup makes ONE call: a GET metadata check confirming the file
    // is still alive (200). It must NOT upload (no POST /files) and must NOT
    // rewrite KV.
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: 'file_cached', type: 'file' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ fileId: 'file_cached', createdAt: 1 })),
      put: vi.fn(),
      delete: vi.fn(),
    };
    const out = await dedupUpload(
      { content: 'abc', mimeType: 'text/plain', filename: 'a.txt' },
      { ...ENV, FILES_KV: kv },
    );
    expect(out).toEqual({ fileId: 'file_cached', deduped: true });
    // Exactly one fetch: the GET metadata existence check (not an upload POST).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/files/file_cached');
    expect(init?.method).toBeUndefined(); // GET (no method = GET)
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.delete).not.toHaveBeenCalled();
    // Looked up under the content hash.
    expect(kv.get).toHaveBeenCalledWith(await sha256Hex('abc'));
  });

  it('KV hit on a STALE id (file 404s) drops the record, re-uploads, and refreshes', async () => {
    // First fetch = metadata check → 404 (file gone). Second fetch = upload POST.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ error: { message: 'File not found' } }, 404))
      .mockResolvedValueOnce(jsonOk({ id: 'file_fresh' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ fileId: 'file_stale', createdAt: 1 })),
      put: vi.fn().mockResolvedValue(),
      delete: vi.fn().mockResolvedValue(),
    };
    const out = await dedupUpload(
      { content: 'abc', mimeType: 'text/plain', filename: 'a.txt' },
      { ...ENV, FILES_KV: kv },
    );
    // Never returns the dead id — a fresh upload replaces it.
    expect(out).toEqual({ fileId: 'file_fresh', deduped: false });
    expect(kv.delete).toHaveBeenCalledWith(await sha256Hex('abc'));
    // Metadata check (GET) then upload (POST /files).
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/files/file_stale');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.anthropic.com/v1/files');
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    // Re-stored under the same hash with a TTL.
    const [hashKey, stored, putOpts] = kv.put.mock.calls[0];
    expect(hashKey).toBe(await sha256Hex('abc'));
    expect(JSON.parse(stored).fileId).toBe('file_fresh');
    expect(putOpts.expirationTtl).toBe(KV_RECORD_TTL_SECONDS);
  });

  it('KV miss uploads, stores hash→fileId, returns deduped:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: 'file_new' }));
    vi.stubGlobal('fetch', fetchMock);
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue() };

    const out = await dedupUpload(
      { content: 'xyz', mimeType: 'text/plain', filename: 'b.txt' },
      { ...ENV, FILES_KV: kv },
    );
    expect(out).toEqual({ fileId: 'file_new', deduped: false });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/files');
    const [hashKey, stored, putOpts] = kv.put.mock.calls[0];
    expect(hashKey).toBe(await sha256Hex('xyz'));
    expect(JSON.parse(stored).fileId).toBe('file_new');
    // The KV record carries the conservative TTL (stale-id bound).
    expect(putOpts.expirationTtl).toBe(KV_RECORD_TTL_SECONDS);
  });

  it('no KV binding → plain upload, never touches KV, deduped:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: 'file_plain' }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await dedupUpload(
      { content: 'data', mimeType: 'image/png', filename: 'c.png' },
      ENV, // no FILES_KV
    );
    expect(out).toEqual({ fileId: 'file_plain', deduped: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws (caller catches) when the upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonOk({ error: { message: 'boom' } }, 500)));
    await expect(
      dedupUpload({ content: 'd', mimeType: 'text/plain', filename: 'd.txt' }, ENV),
    ).rejects.toThrow(/boom/);
  });
});

// ── LEVER 4: count_tokens pre-flight helper ─────────────────────────────────

describe('LEVER 4 — countTokens', () => {
  it('POSTs to /v1/messages/count_tokens with the messages beta header + count-only body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ input_tokens: 1234 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await anthropic.countTokens(
      {
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        stream: true,
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: 's' }],
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 't' }],
      },
      ENV,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(init.headers['anthropic-beta']).toBe('prompt-caching-2024-07-31,files-api-2025-04-14');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.system).toBeDefined();
    expect(body.messages).toBeDefined();
    expect(body.tools).toBeDefined();
    // Inference-only fields are stripped.
    expect(body.max_tokens).toBeUndefined();
    expect(body.stream).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect((await res.json()).input_tokens).toBe(1234);
  });
});

// ── LEVER 5: model / effort routing ─────────────────────────────────────────

describe('LEVER 5 — model + effort routing', () => {
  it('registry models: placement→haiku, chat/onboarding/image-selection→opus', () => {
    expect(getSystemPrompt('placement').model).toBe('claude-haiku-4-5');
    expect(getSystemPrompt('chat').model).toBe('claude-opus-4-8');
    expect(getSystemPrompt('onboarding').model).toBe('claude-opus-4-8');
    expect(getSystemPrompt('image-selection').model).toBe('claude-opus-4-8');
  });

  it('no registry entry carries effort (placement model does not support it)', () => {
    // Placement runs on Haiku 4.5, which 400s on output_config.effort, so the
    // entry must not set it. chat/onboarding/image-selection never set it.
    expect(getSystemPrompt('placement').effort).toBeUndefined();
    expect(getSystemPrompt('chat').effort).toBeUndefined();
    expect(getSystemPrompt('onboarding').effort).toBeUndefined();
    expect(getSystemPrompt('image-selection').effort).toBeUndefined();
  });

  it('supportsEffort: true for the effort-capable models, false for placement/Haiku & Sonnet 4.5', () => {
    // The guard that prevents the placement 500. Effort-capable set.
    expect(anthropic.supportsEffort('claude-fable-5')).toBe(true);
    expect(anthropic.supportsEffort('claude-opus-4-8')).toBe(true);
    expect(anthropic.supportsEffort('claude-opus-4-7')).toBe(true);
    expect(anthropic.supportsEffort('claude-opus-4-6')).toBe(true);
    expect(anthropic.supportsEffort('claude-opus-4-5')).toBe(true);
    expect(anthropic.supportsEffort('claude-sonnet-4-6')).toBe(true);
    // Models that 400 on output_config.effort.
    expect(anthropic.supportsEffort('claude-haiku-4-5')).toBe(false);
    expect(anthropic.supportsEffort('claude-sonnet-4-5')).toBe(false);
    expect(anthropic.supportsEffort(getSystemPrompt('placement').model)).toBe(false);
  });

  it('chat.js NEVER sends output_config.effort to an effort-UNsupported model (placement 500 guard)', async () => {
    // Minimal SSE body the worker can parse → ends the loop after one turn.
    const sse =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n';
    const sseResponse = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(sse));
            c.close();
          },
        }),
        { status: 200 },
      );

    const req = (promptName, extra = {}) =>
      new Request('https://app-ai.test/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Personalizer-Context-ID': 'ctx',
          'X-Personalizer-System-Prompt': promptName,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'go' }], ...extra }),
      });

    const bodyOf = async (request) => {
      const fetchMock = vi.fn().mockResolvedValue(sseResponse());
      vi.stubGlobal('fetch', fetchMock);
      await (await handleChat(request, ENV, CORS)).text();
      return JSON.parse(fetchMock.mock.calls[0][1].body);
    };

    // placement → Haiku 4.5 (effort-UNsupported): NO output_config, even though
    // the path is structured. This is the exact 500 the guard prevents.
    const placementBody = await bodyOf(req('placement'));
    expect(placementBody.model).toBe('claude-haiku-4-5');
    expect(placementBody.output_config).toBeUndefined();

    // Forcing effort via the client body on the placement model must STILL be
    // dropped — the guard is on model capability, not on where effort came from.
    const placementForced = await bodyOf(req('placement', { effort: 'low' }));
    expect(placementForced.model).toBe('claude-haiku-4-5');
    expect(placementForced.output_config).toBeUndefined();

    // chat → Opus 4.8 with no effort set: no output_config.
    const chatBody = await bodyOf(req('chat'));
    expect(chatBody.model).toBe('claude-opus-4-8');
    expect(chatBody.output_config).toBeUndefined();

    // chat → Opus 4.8 (effort-SUPPORTED) with effort set via body: output_config
    // IS attached. Proves the guard keeps the lever working where it's valid.
    const chatEffort = await bodyOf(req('chat', { effort: 'low' }));
    expect(chatEffort.model).toBe('claude-opus-4-8');
    expect(chatEffort.output_config).toEqual({ effort: 'low' });
  });
});

// ── Integration: agent loop breakpoint count stays ≤4 after a multi-tool loop ─

describe('integration — agent-loop cache_control count ≤ 4', () => {
  it('after a tool loop, message-block breakpoints ≤3 (system base block holds the 4th)', async () => {
    function anthropicSse(blocks, stopReason) {
      const lines = [];
      const push = (type, data) =>
        lines.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      push('message_start', { message: { usage: { input_tokens: 10 } } });
      blocks.forEach((block, index) => {
        if (block.type === 'text') {
          push('content_block_start', { index, content_block: { type: 'text' } });
          push('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
        } else if (block.type === 'tool_use') {
          push('content_block_start', {
            index,
            content_block: { type: 'tool_use', id: block.id, name: block.name },
          });
          push('content_block_delta', {
            index,
            delta: { type: 'input_json_delta', partial_json: '{}' },
          });
        }
      });
      push('message_delta', { delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } });
      return lines.join('');
    }
    const sseResponse = (text) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(text));
            c.close();
          },
        }),
        { status: 200 },
      );

    let turn = 0;
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/v2/ai-tools/')) {
        return Promise.resolve(jsonOk({ ok: true }));
      }
      turn += 1;
      // First 3 turns ask for a tool, then a final text turn.
      if (turn <= 3) {
        return Promise.resolve(
          sseResponse(
            anthropicSse(
              [{ type: 'tool_use', id: `tu_${turn}`, name: 'list_segments', input: {} }],
              'tool_use',
            ),
          ),
        );
      }
      return Promise.resolve(
        sseResponse(anthropicSse([{ type: 'text', text: 'done' }], 'end_turn')),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://app-ai.test/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Personalizer-Context-ID': 'ctx',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'loop' }] }),
    });
    await (await handleChat(req, ENV, CORS)).text();

    // Inspect the LAST Anthropic call (largest conversation) — count message
    // breakpoints; must be ≤3 so total (with the 1 system block) ≤4.
    const anthropicCalls = fetchMock.mock.calls.filter(
      ([u]) => !String(u).includes('/v2/ai-tools/'),
    );
    const lastBody = JSON.parse(anthropicCalls[anthropicCalls.length - 1][1].body);
    let msgBreakpoints = 0;
    lastBody.messages.forEach((m) => {
      if (Array.isArray(m.content)) {
        m.content.forEach((b) => b.cache_control && (msgBreakpoints += 1));
      }
    });
    expect(msgBreakpoints).toBeLessThanOrEqual(3);
    expect(msgBreakpoints).toBeGreaterThanOrEqual(1);
    // System base block uses exactly 1.
    expect(lastBody.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
});

// ── LEVER 6: cache_control on the placement file prefix (fileIds) ────────────

describe('LEVER 6 — fileIds document-block caching (placement file prefix)', () => {
  /** Minimal one-turn SSE the worker parses → ends the loop after one turn. */
  const ONE_TURN_SSE =
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n' +
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n' +
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n';

  const sseResponse = () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(ONE_TURN_SSE));
          c.close();
        },
      }),
      { status: 200 },
    );

  /**
   * Fire /chat with the given body, return the parsed Anthropic request body.
   * `mimeByFileId` maps each uploaded fileId to the mime_type its Files-API
   * metadata lookup should report (drives image vs document block selection).
   */
  async function chatBody(body, mimeByFileId = {}) {
    const fetchMock = vi.fn().mockImplementation((url) => {
      const u = String(url);
      // Files API metadata lookup (GET /v1/files/{id}) for block-type selection.
      const m = u.match(/\/v1\/files\/(file_[^/?]+)$/);
      if (m) {
        return Promise.resolve(jsonOk({ id: m[1], mime_type: mimeByFileId[m[1]] || 'text/plain' }));
      }
      // The Messages stream.
      return Promise.resolve(sseResponse());
    });
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request('https://app-ai.test/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Personalizer-Context-ID': 'ctx',
        'X-Personalizer-System-Prompt': 'placement',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });
    await (await handleChat(req, ENV, CORS)).text();
    const messagesCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/v1/messages'));
    return JSON.parse(messagesCall[1].body);
  }

  it('prepends fileIds, 1h-caches the LAST file block, and types images vs documents by mime', async () => {
    const sent = await chatBody(
      {
        messages: [{ role: 'user', content: 'where should the box go?' }],
        fileIds: ['file_html', 'file_screenshot'],
      },
      { file_html: 'text/plain', file_screenshot: 'image/jpeg' },
    );
    const content = sent.messages[0].content;
    // Two file blocks prepended ahead of the user text, in order.
    const fileBlocks = content.filter((b) => b.type === 'document' || b.type === 'image');
    expect(fileBlocks).toHaveLength(2);
    // HTML → document block; screenshot (image/jpeg) → image block (NOT document,
    // which Anthropic rejects for images — the real placement 400 this fixes).
    expect(fileBlocks[0]).toMatchObject({
      type: 'document',
      source: { type: 'file', file_id: 'file_html' },
    });
    expect(fileBlocks[1]).toMatchObject({
      type: 'image',
      source: { type: 'file', file_id: 'file_screenshot' },
    });
    // Only the LAST file block carries the 1h breakpoint (caches the whole
    // prefix); the first does NOT (avoids burning two slots on the prefix).
    expect(fileBlocks[0].cache_control).toBeUndefined();
    expect(fileBlocks[1].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('keeps total breakpoints ≤4 with a file prefix present (1 system + 1 file + ≤2 conv)', async () => {
    const sent = await chatBody({
      messages: [{ role: 'user', content: 'go' }],
      fileIds: ['file_html', 'file_screenshot'],
    });
    let total = sent.system.filter((b) => b.cache_control).length; // system base = 1
    sent.messages.forEach((m) => {
      if (Array.isArray(m.content)) {
        m.content.forEach((b) => b.cache_control && (total += 1));
      }
    });
    expect(total).toBeLessThanOrEqual(4);
    // Sanity: the file-prefix breakpoint is present (≥ system + file = 2).
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it('no fileIds → no document blocks, no file breakpoint (placement without uploads)', async () => {
    const sent = await chatBody({ messages: [{ role: 'user', content: 'go' }] });
    const content = sent.messages[0].content;
    // Plain string content is left as-is (no file blocks injected).
    const hasDocBlock = Array.isArray(content) && content.some((b) => b.type === 'document');
    expect(hasDocBlock).toBe(false);
  });
});
