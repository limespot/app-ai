/**
 * Scoped console logger.
 *
 * In a Cloudflare Worker, `console.*` IS the observability mechanism — logs are
 * read live via `wrangler tail`. This helper just prefixes each line with a
 * scope tag so a single grep over a tail can isolate one subsystem's output.
 *
 *   const log = createLogger('Messages');
 *   log.info('request received');   // → [Messages] request received
 *
 * Levels map to the matching `console` method so log-level filtering in the
 * Cloudflare dashboard still works.
 */

/**
 * @param {string} scope Short subsystem tag, e.g. `'Messages'` or `'Auth'`.
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger(scope) {
  const tag = `[${scope}]`;
  return {
    info: (...args) => console.log(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
}
