/**
 * App AI Service - Cloudflare Worker
 *
 * Provides secure access to Claude API with:
 * - File uploads to Claude Files API
 * - Message processing with system prompts
 * - Intelligent caching management
 * - CORS handling
 *
 * Compatible with:
 * - Local development (wrangler dev)
 * - Cloudflare Workers production deployment
 */

import { getSystemPrompt } from './prompts.js';

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

/**
 * Main request handler
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = getCorsHeaders(request);

  // Handle OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Route handling
    if (path === '/health' && request.method === 'GET') {
      return handleHealth(corsHeaders);
    }

    // Validate context ID for all API endpoints (excluding /health)
    const needsContextValidation = path !== '/health';
    if (needsContextValidation) {
      const contextId = request.headers.get('X-Personalizer-Context-ID');
      await validateContextID(contextId, env);
    }

    if (path === '/files' && request.method === 'POST') {
      return handleFileUpload(request, env, corsHeaders);
    }

    if (path === '/files' && request.method === 'GET') {
      return handleListFiles(env, corsHeaders);
    }

    if (path.startsWith('/files/') && request.method === 'DELETE') {
      const fileId = path.split('/').pop();
      return handleDeleteFile(fileId, env, corsHeaders);
    }

    if (path === '/messages' && request.method === 'POST') {
      return handleMessages(request, env, corsHeaders);
    }

    // 404 for unknown routes
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Request handler error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error.message || 'Internal server error'
        }
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Get CORS headers based on origin
 */
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = [
    'https://local-app.limespot.com',
    'http://localhost:4200',
    'http://localhost:3000'
  ];

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Personalizer-Context-ID, X-Personalizer-System-Prompt',
    'Access-Control-Max-Age': '86400',
  };

  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/**
 * Validate Context ID against brain API
 */
async function validateContextID(contextId, env) {
  if (!contextId) {
    throw new Error('Context ID is required');
  }

  const brainUrl = env.BRAIN_API_URL || 'https://personalizer.io';
  const validateUrl = `${brainUrl}/v2/administrator-authentication/validate-context-id`;

  console.log(`[Context Validation] URL: ${validateUrl}`);
  console.log(`[Context Validation] Full Context ID: "${contextId}"`);

  try {
    console.log('[Context Validation] Sending fetch request...');
    let response;
    try {
      response = await fetch(validateUrl, {
        method: 'GET',
        headers: {
          'X-Personalizer-Context-ID': contextId,
          'Content-Type': 'application/json',
        },
      });
      console.log(`[Context Validation] Fetch completed`);
    } catch (fetchError) {
      console.error('[Context Validation] Fetch failed:', fetchError.message);
      console.error('[Context Validation] Fetch error type:', fetchError.name);
      console.error('[Context Validation] Full fetch error:', fetchError);
      throw fetchError;
    }

    console.log(`[Context Validation] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Context Validation] Failed: ${response.status} ${response.statusText}`);
      console.error(`[Context Validation] Response body:`, errorText);

      const errorMsg = `Context validation failed: ${response.status} ${response.statusText} - ${errorText}`;
      throw new Error(errorMsg);
    }

    console.log('[Context Validation] Parsing response JSON...');
    const data = await response.json();
    console.log(`[Context Validation] Success - Subscriber: ${data.SubscriberTitle} (ID: ${data.SubscriberID})`);

    return data;
  } catch (error) {
    console.error('[Context Validation] Error:', error.message);
    console.error('[Context Validation] Full error:', error);
    throw error;
  }
}

/**
 * Health check endpoint
 */
