"""
Local dev server for Nepal Viral News Generator
Run:   python server.py
Open:  http://localhost:3000

Acts as a static file server + CORS proxy for Gemini and Remove.bg APIs.
API keys are loaded from .env — the browser NEVER sees them.
On Render.com, PORT env var is injected automatically (defaults to 3000 locally).
"""
import http.server
import urllib.request
import urllib.parse
import os
import sys
import mimetypes
import json
import cgi
import tempfile
import base64
from io import BytesIO
from socketserver import ThreadingMixIn

# Render injects PORT; fall back to 3000 for local dev
PORT = int(os.environ.get('PORT', 3000))

# ── Optional: yfinance for live prices ──
_yfinance_available = False
try:
    import yfinance as yf
    _yfinance_available = True
    print('✅  yfinance ready — /api/live-prices enabled')
except ImportError:
    print('⚠️  yfinance not installed — run: pip install yfinance>=0.2.40')


# ── Optional: InsightFace face-swap (only available when pip deps installed) ──
_faceswap_available = False
try:
    import cv2
    import numpy as np
    import insightface
    from insightface.app import FaceAnalysis as _FaceAnalysis
    from insightface.model_zoo import get_model as _get_model

    _FACE_ANALYSER = _FaceAnalysis(
        name='buffalo_l',
        providers=['CPUExecutionProvider']
    )
    _FACE_ANALYSER.prepare(ctx_id=-1, det_size=(640, 640))

    _SWAPPER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'inswapper_128.onnx')
    if os.path.exists(_SWAPPER_PATH):
        _SWAPPER = _get_model(_SWAPPER_PATH, providers=['CPUExecutionProvider'])
        _faceswap_available = True
        print('✅  InsightFace face-swap ready (inswapper_128.onnx found)')
    else:
        print('⚠️  InsightFace installed but inswapper_128.onnx not found — /api/faceswap disabled')
except ImportError:
    print('ℹ️  InsightFace not installed — /api/faceswap disabled (cloud HF Space used instead)')
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

if not GEMINI_API_KEY:
    print('⚠️  GEMINI_API_KEY not set in .env')
if not REMOVEBG_API_KEY:
    print('⚠️  REMOVEBG_API_KEY not set in .env')


