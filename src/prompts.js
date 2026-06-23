/**
 * System Prompt Registry
 *
 * Each prompt's TEXT lives in its own `.md` file under `src/prompts/` (pure
 * prompt text, no JS). This module is a thin registry: it imports each `.md`
 * as a string and pairs it with that prompt's METADATA (model / token / tool
 * choices). The registry is the single source of truth — consumers
 * (handlers/chat.js, handlers/messages.js) read text + metadata from here
 * instead of hardcoding them.
 *
 * The `.md` imports are bundled at BUILD time, NOT read from disk at runtime:
 *   • Worker (wrangler/esbuild): the `[[rules]]` Text rule in wrangler.toml
 *     turns `import x from './x.md'` into the file's string contents.
 *   • Tests (vitest/vite): the inline Text-loader plugin in vitest.config.js
 *     does the same, with the SAME import specifier (no `?raw` suffix).
 * Cloudflare Workers have no runtime filesystem, so `fs.readFile` is not an
 * option — everything is bundled ahead of time.
 *
 * Entry shape: { prompt, model, maxTokens, usesTools, description, attachments, effort? }
 *   - prompt:      the system-prompt text (from the `.md` file)
 *   - model:       default Anthropic model for this prompt
 *   - maxTokens:   default max_tokens for this prompt
 *   - usesTools:   whether the agent loop sends tool definitions
 *   - description: short human-readable note (registry documentation)
 *   - attachments: files prepended to the first message (image-selection only)
 *   - effort:      OPTIONAL output effort 'low'|'medium'|'high'|'xhigh'. When
 *                  set AND the entry's model supports effort (see
 *                  lib/anthropic.js `supportsEffort`), handlers add
 *                  `output_config: { effort }` to the payload (lowers output
 *                  tokens). On a model that doesn't support effort the handler
 *                  omits it (sending it returns a 400), so only set `effort` on
 *                  an effort-supporting model. Omit for the default ('high').
 */

import imageSelectionPrompt from './prompts/image-selection.md';
import chatPrompt from './prompts/chat.md';
import onboardingPrompt from './prompts/onboarding.md';
import placementPrompt from './prompts/placement.md';

/** Default model for the chat/onboarding agent loop. */
const DEFAULT_MODEL = 'claude-opus-4-8';
/** Placement is latency-sensitive + structured — a faster model is the default. */
const PLACEMENT_MODEL = 'claude-haiku-4-5';

export const systemPrompts = {
  'image-selection': {
    prompt: imageSelectionPrompt,
    model: DEFAULT_MODEL,
    maxTokens: 4096,
    usesTools: false,
    description:
      'Analyzes page HTML + screenshot to produce CSS selectors for image/text/CTA personalization (JSON-only output).',
    // Attachments can be added here if needed
    attachments: [],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Studio AI — server-side system prompts for the chat agent loop.
  // Selected via the X-Personalizer-System-Prompt header on POST /chat.
  // See lib CONTRACTS.md §1 (SSE protocol) and §2 (tool definitions).
  // ──────────────────────────────────────────────────────────────────────────

  // General conversational assistant for LimeSpot Studio merchants.
  chat: {
    prompt: chatPrompt,
    model: DEFAULT_MODEL,
    maxTokens: 4096,
    usesTools: true,
    description:
      'General conversational Studio assistant; runs the tool-use agent loop to read store data.',
    attachments: [],
  },

  // New-merchant onboarding assistant — opinionated, applies best-practice defaults.
  onboarding: {
    prompt: onboardingPrompt,
    model: DEFAULT_MODEL,
    maxTokens: 4096,
    usesTools: true,
    description:
      'New-merchant onboarding assistant; applies best-practice defaults and runs the tool-use agent loop.',
    attachments: [],
  },

  // Placement assistant — returns ONLY a structured JSON proposal (no prose, no tools).
  placement: {
    prompt: placementPrompt,
    model: PLACEMENT_MODEL,
    maxTokens: 2048,
    usesTools: false,
    description: 'Structured placement proposer; one-shot JSON, no tools, faster model.',
    attachments: [],
    // No `effort`: the placement model (Haiku 4.5) does not support
    // `output_config.effort`. The handler guards on model capability and would
    // omit it regardless; setting it here would be dead config. If placement
    // moves to an effort-supporting model, add `effort: 'low'` then.
  },
};

/**
 * Get a system prompt entry by name (text + metadata).
 */
export function getSystemPrompt(name) {
  const prompt = systemPrompts[name];
  if (!prompt) {
    throw new Error(`System prompt not found: ${name}`);
  }
  return prompt;
}

/**
 * Get all available prompt names
 */
export function getAvailablePrompts() {
  return Object.keys(systemPrompts);
}
