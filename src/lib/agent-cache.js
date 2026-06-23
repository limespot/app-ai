/**
 * Agent-loop prompt-cache breakpoints for the /chat conversation turns.
 *
 * The agent loop sends a cached system prefix (system + tools share one
 * breakpoint, since they render before `messages`), then a GROWING list of
 * conversation turns. Without a breakpoint on those turns, each iteration
 * re-reads the whole prior conversation uncached past the system prefix.
 *
 * This module places `cache_control` breakpoints on conversation message blocks
 * so subsequent iterations read the prior turns at the cache rate. Constraints:
 *
 *   • Max 4 breakpoints TOTAL per request. The system base block already uses
 *     1, so message breakpoints are capped at 3 (the default `maxBreakpoints`).
 *   • A breakpoint walks back at most 20 content blocks to find a prior cache
 *     entry. In long tool-heavy turns we add intermediate breakpoints roughly
 *     every `interval` (~15) blocks so no two are >20 apart and the lookback
 *     never silently misses.
 *   • Conversation turns are short-lived → 5-minute (default) ephemeral cache,
 *     NOT the 1h extended TTL (that's for the stable system/attachment prefix).
 *   • Stale breakpoints from a prior iteration are STRIPPED first, so re-running
 *     each iteration never accumulates past the cap.
 *
 * `cache_control` attaches to a content BLOCK object. Assistant turns carry an
 * array of `{type:'text'|'tool_use'}` blocks; tool_result user turns carry an
 * array of `{type:'tool_result',…}` blocks. We attach to the last block object
 * of a chosen message and count blocks by summing array lengths.
 */

/** 5-minute ephemeral breakpoint for the volatile, short-lived conversation. */
const CONVERSATION_CACHE_CONTROL = { type: 'ephemeral' };

/**
 * Mutate `messages` in place: strip any existing conversation `cache_control`,
 * then re-apply up to `maxBreakpoints` breakpoints — always on the last block
 * of the last message, plus intermediate breakpoints stepping back ~`interval`
 * blocks so no gap exceeds 20.
 *
 * `reservedHeadBlocks` protects a fixed-size STABLE prefix at the very front of
 * the conversation (the placement file blocks: screenshot + cleaned HTML, which
 * carry their own 1h extended-cache breakpoint set elsewhere). Those leading
 * blocks are neither stripped nor counted as conversation breakpoints, so their
 * 1h breakpoint survives every iteration and the per-request total stays ≤4
 * (1 system + 1 file-prefix + `maxBreakpoints` conversation; callers pass
 * `maxBreakpoints: 2` when a file prefix is present).
 * @param {Array<object>} messages Anthropic message params (mutated in place).
 * @param {{ maxBreakpoints?: number, interval?: number, reservedHeadBlocks?: number }} [opts]
 */
export function applyConversationBreakpoints(messages, opts = {}) {
  const maxBreakpoints = opts.maxBreakpoints ?? 3;
  const interval = opts.interval ?? 15;
  const reservedHeadBlocks = opts.reservedHeadBlocks ?? 0;

  if (!Array.isArray(messages) || messages.length === 0 || maxBreakpoints <= 0) {
    stripBreakpoints(messages, reservedHeadBlocks);
    return;
  }

  // 1) Strip stale breakpoints so re-running never accumulates past the cap.
  //    Reserved head blocks (the file prefix) keep their own breakpoint.
  stripBreakpoints(messages, reservedHeadBlocks);

  // 2) Build a flat list of every content block with its owning message index,
  //    in conversation order. Skip messages whose content isn't a block array
  //    (string content can't carry cache_control). The first `reservedHeadBlocks`
  //    blocks (file prefix) are excluded — they own a separate breakpoint and
  //    must not be re-marked or counted here.
  const flat = [];
  messages.forEach((message, messageIndex) => {
    if (Array.isArray(message.content)) {
      message.content.forEach((block) => {
        if (block && typeof block === 'object') {
          flat.push({ block, messageIndex });
        }
      });
    }
  });
  if (reservedHeadBlocks > 0) {
    flat.splice(0, reservedHeadBlocks);
  }

  if (flat.length === 0) {
    return;
  }

  // 3) Choose block positions (indices into `flat`) for breakpoints. Always the
  //    final block; then step back by `interval` for intermediate points so
  //    consecutive breakpoints stay ≤20 (=interval+slack) blocks apart. Cap at
  //    `maxBreakpoints`.
  const positions = [];
  for (let pos = flat.length - 1; pos >= 0 && positions.length < maxBreakpoints; pos -= interval) {
    positions.push(pos);
  }

  // 4) Apply. Dedup by position (defensive — `interval` is always ≥1).
  const seen = new Set();
  for (const pos of positions) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    flat[pos].block.cache_control = { ...CONVERSATION_CACHE_CONTROL };
  }
}

/**
 * Remove `cache_control` from every block of every array-content message,
 * EXCEPT the first `reservedHeadBlocks` blocks (the file prefix), whose 1h
 * breakpoint must survive across iterations.
 * @param {Array<object>} messages
 * @param {number} [reservedHeadBlocks=0]
 */
function stripBreakpoints(messages, reservedHeadBlocks = 0) {
  if (!Array.isArray(messages)) return;
  let seen = 0;
  for (const message of messages) {
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block && typeof block === 'object') {
          if (seen >= reservedHeadBlocks && block.cache_control) {
            delete block.cache_control;
          }
          seen += 1;
        }
      }
    }
  }
}
