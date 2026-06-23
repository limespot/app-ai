/**
 * Coverage for the proxy surface — the live smart-image path and its shared
 * modules: the Anthropic client, the /files and /messages handlers, context-ID
 * validation, CORS, the error response shape, and the cache_control 4-block
 * management. fetch + env are mocked; no network.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { getCorsHeaders } from '../src/lib/cors.js';
import { jsonResponse, errorResponse } from '../src/lib/responses.js';
import { validateContextId } from '../src/lib/auth.js';
import { manageCacheControl } from '../src/lib/cache-control.js';
import * as anthropic from '../src/lib/anthropic.js';
import { handleFileUpload, handleListFiles, handleDeleteFile } from '../src/handlers/files.js';
import { handleMessages } from '../src/handlers/messages.js';
import { handleHealth } from '../src/handlers/health.js';

const ENV = { CLAUDE_API_KEY: 'test-key', BRAIN_API_URL: 'https://brain.test' };
const CORS = { 'Access-Control-Allow-Origin': '*' };

function jsonOk(data, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function requestWithOrigin(origin) {
  const headers = origin ? { Origin: origin } : {};
  return new Request('https://app-ai.test/messages', { headers });
}

afterEach(() => vi.restoreAllMocks());

describe('cors', () => {
  it('returns base headers and no Allow-Origin when there is no Origin', () => {
    const h = getCorsHeaders(requestWithOrigin(null));
    expect(h['Access-Control-Allow-Methods']).toContain('POST');
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('allows credentials for a known dev origin', () => {
    const h = getCorsHeaders(requestWithOrigin('http://localhost:4200'));
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:4200');
    expect(h['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('echoes an arbitrary merchant origin without credentials (Vary: Origin)', () => {
    const h = getCorsHeaders(requestWithOrigin('https://shop.example.com'));
    expect(h['Access-Control-Allow-Origin']).toBe('https://shop.example.com');
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(h.Vary).toBe('Origin');
  });
});

describe('responses', () => {
  it('jsonResponse sets status, content-type, and merges CORS', async () => {
    const res = jsonResponse({ a: 1 }, CORS, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('errorResponse uses the { error: { message } } shape, default 500', async () => {
    const res = errorResponse('boom', CORS);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { message: 'boom' } });
  });
});

describe('validateContextId', () => {
  it('throws when the context-ID is missing', async () => {
    await expect(validateContextId(null, ENV)).rejects.toThrow(/required/i);
  });

  it('calls Brain with the context-ID and returns the payload on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonOk({ SubscriberID: 7, SubscriberTitle: 'Acme' }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await validateContextId('ctx-7', ENV);
    expect(data.SubscriberID).toBe(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://brain.test/v2/administrator-authentication/validate-context-id');
    expect(init.headers['X-Personalizer-Context-ID']).toBe('ctx-7');
  });

  it('throws when Brain rejects the context-ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    await expect(validateContextId('bad', ENV)).rejects.toThrow(/validation failed/i);
  });
});

describe('anthropic client', () => {
  it('uploadFile posts to /v1/files with the key + files beta header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: 'file_1' }));
    vi.stubGlobal('fetch', fetchMock);

    const fd = new FormData();
    await anthropic.uploadFile(fd, ENV);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/files');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-beta']).toBe('files-api-2025-04-14');
    expect(init.body).toBe(fd);
  });

  it('deleteFile sends DELETE to the file URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await anthropic.deleteFile('file_42', ENV);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/files/file_42');
    expect(init.method).toBe('DELETE');
  });

  it('createMessage posts JSON to /v1/messages with the messages beta header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: 'msg_1' }));
    vi.stubGlobal('fetch', fetchMock);

    await anthropic.createMessage({ model: 'm', messages: [] }, ENV);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['anthropic-beta']).toBe('prompt-caching-2024-07-31,files-api-2025-04-14');
    expect(JSON.parse(init.body).model).toBe('m');
  });

  it('streamMessage forces stream:true in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({}));
    vi.stubGlobal('fetch', fetchMock);

    await anthropic.streamMessage({ model: 'm', messages: [] }, ENV);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });
});

describe('manageCacheControl', () => {
  it('caches the largest user blocks within remaining slots and strips the rest', () => {
    // 1 system slot used → 3 remaining. Four user blocks (3 image + 1 doc) →
    // the 3 largest (images) keep cache, the doc loses it.
    const payload = {
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', cache_control: { type: 'ephemeral' } },
            { type: 'image', cache_control: { type: 'ephemeral' } },
            { type: 'image', cache_control: { type: 'ephemeral' } },
            { type: 'document', cache_control: { type: 'ephemeral' } },
          ],
        },
      ],
    };
    manageCacheControl(payload, 0);
    const blocks = payload.messages[0].content;
    const cached = blocks.filter((b) => b.cache_control);
    expect(cached).toHaveLength(3);
    // KEPT user blocks now carry the extended 1h TTL (LEVER 1).
    cached.forEach((b) => expect(b.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' }));
    expect(blocks.find((b) => b.type === 'document').cache_control).toBeUndefined();
  });

  it('strips all user cache_control when the system prompt + attachments fill all slots', () => {
    // 1 system slot + 4 prepended attachment blocks → over-full (5 > 4). The
    // exact attachment count (4) is passed in by the caller, so the trailing user
    // image is correctly treated as user content and must lose its cache_control.
    const att = () => ({ type: 'document', cache_control: { type: 'ephemeral' } });
    const payload = {
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            att(),
            att(),
            att(),
            att(),
            { type: 'text', text: 'q' },
            { type: 'image', cache_control: { type: 'ephemeral' } },
          ],
        },
      ],
    };
    manageCacheControl(payload, 4);
    // The trailing user image (past the 4 attachment blocks) → cache stripped.
    expect(payload.messages[0].content[5].cache_control).toBeUndefined();
  });

  it('counts only the caller-supplied attachments, not user-supplied leading cached blocks', () => {
    // With a system prompt but ZERO prepended attachments (count 0), a user
    // document that happens to lead the content is treated as USER content
    // (eligible for the 3 remaining slots), NOT counted as an attachment.
    const payload = {
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', cache_control: { type: 'ephemeral' } },
            { type: 'image', cache_control: { type: 'ephemeral' } },
          ],
        },
      ],
    };
    manageCacheControl(payload, 0);
    // 1 system + 0 attachments → 3 slots remain ≥ 2 user blocks → both kept.
    const cached = payload.messages[0].content.filter((b) => b.cache_control);
    expect(cached).toHaveLength(2);
  });

  it('is a no-op when the first message content is not an array', () => {
    const payload = { messages: [{ role: 'user', content: 'hi' }] };
    expect(() => manageCacheControl(payload, 0)).not.toThrow();
  });
});

describe('handleHealth', () => {
  it('returns ok with a timestamp', async () => {
    const res = handleHealth(CORS);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('files handlers', () => {
  it('upload returns 400 when no file is provided', async () => {
    const req = new Request('https://app-ai.test/files', { method: 'POST', body: new FormData() });
    const res = await handleFileUpload(req, ENV, CORS);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/no file/i);
  });

  it('upload proxies the file and returns Anthropic body on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: 'file_99' }));
    vi.stubGlobal('fetch', fetchMock);

    const fd = new FormData();
    fd.append('file', new Blob(['x'], { type: 'text/plain' }), 'a.txt');
    const req = new Request('https://app-ai.test/files', { method: 'POST', body: fd });

    const res = await handleFileUpload(req, ENV, CORS);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('file_99');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/files');
  });

  it('upload routes through dedup: a KV hit reuses the cached id without a POST', async () => {
    // FILES_KV bound + hash already mapped → handler returns the cached id and
    // never POSTs an upload (it does one GET metadata existence check). Response
    // shape stays { id, type } — transparent to the lib client.
    const cachedId = 'file_dedup';
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ id: cachedId, type: 'file' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ fileId: cachedId, createdAt: 1 })),
      put: vi.fn(),
      delete: vi.fn(),
    };

    const fd = new FormData();
    fd.append('file', new Blob(['screenshot-bytes'], { type: 'image/jpeg' }), 'screenshot.jpg');
    const req = new Request('https://app-ai.test/files', { method: 'POST', body: fd });

    const res = await handleFileUpload(req, { ...ENV, FILES_KV: kv }, CORS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: cachedId, type: 'file' });
    // Only the metadata existence check fired — no upload POST.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.anthropic.com/v1/files/${cachedId}`);
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('upload augments the message with the beta-access hint on a 500', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonOk({ error: { message: 'server error' } }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const fd = new FormData();
    fd.append('file', new Blob(['x']), 'a.txt');
    const req = new Request('https://app-ai.test/files', { method: 'POST', body: fd });

    const res = await handleFileUpload(req, ENV, CORS);
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toMatch(/beta/i);
  });

  it('list proxies and returns the Anthropic body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonOk({ data: [{ id: 'f1' }] })));
    const res = await handleListFiles(ENV, CORS);
    expect((await res.json()).data[0].id).toBe('f1');
  });

  it('delete returns the success envelope on 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const res = await handleDeleteFile('file_1', ENV, CORS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'File deleted successfully' });
  });

  it('delete surfaces the Anthropic error body on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonOk({ error: { message: 'gone' } }, 404)));
    const res = await handleDeleteFile('missing', ENV, CORS);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe('gone');
  });
});

describe('handleMessages', () => {
  function messagesRequest(body, systemPrompt) {
    const headers = { 'Content-Type': 'application/json', 'X-Personalizer-Context-ID': 'ctx' };
    if (systemPrompt) headers['X-Personalizer-System-Prompt'] = systemPrompt;
    return new Request('https://app-ai.test/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  it('proxies a plain request and returns the Anthropic body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonOk({ content: [{ type: 'text', text: 'hi' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await handleMessages(
      messagesRequest({ model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
      ENV,
      CORS,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).content[0].text).toBe('hi');
    // Forwarded to the Messages API (not Files).
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('strips the client apiKey field before forwarding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ content: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await handleMessages(
      messagesRequest({ apiKey: 'leak', model: 'm', max_tokens: 1, messages: [] }),
      ENV,
      CORS,
    );
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.apiKey).toBeUndefined();
    expect(sent.model).toBe('m');
  });

  it('injects the selected system prompt as a cached system block', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ content: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await handleMessages(
      messagesRequest(
        { model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'go' }] },
        'image-selection',
      ),
      ENV,
      CORS,
    );
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.system[0].type).toBe('text');
    // System prefix is a stable, reused prefix → extended 1h cache (LEVER 1).
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(sent.system[0].text).toMatch(/CSS selectors/i);
  });

  it('returns the Anthropic error body + status on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonOk({ error: { type: 'invalid_request_error', message: 'bad' } }, 400),
        ),
    );
    const res = await handleMessages(
      messagesRequest({ model: 'm', max_tokens: 1, messages: [] }),
      ENV,
      CORS,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('bad');
  });
});
