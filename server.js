/**
 * Minimal local dev server for Nepal Viral News Generator
 * Run:  node server.js
 * Then open:  http://localhost:3000
 *
 * API keys are stored in .env and injected server-side.
 * The browser NEVER sees or sends the keys.
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = 3000;

/* ── Load .env file (no external dependencies needed) ─────── */
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

let GEMINI_API_KEY   = process.env.GEMINI_API_KEY   || '';
let REMOVEBG_API_KEY = process.env.REMOVEBG_API_KEY || '';
let GROK_API_KEY     = process.env.GROK_API_KEY     || '';

if (!GEMINI_API_KEY)   console.warn('⚠️  GEMINI_API_KEY not set in .env');
if (!REMOVEBG_API_KEY) console.warn('⚠️  REMOVEBG_API_KEY not set in .env');
if (!GROK_API_KEY)     console.warn('⚠️  GROK_API_KEY not set in .env');

/** Write or update a KEY=VALUE line in .env, then hot-reload it */
function saveKeyToEnv(keyName, value) {
  const envPath = path.join(__dirname, '.env');
  let content = '';
  if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.trim().startsWith(keyName + '=') || l.trim().startsWith(keyName + ' ='));
  if (idx >= 0) {
    lines[idx] = `${keyName}=${value}`;
  } else {
    lines.push(`${keyName}=${value}`);
  }
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
  /* Hot-reload: update the in-process variable immediately */
  process.env[keyName] = value;
  if (keyName === 'GEMINI_API_KEY')   GEMINI_API_KEY   = value;
  if (keyName === 'REMOVEBG_API_KEY') REMOVEBG_API_KEY = value;
  if (keyName === 'GROK_API_KEY')     GROK_API_KEY     = value;
}

/* ── MIME types ─────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif' : 'image/gif',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.json': 'application/json',
};

/* ── CORS helper ─────────────────────────────────────── */
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
}

/* ── Proxy helper ─────────────────────────────────────── */
function proxyRequest(req, res, targetUrl, extraHeaders = {}) {
  const parsed = new url.URL(targetUrl);
  const options = {
    hostname: parsed.hostname,
    port:     443,
    path:     parsed.pathname + parsed.search,
    method:   req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
      ...extraHeaders,
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    setCORS(res);
    res.writeHead(proxyRes.statusCode, { 'Content-Type': proxyRes.headers['content-type'] || 'application/json' });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('[proxy] error:', e.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: e.message }));
  });

  req.pipe(proxyReq);
}

/* ── Main request handler ────────────────────────────── */
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname  = parsedUrl.pathname;

  /* Preflight */
  if (req.method === 'OPTIONS') {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  /* ── PROXY: /proxy/gemini → Gemini API (key injected server-side) ── */
  if (pathname === '/proxy/gemini') {
    if (!GEMINI_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GEMINI_API_KEY not configured on server' }));
      return;
    }
    const target = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    console.log('[proxy] Gemini → (key hidden)');
    proxyRequest(req, res, target);
    return;
  }

  /* ── PROXY: /proxy/removebg → Remove.bg API (key injected server-side) ── */
  if (pathname === '/proxy/removebg') {
    if (!REMOVEBG_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'REMOVEBG_API_KEY not configured on server' }));
      return;
    }
    const target = 'https://api.remove.bg/v1.0/removebg';
    console.log('[proxy] Remove.bg → (key hidden)');
    proxyRequest(req, res, target, { 'X-Api-Key': REMOVEBG_API_KEY });
    return;
  }

  /* ── STATUS: /api/key-status → tells the browser which keys are configured ── */
  if (pathname === '/api/key-status') {
    setCORS(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      gemini:   !!GEMINI_API_KEY,
      removebg: !!REMOVEBG_API_KEY,
      grok:     !!GROK_API_KEY,
    }));
    return;
  }

  /* ── SAVE KEY: /api/save-key — writes key to .env and hot-reloads ── */
  if (pathname === '/api/save-key' && req.method === 'POST') {
    setCORS(res);
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { service, key } = JSON.parse(body);
        const VALID = { gemini: 'GEMINI_API_KEY', grok: 'GROK_API_KEY', removebg: 'REMOVEBG_API_KEY' };
        const envKey = VALID[service];
        if (!envKey || !key || typeof key !== 'string' || key.trim().length < 8) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid service or key' }));
          return;
        }
        saveKeyToEnv(envKey, key.trim());
        console.log(`[save-key] ${envKey} updated (length ${key.trim().length})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  /* ── PROXY: /proxy/grok → Grok (xAI) API (key injected server-side) ── */
  if (pathname === '/proxy/grok') {
    if (!GROK_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GROK_API_KEY not configured on server' }));
      return;
    }
    const target = 'https://api.x.ai/v1/chat/completions';
    console.log('[proxy] Grok → (key hidden)');
    proxyRequest(req, res, target, { 'Authorization': `Bearer ${GROK_API_KEY}` });
    return;
  }

  /* ── PROXY: /proxy/removebg-account → Remove.bg account ping ── */
  if (pathname === '/proxy/removebg-account') {
    if (!REMOVEBG_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'REMOVEBG_API_KEY not configured on server' }));
      return;
    }
    const target = 'https://api.remove.bg/v1.0/account';
    console.log('[proxy] Remove.bg account ping → (key hidden)');
    proxyRequest(req, res, target, { 'X-Api-Key': REMOVEBG_API_KEY });
    return;
  }

  /* ── Static file serving ── */
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  /* Security: prevent path traversal */
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${pathname}`);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n✅  Nepal Viral News Generator is running!`);
  console.log(`👉  Open in browser: http://localhost:${PORT}\n`);
});
