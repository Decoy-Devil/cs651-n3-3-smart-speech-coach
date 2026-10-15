import { useEffect, useState } from 'react';
import { API_BASE_URL, API_TARGET, callApi } from '../api.js';

const CHECKING = { state: 'checking', text: 'Checking backend…' };

// Calls GET /api/health and turns the result into what the badge shows.
async function checkHealth() {
  try {
    const health = await callApi('/api/health', { timeoutMs: 20000 });
    return health.geminiConfigured
      ? { state: 'ok', text: `Connected to ${health.service} · ${health.model}` }
      : { state: 'warn', text: 'Backend is up, but its Gemini key is not configured' };
  } catch (error) {
    return { state: 'down', text: error.message };
  }
}

// Shows whether the backend is reachable. During the demo this shows at a glance
// that the page in the browser is talking to the service on Cloud Run.
function BackendStatus() {
  const [status, setStatus] = useState(CHECKING);

  useEffect(() => {
    // Check once on page load. `ignore` skips the update if React unmounts first.
    let ignore = false;
    checkHealth().then((result) => { if (!ignore) setStatus(result); });
    return () => { ignore = true; };
  }, []);

  async function recheck() {
    setStatus(CHECKING);
    setStatus(await checkHealth());
  }

  return (
    <div className={`backend-status backend-status--${status.state}`} role="status" aria-live="polite">
      <span className="backend-status__dot" aria-hidden="true" />
      <span>
        <strong>Backend ({API_TARGET}):</strong> {status.text}
        <br />
        <code className="backend-status__url">{API_BASE_URL}</code>
      </span>
      <button type="button" className="link-button" onClick={recheck} disabled={status.state === 'checking'}>
        Recheck
      </button>
    </div>
  );
}

export default BackendStatus;