def save_key_to_env(key_name, value):
    """Write or update KEY=VALUE in .env then hot-reload the global."""
    global GEMINI_API_KEY, REMOVEBG_API_KEY
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-Gemini-Key, X-Groq-Key',
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

        # ── AI Pandit: /api/pandit/panchang?date=YYYY-MM-DD ──
        if pathname == '/api/pandit/panchang':
            self._pandit_panchang(qs)
            return

        # ── Live prices: /api/live-prices?symbols=RELIANCE.NS,TCS.NS&market=NSE ──
        if pathname == '/api/live-prices':
            if not _yfinance_available:
                err = json.dumps({'error': 'yfinance not installed on server. Run: pip install yfinance>=0.2.40'}).encode()
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return

            symbols_raw  = qs.get('symbols', [''])[0]
            market       = qs.get('market', ['NSE'])[0].upper()

            if not symbols_raw:
                err = json.dumps({'error': 'Missing ?symbols= parameter'}).encode()
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return

            raw_list = [s.strip() for s in symbols_raw.split(',') if s.strip()]

            # Auto-append exchange suffix based on market
            SUFFIX_MAP = {
                'NSE': '.NS', 'BSE': '.BO', 'NEPSE': '',
                'NYSE': '', 'NASDAQ': '',
                'CRYPTO': '-USD', 'FOREX': '=X'
            }
            suffix = SUFFIX_MAP.get(market, '')

            def _ticker(sym):
                # Already has suffix → use as-is
                for known_sfx in ['.NS','.BO','-USD','=X','.L','.T']:
                    if sym.endswith(known_sfx):
                        return sym
                return sym + suffix

            ticker_map = {sym: _ticker(sym) for sym in raw_list}
            yf_tickers = list(ticker_map.values())

            try:
                # Download 2-day history; period='1d' sometimes gives empty
                import datetime
                data = yf.download(
                    tickers=yf_tickers,
                    period='2d',
                    interval='1d',
                    group_by='ticker',
                    auto_adjust=True,
                    progress=False,
                    threads=True
                )
                results = {}
                for sym, ticker in ticker_map.items():
                    try:
                        if len(yf_tickers) == 1:
                            df = data
                        else:
                            df = data[ticker] if ticker in data.columns.get_level_values(0) else None

                        if df is None or df.empty:
                            results[sym] = {'error': 'No data'}
                            continue

                        latest  = df.iloc[-1]
                        prev    = df.iloc[-2] if len(df) >= 2 else df.iloc[-1]
                        close   = float(latest['Close'])
                        prev_cl = float(prev['Close'])
                        chg     = close - prev_cl
                        chg_pct = (chg / prev_cl * 100) if prev_cl else 0
                        vol     = float(latest['Volume']) if 'Volume' in latest else 0
                        high    = float(latest['High'])   if 'High'   in latest else close
                        low     = float(latest['Low'])    if 'Low'    in latest else close
                        open_p  = float(latest['Open'])   if 'Open'   in latest else close

                        results[sym] = {
                            'symbol':     sym,
                            'ticker':     ticker,
                            'price':      round(close, 2),
                            'open':       round(open_p, 2),
                            'high':       round(high, 2),
                            'low':        round(low, 2),
                            'prev_close': round(prev_cl, 2),
                            'change':     round(chg, 2),
                            'change_pct': round(chg_pct, 2),
                            'volume':     int(vol),
                            'timestamp':  datetime.datetime.utcnow().isoformat() + 'Z',
                        }
                    except Exception as sym_err:
                        results[sym] = {'error': str(sym_err)}

                payload = json.dumps({'ok': True, 'market': market, 'prices': results}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Cache-Control', 'no-store')
                self.send_cors()
                self.end_headers()
                self.wfile.write(payload)
            except Exception as e:
                err = json.dumps({'error': str(e)}).encode()
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
            return

        # ── Proxy: /proxy/fetch?url=... → fetch any external URL (RSS, articles) ──
        if pathname == '/proxy/fetch':
            target_url = qs.get('url', [''])[0]
            if not target_url:
                self.send_response(400); self.end_headers()
                self.wfile.write(b'Missing ?url= parameter')
                return
            self._proxy_fetch(target_url)
            return

        # ── Article extractor: /api/article?url=... → fetch page + extract body text ──
        if pathname == '/api/article':
            target_url = qs.get('url', [''])[0]
            if not target_url:
                self.send_response(400); self.end_headers()
                self.wfile.write(b'Missing ?url= parameter')
                return
            self._fetch_article_text(target_url)
            return

        # ── Status: /api/key-status → tells browser which keys are configured ──
        if pathname == '/api/key-status':
            payload = json.dumps({
                'gemini':   bool(GEMINI_API_KEY),
                'removebg': bool(REMOVEBG_API_KEY),
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

        # Serve AI video outputs from aivs_output/
        if pathname.startswith('/aivs_output/'):
            file_path = os.path.normpath(os.path.join(BASE_DIR, pathname.lstrip('/')))
            if os.path.isfile(file_path):
                with open(file_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Accept-Ranges', 'bytes')
                self.send_cors()
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(404); self.end_headers()
            return

        if pathname == '/':
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

        # ── Proxy: /proxy/gemini-withkey → Gemini using browser-supplied key ──
        #    Used when GEMINI_API_KEY is not in .env but user entered key in UI.
        #    Key is passed via X-Gemini-Key header — avoids CORS block on localhost.
        if pathname == '/proxy/gemini-withkey':
            browser_key = self.headers.get('x-gemini-key', '')
            key_to_use = GEMINI_API_KEY or browser_key
            if not key_to_use:
                err = json.dumps({'error': 'No Gemini API key available'}).encode()
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return
            target = (
                f'https://generativelanguage.googleapis.com/v1beta/models/'
                f'gemini-2.0-flash:generateContent?key={urllib.parse.quote(key_to_use)}'
            )
            print('  [proxy] Gemini (browser key) →')
            self._forward(target, body, {
                'Content-Type': self.headers.get('Content-Type', 'application/json'),
            })
            return

        # ── Proxy: /proxy/groq → Groq API (browser-supplied key via X-Groq-Key header) ──
        #    Used on localhost to avoid CORS blocks when calling api.groq.com directly.
        if pathname == '/proxy/groq':
            groq_key = self.headers.get('x-groq-key', '')
            if not groq_key:
                err = json.dumps({'error': 'No Groq API key supplied in X-Groq-Key header'}).encode()
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return
            target = 'https://api.groq.com/openai/v1/chat/completions'
            print(f'  [proxy] Groq → (key prefix: {groq_key[:8]}…)')
            self._forward(target, body, {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {groq_key}',
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

        # ── Face Swap: /api/faceswap → InsightFace swap (requires pip deps) ──
        if pathname == '/api/faceswap':
            if not _faceswap_available:
                err = json.dumps({'error': 'Face swap not available on this server. Use the HuggingFace Space.'}).encode()
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
                return
            try:
                # Parse multipart form: face_photo (source) + target_image (target)
                content_type = self.headers.get('Content-Type', '')
                if 'multipart/form-data' not in content_type:
                    raise ValueError('Expected multipart/form-data')

                # Use cgi.FieldStorage to parse multipart
                environ = {
                    'REQUEST_METHOD': 'POST',
                    'CONTENT_TYPE': content_type,
                    'CONTENT_LENGTH': self.headers.get('Content-Length', '0'),
                }
                fs = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ=environ)

                face_data = fs['face_photo'].file.read()
                target_data = fs['target_image'].file.read()

                # Decode images
                face_arr = cv2.imdecode(np.frombuffer(face_data, np.uint8), cv2.IMREAD_COLOR)
                target_arr = cv2.imdecode(np.frombuffer(target_data, np.uint8), cv2.IMREAD_COLOR)

                # Detect source face (largest)
                src_faces = _FACE_ANALYSER.get(face_arr)
                if not src_faces:
                    raise ValueError('No face detected in source image')
                src_face = sorted(src_faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]

                # Swap all faces in target
                tgt_faces = _FACE_ANALYSER.get(target_arr)
                if not tgt_faces:
                    raise ValueError('No face detected in target image')
                result = target_arr.copy()
                for tgt_face in tgt_faces:
                    result = _SWAPPER.get(result, tgt_face, src_face, paste_back=True)

                # Encode result as JPEG
                _, buf = cv2.imencode('.jpg', result, [cv2.IMWRITE_JPEG_QUALITY, 92])
                resp_body = buf.tobytes()

                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(resp_body)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(resp_body)
                print('  [faceswap] done ✅')
            except Exception as e:
                err = json.dumps({'error': str(e)}).encode()
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors()
                self.end_headers()
                self.wfile.write(err)
            return

        # ── AI Video: /api/aivideo/status → ping local AI services ──
        if pathname == '/api/aivideo/status':
            self._aivideo_status()
            return

        # ── AI Video: /api/aivideo/script → Ollama LLaMA3 script generation ──
        if pathname == '/api/aivideo/script':
            self._aivideo_script(body)
            return

        # ── AI Video: /api/aivideo/image → ComfyUI / SDXL image generation ──
        if pathname == '/api/aivideo/image':
            self._aivideo_image(body)
            return

        # ── AI Video: /api/aivideo/tts → XTTS v2 / Bark voice synthesis ──
        if pathname == '/api/aivideo/tts':
            self._aivideo_tts(body)
            return

        # ── AI Video: /api/aivideo/music → AudioCraft MusicGen ──
        if pathname == '/api/aivideo/music':
            self._aivideo_music(body)
            return

        # ── AI Video: /api/aivideo/assemble → FFmpeg video assembly ──
        if pathname == '/api/aivideo/assemble':
            self._aivideo_assemble(body)
            return

        self.send_response(404)
        self.end_headers()

    # ══════════════════════════════════════════════════════════════
    #  AI PANDIT  —  Hindu calendar / panchang helper
    # ══════════════════════════════════════════════════════════════

    def _pandit_panchang(self, qs):
        """Compute approximate Panchang for a given date (YYYY-MM-DD).
        Uses lunar-phase math; no external library required."""
        import datetime, math
        date_str = qs.get('date', [''])[0]
        try:
            if date_str:
                date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
            else:
                date = datetime.date.today()
        except ValueError:
            date = datetime.date.today()

        # Julian Day Number
        Y, M, D = date.year, date.month, date.day
        A = (14 - M) // 12
        y = Y + 4800 - A
        m = M + 12 * A - 3
        jd = D + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045

        # Lunar cycle  (reference new moon: JD 2451551.259 = Jan 6 2000)
        synodic = 29.530588853
        elapsed = jd - 2451551.259
        cycle_pos = elapsed % synodic
        if cycle_pos < 0:
            cycle_pos += synodic

        tithi_index = int(cycle_pos * 30 / synodic)   # 0-29
        paksha = 'शुक्ल पक्ष' if tithi_index < 15 else 'कृष्ण पक्ष'
        tithi_in_paksha = tithi_index if tithi_index < 15 else tithi_index - 15
        tithis = ['प्रतिपदा','द्वितीया','तृतीया','चतुर्थी','पंचमी','षष्ठी',
                  'सप्तमी','अष्टमी','नवमी','दशमी','एकादशी','द्वादशी',
                  'त्रयोदशी','चतुर्दशी']
        if tithi_index == 14:
            tithi_name = 'पूर्णिमा'
        elif tithi_index == 29:
            tithi_name = 'अमावस्या'
        else:
            tithi_name = tithis[min(tithi_in_paksha, 13)]

        moon_lon = ((jd - 2451545.0) * 13.176396 + 231.67) % 360
        sun_lon  = ((jd - 2451545.0) * 0.9856473 + 280.46) % 360
        nakshatras = ['अश्विनी','भरणी','कृत्तिका','रोहिणी','मृगशिरा','आर्द्रा',
                      'पुनर्वसु','पुष्य','आश्लेषा','मघा','पूर्व फाल्गुनी',
                      'उत्तर फाल्गुनी','हस्त','चित्रा','स्वाती','विशाखा',
                      'अनुराधा','ज्येष्ठा','मूल','पूर्वाषाढ़ा','उत्तराषाढ़ा',
                      'श्रवण','धनिष्ठा','शतभिषा','पूर्व भाद्रपदा',
                      'उत्तर भाद्रपदा','रेवती']
        yogas = ['विष्कम्भ','प्रीति','आयुष्मान','सौभाग्य','शोभन','अतिगण्ड',
                 'सुकर्मा','धृति','शूल','गण्ड','वृद्धि','ध्रुव','व्याघात',
                 'हर्षण','वज्र','सिद्धि','व्यतीपात','वरीयान','परिघ','शिव',
                 'सिद्ध','साध्य','शुभ','शुक्ल','ब्रह्म','ऐन्द्र','वैधृति']
        varars = ['रविवार','सोमवार','मंगलवार','बुधवार','गुरुवार','शुक्रवार','शनिवार']

        nak_idx   = int(moon_lon / (360/27)) % 27
        yoga_idx  = int(((sun_lon + moon_lon) % 360) / (360/27)) % 27
        varar_idx = date.weekday()  # 0=Mon, 6=Sun in Python
        # Convert Python weekday (Mon=0) to Hindu varar (Sun=0)
        varar_idx = (date.weekday() + 1) % 7

        result = {
            'date':       date.isoformat(),
            'tithi':      tithi_name,
            'paksha':     paksha,
            'nakshatra':  nakshatras[nak_idx],
            'yoga':       yogas[yoga_idx],
            'varar':      varars[varar_idx],
            'cycle_pos':  round(cycle_pos, 3),
            'tithi_index': tithi_index,
        }
        payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_cors()
        self.end_headers()
        self.wfile.write(payload)
        print(f'  [pandit/panchang] {date} → {tithi_name}, {nakshatras[nak_idx]}')

    # ══════════════════════════════════════════════════════════════
    #  AI VIDEO STUDIO  —  local AI pipeline helpers
    # ══════════════════════════════════════════════════════════════

    def _aivideo_ping(self, url, timeout=3):
        """Return True if a local service is reachable."""
        try:
            req = urllib.request.Request(url, method='GET')
            with urllib.request.urlopen(req, timeout=timeout):
                return True
        except Exception:
            return False

    def _aivideo_status(self):
        """Ping all local AI services and return their availability."""
        import shutil
        services = {
            'ollama':     self._aivideo_ping('http://localhost:11434'),
            'comfyui':    self._aivideo_ping('http://localhost:8188'),
            'xtts':       self._aivideo_ping('http://localhost:8020'),
            'audiocraft': self._aivideo_ping('http://localhost:7861'),
            'ffmpeg':     shutil.which('ffmpeg') is not None,
        }
        payload = json.dumps({'services': services}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_cors()
        self.end_headers()
        self.wfile.write(payload)
        print(f'  [aivideo/status] {services}')

    def _aivideo_script(self, body):
        """Proxy to Ollama LLaMA3 for script generation."""
        try:
            data = json.loads(body.decode('utf-8'))
            model  = data.get('model', 'llama3')
            prompt = data.get('prompt', '')
            system = data.get('system', '')

            ollama_payload = json.dumps({
                'model':  model,
                'prompt': prompt,
                'system': system,
                'stream': False,
                'options': {'temperature': 0.85, 'num_predict': 2048}
            }).encode()

            req = urllib.request.Request(
                'http://localhost:11434/api/generate',
                data=ollama_payload,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                result = json.dumps({'response': resp_data.get('response', '')}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(result)))
                self.send_cors()
                self.end_headers()
                self.wfile.write(result)
                print('  [aivideo/script] Ollama script generated ✅')
        except Exception as e:
            err = json.dumps({'error': f'Ollama error: {e}. Is Ollama running? Run: ollama serve'}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(err)

    def _aivideo_image(self, body):
        """Generate image via ComfyUI API or fallback to Automatic1111."""
        import base64, io
        try:
            data = json.loads(body.decode('utf-8'))
            prompt   = data.get('prompt', '')
            neg      = data.get('negative_prompt', 'blurry, low quality')
            width    = data.get('width', 576)
            height   = data.get('height', 1024)
            steps    = data.get('steps', 25)
            cfg      = data.get('cfg_scale', 7.5)

            # Try ComfyUI first (prompt via /prompt endpoint)
            comfy_payload = json.dumps({
                'prompt': {
                    '3': {'class_type': 'KSampler', 'inputs': {
                        'seed': int.from_bytes(os.urandom(4), 'big'),
                        'steps': steps, 'cfg': cfg,
                        'sampler_name': 'euler', 'scheduler': 'karras',
                        'denoise': 1.0,
                        'model': ['4', 0],
                        'positive': ['6', 0], 'negative': ['7', 0],
                        'latent_image': ['5', 0]
                    }},
                    '4': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'juggernautXL_v9.safetensors'}},
                    '5': {'class_type': 'EmptyLatentImage', 'inputs': {'width': width, 'height': height, 'batch_size': 1}},
                    '6': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['4', 1]}},
                    '7': {'class_type': 'CLIPTextEncode', 'inputs': {'text': neg,    'clip': ['4', 1]}},
                    '8': {'class_type': 'VAEDecode',     'inputs': {'samples': ['3', 0], 'vae': ['4', 2]}},
                    '9': {'class_type': 'SaveImage',     'inputs': {'images': ['8', 0], 'filename_prefix': 'aivs_'}},
                }
            }).encode()

            req = urllib.request.Request(
                'http://localhost:8188/prompt',
                data=comfy_payload,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                prompt_id = resp_data.get('prompt_id')

            # Poll for result
            import time
            img_b64 = None
            for _ in range(60):
                time.sleep(2)
                hist_req = urllib.request.Request(
                    f'http://localhost:8188/history/{prompt_id}', method='GET'
                )
                with urllib.request.urlopen(hist_req, timeout=10) as hr:
                    hist = json.loads(hr.read().decode('utf-8'))
                if prompt_id in hist:
                    outputs = hist[prompt_id].get('outputs', {})
                    for node_out in outputs.values():
                        imgs = node_out.get('images', [])
                        if imgs:
                            img_name = imgs[0]['filename']
                            img_req = urllib.request.Request(
                                f'http://localhost:8188/view?filename={img_name}&type=output',
                                method='GET'
                            )
                            with urllib.request.urlopen(img_req, timeout=15) as ir:
                                img_b64 = base64.b64encode(ir.read()).decode()
                            break
                    break

            if not img_b64:
                raise Exception('ComfyUI did not return image in time')

            result = json.dumps({'image': img_b64}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(result)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(result)
            print(f'  [aivideo/image] ComfyUI image generated ✅')

        except Exception as e:
            err = json.dumps({'error': f'Image gen error: {e}. Is ComfyUI running on port 8188?'}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(err)

    def _aivideo_tts(self, body):
        """Synthesise voice via XTTS v2 REST API."""
        import base64
        try:
            data  = json.loads(body.decode('utf-8'))
            text  = data.get('text', '')
            lang  = data.get('language', 'en')
            speed = data.get('speed', 1.0)

            # XTTS v2 API endpoint (coqui/xtts-v2 server)
            tts_payload = json.dumps({
                'text': text,
                'language': lang,
                'speaker_wav': None,
                'speed': speed
            }).encode()

            req = urllib.request.Request(
                'http://localhost:8020/tts_to_audio/',
                data=tts_payload,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                audio_bytes = resp.read()
                audio_b64   = base64.b64encode(audio_bytes).decode()

            result = json.dumps({'audio': audio_b64}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(result)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(result)
            print(f'  [aivideo/tts] XTTS voice generated ✅ ({len(audio_bytes)} bytes)')

        except Exception as e:
            err = json.dumps({'error': f'TTS error: {e}. Is XTTS v2 running on port 8020?'}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(err)

    def _aivideo_music(self, body):
        """Generate background music via AudioCraft MusicGen (Gradio API)."""
        import base64
        try:
            data     = json.loads(body.decode('utf-8'))
            prompt   = data.get('prompt', 'cinematic epic music')
            duration = int(data.get('duration', 30))

            # AudioCraft Gradio API (predict endpoint)
            ac_payload = json.dumps({
                'data': [prompt, 'melody', duration]
            }).encode()

            req = urllib.request.Request(
                'http://localhost:7861/run/predict',
                data=ac_payload,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                # Gradio returns audio file path or base64
                output = resp_data.get('data', [None])[0]
                if isinstance(output, dict):
                    # New Gradio format: {'name': '/tmp/...', 'data': None}
                    audio_path = output.get('name', '')
                    with open(audio_path, 'rb') as af:
                        audio_b64 = base64.b64encode(af.read()).decode()
                elif isinstance(output, str) and output.startswith('data:'):
                    audio_b64 = output.split(',', 1)[1]
                else:
                    raise Exception('Unexpected AudioCraft response format')

            result = json.dumps({'audio': audio_b64}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(result)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(result)
            print('  [aivideo/music] AudioCraft music generated ✅')

        except Exception as e:
            err = json.dumps({'error': f'Music gen error: {e}. Is AudioCraft running on port 7861?'}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(err)

    def _aivideo_assemble(self, body):
        """Assemble final video using FFmpeg from images + audio per scene."""
        import base64, tempfile, subprocess, shutil
        tmp = tempfile.mkdtemp(prefix='aivs_')
        try:
            data       = json.loads(body.decode('utf-8'))
            scenes     = data.get('scenes', [])
            music_b64  = data.get('music')
            music_vol  = float(data.get('music_vol', 0.25))
            fps        = int(data.get('fps', 30))
            fade       = data.get('fade', True)

            if not scenes:
                raise ValueError('No scenes provided')
            if not shutil.which('ffmpeg'):
                raise RuntimeError('FFmpeg not found. Install FFmpeg and add to PATH.')

            # Write each scene image + audio, produce clip
            clip_files = []
            for i, scene in enumerate(scenes):
                dur = float(scene.get('duration', 5))
                img_path   = os.path.join(tmp, f'img_{i}.png')
                audio_path = os.path.join(tmp, f'audio_{i}.wav')
                clip_path  = os.path.join(tmp, f'clip_{i}.mp4')

                # Write image
                if scene.get('image'):
                    with open(img_path, 'wb') as f:
                        f.write(base64.b64decode(scene['image']))
                else:
                    # Black frame fallback
                    subprocess.run([
                        'ffmpeg', '-y', '-f', 'lavfi',
                        '-i', 'color=c=black:s=1080x1920:r=30',
                        '-t', str(dur), img_path.replace('.png', '.mp4')
                    ], check=True, capture_output=True)
                    img_path = img_path.replace('.png', '.mp4')

                # Write audio
                if scene.get('audio'):
                    with open(audio_path, 'wb') as f:
                        f.write(base64.b64decode(scene['audio']))
                    # Build clip: image + audio, Ken Burns zoom
                    cmd = [
                        'ffmpeg', '-y',
                        '-loop', '1', '-i', img_path,
                        '-i', audio_path,
                        '-filter_complex',
                        f'[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,'
                        f'zoompan=z=\'min(zoom+0.0008,1.5)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d={int(dur*fps)}:s=1080x1920:fps={fps},'
                        f'{"fade=t=out:st=" + str(dur-0.5) + ":d=0.5," if fade else ""}setsar=1[v]',
                        '-map', '[v]', '-map', '1:a',
                        '-t', str(dur), '-c:v', 'libx264', '-preset', 'fast',
                        '-c:a', 'aac', '-b:a', '128k', '-shortest', clip_path
                    ]
                else:
                    cmd = [
                        'ffmpeg', '-y',
                        '-loop', '1', '-i', img_path,
                        '-filter_complex',
                        f'[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,'
                        f'zoompan=z=\'min(zoom+0.0008,1.5)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d={int(dur*fps)}:s=1080x1920:fps={fps},'
                        f'setsar=1[v]',
                        '-map', '[v]', '-an',
                        '-t', str(dur), '-c:v', 'libx264', '-preset', 'fast', clip_path
                    ]
                subprocess.run(cmd, check=True, capture_output=True, timeout=120)
                clip_files.append(clip_path)

            # Concat all clips
            concat_list = os.path.join(tmp, 'concat.txt')
            with open(concat_list, 'w') as f:
                for cf in clip_files:
                    f.write(f"file '{cf}'\n")

            concat_path = os.path.join(tmp, 'concat.mp4')
            subprocess.run([
                'ffmpeg', '-y', '-f', 'concat', '-safe', '0',
                '-i', concat_list, '-c', 'copy', concat_path
            ], check=True, capture_output=True, timeout=60)

            # Mix background music
            final_path = os.path.join(tmp, 'final.mp4')
            if music_b64:
                music_path = os.path.join(tmp, 'music.wav')
                with open(music_path, 'wb') as f:
                    f.write(base64.b64decode(music_b64))
                subprocess.run([
                    'ffmpeg', '-y',
                    '-i', concat_path, '-i', music_path,
                    '-filter_complex',
                    f'[0:a]volume=1.0[a0];[1:a]volume={music_vol}[a1];[a0][a1]amix=inputs=2:duration=first[aout]',
                    '-map', '0:v', '-map', '[aout]',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', final_path
                ], check=True, capture_output=True, timeout=120)
            else:
                final_path = concat_path

            # Copy final to output dir for serving
            out_name    = f'aivs_output_{os.urandom(4).hex()}.mp4'
            out_dir     = os.path.join(BASE_DIR, 'aivs_output')
            os.makedirs(out_dir, exist_ok=True)
            out_path    = os.path.join(out_dir, out_name)
            shutil.copy2(final_path, out_path)

            result = json.dumps({'url': f'/aivs_output/{out_name}', 'ok': True}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(result)))
            self.send_cors()
            self.end_headers()
            self.wfile.write(result)
            print(f'  [aivideo/assemble] Video assembled ✅ → {out_name}')

        except Exception as e:
            err = json.dumps({'error': str(e)}).encode()
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_cors()
            self.end_headers()
            self.wfile.write(err)
        finally:
            try:
                shutil.rmtree(tmp, ignore_errors=True)
            except Exception:
                pass

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

    def _fetch_article_text(self, url):
        """Fetch a news article page and extract its clean body text.
        Returns JSON: { ok: bool, text: str }  — always HTTP 200 so client can read the body.
        Strategy: only remove <script>/<style>, then harvest every <p> that looks like
        real article content (≥60 chars, contains Devanagari or ends with sentence punctuation).
        """
        import re, gzip as _gzip, html as _html_mod
        try:
            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ne-NP,ne;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    'Referer': 'https://www.google.com/',
                    'Cache-Control': 'no-cache',
                },
                method='GET'
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                ct  = resp.headers.get('Content-Type', '')
                enc = resp.headers.get('Content-Encoding', '')

            # Decompress gzip
            if enc == 'gzip' or (len(raw) > 2 and raw[:2] == b'\x1f\x8b'):
                try:
                    raw = _gzip.decompress(raw)
                except Exception:
                    pass

            # Detect charset
            charset = 'utf-8'
            m = re.search(r'charset=([^\s;"\'>]+)', ct, re.I)
            if not m:
                m = re.search(r'charset=([^\s;"\'>]+)', raw[:2000].decode('latin-1', errors='replace'), re.I)
            if m:
                charset = m.group(1).strip()

            html_str = raw.decode(charset, errors='replace')

            # ── Step 1: Remove only <script> and <style> (safe, never contain article text) ──
            html_str = re.sub(r'<!--.*?-->', ' ', html_str, flags=re.S)
            html_str = re.sub(r'<script[^>]*>.*?</script>', ' ', html_str, flags=re.S | re.I)
            html_str = re.sub(r'<style[^>]*>.*?</style>',  ' ', html_str, flags=re.S | re.I)

            # ── Step 2: Harvest <p> tags — filter for article content ──
            paras = re.findall(r'<p[^>]*>(.*?)</p>', html_str, re.S | re.I)
            collected = []
            for p in paras:
                # Strip inner tags
                txt = re.sub(r'<[^>]+>', ' ', p)
                txt = _html_mod.unescape(txt)
                txt = re.sub(r'\s+', ' ', txt).strip()
                # Must be ≥60 chars
                if len(txt) < 60:
                    continue
                # Must contain Devanagari script
                if not re.search(r'[\u0900-\u097F]{5,}', txt):
                    continue
                # Skip navigation-style content (slash-delimited category lists, breadcrumbs)
                slash_count = txt.count('/')
                danda_count = txt.count('।')
                if slash_count >= 3 and slash_count > danda_count:
                    continue
                # Skip paragraphs that look like tag clouds or category dumps (many short words)
                words = txt.split()
                avg_word_len = sum(len(w) for w in words) / max(len(words), 1)
                if avg_word_len < 3 and len(words) > 20:
                    continue
                collected.append(txt)

            if collected:
                text = '\n\n'.join(collected)
            else:
                # Fallback: strip all tags, keep lines ≥80 chars with Devanagari
                raw_text = re.sub(r'<[^>]+>', ' ', html_str)
                raw_text = _html_mod.unescape(raw_text)
                lines = [ln.strip() for ln in raw_text.splitlines()
                         if len(ln.strip()) >= 80 and re.search(r'[\u0900-\u097F]{5,}', ln)]
                text = '\n'.join(lines[:60])

            text = text.strip()[:5000]
            payload = json.dumps({'ok': True, 'text': text}).encode('utf-8')
        except Exception as e:
            payload = json.dumps({'ok': False, 'text': '', 'error': str(e)}).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_cors()
        self.end_headers()
        self.wfile.write(payload)

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

    class ThreadingHTTPServer(ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True  # threads die when main thread exits

    server = ThreadingHTTPServer(('localhost', PORT), Handler)
    print(f'\n✅  Nepal Viral News Generator is running!')
    print(f'👉  Open in browser: http://localhost:{PORT}\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        sys.exit(0)
