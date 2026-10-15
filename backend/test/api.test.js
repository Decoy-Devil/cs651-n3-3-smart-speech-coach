// HTTP tests for the backend, using a fake Gemini client (no key or network needed).
// Run with: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp, MAX_SPEECH_CHARS } from '../app.js';

const FRONTEND = 'http://localhost:5173';
const validFeedback = {
  summary: 'A clear, warm opening.',
  clarityScore: 8,
  strengths: ['Strong hook'],
  improvements: ['Add a closing call to action'],
};

// The fake records every call and returns whatever the current test sets in nextReply.
const calls = [];
let nextReply;
const fakeAi = {
  models: {
    async generateContent(request) {
      calls.push(request);
      if (nextReply instanceof Error) throw nextReply;
      return { text: nextReply };
    },
  },
};

const servers = [];
let baseUrl;
let noKeyUrl;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

before(async () => {
  const config = { model: 'test-model', askAnythingPrompt: 'Be brief.', allowedOrigins: [FRONTEND] };
  baseUrl = await listen(createApp({ ...config, ai: fakeAi }));
  noKeyUrl = await listen(createApp({ ...config, ai: null }));
});

after(() => Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve)))));

function post(url, body, headers = { 'Content-Type': 'application/json' }) {
  return fetch(url, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

// Silence expected error logs from failure-path tests.
function quietly(fn) {
  return async () => {
    const original = console.error;
    console.error = () => {};
    try { await fn(); } finally { console.error = original; }
  };
}

test('health reports status and model without exposing the key', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.geminiConfigured, true);
  assert.equal(data.model, 'test-model');
  assert.equal(JSON.stringify(data).includes('apiKey'), false);
});

test('CORS allows the configured frontend origin only', async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, { headers: { Origin: FRONTEND } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), FRONTEND);
  const other = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('ask anything sends the question with the system prompt and returns the answer', async () => {
  calls.length = 0;
  nextReply = '  Practice out loud daily.  ';
  const response = await post(`${baseUrl}/api/askanything`, { message: '  How do I practice?  ' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { answer: 'Practice out loud daily.' });
  assert.equal(calls[0].model, 'test-model');
  assert.equal(calls[0].contents, 'How do I practice?');
  assert.equal(calls[0].config.systemInstruction, 'Be brief.');
});

test('ask anything rejects missing, blank, non-string, and too-long questions', async () => {
  for (const body of [{}, [], { message: '' }, { message: '   ' }, { message: 42 }, { message: 'x'.repeat(501) }]) {
    const response = await post(`${baseUrl}/api/askanything`, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('feedback requests structured JSON and returns it', async () => {
  calls.length = 0;
  nextReply = JSON.stringify(validFeedback);
  const response = await post(`${baseUrl}/api/feedback`, { speech: 'Good morning everyone.' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), validFeedback);
  assert.equal(calls[0].contents, 'Good morning everyone.');
  assert.equal(calls[0].config.responseMimeType, 'application/json');
  assert.ok(calls[0].config.responseSchema.required.includes('clarityScore'));
});

test('feedback rejects empty and too-long speeches', async () => {
  for (const body of [{}, { speech: ' ' }, { speech: 'x'.repeat(MAX_SPEECH_CHARS + 1) }]) {
    const response = await post(`${baseUrl}/api/feedback`, body);
    assert.equal(response.status, 400);
  }
});

test('feedback returns 502 when Gemini output is not the expected shape', quietly(async () => {
  for (const reply of ['not json', JSON.stringify({ summary: 'x' }), JSON.stringify({ ...validFeedback, clarityScore: 11 })]) {
    nextReply = reply;
    const response = await post(`${baseUrl}/api/feedback`, { speech: 'Hello.' });
    assert.equal(response.status, 502, reply);
  }
}));

test('Gemini failures return a generic 502 without internal details', quietly(async () => {
  nextReply = new Error('quota exceeded for key AIza-secret');
  const response = await post(`${baseUrl}/api/askanything`, { message: 'Hi' });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes('AIza'), false);
}));

test('AI routes return 503 when no API key is configured, health still works', async () => {
  assert.equal((await post(`${noKeyUrl}/api/askanything`, { message: 'Hi' })).status, 503);
  assert.equal((await post(`${noKeyUrl}/api/feedback`, { speech: 'Hi' })).status, 503);
  const health = await (await fetch(`${noKeyUrl}/api/health`)).json();
  assert.equal(health.geminiConfigured, false);
});

test('malformed JSON, oversized bodies, and unknown routes return JSON errors', async () => {
  const malformed = await post(`${baseUrl}/api/askanything`, '{"message":');
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, 'string');

  const huge = await post(`${baseUrl}/api/feedback`, { speech: 'x'.repeat(30000) });
  assert.equal(huge.status, 413);

  const missing = await fetch(`${baseUrl}/api/nope`);
  assert.equal(missing.status, 404);
  assert.equal(typeof (await missing.json()).error, 'string');
});
