/**
 * Shared HTTP response helpers — one place for the response/error JSON shape so
 * handlers never copy-paste `new Response(JSON.stringify(...), { headers: {...} })`.
 *
 * The error shape is `{ error: { message } }` (Anthropic-compatible) so clients
 * parse worker errors the same way they parse Anthropic's.
 */

/**
 * Build a JSON `Response`.
 * @param {unknown} data Serialized as the body.
 * @param {Record<string, string>} corsHeaders
 * @param {number} [status=200]
 * @returns {Response}
 */
export function jsonResponse(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Build a JSON error `Response` with the shape `{ error: { message } }`.
 * @param {string} message
 * @param {Record<string, string>} corsHeaders
 * @param {number} [status=500]
 * @returns {Response}
 */
export function errorResponse(message, corsHeaders, status = 500) {
  return jsonResponse({ error: { message } }, corsHeaders, status);
}
