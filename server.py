"""
Local dev server for Nepal Viral News Generator
Run:   python server.py
Open:  http://localhost:3000

Acts as a static file server + CORS proxy for Gemini and Remove.bg APIs.
API keys are loaded from .env — the browser NEVER sees them.
No extra packages needed — uses only Python standard library.
"""
import http.server
import urllib.request
import urllib.parse
import os
import sys
import mimetypes
import json
from io import BytesIO

PORT = 3000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Load .env file ────────────────────────────────────────────
def load_env():
    env_path = os.path.join(BASE_DIR, '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, _, val = line.partition('=')
            key = key.strip(); val = val.strip()
            if key and key not in os.environ:
                os.environ[key] = val

load_env()

GEMINI_API_KEY   = os.environ.get('GEMINI_API_KEY',   '')
REMOVEBG_API_KEY = os.environ.get('REMOVEBG_API_KEY', '')
GROK_API_KEY     = os.environ.get('GROK_API_KEY',     '')

if not GEMINI_API_KEY:
    print('⚠️  GEMINI_API_KEY not set in .env')
if not REMOVEBG_API_KEY:
    print('⚠️  REMOVEBG_API_KEY not set in .env')
if not GROK_API_KEY:
    print('ℹ️  GROK_API_KEY not set in .env (optional)')


def save_key_to_env(key_name, value):
    """Write or update KEY=VALUE in .env then hot-reload the global."""
    global GEMINI_API_KEY, REMOVEBG_API_KEY, GROK_API_KEY
    env_path = os.path.join(BASE_DIR, '.env')
    content = ''
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            content = f.read()
    lines = content.split('\n')
    found = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(key_name + '=') or stripped.startswith(key_name + ' ='):
            lines[i] = f'{key_name}={value}'
            found = True
            break
    if not found:
        lines.append(f'{key_name}={value}')
    with open(env_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    # Hot-reload in-process
    os.environ[key_name] = value
    if key_name == 'GEMINI_API_KEY':   GEMINI_API_KEY   = value
    if key_name == 'REMOVEBG_API_KEY': REMOVEBG_API_KEY = value
    if key_name == 'GROK_API_KEY':     GROK_API_KEY     = value
    print(f'  [save-key] {key_name} updated (length {len(value)})')

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
}

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
}


