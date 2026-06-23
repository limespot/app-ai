/**
 * App AI Service — Cloudflare Worker entry + router.
 *
 * A secure proxy in front of Anthropic: it holds the Anthropic API key, validates
 * the merchant's `X-Personalizer-Context-ID` against Brain, and exposes:
 *
 *   GET    /health       — liveness (no auth)
 *   POST   /files        — upload to the Anthropic Files API
 *   GET    /files        — list files
 *   DELETE /files/{id}   — delete a file
 *   POST   /messages     — single-shot Messages proxy (LIVE smart-image feature)
 *   POST   /chat         — Studio AI agent loop (SSE + tool-use)
 *
 * This file is the router only: it builds CORS headers, handles the OPTIONS
 * preflight, validates the context-ID for every non-/health route, and dispatches
 * to a handler. All logic lives in handlers/ and lib/.
 */

import { getCorsHeaders } from './lib/cors.js';
import { validateContextId } from './lib/auth.js';
import { errorResponse } from './lib/responses.js';
import { handleHealth } from './handlers/health.js';
import { handleFileUpload, handleListFiles, handleDeleteFile } from './handlers/files.js';
import { handleMessages } from './handlers/messages.js';
import { handleChat } from './handlers/chat.js';

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

/** Route a request to its handler, with shared CORS / auth / error handling. */
async function handleRequest(request, env) {
  const { pathname } = new URL(request.url);
  const { method } = request;
  const corsHeaders = getCorsHeaders(request);

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (pathname === '/health' && method === 'GET') {
      return handleHealth(corsHeaders);
    }

    // Every endpoint except /health requires a valid context-ID.
    await validateContextId(request.headers.get('X-Personalizer-Context-ID'), env);

    if (pathname === '/files' && method === 'POST') {
      return handleFileUpload(request, env, corsHeaders);
    }
    if (pathname === '/files' && method === 'GET') {
      return handleListFiles(env, corsHeaders);
    }
    if (pathname.startsWith('/files/') && method === 'DELETE') {
      const fileId = pathname.split('/').pop();
      return handleDeleteFile(fileId, env, corsHeaders);
    }
    if (pathname === '/messages' && method === 'POST') {
      return handleMessages(request, env, corsHeaders);
    }
    if (pathname === '/chat' && method === 'POST') {
      return handleChat(request, env, corsHeaders);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  } catch (error) {
    console.error('[Router] Request handler error:', error);
    return errorResponse(error.message || 'Internal server error', corsHeaders);
  }
}