async function handleHealth(corsHeaders) {
  console.log('Health check requested');
  return new Response(
    JSON.stringify({
      status: 'ok',
      message: 'App AI service is running',
      timestamp: new Date().toISOString()
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  );
}

/**
 * Handle file upload to Claude Files API
 */
async function handleFileUpload(request, env, corsHeaders) {
  try {
    console.log('[Claude Proxy] File upload request received');
    console.log('[Claude Proxy] Content-Type header:', request.headers.get('Content-Type'));
    console.log('[Claude Proxy] All headers:', Array.from(request.headers.entries()));

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return new Response(
        JSON.stringify({ error: { message: 'No file provided' } }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[Claude Proxy] Uploading file to Anthropic API...');
    console.log('[Claude Proxy] File size:', file.size, 'bytes');
    console.log('[Claude Proxy] File type:', file.type);

    // Create new FormData for Claude API
    const claudeFormData = new FormData();
    claudeFormData.append('file', file);

    const response = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
      },
      body: claudeFormData,
    });

    const data = await response.json();
    console.log('[Claude Proxy] File upload response status:', response.status);
    console.log('[Claude Proxy] Response data:', JSON.stringify(data).substring(0, 500));

    if (response.status !== 200) {
      console.error('[Claude Proxy] File upload error:', data);

      let errorMessage = data.error?.message || 'File upload failed';
      if (response.status === 500) {
        errorMessage += '\n\nThe Files API may not be available for your account yet. It is currently in beta and requires special access.';
      }

      return new Response(
        JSON.stringify({
          ...data,
          error: {
            ...data.error,
            message: errorMessage,
          },
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('[Claude Proxy] File uploaded successfully, file_id:', data.id);
    return new Response(
      JSON.stringify(data),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Claude Proxy] File upload error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error.message || 'Internal proxy server error during file upload',
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * List files endpoint
 */
async function handleListFiles(env, corsHeaders) {
  try {
    console.log('[Claude Proxy] List files request received');

    const response = await fetch('https://api.anthropic.com/v1/files', {
      headers: {
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
      },
    });

    const data = await response.json();
    console.log('[Claude Proxy] List files response status:', response.status);

    if (response.status !== 200) {
      console.error('[Claude Proxy] List files error:', data);
      return new Response(
        JSON.stringify(data),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify(data),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Claude Proxy] List files error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error.message || 'Internal proxy server error during list files',
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Delete file endpoint
 */
async function handleDeleteFile(fileId, env, corsHeaders) {
  try {
    console.log('[Claude Proxy] Delete file request received for:', fileId);

    const response = await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
      },
    });

    console.log('[Claude Proxy] Delete file response status:', response.status);

    if (response.status !== 200 && response.status !== 204) {
      const data = await response.json();
      console.error('[Claude Proxy] Delete file error:', data);
      return new Response(
        JSON.stringify(data),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'File deleted successfully' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Claude Proxy] Delete file error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: error.message || 'Internal proxy server error during file deletion',
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Handle Claude messages endpoint with system prompts and caching
 */
async function handleMessages(request, env, corsHeaders) {
  try {
    console.log('\\n========================================================================');
    console.log('REQUEST:', request.method, request.url);
    console.log('Time:', new Date().toISOString());

    // Read custom headers
    const contextId = request.headers.get('X-Personalizer-Context-ID');
    const systemPrompt = request.headers.get('X-Personalizer-System-Prompt');

    if (contextId) {
      console.log('Context ID:', contextId);
    }
    if (systemPrompt) {
      console.log('System Prompt:', systemPrompt);
    }

    const body = await request.json();
    const { apiKey: _, ...claudePayload } = body;

    // Load system prompt if specified
    if (systemPrompt) {
      try {
        await loadSystemPrompt(systemPrompt, claudePayload, env);
      } catch (error) {
        console.error(`[Claude Proxy] Failed to load system prompt: ${error.message}`);
      }
    }

    // Manage cache_control blocks (4-block limit)
    manageCacheControl(claudePayload, systemPrompt);

    // Build headers
    const requestHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31,files-api-2025-04-14',
    };

    // Log request details
    logRequestDetails(claudePayload);

    // Make request to Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(claudePayload),
    });

    const data = await response.json();

    console.log('\\n--- RESPONSE ---');
    console.log('Status:', response.status);

    if (!response.ok) {
      console.log('❌ ERROR:', data.error?.type);
      console.log('Message:', data.error?.message);
      console.log('Full response:', JSON.stringify(data, null, 2));
      console.log('========================================================================\\n');
      return new Response(
        JSON.stringify(data),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Success response
    console.log('✓ SUCCESS');
    logUsageStats(data.usage);
    if (data.content?.[0]?.text) {
      console.log('Response text (first 300 chars):', data.content[0].text.substring(0, 300) + '...');
    }

    console.log('========================================================================\\n');
    return new Response(
      JSON.stringify(data),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.log('\\n❌ EXCEPTION:', error.message);
    console.log('Stack:', error.stack);
    console.log('========================================================================\\n');
    return new Response(
      JSON.stringify({
        error: {
          message: error.message || 'Internal proxy server error',
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Load system prompt from bundled prompts module
 * Works in both local development and Cloudflare Workers
 */
async function loadSystemPrompt(systemPromptName, claudePayload, env) {
  try {
    const prompt = getSystemPrompt(systemPromptName);

    // Initialize system array with prompt text
    claudePayload.system = [
      {
        type: 'text',
        text: prompt.prompt,
        cache_control: { type: 'ephemeral' }
      }
    ];

    console.log(`[Claude Proxy] Loaded system prompt: ${systemPromptName} (${prompt.prompt.length} chars)`);

    // Handle attachments if any
    if (prompt.attachments && prompt.attachments.length > 0) {
      console.log(`[Claude Proxy] Found ${prompt.attachments.length} prompt attachment(s)`);

      // Upload attachment files and prepend to first message content
      const attachmentFileContents = [];

      for (const attachment of prompt.attachments) {
        console.log(`[Claude Proxy] Processing attachment: ${attachment.filename} (${attachment.content.length} bytes)`);

        // Create FormData for file upload
        const formData = new FormData();
        const blob = new Blob([attachment.content], { type: attachment.mimeType });
        formData.append('file', blob, attachment.filename);

        // Upload to Anthropic Files API
        const uploadResponse = await fetch('https://api.anthropic.com/v1/files', {
          method: 'POST',
          headers: {
            'x-api-key': env.CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'files-api-2025-04-14',
          },
          body: formData,
        });

        if (uploadResponse.status === 200) {
          const uploadData = await uploadResponse.json();
          const fileId = uploadData.id;
          console.log(`[Claude Proxy] Uploaded ${attachment.filename} successfully, file_id: ${fileId}`);

          // Build content block based on file type
          if (attachment.mimeType.startsWith('image/')) {
            attachmentFileContents.push({
              type: 'image',
              source: { type: 'file', file_id: fileId },
              cache_control: { type: 'ephemeral' }
            });
          } else {
            attachmentFileContents.push({
              type: 'document',
              source: { type: 'file', file_id: fileId },
              cache_control: { type: 'ephemeral' }
            });
          }
        } else {
          const errorData = await uploadResponse.json();
          console.error(`[Claude Proxy] Failed to upload ${attachment.filename}:`, errorData);
        }
      }

      // Prepend attachment files to first message content
      if (attachmentFileContents.length > 0 && claudePayload.messages && claudePayload.messages.length > 0) {
        const firstMessage = claudePayload.messages[0];
        if (Array.isArray(firstMessage.content)) {
          firstMessage.content = [...attachmentFileContents, ...firstMessage.content];
        } else {
          firstMessage.content = [...attachmentFileContents, { type: 'text', text: firstMessage.content }];
        }
        console.log(`[Claude Proxy] Prepended ${attachmentFileContents.length} prompt attachment(s) to first message`);
      }
    }
  } catch (error) {
    console.error(`[Claude Proxy] Failed to load system prompt: ${error.message}`);
    throw error;
  }
}

/**
 * Manage cache_control blocks to respect 4-block limit
 */
function manageCacheControl(claudePayload, systemPrompt) {
  if (!claudePayload.messages || claudePayload.messages.length === 0) {
    return;
  }

  const firstMessage = claudePayload.messages[0];
  if (!Array.isArray(firstMessage.content)) {
    return;
  }

  // Count system cache blocks
  const systemCacheBlocks = claudePayload.system ? 1 : 0;

  // Count prompt attachment cache blocks
  let attachmentFileCount = 0;
  if (systemPrompt) {
    for (let i = 0; i < firstMessage.content.length; i++) {
      const block = firstMessage.content[i];
      if (block.cache_control && (block.type === 'document' || block.type === 'image')) {
        attachmentFileCount++;
      } else if (block.type === 'text' && i > 0) {
        break;
      }
    }
  }

  const usedCacheSlots = systemCacheBlocks + attachmentFileCount;
  const remainingSlots = 4 - usedCacheSlots;

  console.log(`[Claude Proxy] Cache management: ${usedCacheSlots}/4 slots used (${systemCacheBlocks} system + ${attachmentFileCount} attachments), ${remainingSlots} available for user content`);

  // Find user content blocks
  const userBlocks = firstMessage.content.slice(attachmentFileCount).map((block, idx) => ({
    block,
    originalIdx: idx + attachmentFileCount,
    size: block.type === 'image' ? 1000000 : block.type === 'document' ? 100000 : 0
  })).filter(item => item.size > 0);

  if (remainingSlots > 0) {
    // Sort by size descending
    userBlocks.sort((a, b) => b.size - a.size);

    // Apply cache to largest N blocks
    userBlocks.slice(0, remainingSlots).forEach(item => {
      item.block.cache_control = { type: 'ephemeral' };
      console.log(`[Claude Proxy] Applied cache to user ${item.block.type} (~${Math.round(item.size / 1024)}KB)`);
    });

    // Remove cache from remaining blocks
    userBlocks.slice(remainingSlots).forEach(item => {
      if (item.block.cache_control) {
        delete item.block.cache_control;
        console.log(`[Claude Proxy] Removed cache from user ${item.block.type} (insufficient slots)`);
      }
    });
  } else {
    // No slots available
    userBlocks.forEach(item => {
      if (item.block.cache_control) {
        delete item.block.cache_control;
        console.log(`[Claude Proxy] Removed cache from user ${item.block.type} (no slots available)`);
      }
    });

    if (remainingSlots < 0) {
      console.warn(`[Claude Proxy] WARNING: More than 4 cache blocks detected! This will cause an API error.`);
    }
  }
}

/**
 * Log request details
 */
function logRequestDetails(payload) {
  console.log('\\nREQUEST PAYLOAD:');
  console.log(`  model: ${payload.model}`);
  console.log(`  max_tokens: ${payload.max_tokens}`);
  console.log(`  temperature: ${payload.temperature}`);
  console.log(`  messages: ${payload.messages?.length || 0}`);

  if (payload.messages?.[0]?.content) {
    console.log(`  content blocks: ${payload.messages[0].content.length}`);
    payload.messages[0].content.forEach((block, idx) => {
      if (block.type === 'document') {
        console.log(`    [${idx}] document: ${block.source?.file_id}`);
      } else if (block.type === 'image') {
        console.log(`    [${idx}] image: ${block.source?.file_id || 'base64'}`);
      } else if (block.type === 'text') {
        console.log(`    [${idx}] text: ${block.text.length} chars`);
      }
    });
  }
}

/**
 * Log usage statistics
 */
function logUsageStats(usage) {
  if (usage) {
    console.log('Token usage:');
    console.log(`  input: ${usage.input_tokens}`);
    console.log(`  cache_creation: ${usage.cache_creation_input_tokens || 0}`);
    console.log(`  cache_read: ${usage.cache_read_input_tokens || 0}`);
    console.log(`  output: ${usage.output_tokens}`);

    if (usage.cache_read_input_tokens > 0) {
      console.log('  💾 Cache hit!');
    } else if (usage.cache_creation_input_tokens > 0) {
      console.log('  ⚡ Cache created');
    }
  }
}
