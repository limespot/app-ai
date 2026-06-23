/**
 * Studio AI — server-side data-query tools.
 *
 * These tools are exposed to the Anthropic model during the chat/onboarding
 * agent loop. When the model emits a `tool_use` for one of them, app-ai executes
 * it by calling Brain's read-only AI tool proxy (`/v2/ai-tools/*`) server→server,
 * forwarding the merchant's X-Personalizer-Context-ID for tenant scoping.
 *
 * The model NEVER reaches Brain directly. See lib CONTRACTS.md §2 for the frozen
 * tool definitions + the Brain endpoint each one calls.
 */

/**
 * Anthropic tool definitions (sent in the `tools` array). Kept deterministic
 * (stable order, no per-request data) so the prompt prefix caches well.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'get_store_analytics',
    description:
      "Get the merchant's store performance over a date window: order count, total revenue, average order value (AOV), and conversion rate. Call this when the merchant asks about sales, revenue, AOV, or when you need the AOV to recommend a progress-bar threshold.",
    input_schema: {
      type: 'object',
      properties: {
        fromDate: {
          type: 'string',
          description: 'Start date, YYYY-MM-DD. Optional; defaults to 90 days ago.',
        },
        toDate: {
          type: 'string',
          description: 'End date, YYYY-MM-DD. Optional; defaults to today.',
        },
      },
    },
  },
  {
    name: 'list_segments',
    description:
      "List the merchant's existing audience segments and their status. Call this before recommending which segments to activate so you don't suggest ones that already exist or are already active.",
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['Active', 'Inactive', 'All'],
          description: 'Filter by status. Optional; defaults to All.',
        },
        keyword: {
          type: 'string',
          description: 'Optional keyword to filter segment titles.',
        },
      },
    },
  },
  {
    name: 'list_campaigns',
    description:
      "List the merchant's existing campaigns (discount, progress bar, HTML, image) and their status. Call this before recommending a new campaign so you reflect what's already set up.",
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['discount', 'progressbar', 'html', 'image', 'all'],
          description: 'Which kind of campaign to list. Optional; defaults to all.',
        },
        keyword: {
          type: 'string',
          description: 'Optional keyword to filter campaign titles.',
        },
      },
    },
  },
  {
    name: 'get_store_config',
    description:
      "Get the merchant's store configuration: platform, industry, currency, and the recommendation-box types currently configured per page. Call this to understand the store's setup and industry before tailoring recommendations.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

/** Map a tool name to its Brain AI-proxy request (method + path + query builder). */
const TOOL_ROUTES = {
  get_store_analytics: (input) => {
    const params = new URLSearchParams();
    if (input.fromDate) params.set('fromDate', input.fromDate);
    if (input.toDate) params.set('toDate', input.toDate);
    const qs = params.toString();
    return `v2/ai-tools/store-analytics${qs ? `?${qs}` : ''}`;
  },
  list_segments: (input) => {
    const params = new URLSearchParams();
    if (input.status) params.set('status', input.status);
    if (input.keyword) params.set('keyword', input.keyword);
    const qs = params.toString();
    return `v2/ai-tools/segments${qs ? `?${qs}` : ''}`;
  },
  list_campaigns: (input) => {
    const params = new URLSearchParams();
    if (input.kind) params.set('kind', input.kind);
    if (input.keyword) params.set('keyword', input.keyword);
    const qs = params.toString();
    return `v2/ai-tools/campaigns${qs ? `?${qs}` : ''}`;
  },
  get_store_config: () => 'v2/ai-tools/store-config',
};

/**
 * Execute one tool by calling Brain's AI tool proxy. Returns
 * `{ ok, name, result, summary }` — `result` is the JSON the model sees as the
 * tool_result content; `summary` is a short human string for the SSE event.
 *
 * Defensive: a Brain failure is returned as `{ ok: false, ... }` with an error
 * message rather than thrown, so the agent loop can feed the error back to the
 * model (which can then apologize / proceed) instead of aborting the turn.
 */
export async function executeTool(name, input, contextId, env) {
  const buildPath = TOOL_ROUTES[name];
  if (!buildPath) {
    return {
      ok: false,
      name,
      result: { error: `Unknown tool: ${name}` },
      summary: `Unknown tool: ${name}`,
    };
  }

  const brainUrl = env.BRAIN_API_URL || 'https://personalizer.io';
  const path = buildPath(input || {});
  const url = `${brainUrl}/${path}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Personalizer-Context-ID': contextId,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        name,
        result: { error: `Brain AI tool ${name} failed: ${response.status}`, body },
        summary: `${name} failed (${response.status})`,
      };
    }

    const data = await response.json();
    return { ok: true, name, result: data, summary: summarize(name, data) };
  } catch (error) {
    return {
      ok: false,
      name,
      result: { error: `Brain AI tool ${name} error: ${error.message}` },
      summary: `${name} error`,
    };
  }
}

/** Build a short human-readable summary of a tool result for the SSE event. */
function summarize(name, data) {
  try {
    if (name === 'get_store_analytics') {
      return `AOV ${data.AverageOrderValue ?? '?'} ${data.Currency ?? ''}, ${data.OrderCount ?? '?'} orders`;
    }
    if (name === 'list_segments') {
      return `${Array.isArray(data) ? data.length : 0} segments`;
    }
    if (name === 'list_campaigns') {
      return `${Array.isArray(data) ? data.length : 0} campaigns`;
    }
    if (name === 'get_store_config') {
      return `${data.Platform ?? 'store'} / ${data.IndustryName ?? 'industry'}`;
    }
  } catch {
    // fall through
  }
  return `${name} done`;
}
