/**
 * POST /chat — Studio AI chat agent loop + SSE streaming.
 *
 * (see lib CONTRACTS.md §1). The client sends a system-prompt selector (header),
 * a message history, and optional grounding context. We run the Anthropic model
 * with the tool-use agent loop:
 *
 *   model → (tool_use?) → execute Brain AI-tool → tool_result → model → …
 *
 * bounded by MAX_ITERATIONS, streaming text out as it arrives. Two response
 * shapes, picked by the client's Accept header:
 *   • Accept: text/event-stream  → our SSE protocol (text/tool_call/tool_result/done/error)
 *   • otherwise                  → a single JSON object identical to the `done` payload
 *
 * The Anthropic key never leaves the worker (it lives in the anthropic client).
 * Tools call Brain server→server, forwarding the merchant's context-ID (tools.js).
 *
 * Per-prompt model / token / tool choices come from the prompt registry
 * (prompts.js) — the single source of truth.
 */

import { getSystemPrompt } from '../prompts.js';
import { TOOL_DEFINITIONS, executeTool } from '../tools.js';
import { streamMessage, supportsEffort, getFileMetadata } from '../lib/anthropic.js';
import { EXTENDED_CACHE_CONTROL } from '../lib/cache-control.js';
import { applyConversationBreakpoints } from '../lib/agent-cache.js';

/** Hard cap on model↔tool iterations (CONTRACTS.md §1). */
const MAX_ITERATIONS = 8;

/**
 * Handle POST /chat. `contextId` is already validated by the caller.
 * Returns a streaming `Response` (SSE) or a JSON `Response`.
 */
export async function handleChat(request, env, corsHeaders) {
  const systemPromptName = request.headers.get('X-Personalizer-System-Prompt') || 'chat';
  const wantsStream = (request.headers.get('Accept') || '').includes('text/event-stream');
  const contextId = request.headers.get('X-Personalizer-Context-ID');

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body', corsHeaders, wantsStream);
  }

  const { messages, fileBlockCount } = await normalizeMessages(body.messages, body.fileIds, env);
  if (messages.length === 0) {
    return badRequest('messages must be a non-empty array', corsHeaders, wantsStream);
  }

  // The registry is the single source of truth for per-prompt model / token /
  // tool choices. Unknown selectors fall back to the `chat` entry.
  let entry;
  try {
    entry = getSystemPrompt(systemPromptName);
  } catch {
    entry = getSystemPrompt('chat');
  }

  const system = buildSystem(entry, body.context);
  const model = body.model || entry.model;
  const maxTokens = body.max_tokens || entry.maxTokens;
  const tools = entry.usesTools ? TOOL_DEFINITIONS : undefined;
  // Opt-in output effort: registry entry default, client `effort` override.
  const effort = body.effort || entry.effort;

  const runner = (emit) =>
    runAgentLoop(
      { env, contextId, model, maxTokens, system, messages, tools, effort, fileBlockCount },
      emit,
    );

  if (wantsStream) {
    return streamResponse(runner, corsHeaders);
  }
  return jsonResponse(runner, corsHeaders);
}

/**
 * Build the `system` array: the selected server-side prompt, plus any grounding
 * context the client supplied (current page, validated candidates, best-practice
 * catalog). The base prompt is cached; the volatile context is a separate block.
 */
export function buildSystem(entry, context) {
  // The base prompt is a stable, reused prefix → 1h extended cache. The
  // volatile context block below carries NO cache_control (it changes per call).
  const blocks = [
    { type: 'text', text: entry.prompt, cache_control: { ...EXTENDED_CACHE_CONTROL } },
  ];

  if (context && typeof context === 'object') {
    const lines = [];
    if (context.hostPage) lines.push(`Current page: ${context.hostPage}.`);
    if (Array.isArray(context.candidates) && context.candidates.length > 0) {
      lines.push('Validated placement candidates (pick by index):');
      lines.push(JSON.stringify(context.candidates));
    }
    if (context.grounding) {
      lines.push('LimeSpot best-practice catalog (ground recommendations in this):');
      lines.push(JSON.stringify(context.grounding));
    }
    if (lines.length > 0) {
      blocks.push({ type: 'text', text: lines.join('\n') });
    }
  }

  return blocks;
}

