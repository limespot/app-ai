/**
 * GET /health — liveness check. No auth, no Anthropic call.
 */

import { jsonResponse } from '../lib/responses.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Health');

/**
 * @param {Record<string, string>} corsHeaders
 * @returns {Response}
 */
export function handleHealth(corsHeaders) {
  log.info('Health check requested');
  return jsonResponse(
    {
      status: 'ok',
      message: 'App AI service is running',
      timestamp: new Date().toISOString(),
    },
    corsHeaders,
  );
}