class Handler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")

    def send_cors(self):
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)

    # ── OPTIONS preflight ──────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    # ── GET ────────────────────────────────────────────────────
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        pathname = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # ── Proxy: /proxy/fetch?url=... → fetch any external URL (RSS, articles) ──
        if pathname == '/proxy/fetch':
            target_url = qs.get('url', [''])[0]
            if not target_url:
                self.send_response(400); self.end_headers()
                self.wfile.write(b'Missing ?url= parameter')
                return
            self._proxy_fetch(target_url)
            return

        # ── Status: /api/key-status → tells browser which keys are configured ──
        if pathname == '/api/key-status':
            payload = json.dumps({
                'gemini':   bool(GEMINI_API_KEY),
                'removebg': bool(REMOVEBG_API_KEY),
                'grok':     bool(GROK_API_KEY),
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(payload)
            return

        # ── Proxy: /proxy/removebg-account → Remove.bg account ping (GET) ──
        if pathname == '/proxy/removebg-account':
            if not REMOVEBG_API_KEY:
                err = json.dumps({'error': 'REMOVEBG_API_KEY not configured on server'}).encode()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return
            print('  [proxy] Remove.bg account ping → (key hidden)')
            try:
                req = urllib.request.Request(
                    'https://api.remove.bg/v1.0/account',
                    headers={'X-Api-Key': REMOVEBG_API_KEY},
                    method='GET'
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp_body = resp.read()
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(resp_body)))
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read()
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                msg = json.dumps({'error': str(e)}).encode()
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(msg)
            return

        if pathname == '/':
            pathname = '/index.html'
            pathname = '/index.html'

        # Security: block path traversal
        file_path = os.path.normpath(os.path.join(BASE_DIR, pathname.lstrip('/')))
        if not file_path.startswith(BASE_DIR):
            self.send_response(403)
            self.end_headers()
            return

        if os.path.isfile(file_path):
            ext = os.path.splitext(file_path)[1].lower()
            mime = MIME_TYPES.get(ext, 'application/octet-stream')
            with open(file_path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_cors()
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.send_cors()
            self.end_headers()
            self.wfile.write(f'404 Not Found: {pathname}'.encode())

    # ── POST ───────────────────────────────────────────────────
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        pathname = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len) if content_len > 0 else b''

        # ── Save key: /api/save-key → writes key to .env and hot-reloads ──
        if pathname == '/api/save-key':
            try:
                data = json.loads(body.decode('utf-8'))
                service = data.get('service', '')
                key_val = data.get('key', '').strip()
                valid_map = {
                    'gemini':   'GEMINI_API_KEY',
                    'grok':     'GROK_API_KEY',
                    'removebg': 'REMOVEBG_API_KEY',
                }
                env_key = valid_map.get(service)
                if not env_key or not key_val or len(key_val) < 8:
                    err = json.dumps({'ok': False, 'error': 'Invalid service or key'}).encode()
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(err)
                    return
                save_key_to_env(env_key, key_val)
                resp_body = json.dumps({'ok': True, 'service': service}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp_body)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp_body)
            except Exception as e:
                err = json.dumps({'ok': False, 'error': str(e)}).encode()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
            return

        # ── Proxy: /proxy/gemini → Gemini API (key injected server-side) ──
        if pathname == '/proxy/gemini':
            if not GEMINI_API_KEY:
                err = json.dumps({'error': 'GEMINI_API_KEY not configured on server'}).encode()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return
            target = (
                f'https://generativelanguage.googleapis.com/v1beta/models/'
                f'gemini-2.0-flash:generateContent?key={urllib.parse.quote(GEMINI_API_KEY)}'
            )
            print('  [proxy] Gemini → (key hidden)')
            self._forward(target, body, {
                'Content-Type': self.headers.get('Content-Type', 'application/json'),
            })
            return

        # ── Proxy: /proxy/grok → xAI Grok API (key injected server-side) ──
        if pathname == '/proxy/grok':
            if not GROK_API_KEY:
                err = json.dumps({'error': 'GROK_API_KEY not configured on server'}).encode()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return
            target = 'https://api.x.ai/v1/chat/completions'
            print('  [proxy] Grok → (key hidden)')
            self._forward(target, body, {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {GROK_API_KEY}',
            })
            return

        # ── Proxy: /proxy/removebg → Remove.bg API (key injected server-side) ──
        if pathname == '/proxy/removebg':
            if not REMOVEBG_API_KEY:
                err = json.dumps({'error': 'REMOVEBG_API_KEY not configured on server'}).encode()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return
            target = 'https://api.remove.bg/v1.0/removebg'
            print('  [proxy] Remove.bg → (key hidden)')
            self._forward(target, body, {
                'Content-Type': self.headers.get('Content-Type', 'application/octet-stream'),
                'X-Api-Key': REMOVEBG_API_KEY,
            })
            return

        self.send_response(404)
        self.end_headers()

    # ── GET: /proxy/fetch?url=... → fetch any external URL ──
    def _proxy_fetch(self, target_url):
        """Fetch any external URL and stream it back (used for RSS + article pages)."""
        print(f'  [proxy] fetch → {target_url[:80]}')
        try:
            req = urllib.request.Request(
                target_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                },
                method='GET'
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                ct = resp.headers.get('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Type', ct)
                self.send_header('Content-Length', str(len(resp_body)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'text/plain')
            self.send_cors()
            self.end_headers()
            self.wfile.write(err_body[:500])
        except Exception as e:
            msg = str(e).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.send_cors()
            self.end_headers()
            self.wfile.write(msg)

    def _forward(self, url, body, headers):
        """Forward a POST request to url and stream the response back."""
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                ct = resp.headers.get('Content-Type', 'application/json')
                self.send_header('Content-Type', ct)
                self.send_header('Content-Length', str(len(resp_body)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(err_body)
        except Exception as e:
            msg = json.dumps({'error': str(e)}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(msg)


if __name__ == '__main__':
    os.chdir(BASE_DIR)
    server = http.server.HTTPServer(('localhost', PORT), Handler)
    print(f'\n✅  Nepal Viral News Generator is running!')
    print(f'👉  Open in browser: http://localhost:{PORT}\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        sys.exit(0)
