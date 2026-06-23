/**
 * CORS header construction.
 *
 * The AI endpoints carry NO cookies — authentication is the
 * `X-Personalizer-Context-ID` header, validated against Brain (see auth.js).
 * That makes it safe to echo arbitrary request Origins without credentials,
 * which is required because the Studio admin runs injected into arbitrary
 * merchant storefront pages (so the request Origin is the merchant's domain).
 * A small allowlist of known dev origins is additionally permitted to send
 * credentialed requests.
 */

/** Dev origins that may send credentialed requests. */
const CREDENTIALED_ORIGINS = [
  'https://local-app.limespot.com',
  'http://localhost:4200',
  'http://localhost:3000',
];

const BASE_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Accept, X-Requested-With, X-Personalizer-Context-ID, X-Personalizer-System-Prompt',
  'Access-Control-Max-Age': '86400',
};

/**
 * Build the CORS headers for a request, based on its Origin.
 * @param {Request} request
 * @returns {Record<string, string>}
 */
export function getCorsHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = { ...BASE_HEADERS };

  if (!origin) {
    return headers;
  }

  if (CREDENTIALED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }

  return headers;
}
