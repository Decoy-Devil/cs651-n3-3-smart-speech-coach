// Entry point: reads configuration, creates the Gemini client, and starts listening.
// Locally the values come from backend/.env; on Cloud Run they come from the
// service's environment variables (set with --env-vars-file or --set-secrets).
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createApp } from './app.js';

dotenv.config({ quiet: true });

// Cloud Run tells the container which port to use through PORT (normally 8080).
// Locally we fall back to 3001 so the frontend's default URL works.
const port = Number(process.env.PORT) || 3001;

// Comma-separated list of frontend origins allowed to call this backend.
const allowedOrigins = (process.env.allowedOrigins || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Newer accounts cannot use gemini-2.5-flash (the starter's model), so default to a current one.
// geminiAskAnythingModel is still read so the instructor's .env files keep working.
const model = process.env.GEMINI_MODEL || process.env.geminiAskAnythingModel || 'gemini-3.5-flash-lite';

const askAnythingPrompt = process.env.askAnythingPrompt ||
  'You answer questions about Smart Speech Coach, a service that helps people practice speeches, ' +
  'improve delivery, organize ideas, reduce speaking anxiety, and get simple coaching feedback using ' +
  'machine learning. If the user asks about something unrelated, briefly steer them back to Smart ' +
  'Speech Coach. Keep the answer to 1-4 sentences.';

// The API key stays on the server; the browser never sees it.
// A 30-second timeout keeps a slow Gemini call from holding the request open indefinitely.
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 30000 } })
  : null;

if (!ai) {
  console.warn('GEMINI_API_KEY is not set: /api/health works, but AI routes will return 503.');
}

createApp({ ai, model, askAnythingPrompt, allowedOrigins }).listen(port, () => {
  console.log(`Smart Speech Coach backend listening on port ${port} (model: ${model})`);
  console.log(`Allowed frontend origins: ${allowedOrigins.join(', ')}`);
});
