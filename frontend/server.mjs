// Serves the built React app (frontend/dist) on Cloud Run.
// Uses only Node's built-in modules, so the deployed frontend has no runtime dependencies.
// Locally: npm run build && npm start   (http://localhost:8080)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 8080; // Cloud Run sets PORT

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function send(response, filePath, status = 200) {
  const body = await readFile(filePath);
  const isHashedAsset = filePath.includes(`${sep}assets${sep}`);
  response.writeHead(status, {
    'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
    // Vite puts a content hash in asset file names, so they can be cached for a long time.
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    // Resolve inside dist only; "../" tricks fall back to index.html.
    const candidate = normalize(join(DIST, path));
    if (candidate.startsWith(DIST + sep)) {
      const info = await stat(candidate).catch(() => null);
      if (info?.isFile()) return await send(response, candidate);
    }
    // Single-page app: unknown paths get index.html.
    await send(response, join(DIST, 'index.html'));
  } catch (error) {
    console.error('Static server error:', error);
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Server error');
  }
}).listen(PORT, () => {
  console.log(`Smart Speech Coach frontend serving ${DIST} on port ${PORT}`);
});
