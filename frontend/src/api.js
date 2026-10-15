// All calls from the browser to the backend go through this file.
//
// Which backend? Set in frontend/.env (Vite only exposes variables that start with VITE_):
//   VITE_SERVER_REMOTE=Y  -> use VITE_SERVER_URL_REMOTE (your Cloud Run URL)
//   anything else         -> use VITE_SERVER_URL_LOCAL  (http://localhost:3001)
// These values are baked in at build/dev-start time, so restart `npm run dev` after editing .env.
const useRemote = import.meta.env.VITE_SERVER_REMOTE === 'Y';
const configuredUrl = useRemote
  ? import.meta.env.VITE_SERVER_URL_REMOTE
  : import.meta.env.VITE_SERVER_URL_LOCAL;

// Remove any trailing slash so `${API_BASE_URL}/api/...` never has a double slash.
export const API_BASE_URL = (configuredUrl || 'http://localhost:3001').replace(/\/+$/, '');
export const API_TARGET = useRemote ? 'Cloud Run' : 'local';

/**
 * Calls the backend with fetch and returns the parsed JSON.
 * Throws an Error with a user-friendly message for network errors, timeouts,
 * non-JSON responses, and HTTP error statuses (using the backend's `error` field).
 */
export async function callApi(path, { body, timeoutMs = 45000 } = {}) {
  // AbortController lets us give up if the backend (or Gemini) takes too long.
  // Cloud Run "cold starts" can add a few seconds to the first request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Please try again.', { cause: error });
    // fetch rejects (instead of returning a response) when the server is unreachable
    // or when CORS blocks the response; both look the same to JavaScript.
    throw new Error(`Could not reach the backend at ${API_BASE_URL}. Is it running, and is this site in allowedOrigins?`, { cause: error });
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The backend sent an unexpected response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`);
  }
  return data;
}
