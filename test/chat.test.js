/**
 * Studio AI — app-ai chat agent-loop + SSE tests.
 *
 * These tests exercise the worker's NEW /chat surface end to end against a
 * mocked Anthropic API + a mocked Brain AI-tool proxy, with NO real network.
 * Covers: prompt selection, single-shot streaming, the tool-use agent loop,
 * MAX_ITERATIONS, the SSE protocol, and the non-streaming JSON shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleChat } from '../src/handlers/chat.js';
import { TOOL_DEFINITIONS, executeTool } from '../src/tools.js';
import { getAvailablePrompts, getSystemPrompt } from '../src/prompts.js';

const ENV = { CLAUDE_API_KEY: 'test-key', BRAIN_API_URL: 'https://brain.test' };
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** Build an Anthropic-style SSE body from a list of content blocks. */
function anthropicSse(blocks, stopReason) {
  // Real Anthropic SSE carries `type` inside the data JSON too (not just the
  // event: line). The worker switches on the data's `type`, so include it.
  const lines = [];
  const push = (type, data) =>
    lines.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  push('message_start', { message: { usage: { input_tokens: 10 } } });
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      push('content_block_start', { index, content_block: { type: 'text' } });
      push('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
      push('content_block_stop', { index });
    } else if (block.type === 'tool_use') {
      push('content_block_start', {
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name },
      });
      push('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) },
      });
      push('content_block_stop', { index });
    }
  });
  push('message_delta', { delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } });
  push('message_stop', {});
  return lines.join('');
}

/** A Response whose body streams the given string as one chunk. */
function sseResponse(text) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** Parse our worker's SSE output into [{ type, data }]. */
async function readWorkerSse(response) {
  const text = await response.text();
  const events = [];
  for (const chunk of text.split('\n\n')) {
    const eventLine = chunk.match(/^event: (.+)$/m);
    const dataLine = chunk.match(/^data: (.+)$/m);
    if (eventLine && dataLine) {
      events.push({ type: eventLine[1], data: JSON.parse(dataLine[1]) });
    }
  }
  return events;
}

function chatRequest(body, headers = {}) {
  return new Request('https://app-ai.test/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Personalizer-Context-ID': 'ctx-123',
      Accept: 'text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('prompts module', () => {
  it('exposes the new Studio system prompts', () => {
    const names = getAvailablePrompts();
    expect(names).toContain('chat');
    expect(names).toContain('onboarding');
    expect(names).toContain('placement');
    expect(names).toContain('image-selection'); // existing, unchanged
  });

  it('placement prompt instructs JSON-only output', () => {
    expect(getSystemPrompt('placement').prompt).toMatch(/ONLY a single JSON object/i);
  });
});

describe('tool definitions', () => {
  it('declares the four data-query tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([
      'get_store_analytics',
      'list_segments',
      'list_campaigns',
      'get_store_config',
    ]);
  });
});

describe('executeTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the matching Brain AI-tool endpoint with the context-ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ AverageOrderValue: 46.0, Currency: 'USD', OrderCount: 12 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await executeTool('get_store_analytics', { fromDate: '2026-01-01' }, 'ctx-9', ENV);
    expect(out.ok).toBe(true);
    expect(out.result.AverageOrderValue).toBe(46.0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://brain.test/v2/ai-tools/store-analytics?fromDate=2026-01-01');
    expect(init.headers['X-Personalizer-Context-ID']).toBe('ctx-9');
  });

  it('returns ok:false (not throw) when Brain fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const out = await executeTool('list_segments', {}, 'ctx', ENV);
    expect(out.ok).toBe(false);
    expect(out.result.error).toMatch(/failed/i);
  });

  it('rejects an unknown tool', async () => {
    const out = await executeTool('nope', {}, 'ctx', ENV);
    expect(out.ok).toBe(false);
  });
});

