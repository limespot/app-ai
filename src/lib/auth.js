/**
 * Context-ID authentication.
 *
 * Every endpoint except /health requires an `X-Personalizer-Context-ID` header,
 * validated server→server against Brain's administrator-authentication endpoint.
 * Brain owns the subscriber/tenant mapping; this worker only checks that the
 * context-ID is currently valid before proxying to Anthropic.
 *
 * `validateContextId` throws on any failure (missing/invalid ID, Brain
 * unreachable, non-2xx). The router catches the throw and returns a 500 with the
 * error message.
 */

import { createLogger } from './logger.js';

const log = createLogger('Auth');

const DEFAULT_BRAIN_URL = 'https://personalizer.io';

/**
 * Validate a context-ID against Brain.
 * @param {string|null} contextId
 * @param {object} env
 * @returns {Promise<object>} Brain's validation payload on success.
 * @throws {Error} If the context-ID is missing or Brain rejects it.
 */
export async function validateContextId(contextId, env) {
  if (!contextId) {
    throw new Error('Context ID is required');
  }

  const brainUrl = env.BRAIN_API_URL || DEFAULT_BRAIN_URL;
  const validateUrl = `${brainUrl}/v2/administrator-authentication/validate-context-id`;

  let response;
  try {
    response = await fetch(validateUrl, {
      method: 'GET',
      headers: {
        'X-Personalizer-Context-ID': contextId,
        'Content-Type': 'application/json',
      },
    });
  } catch (fetchError) {
    log.error('Fetch to Brain failed:', fetchError.message);
    throw fetchError;
  }

  if (!response.ok) {
    const errorText = await response.text();
    log.error(`Validation failed: ${response.status} ${response.statusText}`, errorText);
    throw new Error(
      `Context validation failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = await response.json();
  log.info(`Validated subscriber ${data.SubscriberTitle} (ID: ${data.SubscriberID})`);
  return data;
}
