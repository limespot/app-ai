/**
 * Anthropic API client — the ONE place the worker talks to api.anthropic.com.
 *
 * Centralizes the base URLs, the `anthropic-version`, the beta flags, and the
 * `x-api-key` injection so no handler re-implements the fetch/header dance. The
 * Anthropic key (`env.CLAUDE_API_KEY`) never leaves this module's callers.
 *
 * Surface:
 *   - uploadFile / listFiles / deleteFile  → Files API (/v1/files)
 *   - createMessage                        → Messages API, non-streaming
 *   - streamMessage                        → Messages API, streaming (returns the raw Response)
 *
 * Beta flags live here: Files API calls send `files-api-2025-04-14`; Messages
 * API calls send `prompt-caching-2024-07-31,files-api-2025-04-14`.
 */

const API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const FILES_BETA = 'files-api-2025-04-14';
const MESSAGES_BETA = 'prompt-caching-2024-07-31,files-api-2025-04-14';

/**
 * Models that accept `output_config.effort`. The effort lever is a real
 * token-saving control, but it is only valid on this set — sending it to any
 * other model (e.g. Haiku 4.5, Sonnet 4.5) returns a 400
 * `invalid_request_error: "This model does not support the effort parameter."`.
 * Keep this list in lockstep with the Anthropic model catalog.
 */
const EFFORT_SUPPORTED_MODELS = new Set([
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-4-6',
]);

/**
 * Whether a model accepts the `output_config.effort` parameter. Callers use
 * this to gate attaching `output_config: { effort }` to a Messages payload, so
 * the effort lever is applied on supporting models and silently omitted (no
 * 400) on models that don't support it.
 * @param {string} model An Anthropic model id.
 * @returns {boolean}
 */
export function supportsEffort(model) {
  return EFFORT_SUPPORTED_MODELS.has(model);
}

/** Headers for Files API requests (no Content-Type — set by FormData / method). */
function filesHeaders(env) {
  return {
    'x-api-key': env.CLAUDE_API_KEY,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': FILES_BETA,
  };
}

/** Headers for Messages API requests (JSON body). */
function messagesHeaders(env) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': env.CLAUDE_API_KEY,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': MESSAGES_BETA,
  };
}

/**
 * Upload a file to the Anthropic Files API.
 * @param {FormData} formData Must contain the `file` field.
 * @param {object} env
 * @returns {Promise<Response>} The raw Anthropic response.
 */
export function uploadFile(formData, env) {
  return fetch(`${API_BASE}/files`, {
    method: 'POST',
    headers: filesHeaders(env),
    body: formData,
  });
}

/**
 * List files in the Anthropic Files API.
 * @param {object} env
 * @returns {Promise<Response>}
 */
export function listFiles(env) {
  return fetch(`${API_BASE}/files`, { headers: filesHeaders(env) });
}

/**
 * Fetch a file's metadata from the Anthropic Files API (GET /v1/files/{id}).
 * Returns 200 when the file still exists, 404 when it has been deleted or is
 * otherwise gone. Used by the dedup layer to verify a cached file_id before
 * reuse so a stale id is never vended downstream.
 * @param {string} fileId
 * @param {object} env
 * @returns {Promise<Response>}
 */
export function getFileMetadata(fileId, env) {
  return fetch(`${API_BASE}/files/${fileId}`, { headers: filesHeaders(env) });
}

/**
 * Delete a file from the Anthropic Files API.
 * @param {string} fileId
 * @param {object} env
 * @returns {Promise<Response>}
 */
export function deleteFile(fileId, env) {
  return fetch(`${API_BASE}/files/${fileId}`, {
    method: 'DELETE',
    headers: filesHeaders(env),
  });
}

/**
 * Call the Messages API non-streaming.
 * @param {object} payload The Anthropic Messages request body.
 * @param {object} env
 * @returns {Promise<Response>}
 */
export function createMessage(payload, env) {
  return fetch(`${API_BASE}/messages`, {
    method: 'POST',
    headers: messagesHeaders(env),
    body: JSON.stringify(payload),
  });
}

/**
 * Pre-flight token count via the free `/v1/messages/count_tokens` endpoint.
 * Returns the exact model-specific `input_tokens` a prospective request would
 * cost. Pass the SAME model id you'll infer with. Only the count-accepted
 * fields are forwarded (model / system / messages / tools) — `max_tokens`,
 * `stream`, `output_config` and any other inference-only fields are stripped.
 * Returns the raw `Response` (consistent with createMessage); callers `.json()`.
 * @param {object} payload A Messages-style request body.
 * @param {object} env
 * @returns {Promise<Response>}
 */
export function countTokens(payload, env) {
  const body = { model: payload.model, messages: payload.messages };
  if (payload.system) body.system = payload.system;
  if (payload.tools) body.tools = payload.tools;
  return fetch(`${API_BASE}/messages/count_tokens`, {
    method: 'POST',
    headers: messagesHeaders(env),
    body: JSON.stringify(body),
  });
}

/**
 * Call the Messages API with `stream: true`. Returns the raw `Response` so the
 * caller can read the SSE body itself.
 * @param {object} payload The Anthropic Messages request body (stream is forced on).
 * @param {object} env
 * @returns {Promise<Response>}
 */
export function streamMessage(payload, env) {
  return fetch(`${API_BASE}/messages`, {
    method: 'POST',
    headers: messagesHeaders(env),
    body: JSON.stringify({ ...payload, stream: true }),
  });
}