describe('handleChat — streaming', () => {
  afterEach(() => vi.restoreAllMocks());

  it('streams a plain text turn then done', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(anthropicSse([{ type: 'text', text: 'Hello there' }], 'end_turn')),
        ),
    );

    const res = await handleChat(
      chatRequest({ messages: [{ role: 'user', content: 'hi' }] }),
      ENV,
      CORS,
    );
    const events = await readWorkerSse(res);
    const texts = events.filter((e) => e.type === 'text').map((e) => e.data.delta);
    expect(texts.join('')).toBe('Hello there');
    const done = events.find((e) => e.type === 'done');
    expect(done.data.text).toBe('Hello there');
    expect(done.data.stopReason).toBe('end_turn');
    expect(done.data.iterations).toBe(1);
  });

  it('runs the tool-use loop: tool_call → Brain → tool_result → final text', async () => {
    const anthropicTurn1 = anthropicSse(
      [{ type: 'tool_use', id: 'tu_1', name: 'get_store_analytics', input: {} }],
      'tool_use',
    );
    const anthropicTurn2 = anthropicSse([{ type: 'text', text: 'Your AOV is $46.' }], 'end_turn');
    const fetchMock = vi
      .fn()
      // turn 1: Anthropic asks for the tool
      .mockResolvedValueOnce(sseResponse(anthropicTurn1))
      // Brain AI-tool proxy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ AverageOrderValue: 46 }), { status: 200 }),
      )
      // turn 2: Anthropic final text
      .mockResolvedValueOnce(sseResponse(anthropicTurn2));
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleChat(
      chatRequest({ messages: [{ role: 'user', content: 'what is my AOV?' }] }),
      ENV,
      CORS,
    );
    const events = await readWorkerSse(res);

    expect(events.find((e) => e.type === 'tool_call').data.name).toBe('get_store_analytics');
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult.data.ok).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done.data.text).toContain('$46');
    expect(done.data.iterations).toBe(2);

    // The Brain call was made server→server with the context-ID.
    const brainCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/v2/ai-tools/'));
    expect(brainCall[1].headers['X-Personalizer-Context-ID']).toBe('ctx-123');
  });

  it('caps the loop at MAX_ITERATIONS when the model keeps calling tools', async () => {
    // Every Anthropic turn asks for a tool; Brain always answers.
    const fetchMock = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/v2/ai-tools/')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(
        sseResponse(
          anthropicSse(
            [{ type: 'tool_use', id: 'tu', name: 'list_segments', input: {} }],
            'tool_use',
          ),
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleChat(
      chatRequest({ messages: [{ role: 'user', content: 'loop' }] }),
      ENV,
      CORS,
    );
    const events = await readWorkerSse(res);
    const done = events.find((e) => e.type === 'done');
    expect(done.data.stopReason).toBe('max_iterations');
    expect(done.data.iterations).toBe(8);
  });

  it('placement prompt runs without tools and yields JSON text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(
        anthropicSse(
          [
            {
              type: 'text',
              text: '{"reply":"Place Most Popular after the hero.","proposals":[{"box":"Most Popular","page":"Home","candidateIndex":0,"position":"after"}]}',
            },
          ],
          'end_turn',
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleChat(
      chatRequest(
        {
          messages: [{ role: 'user', content: 'place a box' }],
          context: { hostPage: 'Home', candidates: [{ index: 0, label: 'Hero' }] },
        },
        { 'X-Personalizer-System-Prompt': 'placement' },
      ),
      ENV,
      CORS,
    );
    const events = await readWorkerSse(res);
    const done = events.find((e) => e.type === 'done');
    const parsed = JSON.parse(done.data.text);
    expect(parsed.proposals[0].box).toBe('Most Popular');

    // No tools were sent on the placement request.
    const anthropicBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(anthropicBody.tools).toBeUndefined();
  });

  it('emits an error event when Anthropic fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    const res = await handleChat(
      chatRequest({ messages: [{ role: 'user', content: 'hi' }] }),
      ENV,
      CORS,
    );
    const events = await readWorkerSse(res);
    expect(events.find((e) => e.type === 'error')).toBeTruthy();
  });

  it('rejects an empty message list', async () => {
    const res = await handleChat(chatRequest({ messages: [] }), ENV, CORS);
    const events = await readWorkerSse(res);
    expect(events.find((e) => e.type === 'error')).toBeTruthy();
  });
});

describe('handleChat — non-streaming JSON', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a single JSON object identical to the done payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(sseResponse(anthropicSse([{ type: 'text', text: 'Hi' }], 'end_turn'))),
    );
    const req = chatRequest(
      { messages: [{ role: 'user', content: 'hi' }] },
      { Accept: 'application/json' },
    );
    const res = await handleChat(req, ENV, CORS);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const json = await res.json();
    expect(json.text).toBe('Hi');
    expect(json.stopReason).toBe('end_turn');
  });
});