/**
 * Normalize the client message history into Anthropic message params. Optionally
 * prepend uploaded file blocks (document/image) to the first user turn — used by
 * the placement flow (screenshot + cleaned HTML uploaded via /files).
 *
 * The file blocks are a STABLE per-page prefix: the same screenshot + cleaned
 * HTML bytes are reused across repeated placement calls on one page, and (via
 * the /files content-hash dedup) map to the same file_id. We mark the LAST file
 * block with the 1h extended cache breakpoint so the whole file prefix caches at
 * 0.1× on the second call. This is the big placement token cost — file blocks
 * dwarf the 370-token system prompt. The breakpoint budget stays ≤4: this file
 * prefix takes 1, the system base block 1, leaving 2 for conversation turns (see
 * `applyConversationBreakpoints` opts in `runAgentLoop`). The file prefix consumes
 * exactly ONE breakpoint regardless of how many `fileIds` are passed (only the
 * last block is marked), so the ≤4 budget is independent of the file count.
 * Returns the file-block count so the caller can size the conversation breakpoint cap.
 *
 * Each fileId is resolved to the correct content-block type by its mime type:
 * images (`image/*`) MUST be `image` blocks — Anthropic rejects an image inside
 * a `document` block ("Only PDF and plaintext documents are supported"), which
 * is exactly the screenshot the placement flow uploads. PDFs/plaintext become
 * `document` blocks. The mime type comes from the Files API metadata; if the
 * lookup fails we fall back to `document` (the prior behavior).
 * @returns {Promise<{ messages: Array<object>, fileBlockCount: number }>}
 */
async function normalizeMessages(raw, fileIds, env) {
  if (!Array.isArray(raw)) return { messages: [], fileBlockCount: 0 };
  const messages = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content != null)
    .map((m) => ({ role: m.role, content: m.content }));

  let fileBlockCount = 0;
  if (Array.isArray(fileIds) && fileIds.length > 0 && messages.length > 0) {
    const fileBlocks = await Promise.all(fileIds.map((id) => buildFileBlock(id, env)));
    // Cache the stable file prefix: one breakpoint on the last file block caches
    // all file blocks before it (prefix match). 1h TTL — reused across a page's
    // placement calls, which can be minutes apart.
    fileBlocks[fileBlocks.length - 1].cache_control = { ...EXTENDED_CACHE_CONTROL };
    fileBlockCount = fileBlocks.length;

    const first = messages[0];
    const existing = Array.isArray(first.content)
      ? first.content
      : [{ type: 'text', text: String(first.content) }];
    first.content = [...fileBlocks, ...existing];
  }

  return { messages, fileBlockCount };
}

/**
 * Build the content block for one uploaded fileId, choosing `image` vs
 * `document` from the file's mime type (Files API metadata). Images must be
 * `image` blocks; everything else is a `document` block. A metadata-lookup
 * failure falls back to `document`.
 * @param {string} fileId
 * @param {object} env
 * @returns {Promise<object>}
 */
async function buildFileBlock(fileId, env) {
  let isImage = false;
  try {
    const response = await getFileMetadata(fileId, env);
    if (response.ok) {
      const meta = await response.json();
      isImage = typeof meta.mime_type === 'string' && meta.mime_type.startsWith('image/');
    }
  } catch {
    // fall back to document
  }
  return {
    type: isImage ? 'image' : 'document',
    source: { type: 'file', file_id: fileId },
  };
}

/**
 * The core agent loop. `emit` is an async callback receiving our SSE events
 * `{ type, data }`. Returns the terminal `done` payload. Runs the Anthropic
 * model with streaming; on a `tool_use` stop it executes the tool(s) via Brain
 * and loops, up to MAX_ITERATIONS.
 */
async function runAgentLoop(
  { env, contextId, model, maxTokens, system, messages, tools, effort, fileBlockCount = 0 },
  emit,
) {
  const conversation = [...messages];
  let fullText = '';
  let usage = null;
  let stopReason = null;
  let iterations = 0;

  // Breakpoint budget (≤4 total). System base block holds 1. When a placement
  // file prefix is present it holds 1 more (its own 1h breakpoint, set in
  // normalizeMessages and reserved across iterations), leaving 2 for the
  // conversation; otherwise the conversation gets the usual 3.
  const conversationBreakpoints = fileBlockCount > 0 ? 2 : 3;

  for (iterations = 1; iterations <= MAX_ITERATIONS; iterations++) {
    // Place cache breakpoints on the growing conversation turns (re-stripped +
    // re-applied each iteration so they never accumulate past the 4-block cap).
    // The file prefix's 1h breakpoint is reserved (not stripped, not counted).
    applyConversationBreakpoints(conversation, {
      maxBreakpoints: conversationBreakpoints,
      reservedHeadBlocks: fileBlockCount,
    });

    const payload = {
      model,
      max_tokens: maxTokens,
      system,
      messages: conversation,
    };
    if (tools && tools.length > 0) payload.tools = tools;
    // Effort is a real token-saving lever, but only valid on models that
    // support it — attaching it to a model that doesn't (e.g. Haiku 4.5) returns
    // a 400. Gate on the model's capability so unsupported models simply omit it.
    if (effort && supportsEffort(model)) payload.output_config = { effort };

    const turn = await streamAnthropicTurn(payload, env, emit);
    usage = turn.usage || usage;
    stopReason = turn.stopReason;
    if (turn.text) fullText += (fullText ? '\n' : '') + turn.text;

    // Append the assistant turn (text + any tool_use blocks) to the conversation.
    conversation.push({ role: 'assistant', content: turn.content });

    if (turn.stopReason !== 'tool_use' || turn.toolUses.length === 0) {
      break; // natural end (or max_tokens / refusal) — done.
    }

    // Execute every tool the model requested; collect tool_result blocks.
    const toolResults = [];
    for (const tu of turn.toolUses) {
      if (emit) {
        await emit({ type: 'tool_call', data: { id: tu.id, name: tu.name, input: tu.input } });
      }
      const exec = await executeTool(tu.name, tu.input, contextId, env);
      if (emit) {
        await emit({
          type: 'tool_result',
          data: {
            id: tu.id,
            name: tu.name,
            ok: exec.ok,
            summary: exec.summary,
            ...(exec.ok ? {} : { error: exec.result.error }),
          },
        });
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(exec.result),
        is_error: !exec.ok,
      });
    }
    conversation.push({ role: 'user', content: toolResults });
    // loop continues — model sees the tool results next iteration.
  }

  if (stopReason === 'tool_use') {
    // Hit the iteration cap mid-tool-loop.
    stopReason = 'max_iterations';
  }

  // The `for` increments past the cap on the exit check — report the real count.
  const ranIterations = Math.min(iterations, MAX_ITERATIONS);

  return { text: fullText, stopReason, iterations: ranIterations, usage };
}

