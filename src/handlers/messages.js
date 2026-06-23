/**
 * POST /messages — single-shot Anthropic Messages proxy (the LIVE smart-image
 * surface). Optionally injects a server-side system prompt (selected by the
 * `X-Personalizer-System-Prompt` header), uploads any prompt attachments to the
 * Files API and prepends them to the first user message, manages the 4-block
 * `cache_control` limit, then proxies to Anthropic and returns the body as-is.
 *
 * The proxy is transparent: the response body, status code, attachment handling,
 * and cache-control distribution all flow through to the caller unchanged.
 */

import { getSystemPrompt } from '../prompts.js';
import * as anthropic from '../lib/anthropic.js';
import { manageCacheControl, EXTENDED_CACHE_CONTROL } from '../lib/cache-control.js';
import { dedupUpload } from '../lib/file-dedup.js';
import { jsonResponse, errorResponse } from '../lib/responses.js';
import { createLogger } from '../lib/logger.js';

/**
 * Soft input-token threshold above which we log a count_tokens estimate (and a
 * warning). Purely advisory — NEVER gates/rejects the live request.
 */
const LARGE_PAYLOAD_TOKEN_THRESHOLD = 100000;

const log = createLogger('Messages');

/**
 * @param {Request} request
 * @param {object} env
 * @param {Record<string, string>} corsHeaders
 * @returns {Promise<Response>}
 */
export async function handleMessages(request, env, corsHeaders) {
  try {
    const contextId = request.headers.get('X-Personalizer-Context-ID');
    const systemPromptName = request.headers.get('X-Personalizer-System-Prompt');

    log.info(
      `Request${contextId ? ` (context ${contextId})` : ''}${systemPromptName ? ` (prompt ${systemPromptName})` : ''}`,
    );

    const body = await request.json();
    const { apiKey: _apiKey, ...claudePayload } = body;

    let attachmentFileCount = 0;
    if (systemPromptName) {
      try {
        attachmentFileCount = await injectSystemPrompt(systemPromptName, claudePayload, env);
      } catch (error) {
        log.error(`Failed to load system prompt: ${error.message}`);
      }
    }

    manageCacheControl(claudePayload, attachmentFileCount);

    // Apply opt-in output effort from the registry entry, if the client didn't
    // already set output_config (additive + safe — see prompts.js entry shape).
    applyRegistryEffort(claudePayload, systemPromptName);

    // Best-effort pre-flight token estimate for large payloads — log/warn only,
    // never gate the live path.
    await preflightTokenEstimate(claudePayload, env);

    const response = await anthropic.createMessage(claudePayload, env);
    const data = await response.json();

    if (!response.ok) {
      log.error(`Anthropic error: ${data.error?.type} — ${data.error?.message}`);
      return jsonResponse(data, corsHeaders, response.status);
    }

    logUsageStats(data.usage);
    return jsonResponse(data, corsHeaders);
  } catch (error) {
    log.error('Exception:', error.message);
    return errorResponse(error.message || 'Internal proxy server error', corsHeaders);
  }
}

/**
 * Inject a server-side system prompt into the payload, uploading any attachment
 * files and prepending them (as document/image content blocks) to the first
 * user message. Mutates `claudePayload`.
 * @param {string} systemPromptName
 * @param {object} claudePayload
 * @param {object} env
 * @returns {Promise<number>} The number of attachment blocks prepended to the first user message.
 */
