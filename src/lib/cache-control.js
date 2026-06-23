/**
 * Prompt-caching `cache_control` management for the /messages proxy.
 *
 * Anthropic allows at most 4 `cache_control` breakpoints per request. The
 * system prompt and any prompt-attachment files (uploaded by the image-selection
 * flow) each claim a slot; this module distributes the REMAINING slots across the
 * largest user content blocks (images > documents) in the first user message and
 * strips `cache_control` from the rest, so the request never exceeds the 4-block
 * limit. The smart-image path depends on this distribution.
 */

import { createLogger } from './logger.js';

const log = createLogger('CacheControl');

/** Anthropic's hard limit on cache_control breakpoints per request. */
const MAX_CACHE_BLOCKS = 4;

/**
 * Extended 1-hour cache breakpoint. Used for the STABLE prefix (system prompt,
 * reused file attachments, per-page reused user images/HTML) so the cache
 * survives traffic gaps between requests. 1h TTL is GA — no beta header needed.
 * 1h write costs 2× base input; reads are 0.1× (break-even ≥3 requests).
 */
export const EXTENDED_CACHE_CONTROL = { type: 'ephemeral', ttl: '1h' };

/** Rough byte-size estimates used only to rank user blocks by cache value. */
const IMAGE_SIZE_ESTIMATE = 1000000;
const DOCUMENT_SIZE_ESTIMATE = 100000;

/**
 * Mutate `claudePayload` in place so its `cache_control` breakpoints respect the
 * 4-block limit. The system prompt and the `attachmentFileCount` attachment blocks
 * prepended to the first user message each claim a slot; the remaining slots are
 * distributed across the largest user content blocks (images > documents) and
 * `cache_control` is stripped from the rest.
 * @param {object} claudePayload The Anthropic Messages request body.
 * @param {number} [attachmentFileCount=0] Number of prompt-attachment blocks prepended to the first user message (exact count from the caller — never re-derived heuristically).
 */
export function manageCacheControl(claudePayload, attachmentFileCount = 0) {
  if (!claudePayload.messages || claudePayload.messages.length === 0) {
    return;
  }

  const firstMessage = claudePayload.messages[0];
  if (!Array.isArray(firstMessage.content)) {
    return;
  }

  const systemCacheBlocks = claudePayload.system ? 1 : 0;
  const usedCacheSlots = systemCacheBlocks + attachmentFileCount;
  const remainingSlots = MAX_CACHE_BLOCKS - usedCacheSlots;

  log.info(
    `${usedCacheSlots}/${MAX_CACHE_BLOCKS} slots used (${systemCacheBlocks} system + ${attachmentFileCount} attachments), ${remainingSlots} available for user content`,
  );

  // The prepended attachment blocks are the first `attachmentFileCount` entries;
  // everything after them is user content eligible for the remaining slots.
  // Rank by estimated size (largest caches best).
  const userBlocks = firstMessage.content
    .slice(attachmentFileCount)
    .map((block) => ({
      block,
      size:
        block.type === 'image'
          ? IMAGE_SIZE_ESTIMATE
          : block.type === 'document'
            ? DOCUMENT_SIZE_ESTIMATE
            : 0,
    }))
    .filter((item) => item.size > 0);

  if (remainingSlots > 0) {
    userBlocks.sort((a, b) => b.size - a.size);

    userBlocks.slice(0, remainingSlots).forEach((item) => {
      item.block.cache_control = { ...EXTENDED_CACHE_CONTROL };
      log.info(`Applied cache to user ${item.block.type} (~${Math.round(item.size / 1024)}KB)`);
    });

    userBlocks.slice(remainingSlots).forEach((item) => {
      if (item.block.cache_control) {
        delete item.block.cache_control;
        log.info(`Removed cache from user ${item.block.type} (insufficient slots)`);
      }
    });
  } else {
    userBlocks.forEach((item) => {
      if (item.block.cache_control) {
        delete item.block.cache_control;
        log.info(`Removed cache from user ${item.block.type} (no slots available)`);
      }
    });

    if (remainingSlots < 0) {
      log.warn('More than 4 cache blocks detected! This will cause an API error.');
    }
  }
}