/**
 * Stream a single Anthropic turn. Parses Anthropic's SSE, re-emits text deltas
 * as our `text` events, and accumulates the assistant content blocks (text +
 * tool_use). Returns `{ content, text, toolUses, stopReason, usage }`.
 */
async function streamAnthropicTurn(payload, env, emit) {
  const response = await streamMessage(payload, env);

  if (!response.ok || !response.body) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Anthropic request failed (${response.status}): ${errBody}`);
  }

  // Per-index block accumulators.
  const blocks = []; // { type, text? , id?, name?, inputJson? }
  let stopReason = null;
  let usage = null;
  let text = '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Anthropic SSE: lines of `event: <type>` then `data: <json>`, blank-separated.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (!json) continue;

      let evt;
      try {
        evt = JSON.parse(json);
      } catch {
        continue;
      }

      switch (evt.type) {
        case 'content_block_start': {
          const cb = evt.content_block || {};
          if (cb.type === 'text') {
            blocks[evt.index] = { type: 'text', text: '' };
          } else if (cb.type === 'tool_use') {
            blocks[evt.index] = { type: 'tool_use', id: cb.id, name: cb.name, inputJson: '' };
          } else {
            blocks[evt.index] = { type: cb.type || 'unknown' };
          }
          break;
        }
        case 'content_block_delta': {
          const d = evt.delta || {};
          const block = blocks[evt.index];
          if (!block) break;
          if (d.type === 'text_delta') {
            block.text = (block.text || '') + d.text;
            text += d.text;
            if (emit) await emit({ type: 'text', data: { delta: d.text } });
          } else if (d.type === 'input_json_delta') {
            block.inputJson = (block.inputJson || '') + (d.partial_json || '');
          }
          break;
        }
        case 'message_delta': {
          if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
          if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
          break;
        }
        case 'message_start': {
          if (evt.message && evt.message.usage) usage = { ...evt.message.usage };
          break;
        }
        case 'error': {
          throw new Error(`Anthropic stream error: ${evt.error?.message || 'unknown'}`);
        }
        default:
          break;
      }
    }
  }

  // Finalize blocks into Anthropic content + extract tool_use blocks.
  const content = [];
  const toolUses = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text || '' });
    } else if (block.type === 'tool_use') {
      let input = {};
      try {
        input = block.inputJson ? JSON.parse(block.inputJson) : {};
      } catch {
        input = {};
      }
      content.push({ type: 'tool_use', id: block.id, name: block.name, input });
      toolUses.push({ id: block.id, name: block.name, input });
    }
  }

  return { content, text, toolUses, stopReason, usage };
}

/** Build a streaming SSE Response that drives the agent loop. */
function streamResponse(runner, corsHeaders) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = async ({ type, data }) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const done = await runner(emit);
        await emit({ type: 'done', data: done });
      } catch (error) {
        await emit({ type: 'error', data: { message: error.message || 'Internal error' } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

/** Build a non-streaming JSON Response (same final payload as the `done` event). */
async function jsonResponse(runner, corsHeaders) {
  try {
    const done = await runner(null);
    return new Response(JSON.stringify(done), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: { message: error.message || 'Internal error' } }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

/** Early bad-request helper — SSE error event or JSON, matching the request's Accept. */
function badRequest(message, corsHeaders, wantsStream) {
  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream; charset=utf-8' },
    });
  }
  return new Response(JSON.stringify({ error: { message } }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