async function injectSystemPrompt(systemPromptName, claudePayload, env) {
  const prompt = getSystemPrompt(systemPromptName);

  claudePayload.system = [
    { type: 'text', text: prompt.prompt, cache_control: { ...EXTENDED_CACHE_CONTROL } },
  ];
  log.info(`Loaded system prompt: ${systemPromptName} (${prompt.prompt.length} chars)`);

  if (!prompt.attachments || prompt.attachments.length === 0) {
    return 0;
  }

  log.info(`Processing ${prompt.attachments.length} prompt attachment(s)`);
  const attachmentBlocks = [];

  for (const attachment of prompt.attachments) {
    let fileId = null;
    try {
      const result = await dedupUpload(
        {
          content: attachment.content,
          mimeType: attachment.mimeType,
          filename: attachment.filename,
        },
        env,
      );
      fileId = result.fileId;
      log.info(
        `Attachment ${attachment.filename}: file_id ${fileId}${result.deduped ? ' (dedup hit)' : ''}`,
      );
    } catch (error) {
      log.error(`Failed to upload ${attachment.filename}: ${error.message}`);
      continue;
    }

    if (!fileId) {
      log.error(`No file_id for ${attachment.filename}; skipping attachment`);
      continue;
    }

    attachmentBlocks.push({
      type: attachment.mimeType.startsWith('image/') ? 'image' : 'document',
      source: { type: 'file', file_id: fileId },
      // Reused across calls → stable prefix → extended 1h cache.
      cache_control: { ...EXTENDED_CACHE_CONTROL },
    });
  }

  if (attachmentBlocks.length > 0 && claudePayload.messages?.length > 0) {
    const firstMessage = claudePayload.messages[0];
    const existing = Array.isArray(firstMessage.content)
      ? firstMessage.content
      : [{ type: 'text', text: firstMessage.content }];
    firstMessage.content = [...attachmentBlocks, ...existing];
    log.info(`Prepended ${attachmentBlocks.length} prompt attachment(s) to first message`);
    return attachmentBlocks.length;
  }
  return 0;
}

/**
 * Add `output_config: { effort }` from the registry entry IF the entry carries
 * an `effort` field, the resolved model supports effort, AND the client hasn't
 * already set `output_config`. The effort lever is only valid on supporting
 * models — sending it to one that doesn't (e.g. Haiku 4.5) returns a 400 — so
 * it is gated on `supportsEffort`. Additive and safe otherwise: no entry / no
 * effort / unsupported model leaves the payload untouched.
 * @param {object} claudePayload
 * @param {string|null} systemPromptName
 */
function applyRegistryEffort(claudePayload, systemPromptName) {
  if (!systemPromptName || claudePayload.output_config) {
    return;
  }
  let entry;
  try {
    entry = getSystemPrompt(systemPromptName);
  } catch {
    return;
  }
  const model = claudePayload.model || entry.model;
  if (entry.effort && anthropic.supportsEffort(model)) {
    claudePayload.output_config = { effort: entry.effort };
    log.info(`Applied output effort '${entry.effort}' from registry`);
  }
}

/**
 * Best-effort pre-flight token estimate. For large payloads, calls the free
 * count_tokens endpoint and logs the estimate (warns past a soft threshold).
 * NEVER throws into the live path and NEVER rejects the request.
 * @param {object} claudePayload
 * @param {object} env
 */
async function preflightTokenEstimate(claudePayload, env) {
  // Cheap gate: only bother for payloads likely to be large (attachments or a
  // long message history). Avoids a network round-trip on every small request.
  const messageCount = Array.isArray(claudePayload.messages) ? claudePayload.messages.length : 0;
  const hasAttachments =
    Array.isArray(claudePayload.messages) &&
    claudePayload.messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'image' || b.type === 'document'),
    );
  if (messageCount < 4 && !hasAttachments) {
    return;
  }

  try {
    const response = await anthropic.countTokens(claudePayload, env);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const inputTokens = data.input_tokens || 0;
    log.info(`Pre-flight count_tokens estimate: ${inputTokens} input tokens`);
    if (inputTokens > LARGE_PAYLOAD_TOKEN_THRESHOLD) {
      log.warn(
        `Large payload: ~${inputTokens} input tokens (>${LARGE_PAYLOAD_TOKEN_THRESHOLD}) — consider chunking or a larger-context model`,
      );
    }
  } catch (error) {
    log.info(`count_tokens pre-flight skipped: ${error.message}`);
  }
}

/** Log token-usage stats with cache-hit/creation markers. */
function logUsageStats(usage) {
  if (!usage) {
    return;
  }
  log.info(
    `Tokens — input: ${usage.input_tokens}, cache_creation: ${usage.cache_creation_input_tokens || 0}, cache_read: ${usage.cache_read_input_tokens || 0}, output: ${usage.output_tokens}`,
  );
}
