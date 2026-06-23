/**
 * /files endpoints — proxy to the Anthropic Files API.
 *
 *   POST   /files       → upload   (handleFileUpload)
 *   GET    /files       → list     (handleListFiles)
 *   DELETE /files/{id}  → delete   (handleDeleteFile)
 *
 * On success, upload/list return Anthropic's body as-is; delete returns
 * `{ success: true, message: 'File deleted successfully' }`. On a 500 upload
 * failure the error message is augmented with the Files-API-beta-access hint.
 */

import * as anthropic from '../lib/anthropic.js';
import { dedupUpload } from '../lib/file-dedup.js';
import { jsonResponse, errorResponse } from '../lib/responses.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Files');

const FILES_API_BETA_HINT =
  '\n\nThe Files API may not be available for your account yet. It is currently in beta and requires special access.';

/**
 * POST /files — upload a file to the Anthropic Files API.
 * @param {Request} request
 * @param {object} env
 * @param {Record<string, string>} corsHeaders
 * @returns {Promise<Response>}
 */
export async function handleFileUpload(request, env, corsHeaders) {
  try {
    log.info('File upload request received');

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return errorResponse('No file provided', corsHeaders, 400);
    }

    log.info(`Uploading file to Anthropic (${file.size} bytes, ${file.type})`);

    // Route through content-hash dedup: identical bytes (same screenshot / same
    // cleaned HTML across repeated placement calls on one page) reuse an existing
    // file_id instead of re-uploading. The Files API does NOT dedup by content,
    // so without this every call mints a fresh id — defeating the cache_control
    // breakpoint the /chat path puts on those file blocks (same bytes must map
    // to the same id to cache). Reuse is transparent: the response shape stays
    // `{ id, … }`. dedupUpload no-ops to a plain upload when FILES_KV is unbound.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { fileId, deduped } = await dedupUpload(
      {
        content: bytes,
        mimeType: file.type || 'application/octet-stream',
        filename: file.name || 'upload',
      },
      env,
    );

    log.info(`File uploaded successfully, file_id: ${fileId}${deduped ? ' (dedup hit)' : ''}`);
    return jsonResponse({ id: fileId, type: 'file' }, corsHeaders);
  } catch (error) {
    log.error('File upload error:', error);
    // Preserve the status-specific UX: a 500 from the Files API gets the
    // beta-access hint appended (dedupUpload attaches `status` to the thrown
    // error). Other failures fall back to the generic proxy message.
    let message = error.message || 'Internal proxy server error during file upload';
    if (error.status === 500) {
      message += FILES_API_BETA_HINT;
    }
    return errorResponse(message, corsHeaders, error.status || 500);
  }
}

/**
 * GET /files — list files.
 * @param {object} env
 * @param {Record<string, string>} corsHeaders
 * @returns {Promise<Response>}
 */
export async function handleListFiles(env, corsHeaders) {
  try {
    log.info('List files request received');

    const response = await anthropic.listFiles(env);
    const data = await response.json();

    if (response.status !== 200) {
      log.error('List files error:', data);
      return jsonResponse(data, corsHeaders, response.status);
    }

    return jsonResponse(data, corsHeaders);
  } catch (error) {
    log.error('List files error:', error);
    return errorResponse(
      error.message || 'Internal proxy server error during list files',
      corsHeaders,
    );
  }
}

/**
 * DELETE /files/{id} — delete a file.
 * @param {string} fileId
 * @param {object} env
 * @param {Record<string, string>} corsHeaders
 * @returns {Promise<Response>}
 */
export async function handleDeleteFile(fileId, env, corsHeaders) {
  try {
    log.info(`Delete file request received for: ${fileId}`);

    const response = await anthropic.deleteFile(fileId, env);

    if (response.status !== 200 && response.status !== 204) {
      const data = await response.json();
      log.error('Delete file error:', data);
      return jsonResponse(data, corsHeaders, response.status);
    }

    return jsonResponse({ success: true, message: 'File deleted successfully' }, corsHeaders);
  } catch (error) {
    log.error('Delete file error:', error);
    return errorResponse(
      error.message || 'Internal proxy server error during file deletion',
      corsHeaders,
    );
  }
}
