/* ================================================================
   Nepal Viral News Generator — Application Logic
   app.js
================================================================ */

/* ── Global JS error catcher — shows errors visibly on page ── */
window.onerror = function(msg, src, line, col, err) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7f1d1d;color:#fecaca;padding:10px 16px;font-size:.85rem;z-index:99999;font-family:monospace;white-space:pre-wrap;';
  d.textContent = '❌ JS ERROR: ' + msg + '\n  at ' + src + ':' + line + ':' + col;
  document.body.prepend(d);
};

/* ── Globals ─────────────────────────────────────────────────── */
const CANVAS_W  = 1080;
const CANVAS_H  = 1080;

/* ── AI (Gemini) Configuration ──────────────────────────────── */
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/* When running via the local Node server (http://localhost:*) all API calls
   are routed through the built-in proxy endpoints — the browser never sends
   or sees the API keys (they live in .env on the server only).
   When the file is opened directly (file://) direct URLs are used — note
   that file:// origins are blocked by CORS; always use `node server.js`. */
const _isLocalhost = location.protocol === 'http:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
/* True only when running via node server.js on port 3000 — the proxy endpoints exist */
const _isNodeServer = _isLocalhost && (location.port === '3000' || location.port === '');
const _geminiProxyBase   = _isNodeServer ? '/proxy/gemini'   : null;
const _removebgProxyBase = _isNodeServer ? '/proxy/removebg' : null;
const _fetchProxyBase    = _isNodeServer ? '/proxy/fetch'    : null;

/* Key availability flags — populated from /api/key-status on load.
   The actual key strings NEVER exist in the browser when using the local proxy.
   On GitHub Pages (no server), keys are entered by the user and stored in localStorage. */
let _geminiKey    = false;   // true = server has Gemini key configured
let _removebgKey  = false;   // true = server has Remove.bg key configured

/* ── Browser-side keys for GitHub Pages mode (no server proxy) ──
   On localhost these are always empty — the server proxy handles keys.
   On GitHub Pages the user enters them manually and they are saved to localStorage. */
const _LS_GEMINI   = 'ghp_gemini_key';
const _LS_REMOVEBG = 'ghp_removebg_key';
let _browserGeminiKey   = localStorage.getItem(_LS_GEMINI)   || '';
let _browserRemovebgKey = localStorage.getItem(_LS_REMOVEBG) || '';

/* ── Groq + HuggingFace keys (GitHub Pages / browser mode) ── */
const _LS_GROQ = 'ghp_groq_key';
const _LS_HF   = 'ghp_hf_key';
let _browserGroqKey = localStorage.getItem(_LS_GROQ) || '';
let _browserHFKey   = localStorage.getItem(_LS_HF)   || '';

/* Background styles for AI image enhancement */
const BG_STYLES = [
  { id: 'newsroom',    label: '📺 News Studio',       desc: 'Dark broadcast studio with red accents' },
  { id: 'parliament',  label: '🏛️ Parliament',         desc: 'Official government building ambience' },
  { id: 'mountains',   label: '🏔️ Himalaya',           desc: 'Epic Himalayan mountain panorama' },
  { id: 'city',        label: '🌆 Kathmandu City',     desc: 'City skyline at golden hour' },
  { id: 'breaking',    label: '🚨 Breaking Red',       desc: 'High-impact breaking news backdrop' },
  { id: 'press',       label: '🎙️ Press Conference',   desc: 'Formal press conference backdrop' },
  { id: 'field',       label: '🌾 Rural Nepal',        desc: 'Green hillside outdoor field' },
  { id: 'digital',     label: '💡 Digital / Tech',     desc: 'Futuristic digital data background' },
];

/* Currently selected BG style for enhance feature */
let _selectedBgStyle = 'newsroom';
/* DataURL of the bg-removed subject (cached to avoid repeat API calls) */
let _subjectDataUrl  = null;
/* Loaded Image object for the bg-removed subject (cached for instant redraw) */
let _subjectImg = null;
/* DataURL of whichever image is currently on the canvas (custom OR news photo) */
let _activeImageDataUrl = null;
/* True while the canvas is showing an AI-enhanced background composite */
let _enhancedMode = false;
/* Sprite-like bounding box for the main subject in enhanced mode — allows
   the handle canvas to make it selectable / draggable / resizable.
   null when not in enhanced mode. Fields: x, y, w, h, rot  (canvas-pixel space). */
let _mainImgSprite = null;
/* True when the main image sprite is the currently selected object */
let _mainImgSelected = false;

/* ─────────────────────────────────────────────────────────────────
   NEWS SOURCES
   • Google News RSS — pulls trending stories from ALL Nepali outlets
     aggregated by Google, no rate limits, always fresh
   • Google Trends RSS — real trending search topics in Nepal
   • Individual Nepali outlets — direct RSS for extra coverage
   All fetched in parallel; results are merged, de-duped & viral-scored.

   TRENDING LOGIC (multi-signal):
   1. Recency      — newer articles score higher (decays over 48h)
   2. Viral keywords — death/crisis/breaking/protest words boost score
   3. Cross-source frequency — same story covered by 3+ sources = highly trending
   4. Google Trends boost — if a keyword is actively trending on Google in Nepal
   5. Time-of-day peak — stories published 6am-9pm Nepal time score higher
   ───────────────────────────────────────────────────────────────── */
const RSS_FEEDS = [
  /* ── Google News RSS — Nepal trending (no rate limit, real-time) ── */
  { url: 'https://news.google.com/rss/search?q=nepal&hl=ne&gl=NP&ceid=NP:ne',
                                                    name: 'Google News NP (Nepali)', lang: 'ne' },
  { url: 'https://news.google.com/rss/search?q=nepal&hl=en&gl=NP&ceid=NP:en',
                                                    name: 'Google News NP (English)', lang: 'en' },
  { url: 'https://news.google.com/rss/headlines/section/geo/NP?hl=en&gl=NP&ceid=NP:en',
                                                    name: 'Google Top Stories Nepal', lang: 'en' },
  { url: 'https://news.google.com/rss/search?q=%E0%A4%A8%E0%A5%87%E0%A4%AA%E0%A4%BE%E0%A4%B2+%E0%A4%AC%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%95%E0%A4%BF%E0%A4%99&hl=ne&gl=NP&ceid=NP:ne',
                                                    name: 'Google ब्रेकिङ Nepal',    lang: 'ne' },

  /* ── Google Trends RSS — what Nepal is SEARCHING right now ──
     These feeds tell us what topics people are actively searching/engaging with.
     Higher search volume = higher trending signal. */
  { url: 'https://trends.google.com/trending/rss?geo=NP',
                                                    name: 'Google Trends Nepal',      lang: 'en', isTrendsSource: true },

  /* ── Direct Nepali outlet RSS feeds ── */
  { url: 'https://www.onlinekhabar.com/feed',       name: 'Online Khabar',           lang: 'ne' },
  { url: 'https://www.setopati.com/feed',            name: 'Setopati',                lang: 'ne' },
  { url: 'https://ratopati.com/feed',                name: 'Ratopati',                lang: 'ne' },
  { url: 'https://www.ekantipur.com/rss/',           name: 'eKantipur',               lang: 'ne' },
  { url: 'https://thehimalayantimes.com/feed/',      name: 'Himalayan Times',         lang: 'en' },
  { url: 'https://kathmandupost.com/rss',            name: 'Kathmandu Post',          lang: 'en' },
  { url: 'https://www.nepalnews.com/feed/',          name: 'Nepal News',              lang: 'en' },
  { url: 'https://nepalpress.com/feed/',             name: 'Nepal Press',             lang: 'ne' },
  { url: 'https://annapurnapost.com/rss/',           name: 'Annapurna Post',          lang: 'ne' },
  { url: 'https://nagariknews.nagariknetwork.com/feed/', name: 'Nagarik News',        lang: 'ne' },
];

/* ── Category-specific RSS feeds ────────────────────────────────────────── */

/* Science, Innovation & Research */
const RSS_SCIENCE = [
  { url: 'https://news.google.com/rss/search?q=science+technology+research&hl=en&gl=US&ceid=US:en',
                                                    name: 'Google Science (EN)',      lang: 'en', cat: 'science' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RFU0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
                                                    name: 'Google Technology',        lang: 'en', cat: 'science' },
  { url: 'https://feeds.feedburner.com/TechCrunch',  name: 'TechCrunch',             lang: 'en', cat: 'science' },
  { url: 'https://www.wired.com/feed/rss',           name: 'Wired',                  lang: 'en', cat: 'science' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index',
                                                    name: 'Ars Technica',             lang: 'en', cat: 'science' },
  { url: 'https://www.sciencedaily.com/rss/all.xml', name: 'Science Daily',          lang: 'en', cat: 'science' },
  { url: 'https://news.google.com/rss/search?q=nepal+technology+innovation&hl=en&gl=NP&ceid=NP:en',
                                                    name: 'Nepal Tech News',          lang: 'en', cat: 'science' },
];

/* Nepali Movies & Entertainment (Nepal-sourced only) */
const RSS_NEPALI_ENT = [
  /* Nepali Devanagari searches — highest priority */
  { url: 'https://news.google.com/rss/search?q=%E0%A4%A8%E0%A5%87%E0%A4%AA%E0%A4%BE%E0%A4%B2%E0%A5%80+%E0%A4%9A%E0%A4%B2%E0%A4%9A%E0%A4%BF%E0%A4%A4%E0%A5%8D%E0%A4%B0&hl=ne&gl=NP&ceid=NP:ne',
                                                    name: 'Google नेपाली चलचित्र',     lang: 'ne', cat: 'nepali-ent' },
  { url: 'https://news.google.com/rss/search?q=%E0%A4%A8%E0%A5%87%E0%A4%AA%E0%A4%BE%E0%A4%B2%E0%A5%80+%E0%A4%AE%E0%A4%A8%E0%A5%8B%E0%A4%B0%E0%A4%9E%E0%A5%8D%E0%A4%9C%E0%A4%A8+%E0%A4%95%E0%A4%B2%E0%A4%BE%E0%A4%95%E0%A4%BE%E0%A4%B0&hl=ne&gl=NP&ceid=NP:ne',
                                                    name: 'Google नेपाली कलाकार',      lang: 'ne', cat: 'nepali-ent' },
  { url: 'https://news.google.com/rss/search?q=%E0%A4%A8%E0%A5%87%E0%A4%AA%E0%A4%BE%E0%A4%B2%E0%A5%80+%E0%A4%97%E0%A4%BE%E0%A4%AF%E0%A4%95+%E0%A4%97%E0%A4%BE%E0%A4%AF%E0%A4%BF%E0%A4%95%E0%A4%BE&hl=ne&gl=NP&ceid=NP:ne',
                                                    name: 'Google नेपाली गायक',        lang: 'ne', cat: 'nepali-ent' },
  /* Nepal entertainment English-language searches */
  { url: 'https://news.google.com/rss/search?q=nepali+movie+film+actor+actress+nepal&hl=en&gl=NP&ceid=NP:en',
                                                    name: 'Google Nepali Film EN',    lang: 'en', cat: 'nepali-ent' },
  { url: 'https://news.google.com/rss/search?q=nepal+entertainment+celebrity+music+cinema&hl=en&gl=NP&ceid=NP:en',
                                                    name: 'Google Nepal Celebrity',   lang: 'en', cat: 'nepali-ent' },
  /* Nepali news outlets — entertainment sections */
  { url: 'https://www.ratopati.com/category/entertainment/feed',
                                                    name: 'Ratopati Ent',             lang: 'ne', cat: 'nepali-ent' },
  { url: 'https://ekantipur.com/rss/entertainment',
                                                    name: 'Ekantipur Ent',            lang: 'ne', cat: 'nepali-ent' },
  { url: 'https://www.onlinekhabar.com/content/entertainment/feed',
                                                    name: 'OnlineKhabar Ent',         lang: 'ne', cat: 'nepali-ent' },
];

/* Bhojpuri Movies & Entertainment */
const RSS_BHOJPURI = [
  /* Devanagari Hindi searches for Bhojpuri content */
  { url: 'https://news.google.com/rss/search?q=%E0%A4%AD%E0%A5%8B%E0%A4%9C%E0%A4%AA%E0%A5%81%E0%A4%B0%E0%A5%80+%E0%A4%AB%E0%A4%BF%E0%A4%B2%E0%A5%8D%E0%A4%AE&hl=hi&gl=IN&ceid=IN:hi',
                                                    name: 'Google भोजपुरी फिल्म',     lang: 'hi', cat: 'bhojpuri' },
  { url: 'https://news.google.com/rss/search?q=%E0%A4%AD%E0%A5%8B%E0%A4%9C%E0%A4%AA%E0%A5%81%E0%A4%B0%E0%A5%80+%E0%A4%97%E0%A4%BE%E0%A4%A8%E0%A4%BE+%E0%A4%B8%E0%A5%8D%E0%A4%9F%E0%A4%BE%E0%A4%B0&hl=hi&gl=IN&ceid=IN:hi',
                                                    name: 'Google भोजपुरी गाना स्टार', lang: 'hi', cat: 'bhojpuri' },
  { url: 'https://news.google.com/rss/search?q=pawan+singh+khesari+bhojpuri&hl=hi&gl=IN&ceid=IN:hi',
                                                    name: 'Google Pawan-Khesari (HI)',lang: 'hi', cat: 'bhojpuri' },
  /* English searches */
  { url: 'https://news.google.com/rss/search?q=bhojpuri+movie+song+actor+actress+2025&hl=en&gl=IN&ceid=IN:en',
                                                    name: 'Google Bhojpuri (EN)',     lang: 'en', cat: 'bhojpuri' },
  { url: 'https://news.google.com/rss/search?q=bhojpuri+film+industry+trending+viral&hl=en&gl=IN&ceid=IN:en',
                                                    name: 'Google Bhojpuri Viral',    lang: 'en', cat: 'bhojpuri' },
];

/* Hindi / Bollywood Movies & Entertainment */
const RSS_HINDI_ENT = [
  /* Devanagari Hindi searches */
  { url: 'https://news.google.com/rss/search?q=%E0%A4%AC%E0%A5%89%E0%A4%B2%E0%A5%80%E0%A4%B5%E0%A5%81%E0%A4%A1+%E0%A4%AB%E0%A4%BF%E0%A4%B2%E0%A5%8D%E0%A4%AE&hl=hi&gl=IN&ceid=IN:hi',
                                                    name: 'Google बॉलीवुड फिल्म',      lang: 'hi', cat: 'hindi-ent' },
  { url: 'https://news.google.com/rss/search?q=%E0%A4%B9%E0%A4%BF%E0%A4%82%E0%A4%A6%E0%A5%80+%E0%A4%B8%E0%A4%BF%E0%A4%A8%E0%A5%87%E0%A4%AE%E0%A4%BE+%E0%A4%85%E0%A4%AD%E0%A4%BF%E0%A4%A8%E0%A5%87%E0%A4%A4%E0%A4%BE&hl=hi&gl=IN&ceid=IN:hi',
                                                    name: 'Google हिंदी सिनेमा',       lang: 'hi', cat: 'hindi-ent' },
  { url: 'https://news.google.com/rss/search?q=%E0%A4%AC%E0%A5%89%E0%A4%B2%E0%A5%80%E0%A4%B5%E0%A5%81%E0%A4%A1+%E0%A4%B8%E0%A4%AE%E0%A4%BE%E0%A4%9A%E0%A4%BE%E0%A4%B0&hl=hi&gl=IN&ceid=IN:hi',
                                                    name: 'Google बॉलीवुड समाचार',     lang: 'hi', cat: 'hindi-ent' },
  /* English searches */
  { url: 'https://news.google.com/rss/search?q=bollywood+movie+actor+actress+2025&hl=en&gl=IN&ceid=IN:en',
                                                    name: 'Google Bollywood (EN)',    lang: 'en', cat: 'hindi-ent' },
  { url: 'https://news.google.com/rss/search?q=bollywood+film+box+office+trending+viral&hl=en&gl=IN&ceid=IN:en',
                                                    name: 'Google Bollywood Viral',   lang: 'en', cat: 'hindi-ent' },
  /* Entertainment Google topic */
  { url: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRFp1YnpJU0FtaHBLQUFQAQ?hl=en&gl=IN&ceid=IN:en',
                                                    name: 'Google Entertainment IN',  lang: 'en', cat: 'hindi-ent' },
];

/* World Top Trending */
const RSS_WORLD = [
  { url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en&gl=US&ceid=US:en',
                                                    name: 'Google World News',        lang: 'en', cat: 'world' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
                                                    name: 'BBC World',                lang: 'en', cat: 'world' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',
                                                    name: 'Al Jazeera',               lang: 'en', cat: 'world' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
                                                    name: 'NY Times World',           lang: 'en', cat: 'world' },
  { url: 'https://trends.google.com/trending/rss?geo=US',
                                                    name: 'Google Trends US',         lang: 'en', cat: 'world', isTrendsSource: true },
];

/* ── Active news tab ─────────────────────────────────────────────────────── */
let _activeNewsTab = 'nepal';   /* 'nepal' | 'science' | 'nepali-ent' | 'bhojpuri' | 'hindi-ent' | 'locations' | 'world' */

/* Per-category article caches (populated on first tab open) */
const _catArticles = { 'nepal': [], 'science': [], 'nepali-ent': [], 'bhojpuri': [], 'hindi-ent': [], 'world': [] };
const _catLoaded   = { 'nepal': false, 'science': false, 'nepali-ent': false, 'bhojpuri': false, 'hindi-ent': false, 'world': false };

/* ── Location-based news ─────────────────────────────────────────────────── */
let _locationFeeds = [];    /* [{ label, countryCode, articles, loaded }] */
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

/* Public CORS proxies tried in order when not on localhost.
   Each returns the raw XML which we parse ourselves. */
const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

/* Viral signal keywords — articles containing these score higher */
const VIRAL_KEYWORDS = [
  'मृत्यु','मारिए','घाइते','पक्राउ','बर्खास्त','बाढी','भूकम्प','आगलागी',
  'पहिरो','दुर्घटना','कारबाही','गिरफ्तार','तत्काल','ब्रेकिङ','अलर्ट',
  'killed','dead','arrested','fired','flood','earthquake','breaking','urgent',
  'crisis','explosion','resign','protest','strike','shutdown','emergency',
  'मानवअधिकार','आयोग','सिफारिस','अनुसन्धान','आत्मदाह','विस्फोट','हत्या',
];

let articles         = [];
let selectedArticle  = null;
let generatedPost    = null;
let customImageDataUrl = null;

/* Image pan / zoom state (applied only to custom uploaded images) */
let imgOffsetX = 0;
let imgOffsetY = 0;
let imgScale   = 1.0;
let imgRotation = 0;   // degrees: 0, 90, 180, 270
let imgFlipH   = false;
let imgFlipV   = false;

/* Cached image object — used for instant drag/zoom redraws without re-fetching */
let _cachedNewsImg = null;

/* ── Multi-Image Composite State (dynamic — unlimited side sprites) ─
   _sideSprites[] = array of sprite objects, each:
     { id, rawDataUrl, subjectDataUrl, img,
       x, y, w, h, rot,          ← canvas-px transform
       selected }                ← whether handles are shown
   _compositeMode = true when at least one sprite is active.
   ──────────────────────────────────────────────────────────────── */
let _sideSprites   = [];        // dynamic array of sprite objects
let _compositeMode  = false;     // true w
let _circleClipMode = false;     // clip composite sprites to circle shapehen _sideSprites.length > 0
let _nextSpriteId  = 1;         // auto-increment id
let _selectedSpriteId = null;   // which sprite has handles shown

/* Backward-compat aliases used by legacy code paths */
Object.defineProperty(window, '_leftSubjectImg',  { get: () => _sideSprites[0]?.img || null });
Object.defineProperty(window, '_rightSubjectImg', { get: () => _sideSprites[1]?.img || null });

/* ── Default thumbnail for news list items ───────────────────────
   Nepal-themed SVG: Himalayan peaks + rising sun + newspaper lines.
   Used when an article has no imageUrl or when the image fails to load.
   ──────────────────────────────────────────────────────────────── */
const _DEFAULT_NEWS_THUMB = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="%23003087"/>
      <stop offset="100%" stop-color="%23e8c84a"/>
    </linearGradient>
    <linearGradient id="snow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="%23ffffff"/>
      <stop offset="100%" stop-color="%23cfe8ff"/>
    </linearGradient>
  </defs>
  <!-- Sky background -->
  <rect width="120" height="90" fill="url(%23sky)"/>
  <!-- Sun -->
  <circle cx="60" cy="38" r="10" fill="%23e8c84a" opacity="0.95"/>
  <!-- Mountains (Himalayas silhouette) -->
  <polygon points="0,65 20,30 38,52 55,20 70,45 88,28 105,48 120,35 120,90 0,90" fill="%23b0bec5"/>
  <!-- Snow caps -->
  <polygon points="20,30 28,45 12,45" fill="url(%23snow)"/>
  <polygon points="55,20 63,36 47,36" fill="url(%23snow)"/>
  <polygon points="88,28 96,43 80,43" fill="url(%23snow)"/>
  <!-- Ground / footer bar -->
  <rect x="0" y="72" width="120" height="18" fill="%23b71c1c" opacity="0.88"/>
  <!-- Newspaper lines on footer -->
  <rect x="8" y="76" width="50" height="3" rx="1.5" fill="%23ffffff" opacity="0.85"/>
  <rect x="8" y="82" width="36" height="2" rx="1" fill="%23ffffff" opacity="0.6"/>
  <!-- Nepal flag moon/star hint (top-right corner accent) -->
  <text x="104" y="18" font-size="13" text-anchor="middle" fill="%23e8c84a" opacity="0.9">☀</text>
</svg>`)}`;

/* ── Author avatar — pre-loaded once, used as canvas watermark ── */
let _authorImg = null;
let _authorImgPromise = null;
(function _preloadAuthorPhoto() {
  _authorImgPromise = new Promise(resolve => {
    const img = new Image();
    img.onload  = () => { _authorImg = img; resolve(img); };
    img.onerror = () => { _authorImg = null; resolve(null); };
    img.src = 'shashi_PP.jpg?v=' + Date.now();  // cache-bust so browser actually loads it
  });
})();

/* Text overlay customisation (editable via the Text Editor modal) */
let _textOpts = {
  bannerText:  '🗞️  NEWS UPDATE',
  bannerColor: '#c0392b',
  titleColor:  '#ffffff',
  titleSize:   62,
};

/* ── Image colour tint / grade settings ─────────────────────────
   preset  = 'cinematic' | 'warm' | 'cool' | 'dramatic' | 'vintage' |
             'noir' | 'golden' | 'none'
   custom  = hex colour string used when preset='custom'
   opacity = 0.0 – 1.0  (how strongly the tint is applied)
   ──────────────────────────────────────────────────────────────── */
let _imageTint = {
  preset:  'cinematic',  // default — the original grade
  custom:  '#ff6600',
  opacity: 0.5,          // 0 = no tint wash, 1 = full tint wash
};

/* ── Extra custom text labels (dynamic — unlimited) ─────────────
   Each: { id, text, size, color, bold,
           posX ('left'|'center'|'right'),
           posY ('top'|'middle'|'bottom'),
           px (canvas pixel x, overrides posX when set),
           py (canvas pixel y, overrides posY when set) }
   ──────────────────────────────────────────────────────────────── */
let _extraTexts    = [];    // dynamic — populated via addExtraText()
let _nextTextId    = 1;     // auto-increment
let _selectedTextId = null; // which extra-text label is selected for drag

/* ================================================================
   UTILITY
================================================================ */
function toast(msg, type = 'info', ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = ''), ms);
}

function escHtml(s) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setFetchState(loading) {
  const btn = document.getElementById('fetchBtn');
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner"></span> Fetching…'
    : '<span>🔄</span> Fetch Nepal News';
}

/* ================================================================
   FEATURE 1 – FETCH NEWS (multi-feed, parallel, viral-scored)
================================================================ */
async function fetchNews() {
  setFetchState(true);
  document.getElementById('statusBadge').textContent = 'Loading…';

  const list = document.getElementById('newsList');
  list.innerHTML = Array(8).fill(0).map(() => `
    <div class="news-item">
      <div class="news-item-thumb-placeholder skeleton" style="width:58px;height:45px"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <div class="skeleton" style="height:13px;border-radius:4px"></div>
        <div class="skeleton" style="height:13px;width:70%;border-radius:4px"></div>
        <div class="skeleton" style="height:10px;width:40%;border-radius:4px"></div>
      </div>
    </div>`).join('');

  document.getElementById('statusBadge').textContent = `Fetching ${RSS_FEEDS.length} sources…`;

  try {

  /* Fetch all feeds in parallel — collect whatever succeeds */
  const results = await Promise.allSettled(
    RSS_FEEDS.map(feed => fetchSingleFeed(feed))
  );

  let allItems = [];
  let successCount = 0;
  /* Collect Google Trends keywords separately for boost signal */
  let trendingKeywords = [];

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) {
      const feed = RSS_FEEDS[results.indexOf(r)];
      if (feed && feed.isTrendsSource) {
        /* Extract trending terms from Google Trends feed */
        trendingKeywords = r.value.map(a => a.title.toLowerCase().split(/[\s,]+/)).flat().filter(w => w.length > 3);
      } else {
        allItems = allItems.concat(r.value);
        successCount++;
      }
    }
  }

  if (!allItems.length) {
    setFetchState(false);
    document.getElementById('statusBadge').textContent = 'Failed to load';
    const serverHint = _isLocalhost
      ? `<p style="margin-top:6px;font-size:.8rem;color:#f87171;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:8px 12px">
           ⚠️ <strong>Is the server running?</strong><br>
           Open a terminal in the project folder and run:<br>
           <code style="font-size:.78rem">python server.py</code>&nbsp;&nbsp;then refresh this page.
         </p>`
      : `<p style="margin-top:8px;font-size:.8rem;color:var(--muted)">Try on a personal hotspot, or use the manual option below.</p>`;
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p style="color:var(--text)">Could not load news from any source.</p>
        ${serverHint}
        <button class="btn btn-ghost" style="margin-top:14px" onclick="showManualInput()">✏️ Enter News Manually</button>
        <button class="btn btn-primary" style="margin-top:8px" onclick="fetchNews()">🔄 Try Again</button>
      </div>`;
    toast('❌ All feeds failed — is the server running?', 'error', 6000);
    return;
  }

  /* De-duplicate by title similarity */
  const seen = new Set();
  allItems = allItems.filter(a => {
    const key = a.title.replace(/\s+/g, '').toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  /* ── Multi-signal viral scoring ──────────────────────────────────
     Signal 1: RECENCY        — stories < 6h ago score highest (40%)
     Signal 2: VIRAL KEYWORDS — death/crisis/protest/breaking words (25%)
     Signal 3: CROSS-SOURCE   — same story in 3+ outlets = trending (20%)
     Signal 4: GOOGLE TRENDS  — matches active Nepal trending searches (10%)
     Signal 5: PEAK HOURS     — 6am–9pm Nepal time bonus (5%)
     ─────────────────────────────────────────────────────────────── */

  /* Pre-build cross-source frequency map (title keyword overlap) */
  const titleFingerprints = allItems.map(a =>
    new Set(a.title.toLowerCase().replace(/[^\w\s\u0900-\u097F]/g, '').split(/\s+/).filter(w => w.length > 3))
  );
  const crossSourceCount = allItems.map((_, i) => {
    let count = 0;
    for (let j = 0; j < allItems.length; j++) {
      if (i === j) continue;
      const overlap = [...titleFingerprints[i]].filter(w => titleFingerprints[j].has(w)).length;
      if (overlap >= 2) count++;
    }
    return count;
  });

  const now = Date.now();
  /* Nepal Standard Time offset: UTC+5:45 */
  const nepalOffsetMs = (5 * 60 + 45) * 60 * 1000;

  allItems.forEach((a, i) => {
    const ageHours = Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000);

    /* Signal 1: Recency (0→1, decays over 48h; articles <2h get 1.0) */
    const recencyScore = ageHours < 2
      ? 1.0
      : ageHours < 6
        ? 0.85
        : Math.max(0, (48 - ageHours) / 48);

    /* Signal 2: Viral keywords */
    const text = (a.title + ' ' + a.description).toLowerCase();
    const kwHits = VIRAL_KEYWORDS.filter(k => text.includes(k.toLowerCase())).length;
    const kwScore = Math.min(kwHits / 3, 1.0);

    /* Signal 3: Cross-source frequency (same story in multiple outlets) */
    const crossScore = Math.min(crossSourceCount[i] / 4, 1.0); // cap at 4 outlets

    /* Signal 4: Google Trends keyword match */
    const trendsScore = trendingKeywords.length > 0
      ? (trendingKeywords.some(tw => text.includes(tw)) ? 1.0 : 0.0)
      : 0.0;

    /* Signal 5: Peak hours bonus (6am–9pm Nepal local time) */
    const pubLocalHour = ((new Date(a.pubDate).getTime() + nepalOffsetMs) % 86400000) / 3600000;
    const peakScore = (pubLocalHour >= 6 && pubLocalHour <= 21) ? 1.0 : 0.3;

    /* Weighted composite score */
    a.viralScore = (recencyScore * 0.40) +
                   (kwScore       * 0.25) +
                   (crossScore    * 0.20) +
                   (trendsScore   * 0.10) +
                   (peakScore     * 0.05);

    a.isViral    = a.viralScore > 0.60;
    a.isTrending = (kwHits >= 2 && ageHours < 6) || crossSourceCount[i] >= 3 || trendsScore === 1.0;
    a._crossCount = crossSourceCount[i];
    a._trendsMatch = trendsScore === 1.0;
  });

  /* ── SORT STRATEGY ───────────────────────────────────────────────
     TOP 2  : The 2 freshest articles that have at least some viral
              potential (published < 6h AND has ≥1 viral keyword or
              cross-source match, or published < 1h regardless).
              If fewer than 2 qualify, fill up with the next-newest.
              Both top-2 slots are ordered newest-first.
     REST   : Remaining articles sorted by viralScore (trending /
              popularity / cross-source) descending.
     ─────────────────────────────────────────────────────────────── */

  /* Candidates: articles < 6h old with some viral potential */
  const freshViralCandidates = allItems
    .filter(a => {
      const ageH = Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000);
      const hasPotential = a.viralScore > 0.25 || a._crossCount >= 1 || ageH < 1;
      return ageH < 6 && hasPotential;
    })
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  /* If we have fewer than 2 fresh-viral candidates, fill with next-newest articles */
  const allByDate = [...allItems].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const top2Set = new Set();
  for (const a of freshViralCandidates) { if (top2Set.size < 2) top2Set.add(a); }
  if (top2Set.size < 2) {
    for (const a of allByDate) { if (!top2Set.has(a) && top2Set.size < 2) top2Set.add(a); }
  }

  /* Mark top-2 articles so UI can badge them */
  top2Set.forEach(a => { a._isLatestTop = true; });

  const top2    = [...top2Set].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const theRest = allItems
    .filter(a => !top2Set.has(a))
    .sort((a, b) => b.viralScore - a.viralScore || new Date(b.pubDate) - new Date(a.pubDate));

  allItems = [...top2, ...theRest];

  articles = allItems;
  _catArticles['nepal'] = allItems;
  _catLoaded['nepal']   = true;
  /* Switch to Nepal tab if not already there */
  if (_activeNewsTab !== 'nepal') switchNewsTab('nepal');
  renderNewsList();
  document.getElementById('statusBadge').textContent = `${articles.length} articles · ${successCount} sources`;
  toast(`✅ ${articles.length} articles from ${successCount} sources`, 'success');
  setFetchState(false);
  } catch (err) {
    console.error('[fetchNews] CRASH:', err);
    setFetchState(false);
    document.getElementById('statusBadge').textContent = 'Error — check console';
    toast('❌ fetchNews crashed: ' + err.message, 'error', 8000);
  }
}

async function fetchSingleFeed(feed) {
  /* ── Fast path: fetch RSS XML directly via local proxy ── */
  if (_fetchProxyBase) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 12000);
      const res  = await fetch(`${_fetchProxyBase}?url=${encodeURIComponent(feed.url)}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const xml = await res.text();
        if (xml && xml.length > 100) {
          const parsed = parseRssXml(xml, feed);
          if (parsed.length) return parsed;
        }
      }
    } catch { /* fall through */ }
  }

  /* ── Public CORS proxies — tried in order (used on GitHub Pages) ── */
  if (!_fetchProxyBase) {
    for (const proxyFn of CORS_PROXIES) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10000);
        const res  = await fetch(proxyFn(feed.url), { signal: ctrl.signal });
        clearTimeout(tid);
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 100 && (text.includes('<rss') || text.includes('<feed') || text.includes('<item'))) {
            const parsed = parseRssXml(text, feed);
            if (parsed.length) return parsed;
          }
        }
      } catch { /* try next proxy */ }
    }
  }

  /* ── Last resort: rss2json API ── */
  const apiUrl = RSS2JSON + encodeURIComponent(feed.url) + '&count=20';
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12000);
  try {
    const res  = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== 'ok' || !data.items?.length) return [];

    return data.items.map(item => {
      const title   = item.title?.trim() || 'No title';
      const pubDate = item.pubDate || new Date().toISOString();
      const link    = item.link   || '';
      let imageUrl  = item.thumbnail || item.enclosure?.link || '';

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = item.description || '';
      if (!imageUrl) {
        const imgTag = tempDiv.querySelector('img');
        if (imgTag) imageUrl = imgTag.src || imgTag.getAttribute('src') || '';
      }
      const fullText  = (tempDiv.textContent || tempDiv.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        title, description: fullText.slice(0, 1500), rawHtml: item.description || '', imageUrl,
        pubDate, link, source: feed.name, sourceLang: feed.lang, fullArticleText: null,
      };
    });
  } catch {
    clearTimeout(tid);
    return [];
  }
}

/**
 * Parse RSS/Atom XML string into article objects.
 * Called when the local proxy fetches the feed directly.
 */
function parseRssXml(xml, feed) {
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xml, 'text/xml');
    const items  = [...doc.querySelectorAll('item, entry')];
    if (!items.length) return [];

    const isGoogleNews = feed.url.includes('news.google.com');

    return items.slice(0, 25).map(item => {
      const get = (tag) => item.querySelector(tag)?.textContent?.trim() || '';

      /* Google News titles come as "Story headline - Publisher Name"
         Strip the " - Publisher" suffix for cleaner display */
      let title = get('title') || 'No title';
      if (isGoogleNews) {
        title = title.replace(/\s[-–]\s[^-–]+$/, '').trim() || title;
      }

      const link    = item.querySelector('link')?.getAttribute('href') || get('link') || '';
      const pubDate = get('pubDate') || get('published') || get('updated') || new Date().toISOString();

      /* Description from <description>, <content:encoded>, or <summary> */
      const rawHtml = item.querySelector('encoded')?.textContent
                    || item.querySelector('description')?.textContent
                    || item.querySelector('summary')?.textContent || '';

      /* Strip HTML tags to get plain text */
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = rawHtml;
      const plainText = (tempDiv.textContent || '').replace(/\s+/g, ' ').trim();

      /* Image — try every standard RSS image field in priority order:
         1. <enclosure type="image/...">
         2. <media:content url="..."> / <media:thumbnail url="...">
         3. <itunes:image href="...">
         4. First <img src> in <description> HTML
         5. <url> inside <image> block                                   */
      let imageUrl = item.querySelector('enclosure[type^="image"]')?.getAttribute('url') || '';

      if (!imageUrl) {
        /* media: namespace — browsers expose these with local name only */
        const mediaTags = ['media\\:content','media\\:thumbnail','content','thumbnail'];
        for (const tag of mediaTags) {
          const el = item.querySelector(tag);
          if (el) {
            imageUrl = el.getAttribute('url') || el.getAttribute('src') || '';
            if (imageUrl) break;
          }
        }
      }
      if (!imageUrl) {
        /* Also try querySelectorAll with namespace-aware local names */
        for (const el of item.querySelectorAll('*')) {
          const ln = el.localName.toLowerCase();
          if (ln === 'content' || ln === 'thumbnail') {
            imageUrl = el.getAttribute('url') || el.getAttribute('src') || '';
            if (imageUrl) break;
          }
        }
      }
      if (!imageUrl) {
        const itunesImg = item.querySelector('image');
        if (itunesImg) imageUrl = itunesImg.getAttribute('href') || itunesImg.textContent?.trim() || '';
      }
      if (!imageUrl) {
        const imgMatch = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch) imageUrl = imgMatch[1];
      }

      /* For Google News, extract the real publisher name from <source> */
      const publisher = isGoogleNews
        ? (item.querySelector('source')?.textContent?.trim() || feed.name)
        : feed.name;

      return {
        title, description: plainText.slice(0, 1500), rawHtml, imageUrl,
        pubDate, link, source: publisher, sourceLang: feed.lang, fullArticleText: null,
      };
    });
  } catch (e) {
    console.warn('[parseRssXml] failed:', e.message);
    return [];
  }
}

/* ================================================================
   CATEGORY NEWS FETCHING
   Generic fetcher for any array of RSS_* feed configs.
   Scores articles by recency + viral keywords (simple version).
================================================================ */

/**
 * Fetch & score a list of feed configs; returns sorted article array.
 * Writes results into _catArticles[catKey] and sets _catLoaded[catKey].
 */
async function fetchCategoryFeeds(feedList, catKey) {
  const results = await Promise.allSettled(feedList.map(f => fetchSingleFeed(f)));
  let allItems = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) allItems.push(...r.value);
  }
  /* De-dupe */
  const seen = new Set();
  allItems = allItems.filter(a => {
    const key = a.title.replace(/\s+/g, '').toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  /* Simple viral score */
  const now = Date.now();
  allItems.forEach(a => {
    const ageH = Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000);
    const recency = ageH < 2 ? 1.0 : ageH < 6 ? 0.85 : Math.max(0, (48 - ageH) / 48);
    const text = (a.title + ' ' + a.description).toLowerCase();
    const kw = VIRAL_KEYWORDS.filter(k => text.includes(k.toLowerCase())).length;
    a.viralScore = recency * 0.60 + Math.min(kw / 3, 1.0) * 0.40;
    a.isTrending = kw >= 2 && ageH < 6;
    a.isViral    = a.viralScore > 0.55;
    a._crossCount = 0; a._trendsMatch = false; a._isLatestTop = false;
  });

  /* ── Same top-2 strategy as fetchNews():
     TOP 2  : Freshest articles (<6h) with some viral potential, ordered newest-first.
     REST   : Remaining articles sorted by viralScore descending.
  ── */
  const freshCandidates = allItems
    .filter(a => {
      const ageH = Math.max(0, (now - new Date(a.pubDate).getTime()) / 3600000);
      return ageH < 6 && (a.viralScore > 0.25 || a._crossCount >= 1 || ageH < 1);
    })
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const allByDate = [...allItems].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const top2Set = new Set();
  for (const a of freshCandidates) { if (top2Set.size < 2) top2Set.add(a); }
  if (top2Set.size < 2) {
    for (const a of allByDate) { if (!top2Set.has(a) && top2Set.size < 2) top2Set.add(a); }
  }
  top2Set.forEach(a => { a._isLatestTop = true; });

  const top2    = [...top2Set].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const theRest = allItems
    .filter(a => !top2Set.has(a))
    .sort((a, b) => b.viralScore - a.viralScore || new Date(b.pubDate) - new Date(a.pubDate));

  allItems = [...top2, ...theRest];
  if (catKey) {
    /* Tag each article with its category so AI prompts can adapt */
    allItems.forEach(a => { a._category = catKey; });
    _catArticles[catKey] = allItems;
    _catLoaded[catKey]   = true;
  }
  return allItems;
}

/* ── Location-based feeds ────────────────────────────────────────────── */

/**
 * Known Nepal local/district RSS feeds.
 * Key = lowercase normalised location name (and common aliases).
 * Value = array of feed descriptors { url, name, lang }
 *
 * Priority order inside each entry:
 *   1. Local/district-specific RSS outlets
 *   2. Province/regional outlets
 *   3. Mainstream Nepali outlets filtered by location keyword
 */
const _NEPAL_LOCAL_FEEDS = {
  /* ── Bara / Kalaiya ───────────────────────────────────────────── */
  'kalaiya': [
    { url: 'https://sajhedharipatrika.com/feed/', name: 'Sajhedhari Patrika', lang: 'ne' },
    { url: 'https://baraupdate.com/feed/', name: 'Bara Update', lang: 'ne' },
    { url: 'https://kalaiyanews.com/feed/', name: 'Kalaiya News', lang: 'ne' },
    { url: 'https://madheshpost.com/feed/', name: 'Madhesh Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('कलैया')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: कलैया', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Kalaiya Bara')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Kalaiya', lang: 'en' },
  ],
  'bara': [
    { url: 'https://sajhedharipatrika.com/feed/', name: 'Sajhedhari Patrika', lang: 'ne' },
    { url: 'https://baraupdate.com/feed/', name: 'Bara Update', lang: 'ne' },
    { url: 'https://kalaiyanews.com/feed/', name: 'Kalaiya News', lang: 'ne' },
    { url: 'https://madheshpost.com/feed/', name: 'Madhesh Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('बारा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: बारा', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Bara Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Bara', lang: 'en' },
  ],
  /* ── Kathmandu ─────────────────────────────────────────────────── */
  'kathmandu': [
    { url: 'https://kathmandupost.com/rss', name: 'Kathmandu Post', lang: 'en' },
    { url: 'https://onlinekhabar.com/feed', name: 'OnlineKhabar', lang: 'ne' },
    { url: 'https://setopati.com/feed', name: 'Setopati', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('काठमाडौं')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: काठमाडौं', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Kathmandu')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Kathmandu', lang: 'en' },
  ],
  'ktm': 'kathmandu', /* alias */
  /* ── Pokhara ───────────────────────────────────────────────────── */
  'pokhara': [
    { url: 'https://gandakipost.com/feed/', name: 'Gandaki Post', lang: 'ne' },
    { url: 'https://pokharanews.com/feed/', name: 'Pokhara News', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('पोखरा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: पोखरा', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Pokhara')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Pokhara', lang: 'en' },
  ],
  /* ── Biratnagar / Morang ───────────────────────────────────────── */
  'biratnagar': [
    { url: 'https://biratnagarmirror.com/feed/', name: 'Biratnagar Mirror', lang: 'ne' },
    { url: 'https://koshipost.com/feed/', name: 'Koshi Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('विराटनगर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: विराटनगर', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Biratnagar Morang')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Biratnagar', lang: 'en' },
  ],
  'morang': 'biratnagar',
  /* ── Jhapa / Birtamode ─────────────────────────────────────────── */
  'jhapa': [
    { url: 'https://mechi.news/feed/', name: 'Mechi News', lang: 'ne' },
    { url: 'https://jhapanews.com/feed/', name: 'Jhapa News', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('झापा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: झापा', lang: 'ne' },
  ],
  'birtamode': 'jhapa',
  /* ── Chitwan / Bharatpur ───────────────────────────────────────── */
  'chitwan': [
    { url: 'https://chitwanpost.com/feed/', name: 'Chitwan Post', lang: 'ne' },
    { url: 'https://chitwanchronicle.com/feed/', name: 'Chitwan Chronicle', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('चितवन')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: चितवन', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Chitwan Bharatpur')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Chitwan', lang: 'en' },
  ],
  'bharatpur': 'chitwan',
  /* ── Butwal / Rupandehi ────────────────────────────────────────── */
  'butwal': [
    { url: 'https://butwaltoday.com/feed/', name: 'Butwal Today', lang: 'ne' },
    { url: 'https://rupandehipost.com/feed/', name: 'Rupandehi Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('बुटवल')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: बुटवल', lang: 'ne' },
  ],
  'rupandehi': 'butwal',
  /* ── Birgunj / Parsa ───────────────────────────────────────────── */
  'birgunj': [
    { url: 'https://birgunjtoday.com/feed/', name: 'Birgunj Today', lang: 'ne' },
    { url: 'https://parsapost.com/feed/', name: 'Parsa Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('वीरगन्ज')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: वीरगन्ज', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Birgunj Parsa')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Birgunj', lang: 'en' },
  ],
  'parsa': 'birgunj',
  /* ── Dhangadhi / Kailali ───────────────────────────────────────── */
  'dhangadhi': [
    { url: 'https://sudurpaschimpost.com/feed/', name: 'Sudurpaschim Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('धनगढी')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: धनगढी', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Dhangadhi Kailali')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Dhangadhi', lang: 'en' },
  ],
  'kailali': 'dhangadhi',
  /* ── Nepalgunj / Banke ─────────────────────────────────────────── */
  'nepalgunj': [
    { url: 'https://midwesternherald.com/feed/', name: 'Midwestern Herald', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('नेपालगन्ज')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: नेपालगन्ज', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Nepalgunj Banke')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Nepalgunj', lang: 'en' },
  ],
  'banke': 'nepalgunj',
  /* ── Hetauda / Makwanpur ───────────────────────────────────────── */
  'hetauda': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('हेटौंडा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: हेटौंडा', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Hetauda Makwanpur')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Hetauda', lang: 'en' },
  ],
  'makwanpur': 'hetauda',
  /* ── Janakpur / Dhanusha ───────────────────────────────────────── */
  'janakpur': [
    { url: 'https://janakpurpost.com/feed/', name: 'Janakpur Post', lang: 'ne' },
    { url: 'https://madheshpost.com/feed/', name: 'Madhesh Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('जनकपुर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: जनकपुर', lang: 'ne' },
  ],
  'dhanusha': 'janakpur',
  /* ── Itahari / Sunsari ─────────────────────────────────────────── */
  'itahari': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('इटहरी')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: इटहरी', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Itahari Sunsari')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Itahari', lang: 'en' },
  ],
  'sunsari': 'itahari',
  /* ── Damak / Jhapa ─────────────────────────────────────────────── */
  'damak': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('दमक')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: दमक', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Damak Jhapa')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Damak', lang: 'en' },
  ],
  /* ── Lalitpur / Patan ──────────────────────────────────────────── */
  'lalitpur': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('ललितपुर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: ललितपुर', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Lalitpur Patan Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Lalitpur', lang: 'en' },
  ],
  'patan': 'lalitpur',
  /* ── Bhaktapur ─────────────────────────────────────────────────── */
  'bhaktapur': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('भक्तपुर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: भक्तपुर', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Bhaktapur')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Bhaktapur', lang: 'en' },
  ],
  /* ── Rautahat / Gaur ───────────────────────────────────────────── */
  'rautahat': [
    { url: 'https://madheshpost.com/feed/', name: 'Madhesh Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('रौतहट')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: रौतहट', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Rautahat Gaur Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Rautahat', lang: 'en' },
  ],
  'gaur': 'rautahat',
  /* ── Sarlahi ───────────────────────────────────────────────────── */
  'sarlahi': [
    { url: 'https://madheshpost.com/feed/', name: 'Madhesh Post', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सर्लाही')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सर्लाही', lang: 'ne' },
  ],
  /* ── Mahottari / Jaleshwar ─────────────────────────────────────── */
  'mahottari': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('महोत्तरी')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: महोत्तरी', lang: 'ne' },
  ],
  'jaleshwar': 'mahottari',
  /* ── Siraha ────────────────────────────────────────────────────── */
  'siraha': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सिराहा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सिराहा', lang: 'ne' },
  ],
  /* ── Saptari / Rajbiraj ────────────────────────────────────────── */
  'saptari': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सप्तरी')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सप्तरी', lang: 'ne' },
  ],
  'rajbiraj': 'saptari',
  /* ── Udayapur ──────────────────────────────────────────────────── */
  'udayapur': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('उदयपुर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: उदयपुर', lang: 'ne' },
  ],
  /* ── Okhaldhunga ───────────────────────────────────────────────── */
  'okhaldhunga': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('ओखलढुङ्गा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: ओखलढुङ्गा', lang: 'ne' },
  ],
  /* ── Kaski ─────────────────────────────────────────────────────── */
  'kaski': 'pokhara',
  /* ── Syangja ───────────────────────────────────────────────────── */
  'syangja': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('स्याङ्जा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: स्याङ्जा', lang: 'ne' },
  ],
  /* ── Tanahun / Damauli ─────────────────────────────────────────── */
  'tanahun': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('तनहुँ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: तनहुँ', lang: 'ne' },
  ],
  'damauli': 'tanahun',
  /* ── Gorkha ────────────────────────────────────────────────────── */
  'gorkha': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('गोरखा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: गोरखा', lang: 'ne' },
  ],
  /* ── Lamjung / Besisahar ───────────────────────────────────────── */
  'lamjung': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('लमजुङ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: लमजुङ', lang: 'ne' },
  ],
  'besisahar': 'lamjung',
  /* ── Palpa / Tansen ────────────────────────────────────────────── */
  'palpa': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('पाल्पा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: पाल्पा', lang: 'ne' },
  ],
  'tansen': 'palpa',
  /* ── Nawalpur / Kawasoti ───────────────────────────────────────── */
  'nawalpur': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('नवलपुर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: नवलपुर', lang: 'ne' },
  ],
  /* ── Baglung ───────────────────────────────────────────────────── */
  'baglung': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('बागलुङ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: बागलुङ', lang: 'ne' },
  ],
  /* ── Mustang ───────────────────────────────────────────────────── */
  'mustang': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('मुस्ताङ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: मुस्ताङ', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Mustang Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Mustang', lang: 'en' },
  ],
  /* ── Solukhumbu / Namche / Everest ─────────────────────────────── */
  'solukhumbu': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सोलुखुम्बु')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सोलुखुम्बु', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Solukhumbu Everest Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Solukhumbu', lang: 'en' },
  ],
  'namche': 'solukhumbu',
  'lukla': 'solukhumbu',
  /* ── Humla ─────────────────────────────────────────────────────── */
  'humla': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('हुम्ला')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: हुम्ला', lang: 'ne' },
  ],
  /* ── Jumla ─────────────────────────────────────────────────────── */
  'jumla': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('जुम्ला')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: जुम्ला', lang: 'ne' },
  ],
  /* ── Dolpa ─────────────────────────────────────────────────────── */
  'dolpa': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('डोल्पा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: डोल्पा', lang: 'ne' },
  ],
  /* ── Ilam ──────────────────────────────────────────────────────── */
  'ilam': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('इलाम')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: इलाम', lang: 'ne' },
  ],
  /* ── Taplejung ─────────────────────────────────────────────────── */
  'taplejung': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('ताप्लेजुङ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: ताप्लेजुङ', lang: 'ne' },
  ],
  /* ── Panchthar ─────────────────────────────────────────────────── */
  'panchthar': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('पाँचथर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: पाँचथर', lang: 'ne' },
  ],
  /* ── Dang / Tulsipur ───────────────────────────────────────────── */
  'dang': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('दाङ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: दाङ', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Dang Tulsipur Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Dang', lang: 'en' },
  ],
  'tulsipur': 'dang',
  /* ── Surkhet ───────────────────────────────────────────────────── */
  'surkhet': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सुर्खेत')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सुर्खेत', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Surkhet Karnali Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Surkhet', lang: 'en' },
  ],
  /* ── Kapilvastu / Taulihawa ────────────────────────────────────── */
  'kapilvastu': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('कपिलवस्तु')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: कपिलवस्तु', lang: 'ne' },
  ],
  'taulihawa': 'kapilvastu',
  /* ── Arghakhanchi ──────────────────────────────────────────────── */
  'arghakhanchi': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('अर्घाखाँची')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: अर्घाखाँची', lang: 'ne' },
  ],
  /* ── Gulmi ─────────────────────────────────────────────────────── */
  'gulmi': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('गुल्मी')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: गुल्मी', lang: 'ne' },
  ],
  /* ── Pyuthan ───────────────────────────────────────────────────── */
  'pyuthan': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('प्युठान')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: प्युठान', lang: 'ne' },
  ],
  /* ── Rolpa ─────────────────────────────────────────────────────── */
  'rolpa': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('रोल्पा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: रोल्पा', lang: 'ne' },
  ],
  /* ── Rukum ─────────────────────────────────────────────────────── */
  'rukum': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('रुकुम')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: रुकुम', lang: 'ne' },
  ],
  /* ── Salyan ────────────────────────────────────────────────────── */
  'salyan': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सल्यान')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सल्यान', lang: 'ne' },
  ],
  /* ── Dailekh ───────────────────────────────────────────────────── */
  'dailekh': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('दैलेख')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: दैलेख', lang: 'ne' },
  ],
  /* ── Jajarkot ──────────────────────────────────────────────────── */
  'jajarkot': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('जाजरकोट')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: जाजरकोट', lang: 'ne' },
  ],
  /* ── Kanchanpur / Mahendranagar ────────────────────────────────── */
  'kanchanpur': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('कञ्चनपुर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: कञ्चनपुर', lang: 'ne' },
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('Kanchanpur Mahendranagar Nepal')}&hl=en&gl=NP&ceid=NP:en`, name: 'Google: Kanchanpur', lang: 'en' },
  ],
  'mahendranagar': 'kanchanpur',
  /* ── Dadeldhura ────────────────────────────────────────────────── */
  'dadeldhura': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('डडेल्धुरा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: डडेल्धुरा', lang: 'ne' },
  ],
  /* ── Baitadi ───────────────────────────────────────────────────── */
  'baitadi': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('बैतडी')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: बैतडी', lang: 'ne' },
  ],
  /* ── Darchula ──────────────────────────────────────────────────── */
  'darchula': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('दार्चुला')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: दार्चुला', lang: 'ne' },
  ],
  /* ── Achham / Sanfebagar ───────────────────────────────────────── */
  'achham': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('अछाम')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: अछाम', lang: 'ne' },
  ],
  /* ── Bajhang ───────────────────────────────────────────────────── */
  'bajhang': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('बाजहाङ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: बाजहाङ', lang: 'ne' },
  ],
  /* ── Bajura ────────────────────────────────────────────────────── */
  'bajura': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('बाजुरा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: बाजुरा', lang: 'ne' },
  ],
  /* ── Mugu ──────────────────────────────────────────────────────── */
  'mugu': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('मुगु')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: मुगु', lang: 'ne' },
  ],
  /* ── Kalikot ───────────────────────────────────────────────────── */
  'kalikot': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('कालिकोट')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: कालिकोट', lang: 'ne' },
  ],
  /* ── Nuwakot ───────────────────────────────────────────────────── */
  'nuwakot': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('नुवाकोट')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: नुवाकोट', lang: 'ne' },
  ],
  /* ── Rasuwa / Dhunche ──────────────────────────────────────────── */
  'rasuwa': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('रसुवा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: रसुवा', lang: 'ne' },
  ],
  /* ── Sindhupalchok ─────────────────────────────────────────────── */
  'sindhupalchok': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सिन्धुपाल्चोक')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सिन्धुपाल्चोक', lang: 'ne' },
  ],
  /* ── Kavrepalanchok / Dhulikhel ────────────────────────────────── */
  'kavrepalanchok': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('काभ्रेपलान्चोक')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: काभ्रे', lang: 'ne' },
  ],
  'dhulikhel': 'kavrepalanchok',
  /* ── Dolakha / Charikot ────────────────────────────────────────── */
  'dolakha': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('दोलखा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: दोलखा', lang: 'ne' },
  ],
  /* ── Ramechhap ─────────────────────────────────────────────────── */
  'ramechhap': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('रामेछाप')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: रामेछाप', lang: 'ne' },
  ],
  /* ── Sindhuli ──────────────────────────────────────────────────── */
  'sindhuli': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('सिन्धुली')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: सिन्धुली', lang: 'ne' },
  ],
  /* ── Khotang ───────────────────────────────────────────────────── */
  'khotang': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('खोटाङ')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: खोटाङ', lang: 'ne' },
  ],
  /* ── Bhojpur ───────────────────────────────────────────────────── */
  'bhojpur': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('भोजपुर')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: भोजपुर', lang: 'ne' },
  ],
  /* ── Sankhuwasabha / Khandbari ─────────────────────────────────── */
  'sankhuwasabha': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('संखुवासभा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: संखुवासभा', lang: 'ne' },
  ],
  'khandbari': 'sankhuwasabha',
  /* ── Terhathum ─────────────────────────────────────────────────── */
  'terhathum': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('तेह्रथुम')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: तेह्रथुम', lang: 'ne' },
  ],
  /* ── Dhankuta ──────────────────────────────────────────────────── */
  'dhankuta': [
    { url: `https://news.google.com/rss/search?q=${encodeURIComponent('धनकुटा')}&hl=ne&gl=NP&ceid=NP:ne`, name: 'Google: धनकुटा', lang: 'ne' },
  ],
};

/**
 * Resolve alias strings (e.g. 'ktm' → feeds for 'kathmandu').
 * Returns an array of feed descriptors, never undefined.
 */
function _resolveLocalFeeds(key) {
  let entry = _NEPAL_LOCAL_FEEDS[key];
  /* Follow single-level alias */
  if (typeof entry === 'string') entry = _NEPAL_LOCAL_FEEDS[entry];
  return Array.isArray(entry) ? entry : null;
}

function _locationFeedsFor(label) {
  const key = label.trim().toLowerCase()
    .replace(/\s+/g, '')          // strip spaces
    .replace(/['']/g, '')         // strip apostrophes
    .normalize('NFC');

  /* 1. Try exact lookup */
  let localFeeds = _resolveLocalFeeds(key);

  /* 2. Partial-match: check if any known key is a substring of the input or vice-versa */
  if (!localFeeds) {
    for (const k of Object.keys(_NEPAL_LOCAL_FEEDS)) {
      if (typeof _NEPAL_LOCAL_FEEDS[k] === 'string') continue; // skip aliases at this stage
      if (key.includes(k) || k.includes(key)) {
        localFeeds = _resolveLocalFeeds(k);
        break;
      }
    }
  }

  /* 3. Generic Google News queries — scope to location keyword.
     Note: `tbs=qdr:d` is ignored by Google News RSS; date filtering is done
     in _loadLocationArticles instead.                                         */
  const encLabel   = encodeURIComponent(label);
  const encLabelNe = encodeURIComponent(label + ' समाचार');
  const genericFeeds = [
    { url: `https://news.google.com/rss/search?q=${encLabel}+Nepal&hl=en&gl=NP&ceid=NP:en`, name: 'Google (EN): ' + label, lang: 'en' },
    { url: `https://news.google.com/rss/search?q=${encLabelNe}&hl=ne&gl=NP&ceid=NP:ne`,     name: 'Google (NE): ' + label, lang: 'ne' },
  ];

  /* Combine: local-specific first, then generic — deduplicate by URL */
  const combined = [...(localFeeds || []), ...genericFeeds];
  const seenUrls = new Set();
  return combined.filter(f => {
    if (seenUrls.has(f.url)) return false;
    seenUrls.add(f.url);
    return true;
  });
}

async function addLocation() {
  const input = document.getElementById('locationInput');
  const raw   = (input?.value || '').trim();
  if (!raw) { toast('⚠️ Enter a location name', 'error'); return; }
  if (_locationFeeds.find(f => f.label.toLowerCase() === raw.toLowerCase())) {
    toast('⚠️ Location already added', 'error'); return;
  }
  input.value = '';
  const loc = { label: raw, articles: [], loaded: false };
  _locationFeeds.push(loc);
  _renderLocationList();
  _loadLocationArticles(loc);
}

async function _loadLocationArticles(loc) {
  const feeds = _locationFeedsFor(loc.label);
  let items   = await fetchCategoryFeeds(feeds, null);

  /* ── 1. Relevance filter: keep only articles that mention the location
         in title or description.  This is critical for local outlet full-feeds
         that return ALL their articles regardless of location.
         Build a set of match tokens: English label + known Devanagari equivalents. ── */
  const matchTokens = _locationMatchTokens(loc.label);
  const relevant = items.filter(a => {
    const haystack = (a.title + ' ' + a.description).toLowerCase();
    return matchTokens.some(t => haystack.includes(t));
  });
  /* Use relevance-filtered set only if it returns ≥3 results (avoids stripping
     an outlet's own feed that doesn't mention the city name in every headline) */
  if (relevant.length >= 3) items = relevant;

  /* ── 2. Date filter: prefer articles from the last 48 h ── */
  const cutoff48 = Date.now() - 48 * 60 * 60 * 1000;
  const cutoff7d = Date.now() - 7  * 24 * 60 * 60 * 1000;
  const fresh48  = items.filter(a => { const t = new Date(a.pubDate).getTime(); return !isNaN(t) && t >= cutoff48; });
  const fresh7d  = items.filter(a => { const t = new Date(a.pubDate).getTime(); return !isNaN(t) && t >= cutoff7d;  });
  /* Cascade: prefer 48h → 7d → all (Google RSS often strips pubDate) */
  items = fresh48.length > 0 ? fresh48 : fresh7d.length > 0 ? fresh7d : items;

  /* ── 3. Tag each article with location for the UI badge ── */
  items.forEach(a => { a._locationLabel = loc.label; });

  loc.articles = items;
  loc.loaded   = true;
  if (_activeNewsTab === 'locations') {
    renderCategoryList('locations');
    const total = _locationFeeds.reduce((s, f) => s + (f.loaded ? f.articles.length : 0), 0);
    const badge = document.getElementById('statusBadge');
    if (badge) badge.textContent = total ? `${total} articles · last 48h` : 'No recent news found';
  }
}

/**
 * Build a list of lowercase tokens that indicate an article is about `label`.
 * Includes the English name, Devanagari equivalents from the bilingual dict,
 * and common alternative spellings.
 */
function _locationMatchTokens(label) {
  const tokens = new Set([label.toLowerCase()]);

  /* Look up the bilingual dict for Devanagari equivalents */
  const lLow = label.toLowerCase();
  for (const [engVariants, neVariants] of _BILINGUAL_DICT) {
    if (engVariants.some(v => v.includes(lLow) || lLow.includes(v))) {
      neVariants.forEach(v => tokens.add(v.toLowerCase()));
      engVariants.forEach(v => tokens.add(v.toLowerCase()));
    }
  }

  /* Known extra aliases for common locations */
  const EXTRA_ALIASES = {
    'kalaiya':   ['कलैया', 'कलाैया', 'kalaiya', 'bara', 'बारा'],
    'bara':      ['कलैया', 'बारा', 'bara', 'kalaiya'],
    'kathmandu': ['काठमाडौं', 'काठमाडौँ', 'ktm', 'काठमान्डू'],
    'pokhara':   ['पोखरा'],
    'biratnagar':['विराटनगर', 'biratnagar'],
    'chitwan':   ['चितवन'],
    'birgunj':   ['वीरगन्ज', 'birgunj'],
    'dhangadhi': ['धनगढी'],
    'nepalgunj': ['नेपालगन्ज'],
    'butwal':    ['बुटवल'],
    'janakpur':  ['जनकपुर', 'janakpurdham'],
    'itahari':   ['इटहरी'],
    'jhapa':     ['झापा'],
    'surkhet':   ['सुर्खेत'],
    'hetauda':   ['हेटौंडा'],
    'lalitpur':  ['ललितपुर', 'patan'],
    'bhaktapur': ['भक्तपुर'],
    'rautahat':  ['रौतहट', 'gaur', 'गौर'],
    'sarlahi':   ['सर्लाही'],
  };
  const lKey = label.toLowerCase();
  for (const [k, extras] of Object.entries(EXTRA_ALIASES)) {
    if (lKey === k || extras.map(e=>e.toLowerCase()).includes(lKey)) {
      extras.forEach(e => tokens.add(e.toLowerCase()));
      tokens.add(k);
    }
  }

  return [...tokens];
}

function removeLocation(label) {
  _locationFeeds = _locationFeeds.filter(f => f.label !== label);
  _renderLocationList();
  if (_activeNewsTab === 'locations') renderCategoryList('locations');
}

function _renderLocationList() {
  const c = document.getElementById('locationTagList');
  if (!c) return;
  c.innerHTML = _locationFeeds.map(f => `
    <span class="loc-tag">
      📍 ${escHtml(f.label)}
      <button onclick="removeLocation('${escHtml(f.label).replace(/'/g,"\\'")}')">✕</button>
    </span>`).join('');
}

/* ── Tab switching ───────────────────────────────────────────────────── */

function switchNewsTab(tab) {
  _activeNewsTab = tab;
  /* Update tab button styles */
  document.querySelectorAll('.news-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  /* Show/hide location input row */
  const locRow = document.getElementById('locationInputRow');
  if (locRow) locRow.style.display = tab === 'locations' ? 'flex' : 'none';
  /* Show/hide main fetch bar (only for nepal tab) */
  const fetchBar = document.querySelector('.fetch-bar');
  if (fetchBar) fetchBar.style.display = tab === 'nepal' ? 'flex' : 'none';
  const searchBar = document.getElementById('newsSearchBar');
  if (searchBar) {
    const hasArticles = tab === 'nepal' ? articles.length > 0 : (_catArticles[tab] || []).length > 0;
    searchBar.style.display = (tab !== 'locations' && hasArticles) ? 'block' : 'none';
    /* Clear search when switching tabs */
    const inp = document.getElementById('newsSearchInput');
    if (inp) inp.value = '';
  }

  if (tab === 'nepal') {
    renderNewsList();
    return;
  }
  if (tab === 'locations') {
    renderCategoryList('locations');
    return;
  }
  /* Category tabs — lazy-load on first visit */
  if (!_catLoaded[tab]) {
    const feedMap = { science: RSS_SCIENCE, 'nepali-ent': RSS_NEPALI_ENT, bhojpuri: RSS_BHOJPURI, 'hindi-ent': RSS_HINDI_ENT, world: RSS_WORLD };
    const list = document.getElementById('newsList');
    list.innerHTML = Array(6).fill(0).map(() => `
      <div class="news-item">
        <div class="news-item-thumb-placeholder skeleton" style="width:58px;height:45px"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div class="skeleton" style="height:13px;border-radius:4px"></div>
          <div class="skeleton" style="height:13px;width:70%;border-radius:4px"></div>
        </div>
      </div>`).join('');
    document.getElementById('statusBadge').textContent = 'Loading…';
    fetchCategoryFeeds(feedMap[tab] || [], tab).then(() => {
      renderCategoryList(tab);
      document.getElementById('statusBadge').textContent = `${_catArticles[tab].length} articles`;
      /* Show search bar now that articles are loaded */
      const sb = document.getElementById('newsSearchBar');
      if (sb) sb.style.display = 'block';
    });
  } else {
    renderCategoryList(tab);
    document.getElementById('statusBadge').textContent = `${_catArticles[tab].length} articles`;
  }
}

function renderCategoryList(tab, filterText) {
  const list = document.getElementById('newsList');
  let items = [];

  if (tab === 'locations') {
    if (!_locationFeeds.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📍</div><p>Add a location above to see trending news from there.</p></div>`;
      return;
    }
    /* Check if all locations are still loading */
    const allLoading = _locationFeeds.every(f => !f.loaded);
    if (allLoading) {
      list.innerHTML = `<div class="empty-state"><div class="icon">⏳</div><p>Loading location news…</p></div>`;
      return;
    }
    /* Merge all location articles (already tagged with _locationLabel) */
    items = [];
    _locationFeeds.forEach(loc => {
      if (!loc.loaded) return;
      /* Show up to 20 articles per location (filtered to 48h in _loadLocationArticles) */
      const locItems = loc.articles.slice(0, 20);
      locItems.forEach(a => { a._locationLabel = a._locationLabel || loc.label; });
      items.push(...locItems);
    });
    if (!items.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">🕐</div>
        <p>No articles about <strong>${escHtml(_locationFeeds.map(f=>f.label).join(', '))}</strong> in the last 24 hours.</p>
        <p style="font-size:.78rem;color:var(--muted);margin-top:6px">Try again later — local news is updated periodically.</p>
        <button class="btn btn-ghost" style="margin-top:10px;font-size:.8rem" onclick="_locationFeeds.forEach(f=>{f.loaded=false;f.articles=[];_loadLocationArticles(f)});renderCategoryList('locations')">🔄 Refresh</button>
        </div>`;
      return;
    }
    /* Sort: top-2-fresh first, then by viralScore */
    items.sort((a, b) => {
      const aTop = a._isLatestTop ? 1 : 0, bTop = b._isLatestTop ? 1 : 0;
      if (aTop !== bTop) return bTop - aTop;
      return (b.viralScore || 0) - (a.viralScore || 0) || new Date(b.pubDate) - new Date(a.pubDate);
    });
  } else {
    items = _catArticles[tab] || [];
    if (!items.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No articles found.</p></div>`;
      return;
    }
  }

  /* Apply search filter if provided */
  const query = (filterText || '').trim().toLowerCase();
  if (query) {
    const expansions = _expandSearchQuery(query);
    items = items.filter(a => _articleMatchesQuery(a, expansions));
    if (!items.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><p>No articles match "<strong>${escHtml(query)}</strong>".</p></div>`;
      return;
    }
  }

  list.innerHTML = items.map(a => {
    /* Store in a temporary global pool for selectArticle */
    const idx = _registerCatArticle(a);
    const dateStr = a.pubDate
      ? new Date(a.pubDate).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : '';
    let thumbHtml;
    if (a.imageUrl) {
      const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(a.imageUrl)}&w=120&h=90&fit=cover&output=jpg`;
      thumbHtml = `<img class="news-item-thumb" src="${proxied}" alt="" loading="lazy" onerror="this.style.display='none'">`;
    } else {
      thumbHtml = `<div class="news-item-thumb-placeholder">🗞️</div>`;
    }
    const viralBadge  = a.isTrending ? '<span class="viral-badge trending-badge">🔥 TRENDING</span>'
                      : a.isViral    ? '<span class="viral-badge">⚡ VIRAL</span>' : '';
    const latestBadge = a._isLatestTop ? '<span class="viral-badge latest-badge">🆕 LATEST</span>' : '';
    const locBadge    = a._locationLabel ? `<span class="source-badge" style="background:rgba(16,185,129,.15);color:#34d399;border-color:rgba(16,185,129,.3)">📍 ${escHtml(a._locationLabel)}</span>` : '';
    const sourceBadge = a.source ? `<span class="source-badge">${escHtml(a.source)}</span>` : '';
    const openBtn     = a.link ? `<button class="news-open-btn" onclick="event.stopPropagation();window.open('${escHtml(a.link)}','_blank','noopener')">🔗 Open</button>` : '';

    return `
      <div class="news-item${a.isTrending ? ' trending' : ''}" id="cat-item-${idx}" onclick="selectArticle(${idx})">
        ${thumbHtml}
        <div class="news-item-body">
          <div class="news-item-badges">${latestBadge}${viralBadge}${locBadge}${sourceBadge}</div>
          <div class="news-item-title">${escHtml(a.title)}</div>
          <div class="news-item-footer">
            ${dateStr ? `<div class="news-item-date">🕐 ${dateStr}</div>` : ''}
            ${openBtn}
          </div>
        </div>
      </div>`;
  }).join('');

  /* Lazily fetch og:image for articles that had no thumbnail in the RSS feed */
  _lazyLoadCatThumbnails(items);
}

/* Temporary article pool for category articles (so selectArticle still works) */
const _catPool = [];
function _registerCatArticle(a) {
  /* Reuse existing slot if same title */
  const existing = _catPool.findIndex(x => x.title === a.title);
  if (existing >= 0) return existing + 1000000;
  _catPool.push(a);
  return (_catPool.length - 1) + 1000000;
}

/* ================================================================
   MANUAL INPUT — URL or raw text, fetches full article if URL
   Uses a fixed-position modal overlay (same pattern as #shareModal)
================================================================ */
function showManualInput() {
  const modal  = document.getElementById('manualModal');
  const ta     = document.getElementById('manualTextarea0');
  const status = document.getElementById('manualModalStatus');
  const btn    = document.getElementById('manualModalLoadBtn');

  /* DEBUG — show visible alert so we know exactly what's happening */
  if (!modal) {
    alert('DEBUG: #manualModal element NOT FOUND in DOM!');
    return;
  }

  if (ta)     ta.value      = '';
  if (status) status.innerHTML = '';
  if (btn)    { btn.disabled = false; btn.innerHTML = '🚀 Fetch &amp; Load'; }
  modal.style.display = 'flex';
  setTimeout(() => { if (ta) ta.focus(); }, 60);
}

function closeManualModal() {
  document.getElementById('manualModal').style.display = 'none';
}

/* Keep old alias in case anything still references it */
function cancelManualInput() { closeManualModal(); }

function wireManualHints() {
  document.querySelectorAll('.manual-entry').forEach(entry => {
    const ta    = entry.querySelector('.manual-textarea');
    const hintU = entry.querySelector('.hint-url');
    const hintT = entry.querySelector('.hint-text');
    if (!ta) return;
    ta.addEventListener('input', () => {
      const isUrl = isValidUrl(ta.value.trim());
      hintU.style.display = isUrl ? 'inline' : 'none';
      hintT.style.display = isUrl ? 'none'   : 'inline';
    });
    /* Default state */
    hintU.style.display = 'none';
    hintT.style.display = 'inline';
  });
}

function addManualEntry() {
  const container = document.getElementById('manualEntries');
  const idx = container.querySelectorAll('.manual-entry').length;
  const div = document.createElement('div');
  div.className = 'manual-entry';
  div.dataset.idx = idx;
  div.innerHTML = `
    <div class="manual-entry-num">${idx + 1}</div>
    <div class="manual-entry-body">
      <textarea class="manual-textarea"
        placeholder="🔗 Paste a URL or 📝 type/paste news text"
        rows="3"></textarea>
      <div class="manual-entry-hint">
        <span class="hint-url">🔗 URL detected → will fetch full article automatically</span>
        <span class="hint-text">📝 Text mode → uses your text as the article body</span>
      </div>
    </div>
    <button class="manual-remove-btn" onclick="removeManualEntry(this)" title="Remove">✕</button>`;
  container.appendChild(div);
  wireManualHints();
  div.querySelector('.manual-textarea').focus();
}

function removeManualEntry(btn) {
  const entry = btn.closest('.manual-entry');
  if (document.querySelectorAll('.manual-entry').length <= 1) {
    entry.querySelector('.manual-textarea').value = '';
    return; /* always keep at least one */
  }
  entry.remove();
  /* Re-number */
  document.querySelectorAll('.manual-entry').forEach((e, i) => {
    e.querySelector('.manual-entry-num').textContent = i + 1;
  });
}

function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

async function loadManualArticles() {
  /* Reads from the modal textarea (#manualTextarea0) */
  const ta     = document.getElementById('manualTextarea0');
  const input  = ta ? ta.value.trim() : '';

  if (!input || input.length < 3) {
    const s = document.getElementById('manualModalStatus');
    if (s) s.innerHTML = '<span style="color:#f87171">⚠️ Please enter a URL or some text.</span>';
    return;
  }

  const btn      = document.getElementById('manualModalLoadBtn');
  const statusEl = document.getElementById('manualModalStatus');

  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Processing…';
  statusEl.innerHTML = `<div class="status-item">
    <span class="spinner" style="width:12px;height:12px;border-width:2px"></span>
    ${isValidUrl(input) ? 'Fetching article from <code>' + escHtml(new URL(input).hostname) + '</code>…' : 'Processing text…'}
  </div>`;

  let article;
  try {
    article = await buildManualArticle(input, 0);
    statusEl.innerHTML = `<div class="status-item" style="color:#4ade80">✅ ${escHtml(article.title.slice(0, 80))}${article.title.length > 80 ? '…' : ''}</div>`;
  } catch (err) {
    statusEl.innerHTML = `<div class="status-item" style="color:#f87171">⚠️ ${escHtml(err.message)}</div>`;
    btn.disabled  = false;
    btn.innerHTML = '🚀 Fetch &amp; Load';
    return;
  }

  /* Success — close modal, load article, render list */
  setTimeout(() => {
    closeManualModal();
    articles = [article];
    renderNewsList();
    document.getElementById('statusBadge').textContent = '1 article loaded';
    toast('✅ Article ready — click it to generate!', 'success', 4000);
  }, 800);

  btn.disabled  = false;
  btn.innerHTML = '🚀 Fetch &amp; Load';
}

/**
 * Build a full article object from either a URL or raw text input.
 * - URL  → fetches full article HTML, extracts title + body + image
 * - Text → uses text as body, derives title from the body itself
 */
async function buildManualArticle(input, idx) {
  if (isValidUrl(input)) {
    /* ── URL mode: fetch the full page ── */
    const html = await fetchRawHtml(input);
    if (!html || html.length < 100) throw new Error('Could not fetch article — check the URL, or the site may block scraping.');

    const title    = extractPageTitle(html) || `Article ${idx + 1}`;
    const bodyText = extractArticleText(html, input);
    if (!bodyText || bodyText.length < 50) throw new Error('Page fetched but article body could not be extracted — site may use JavaScript rendering.');

    const imageUrl = extractOgImage(html) || '';

    /* Detect language from body */
    const devanagariCount = (bodyText.match(/[\u0900-\u097F]/g) || []).length;
    const isNepali = devanagariCount > 20;
    /* Rough Hindi vs Nepali heuristic (Hindi uses different common words) */
    const isHindi  = !isNepali && devanagariCount > 5;
    const srcLang  = isNepali ? 'ne' : isHindi ? 'hi' : 'en';

    return {
      title,
      description: bodyText.slice(0, 2000),
      rawHtml: '',
      imageUrl,
      pubDate: new Date().toISOString(),
      link: input,
      source: new URL(input).hostname.replace('www.', ''),
      sourceLang: srcLang,
      fullArticleText: bodyText,
      viralScore: 0.5, isViral: false, isTrending: false,
    };

  } else {
    /* ── Text mode: use input as article body ── */
    const lines = input.split(/\n/).map(l => l.trim()).filter(Boolean);
    const body  = input.trim();

    /* Detect language */
    const devanagariCount = (body.match(/[\u0900-\u097F]/g) || []).length;
    const totalChars = body.replace(/\s/g, '').length;
    const devanagariRatio = devanagariCount / Math.max(totalChars, 1);
    const isNepali = devanagariRatio > 0.3;
    const isHindi  = !isNepali && devanagariRatio > 0.05;
    const srcLang  = isNepali ? 'ne' : isHindi ? 'hi' : 'en';

    /* For text mode, the "title" stored here is just a placeholder.
       The real Nepali title is generated in selectArticle → buildTitle,
       which will extract a proper headline from the body. */
    const placeholderTitle = extractHeadlineFromBody(body);

    return {
      title: placeholderTitle,
      description: body.slice(0, 2000),
      rawHtml: '',
      imageUrl: '',
      pubDate: new Date().toISOString(),
      link: '',
      source: 'Manual',
      sourceLang: srcLang,
      fullArticleText: body,
      viralScore: 0.4, isViral: false, isTrending: false,
    };
  }
}

/**
 * Fetch raw HTML from a URL.
 * On localhost: uses the built-in /proxy/fetch endpoint (fast, no CORS issues).
 * Otherwise: falls through a chain of public CORS proxies.
 */
async function fetchRawHtml(url) {
  /* ── Fast path: local proxy ── */
  if (_fetchProxyBase) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 15000);
      const res  = await fetch(`${_fetchProxyBase}?url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const html = await res.text();
        if (html && html.length > 200) return html;
      }
    } catch { /* fall through to external proxies */ }
  }

  /* ── Fallback: public CORS proxies (used when not on localhost) ── */
  const proxies = [
    { url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, json: true  },
    { url: `https://corsproxy.io/?${encodeURIComponent(url)}`,              json: false },
    { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, json: false },
  ];
  for (const proxy of proxies) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 14000);
      const res  = await fetch(proxy.url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      let html = '';
      if (proxy.json) {
        const data = await res.json().catch(() => null);
        html = data?.contents || '';
      } else {
        html = await res.text().catch(() => '');
      }
      if (html && html.length > 200) return html;
    } catch { /* try next proxy */ }
  }
  return '';
}

/** Extract the page <title> or og:title from raw HTML */
function extractPageTitle(html) {
  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (ogMatch) return ogMatch[1].trim();
  const titleMatch = html.match(/<title[^>]*>([^<]{3,200})<\/title>/i);
  if (titleMatch) {
    /* Strip "— Site Name" suffixes */
    return titleMatch[1].replace(/[\|–—-]\s*[^|–—-]{0,60}$/, '').trim();
  }
  return '';
}

/** Extract og:image from raw HTML */
function extractOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? m[1].trim() : '';
}

/**
 * For articles that have no imageUrl, fetch their article page in the background
 * and extract the og:image, then update the list thumbnail in-place.
 * Runs max 8 concurrent fetches so it doesn't flood the network.
 */
async function _lazyLoadListThumbnails() {
  const missing = articles.filter(a => !a.imageUrl && a.link);
  if (!missing.length) return;

  /* Process in small concurrent batches */
  const BATCH = 6;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    await Promise.all(batch.map(async (a) => {
      try {
        const html = await fetchRawHtml(a.link);
        if (!html) return;
        const ogImg = extractOgImage(html);
        if (!ogImg) return;
        a.imageUrl = ogImg;   // cache so re-renders use it immediately
        /* Update the DOM thumbnail in-place without re-rendering the whole list */
        const origIndex = articles.indexOf(a);
        const itemEl = document.getElementById('item-' + origIndex);
        if (!itemEl) return;
        const placeholder = itemEl.querySelector('.news-item-thumb-placeholder');
        /* Use weserv.nl as an image proxy to avoid CORS issues displaying thumbnails */
        const proxiedSrc = `https://images.weserv.nl/?url=${encodeURIComponent(ogImg)}&w=120&h=90&fit=cover&output=jpg`;
        const img = document.createElement('img');
        img.className = 'news-item-thumb';
        img.alt = 'news thumbnail';
        img.loading = 'lazy';
        img.onerror = () => { img.style.display = 'none'; };
        img.src = proxiedSrc;
        if (placeholder) {
          placeholder.replaceWith(img);
        } else {
          itemEl.insertBefore(img, itemEl.firstChild);
        }
      } catch { /* silently skip */ }
    }));
  }
}

/**
 * Same lazy-thumbnail loader for category list items.
 * Items are keyed by their pool index (id="cat-item-{idx}").
 */
async function _lazyLoadCatThumbnails(items) {
  const missing = items.filter(a => !a.imageUrl && a.link);
  if (!missing.length) return;

  const BATCH = 6;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    await Promise.all(batch.map(async (a) => {
      try {
        const html = await fetchRawHtml(a.link);
        if (!html) return;
        const ogImg = extractOgImage(html);
        if (!ogImg) return;
        a.imageUrl = ogImg;  // cache for future renders
        /* Resolve the pool index to find the DOM element */
        const poolIdx = _catPool.indexOf(a);
        if (poolIdx < 0) return;
        const domId = 'cat-item-' + (poolIdx + 1000000);
        const itemEl = document.getElementById(domId);
        if (!itemEl) return;
        const placeholder = itemEl.querySelector('.news-item-thumb-placeholder');
        const proxiedSrc = `https://images.weserv.nl/?url=${encodeURIComponent(ogImg)}&w=120&h=90&fit=cover&output=jpg`;
        const img = document.createElement('img');
        img.className = 'news-item-thumb';
        img.alt = 'news thumbnail';
        img.loading = 'lazy';
        img.onerror = () => { img.style.display = 'none'; };
        img.src = proxiedSrc;
        if (placeholder) {
          placeholder.replaceWith(img);
        } else {
          itemEl.insertBefore(img, itemEl.firstChild);
        }
      } catch { /* silently skip */ }
    }));
  }
}

function renderNewsList(filterText) {
  const list = document.getElementById('newsList');
  const searchBar = document.getElementById('newsSearchBar');

  /* Show/hide the search bar based on whether we have articles */
  if (searchBar) searchBar.style.display = articles.length ? 'block' : 'none';

  const query = (filterText || '').trim().toLowerCase();
  const expansions = query ? _expandSearchQuery(query) : [];
  const display = query
    ? articles.filter(a => _articleMatchesQuery(a, expansions))
    : articles;

  if (!display.length) {
    list.innerHTML = query
      ? `<div class="empty-state"><div class="icon">🔍</div><p>No articles match "<strong>${escHtml(query)}</strong>".</p></div>`
      : '<div class="empty-state"><div class="icon">📭</div><p>No articles found.</p></div>';
    return;
  }
  list.innerHTML = display.map((a, i) => {
    /* Use the original index so selectArticle maps to the right article */
    const origIndex = articles.indexOf(a);
    const dateStr = a.pubDate
      ? new Date(a.pubDate).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : '';

    /* Proxy image through weserv.nl to avoid CORS issues in the list */
    let thumbHtml;
    if (a.imageUrl) {
      const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(a.imageUrl)}&w=120&h=90&fit=cover&output=jpg`;
      thumbHtml = `<img class="news-item-thumb" src="${proxied}" alt="news thumbnail" loading="lazy"
             onerror="this.style.display='none'">`;
    } else {
      thumbHtml = `<div class="news-item-thumb-placeholder">🗞️</div>`;
    }

    const viralBadge   = a.isTrending ? '<span class="viral-badge trending-badge">🔥 TRENDING</span>'
                       : a.isViral    ? '<span class="viral-badge">⚡ VIRAL</span>'
                       : '';
    const latestBadge  = a._isLatestTop ? '<span class="viral-badge latest-badge">🆕 LATEST</span>' : '';
    const trendsBadge  = a._trendsMatch ? '<span class="viral-badge trends-badge">📈 Google Trends</span>' : '';
    const crossBadge   = (a._crossCount >= 3) ? `<span class="viral-badge cross-badge">🗞️ ${a._crossCount} sources</span>` : '';
    const sourceBadge  = a.source ? `<span class="source-badge">${escHtml(a.source)}</span>` : '';

    const openBtn = a.link
      ? `<button class="news-open-btn" onclick="event.stopPropagation();window.open('${escHtml(a.link)}','_blank','noopener')" title="Open original story">🔗 Open Story</button>`
      : '';

    return `
      <div class="news-item${a.isTrending ? ' trending' : ''}" id="item-${origIndex}" onclick="selectArticle(${origIndex})">
        ${thumbHtml}
        <div class="news-item-body">
          <div class="news-item-badges">${latestBadge}${viralBadge}${trendsBadge}${crossBadge}${sourceBadge}</div>
          <div class="news-item-title">${escHtml(a.title)}</div>
          <div class="news-item-footer">
            ${dateStr ? `<div class="news-item-date">🕐 ${dateStr}</div>` : ''}
            ${openBtn}
          </div>
        </div>
      </div>`;
  }).join('');

  /* For articles with no image in the RSS feed, lazily fetch their og:image in the background */
  if (!query) _lazyLoadListThumbnails();
}

/** Filter news list by search keyword (called from search input) */
function filterNewsList(value) {
  if (_activeNewsTab === 'nepal') {
    renderNewsList(value);
  } else {
    renderCategoryList(_activeNewsTab, value);
  }
}

/* ================================================================
   BILINGUAL SEARCH — English ↔ Nepali (Devanagari) cross-matching
   When a user types an English keyword the search also matches
   Devanagari articles whose topic is the same, and vice-versa.
================================================================ */

/**
 * Master bilingual dictionary: English term(s) → Nepali Devanagari equivalents.
 * Each entry: [ [english variants...], [nepali variants...] ]
 * All strings are stored lowercase for matching.
 */
const _BILINGUAL_DICT = [
  /* ── Places ─────────────────────────────────────────────────── */
  [['kathmandu','katmandu','ktm'],                           ['काठमाडौं','काठमाडौँ','काठमान्डू']],
  [['pokhara'],                                              ['पोखरा']],
  [['lalitpur','patan'],                                     ['ललितपुर','पाटन']],
  [['bhaktapur'],                                            ['भक्तपुर']],
  [['lumbini'],                                              ['लुम्बिनी']],
  [['chitwan'],                                              ['चितवन']],
  [['janakpur'],                                             ['जनकपुर']],
  [['biratnagar'],                                           ['विराटनगर']],
  [['birgunj'],                                              ['वीरगंज','वीरगञ्ज']],
  [['butwal'],                                               ['बुटवल']],
  [['dharan'],                                               ['धरान']],
  [['hetauda'],                                              ['हेटौंडा']],
  [['nepalgunj'],                                            ['नेपालगंज','नेपालगञ्ज']],
  [['dhangadhi'],                                            ['धनगढी']],
  [['surkhet'],                                              ['सुर्खेत']],
  [['dolakha'],                                              ['दोलखा']],
  [['sindhupalchok'],                                        ['सिन्धुपाल्चोक']],
  [['mustang'],                                              ['मुस्ताङ','मुस्ताङ्ग']],
  [['humla'],                                                ['हुम्ला']],
  [['solukhumbu','everest','sagarmatha'],                    ['सोलुखुम्बु','सगरमाथा','एभरेस्ट']],
  [['terai'],                                                ['तराई']],
  [['madhesh','madhes'],                                     ['मधेश','मधेस']],
  [['bagmati'],                                              ['बागमती']],
  [['gandaki'],                                              ['गण्डकी']],
  [['koshi','kosi'],                                         ['कोशी']],
  [['lumbini province'],                                     ['लुम्बिनी प्रदेश']],
  [['karnali'],                                              ['कर्णाली']],
  [['sudurpashchim','far west'],                             ['सुदूरपश्चिम']],
  [['nepal'],                                                ['नेपाल']],
  [['india'],                                                ['भारत']],
  [['china'],                                                ['चीन']],
  [['tibet'],                                                ['तिब्बत']],

  /* ── Government & Politics ───────────────────────────────────── */
  [['prime minister','pm','pradhanmantri'],                  ['प्रधानमन्त्री','प्रधानमंत्री']],
  [['president','rashtrapati'],                              ['राष्ट्रपति']],
  [['vice president'],                                       ['उपराष्ट्रपति']],
  [['parliament','sansad','house of representatives'],       ['संसद','प्रतिनिधिसभा','संसद्']],
  [['national assembly','rastriya sabha'],                   ['राष्ट्रियसभा']],
  [['cabinet','mantriparishad','council of ministers'],      ['मन्त्रिपरिषद्','मन्त्रिमण्डल']],
  [['minister','mantri'],                                    ['मन्त्री','मंत्री']],
  [['government','sarkar'],                                  ['सरकार']],
  [['opposition','bipaksha'],                                ['विपक्ष','विपक्षी']],
  [['election','nirbachan','vote','voting'],                 ['निर्वाचन','चुनाव','मतदान']],
  [['election commission'],                                  ['निर्वाचन आयोग']],
  [['constitution','sambidhan'],                             ['संविधान']],
  [['supreme court','sarbochcha adalat'],                    ['सर्वोच्च अदालत']],
  [['court','adalat'],                                       ['अदालत','न्यायालय']],
  [['police','prahari'],                                     ['प्रहरी','पुलिस']],
  [['army','sena','nepal army'],                             ['सेना','नेपाली सेना']],
  [['budget','bajat'],                                       ['बजेट','बजट']],
  [['tax','kar'],                                            ['कर']],
  [['corruption','bhrashtachar'],                            ['भ्रष्टाचार']],
  [['ciaa','anti-corruption'],                               ['अख्तियार','अख्तियार दुरुपयोग']],
  [['province','pradesh'],                                   ['प्रदेश']],
  [['municipality','nagarpalika'],                           ['नगरपालिका']],
  [['ward'],                                                 ['वडा']],
  [['local government','sthaniya sarkar'],                   ['स्थानीय सरकार']],

  /* ── Political Parties ───────────────────────────────────────── */
  [['nepali congress','nc'],                                 ['नेपाली कांग्रेस','कांग्रेस']],
  [['uml','cpm uml','kp oli party'],                        ['एमाले','नेकपा एमाले']],
  [['maoist','cpm maoist'],                                  ['माओवादी','नेकपा माओवादी']],
  [['rastriya swatantra party','rsp'],                       ['राष्ट्रिय स्वतन्त्र पार्टी']],
  [['rastriya prajatantra','rpp'],                           ['राष्ट्रिय प्रजातन्त्र पार्टी','राप्रपा']],
  [['janajati','indigenous'],                                ['जनजाति','आदिवासी']],
  [['coalition','gathbandhan'],                              ['गठबन्धन','गठबन्धन सरकार']],
  [['party','dal'],                                          ['पार्टी','दल']],

  /* ── People (prominent) ──────────────────────────────────────── */
  [['kp oli','kp sharma oli','oli'],                         ['केपी ओली','केपी शर्मा ओली']],
  [['pushpa kamal dahal','prachanda'],                       ['पुष्पकमल दाहाल','प्रचण्ड']],
  [['sher bahadur deuba','deuba'],                           ['शेर बहादुर देउवा','देउवा']],
  [['ram chandra paudel','paudel'],                          ['रामचन्द्र पौडेल','पौडेल']],
  [['bidya devi bhandari','bhandari'],                       ['विद्यादेवी भण्डारी','भण्डारी']],
  [['madhav kumar nepal','madhav nepal'],                    ['माधवकुमार नेपाल','माधव नेपाल']],
  [['rabi lamichhane','rabi'],                               ['रवि लामिछाने','रवि']],
  [['upendra yadav'],                                        ['उपेन्द्र यादव']],

  /* ── Economy & Finance ───────────────────────────────────────── */
  [['economy','arthatantra','economic'],                     ['अर्थतन्त्र','अर्थव्यवस्था','आर्थिक']],
  [['inflation','mahangai'],                                 ['महँगाई','मुद्रास्फीति']],
  [['remittance','bideshi aamdani'],                         ['रेमिट्यान्स','विप्रेषण']],
  [['foreign investment'],                                   ['विदेशी लगानी']],
  [['stock market','share market','nepse'],                  ['शेयर बजार','नेप्से']],
  [['nepal rastra bank','nrb','central bank'],               ['नेपाल राष्ट्र बैंक','केन्द्रीय बैंक']],
  [['bank','baink'],                                         ['बैंक']],
  [['loan','karja'],                                         ['ऋण','कर्जा']],
  [['fuel','petrol','diesel'],                               ['इन्धन','पेट्रोल','डिजेल']],
  [['electricity','bijuli','power'],                         ['बिजुली','विद्युत']],
  [['water','pani'],                                         ['पानी','खानेपानी']],

  /* ── Disaster & Crisis ───────────────────────────────────────── */
  [['earthquake','bhukampa'],                                ['भूकम्प']],
  [['flood','badi','flash flood'],                           ['बाढी','बाढीपहिरो']],
  [['landslide','pahiro'],                                   ['पहिरो']],
  [['fire','aagalagi','agni'],                               ['आगलागी','आगो']],
  [['accident','durghatana'],                                ['दुर्घटना']],
  [['drought','sukha','sookha'],                             ['खडेरी','सुख्खा']],
  [['storm','toofan','andhi'],                               ['आँधी','तुफान']],
  [['relief','rahat'],                                       ['राहत']],
  [['rescue','uddhaar'],                                     ['उद्धार']],
  [['dead','killed','mrityu','death'],                       ['मृत्यु','मारिए','मृत']],
  [['injured','ghaaite'],                                    ['घाइते']],
  [['missing','haraaeko'],                                   ['हराएका','बेपत्ता']],

  /* ── Crime & Law ─────────────────────────────────────────────── */
  [['arrested','pakrao','pakrau'],                           ['पक्राउ','गिरफ्तार']],
  [['murder','hatya'],                                       ['हत्या']],
  [['rape','balatkar'],                                      ['बलात्कार']],
  [['theft','chori'],                                        ['चोरी']],
  [['fraud','thagi'],                                        ['ठगी','धोखाधडी']],
  [['drugs','lagu'],                                         ['लागुपदार्थ','नशा']],
  [['verdict','faisala'],                                    ['फैसला']],
  [['bail','zamanat'],                                       ['जमानत']],
  [['investigation','anusandhan'],                           ['अनुसन्धान','छानबिन']],

  /* ── Social & Health ─────────────────────────────────────────── */
  [['hospital','aspatal'],                                   ['अस्पताल']],
  [['health','swasthya'],                                    ['स्वास्थ्य']],
  [['doctor','daktar'],                                      ['डाक्टर','चिकित्सक']],
  [['disease','rog','bimari'],                               ['रोग','बिमारी']],
  [['covid','corona'],                                       ['कोभिड','कोरोना']],
  [['education','shiksha'],                                  ['शिक्षा']],
  [['school','bidyalaya'],                                   ['विद्यालय','स्कूल']],
  [['university','bishwabidalaya'],                          ['विश्वविद्यालय']],
  [['protest','andolan','demonstration'],                    ['आन्दोलन','प्रदर्शन','विरोध']],
  [['strike','bandh','hartal'],                              ['बन्द','हडताल']],
  [['rally','janaraly'],                                     ['र्‍याली','जनसभा']],
  [['human rights','manabadhikar'],                          ['मानवअधिकार','मानव अधिकार']],
  [['women','mahila'],                                       ['महिला']],
  [['child','bachcha','baal'],                               ['बच्चा','बाल']],
  [['youth','yuwa'],                                         ['युवा']],

  /* ── International & Diplomacy ───────────────────────────────── */
  [['foreign minister','foreign affairs'],                   ['परराष्ट्रमन्त्री','परराष्ट्र']],
  [['ambassador','raajdoot'],                                ['राजदूत']],
  [['un','united nations'],                                  ['संयुक्त राष्ट्र','राष्ट्रसंघ']],
  [['imf','world bank'],                                     ['विश्व बैंक','आईएमएफ']],
  [['treaty','sandhi'],                                      ['सन्धि','सम्झौता']],
  [['visa'],                                                 ['भिसा']],
  [['foreign worker','foreign employment'],                  ['वैदेशिक रोजगार','विदेशी रोजगार']],

  /* ── Breaking / Urgency ──────────────────────────────────────── */
  [['breaking','breaking news'],                             ['ब्रेकिङ','ब्रेकिङ न्युज','तत्काल']],
  [['urgent','emergency'],                                   ['अलर्ट','आपतकाल','तत्काल']],
  [['news','khabar','khabara'],                              ['खबर','समाचार']],
  [['viral'],                                                ['भाइरल']],
  [['trending'],                                             ['ट्रेन्डिङ']],

  /* ── Sports ──────────────────────────────────────────────────── */
  [['cricket','kriket'],                                     ['क्रिकेट']],
  [['football','soccer'],                                    ['फुटबल']],
  [['olympics'],                                             ['ओलम्पिक']],
  [['gold','silver','bronze','medal'],                       ['स्वर्ण','रजत','कांस्य','पदक']],

  /* ── Technology ──────────────────────────────────────────────── */
  [['internet','antarjal'],                                  ['इन्टरनेट','अन्तर्जाल']],
  [['mobile','phone'],                                       ['मोबाइल','फोन']],
  [['ai tech','artificial intelligence','machine learning'], ['कृत्रिम बुद्धिमत्ता','एआई']],
];

/**
 * Build fast lookup tables from the dictionary:
 *   _ENG_TO_NP  : english-term → Set of nepali terms
 *   _NP_TO_ENG  : nepali-term  → Set of english terms
 *   _ALL_TERMS  : every string → Set of all cross-language equivalents
 */
const _ENG_TO_NP  = new Map();
const _NP_TO_ENG  = new Map();
const _ALL_TERMS  = new Map();

(function _buildBilingualIndex() {
  for (const [engVariants, npVariants] of _BILINGUAL_DICT) {
    /* NFC-normalise every key so Unicode combining characters are canonical */
    const allEng = engVariants.map(s => s.toLowerCase().normalize('NFC'));
    const allNp  = npVariants.map(s => s.toLowerCase().normalize('NFC'));

    for (const e of allEng) {
      if (!_ENG_TO_NP.has(e)) _ENG_TO_NP.set(e, new Set());
      allNp.forEach(n => _ENG_TO_NP.get(e).add(n));
    }
    for (const n of allNp) {
      if (!_NP_TO_ENG.has(n)) _NP_TO_ENG.set(n, new Set());
      allEng.forEach(e => _NP_TO_ENG.get(n).add(e));
    }

    /* _ALL_TERMS: every variant (both scripts) → all cross-language equivalents */
    const combined = [...allEng, ...allNp];
    for (const term of combined) {
      if (!_ALL_TERMS.has(term)) _ALL_TERMS.set(term, new Set());
      combined.forEach(t => { if (t !== term) _ALL_TERMS.get(term).add(t); });
    }
  }
})();

/**
 * Given a search query string, return an array of ALL equivalent terms
 * in both English and Nepali that should be matched against article text.
 *
 * Strategy:
 *  1. NFC-normalize the query (fixes Devanagari combining-char mismatches).
 *  2. Always include the original normalized query itself.
 *  3. Look up the full phrase in _ALL_TERMS → adds cross-language equivalents.
 *  4. Split into words (handles both Latin and Devanagari scripts).
 *     For each word, look up _ALL_TERMS → adds all equivalents.
 *  5. Try adjacent word-pairs too.
 *  6. Collect all unique expansions — the filter ORs across all of them.
 */
function _expandSearchQuery(raw) {
  /* NFC normalization ensures Devanagari combining characters are in
     canonical form, matching the same normalization used in the dictionary
     and applied to article text in _articleMatchesQuery. */
  const q = raw.trim().toLowerCase().normalize('NFC');
  if (!q) return [];

  const expansions = new Set([q]);

  /* Full-phrase lookup */
  (_ALL_TERMS.get(q) || []).forEach(t => expansions.add(t));

  /* Split on whitespace — works for both Latin and Devanagari */
  const words = q.split(/\s+/).filter(w => w.length > 0);
  for (const w of words) {
    expansions.add(w);
    (_ALL_TERMS.get(w) || []).forEach(t => expansions.add(t));
  }

  /* Adjacent word-pair lookup */
  for (let i = 0; i < words.length - 1; i++) {
    const pair = words[i] + ' ' + words[i + 1];
    expansions.add(pair);
    (_ALL_TERMS.get(pair) || []).forEach(t => expansions.add(t));
  }

  return [...expansions];
}

/**
 * Check if an article matches a search query using bilingual expansion.
 * Both the article text and the expansion terms are NFC-normalized so
 * Devanagari combining characters always match regardless of how the
 * RSS feed encoded them.
 * Returns true if ANY expansion term is found in the article's searchable text.
 */
function _articleMatchesQuery(a, expansions) {
  const haystack = [
    a.title        || '',
    a.description  || '',
    a.source       || '',
    a.fullArticleText || '',
  ].join(' ').toLowerCase().normalize('NFC');

  return expansions.some(term => haystack.includes(term));
}

/* ================================================================
   AI REWRITING ENGINE  (Gemini 2.0-flash — Free Tier)
   Rewrites hook, title, description and hashtags so the output
   is 100% original, SEO-friendly and copyright-safe.
================================================================ */

/**
 * Fetch key status from the server and update the UI.
 * API keys live in .env on the server — the browser never sees them.
 */
async function loadKeyStatus() {
  if (!_isNodeServer) {
    /* ── GitHub Pages / Live Server / direct file mode ──
       No Node.js proxy available. Use browser-stored keys from localStorage. */
    _geminiKey   = !!_browserGeminiKey;
    _removebgKey = !!_browserRemovebgKey;
    updateAIBadge();
    return;
  }
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000); // 5s timeout
    const res  = await fetch('/api/key-status', { signal: ctrl.signal });
    clearTimeout(tid);
    if (res.ok) {
      const data = await res.json();
      _geminiKey   = !!data.gemini;
      _removebgKey = !!data.removebg;
      _serverOnline = true;
      hideServerDownBanner();
    } else {
      _geminiKey = _removebgKey = false;
      _serverOnline = false;
    }
  } catch {
    _geminiKey = _removebgKey = false;
    _serverOnline = false;
    showServerDownBanner();
  }
  updateAIBadge();
}

/* ── Server health state ─────────────────────────────────── */
let _serverOnline = true;

function showServerDownBanner() {
  let banner = document.getElementById('serverDownBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'serverDownBanner';
    banner.style.cssText = `
      position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
      background:#7f1d1d;color:#fecaca;padding:12px 24px;
      border-radius:12px;font-size:.85rem;text-align:center;
      border:1px solid #dc2626;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.6);
      max-width:90%;cursor:pointer;
    `;
    banner.innerHTML = `⚠️ <strong>Server not running.</strong> 
      Open a terminal and run: <code style="background:#991b1b;padding:2px 8px;border-radius:4px;margin:0 4px">python server.py</code>
      then refresh this page. <span style="opacity:.7;font-size:.75rem">(click to dismiss)</span>`;
    banner.onclick = () => banner.remove();
    document.body.appendChild(banner);
  }
}

function hideServerDownBanner() {
  const banner = document.getElementById('serverDownBanner');
  if (banner) banner.remove();
}

/** Open the AI status modal (read-only — keys are managed via .env) */
function openAISettings() {
  const modal = document.getElementById('aiSettingsModal');

  /* ── Update status text for each card ── */
  _refreshAICardStatuses();

  /* ── Pre-fill inputs from localStorage when not on Node server ── */
  if (!_isNodeServer) {
    const gEl  = document.getElementById('inputGeminiKey');
    const rbEl = document.getElementById('inputRemovebgKey');
    const grEl = document.getElementById('inputGroqKey');
    const hfEl = document.getElementById('inputHFKey');
    if (gEl)  gEl.placeholder  = _browserGeminiKey   ? '(saved — paste to update)' : 'AIzaSy…your-key…';
    if (rbEl) rbEl.placeholder = _browserRemovebgKey ? '(saved — paste to update)' : 'abc123…your-key…';
    if (grEl) grEl.placeholder = _browserGroqKey     ? '(saved — paste to update)' : 'gsk_…your-groq-key…';
    if (hfEl) hfEl.placeholder = _browserHFKey       ? '(saved — paste to update)' : 'hf_…your-token…';
  }

  modal.classList.add('open');
}

/** Refresh all card status texts, dots, and the top banner */
function _refreshAICardStatuses() {
  const geminiOk   = !!(_geminiKey   || _browserGeminiKey);
  const removebgOk = !!(_removebgKey || _browserRemovebgKey);
  const groqOk     = !!_browserGroqKey;
  const hfOk       = !!_browserHFKey;

  function _setStatus(el, ok) {
    if (!el) return;
    el.textContent = ok ? '✅ Active & configured' : '❌ Not configured';
    el.className   = 'ai-card-status ' + (ok ? 'ok' : 'err');
  }
  _setStatus(document.getElementById('geminiKeyStatus'),   geminiOk);
  _setStatus(document.getElementById('removebgKeyStatus'), removebgOk);
  _setStatus(document.getElementById('groqKeyStatus'),     groqOk);
  _setStatus(document.getElementById('hfKeyStatus'),       hfOk);

  function _setDot(id, ok) {
    const dot = document.getElementById(id);
    if (!dot) return;
    dot.className = 'ai-status-dot ' + (ok ? 'active' : 'inactive');
    dot.title     = ok ? 'Active' : 'Not configured';
  }
  _setDot('geminiStatusDot',   geminiOk);
  _setDot('removebgStatusDot', removebgOk);
  _setDot('groqStatusDot',     groqOk);
  _setDot('hfStatusDot',       hfOk);

  /* Top banner */
  const banner = document.getElementById('aiSetupStatusBanner');
  if (banner) {
    const parts = [];
    if (geminiOk)   parts.push('✨ Gemini');
    if (groqOk)     parts.push('⚡ Groq');
    if (removebgOk) parts.push('🎨 Remove.bg');
    if (hfOk)       parts.push('🤗 HuggingFace');

    if (parts.length === 4) {
      banner.className   = 'ai-setup-banner active';
      banner.textContent = '🟢 All AI features active — Gemini + Groq + Remove.bg + HuggingFace';
    } else if (parts.length > 0) {
      banner.className   = 'ai-setup-banner partial';
      banner.textContent = `🟡 Active: ${parts.join(', ')}`;
    } else {
      banner.className   = 'ai-setup-banner none';
      banner.textContent = '🔴 No API keys configured — add Gemini or Groq key below';
    }
  }
}
function closeAISettings() {
  document.getElementById('aiSettingsModal').classList.remove('open');
}

/** Test Gemini connectivity via the server proxy (no key passed from browser) */
async function testGeminiKey() {
  /* Also accept a key typed in the input but not yet saved */
  const inputVal = document.getElementById('inputGeminiKey')?.value.trim() || '';
  const hasKey   = _geminiKey || _browserGeminiKey || inputVal;
  if (!hasKey) {
    _setCardFeedback('gemini', 'error', '⚠️ Enter a key first, then test');
    toast('⚠️ Paste a Gemini key in the field first.', 'error', 4000);
    return;
  }
  const btn = document.querySelector('#aiCardGemini .ai-card-btn.test');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳…'; btn.disabled = true; }
  _setCardFeedback('gemini', '', '⏳ Testing connection…');

  /* If on Node server: route through /proxy/gemini-withkey so server forwards the key without CORS block.
     If on GitHub Pages: call Gemini directly with the key in URL. */
  const testUrl = _isNodeServer
    ? '/proxy/gemini-withkey'
    : `${GEMINI_API_URL}?key=${encodeURIComponent(inputVal || _browserGeminiKey)}`;
  const testHeaders = _isNodeServer
    ? { 'Content-Type': 'application/json', 'X-Gemini-Key': inputVal || _browserGeminiKey || '' }
    : { 'Content-Type': 'application/json' };

  try {
    const res = await fetch(testUrl, {
      method: 'POST',
      headers: testHeaders,
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: {"ok":true}' }] }],
        generationConfig: { maxOutputTokens: 20 }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      _setCardFeedback('gemini', 'error', `❌ ${msg}`);
      toast(`❌ Gemini error: ${msg}`, 'error', 6000);
    } else {
      _setCardFeedback('gemini', 'ok', '✅ Connection successful!');
      toast('✅ Gemini connection works!', 'success', 5000);
    }
  } catch (e) {
    const msg = location.protocol === 'file:'
      ? 'Open via http://localhost:3000 (run: node server.js)'
      : e.message;
    _setCardFeedback('gemini', 'error', `❌ ${msg}`);
    toast(`❌ ${msg}`, 'error', 7000);
  }
  if (btn) { btn.textContent = origText; btn.disabled = false; }
}

/** Test Remove.bg by pinging the account endpoint via server proxy */
async function testRemovebgKey() {
  const inputVal = document.getElementById('inputRemovebgKey')?.value.trim() || '';
  const hasKey   = _removebgKey || _browserRemovebgKey || inputVal;
  if (!hasKey) {
    _setCardFeedback('removebg', 'error', '⚠️ Enter a key first, then test');
    toast('⚠️ Paste a Remove.bg key in the field first.', 'error', 4000);
    return;
  }
  const btn = document.querySelector('#aiCardRemovebg .ai-card-btn.test');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳…'; btn.disabled = true; }
  _setCardFeedback('removebg', '', '⏳ Testing connection…');

  const accountUrl = _isNodeServer
    ? '/proxy/removebg-account'
    : 'https://api.remove.bg/v1.0/account';

  try {
    const headers = {};
    const key = inputVal || _browserRemovebgKey;
    if (!_isNodeServer && key) headers['X-Api-Key'] = key;
    const res = await fetch(accountUrl, { headers });

    if (res.ok || res.status === 200) {
      let credits = '';
      try {
        const d = await res.json();
        const free = d?.data?.attributes?.credits?.subscription ?? d?.data?.attributes?.api?.free_calls ?? null;
        if (free !== null) credits = ` · ${free} free credits left`;
      } catch {}
      _setCardFeedback('removebg', 'ok', `✅ Key is valid${credits}`);
      toast(`✅ Remove.bg key works!${credits}`, 'success', 5000);
    } else if (res.status === 403 || res.status === 401) {
      _setCardFeedback('removebg', 'error', '❌ Invalid or expired key');
      toast('❌ Remove.bg key is invalid or expired.', 'error', 5000);
    } else {
      _setCardFeedback('removebg', '', `ℹ️ Status: ${res.status}`);
      toast(`ℹ️ Remove.bg responded with status ${res.status}`, 'info', 4000);
    }
  } catch (e) {
    /* Cannot ping from browser directly — if key is saved it will work in use */
    if (_removebgKey || _browserRemovebgKey || inputVal) {
      _setCardFeedback('removebg', 'ok', '✅ Key saved — will verify on first use');
      toast('ℹ️ Remove.bg key saved. It will be verified when you first remove a background.', 'info', 6000);
    } else {
      _setCardFeedback('removebg', 'error', `❌ ${e.message}`);
      toast(`❌ Remove.bg test failed: ${e.message}`, 'error', 5000);
    }
  }
  if (btn) { btn.textContent = origText; btn.disabled = false; }
}

/**
 * Save key for a single card (gemini | removebg).
 * On localhost: POSTs to /api/save-key which writes to .env (no restart needed).
 * On GitHub Pages: saves to localStorage.
 */
async function saveCardKey(service) {
  const inputMap = { gemini: 'inputGeminiKey', removebg: 'inputRemovebgKey', groq: 'inputGroqKey', hf: 'inputHFKey' };
  const cardMap  = { gemini: 'aiCardGemini',   removebg: 'aiCardRemovebg',   groq: 'aiCardGroq',   hf: 'aiCardHf'   };
  const inputId  = inputMap[service];
  const input    = document.getElementById(inputId);
  const value = (input?.value || '').trim();

  if (!value) {
    _setCardFeedback(service, 'error', '⚠️ Please paste an API key first');
    return;
  }

  const cardId  = cardMap[service] || ('aiCard' + service.charAt(0).toUpperCase() + service.slice(1));
  const saveBtn = document.querySelector(`#${cardId} .ai-card-btn.save`);
  const origLabel = saveBtn?.textContent || '💾 Save';
  if (saveBtn) { saveBtn.textContent = '⏳…'; saveBtn.disabled = true; }

  /* Groq + HuggingFace are browser-only keys — always save to localStorage regardless of server mode */
  if (service === 'groq' || service === 'hf') {
    if (service === 'groq') { localStorage.setItem(_LS_GROQ, value); _browserGroqKey = value; }
    if (service === 'hf')   { localStorage.setItem(_LS_HF,   value); _browserHFKey   = value; }
    if (input) input.value = '';
    _setCardFeedback(service, 'ok', `✅ ${service === 'hf' ? 'HuggingFace' : 'Groq'} key saved!`);
    updateAIBadge();
    _refreshAICardStatuses();
    if (saveBtn) { saveBtn.textContent = origLabel; saveBtn.disabled = false; }
    toast(`✅ ${service === 'hf' ? 'HuggingFace' : 'Groq'} key saved! Ready to use.`, 'success', 4000);
    return;
  }

  if (_isNodeServer) {
    /* ── Node server (port 3000): write key to .env via server endpoint ── */
    try {
      const res = await fetch('/api/save-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, key: value })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Server error');

      /* Also cache in localStorage as fallback for direct-API calls */
      if (service === 'gemini')   { localStorage.setItem(_LS_GEMINI,   value); _browserGeminiKey   = value; }
      if (service === 'removebg') { localStorage.setItem(_LS_REMOVEBG, value); _browserRemovebgKey = value; }
      if (service === 'groq')     { localStorage.setItem(_LS_GROQ,     value); _browserGroqKey     = value; }
      if (service === 'hf')       { localStorage.setItem(_LS_HF,       value); _browserHFKey       = value; }

      /* Re-fetch key-status so flags (_geminiKey etc.) are updated */
      await _reloadKeyStatus();
      if (input) input.value = '';
      _setCardFeedback(service, 'ok', '✅ Key saved to .env!');
      updateAIBadge();
      _refreshAICardStatuses();
      toast(`✅ ${service} key saved to .env — no restart needed!`, 'success', 4000);
    } catch (e) {
      _setCardFeedback(service, 'error', `❌ Save failed: ${e.message}`);
      toast(`❌ Could not save key: ${e.message}`, 'error', 5000);
    }
  } else {
    /* ── GitHub Pages: save to localStorage ── */
    try {
      if (service === 'gemini')   { localStorage.setItem(_LS_GEMINI,   value); _browserGeminiKey   = value; _geminiKey   = true; }
      if (service === 'removebg') { localStorage.setItem(_LS_REMOVEBG, value); _browserRemovebgKey = value; _removebgKey = true; }
      if (service === 'groq')     { localStorage.setItem(_LS_GROQ,     value); _browserGroqKey     = value; }
      if (service === 'hf')       { localStorage.setItem(_LS_HF,       value); _browserHFKey       = value; }
      if (input) input.value = '';
      _setCardFeedback(service, 'ok', '✅ Key saved in browser!');
      updateAIBadge();
      _refreshAICardStatuses();
      toast(`✅ ${service.charAt(0).toUpperCase()+service.slice(1)} key saved! AI features are now active.`, 'success', 4000);
    } catch (e) {
      _setCardFeedback(service, 'error', `❌ Save failed: ${e.message}`);
      toast(`❌ Could not save key: ${e.message}`, 'error', 5000);
    }
  }

  if (saveBtn) { saveBtn.textContent = origLabel; saveBtn.disabled = false; }
}

/** Re-fetch /api/key-status and update the global key flags */
async function _reloadKeyStatus() {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch('/api/key-status', { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return;
    const data = await res.json();
    _geminiKey   = !!data.gemini;
    _removebgKey = !!data.removebg;
  } catch { /* silent — flags stay as-is */ }
}

/** Show inline feedback text inside a card status element */
const _cardFeedbackTimers = {};
function _setCardFeedback(service, type, msg) {
  const _cmap = { gemini: 'aiCardGemini', removebg: 'aiCardRemovebg', groq: 'aiCardGroq', hf: 'aiCardHf' };
  const cardId   = _cmap[service] || ('aiCard' + service.charAt(0).toUpperCase() + service.slice(1));
  const statusEl = document.querySelector(`#${cardId} .ai-card-status`);
  if (!statusEl) return;
  /* Cancel any pending auto-revert timer for this card */
  if (_cardFeedbackTimers[service]) {
    clearTimeout(_cardFeedbackTimers[service]);
    delete _cardFeedbackTimers[service];
  }
  statusEl.textContent = msg;
  statusEl.className = 'ai-card-status ' + (type === 'ok' ? 'ok' : type === 'error' ? 'err' : '');
  /* Auto-revert: hold success messages longer so user can read them */
  const delay = type === 'ok' ? 8000 : 5000;
  _cardFeedbackTimers[service] = setTimeout(() => {
    delete _cardFeedbackTimers[service];
    _refreshAICardStatuses();
  }, delay);
}

function updateAIBadge() {
  const badge = document.getElementById('aiBadge');
  if (!badge) return;
  const geminiOk   = !!(_geminiKey || _browserGeminiKey);
  const groqOk     = !!_browserGroqKey;
  const removebgOk = !!(_removebgKey || _browserRemovebgKey);
  const hfOk       = !!_browserHFKey;

  if (geminiOk && groqOk && removebgOk && hfOk) {
    badge.textContent = '🤖 All AI Active';
    badge.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    badge.title = 'Gemini + Groq + Remove.bg + HuggingFace all active';
  } else if (geminiOk && removebgOk) {
    badge.textContent = '🤖 Gemini + BgRemover';
    badge.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    badge.title = 'Gemini AI + Remove.bg active';
  } else if (geminiOk) {
    badge.textContent = '🤖 Gemini AI';
    badge.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)';
    badge.title = 'Gemini active' + (groqOk ? ' + Groq fallback' : '');
  } else if (groqOk) {
    badge.textContent = '⚡ Groq AI';
    badge.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)';
    badge.title = 'Groq AI active — add Gemini key for best results';
  } else if (removebgOk) {
    badge.textContent = '🎨 BgRemover';
    badge.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)';
    badge.title = 'Remove.bg active — add Gemini or Groq key for AI rewriting';
  } else {
    badge.textContent = '⚙️ Setup AI';
    badge.style.background = 'linear-gradient(135deg,#6366f1,#4f46e5)';
    badge.title = 'Add API keys via Setup AI';
  }
}

/**
 * Save browser-entered API keys to localStorage (GitHub Pages mode only).
 * On localhost this is a no-op — keys come from .env via the server proxy.
 */
function saveBrowserKeys() {
  if (_isNodeServer) {
    toast('ℹ️ Running via Node server — keys are managed via .env on the server.', 'info', 4000);
    return;
  }
  const g  = (document.getElementById('inputGeminiKey')  ?.value || '').trim();
  const rb = (document.getElementById('inputRemovebgKey') ?.value || '').trim();
  const gr = (document.getElementById('inputGroqKey')     ?.value || '').trim();
  const hf = (document.getElementById('inputHFKey')       ?.value || '').trim();

  if (g)  { localStorage.setItem(_LS_GEMINI,   g);  _browserGeminiKey   = g; }
  if (rb) { localStorage.setItem(_LS_REMOVEBG, rb); _browserRemovebgKey = rb; }
  if (gr) { localStorage.setItem(_LS_GROQ,     gr); _browserGroqKey     = gr; }
  if (hf) { localStorage.setItem(_LS_HF,       hf); _browserHFKey       = hf; }

  /* Clear the input fields after saving (don't leave keys visible) */
  ['inputGeminiKey','inputRemovebgKey','inputGroqKey','inputHFKey'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  _geminiKey   = !!_browserGeminiKey;
  _removebgKey = !!_browserRemovebgKey;

  updateAIBadge();
  _refreshAICardStatuses();
  toast('✅ Keys saved in browser! AI features are now active.', 'success', 4000);
}

/** Clear all browser-stored keys */
function clearBrowserKeys() {
  [_LS_GEMINI, _LS_REMOVEBG, _LS_GROQ, _LS_HF].forEach(k => localStorage.removeItem(k));
  _browserGeminiKey = _browserRemovebgKey = _browserGroqKey = _browserHFKey = '';
  _geminiKey = _removebgKey = false;
  updateAIBadge();
  _refreshAICardStatuses();
  toast('🗑️ All saved keys cleared.', 'info', 3000);
}

/**
 * Call Gemini 2.0-flash (free tier) with a structured prompt.
 * Returns parsed JSON from the model or null on failure.
 * @param {string} prompt
 * @param {number} timeoutMs
 */
async function callGemini(prompt, timeoutMs = 18000) {
  const effectiveKey = _browserGeminiKey || (_geminiKey ? '__server__' : '');
  if (!effectiveKey) throw new Error('NO_KEY: Gemini API key not configured');

  /* Build the list of URLs to try in order:
     1. Server proxy with browser key (X-Gemini-Key header) — works on localhost even without .env key
     2. Server proxy with .env key (most secure — key never leaves server)
     3. Direct API call (only works on GitHub Pages / non-localhost origins) */
  const urlsToTry = [];
  if (_isNodeServer && _browserGeminiKey) {
    urlsToTry.push({ url: '/proxy/gemini-withkey', label: 'proxy(browser key)', headers: { 'X-Gemini-Key': _browserGeminiKey } });
  }
  if (_geminiProxyBase && _geminiKey) {
    urlsToTry.push({ url: _geminiProxyBase, label: 'proxy(.env key)', headers: {} });
  }
  if (!_isNodeServer && _browserGeminiKey) {
    urlsToTry.push({ url: `${GEMINI_API_URL}?key=${encodeURIComponent(_browserGeminiKey)}`, label: 'direct', headers: {} });
  }
  if (!urlsToTry.length) throw new Error('NO_KEY: No usable Gemini endpoint');

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.85, topK: 40, topP: 0.95, maxOutputTokens: 2048 },
  });

  for (const endpoint of urlsToTry) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      console.log(`[Gemini] trying ${endpoint.label}…`);
      const res = await fetch(endpoint.url, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...endpoint.headers },
        body,
      });
      clearTimeout(tid);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.error?.message || res.statusText || res.status;
        console.warn(`[Gemini] ${endpoint.label} HTTP ${res.status}:`, msg);
        continue; // try next endpoint
      }
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!raw) { console.warn('[Gemini] empty response from', endpoint.label); continue; }

      console.log('[Gemini] raw response (first 400 chars):', raw.slice(0, 400));

      // Strategy 1: Raw text IS already valid JSON
      try { return JSON.parse(raw.trim()); } catch (_) {}
      // Strategy 2: Strip ```json ... ``` code fence
      const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
      if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch (_) {} }
      // Strategy 3: Strip any ``` ... ``` code fence
      const anyFence = raw.match(/```\s*([\s\S]*?)```/i);
      if (anyFence) { try { return JSON.parse(anyFence[1].trim()); } catch (_) {} }
      // Strategy 4: Find the last { ... } block
      const firstBrace = raw.indexOf('{');
      const lastBrace  = raw.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch (_) {}
      }
      console.error('[Gemini] could not extract JSON. Full raw:', raw);
      throw new Error('NO_JSON: Could not extract JSON from Gemini response');
    } catch (e) {
      clearTimeout(tid);
      if (e.name === 'AbortError') { console.warn('[Gemini] timeout on', endpoint.label); continue; }
      if (e.message.startsWith('NO_JSON')) throw e; // don't retry parse failures
      console.warn('[Gemini] error on', endpoint.label, ':', e.message);
      // continue to next endpoint
    }
  }
  throw new Error('GEMINI_FAILED: All endpoints failed');
}

/**
 * Unified AI dispatcher — routes to Gemini.
 * @param {string} prompt
 * @param {number} timeoutMs
 */
async function callAI(prompt, timeoutMs = 22000) {
  const hasGemini = _geminiKey || _browserGeminiKey;
  const hasGroq   = !!_browserGroqKey;

  /* Try Gemini first */
  if (hasGemini) {
    try {
      return await callGemini(prompt, timeoutMs);
    } catch (e) {
      console.warn('[callAI] Gemini failed:', e.message, hasGroq ? '— trying Groq fallback…' : '');
      if (!hasGroq) throw e;
    }
  }

  /* Groq fallback */
  if (hasGroq) {
    try {
      return await callGroq(prompt, timeoutMs);
    } catch (e) {
      throw new Error('Both Gemini and Groq failed: ' + e.message);
    }
  }

  throw new Error('NO_KEY: No AI key configured — add Gemini or Groq key via ⚙️ Setup AI');
}

/* ================================================================
   GROQ AI — LLaMA3 fast text AI, fallback when Gemini unavailable
================================================================ */
async function callGroq(prompt, timeoutMs = 20000) {
  const key = _browserGroqKey;
  if (!key) throw new Error('NO_GROQ_KEY');

  console.log('[Groq] calling API, key prefix:', key.slice(0, 8) + '…');

  /* Always call Groq directly from the browser.
     On localhost, the server proxy may be intercepted by corporate firewalls;
     direct browser fetch is identical and works on GitHub Pages too. */
  const groqEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const groqHeaders = { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(groqEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: groqHeaders,
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that always responds with valid JSON only. No markdown, no explanation, no code fences — just raw JSON.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2048,
        temperature: 0.7
      })
    });
    clearTimeout(tid);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || res.statusText;
      console.error('[Groq] API error', res.status, msg);
      throw new Error(`Groq API error ${res.status}: ${msg}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    console.log('[Groq] raw response (first 400):', text.slice(0, 400));
    if (!text) throw new Error('Groq returned empty response');
    /* Parse JSON — try several strategies */
    try { return JSON.parse(text.trim()); } catch (_) {}
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch (_) {} }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch (_) {} }
    console.error('[Groq] could not parse JSON from response:', text.slice(0, 300));
    throw new Error('Groq: could not extract JSON from response');
  } finally {
    clearTimeout(tid);
  }
}

/* ================================================================
   HUGGINGFACE — FLUX.1-schnell image generation for Meme Studio
================================================================ */
async function fetchHuggingFaceImage(query, timeoutMs = 35000) {
  const key = _browserHFKey;
  if (!key) throw new Error('NO_HF_KEY');

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  const enhancedPrompt = `${query}, high quality, vibrant colors, expressive faces, photorealistic, funny meme style`;

  try {
    const res = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: enhancedPrompt })
    });
    clearTimeout(tid);
    /* Model still loading — wait and retry once */
    if (res.status === 503) {
      await new Promise(r => setTimeout(r, 9000));
      return fetchHuggingFaceImage(query, timeoutMs);
    }
    if (!res.ok) throw new Error(`HuggingFace error ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } finally {
    clearTimeout(tid);
  }
}

/**
 * AI-rewrite all four content fields in one single API call to save quota.
 * Returns { hook, title, description, hashtags } or null on failure.
 */
async function rewriteWithAI(rawTitle, articleBody, sourceLang, category) {
  const hasGemini = _geminiKey || _browserGeminiKey;
  const hasGroq   = !!_browserGroqKey;

  console.log('[AI DEBUG] rewriteWithAI called — Gemini:', !!hasGemini, '| Groq:', hasGroq);

  if (!hasGemini && !hasGroq) {
    console.warn('[AI DEBUG] No AI key found — returning null immediately');
    return null;
  }

  const aiLabel = hasGemini ? '✨ Gemini' : '⚡ Groq';

  /* Give AI the richest possible context — up to 3000 chars of actual article body */
  const bodySnippet = _cleanArticleText(articleBody || '', rawTitle).replace(/\s+/g, ' ').slice(0, 3000).trim();
  const langNote = sourceLang === 'ne' ? 'Nepali' : sourceLang === 'hi' ? 'Hindi' : 'English';
  const hasBody = bodySnippet.length > 100;

  /* ── Category-specific prompt configuration ── */
  const catCfg = {
    'nepali-ent': {
      persona:    'expert Nepali entertainment journalist and viral social media content creator who covers Nepali film, music and celebrity news',
      audience:   'Nepali film fans, music lovers, and entertainment followers in Nepal and the Nepali diaspora',
      hookEmojis: '🎬 (movie/film), 🎵 (music/song), ⭐ (celebrity), 💫 (star), 🏆 (award/achievement), 💔 (breakup/drama), 🔥 (viral/trending), 😱 (shocking celebrity news)',
      hookTip:    'Start with a fan-engaging, celebrity-focused line that makes Nepali film lovers want to immediately share it',
      titleTip:   'Write a detailed Nepali movie/celebrity/music headline with REAL actor/film/song names from the article',
      descTip:    'Write in Nepali entertainment journalism style (like Setopati or Ratopati entertainment section). Focus on the film/music/celebrity story, fan reaction, box office/streaming numbers if available.',
      hashtagSeed:'#नेपाली_चलचित्र, #नेपाली_मनोरञ्जन, #NepaliFilm, #NepaliCinema, #नेपाली_कलाकार',
      langInstruction: 'All hook, title, description MUST be written in Nepali (नेपाली) Devanagari script. Translate/adapt from source language to Nepali.',
    },
    'bhojpuri': {
      persona:    'expert Bhojpuri film and music industry journalist who covers Bhojpuri cinema, songs and celebrity news for Hindi-speaking audiences',
      audience:   'Bhojpuri film fans across UP, Bihar, Jharkhand, Nepal Terai and the global Bhojpuri diaspora',
      hookEmojis: '🎬 (film), 🎵 (gana/song), ⭐ (star), 🔥 (viral/trending), 💃 (dance/item number), 🏆 (hit/superhit), 😱 (shocking), 💔 (drama)',
      hookTip:    'Start with a dramatic, fan-engaging hook that Bhojpuri cinema fans will instantly react to and share',
      titleTip:   'Write a detailed Bhojpuri entertainment headline with REAL actor/film/song names (e.g. Pawan Singh, Khesari Lal, Akshara Singh) from the article',
      descTip:    'Write in engaging Hindi entertainment journalism style. Focus on the film/song/celebrity story with box office numbers, release details, or fan reactions. Use energetic language Bhojpuri fans love.',
      hashtagSeed:'#भोजपुरी_फिल्म, #BhojpuriSong, #BhojpuriCinema, #भोजपुरी_गाना, #PawanSingh',
      langInstruction: 'All hook, title, description MUST be written in Nepali (नेपाली) Devanagari script, regardless of the source language of the article. Translate/adapt everything to Nepali.',
    },
    'hindi-ent': {
      persona:    'expert Bollywood entertainment journalist and viral social media content creator who covers Hindi films, celebrities and music',
      audience:   'Bollywood fans across India, Nepal and the South Asian diaspora worldwide',
      hookEmojis: '🎬 (film/movie), 🌟 (Bollywood star), 🎵 (music/song), 🏆 (box office hit), 💔 (celebrity drama), 🔥 (viral/trending), 😱 (shocking news), 💫 (glamour)',
      hookTip:    'Start with a punchy Bollywood fan-page style hook that makes fans immediately want to comment and share',
      titleTip:   'Write a detailed Bollywood headline with REAL actor/film/director names from the article (e.g. Shah Rukh Khan, Deepika Padukone, etc.)',
      descTip:    'Write in energetic Bollywood entertainment journalism style (like Pinkvilla or Filmfare). Include box office numbers, OTT release info, celebrity quotes or fan reactions. Make it feel like an exciting fan page post.',
      hashtagSeed:'#बॉलीवुड, #Bollywood, #HindiFilm, #BollywoodNews, #BollywoodMovies',
      langInstruction: 'All hook, title, description MUST be written in Nepali (नेपाली) Devanagari script, regardless of the source language of the article. Translate/adapt everything to Nepali.',
    },
    'science': {
      persona:    'expert science and technology journalist who makes complex innovations understandable and viral for a Nepali social media audience',
      audience:   'tech-savvy Nepali youth, students, professionals and science enthusiasts',
      hookEmojis: '🔬 (science/research), 🚀 (space/future), 💡 (innovation/idea), 🤖 (AI/robots), 🌍 (environment/climate), ⚡ (breakthrough), 🧬 (biology/health), 🔭 (discovery)',
      hookTip:    'Start with a mind-blowing fact or discovery that makes the reader say "Wow, I had no idea!" — make it feel like the future is here',
      titleTip:   'Write a detailed science/tech headline that clearly states the breakthrough or innovation and WHY it matters to Nepali readers',
      descTip:    'Write in clear, exciting science journalism style. Explain WHAT the discovery/invention is, HOW it works in simple terms, and WHY it matters for Nepal or the world. Use analogies where helpful.',
      hashtagSeed:'#विज्ञान, #प्रविधि, #Science, #Technology, #Innovation',
      langInstruction: 'All hook, title, description MUST be in Nepali Devanagari script.',
    },
    'world': {
      persona:    'expert international news journalist and viral social media content strategist covering global affairs for Nepali audiences',
      audience:   'globally-aware Nepali readers who follow international politics, conflicts and world events',
      hookEmojis: '🌍 (world/global), 🚨 (breaking/urgent), ⚡ (crisis), 💔 (tragedy), 🏆 (victory/milestone), 🗳️ (election/politics), 💰 (economy), 🌊 (disaster)',
      hookTip:    'Start with an urgent, impactful hook that makes Nepali readers feel this world event directly affects them or is unmissable',
      titleTip:   'Write a detailed international news headline with REAL country names, leader names, and specific consequences',
      descTip:    'Write in Nepali international news journalism style. Explain WHAT happened, WHERE, WHO is involved, and WHY Nepali readers should care about this global event.',
      hashtagSeed:'#विश्व_समाचार, #WorldNews, #BreakingNews, #अन्तर्राष्ट्रिय, #Global',
      langInstruction: 'All hook, title, description MUST be in Nepali Devanagari script.',
    },
  };

  /* Default = Nepal breaking news (existing behaviour) */
  const cfg = catCfg[category] || {
    persona:    'expert Nepali news journalist and viral social media content strategist with deep knowledge of what goes viral on Facebook, Instagram and X (Twitter) in Nepal',
    audience:   'Nepali social media users across all ages',
    hookEmojis: '🔥 anger/controversy, 😱 shock, 💔 tragedy, ⚡ breaking, 🏆 victory, 💰 money/economy, 🚨 urgent, 🗳️ politics/election, 🌊 disaster, 🏥 health',
    hookTip:    'Mention the SPECIFIC subject of THIS news (a real name, place, or event from the article). Make it feel urgent and emotionally compelling.',
    titleTip:   'Must contain: WHO, WHAT happened, WHERE, and the most important number or consequence',
    descTip:    'Write in formal Nepali journalism style (like Kantipur or Onlinekhabar). Include WHO, WHAT, WHERE, WHEN, WHY and impact on common people.',
    hashtagSeed:'#BreakingNepal, #नेपाल_समाचार, #NepalNews, #नेपाल, #Nepal',
    langInstruction: 'All hook, title, description MUST be in Nepali Devanagari script.',
  };

  const prompt = `You are an ${cfg.persona}.

Your target audience: ${cfg.audience}

READ THIS ARTICLE CAREFULLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HEADLINE (${langNote}): ${rawTitle}
${hasBody ? `FULL ARTICLE BODY:\n${bodySnippet}` : '(No article body available — work from headline only)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your job: Write viral social media content that will get MAXIMUM shares, comments and reach.
CRITICAL: Every output field MUST be based on ACTUAL specific details in this article.
- Use the REAL names of people, places, films, songs, organisations mentioned
- Use the REAL numbers (box office, awards, dates, figures) from the article
- Use the REAL event/action described — do NOT invent or guess details

━━━ OUTPUT FORMAT (strict JSON, no markdown) ━━━

{
  "hook": "<ONE punchy viral opening line>",
  "title": "<Detailed headline — around 35-40 words>",
  "description": "<Compelling story — 100 to 200 words across 4-6 sentences>",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6", "#tag7", "#tag8", "#tag9", "#tag10", "#ShashiNewsGen"]
}

━━━ RULES FOR EACH FIELD ━━━

HOOK (max 20 words):
• Start with ONE emoji matching the mood — choose from: ${cfg.hookEmojis}
• ${cfg.hookTip}
• Make it feel urgent and emotionally compelling — trigger curiosity, excitement, outrage or pride
• NEVER write generic phrases like "एउटा ठूलो खबर" or "महत्त्वपूर्ण समाचार" or vague fillers

TITLE (35-40 words):
• Write a detailed, informative headline — NOT just a short teaser
• ${cfg.titleTip}
• Should read like a detailed front-page headline that tells the full story
• SEO-optimised — naturally include keywords people would search for

DESCRIPTION (100-200 words, 4-6 sentences):
• Sentence 1: State exactly WHAT happened, WHO was involved, WHERE and WHEN (use real names)
• Sentence 2: HOW it happened and WHY — key cause, background or context
• Sentence 3: KEY numbers — box office, awards, injuries, amounts, dates, etc.
• Sentence 4: Reaction — fans, critics, co-stars, government, public — what did they say/do?
• Sentence 5: What is the IMPACT or significance of this story?
• Sentence 6 (optional): Current status or what happens next
• ${cfg.descTip}
• NEVER use vague fillers

HASHTAGS (exactly 11 — the last one MUST be #ShashiNewsGen):
• Tags 1-3: STORY-SPECIFIC in Devanagari script — the real name, film, song, place or event keyword from THIS article
• Tags 4-6: STORY-SPECIFIC in English — transliterated or translated key terms
• Tags 7-9: Category-relevant trending hashtags — choose from: ${cfg.hashtagSeed}, #viral, #trending, #NepalNews, #ShashiNews
• Tag 10: ONE broad reach tag like #viral, #trending, #news, or #breakingnews
• Tag 11: MUST be exactly #ShashiNewsGen
• No spaces within any hashtag

VIRAL WRITING TIPS:
• Use specific numbers whenever possible (box office crores, award counts, dates, figures)
• Include emotional language that resonates with the audience
• The description should make the reader feel they MUST share this
• Use active, direct language — avoid passive voice

LANGUAGE: ${cfg.langInstruction}
OUTPUT: Raw JSON only — no \`\`\`json, no explanation, nothing else.`;

  /* For Groq (LLaMA3), use a shorter, more direct prompt to avoid token issues */
  const usingGroqModel = !(_geminiKey || _browserGeminiKey) && !!_browserGroqKey;
  const finalPrompt = usingGroqModel ? `You are a Nepali news journalist. Write viral social media content in Nepali (नेपाली Devanagari script) for this news article.

HEADLINE: ${rawTitle}
${bodySnippet ? `ARTICLE BODY: ${bodySnippet.slice(0, 1000)}` : ''}

Write in Nepali Devanagari script. Return ONLY this JSON (no markdown, no explanation):
{"hook":"<1 punchy Nepali sentence, max 15 words>","title":"<detailed Nepali headline with real names/places/numbers>","description":"<3-4 sentence Nepali news paragraph with WHO WHAT WHERE WHEN WHY>","hashtags":["#नेपाल","#BreakingNews","#Nepal","#viral","#trending","#नेपाल_समाचार","#NepaliNews","#ShashiNewsGen"]}` : prompt;

  let result;
  try {
    console.log('[AI DEBUG] calling callAI… model:', usingGroqModel ? 'Groq' : 'Gemini');
    result = await callAI(finalPrompt, 30000);
    console.log('[AI DEBUG] callAI returned:', JSON.stringify(result)?.slice(0, 200));
  } catch(e) {
    console.warn('[AI Rewrite] callAI threw:', e.message);
    return null;
  }
  if (!result) { console.warn('[AI DEBUG] result is null/undefined after callAI'); return null; }

  /* Validate the response has all required fields with Devanagari content */
  const { hook, title, description, hashtags } = result;
  const hasDevanagari = s => /[\u0900-\u097F]{3,}/.test(s || '');
  console.log('[AI DEBUG] hook:', hook);
  console.log('[AI DEBUG] title:', title);
  console.log('[AI DEBUG] description (first 80):', (description||'').slice(0,80));
  console.log('[AI DEBUG] hashtags:', hashtags);
  console.log('[AI DEBUG] hook hasDevanagari:', hasDevanagari(hook), '| title:', hasDevanagari(title), '| desc:', hasDevanagari(description));

  /* Validate fields exist and are non-empty strings */
  if (!hook || !title || !description) {
    console.warn('[AI Rewrite] Missing required fields — hook:', !!hook, 'title:', !!title, 'desc:', !!description);
    return null;
  }

  /* For Gemini: require Devanagari. For Groq: accept any non-empty response */
  const usingGroqOnly = !(_geminiKey || _browserGeminiKey) && !!_browserGroqKey;
  if (!usingGroqOnly) {
    const hasDevanagariStrict = hasDevanagari(title) && hasDevanagari(description);
    if (!hasDevanagariStrict) {
      console.warn('[AI Rewrite] Gemini response missing Devanagari — falling back');
      return null;
    }
  }
  if (!Array.isArray(hashtags) || hashtags.length < 3) {
    console.warn('[AI Rewrite] Invalid hashtags array — falling back');
    return null;
  }

  /* Always ensure #ShashiNewsGen is present as the brand tag */
  let finalHashtags = hashtags.slice(0, 11).map(h => h.startsWith('#') ? h : '#' + h);
  if (!finalHashtags.some(h => h.toLowerCase() === '#shashinewsgen')) {
    finalHashtags = [...finalHashtags.slice(0, 10), '#ShashiNewsGen'];
  }

  return {
    hook:        hook.trim(),
    title:       cleanTitle(title.trim()),
    description: description.trim(),
    hashtags:    finalHashtags,
  };
}

/* ================================================================
   FEATURE 2 – SELECT ARTICLE & GENERATE CONTENT
================================================================ */
async function selectArticle(idx) {
  document.querySelectorAll('.news-item').forEach(el => el.classList.remove('active'));
  document.getElementById('item-' + idx)?.classList.add('active');
  /* Category articles use idx >= 1000000 — look them up in the cat pool */
  if (idx >= 1000000) {
    selectedArticle = _catPool[idx - 1000000] || null;
  } else {
    selectedArticle = articles[idx];
  }
  /* New article = new image — clear ALL uploaded images and composite state */
  customImageDataUrl   = null;
  _subjectDataUrl      = null;
  _subjectImg          = null;
  _activeImageDataUrl  = null;
  _enhancedMode        = false;
  _mainImgSprite       = null;
  _mainImgSelected     = false;
  /* Clear composite side images */
  _sideSprites         = [];
  _selectedSpriteId    = null;
  _compositeMode       = false;
  _showCompositeHandles(false);
  /* Reset composite UI */
  _renderSideImageList();
  const resetBtn = document.getElementById('compositeClearBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  /* Reset custom image UI */
  const customInp = document.getElementById('customImgInput');
  if (customInp) customInp.value = '';
  document.getElementById('clearCustomBtn').style.display = 'none';
  document.getElementById('enhanceAIBtn').style.display   = 'none';
  document.getElementById('bgStylePicker').style.display  = 'none';
  document.getElementById('imgSourceBadge').textContent   = '';
  /* Reset image tint to default */
  _imageTint.preset = 'cinematic'; _imageTint.opacity = 0.5;
  document.querySelectorAll('.tint-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.tint === 'cinematic'));
  const _tcr = document.getElementById('tintCustomRow');
  if (_tcr) _tcr.style.display = 'none';
  const _tos = document.getElementById('tintOpacitySlider');
  if (_tos) _tos.value = 0.5;
  const _tov = document.getElementById('tintOpacityVal');
  if (_tov) _tov.textContent = '50%';
  /* Reset extra text labels */
  _extraTexts = [];
  _renderExtraTextList();
  resetImgAdjust(/* silent */ true);

  /* Disable Share All buttons until new image is generated */
  ['shareAllBtn', 'shareAllBtn2'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = '.45';
    btn.style.cursor  = 'not-allowed';
  });

  /* Show panel immediately */
  document.getElementById('contentWelcome').style.display = 'none';
  document.getElementById('contentOutput').style.display  = 'block';
  document.getElementById('imagePanel').style.display     = 'none';

  /* Show spinners while everything loads */
  document.getElementById('outHook').innerHTML =
    '<span class="spinner" style="border-color:rgba(246,173,85,.3);border-top-color:#f6ad55"></span> तयार हुँदैछ…';
  document.getElementById('outTitle').innerHTML =
    '<span class="spinner" style="border-color:rgba(246,173,85,.3);border-top-color:#f6ad55"></span> लेख पढ्दैछ…';
  document.getElementById('outDesc').innerHTML =
    '<span class="spinner" style="border-color:rgba(99,102,241,.3);border-top-color:#818cf8"></span> लेख खोलेर पढ्दैछ र विवरण तयार गर्दैछ…';
  document.getElementById('outHashtags').innerHTML = '';
  document.getElementById('contentPanel').scrollIntoView({ behavior:'smooth', block:'nearest' });

  const rawTitle   = selectedArticle.title;
  const sourceLang = selectedArticle.sourceLang || 'ne';

  /* Step 1: Fetch the full article page for deep context */
  let fullArticleText = selectedArticle.fullArticleText || '';
  if (!fullArticleText && selectedArticle.link) {
    document.getElementById('outDesc').innerHTML =
      '<span class="spinner" style="border-color:rgba(99,102,241,.3);border-top-color:#818cf8"></span> 🌐 मूल लेख डाउनलोड गर्दैछ…';
    fullArticleText = await fetchFullArticle(selectedArticle.link);
    selectedArticle.fullArticleText = fullArticleText;
  }
  const bestBody = fullArticleText || selectedArticle.description || '';

  /* ── Step 2: Show AI indicator in spinners if any AI key is set ── */
  const aiReady = _geminiKey || _browserGeminiKey || _browserGroqKey;
  const aiLabel = (_geminiKey || _browserGeminiKey) ? '✨ Gemini' : '⚡ Groq';
  if (aiReady) {
    document.getElementById('outHook').innerHTML =
      `<span class="spinner" style="border-color:rgba(139,92,246,.3);border-top-color:#a78bfa"></span> 🤖 ${aiLabel} AI ले hook लेख्दैछ…`;
    document.getElementById('outTitle').innerHTML =
      `<span class="spinner" style="border-color:rgba(139,92,246,.3);border-top-color:#a78bfa"></span> 🤖 ${aiLabel} AI ले शीर्षक तयार गर्दैछ…`;
    document.getElementById('outDesc').innerHTML =
      `<span class="spinner" style="border-color:rgba(139,92,246,.3);border-top-color:#a78bfa"></span> 🤖 ${aiLabel} AI ले लेख पढेर मौलिक विवरण लेख्दैछ…`;
  }

  /* ── Step 3: Try AI rewrite first (Gemini free tier) ── */
  let hook, nepaliTitle, desc, hashtags;
  let aiUsed = false;

  const aiResult = await rewriteWithAI(rawTitle, bestBody, sourceLang, selectedArticle._category || _activeNewsTab);

  if (aiResult) {
    /* ✅ AI succeeded — use fully original AI-generated content */
    hook        = aiResult.hook;
    nepaliTitle = aiResult.title;
    desc        = aiResult.description;
    hashtags    = aiResult.hashtags;
    aiUsed      = true;
  } else {
    /* ⬇️ Fallback: template + translation system */
    /* Step 3a: Translate title to Nepali */
    nepaliTitle = await buildTitle(rawTitle, sourceLang);
    /* Step 3b: Hook from topic-aware template bank */
    hook = buildHook(nepaliTitle + ' ' + rawTitle, bestBody);
    /* Step 3c: Build description (translates + extracts key facts) */
    desc = await buildDescription(nepaliTitle, rawTitle, bestBody, sourceLang);
    /* Step 3d: Hashtags */
    hashtags = buildHashtags(nepaliTitle + ' ' + rawTitle, bestBody);
  }

  document.getElementById('outHook').textContent   = hook;

  /* Merge hook as a punchy first line only when AI generated it — template titles stay clean */
  const hookyTitle = (aiUsed && hook) ? hook + '\n' + nepaliTitle : nepaliTitle;
  document.getElementById('outTitle').textContent  = hookyTitle;
  document.getElementById('outDesc').textContent   = desc;

  /* generatedPost keeps hook + title separate so sharing still uses correct fields */
  generatedPost = { hook, title: hookyTitle, description: desc, hashtags, link: selectedArticle.link || '' };
  renderHashtags(hashtags);

  /* ── Update AI/Template badges on all content fields ── */
  const prov = (_geminiKey || _browserGeminiKey) ? '✨ Gemini' : '⚡ Groq';
  setGenBadges(aiUsed, aiUsed ? prov : '');

  if (aiUsed) {
    toast(`🤖 ${prov} AI ले मूल लेख पढेर मौलिक सामग्री तयार गर्‍यो!`, 'success', 3500);
  }

  /* ── Auto-generate image now that post is ready — user can regenerate/edit afterwards ── */
  generateImage();
}

/* ================================================================
   FULL ARTICLE FETCHER
   Fetches the actual article page via CORS proxy chain, strips HTML,
   returns the clean article body text (up to 5000 chars).
================================================================ */
async function fetchFullArticle(url) {
  if (!url) return '';
  const html = await fetchRawHtml(url);
  if (!html || html.length < 200) return '';
  return extractArticleText(html, url) || '';
}

/**
 * Extract clean body text from raw article HTML.
 * Tries to find the main article <div> or <article> and strips all tags.
 */
function extractArticleText(html, sourceUrl) {
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(html, 'text/html');

    /* ── STEP 1: Aggressively remove ALL non-article elements ── */
    const REMOVE_SELECTORS = [
      /* Layout chrome */
      'script','style','noscript','link','meta',
      'nav','header','footer','aside','form','iframe','object','embed',
      /* Ads & trackers */
      '.advertisement','.ads','.ad-slot','.ad-wrapper','.ad-container',
      '[class*="advertisement"]','[class*="-ad-"]','[id*="google_ad"]',
      /* Related / recommended content */
      '.related','.related-articles','.related-news','.related-posts',
      '[class*="related"]','[class*="recommended"]','[class*="suggestion"]',
      '[class*="more-news"]','[class*="also-read"]','[class*="trending"]',
      /* Social share bars */
      '.social-share','.share-bar','.share-buttons','.sharing',
      '[class*="social"]','[class*="share-"]',
      /* Comments & feedback */
      '.comments','#comments','.comment-section','.comment-form',
      '.disqus','.fb-comments','[class*="comment"]','[class*="feedback"]',
      '[class*="reaction"]','[id*="comment"]','[id*="disqus"]',
      /* Newsletter / subscription */
      '.newsletter','[class*="newsletter"]','[class*="subscribe"]',
      '[class*="subscription"]','[class*="signup"]',
      /* Author bio boxes (usually after article) */
      '.author-bio','.author-box','.author-info','[class*="author-"]',
      /* Tags / categories widget */
      '.tags','.tag-list','.categories','[class*="tag-"]',
      /* Breadcrumbs, pagination */
      '.breadcrumb','[class*="breadcrumb"]','.pagination','[class*="paginat"]',
      /* Cookie / GDPR banners */
      '.cookie','.gdpr','[class*="cookie"]',
      /* Sidebar widgets */
      '.sidebar','.widget','[class*="sidebar"]','[class*="widget"]',
      /* "Back to top", print, email buttons */
      '[class*="back-to-top"]','[class*="print-"]','[class*="email-"]',
      /* ── Image / media wrappers — these inject caption noise between paragraphs ── */
      'figure','figcaption','picture',
      '[class*="caption"]','[class*="photo-caption"]','[class*="img-caption"]',
      '[class*="image-caption"]','[class*="figure-"]','[class*="wp-caption"]',
      '[class*="inline-image"]','[class*="article-image"]','[class*="media-caption"]',
      '.img-holder','.image-holder','.photo-holder','.photo-wrap',
      '[class*="media-"]','[class*="gallery"]','[class*="slideshow"]',
      '[class*="photo-"]','[class*="img-wrap"]','[class*="image-wrap"]',
      /* ── In-article ad/promo blocks ── */
      '[class*="inline-ad"]','[class*="in-article"]','[class*="mid-article"]',
      '[class*="inread"]','[class*="sponsored"]','[class*="promo"]',
      '[class*="outbrain"]','[class*="taboola"]','[class*="revcontent"]',
    ];

    REMOVE_SELECTORS.forEach(sel => {
      try { doc.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
    });

    /* ── STEP 2: Find the most specific article container ── */
    /* Priority order — most specific first */
    const ARTICLE_SELECTORS = [
      'article[class*="detail"]',
      'article[class*="news"]',
      'article[class*="post"]',
      'article[class*="content"]',
      '[class*="article-detail"]',
      '[class*="news-detail"]',
      '[class*="news-content"]',
      '[class*="article-content"]',
      '[class*="article-body"]',
      '[class*="story-body"]',
      '[class*="story-content"]',
      '[class*="post-content"]',
      '[class*="post-body"]',
      '[class*="entry-content"]',
      '[class*="content-body"]',
      '[class*="content-detail"]',
      '[class*="main-content"]',
      '[id*="article-body"]',
      '[id*="news-detail"]',
      '[id*="content-area"]',
      'article',
      'main',
    ];

    let articleEl = null;
    for (const sel of ARTICLE_SELECTORS) {
      try {
        const el = doc.querySelector(sel);
        if (el) { articleEl = el; break; }
      } catch {}
    }
    if (!articleEl) articleEl = doc.body;

    /* ── STEP 3: Remove post-article noise INSIDE the article container ──
       Some sites inject related/social/comment widgets inside the article div.
       Remove any block whose text content looks like post-article noise. */
    const POST_ARTICLE_NOISE = [
      'blockquote[class*="twitter"]','blockquote[class*="instagram"]',
      '[class*="tags"]','[class*="topics"]','[class*="keywords"]',
    ];
    POST_ARTICLE_NOISE.forEach(sel => {
      try { articleEl.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
    });

    /* ── STEP 4: Extract paragraphs — the gold standard ──
       Collect <p> tags AND <div> elements that behave like paragraphs.
       Many Nepali news sites use <div class="article-para"> instead of <p>.
       Lower the minimum length to 20 chars (Nepali sentences can be short).
       Ads/images between paragraphs are already removed in Step 1. */
    const PARA_NOISE_RE = /^(?:share|follow|subscribe|click here|read more|also read|related|advertisement|loading|tags?|topics?|photo|image|pic|video|source|credit|फोटो|तस्वीर|स्रोत)/i;

    /* Collect both <p> and paragraph-like <div>s */
    const allParaEls = [...articleEl.querySelectorAll('p, div')].filter(el => {
      /* For <div>: skip layout/container divs (those that contain other block elements) */
      if (el.tagName === 'DIV') {
        if (el.querySelector('div, article, section, nav, ul, ol, table')) return false;
      }
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 20) return false;                /* too short */
      if (PARA_NOISE_RE.test(t)) return false;        /* noise label */
      if (/^https?:\/\/\S+$/.test(t)) return false;  /* bare URL */
      return true;
    }).map(el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());

    /* Deduplicate — a parent <div> may include the same text as its child <p> */
    const seen = new Set();
    const paragraphs = allParaEls.filter(t => {
      /* Check whether this text is already a substring of something we have */
      if (seen.has(t)) return false;
      /* Also check if the new text is fully contained in an already-seen entry */
      for (const s of seen) { if (s.includes(t) || t.includes(s)) return false; }
      seen.add(t);
      return true;
    });

    if (paragraphs.length >= 1) {
      /* Got clean paragraphs — join them. Cap at 5000 chars. */
      return paragraphs.join(' ').slice(0, 5000);
    }

    /* ── STEP 5: Fallback — use full innerText but cut at definitive noise signal ──
       Only honor the cutoff AFTER we have accumulated > 300 chars of real content.
       This prevents mid-article "related news" widgets from chopping the text early. */
    const rawText = (articleEl.innerText || articleEl.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const CUTOFF_PATTERNS = [
      /^(?:प्रतिक्रिया|टिप्पणी|comment|feedback|leave a reply|reply)/i,
      /^(?:सम्बन्धित समाचार|related news|related articles|you may also like|also read|read more)/i,
      /^(?:tags?|topics?|categories|keywords?|hashtag)/i,
      /^(?:share this|share on|follow us|subscribe|newsletter)/i,
      /^(?:advertisement|sponsored|promoted)/i,
      /^(?:सम्पर्क|contact us|about us|privacy policy|terms of)/i,
      /^(?:facebook|twitter|instagram|youtube)\s*(?:page|account|channel)/i,
    ];

    const lines = rawText.split('\n');
    let cutLine = lines.length;
    let accumulated = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 5) continue;
      accumulated += line.length;
      /* Only cut at noise AFTER we have at least 300 chars of real content */
      if (accumulated > 300 && CUTOFF_PATTERNS.some(rx => rx.test(line))) {
        cutLine = i;
        break;
      }
    }

    const clipped = lines.slice(0, cutLine).join('\n').trim();
    if (clipped.length > 100) return clipped.slice(0, 5000);

  } catch { /* fall through */ }
  return '';
}

/* ================================================================
   CONTENT ENGINE — Hook, Title (async), Description, Hashtags
================================================================ */

/* ── Hook ────────────────────────────────────────────────────── */
const HOOK_BY_TOPIC = {
  flood      : '🌧️ प्रकृतिको कहर — नेपाल फेरि प्राकृतिक विपदको सामना गर्दैछ!',
  rain       : '🌧️ मनसुन अलर्ट — भारी वर्षाले नेपालमा खतराको घण्टी बजाएको छ!',
  landslide  : '⛰️ पहिरोको त्रास — नेपालमा जनजीवन प्रभावित भएको छ!',
  earthquake : '🌍 भूकम्पको धक्का — नेपालमा के भयो, जान्नुहोस्!',
  election   : '🗳️ लोकतन्त्रको पर्व — नेपालको भविष्य निर्धारण भइरहेको छ!',
  vote       : '🗳️ मतदानको दिन — नेपालीहरूले आफ्नो भविष्य रोज्दैछन्!',
  economy    : '💰 तपाईंको खल्तीमा असर — नेपालको अर्थतन्त्रमा ठूलो परिवर्तन!',
  price      : '💸 मूल्यवृद्धिको मार — आम नागरिकको दैनिकी प्रभावित!',
  accident   : '🚨 दुर्घटनाको खबर — नेपालमा गम्भीर घटना, विवरण आउँदैछ!',
  health     : '🏥 स्वास्थ्य अलर्ट — नेपालले यो बेवास्ता गर्न सक्दैन!',
  hospital   : '🏥 चिकित्सा क्षेत्रबाट ठूलो खबर — तपाईंको स्वास्थ्यसँग जोडिएको!',
  education  : '🎓 नेपालका विद्यार्थी र अभिभावकले यो हेर्नैपर्छ!',
  police     : '🚔 कानुन र व्यवस्था — नेपालको यो खबरले ध्यान माग्छ!',
  crime      : '🚔 अपराध अलर्ट — नेपालमा सुरक्षाको प्रश्न उठेको छ!',
  government : '🏛️ राजनीतिमा ठूलो हलचल — नेपालको सत्ता समीकरण बदलियो!',
  politics   : '🏛️ राजनीतिक भूचाल — नेपाल फेरि परिवर्तनको दोबाटोमा!',
  cricket    : '🏆 नेपाली क्रिकेटमा सनसनी — खेलप्रेमीहरू उत्साहित!',
  football   : '⚽ फुटबलको मैदानमा तहल्का — नेपाली खेलजगत्‌मा नयाँ अध्याय!',
  fire       : '🔥 आगलागीको विभीषिका — नेपालमा ठूलो क्षति भएको छ!',
  road       : '🚦 सडकमा अशान्ति — नेपाली यातायात क्षेत्रमा अपडेट!',
  tourism    : '🏔️ पर्यटनमा नयाँ लहर — नेपाल फेरि विश्वको ध्यान केन्द्रमा!',
};
const HOOK_GENERIC = [
  'नेपालमा अहिले के भइरहेको छ, विश्वास गर्नुहुन्न! 😱',
  'ब्रेकिङ: सबै कुरा बदलिने एउटा ठूलो अपडेट। 🚨',
  'नेपाल अहिले यही कुराको चर्चामा छ — तपाईंलाई थाहा छ? 👀',
  'काठमाडौंबाट आएको यो खबर अत्यन्त महत्त्वपूर्ण छ। 🔥',
  'सबै नेपाली यसमा प्रतिक्रिया दिइरहेका छन्! 💥',
  'आज नेपालमा एउटा चौंकाउने घटना भयो। 😮',
  'अभि अभि आएको खबर — र यो सोचेभन्दा ठूलो छ। ⚡',
  'ठूलो खबर: यसले हरेक नेपाली नागरिकलाई असर गर्छ। 📣',
];

function detectTopic(text) {
  const t = text.toLowerCase();
  for (const key of Object.keys(HOOK_BY_TOPIC)) {
    if (t.includes(key)) return key;
  }
  return null;
}

/**
 * Extract key Nepali/English nouns from a title for use in dynamic hooks.
 * Returns the most meaningful word (proper noun, number, or subject keyword).
 */
function _extractHookSubject(rawTitle) {
  /* Try to find numbers (death toll, amount, count) */
  const numMatch = rawTitle.match(/\b(\d+)\s*(?:जना|व्यक्ति|killed|dead|injured|crore|lakh|करोड|लाख)/i);
  if (numMatch) return numMatch[0].trim();

  /* Try to find capitalized proper nouns (English names/places) */
  const capWords = rawTitle.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/g);
  if (capWords && capWords.length) {
    /* Skip generic words */
    const skip = new Set(['Nepal','Nepali','The','This','How','Why','What','When','Where']);
    const best = capWords.find(w => !skip.has(w));
    if (best) return best;
  }

  /* Try to find Devanagari proper nouns (words > 3 chars not in common stop-word list) */
  const devWords = rawTitle.match(/[\u0900-\u097F]{4,}/g);
  const stopNe   = new Set(['नेपालमा','नेपालको','नेपाली','भएको','भएकी','गरिएको','गर्ने','गर्छ','भयो','छ।','छन्','हुने','गर्न','गरे','मा','को','ले','र']);
  if (devWords) {
    const best = devWords.find(w => !stopNe.has(w));
    if (best) return best;
  }
  return '';
}

function buildHook(rawTitle, articleBody) {
  const topic = detectTopic(rawTitle);
  const subject = _extractHookSubject(rawTitle);

  /* Build a dynamic hook using topic + specific subject from THIS article */
  const EMOJI_MAP = {
    flood:'🌊', rain:'🌧️', earthquake:'🔴', election:'🗳️',
    government:'🏛️', politics:'🏛️', health:'🏥', accident:'🚨',
    education:'📚', police:'🚔', crime:'🚔', cricket:'🏆',
    football:'⚽', fire:'🔥', road:'🚦', tourism:'🏔️', economy:'💰',
  };

  const HOOK_TEMPLATES_BY_TOPIC = {
    flood      : s => s ? `🌊 ${s} — बाढी र पहिरोले नेपाल थर्कायो! यो खबर नपढी नबस्नुस्।` : HOOK_BY_TOPIC['flood'],
    rain       : s => s ? `🌧️ ${s} — मनसुनी बाढी र पहिरोको खतरा बढ्यो!` : HOOK_BY_TOPIC['rain'] || HOOK_BY_TOPIC['flood'],
    earthquake : s => s ? `🔴 भूकम्पको झड्का! ${s} — नेपालमा ठूलो भूचाल गयो।` : HOOK_BY_TOPIC['earthquake'],
    election   : s => s ? `🗳️ ${s} — निर्वाचनमा नाटकीय मोड! हेर्नुस् के भयो।` : HOOK_BY_TOPIC['election'],
    economy    : s => s ? `💰 ${s} — नेपालको आर्थिक अवस्थामा ठूलो हलचल!` : HOOK_BY_TOPIC['economy'],
    government : s => s ? `🏛️ ${s} — सरकारको ठूलो निर्णय, नेपाल स्तब्ध!` : HOOK_BY_TOPIC['government'],
    politics   : s => s ? `🏛️ ${s} — राजनीतिमा भूचाल, नेपाल थर्कायो!` : HOOK_BY_TOPIC['politics'],
    health     : s => s ? `🏥 ${s} — स्वास्थ्य अलर्ट! नेपालीहरू सतर्क रहनुस्।` : HOOK_BY_TOPIC['health'],
    accident   : s => s ? `🚨 ${s} — दुर्घटनामा ज्यान गयो! हृदयविदारक घटना।` : HOOK_BY_TOPIC['accident'],
    police     : s => s ? `🚔 ${s} — प्रहरीको ठूलो कारबाही! अपराधी पक्राउ।` : HOOK_BY_TOPIC['police'],
    crime      : s => s ? `🚔 ${s} — अपराधको नयाँ अध्याय! नेपाल स्तब्ध।` : HOOK_BY_TOPIC['crime'],
    education  : s => s ? `📚 ${s} — शिक्षा क्षेत्रमा ठूलो बदलाव! विद्यार्थीहरू सतर्क रहनुस्।` : HOOK_BY_TOPIC['education'],
    cricket    : s => s ? `🏆 ${s} — नेपाली क्रिकेट इतिहास रच्यो!` : HOOK_BY_TOPIC['cricket'],
    football   : s => s ? `⚽ ${s} — फुटबल मैदानमा तहल्का मच्यो!` : HOOK_BY_TOPIC['football'],
    fire       : s => s ? `🔥 ${s} — आगलागीमा ठूलो क्षति! हृदयविदारक दृश्य।` : HOOK_BY_TOPIC['fire'],
    road       : s => s ? `🚦 ${s} — सडक दुर्घटनामा ज्यान गयो!` : HOOK_BY_TOPIC['road'],
    tourism    : s => s ? `🏔️ ${s} — नेपाल पर्यटनमा नयाँ इतिहास!` : HOOK_BY_TOPIC['tourism'],
  };

  /* Extra Devanagari topic checks */
  const t = rawTitle.toLowerCase();
  const devTopic = t.includes('बाढी') || t.includes('पहिरो') ? 'flood'
    : t.includes('भूकम्प') ? 'earthquake'
    : t.includes('निर्वाचन') || t.includes('मतदान') ? 'election'
    : t.includes('सरकार') || t.includes('प्रधानमन्त्री') ? 'government'
    : t.includes('स्वास्थ्य') || t.includes('अस्पताल') ? 'health'
    : t.includes('दुर्घटना') ? 'accident'
    : t.includes('शिक्षा') || t.includes('विद्यार्थी') ? 'education'
    : t.includes('प्रहरी') || t.includes('अपराध') ? 'police'
    : t.includes('क्रिकेट') ? 'cricket'
    : t.includes('फुटबल') ? 'football'
    : t.includes('आगलागी') ? 'fire'
    : null;

  const resolvedTopic = topic || devTopic;
  if (resolvedTopic && HOOK_TEMPLATES_BY_TOPIC[resolvedTopic]) {
    return HOOK_TEMPLATES_BY_TOPIC[resolvedTopic](subject);
  }

  /* Generic dynamic hook — use subject if available */
  if (subject) {
    const GENERIC_DYNAMIC = [
      `😱 ${subject} — नेपालमा अहिले यही कुराको चर्चा छ! सबैले पढ्नुस्।`,
      `⚡ ब्रेकिङ: ${subject} — यो खबरले नेपाल हल्लाउँदैछ!`,
      `🔥 ${subject} सम्बन्धी ठूलो खुलासा — नेपाली जनता स्तब्ध!`,
      `📢 ${subject} — सबैले थाहा पाउनुपर्ने जरुरी खबर!`,
    ];
    return GENERIC_DYNAMIC[Math.floor(Math.random() * GENERIC_DYNAMIC.length)];
  }
  return HOOK_GENERIC[Math.floor(Math.random() * HOOK_GENERIC.length)];
}

/* ── Title — async, real translation to Nepali ───────────────── */
const _titleCache = new Map();

function _offlineTitleFallback(raw) {
  const l = raw.toLowerCase();
  if (l.match(/flood|rain|landslide|monsoon|बाढी|पहिरो/))     return 'नेपालमा बाढी तथा पहिरोको जोखिम, सतर्कता जारी';
  if (l.match(/earthquake|quake|भूकम्प/))                      return 'नेपालमा भूकम्पको धक्का, क्षतिको विवरण आउँदै';
  if (l.match(/election|vote|poll|निर्वाचन|मतदान/))            return 'नेपालमा निर्वाचनसम्बन्धी महत्त्वपूर्ण घटनाक्रम';
  if (l.match(/budget|economy|gdp|finance|inflation|price|अर्थ|महँगी/)) return 'नेपालको अर्थतन्त्रमा महत्त्वपूर्ण परिवर्तन';
  if (l.match(/cricket|क्रिकेट/))                               return 'नेपाली क्रिकेट टोलीसम्बन्धी नयाँ अपडेट';
  if (l.match(/football|soccer|फुटबल/))                         return 'नेपाली फुटबलमा महत्त्वपूर्ण घटनाक्रम';
  if (l.match(/health|hospital|disease|covid|virus|स्वास्थ्य/)) return 'नेपालमा स्वास्थ्यसम्बन्धी अलर्ट जारी';
  if (l.match(/accident|crash|collision|दुर्घटना/))             return 'नेपालमा दुर्घटना, हताहतको विवरण आउँदै';
  if (l.match(/police|crime|arrest|प्रहरी|अपराध/))             return 'नेपाल प्रहरीको महत्त्वपूर्ण कारबाही';
  if (l.match(/government|minister|cabinet|सरकार|मन्त्री/))    return 'नेपाल सरकारमा महत्त्वपूर्ण घटनाक्रम';
  if (l.match(/school|education|student|शिक्षा|विद्यार्थी/))   return 'नेपालको शिक्षा क्षेत्रमा नयाँ अपडेट';
  if (l.match(/road|traffic|highway|सडक/))                      return 'नेपालको सडक तथा यातायात क्षेत्रमा अपडेट';
  if (l.match(/fire|blaze|आगलागी/))                             return 'नेपालमा आगलागी, क्षतिको जानकारी आउँदै';
  if (l.match(/tourism|trekk|पर्यटन/))                          return 'नेपालको पर्यटन क्षेत्रमा नयाँ समाचार';
  if (l.match(/human.rights|rights.commission|मानवअधिकार|आयोग/)) return 'मानवअधिकार उल्लङ्घनमा कारबाहीको माग';
  /* Bollywood / Nepali film / Bhojpuri */
  if (l.match(/bollywood|फिल्म|movie|film|cinema|चलचित्र/))    return 'मनोरञ्जन जगतमा नयाँ हलचल — चलचित्र समाचार';
  if (l.match(/bhojpuri|भोजपुरी/))                              return 'भोजपुरी सिनेमामा नयाँ धमाका';
  if (l.match(/song|music|album|singer|गाना|गायक|गायिका/))     return 'संगीत जगतमा नयाँ समाचार';
  if (l.match(/actor|actress|star|celebrity|कलाकार|अभिनेता|अभिनेत्री/)) return 'मनोरञ्जन क्षेत्रमा चर्चामा रहेका कलाकार';
  /* World / international news */
  if (l.match(/war|conflict|attack|bomb|युद्ध|आक्रमण/))         return 'विश्वमा तनाव बढ्दो, अन्तर्राष्ट्रिय समाचार';
  if (l.match(/trump|biden|modi|president|prime.minister/i))   return 'विश्वका नेताहरूसम्बन्धी महत्त्वपूर्ण खबर';
  if (l.match(/climate|environment|global.warm|वातावरण/))       return 'वातावरण परिवर्तनसम्बन्धी महत्त्वपूर्ण अपडेट';
  /* Science / tech */
  if (l.match(/science|research|discovery|invention|space|ai |artificial/i)) return 'विज्ञान तथा प्रविधिमा नयाँ खोज';
  if (l.match(/nasa|isro|rocket|satellite|space/i))             return 'अन्तरिक्ष विज्ञानमा नयाँ उपलब्धि';
  return 'महत्त्वपूर्ण समाचार — थप विवरण भित्र';
}

/**
 * Translate any text to a clean Nepali news headline.
 * - Already Nepali → rephrase/trim to headline length
 * - Long pasted body → extract first meaningful sentence as headline input
 * - English/Hindi/other → translate via MyMemory API (auto-detect source)
 */
async function buildTitle(raw, sourceLang) {
  const cleaned = raw.replace(/\s+/g, ' ').trim();

  /* If input is very long (pasted article body), extract a headline-length snippet */
  const titleInput = extractHeadlineFromBody(cleaned);

  /* Already Nepali (sourceLang='ne' AND has Devanagari) — clean and rephrase, no translation needed.
     NOTE: Hindi also uses the same Devanagari Unicode block (U+0900–U+097F), so we MUST check
     sourceLang to avoid treating a Hindi title as Nepali and skipping translation. */
  if (sourceLang === 'ne' && /[\u0900-\u097F]{5,}/.test(titleInput)) {
    return cleanTitle(rephraseNepaliTitle(titleInput));
  }

  const cacheKey = titleInput.toLowerCase().slice(0, 120);
  if (_titleCache.has(cacheKey)) return _titleCache.get(cacheKey);

  /* Determine translation pair: auto-detect source → Nepali */
  const langpair = sourceLang === 'hi' ? 'hi|ne'
                 : sourceLang === 'ne' ? 'ne|ne'   /* fallback: ne source treated as already done above but just in case */
                 : 'en|ne';

  try {
    const apiUrl = 'https://api.mymemory.translated.net/get?q='
      + encodeURIComponent(titleInput.slice(0, 250))
      + '&langpair=' + langpair;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 9000);
    const res  = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(tid);

    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.responseStatus !== 200) throw new Error('Bad status ' + data.responseStatus);

    let translated = (data.responseData?.translatedText || '').trim();
    const devChars = (translated.match(/[\u0900-\u097F]/g) || []).length;
    if (!translated || devChars < 3) throw new Error('No Devanagari in response');

    /* Clean and limit to headline length */
    translated = cleanTitle(rephraseNepaliTitle(translated));

    _titleCache.set(cacheKey, translated);
    return translated;
  } catch (err) {
    console.warn('[buildTitle] API failed, using offline fallback:', err.message);
    const fb = cleanTitle(_offlineTitleFallback(titleInput));
    _titleCache.set(cacheKey, fb);
    return fb;
  }
}

/**
 * If the raw input is a long body text, extract the first 1-2 sentences
 * that look like a headline (short, factual, no URLs).
 */
function extractHeadlineFromBody(text) {
  if (text.length <= 200) return text; /* short enough — use as-is */

  /* Split into sentences */
  const sents = text.split(/[।\.\!\?]+/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 250);
  if (!sents.length) return text.slice(0, 200);

  /* Pick the first sentence that doesn't look like a URL or nav item */
  for (const s of sents.slice(0, 5)) {
    if (/https?:\/\//.test(s)) continue;
    if (/^(share|follow|subscribe|click|read more|advertisement)/i.test(s)) continue;
    return s.trim();
  }
  return sents[0].trim();
}

/**
 * Clean a Nepali title: remove noise, trim to 30 words max.
 */
function rephraseNepaliTitle(title) {
  const clean = title
    .replace(/\|.*/g, '')          /* strip "| Site Name" */
    .replace(/[-–—].*$/g, match => {
      /* Only strip if the part after dash is likely a site name (short, no Devanagari) */
      const after = match.slice(1).trim();
      return (after.length < 40 && !/[\u0900-\u097F]/.test(after)) ? '' : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
  const words = clean.split(/\s+/);
  return words.slice(0, 30).join(' ') + (words.length > 30 ? '…' : '');
}

/**
 * Strip unwanted special characters from a title string.
 * Keeps: Devanagari, Latin letters, digits, spaces, common punctuation (। , . ! ? ' " -)
 */
function cleanTitle(title) {
  if (!title) return '';
  return title
    /* Remove zero-width chars, BOM, non-printable */
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    /* Remove leading/trailing pipe, dash, colon, slash, asterisk, hash, @, # */
    .replace(/^[\|\-–—:\/\\\*#@\s]+/, '')
    .replace(/[\|\-–—:\/\\\*#@\s]+$/, '')
    /* Remove inline pipe and em-dash separators (site name pattern) */
    .replace(/\s*[\|]\s*.{0,60}$/, '')
    .replace(/\s*[–—]\s*[^\u0900-\u097F]{0,60}$/, '')
    /* Remove HTML entities leftovers */
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    /* Remove unwanted symbols: brackets, asterisks, percent-encoded noise */
    .replace(/[【】「」〔〕《》〈〉『』\[\]{}]/g, '')
    .replace(/\*+/g, '')
    /* Collapse multiple spaces / tabs */
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* ── Description — intelligent, no duplicates ────────────────── */
/*
   Strategy:
   1. Detect the topic from the translated Nepali title + raw English title.
   2. Pick a UNIQUE context sentence for that topic (different from the hook).
   3. If RSS gave us a Nepali body, extract the 2 most useful sentences from it
      that are NOT semantically similar to the context opener.
   4. Add one factual "impact" sentence specific to the topic.
   5. Result: 2-3 tight sentences, no repeated ideas.
*/

const DESC_CONTEXT = {
  flood      : 'नेपालका कयौं जिल्लामा बाढी र पहिरोले व्यापक क्षति पुर्‍याएको छ र बासस्थान गुमाउनेहरूको संख्या बढ्दो छ।',
  rain       : 'अविरल वर्षाका कारण नदीहरू खतराको सीमाभन्दा माथि बगिरहेका छन् र निम्नभूमिका बासिन्दाहरूलाई सतर्क गरिएको छ।',
  landslide  : 'पहिरोले मुख्य सडक र पुलहरू अवरुद्ध गरेकाले उद्धार कार्यमा ढिलाइ भइरहेको छ।',
  earthquake : 'रिक्टर स्केलमा उल्लेखनीय तीव्रताको यो भूकम्पले पूर्वाधार र आवासीय संरचनामा क्षति पुर्‍याएको छ।',
  election   : 'मतदान केन्द्रहरूमा सुरक्षाका कडा प्रबन्ध गरिएको छ र मतदाताहरूको उत्साहजनक उपस्थिति देखिएको छ।',
  vote       : 'उम्मेदवारहरू प्रचारप्रसारको अन्तिम चरणमा छन् र मतदाताहरूले आफ्नो मताधिकार प्रयोग गर्न उत्सुक देखिएका छन्।',
  economy    : 'विदेशी मुद्रा सञ्चिति र आयात-निर्यातको असन्तुलनले देशको आर्थिक अवस्थालाई थप जटिल बनाएको छ।',
  price      : 'आवश्यक वस्तुको मूल्यवृद्धिले तल्लो र मध्यम वर्गका नागरिकहरूलाई सबैभन्दा बढी प्रभाव पारेको छ।',
  accident   : 'घटनास्थलमा प्रहरी, उद्धारकर्मी र एम्बुलेन्स पुगेका छन्; घाइतेहरूलाई नजिकको अस्पतालमा भर्ना गरिएको छ।',
  health     : 'स्वास्थ्य मन्त्रालयले यस अवस्थालाई गम्भीरतापूर्वक लिँदै रोकथामका उपायहरू तत्काल लागू गर्न निर्देशन दिएको छ।',
  hospital   : 'सरकारी अस्पतालहरूमा बिरामीको भार बढेको छ र स्वास्थ्यकर्मीहरूले अतिरिक्त समय काम गरिरहेका छन्।',
  education  : 'शिक्षा मन्त्रालयले यस विषयमा तत्काल निर्णय लिने आश्वासन दिएको छ र सम्बन्धित पक्षहरूसँग छलफल जारी छ।',
  police     : 'नेपाल प्रहरीले सम्बन्धित व्यक्तिहरूविरुद्ध कानुनी कारबाही अघि बढाएको छ र थप अनुसन्धान जारी छ।',
  crime      : 'अपराधीहरूलाई कानुनको कठघरामा उभ्याउन प्रहरीले विशेष टोली गठन गरेको छ।',
  government : 'यस निर्णयले आगामी दिनमा राष्ट्रिय नीति र बजेट आवंटनमा महत्त्वपूर्ण प्रभाव पार्ने विश्लेषकहरू बताउँछन्।',
  politics   : 'विपक्षी दलहरूले तत्काल संसद् बैठक बोलाउन माग गर्दैछन् र सत्तापक्षलाई चुनौती दिइरहेका छन्।',
  cricket    : 'यो प्रदर्शनले नेपाली क्रिकेटलाई अन्तर्राष्ट्रिय मञ्चमा नयाँ उचाइमा पुर्‍याउने आधार तयार गरेको छ।',
  football   : 'खेलाडीहरूको अथक परिश्रम र प्रशिक्षणको नतिजाले नेपाली फुटबललाई नयाँ पहिचान दिएको छ।',
  fire       : 'आगो नियन्त्रणमा आए पनि जीवन र सम्पत्तिको क्षतिको पूर्ण विवरण संकलन भइरहेको छ।',
  road       : 'सडक पूर्वाधार सुधार र सुरक्षा मापदण्डको कार्यान्वयनमा थप कडाइ गर्न आग्रह भइरहेको छ।',
  tourism    : 'यस घटनाक्रमले नेपालको पर्यटन उद्योगलाई नयाँ अवसर र चुनौती दुवै प्रदान गरेको छ।',
};

const DESC_IMPACT = {
  flood      : 'राहत वितरण र पुनर्निर्माणका लागि सरकारले विशेष कोष परिचालन गरेको छ।',
  rain       : 'सम्भावित पहिरो र बाढीबाट बच्न जनतालाई सुरक्षित स्थानमा सार्न स्थानीय प्रशासन सक्रिय छ।',
  landslide  : 'प्रभावित परिवारहरूलाई अस्थायी आश्रयस्थलमा राखिएको छ र आवश्यक सामग्री पुर्‍याइँदैछ।',
  earthquake : 'सरकारले राष्ट्रिय विपद् प्रतिकार्य कोष सक्रिय गरेको छ र अन्तर्राष्ट्रिय सहयोग माग गरिएको छ।',
  election   : 'निर्वाचन आयोगले स्वतन्त्र र निष्पक्ष मतदान सुनिश्चित गर्न निगरानी टोलीहरू खटाएको छ।',
  vote       : 'मतगणनाको परिणाम अर्को केही घण्टामा आउने अपेक्षा गरिएको छ।',
  economy    : 'विशेषज्ञहरूले नागरिकहरूलाई बचत र विवेकपूर्ण खर्चका लागि प्रोत्साहन गरेका छन्।',
  price      : 'सरकारले मूल्य नियन्त्रणका लागि बजार अनुगमन अभियान तीव्र पारेको छ।',
  accident   : 'यस घटनाले सडक सुरक्षाको विषयमा देशव्यापी बहस पुनः सुरू गरेको छ।',
  health     : 'नागरिकहरूलाई सतर्क रहन र नियमित स्वास्थ्य परीक्षण गर्न आग्रह गरिएको छ।',
  hospital   : 'थप जनशक्ति र स्वास्थ्य सामग्री उपलब्ध गराउन सरकारसँग माग गरिएको छ।',
  education  : 'विद्यार्थी र अभिभावकहरूलाई समयमै जानकारी लिन र सम्बन्धित निकायसँग सम्पर्क राख्न सुझाव दिइएको छ।',
  police     : 'यो घटनाले समाजमा कानुन र व्यवस्थाप्रति जनचेतना जगाउने अपेक्षा गरिएको छ।',
  crime      : 'यस प्रकरणले समाजमा सुरक्षा व्यवस्था सुदृढ गर्नु पर्ने आवश्यकतालाई पुनः रेखांकित गरेको छ।',
  government : 'आम नागरिकलाई यस परिवर्तनको प्रत्यक्ष असर दैनिक जीवनमा महसुस हुने विश्लेषकहरू बताउँछन्।',
  politics   : 'यस राजनीतिक उथलपुथलको अन्तिम परिणाम के हुन्छ भन्ने कुरा आउँदा केही दिनमा स्पष्ट हुनेछ।',
  cricket    : 'यो सफलताले नेपाली युवा खेलाडीहरूलाई क्रिकेटप्रति थप प्रेरित गर्नेछ।',
  football   : 'आगामी टूर्नामेन्टमा नेपाली टोलीको प्रदर्शनप्रति खेलप्रेमीहरू उत्सुक छन्।',
  fire       : 'पीडितहरूलाई तत्काल राहत उपलब्ध गराउन स्थानीय प्रशासन र सामाजिक संस्थाहरू सक्रिय भएका छन्।',
  road       : 'सम्बन्धित अधिकारीहरूले छानबिन गरी जिम्मेवारहरूविरुद्ध कारबाही गर्ने बताएका छन्।',
  tourism    : 'सरकारले पर्यटन क्षेत्रको विस्तारका लागि थप नीतिगत सहयोग उपलब्ध गराउने प्रतिबद्धता जनाएको छ।',
};

const DESC_GENERIC_CONTEXT = [
  'यो विषयमा सम्बन्धित निकायहरू सक्रिय रूपमा काम गरिरहेका छन् र छिट्टै थप विवरण सार्वजनिक हुनेछ।',
  'सरोकारवाला पक्षहरूले यस घटनाक्रमलाई गम्भीरतापूर्वक लिएका छन् र आवश्यक कदम चाल्ने सुनिश्चित गरेका छन्।',
  'विभिन्न क्षेत्रका विज्ञहरूले यस विषयमा आफ्ना विचार र सुझाव सार्वजनिक गरेका छन्।',
];
const DESC_GENERIC_IMPACT = [
  'नेपालका नागरिकहरूले यस विकासक्रमलाई ध्यानपूर्वक अनुगमन गरिरहेका छन्।',
  'यो खबरले देशभर व्यापक बहस र चर्चाको सुरुवात गरेको छ।',
  'थप जानकारीका लागि सम्बन्धित अधिकारी र विश्वसनीय समाचार स्रोत अनुगमन गर्न सुझाव दिइएको छ।',
];

/* ── Key Fact Extractor ──────────────────────────────────────── */
/*
   Scans the raw English/Nepali article body and pulls out:
   - Numbers with units (3 dead, Rs 2 crore, 7.2 magnitude, 40%, 500 families)
   - Named people  (PM, minister names)
   - Named places  (district names, city names)
   - Quoted figures / stats
   Returns an array of compact Nepali fact strings ready to embed.
*/
function extractKeyFacts(rawTitle, rssBody) {
  const facts = [];
  if (!rssBody || rssBody.trim().length < 30) return facts;

  const text = rssBody.replace(/\s+/g, ' ');

  /* ── 1. Death / injury toll ── */
  const tollMatch = text.match(/(\d+)\s*(?:people?|persons?|individuals?|citizens?|workers?|passengers?)?\s*(?:were?\s+)?(?:killed|dead|died|lost\s+(?:their\s+)?lives?)/i)
    || text.match(/(?:death\s+toll|casualties?)\s*(?:rises?|reached?|climbs?)?\s*(?:to\s+)?(\d+)/i)
    || text.match(/(\d+)\s*(?:जना|व्यक्ति).*?(?:मृत्यु|मारिए|घाइते)/);
  if (tollMatch) {
    const n = parseInt(tollMatch[1]);
    if (n > 0 && n < 100000) facts.push(`यस घटनामा ${n} जनाको ज्यान गएको छ।`);
  }

  /* ── 2. Injured / displaced ── */
  const injuredMatch = text.match(/(\d+)\s*(?:people?|persons?|individuals?)?\s*(?:were?\s+)?(?:injured|wounded|hurt)/i)
    || text.match(/(\d+)\s*(?:families|households?|people?)\s*(?:were?\s+)?(?:displaced|evacuated|affected)/i);
  if (injuredMatch && !tollMatch) {
    const n = parseInt(injuredMatch[1]);
    if (n > 0 && n < 1000000) facts.push(`करिब ${n} जना प्रभावित भएका छन्।`);
  }

  /* ── 3. Monetary / budget figures ── */
  const moneyMatch = text.match(/(?:Rs\.?|NPR|रु\.?)\s*([\d,]+(?:\.\d+)?)\s*(crore|lakh|million|billion|arab|karod)?/i)
    || text.match(/([\d,]+(?:\.\d+)?)\s*(?:crore|lakh)\s*(?:rupees?|Rs\.?)/i);
  if (moneyMatch) {
    const amt  = moneyMatch[1].replace(/,/g, '');
    const unit = (moneyMatch[2] || '').toLowerCase();
    const unitNe = unit === 'crore' || unit === 'karod' || unit === 'arab'
      ? (unit === 'arab' ? 'अर्ब' : 'करोड')
      : unit === 'lakh' ? 'लाख'
      : unit === 'million' ? 'मिलियन'
      : unit === 'billion' ? 'बिलियन' : '';
    if (unitNe) facts.push(`यससँग जोडिएको रकम रु. ${amt} ${unitNe} रहेको जनाइएको छ।`);
    else        facts.push(`आर्थिक क्षति रु. ${amt} रहेको अनुमान गरिएको छ।`);
  }

  /* ── 4. Percentage / rate ── */
  const pctMatch = text.match(/([\d.]+)\s*%\s*(?:increase|decrease|rise|fall|growth|decline|inflation|interest)/i)
    || text.match(/(?:increase|decrease|rise|fall|growth|decline)\s*(?:of|by)\s*([\d.]+)\s*%/i);
  if (pctMatch) {
    const pct = pctMatch[1];
    facts.push(`यस परिवर्तनबाट ${pct}% को उल्लेखनीय फेरबदल देखिएको छ।`);
  }

  /* ── 5. Earthquake magnitude ── */
  const magMatch = text.match(/magnitude\s+([\d.]+)|(\d+\.\d+)\s*(?:richter|magnitude)/i)
    || text.match(/रिक्टर.*?([\d.]+)/);
  if (magMatch) {
    const mag = magMatch[1] || magMatch[2];
    facts.push(`रिक्टर स्केलमा ${mag} तीव्रताको भूकम्प मापन गरिएको छ।`);
  }

  /* ── 6. Named person (minister, PM, chief) ── */
  const personMatch = text.match(
    /(?:Prime\s+Minister|PM|Minister|Chief\s+Minister|President|Governor|CM)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/
  );
  if (personMatch) {
    const name = personMatch[1].trim();
    /* Transliterate common Nepali names */
    const nameNe = transliterateName(name);
    facts.push(`${nameNe}ले यस विषयमा आफ्नो अडान स्पष्ट पारेका छन्।`);
  }

  /* ── 7. Affected area / district ── */
  const districtMatch = text.match(
    /(?:district(?:s)?|province|municipality|area|zone)\s+(?:of\s+)?([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)?)/i
  ) || text.match(/([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)?)\s+district/i);
  if (districtMatch) {
    const place = districtMatch[1].trim();
    facts.push(`${place} क्षेत्र विशेष रूपमा प्रभावित भएको बताइएको छ।`);
  }

  /* ── 8. Number of districts / houses / vehicles ── */
  const countMatch = text.match(/(\d+)\s+(?:districts?|provinces?|wards?)/i)
    || text.match(/(\d+)\s+(?:houses?|buildings?|homes?|structures?)\s+(?:damaged|destroyed|collapsed)/i)
    || text.match(/(\d+)\s+(?:vehicles?|buses?|trucks?|cars?)\s+(?:damaged|involved|caught)/i);
  if (countMatch && !tollMatch) {
    const n    = parseInt(countMatch[1]);
    const type = countMatch[0].toLowerCase();
    const typeNe = /district|province/.test(type) ? 'जिल्ला'
      : /house|building|home|structure/.test(type) ? 'घर÷संरचना'
      : /vehicle|bus|truck|car/.test(type) ? 'सवारी साधन' : 'एकाइ';
    if (n > 1) facts.push(`${n} ${typeNe} यस घटनाबाट प्रत्यक्ष प्रभावित भएका छन्।`);
  }

  /* Return unique, non-empty facts (max 3) */
  return [...new Set(facts)].slice(0, 3);
}

/* Simple name transliteration for very common Nepali political names */
function transliterateName(en) {
  const MAP = {
    'KP Sharma Oli': 'केपी शर्मा ओली', 'KP Oli': 'केपी ओली',
    'Pushpa Kamal Dahal': 'पुष्पकमल दाहाल', 'Prachanda': 'प्रचण्ड',
    'Sher Bahadur Deuba': 'शेर बहादुर देउवा',
    'Ram Chandra Paudel': 'रामचन्द्र पौडेल',
    'Bishnu Paudel': 'विष्णु पौडेल',
    'Balen Shah': 'बालेन साह', 'Balen': 'बालेन',
  };
  for (const [eng, ne] of Object.entries(MAP)) {
    if (en.toLowerCase().includes(eng.toLowerCase())) return ne;
  }
  return en; /* Return English if no match — still readable */
}

/**
 * Build a tight, factual 3-4 sentence Nepali description.
 * Priority:  real article sentences  >  extracted key facts  >  topic templates
 * @param {string} nepaliTitle  – translated Nepali title
 * @param {string} rawTitle     – original RSS headline
 * @param {string} articleBody  – full article text (or RSS body fallback)
 * @param {string} sourceLang   – 'ne' | 'en' | 'hi' | etc.
 */
/**
 * Strip author bylines, dates, timestamps, "Read more" links, and
 * other article metadata from body text before using it for description.
 * This prevents the template from outputting "By John Smith | April 14, 2025"
 * style noise as part of the description.
 */
function _cleanArticleText(text, rawTitle) {
  if (!text) return '';

  let t = text;

  /* ── 1. Strip the article's own title if it appears at the start of the body ──
     Nepali news sites often repeat the headline as the first line of the body.
     Compare first 120 chars of body with the raw title (normalised). */
  if (rawTitle) {
    const normTitle = rawTitle.replace(/\s+/g, '').toLowerCase().slice(0, 60);
    const normBody  = t.replace(/\s+/g, '').toLowerCase().slice(0, 80);
    if (normBody.startsWith(normTitle.slice(0, 30)) || normTitle.slice(0, 30) && normBody.includes(normTitle.slice(0, 30))) {
      /* Remove the first sentence/line that matches the title */
      t = t.replace(/^[^\n।]{0,200}[।\n]/, '');
    }
  }

  /* ── 2. Remove Nepali news header block — the single most common noise pattern ──
     Pattern: [optional section] [title text] [Nepali-month] [digits] [year] [weekday] [time] [city] [colon]
     Example: "विदेश नीतिश कुमारले दिए राजीनामा… अन्नपूर्ण वैशाख १, २०८३ मंगलबार २१:२१:५९ काठमाडौं :"
     This entire block up to and including the final colon is metadata — remove it. */
  const NEPALI_MONTHS  = 'बैशाख|जेठ|असार|श्रावण|भाद्र|आश्विन|कार्तिक|मंसिर|पुष|माघ|फाल्गुण|चैत्र';
  const NEPALI_WEEKDAYS= 'आइतबार|सोमबार|मंगलबार|बुधबार|बिहिबार|शुक्रबार|शनिबार';
  const NEPALI_DIGITS  = '[०-९\\d]';

  /* Pattern A: full header up to colon (greedily removes the whole metadata block) */
  t = t.replace(
    new RegExp(
      `[^।\\n]{0,120}(?:${NEPALI_MONTHS})\\s+${NEPALI_DIGITS}+[,،]?\\s*${NEPALI_DIGITS}*\\s*(?:${NEPALI_WEEKDAYS})?\\s*${NEPALI_DIGITS}*[:\\s${NEPALI_DIGITS}]*(?:काठमाडौं|पोखरा|ललितपुर|भक्तपुर|वीरगञ्ज|धरान|विराटनगर|नेपालगञ्ज|बुटवल|हेटौंडा|दाङ|सुर्खेत|जुम्ला|धनगढी|महेन्द्रनगर)?\\s*[:\\-।]?`,
      'g'
    ), ''
  );

  /* Pattern B: standalone Nepali weekday + time (२१:२१:५९) + optional city + colon */
  t = t.replace(new RegExp(`(?:${NEPALI_WEEKDAYS})\\s*[०-९\\d]{1,2}:[०-९\\d]{2}(?::[०-९\\d]{2})?\\s*(?:[\\u0900-\\u097F]{3,15}\\s*)?[:\\-]?`, 'g'), '');

  /* Pattern C: Nepali month + day + year block anywhere in text */
  t = t.replace(new RegExp(`(?:${NEPALI_MONTHS})\\s+[०-९\\d]+[,،]?\\s*[०-९\\d]{4}`, 'g'), '');

  /* Pattern D: Nepali 4-digit year alone (e.g. २०८३) */
  t = t.replace(/[२][०][७-९][०-९]/g, '');

  /* Pattern E: Nepali time pattern HH:MM or HH:MM:SS with Nepali/Arabic digits */
  t = t.replace(/[०-९\d]{1,2}:[०-९\d]{2}(?::[०-९\d]{2})?\s*(?:AM|PM|am|pm|बजे)?/g, '');

  /* ── 3. Section/category labels that appear as standalone words ──
     e.g. "विदेश", "राजनीति", "खेलकुद", "अर्थ", "समाज" at line start */
  t = t.replace(/^(?:विदेश|राजनीति|खेलकुद|अर्थ|समाज|स्वास्थ्य|प्रविधि|मनोरञ्जन|शिक्षा|पर्यटन|वातावरण|कानून|अपराध|दुर्घटना)\s*/gm, '');

  /* ── 4. Remove typical English byline patterns ── */
  t = t.replace(/^(?:by|reporter|correspondent|staff|author|written by|posted by)[:\s]+[^\n]{0,80}/gim, '');

  /* ── 5. Remove English date/time stamps ── */
  t = t.replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/gi, '');
  t = t.replace(/\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi, '');
  t = t.replace(/\b\d{4}[-\/]\d{2}[-\/]\d{2}\b/g, '');
  t = t.replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, '');
  t = t.replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b/g, '');

  /* ── 6. Remove "Published:", "Updated:" markers ── */
  t = t.replace(/(?:published|updated|last updated|posted|edited)[:\s]+[^\n]{0,60}/gi, '');

  /* ── 7. Remove photo/image captions ── */
  t = t.replace(/[\[\(](?:photo|image|pic|picture|video|source|credit|फोटो|तस्वीर)[:\s][^\]\)]{0,80}[\]\)]/gi, '');

  /* ── 8. Remove "Read more:", "Also read:", "Related:" cross-links ── */
  t = t.replace(/(?:read more|also read|related|see also|यो पनि पढ्नुस्|सम्बन्धित)[:\s]+[^\n]{0,150}/gi, '');

  /* ── 9. Remove social share / nav artifact lines ── */
  t = t.replace(/^[\s\W]{0,5}(?:share|follow|subscribe|like|comment|tweet|whatsapp|facebook|instagram|twitter|youtube)[\s\W]{0,5}$/gim, '');

  /* ── 10. Remove URLs ── */
  t = t.replace(/https?:\/\/[^\s]+/g, '');

  /* ── 11. Remove lines shorter than 30 chars (nav items, labels, stray metadata) ── */
  t = t.replace(/^.{1,30}$/gm, '');

  /* ── 12. Final whitespace cleanup ── */
  t = t.replace(/\n{3,}/g, '\n\n').replace(/\s{3,}/g, ' ').trim();

  /* ── 13. If the cleaned text still starts with a colon or dash — strip it ── */
  t = t.replace(/^[\s:।\-–—]+/, '').trim();

  return t;
}

async function buildDescription(nepaliTitle, rawTitle, articleBody, sourceLang = 'ne') {
  /* ── STEP 0: Strip author, date, bylines, nav noise from body ── */
  const cleanedBody = _cleanArticleText(articleBody || '', rawTitle);

  const combinedLower = (nepaliTitle + ' ' + rawTitle).toLowerCase();
  const topic = detectTopic(combinedLower) || detectNepaliTopic(nepaliTitle);
  const bodyIsNepali = /[\u0900-\u097F]{10,}/.test(cleanedBody);

  /* ── STEP 1: Translate body to Nepali if it's in another language ── */
  let nepaliBody = cleanedBody;
  if (!bodyIsNepali && nepaliBody.trim().length > 50) {
    nepaliBody = await translateBodyToNepali(nepaliBody, sourceLang);
  }

  /* ── STEP 2: Use the full cleaned body directly — no scoring filter ── */
  /* Split into sentences, strip pure noise lines, rejoin naturally */
  const allSentences = (nepaliBody.replace(/\n+/g, ' ').replace(/\s+/g, ' ').match(/[^.!?।]+[.!?।]+/g) || [])
    .map(s => s.trim())
    .filter(s => {
      if (s.length < 25) return false;
      if (/(?:read more|click here|share this|follow us|subscribe|यो खबर|सम्बन्धित|प्रतिक्रिया दिनुहोस्)/i.test(s)) return false;
      return true;
    });

  /* If sentence splitting worked, join them; else use body directly */
  let descText = allSentences.length >= 2
    ? allSentences.join(' ')
    : nepaliBody.trim();

  /* ── STEP 3: Fallback if still empty ── */
  if (!descText || descText.length < 40) {
    const extractedFacts = extractKeyFacts(rawTitle, cleanedBody);
    if (extractedFacts.length) {
      descText = extractedFacts.join(' ');
    } else {
      descText = topic
        ? (DESC_CONTEXT[topic] + ' ' + DESC_IMPACT[topic])
        : DESC_GENERIC_CONTEXT[Math.floor(Math.random() * DESC_GENERIC_CONTEXT.length)];
    }
  }

  /* ── STEP 4: Trim to max 300 words — keep as much as possible, cut at sentence boundary ── */
  return trimToWordTarget(descText.trim(), 80, 300);
}

/** Count words in a string (Nepali-aware: split on whitespace) */
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Trim a paragraph to be between minW and maxW words.
 * Cuts at sentence boundary where possible.
 */
function trimToWordTarget(text, minW, maxW) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxW) return text.trim();

  /* Find last sentence-ending punctuation within maxW words */
  let cutAt = maxW;
  for (let i = maxW - 1; i >= minW; i--) {
    if (/[।.!?]$/.test(words[i])) { cutAt = i + 1; break; }
  }
  return words.slice(0, cutAt).join(' ');
}

/**
 * Translate a non-Nepali article body to Nepali.
 * Splits into chunks ≤ 400 chars, translates each, rejoins.
 * Falls back gracefully if API fails — returns original text.
 */
async function translateBodyToNepali(body, srcLang) {
  /* Detect lang pair */
  const isHindi = /[\u0900-\u097F]/.test(body) && srcLang !== 'ne';
  const langpair = isHindi ? 'hi|ne' : 'en|ne';

  /* Take up to 1500 chars of the body for translation */
  const sample = body.slice(0, 1500).trim();

  /* Split into sentence-level chunks ≤ 400 chars */
  const rawSents = (sample.match(/[^.!?\n।]+[.!?\n।]*/g) || [sample])
    .map(s => s.trim()).filter(Boolean);

  const chunks = [];
  let cur = '';
  for (const s of rawSents) {
    if ((cur + ' ' + s).length > 380) {
      if (cur) chunks.push(cur.trim());
      cur = s;
    } else {
      cur = (cur ? cur + ' ' : '') + s;
    }
  }
  if (cur) chunks.push(cur.trim());

  /* Translate up to 4 chunks (to stay within API rate limits) */
  const translated = [];
  for (const chunk of chunks.slice(0, 4)) {
    try {
      const apiUrl = 'https://api.mymemory.translated.net/get?q='
        + encodeURIComponent(chunk) + '&langpair=' + langpair;
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(apiUrl, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) { translated.push(chunk); continue; }
      const data = await res.json();
      const t = (data.responseData?.translatedText || '').trim();
      const devChars = (t.match(/[\u0900-\u097F]/g) || []).length;
      /* Accept translation only if it contains enough Devanagari */
      translated.push(devChars > 5 ? t : chunk);
    } catch {
      translated.push(chunk);
    }
  }
  return translated.join(' ');
}

/**
 * Extract the most factual, informative sentences from the full article body.
 * Returns up to maxSents sentences sorted by score (highest first → re-ordered
 * to article sequence), with NO per-sentence char truncation — let the
 * final trimToWordTarget do the overall cut.
 */
function extractBestSentences(text, nepaliTitle, rawTitle, isNepali, maxSents) {
  if (!text || text.trim().length < 60) return [];

  const raw = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

  /* Split on Nepali (।) or Latin sentence endings */
  const sents = (raw.match(/[^.!?।]+[.!?।]+/g) || [])
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => {
      if (s.length < 30) return false;              /* skip stub lines */
      /* Skip obvious noise */
      if (/(?:read more|click here|share this|follow us|subscribe|यो खबर|थप जानकारी|सम्बन्धित|प्रतिक्रिया दिनुहोस्)/i.test(s)) return false;
      /* Skip bare time stamps like "मंगलबार २१:२१" with no substance */
      if (/^[^क-ह a-zA-Z]*[०-९\d]{1,2}:[०-९\d]{2}[^क-ह a-zA-Z]*$/.test(s)) return false;
      return true;
    });

  if (!sents.length) return [];

  /* Score each sentence for informational value */
  const titleWordsLower = new Set(
    (rawTitle + ' ' + nepaliTitle).toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );

  const scored = sents.map((s, idx) => {
    const sl = s.toLowerCase();
    let score = 0;

    /* ── HIGH-VALUE signals ── */
    const numMatches = (s.match(/\d+/g) || []).length;
    score += Math.min(numMatches, 4) * 2;                                         /* arabic numbers */
    if (/[०-९]/.test(s))                                                           score += 3;  /* Nepali numerals */
    if (/(?:रु\.|rs\.|%|करोड|लाख|अर्ब|crore|lakh|million|billion)/i.test(s))     score += 4;  /* money/amounts */
    if (/(?:मृत्यु|घाइते|मारिए|मारियो|killed|dead|injured|died|casualt)/i.test(s)) score += 6; /* casualties */
    if (/(?:पक्राउ|गिरफ्तार|बर्खास्त|arrested|dismissed|resign|fired)/i.test(s)) score += 5;  /* key actions */
    if (/(?:विस्फोट|explosion|blast|आगलागी|fire|बाढी|flood|भूकम्प|quake)/i.test(s)) score += 5; /* disaster */
    if (/(?:मन्त्री|प्रधानमन्त्री|अध्यक्ष|राष्ट्रपति|minister|president|chief|pm\b)/i.test(s)) score += 4;
    if (/(?:आयोग|सरकार|मन्त्रालय|प्रहरी|अदालत|government|court|police|army)/i.test(s)) score += 3;
    if (/(?:कारण|फलस्वरूप|अनुसार|because|due to|according|following|after)/i.test(s)) score += 3;
    if (/(?:सिफारिस|माग|आदेश|demanded|ordered|recommended|issued|declared)/i.test(s)) score += 3;
    if (/(?:जिल्ला|नगर|गाउँ|district|municipality|province|काठमाडौं|Kathmandu)/i.test(s)) score += 2; /* location */
    /* Reward longer sentences — they carry more information */
    if (s.length > 120) score += 2;
    if (s.length > 200) score += 2;

    /* ── PENALTY signals ── */
    const sentW = new Set(sl.split(/\s+/).filter(w => w.length > 3));
    const titleOverlap = [...sentW].filter(w => titleWordsLower.has(w)).length / Math.max(sentW.size, 1);
    if (titleOverlap > 0.60) score -= 5;  /* too similar to title */
    if (s.length < 45)       score -= 3;  /* too short to be informative */
    if (idx === 0)           score -= 1;  /* first sentence often is the headline reworded */

    return { s, score, idx };
  });

  /* Sort by score, take top N */
  const MAX = Math.min(maxSents, 8);
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter(x => x.score >= 0).slice(0, MAX);

  /* Re-order to match original article flow (reads naturally) */
  top.sort((a, b) => a.idx - b.idx);

  /* Return full sentences — NO per-sentence truncation; trimToWordTarget handles overall length */
  return top.map(({ s }) => /[।.!?]$/.test(s) ? s : s + '।');
}

function detectNepaliTopic(text) {
  const t = text;
  if (t.includes('बाढी') || t.includes('पहिरो') || t.includes('वर्षा')) return 'flood';
  if (t.includes('भूकम्प'))          return 'earthquake';
  if (t.includes('निर्वाचन') || t.includes('मतदान')) return 'election';
  if (t.includes('सरकार') || t.includes('प्रधानमन्त्री') || t.includes('मन्त्री')) return 'government';
  if (t.includes('स्वास्थ्य') || t.includes('अस्पताल'))  return 'health';
  if (t.includes('दुर्घटना') || t.includes('सडक'))       return 'accident';
  if (t.includes('शिक्षा') || t.includes('विद्यार्थी')) return 'education';
  if (t.includes('प्रहरी') || t.includes('अपराध'))       return 'police';
  if (t.includes('क्रिकेट'))         return 'cricket';
  if (t.includes('फुटबल'))           return 'football';
  if (t.includes('आगलागी'))          return 'fire';
  if (t.includes('पर्यटन'))          return 'tourism';
  if (t.includes('मूल्य') || t.includes('रुपैयाँ') || t.includes('अर्थ')) return 'economy';
  return null;
}

/* ── Hashtags ────────────────────────────────────────────────── */
const NEPAL_HASHTAGS = [
  '#नेपालसमाचार', '#ब्रेकिङन्यूज', '#काठमाडौं', '#नेपालअपडेट',
  '#NepalNews', '#BreakingNews', '#Nepal', '#Kathmandu',
  '#नेपाल', '#अनलाइनखबर', '#NepalTrending', '#नेपालट्रेन्डिङ',
];
const TOPIC_HASHTAGS = {
  flood      : ['#नेपालबाढी', '#FloodNepal', '#मनसुन', '#Monsoon'],
  rain       : ['#मनसुन', '#Monsoon', '#वर्षा', '#NepalWeather'],
  earthquake : ['#भूकम्प', '#Earthquake', '#NepalEarthquake', '#सुरक्षितरहनुस्'],
  election   : ['#नेपालनिर्वाचन', '#NepalElection', '#मतदान', '#लोकतन्त्र'],
  economy    : ['#नेपालअर्थतन्त्र', '#NepalEconomy', '#वित्त', '#राष्ट्रबैंक'],
  police     : ['#नेपालप्रहरी', '#NepalPolice', '#Crime'],
  health     : ['#स्वास्थ्यसतर्कता', '#HealthAlert', '#नेपालस्वास्थ्य'],
  cricket    : ['#नेपालक्रिकेट', '#NepalCricket', '#क्रिकेट'],
  football   : ['#नेपालफुटबल', '#NepalFootball', '#Football'],
  education  : ['#शिक्षा', '#Education', '#नेपालशिक्षा'],
  road       : ['#नेपालसडक', '#ट्राफिकसतर्कता', '#TrafficAlert'],
  fire       : ['#आगलागी', '#Fire', '#NepalEmergency'],
  accident   : ['#दुर्घटना', '#Accident', '#सडकसुरक्षा'],
  government : ['#सरकार', '#Government', '#नेपालसरकार', '#NepalGovt'],
  politics   : ['#राजनीति', '#Politics', '#नेपालराजनीति'],
  tourism    : ['#पर्यटन', '#Tourism', '#VisitNepal'],
};

/**
 * Build dynamic hashtags from the actual article content.
 * Priority:
 *  1. Named entity tags — proper nouns extracted from title + body
 *  2. Topic-specific tags — matched from TOPIC_HASHTAGS
 *  3. Location tags — districts, cities, provinces found in text
 *  4. Base Nepal tags — fill remaining slots
 *  Always ends with #ShashiNewsGen
 */
function buildHashtags(title, articleBody = '') {
  const combined = (title + ' ' + articleBody).slice(0, 1200);
  const lower    = combined.toLowerCase();
  const tags     = new Set();

  /* ── 1. NAMED ENTITY extraction from title + body ── */

  /* People — capitalized English names (2+ words) or Nepali name-like patterns */
  const engNames = combined.match(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g) || [];
  engNames.slice(0, 3).forEach(name => {
    const tag = '#' + name.replace(/\s+/g, '');
    if (tag.length > 4 && tag.length < 30) tags.add(tag);
  });

  /* Nepali named words — 3+ Devanagari chars that are title-case in the title portion */
  const nepTitle = title.replace(/\s+/g, ' ').trim();
  const nepWords = nepTitle.match(/[\u0900-\u097F]{3,}/g) || [];
  /* Key content words from title (skip filler words) */
  const nepaliFiller = new Set(['भएको','गरेको','गर्ने','छ।','हुने','गरी','बाट','लाई','मा','को','र','पनि','भए','भन्ने','गर्दा','गएको','आएको','रहेको','सम्म']);
  nepWords
    .filter(w => w.length >= 4 && !nepaliFiller.has(w))
    .slice(0, 4)
    .forEach(w => tags.add('#' + w));

  /* ── 2. LOCATION extraction — Nepali districts, cities, provinces ── */
  const LOCATIONS = [
    ['काठमाडौं','#काठमाडौं'],['ललितपुर','#ललितपुर'],['भक्तपुर','#भक्तपुर'],
    ['पोखरा','#पोखरा'],['चितवन','#चितवन'],['बुटवल','#बुटवल'],
    ['बिराटनगर','#बिराटनगर'],['धरान','#धरान'],['जनकपुर','#जनकपुर'],
    ['नेपालगन्ज','#नेपालगन्ज'],['सुर्खेत','#सुर्खेत'],['दाङ','#दाङ'],
    ['कास्की','#कास्की'],['मकवानपुर','#मकवानपुर'],['रुपन्देही','#रुपन्देही'],
    ['सिन्धुपाल्चोक','#सिन्धुपाल्चोक'],['गण्डकी','#गण्डकी'],['लुम्बिनी','#लुम्बिनी'],
    ['कर्णाली','#कर्णाली'],['सुदूरपश्चिम','#सुदूरपश्चिम'],['बागमती','#बागमती'],
    ['Kathmandu','#Kathmandu'],['Pokhara','#Pokhara'],['Chitwan','#Chitwan'],
    ['Butwal','#Butwal'],['Biratnagar','#Biratnagar'],['Janakpur','#Janakpur'],
    /* India/International if mentioned */
    ['भारत','#भारत'],['India','#India'],['Delhi','#Delhi'],['China','#China'],
    ['चीन','#चीन'],['अमेरिका','#America'],['US ','#USA'],
  ];
  LOCATIONS.forEach(([kw, tag]) => {
    if (combined.includes(kw)) tags.add(tag);
  });

  /* ── 3. ORGANIZATION extraction ── */
  const ORGS = [
    ['सरकार','#नेपालसरकार'],['प्रहरी','#नेपालप्रहरी'],['सेना','#नेपालीसेना'],
    ['अदालत','#सर्वोच्चअदालत'],['संसद','#संसद'],['राष्ट्रपति','#राष्ट्रपति'],
    ['प्रधानमन्त्री','#प्रधानमन्त्री'],['मन्त्री','#मन्त्रिपरिषद'],
    ['आयोग','#आयोग'],['विश्वविद्यालय','#विश्वविद्यालय'],
    ['राष्ट्र बैंक','#राष्ट्रबैंक'],['बैंक','#NepalBanking'],
    ['Police','#NepalPolice'],['Government','#NepalGovt'],['Army','#NepalArmy'],
    ['Court','#SupremeCourt'],['Parliament','#NepalParliament'],
  ];
  ORGS.forEach(([kw, tag]) => {
    if (combined.includes(kw) && tags.size < 8) tags.add(tag);
  });

  /* ── 4. TOPIC-SPECIFIC tags ── */
  for (const [key, topicTags] of Object.entries(TOPIC_HASHTAGS)) {
    if (lower.includes(key) && tags.size < 9) {
      topicTags.slice(0, 2).forEach(t => tags.add(t));
    }
  }

  /* ── 5. Fill remaining slots with base Nepal tags ── */
  for (const baseTag of NEPAL_HASHTAGS) {
    if (tags.size >= 10) break;
    tags.add(baseTag);
  }

  /* ── 6. Always end with brand tag ── */
  const filtered = [...tags]
    .filter(h => h.toLowerCase() !== '#shashinewsgen')
    .slice(0, 10);

  return [...filtered, '#ShashiNewsGen'];
}

/* ================================================================
   HASHTAG EDITOR — interactive chips (toggle off/on, add, remove, regenerate)
================================================================ */

/**
 * Render hashtag chips into #outHashtags.
 * Each chip stores its active state as a data-active attribute.
 * Clicking toggles it; the × button removes it entirely.
 * generatedPost.hashtags is kept in sync after every change.
 */
function renderHashtags(tags) {
  const container = document.getElementById('outHashtags');
  container.innerHTML = tags.map((h, i) => `
    <span class="hashtag" data-index="${i}" data-tag="${escHtml(h)}" data-active="true"
          onclick="toggleHashtag(this)" title="Click to toggle">
      ${escHtml(h)}<span class="ht-remove" onclick="removeHashtag(event,this)" title="Remove">✕</span>
    </span>`).join('');
  syncHashtagsToPost();
}

/** Toggle a hashtag chip on/off (struck-through = excluded from post) */
function toggleHashtag(el) {
  const active = el.dataset.active === 'true';
  el.dataset.active = active ? 'false' : 'true';
  el.classList.toggle('off', !active ? false : true);
  syncHashtagsToPost();
}

/** Remove a hashtag chip entirely */
function removeHashtag(e, removeBtn) {
  e.stopPropagation();
  removeBtn.closest('.hashtag').remove();
  syncHashtagsToPost();
}

/** Show/hide the custom hashtag input row */
function toggleHashtagInput(show) {
  document.getElementById('hashtagAddRow').style.display = show ? 'flex' : 'none';
  document.getElementById('hashtagAddBtn').style.display = show ? 'none' : 'inline-block';
  if (show) {
    const inp = document.getElementById('hashtagInput');
    inp.value = '';
    inp.focus();
  }
}

/** Add a custom hashtag typed by the user */
function addCustomHashtag() {
  let val = document.getElementById('hashtagInput').value.trim();
  if (!val) return;
  if (!val.startsWith('#')) val = '#' + val;
  val = val.replace(/\s+/g, '');          // no spaces in hashtags
  if (val.length < 2) return;

  const container = document.getElementById('outHashtags');
  const span = document.createElement('span');
  span.className = 'hashtag';
  span.dataset.active = 'true';
  span.dataset.tag = val;
  span.title = 'Click to toggle';
  span.setAttribute('onclick', 'toggleHashtag(this)');
  span.innerHTML = `${escHtml(val)}<span class="ht-remove" onclick="removeHashtag(event,this)" title="Remove">✕</span>`;
  container.appendChild(span);

  syncHashtagsToPost();
  toggleHashtagInput(false);
  toast(`✅ ${val} added`, 'success', 1800);
}

/** Read all active (non-struck) chips and push them into generatedPost */
function syncHashtagsToPost() {
  const chips = document.querySelectorAll('#outHashtags .hashtag');
  const active = Array.from(chips)
    .filter(c => c.dataset.active === 'true')
    .map(c => c.dataset.tag);
  if (generatedPost) generatedPost.hashtags = active;
}

/** Regenerate hashtags with AI (or fallback keyword method) */
async function regenerateHashtags() {
  if (!generatedPost) { toast('⚠️ Generate a post first.', 'error'); return; }
  const btn = document.getElementById('reimagineBtnHashtags');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:2px"></span>';

  try {
    let newTags;
    if ((_geminiKey || _browserGeminiKey || _browserGroqKey) && selectedArticle) {
      const articleBody = (selectedArticle.fullArticleText || selectedArticle.description || '').replace(/\s+/g, ' ').slice(0, 800);
      const prompt = `You are a Nepali social media expert who knows trending hashtags.

NEWS STORY:
Title: ${selectedArticle.title}
Body: ${articleBody}

TASK: Generate exactly 8 hashtags for THIS specific news story to maximise reach on Facebook, Instagram, and Twitter/X.

RULES:
1. At least 4 hashtags must be SPECIFIC to this story — use the actual person's name, place name, organisation, or event keyword from the story
2. Remaining tags can be broader topic categories (politics, sports, economy etc.)
3. Mix Nepali Devanagari and English (aim for 4 Nepali + 4 English)
4. Each hashtag starts with # and has NO spaces or special characters inside
5. FORBIDDEN generic tags: #Nepal #नेपाल #NepalNews #नेपालसमाचार #BreakingNews #Kathmandu #News #Trending (avoid these unless directly relevant)
6. Make them the tags a real journalist or influencer would actually use for this story
7. Return ONLY a JSON array of exactly 8 strings — no markdown, no explanation

Example format: ["#RealTag1","#वास्तविकट्याग2","#SpecificTopic","#सम्बन्धितविषय","#ActualPerson","#स्थान","#EventKeyword","#TopicCategory"]`;

      /* callAI returns a parsed object or array, or throws */
      const result = await callAI(prompt, 15000);
      /* Gemini may return an array directly, or wrap it in an object */
      let arr = null;
      if (Array.isArray(result)) {
        arr = result;
      } else if (result && typeof result === 'object') {
        /* Try common wrapper keys: "hashtags", "tags", or the first array value */
        arr = result.hashtags || result.tags || Object.values(result).find(v => Array.isArray(v));
      }
      if (arr && arr.length) {
        newTags = arr.slice(0, 8).map(h => (typeof h === 'string' && h.startsWith('#')) ? h : '#' + String(h));
      }
    }
    if (!newTags || newTags.length < 3) {
      /* Fallback: keyword method */
      newTags = buildHashtags((selectedArticle?.title || '') + ' ' + (generatedPost?.title || ''), selectedArticle?.fullArticleText || selectedArticle?.description || '');
    }
    renderHashtags(newTags);
    toast('✅ Hashtags regenerated!', 'success', 2000);
  } catch (e) {
    console.error('[regenerateHashtags]', e);
    toast('⚠️ Could not regenerate hashtags.', 'error', 3000);
  }

  btn.disabled = false;
  btn.innerHTML = '✨ Regenerate';
}

/* ================================================================
   FEATURE 3b – AI IMAGE ENHANCEMENT (Remove.bg + Canvas Backgrounds)
   Removes the background from the uploaded photo via Remove.bg API,
   then composites the subject onto a freshly drawn news-themed
   canvas background. The result is a fully original derived work.
================================================================ */

/** Toggle the background-style picker panel */
function toggleBgPicker() {
  if (!_activeImageDataUrl) {
    toast('⚠️ Generate an image first.', 'error'); return;
  }
  if (!_removebgKey) {
    toast('⚙️ Add your free Remove.bg API key in ⚙️ Setup AI → Remove.bg Key.', 'error', 6000); return;
  }
  const picker = document.getElementById('bgStylePicker');
  picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

/** Called when a background style tile is clicked */
function selectBgStyle(id) {
  _selectedBgStyle = id;
  document.querySelectorAll('.bg-style-tile').forEach(t => t.classList.remove('active'));
  document.getElementById('bgtile-' + id)?.classList.add('active');
  /* If already in enhanced mode, instantly preview the new background */
  if (_enhancedMode && _subjectImg) redrawEnhanced();
}

/**
 * Main AI image enhancement entry point.
 * 1. Calls Remove.bg to strip the background from the uploaded photo.
 * 2. Caches the subject PNG, sets _enhancedMode = true.
 * 3. Delegates all canvas drawing to redrawEnhanced() so that
 *    zoom / pan changes can re-invoke the same draw path.
 */
async function enhanceImageWithAI() {
  if (!_activeImageDataUrl) {
    toast('⚠️ Generate an image first.', 'error'); return;
  }
  if (!_removebgKey) {
    toast('⚙️ Add your free Remove.bg API key in ⚙️ Setup AI → Remove.bg Key.', 'error', 6000); return;
  }

  const btn = document.getElementById('enhanceAIBtn');
  const origHTML = btn.innerHTML;
  btn.innerHTML  = '<span class="spinner" style="width:13px;height:13px;border-width:2px"></span> Removing BG…';
  btn.disabled   = true;
  toast('🤖 AI removing background… please wait (5-15s)', 'info', 15000);

  try {
    /* ── Step 1: Remove background via Remove.bg (cached) ── */
    if (!_subjectDataUrl) {
      _subjectDataUrl = await removeBackground(_activeImageDataUrl);
    }

    /* ── Step 2: Pre-load subject image into a cached Image object ── */
    _subjectImg = await loadImageFromSrc(_subjectDataUrl, 12000);

    /* ── Step 3: Enter enhanced mode & draw ── */
    _enhancedMode = true;
    redrawEnhanced();

    toast('✨ AI enhancement done! Drag the green handles to move/resize the subject.', 'success', 5000);

  } catch (err) {
    console.error('[EnhanceAI]', err);
    _enhancedMode    = false;
    _mainImgSprite   = null;
    _mainImgSelected = false;
    toast('❌ AI enhance failed: ' + err.message, 'error', 6000);
  }

  btn.innerHTML = origHTML;
  btn.disabled  = false;
}

/**
 * Synchronously redraws the AI-enhanced canvas using the cached
 * subject image (_subjectImg) and current imgScale / imgOffsetX / imgOffsetY.
 * Called by enhanceImageWithAI() and also by onImgAdjust() / panImage()
 * whenever _enhancedMode is true.
 */
async function redrawEnhanced() {
  if (!_subjectImg || !_enhancedMode) return;

  const canvas = document.getElementById('newsCanvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  /* ── Initialise the main-image sprite if not yet created ── */
  if (!_mainImgSprite) {
    const baseScale = Math.min(CANVAS_W / _subjectImg.width, CANVAS_H / _subjectImg.height);
    const sw = _subjectImg.width  * baseScale;
    const sh = _subjectImg.height * baseScale;
    _mainImgSprite = {
      x: (CANVAS_W - sw) / 2,
      y: (CANVAS_H - sh) / 2,
      w: sw, h: sh, rot: 0
    };
  }

  /* ── Draw chosen AI background ── */
  drawAIBackground(ctx, _selectedBgStyle, CANVAS_W, CANVAS_H);

  /* ── Composite subject using sprite position ── */
  const sp = _mainImgSprite;
  ctx.save();
  ctx.translate(sp.x + sp.w / 2, sp.y + sp.h / 2);
  ctx.rotate(sp.rot);
  ctx.shadowColor   = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur    = 38;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(_subjectImg, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
  ctx.restore();

  /* Re-layer composite side images on top of the AI background */
  if (_compositeMode && _sideSprites.length > 0) {
    _drawSpritesOnCtx(ctx);
  }

  /* ── Banner always drawn LAST over all images/sprites ── */
  _drawNewsBanner(ctx, CANVAS_W);
  if (generatedPost) await drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
  /* Extra custom text labels */
  _drawExtraTexts(ctx, CANVAS_W, CANVAS_H);

  /* Redraw all selection handles (main image + sprites + texts) */
  _drawCompositeHandles();

  /* Show handle canvas whenever enhanced mode is active */
  _showCompositeHandles(true);

  /* Update badge */
  document.getElementById('imgSourceBadge').textContent =
    '🤖 AI Enhanced · ' + (BG_STYLES.find(b => b.id === _selectedBgStyle)?.label || '');
  document.getElementById('imgAdjustBar').style.display = 'block';
}

/**
 * Call Remove.bg API to strip the background from a base64 image.
 * Returns a data-URL of the transparent-background PNG.
 */
async function removeBackground(dataUrl) {
  /* Convert base64 data-URL to a Blob for multipart upload */
  const res0    = await fetch(dataUrl);
  const blob    = await res0.blob();
  const formData = new FormData();
  formData.append('image_file', blob, 'photo.jpg');
  formData.append('size', 'auto');

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 30000);

  const res = await fetch(_removebgProxyBase || 'https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    /* Localhost: proxy injects the key from .env (no key in browser).
       GitHub Pages: send the browser-stored key directly. */
    headers: _removebgProxyBase ? {} : { 'X-Api-Key': _browserRemovebgKey },
    body: formData,
    signal: ctrl.signal,
  });
  clearTimeout(tid);

  if (!res.ok) {
    const errText = await res.text().catch(() => res.status);
    throw new Error(`Remove.bg error ${res.status}: ${errText}`);
  }

  const resultBlob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(resultBlob);
  });
}

/**
 * Draw a rich, fully-original canvas background for the chosen style.
 * All backgrounds are drawn programmatically — zero external images,
 * zero copyright risk.
 */
function drawAIBackground(ctx, styleId, W, H) {
  ctx.clearRect(0, 0, W, H);
  switch (styleId) {
    case 'newsroom':   _bgNewsroom(ctx, W, H);   break;
    case 'parliament': _bgParliament(ctx, W, H); break;
    case 'mountains':  _bgMountains(ctx, W, H);  break;
    case 'city':       _bgCity(ctx, W, H);        break;
    case 'breaking':   _bgBreaking(ctx, W, H);   break;
    case 'press':      _bgPress(ctx, W, H);       break;
    case 'field':      _bgField(ctx, W, H);       break;
    case 'digital':    _bgDigital(ctx, W, H);     break;
    default:           _bgNewsroom(ctx, W, H);
  }
}

function _bgNewsroom(ctx, W, H) {
  /* Dark studio — deep charcoal with red-lit edges */
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,   '#0d0d0d');
  bg.addColorStop(0.5, '#1a0505');
  bg.addColorStop(1,   '#0a0a1a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  /* Bokeh circles — simulated studio lights */
  const lights = [
    {x:.15,y:.2,r:120,c:'rgba(229,62,62,0.18)'}, {x:.85,y:.15,r:100,c:'rgba(229,62,62,0.14)'},
    {x:.5, y:.05,r:80, c:'rgba(246,173,85,0.10)'},{x:.05,y:.6,r:70, c:'rgba(59,130,246,0.10)'},
    {x:.95,y:.7,r:90, c:'rgba(59,130,246,0.08)'},
  ];
  lights.forEach(l => {
    const g = ctx.createRadialGradient(l.x*W, l.y*H, 0, l.x*W, l.y*H, l.r);
    g.addColorStop(0, l.c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  });
  /* Floor reflection line */
  ctx.fillStyle = 'rgba(229,62,62,0.08)'; ctx.fillRect(0, H*.68, W, H*.32);
  const flr = ctx.createLinearGradient(0, H*.68, 0, H);
  flr.addColorStop(0,'rgba(229,62,62,0.15)'); flr.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = flr; ctx.fillRect(0, H*.68, W, H*.32);
}

function _bgParliament(ctx, W, H) {
  /* Warm marble-toned official backdrop */
  const sky = ctx.createLinearGradient(0, 0, 0, H*.6);
  sky.addColorStop(0,'#1a1a2e'); sky.addColorStop(1,'#2d1b4e');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  /* Column silhouettes */
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 7; i++) {
    const cx = W * (0.05 + i * 0.145);
    ctx.fillRect(cx, H*.1, 32, H*.7);
    /* Capital */
    ctx.fillRect(cx - 10, H*.1, 52, 18);
  }
  /* Pediment triangle */
  ctx.beginPath(); ctx.moveTo(W*.1,H*.1); ctx.lineTo(W*.9,H*.1); ctx.lineTo(W*.5,H*.0);
  ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();

  /* Ground */
  const gnd = ctx.createLinearGradient(0, H*.75, 0, H);
  gnd.addColorStop(0,'#2d1b4e'); gnd.addColorStop(1,'#0d0d1a');
  ctx.fillStyle = gnd; ctx.fillRect(0, H*.75, W, H*.25);
  /* Ambient purple glow */
  const glow = ctx.createRadialGradient(W/2, H*.75, 0, W/2, H*.75, W*.55);
  glow.addColorStop(0,'rgba(139,92,246,0.22)'); glow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
}

function _bgMountains(ctx, W, H) {
  /* Himalayan dawn sky */
  const sky = ctx.createLinearGradient(0, 0, 0, H*.55);
  sky.addColorStop(0,'#0c0c2a'); sky.addColorStop(.5,'#1a3a6b'); sky.addColorStop(1,'#4a8fc7');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H*.55);

  /* Sun glow */
  const sun = ctx.createRadialGradient(W*.5, H*.42, 0, W*.5, H*.42, W*.35);
  sun.addColorStop(0,'rgba(255,200,80,0.45)'); sun.addColorStop(.5,'rgba(255,140,40,0.2)'); sun.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);

  /* Back mountains (snowy) */
  ctx.fillStyle = '#d0dff0';
  _drawMountainRange(ctx, W, H, [{x:.0,y:.45},{x:.15,y:.28},{x:.3,y:.22},{x:.5,y:.18},{x:.65,y:.24},{x:.8,y:.3},{x:1,y:.42}]);
  /* Mid mountains */
  ctx.fillStyle = '#4a6fa5';
  _drawMountainRange(ctx, W, H, [{x:.0,y:.55},{x:.2,y:.38},{x:.4,y:.32},{x:.6,y:.38},{x:.8,y:.35},{x:1,y:.5}]);
  /* Foreground hills */
  const fgGrad = ctx.createLinearGradient(0, H*.5, 0, H);
  fgGrad.addColorStop(0,'#1a3a1a'); fgGrad.addColorStop(1,'#0a1a0a');
  ctx.fillStyle = fgGrad;
  _drawMountainRange(ctx, W, H, [{x:.0,y:.7},{x:.25,y:.58},{x:.5,y:.62},{x:.75,y:.55},{x:1,y:.68}]);
  /* Ground */
  ctx.fillStyle = '#0a1a0a'; ctx.fillRect(0, H*.68, W, H*.32);
}

function _drawMountainRange(ctx, W, H, pts) {
  ctx.beginPath(); ctx.moveTo(0, H);
  pts.forEach(p => ctx.lineTo(p.x * W, p.y * H));
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
}

function _bgCity(ctx, W, H) {
  /* Golden hour city sky */
  const sky = ctx.createLinearGradient(0, 0, 0, H*.6);
  sky.addColorStop(0,'#0d0d1a'); sky.addColorStop(.4,'#1a2040'); sky.addColorStop(.8,'#8b4513'); sky.addColorStop(1,'#d4691e');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  /* Sun */
  const sun = ctx.createRadialGradient(W*.65, H*.52, 0, W*.65, H*.52, 80);
  sun.addColorStop(0,'rgba(255,230,100,0.9)'); sun.addColorStop(.4,'rgba(255,160,40,0.5)'); sun.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);

  /* City buildings silhouette */
  ctx.fillStyle = '#0a0a14';
  const buildings = [
    {x:.0,w:.08,h:.55},{x:.08,w:.05,h:.42},{x:.13,w:.07,h:.62},{x:.2,w:.04,h:.38},
    {x:.24,w:.09,h:.70},{x:.33,w:.05,h:.50},{x:.38,w:.06,h:.45},{x:.44,w:.08,h:.65},
    {x:.52,w:.05,h:.40},{x:.57,w:.07,h:.58},{x:.64,w:.04,h:.35},{x:.68,w:.09,h:.72},
    {x:.77,w:.05,h:.48},{x:.82,w:.06,h:.55},{x:.88,w:.07,h:.42},{x:.95,w:.05,h:.60},
  ];
  buildings.forEach(b => {
    const bx = b.x*W, bw = b.w*W, bh = b.h*H, by = H*(1-b.h);
    ctx.fillRect(bx, by, bw, bh);
    /* Windows */
    ctx.fillStyle = 'rgba(255,220,100,0.35)';
    for (let wy = by+10; wy < H-20; wy += 22) {
      for (let wx = bx+5; wx < bx+bw-8; wx += 14) {
        if (Math.random() > 0.4) ctx.fillRect(wx, wy, 7, 10);
      }
    }
    ctx.fillStyle = '#0a0a14';
  });

  /* Ground glow */
  const gnd = ctx.createLinearGradient(0, H*.7, 0, H);
  gnd.addColorStop(0,'rgba(212,105,30,0.3)'); gnd.addColorStop(1,'rgba(0,0,0,0.95)');
  ctx.fillStyle = gnd; ctx.fillRect(0, H*.7, W, H*.3);
}

function _bgBreaking(ctx, W, H) {
  /* High-impact red/black diagonal */
  ctx.fillStyle = '#0a0000'; ctx.fillRect(0, 0, W, H);
  const diag = ctx.createLinearGradient(0, 0, W, H);
  diag.addColorStop(0,'rgba(200,0,0,0.5)'); diag.addColorStop(.5,'rgba(100,0,0,0.2)'); diag.addColorStop(1,'rgba(200,0,0,0.45)');
  ctx.fillStyle = diag; ctx.fillRect(0, 0, W, H);

  /* Grid lines */
  ctx.strokeStyle = 'rgba(229,62,62,0.12)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 54) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 54) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  /* Central radial blast */
  const blast = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W*.6);
  blast.addColorStop(0,'rgba(229,62,62,0.3)'); blast.addColorStop(.5,'rgba(180,0,0,0.1)'); blast.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = blast; ctx.fillRect(0, 0, W, H);

  /* Diagonal accent bars */
  ctx.save(); ctx.translate(W/2, H/2); ctx.rotate(Math.PI/6);
  ctx.fillStyle = 'rgba(229,62,62,0.06)';
  for (let i = -8; i < 8; i += 2) ctx.fillRect(i*80 - 20, -H, 30, H*2);
  ctx.restore();
}

function _bgPress(ctx, W, H) {
  /* Navy press conference with podium glow */
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0,'#050d1f'); bg.addColorStop(.6,'#0a1a3a'); bg.addColorStop(1,'#050d1f');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  /* Spot light from above-center */
  const spot = ctx.createRadialGradient(W/2, 0, 0, W/2, 0, H*.9);
  spot.addColorStop(0,'rgba(59,130,246,0.35)'); spot.addColorStop(.5,'rgba(30,60,150,0.15)'); spot.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = spot; ctx.fillRect(0, 0, W, H);

  /* Horizontal rule lines (press backdrop) */
  ctx.strokeStyle = 'rgba(59,130,246,0.15)'; ctx.lineWidth = 2;
  for (let y = H*.15; y < H*.8; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  /* Flag-stripe left/right */
  ctx.fillStyle = 'rgba(229,62,62,0.25)'; ctx.fillRect(0, 0, 12, H);
  ctx.fillStyle = 'rgba(59,130,246,0.25)'; ctx.fillRect(W-12, 0, 12, H);

  /* Ground shadow */
  const gnd = ctx.createLinearGradient(0, H*.72, 0, H);
  gnd.addColorStop(0,'rgba(0,0,0,0)'); gnd.addColorStop(1,'rgba(0,0,0,0.9)');
  ctx.fillStyle = gnd; ctx.fillRect(0, H*.72, W, H*.28);
}

function _bgField(ctx, W, H) {
  /* Rural Nepal — terraced hillside */
  const sky = ctx.createLinearGradient(0, 0, 0, H*.45);
  sky.addColorStop(0,'#0d1f3a'); sky.addColorStop(.7,'#1a6b8a'); sky.addColorStop(1,'#5ab5d4');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H*.45);

  /* Clouds */
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  [[W*.15,H*.18,90,30],[W*.4,H*.12,130,25],[W*.7,H*.2,100,22],[W*.88,H*.15,70,18]].forEach(([cx,cy,rw,rh]) => {
    ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI*2); ctx.fill();
  });

  /* Terraced fields — layers of green */
  const greens = ['#1a4a0a','#1e5a0c','#228b22','#2e7d32','#1b5e20','#33691e'];
  for (let i = 0; i < 6; i++) {
    const y = H * (.45 + i * .09);
    ctx.fillStyle = greens[i];
    ctx.beginPath(); ctx.moveTo(0, y + 20*Math.sin(i)); ctx.bezierCurveTo(W*.3, y-15, W*.7, y+10, W, y+5);
    ctx.lineTo(W, y+H*.1); ctx.lineTo(0, y+H*.1); ctx.closePath(); ctx.fill();
  }
  /* Atmospheric haze */
  const haze = ctx.createLinearGradient(0, H*.4, 0, H*.65);
  haze.addColorStop(0,'rgba(200,230,255,0.12)'); haze.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = haze; ctx.fillRect(0, H*.4, W, H*.25);
}

function _bgDigital(ctx, W, H) {
  /* Futuristic digital data grid */
  ctx.fillStyle = '#020812'; ctx.fillRect(0, 0, W, H);

  /* Glowing grid */
  ctx.strokeStyle = 'rgba(0,200,255,0.08)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  /* Floating data particles */
  ctx.fillStyle = 'rgba(0,200,255,0.25)';
  const seed = 42; /* deterministic */
  for (let i = 0; i < 80; i++) {
    const px = ((seed * (i+1) * 7919) % W);
    const py = ((seed * (i+1) * 6271) % H);
    const pr = 1 + (i % 4);
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI*2); ctx.fill();
  }

  /* Radial glow center */
  const glow = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W*.55);
  glow.addColorStop(0,'rgba(0,180,255,0.18)'); glow.addColorStop(.5,'rgba(0,80,180,0.1)'); glow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  /* Scan lines */
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0, y, W, 2);
  }
  /* Bottom data stream */
  ctx.fillStyle = 'rgba(0,200,100,0.2)';
  for (let x = 0; x < W; x += 18) {
    const h2 = 10 + (x * 37 % 60);
    ctx.fillRect(x, H - h2, 8, h2);
  }
}

/* ================================================================
   FEATURE 3 – IMAGE GENERATOR
================================================================ */
function onCustomImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    customImageDataUrl  = e.target.result;
    _activeImageDataUrl = e.target.result; // custom upload is immediately the active image
    _subjectDataUrl     = null; /* clear any cached bg-removal result */
    document.getElementById('clearCustomBtn').style.display  = 'inline-flex';
    document.getElementById('enhanceAIBtn').style.display    = 'inline-flex';
    /* Reset pan/zoom adjustments for the new image */
    resetImgAdjust(/* silent */ true);
    toast('📷 Custom image loaded — adjust zoom/pan, then Regenerate!', 'success');
    if (selectedArticle && generatedPost) generateImage();
  };
  reader.readAsDataURL(file);
}

function clearCustomImage() {
  customImageDataUrl  = null;
  _activeImageDataUrl = null;
  _subjectDataUrl     = null;
  _subjectImg         = null;
  _enhancedMode       = false;
  _mainImgSprite      = null;
  _mainImgSelected    = false;
  document.getElementById('customImgInput').value = '';
  document.getElementById('clearCustomBtn').style.display = 'none';
  document.getElementById('enhanceAIBtn').style.display   = 'none';
  document.getElementById('bgStylePicker').style.display  = 'none';
  document.getElementById('imgSourceBadge').textContent   = '';
  resetImgAdjust(/* silent */ true);
  if (selectedArticle && generatedPost) generateImage();
  else document.getElementById('imgAdjustBar').style.display = 'none';
}

/* ================================================================
   MULTI-IMAGE COMPOSITE — Dynamic Side Sprites
   _sideSprites[] — unlimited, each added via addSideImage()
================================================================ */

/** Add a new side sprite from a file-input change event */
function addSideImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  /* reset the input so same file can be re-selected */
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    const id = _nextSpriteId++;
    _sideSprites.push({
      id,
      rawDataUrl:     e.target.result,
      subjectDataUrl: null,
      img:            null,
      x: 0, y: 0, w: 0, h: 0, rot: 0,
      flipH:   false,   /* horizontal flip (pre-composite) */
      removeBg: true,   /* BG removal toggle — user can turn off per image */
      selected: false,
    });
    _renderSideImageList();
    toast('📷 Image loaded — click ✨ Apply to merge', 'success');
  };
  reader.readAsDataURL(file);
}

/** Remove a sprite by id */
function removeSideSprite(id) {
  _sideSprites = _sideSprites.filter(s => s.id !== id);
  if (_selectedSpriteId === id) _selectedSpriteId = null;
  _renderSideImageList();
  if (_sideSprites.length === 0) {
    _compositeMode = false;
    _showCompositeHandles(false);
    fastRedraw();
  } else {
    applyComposite();
  }
  toast('✕ Image removed', 'info', 1500);
}

/** Rebuild the side-image list UI */
function _renderSideImageList() {
  const list = document.getElementById('sideImageList');
  if (!list) return;
  list.innerHTML = '';
  _sideSprites.forEach(sp => {
    const item = document.createElement('div');
    item.className = 'side-img-item';
    item.dataset.id = sp.id;

    /* Preview thumb — show BG-removed version if available, else raw */
    const thumbSrc = sp.subjectDataUrl || sp.rawDataUrl;

    item.innerHTML = `
      <button class="btn btn-ghost side-img-remove" onclick="removeSideSprite(${sp.id})" title="Remove image">✕</button>
      <img src="${thumbSrc}" class="side-img-thumb" alt="" title="Click Apply to place on canvas">
      <div class="side-img-actions">
        <button class="side-img-action-btn" onclick="rotateSpritePreview(${sp.id}, -90)" title="Rotate 90° left">↺</button>
        <button class="side-img-action-btn" onclick="rotateSpritePreview(${sp.id}, 90)" title="Rotate 90° right">↻</button>
        <button class="side-img-action-btn" onclick="flipSpritePreview(${sp.id})" title="Flip horizontal">⇆</button>
      </div>`;
    list.appendChild(item);
  });

  /* Show/hide apply+clear+bg buttons */
  const applyBtn  = document.getElementById('compositeApplyBtn');
  const clearBtn  = document.getElementById('compositeClearBtn');
  const bgBtn     = document.getElementById('compositeBgBtn');
  const circleBtn = document.getElementById('compositeCircleBtn');
  if (applyBtn)  applyBtn.style.display  = _sideSprites.length ? 'inline-flex' : 'none';
  if (clearBtn)  clearBtn.style.display  = _sideSprites.length ? 'inline-flex' : 'none';
  if (bgBtn)     bgBtn.style.display     = _sideSprites.length ? 'inline-flex' : 'none';
  if (circleBtn) circleBtn.style.display = _sideSprites.length ? 'inline-flex' : 'none';
}

/** Rotate a sprite's base image pre-composite (baked into rawDataUrl) */
function rotateSpritePreview(id, deg) {
  const sp = _sideSprites.find(s => s.id === id);
  if (!sp) return;
  /* Rotate the raw image onto an offscreen canvas */
  const img = new Image();
  img.onload = () => {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
    const nW = Math.round(img.width * cos + img.height * sin);
    const nH = Math.round(img.width * sin + img.height * cos);
    const oc = document.createElement('canvas');
    oc.width = nW; oc.height = nH;
    const ctx = oc.getContext('2d');
    ctx.translate(nW / 2, nH / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    sp.rawDataUrl = oc.toDataURL('image/png');
    /* Invalidate cached outputs so applyComposite re-processes */
    sp.subjectDataUrl = null;
    sp.img = null;
    _renderSideImageList();
  };
  img.src = sp.rawDataUrl;
}

/** Flip a sprite's base image horizontally pre-composite */
function flipSpritePreview(id) {
  const sp = _sideSprites.find(s => s.id === id);
  if (!sp) return;
  const img = new Image();
  img.onload = () => {
    const oc = document.createElement('canvas');
    oc.width = img.width; oc.height = img.height;
    const ctx = oc.getContext('2d');
    ctx.translate(img.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    sp.rawDataUrl = oc.toDataURL('image/png');
    /* Invalidate cached outputs */
    sp.subjectDataUrl = null;
    sp.img = null;
    _renderSideImageList();
  };
  img.src = sp.rawDataUrl;
}

/** Compute a default position for sprite index i — centred on canvas */
function _defaultSpritePos(i, img) {
  const W = CANVAS_W, H = CANVAS_H;
  /* Scale image to fill ~45% of canvas height, preserving aspect ratio */
  const maxH = Math.round(H * 0.45);
  const maxW = Math.round(W * 0.45);
  const aspect = img.width / img.height;
  let dh = maxH, dw = Math.round(maxH * aspect);
  if (dw > maxW) { dw = maxW; dh = Math.round(maxW / aspect); }
  /* Centre the sprite on the canvas; stagger multiple sprites slightly */
  const offsetX = (i % 3 - 1) * Math.round(W * 0.08);
  const offsetY = (Math.floor(i / 3) % 2) * Math.round(H * 0.06);
  const x = Math.round((W - dw) / 2) + offsetX;
  const y = Math.round((H - dh) / 2) + offsetY;
  return { x: Math.max(0, x), y: Math.max(0, y), w: dw, h: dh, rot: 0 };
}

/**
 * Client-side background removal using canvas pixel manipulation.
 * Samples the BORDER edge pixels to detect dominant background colour,
 * then removes pixels within tolerance — preserving skin tones and faces.
 * Returns a data-URL (PNG with alpha transparency).
 */
async function _localRemoveBackground(dataUrl, tolerance = 32) {
  const img = await loadImageFromSrc(dataUrl, 10000);
  const oc  = document.createElement('canvas');
  oc.width  = img.naturalWidth  || img.width;
  oc.height = img.naturalHeight || img.height;
  const octx = oc.getContext('2d');
  octx.drawImage(img, 0, 0);
  const { width: W, height: H } = oc;
  const imgData = octx.getImageData(0, 0, W, H);
  const d = imgData.data;

  /* Sample the full outer border (top+bottom rows + left+right cols) to find BG colour */
  let rSum=0, gSum=0, bSum=0, cnt=0;
  const addPx = (px, py) => {
    const i = (py * W + px) * 4;
    rSum += d[i]; gSum += d[i+1]; bSum += d[i+2]; cnt++;
  };
  for (let x = 0; x < W; x++) { addPx(x, 0); addPx(x, H-1); }
  for (let y = 1; y < H-1; y++) { addPx(0, y); addPx(W-1, y); }
  const bgR = rSum/cnt, bgG = gSum/cnt, bgB = bSum/cnt;

  /* Helper: is a pixel likely a skin tone? Preserve these from removal. */
  function isSkinTone(r, g, b) {
    // Fitzpatrick scale heuristic: skin tones have warm cast, R > G > B in various ranges
    return r > 60 && g > 30 && b > 15 &&
           r > g && g > b * 0.7 &&
           Math.abs(r - g) < 80 &&
           r < 255 && g < 240;
  }

  /* Make pixels close to background colour transparent — skip skin tones */
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    const dr = r - bgR, dg = g - bgG, db = b - bgB;
    const dist = Math.sqrt(dr*dr + dg*dg + db*db);
    if (dist < tolerance) {
      /* Don't remove if it looks like skin (protects faces/hands) */
      if (!isSkinTone(r, g, b)) {
        d[i+3] = 0;  // fully transparent
      }
    } else if (dist < tolerance * 1.8) {
      /* Feathered edge — also skip if skin */
      if (!isSkinTone(r, g, b)) {
        d[i+3] = Math.round(255 * (dist - tolerance) / (tolerance * 0.8));
      }
    }
  }
  octx.putImageData(imgData, 0, 0);
  return oc.toDataURL('image/png');
}

/**
 * Apply Composite:
 *  1. Clears any stale BG-removed cache (subjectDataUrl) on each sprite.
 *  2. Loads Image objects from rawDataUrl (original, with background).
 *  3. Assigns default positions for new sprites, then redraws.
 *  Background removal is a SEPARATE step — use the 🚫 Remove BG button.
 */
async function applyComposite() {
  if (_sideSprites.length === 0) {
    toast('⚠️ Upload at least one side image first.', 'error'); return;
  }
  const applyBtn = document.getElementById('compositeApplyBtn');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Applying…'; }
  try {
    for (const sp of _sideSprites) {
      /* ALWAYS use the raw image — BG removal is a separate step via 🚫 Remove BG.
         Clear subjectDataUrl so no downstream code accidentally uses a stale
         BG-removed version from a previous removeBgAllSprites() call. */
      sp.subjectDataUrl = null;   // ← clear stale BG-removed cache
      sp.img = null;
      try { sp.img = await loadImageFromSrc(sp.rawDataUrl); } catch {}
    }
    /* Set default positions for any sprite that doesn't have one yet */
    _sideSprites.forEach((sp, i) => {
      if (!sp.img) return;
      if (sp.w === 0) Object.assign(sp, _defaultSpritePos(i, sp.img));
    });
    _compositeMode = true;

    /* ── CRITICAL: Apply Composite works on the NEWS CANVAS (real background).
       If AI enhanced mode is active it would swap in an AI background instead of
       the news photo — force-exit it so the real image stays as the base. */
    _enhancedMode    = false;
    _mainImgSprite   = null;
    _mainImgSelected = false;
    /* Redraw the main canvas from scratch with the real news/custom image */
    if (_cachedNewsImg) {
      const canvas = document.getElementById('newsCanvas');
      const ctx    = canvas.getContext('2d');
      canvas.width  = CANVAS_W;
      canvas.height = CANVAS_H;
      drawNewsImage(ctx, _cachedNewsImg, CANVAS_W, CANVAS_H);
      _drawNewsBanner(ctx, CANVAS_W);
      if (generatedPost) await drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
    }

    _showCompositeHandles(true);
    await redrawComposite();
    toast('✅ Composite ready! Drag · resize · rotate side images freely.', 'success');
  } finally {
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '✨ Apply Composite'; }
  }
}

/**
 * Remove background from ALL side sprites (separate from Apply Composite).
 * Uses Remove.bg API if a key is set, otherwise canvas-based local removal.
 * After processing, refreshes thumbnails and redraws the composite.
 */
async function removeBgAllSprites() {
  if (_sideSprites.length === 0) {
    toast('⚠️ Upload at least one side image first.', 'error'); return;
  }
  const bgBtn = document.getElementById('compositeBgBtn');
  if (bgBtn) { bgBtn.disabled = true; bgBtn.textContent = '⏳ Removing BG…'; }
  try {
    for (const sp of _sideSprites) {
      /* Always redo BG removal when user explicitly clicks the button */
      const hasRemovebg = _removebgKey || _browserRemovebgKey;
      if (hasRemovebg) {
        toast(`🎨 Removing background (Remove.bg) for image ${sp.id}…`, 'info', 4000);
        try {
          sp.subjectDataUrl = await removeBackground(sp.rawDataUrl);
        } catch {
          toast('⚠️ Remove.bg failed — using smart local removal', 'info', 2500);
          sp.subjectDataUrl = await _localRemoveBackground(sp.rawDataUrl);
        }
      } else {
        toast(`🎨 Auto-removing background for image ${sp.id}…`, 'info', 3000);
        sp.subjectDataUrl = await _localRemoveBackground(sp.rawDataUrl);
      }
      /* Reload the image object with the new BG-removed version */
      sp.img = null;
      try { sp.img = await loadImageFromSrc(sp.subjectDataUrl); } catch {}
    }
    /* Refresh thumbnails to show BG-removed previews */
    _renderSideImageList();
    /* If composite is already active, redraw with the new processed images */
    if (_compositeMode) await redrawComposite();
    toast('✅ Backgrounds removed! Click ✨ Apply Composite to place on canvas.', 'success');
  } finally {
    if (bgBtn) { bgBtn.disabled = false; bgBtn.textContent = '🚫 Remove BG'; }
  }
}

/**
 * Redraw the composite canvas:
 *  Centre image → side sprites (all of _sideSprites) → text overlay → extra texts
 */
async function redrawComposite() {
  /* If AI enhancement is active, use that as the base (preserves AI background) */
  if (_enhancedMode && _subjectImg) {
    redrawEnhanced();   // redrawEnhanced already draws sprites + handles + extra texts
    return;
  }

  const canvas = document.getElementById('newsCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  /* Initialise the main-image sprite for the cached news image if not yet created */
  if (_cachedNewsImg && !_mainImgSprite) {
    _mainImgSprite = {
      x: 0, y: 0,
      w: CANVAS_W, h: CANVAS_H,
      rot: 0
    };
  }

  /* Draw centre background / main image via sprite transform */
  if (_cachedNewsImg && _mainImgSprite) {
    const sp = _mainImgSprite;
    ctx.save();
    ctx.translate(sp.x + sp.w / 2, sp.y + sp.h / 2);
    ctx.rotate(sp.rot);
    ctx.drawImage(_cachedNewsImg, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
  } else if (_cachedNewsImg) {
    drawNewsImage(ctx, _cachedNewsImg, CANVAS_W, CANVAS_H);
  } else {
    drawBackground(ctx, CANVAS_W, CANVAS_H);
  }

  _drawSpritesOnCtx(ctx);

  /* Banner always on top of all images/sprites */
  _drawNewsBanner(ctx, CANVAS_W);
  if (generatedPost) await drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
  _drawExtraTexts(ctx, CANVAS_W, CANVAS_H);
  _drawCompositeHandles();

  /* Show handle canvas in composite mode */
  _showCompositeHandles(true);
}

/** Draw all side sprites onto any ctx */
/** Toggle circle-clip mode for all composite sprites */
function toggleCircleClip() {
  _circleClipMode = !_circleClipMode;
  const btn = document.getElementById('compositeCircleBtn');
  if (btn) {
    btn.style.background   = _circleClipMode ? 'linear-gradient(135deg,#4f46e5,#818cf8)' : '';
    btn.style.color        = _circleClipMode ? '#fff' : '#818cf8';
    btn.textContent        = _circleClipMode ? '⭕ Circle ON' : '⭕ Circle Clip';
  }
  if (_compositeMode) redrawComposite();
  toast(_circleClipMode ? '⭕ Circle clip ON — images shown as circular icons' : '⬜ Circle clip OFF', 'info', 2000);
}

function _drawSpritesOnCtx(ctx) {
  _sideSprites.forEach(sp => {
    if (!sp.img) return;
    const cx = sp.x + sp.w / 2, cy = sp.y + sp.h / 2;
    const r  = Math.min(sp.w, sp.h) / 2;

    if (_circleClipMode) {
      /* ── Circle clip mode: draw as circular icon ── */
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sp.rot);

      /* Shadow/glow behind circle */
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur  = 18;

      /* Circle clip */
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      ctx.shadowBlur = 0;
      ctx.restore();

      /* Ring border */
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sp.rot);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      const ringGrad = ctx.createLinearGradient(-r, -r, r, r);
      ringGrad.addColorStop(0,   '#f59e0b');
      ringGrad.addColorStop(0.5, '#ef4444');
      ringGrad.addColorStop(1,   '#a855f7');
      ctx.strokeStyle = ringGrad;
      ctx.lineWidth   = Math.max(3, r * 0.06);
      ctx.stroke();
      ctx.restore();
    } else {
      /* ── Normal rectangular mode ── */
      /* Depth glow */
      const grd = ctx.createRadialGradient(cx, cy + sp.h * 0.3, sp.w * 0.1, cx, cy, sp.w * 0.8);
      grd.addColorStop(0, 'rgba(0,0,0,0.45)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(sp.rot);
      ctx.fillStyle = grd; ctx.fillRect(-sp.w * 0.6, -sp.h * 0.6, sp.w * 1.2, sp.h * 1.2);
      ctx.restore();
      /* Image */
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(sp.rot);
      ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      ctx.restore();
      /* Accent line at bottom */
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(sp.rot);
      ctx.fillStyle = 'rgba(246,173,85,0.8)';
      ctx.fillRect(-sp.w / 2, sp.h / 2, sp.w, 3);
      ctx.restore();
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
   COMPOSITE HANDLE OVERLAY
   A transparent <canvas> stacked over the main canvas.
   Draws selection box + resize corners + rotate grip for the
   currently selected sprite. Clicking empty canvas area deselects.
   ══════════════════════════════════════════════════════════════════ */

const HANDLE_R   = 14;   // slightly larger handles for better visibility
const ROTATE_GAP = 36;

function _getHandleCanvas() {
  let hc = document.getElementById('compositeHandleCanvas');
  if (!hc) {
    const mc = document.getElementById('newsCanvas');
    if (!mc) return null;
    hc = document.createElement('canvas');
    hc.id = 'compositeHandleCanvas';
    /* Mirror newsCanvas CSS exactly so it overlays it perfectly.
       newsCanvas uses width:100%; max-width:640px; display:block; centred via flex parent.
       We match those rules + use left:50% / translateX(-50%) to stay centred. */
    hc.style.cssText = [
      'position:absolute',
      'top:0',
      'left:50%',
      'transform:translateX(-50%)',
      'width:100%',
      'max-width:640px',
      'aspect-ratio:1/1',
      'pointer-events:none',
      'display:none',
      'z-index:10'
    ].join(';');
    mc.parentNode.insertBefore(hc, mc.nextSibling);
  }
  return hc;
}

/** Keep handle canvas internal resolution in sync with its displayed pixel size */
function _syncHandleCanvasSize() {
  const hc = document.getElementById('compositeHandleCanvas');
  const mc = document.getElementById('newsCanvas');
  if (!hc || !mc) return;
  /* Internal resolution must match newsCanvas attribute size (1080×1080).
     The CSS width/max-width rules handle the visual scaling.
     Only update if dimensions differ — setting canvas.width always clears it. */
  const w = mc.width  || CANVAS_W;
  const h = mc.height || CANVAS_H;
  if (hc.width  !== w) hc.width  = w;
  if (hc.height !== h) hc.height = h;
}

function _showCompositeHandles(show) {
  const hc = _getHandleCanvas();
  if (!hc) return;
  if (show) _syncHandleCanvasSize();   // keep it flush with the canvas, not the whole wrap
  hc.style.display      = show ? 'block' : 'none';
  hc.style.pointerEvents = show ? 'auto'  : 'none';
}

function _hcToCanvas(hc, cx, cy) {
  return { x: cx * (CANVAS_W / hc.offsetWidth), y: cy * (CANVAS_H / hc.offsetHeight) };
}

function _spriteCorners(sp) {
  const hw = sp.w / 2, hh = sp.h / 2;
  return [
    { lx: -hw, ly: -hh }, { lx: hw, ly: -hh },
    { lx:  hw, ly:  hh }, { lx:-hw, ly:  hh },
  ];
}
function _rot(lx, ly, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: lx*c - ly*s, y: lx*s + ly*c };
}
function _cornerWorld(sp, idx) {
  const { lx, ly } = _spriteCorners(sp)[idx];
  const r = _rot(lx, ly, sp.rot);
  return { x: sp.x + sp.w/2 + r.x, y: sp.y + sp.h/2 + r.y };
}
function _rotGripWorld(sp) {
  const r = _rot(0, -sp.h/2 - ROTATE_GAP, sp.rot);
  return { x: sp.x + sp.w/2 + r.x, y: sp.y + sp.h/2 + r.y };
}

function _drawCompositeHandles() {
  const hc = _getHandleCanvas();
  if (!hc) return;
  const mc = document.getElementById('newsCanvas');
  if (!mc) return;
  /* Set internal resolution to match the main canvas (1080×1080).
     Only reset width/height if they actually differ — resetting clears the canvas
     and is only needed when the main canvas changes size. */
  const targetW = mc.width  || CANVAS_W;
  const targetH = mc.height || CANVAS_H;
  if (hc.width !== targetW)  hc.width  = targetW;
  if (hc.height !== targetH) hc.height = targetH;
  const ctx = hc.getContext('2d');
  ctx.clearRect(0, 0, hc.width, hc.height);

  const needsOverlay = (_enhancedMode && _mainImgSprite) || (_compositeMode && _sideSprites.length > 0) || _extraTexts.length > 0;
  hc.style.pointerEvents = needsOverlay ? 'auto' : 'none';
  /* Ensure the handle canvas is visible whenever it has content to show */
  if (needsOverlay && hc.style.display === 'none') {
    hc.style.display = 'block';
    _syncHandleCanvasSize();
  }
  if (!needsOverlay) return;

  /* Helper: draw full selection box + corner handles + rotate grip */
  function _drawHandles(sp, color) {
    const corners = [0,1,2,3].map(i => _cornerWorld(sp, i));
    const grip    = _rotGripWorld(sp);
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([10,6]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.forEach(c => ctx.lineTo(c.x, c.y));
    ctx.closePath(); ctx.stroke();
    const topMid = { x:(corners[0].x+corners[1].x)/2, y:(corners[0].y+corners[1].y)/2 };
    ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(topMid.x,topMid.y); ctx.lineTo(grip.x,grip.y); ctx.stroke();
    ctx.restore();
    corners.forEach(c => {
      ctx.beginPath(); ctx.arc(c.x, c.y, HANDLE_R, 0, Math.PI*2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([]); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(grip.x, grip.y, HANDLE_R, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.setLineDash([]); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(HANDLE_R*1.5)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('↻', grip.x, grip.y);
  }

  /* Helper: draw a subtle hover outline for unselected sprites */
  function _drawUnselectedOutline(sp, color) {
    const corners = [0,1,2,3].map(i => _cornerWorld(sp, i));
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([6,6]);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.forEach(c => ctx.lineTo(c.x, c.y));
    ctx.closePath(); ctx.stroke();
    /* Small click-me dot in centre */
    const cx = sp.x + sp.w/2, cy = sp.y + sp.h/2;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }

  /* Draw main image (enhanced mode only — in composite-only mode it's the background) */
  if (_enhancedMode && _mainImgSprite) {
    _drawHandles(_mainImgSprite, _mainImgSelected ? '#34d399' : 'rgba(52,211,153,0.5)');
  } else if (_compositeMode && _mainImgSprite && _mainImgSelected) {
    _drawHandles(_mainImgSprite, '#34d399');
  }

  /* Draw ALL side sprites — selected sprite gets full handles, others get subtle outline */
  if (_compositeMode) {
    _sideSprites.forEach(sp => {
      if (!sp.img) return;
      if (sp.id === _selectedSpriteId) {
        _drawHandles(sp, '#f6ad55');
      } else {
        _drawUnselectedOutline(sp, '#f6ad55');
      }
    });
  }

  /* Draw selected text handles (others are not selectable via canvas) */
  const selText = _extraTexts.find(t => t.id === _selectedTextId);
  if (selText && selText.text.trim()) _drawHandles(selText, '#818cf8');
  /* Draw unselected text outlines */
  _extraTexts.forEach(et => {
    if (et.id === _selectedTextId || !et.text.trim()) return;
    _drawUnselectedOutline(et, '#818cf8');
  });
}

function _hitTestSprite(sp, wx, wy) {
  /* Works for sprite objects ({img}), text objects ({text}), and main-img sprite */
  if (sp.img === undefined && sp.text === undefined && sp !== _mainImgSprite) return null;
  const grip = _rotGripWorld(sp);
  if (Math.hypot(wx - grip.x, wy - grip.y) <= HANDLE_R + 4) return 'rotate';
  for (let i = 0; i < 4; i++) {
    const c = _cornerWorld(sp, i);
    if (Math.hypot(wx - c.x, wy - c.y) <= HANDLE_R + 4) return `resize-${i}`;
  }
  const cx = sp.x + sp.w/2, cy = sp.y + sp.h/2;
  const dx = wx - cx, dy = wy - cy;
  const cos = Math.cos(-sp.rot), sin = Math.sin(-sp.rot);
  const lx = dx*cos - dy*sin, ly = dx*sin + dy*cos;
  if (Math.abs(lx) <= sp.w/2 && Math.abs(ly) <= sp.h/2) return 'move';
  return null;
}

(function _initCompositeHandleInteraction() {
  let _active    = null;
  let _rafPending = false;

  function _getHc() { return document.getElementById('compositeHandleCanvas'); }

  function _ptToCanvas(e) {
    const hc = _getHc(); if (!hc) return {x:0,y:0};
    const rect  = hc.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return _hcToCanvas(hc, touch.clientX - rect.left, touch.clientY - rect.top);
  }

  function _scheduleRedraw() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => { _rafPending = false; fastRedraw(); });
  }

  /* Apply sprite-model resize to either a sprite or a text object */
  function _applyResize(obj, startSnap, cornerIdx, startPt, pt) {
    const dx = pt.x - startPt.x, dy = pt.y - startPt.y;
    const oppIdx  = (cornerIdx + 2) % 4;
    const oppW    = _cornerWorld(startSnap, oppIdx);
    const corners = _spriteCorners(startSnap);
    const origL   = corners[cornerIdx];
    const newWx   = startSnap.x + startSnap.w/2 + _rot(origL.lx, origL.ly, startSnap.rot).x + dx;
    const newWy   = startSnap.y + startSnap.h/2 + _rot(origL.lx, origL.ly, startSnap.rot).y + dy;
    const vecX    = newWx - oppW.x, vecY = newWy - oppW.y;
    const cos     = Math.cos(-startSnap.rot), sin = Math.sin(-startSnap.rot);
    const newW    = Math.max(60, Math.abs(vecX*cos - vecY*sin));
    const newH    = Math.max(30, Math.abs(vecX*sin + vecY*cos));
    const midX    = (newWx + oppW.x)/2, midY = (newWy + oppW.y)/2;
    obj.w = newW; obj.h = newH;
    obj.x = midX - newW/2; obj.y = midY - newH/2;
    /* For text objects: scale font size proportionally to height */
    if (obj.text !== undefined) {
      obj.size = Math.max(10, Math.round(newH * 0.55));
      /* Sync size slider in the UI card */
      const lbl = document.querySelector(`[data-txt-id="${obj.id}"] .txt-size-val`);
      const rng = document.querySelector(`[data-txt-id="${obj.id}"] input[type=range]`);
      if (lbl) lbl.textContent = obj.size + 'px';
      if (rng) rng.value = obj.size;
    }
  }

  function _onDown(e) {
    /* Main image is selectable only in enhanced mode — in composite-only mode it is
       the background and sprites sit on top of it, so sprites must take priority. */
    const hasMainImg = _enhancedMode && _mainImgSprite;
    const hasSprites = _compositeMode && _sideSprites.length > 0;
    const hasTexts   = _extraTexts.length > 0;
    if (!hasMainImg && !hasSprites && !hasTexts) return;

    const pt = _ptToCanvas(e);

    /* ── 0. Side sprites — checked FIRST because they sit on top of the background ── */
    if (hasSprites) {
      const sel = _sideSprites.find(s => s.id === _selectedSpriteId);
      if (sel) {
        const hit = _hitTestSprite(sel, pt.x, pt.y);
        if (hit) {
          _mainImgSelected = false;
          _active = { type: 'sprite', obj: sel, hit, startPt: pt, startSnap: { ...sel } };
          e.preventDefault(); e.stopPropagation(); return;
        }
      }
      /* Any other sprite */
      for (let i = _sideSprites.length - 1; i >= 0; i--) {
        const sp  = _sideSprites[i];
        const hit = _hitTestSprite(sp, pt.x, pt.y);
        if (hit) {
          _selectedSpriteId = sp.id; _selectedTextId = null; _mainImgSelected = false;
          _active = { type: 'sprite', obj: sp, hit, startPt: pt, startSnap: { ...sp } };
          _drawCompositeHandles();
          e.preventDefault(); e.stopPropagation(); return;
        }
      }
    }

    /* ── 1. Main image (enhanced mode only — background in composite-only mode) ── */
    if (hasMainImg) {
      const hit = _hitTestSprite(_mainImgSprite, pt.x, pt.y);
      if (hit) {
        _mainImgSelected  = true;
        _selectedSpriteId = null;
        _selectedTextId   = null;
        _active = { type: 'mainImg', obj: _mainImgSprite, hit, startPt: pt, startSnap: { ..._mainImgSprite } };
        _drawCompositeHandles();
        e.preventDefault(); e.stopPropagation(); return;
      }
    }

    /* ── 2. Selected text handles ── */
    const selTxt = _extraTexts.find(t => t.id === _selectedTextId);
    if (selTxt) {
      const hit = _hitTestSprite(selTxt, pt.x, pt.y);
      if (hit) {
        _mainImgSelected = false;
        _active = { type: 'text', obj: selTxt, hit, startPt: pt, startSnap: { ...selTxt } };
        e.preventDefault(); e.stopPropagation(); return;
      }
    }
    /* Any other text */
    for (let i = _extraTexts.length - 1; i >= 0; i--) {
      const et  = _extraTexts[i];
      const hit = _hitTestSprite(et, pt.x, pt.y);
      if (hit) {
        _selectedTextId = et.id; _selectedSpriteId = null; _mainImgSelected = false;
        _active = { type: 'text', obj: et, hit, startPt: pt, startSnap: { ...et } };
        _drawCompositeHandles();
        e.preventDefault(); e.stopPropagation(); return;
      }
    }

    /* ── 3. Empty area — deselect ── */
    _selectedSpriteId = null; _selectedTextId = null; _mainImgSelected = false;
    _drawCompositeHandles();
  }

  function _onMove(e) {
    if (!_active) return;
    const pt  = _ptToCanvas(e);
    const dx  = pt.x - _active.startPt.x;
    const dy  = pt.y - _active.startPt.y;
    const obj = _active.obj;
    const ssp = _active.startSnap;

    if (_active.hit === 'move') {
      obj.x = ssp.x + dx; obj.y = ssp.y + dy;
    } else if (_active.hit === 'rotate') {
      const cx = ssp.x + ssp.w/2, cy = ssp.y + ssp.h/2;
      obj.rot = ssp.rot + Math.atan2(pt.y - cy, pt.x - cx)
                        - Math.atan2(_active.startPt.y - cy, _active.startPt.x - cx);
    } else if (_active.hit.startsWith('resize-')) {
      _applyResize(obj, ssp, parseInt(_active.hit.split('-')[1]), _active.startPt, pt);
    }
    e.preventDefault();
    _scheduleRedraw();
  }

  function _onUp() { _active = null; }

  function _onHover(e) {
    if (_active) return;
    const hc = _getHc(); if (!hc) return;
    const pt = _ptToCanvas(e);
    let cursor = 'default';

    /* Check sprites FIRST — they sit on top of the main background image */
    if (cursor === 'default' && _compositeMode) {
      const sel = _sideSprites.find(s => s.id === _selectedSpriteId);
      if (sel) {
        const hit = _hitTestSprite(sel, pt.x, pt.y);
        if      (hit === 'move')   cursor = 'grab';
        else if (hit === 'rotate') cursor = 'crosshair';
        else if (hit)              cursor = 'nwse-resize';
      }
      if (cursor === 'default') {
        for (let i = _sideSprites.length - 1; i >= 0; i--) {
          if (_hitTestSprite(_sideSprites[i], pt.x, pt.y)) { cursor = 'pointer'; break; }
        }
      }
    }

    /* Check main image — only in enhanced mode (background in composite-only mode) */
    if (cursor === 'default' && _enhancedMode && _mainImgSprite) {
      const hit = _hitTestSprite(_mainImgSprite, pt.x, pt.y);
      if      (hit === 'move')   cursor = 'grab';
      else if (hit === 'rotate') cursor = 'crosshair';
      else if (hit)              cursor = 'nwse-resize';
    }
    /* Check texts */
    if (cursor === 'default') {
      const selT = _extraTexts.find(t => t.id === _selectedTextId);
      if (selT) {
        const hit = _hitTestSprite(selT, pt.x, pt.y);
        if      (hit === 'move')   cursor = 'grab';
        else if (hit === 'rotate') cursor = 'crosshair';
        else if (hit)              cursor = 'nwse-resize';
      }
      if (cursor === 'default') {
        for (let i = _extraTexts.length - 1; i >= 0; i--) {
          if (_hitTestSprite(_extraTexts[i], pt.x, pt.y)) { cursor = 'text'; break; }
        }
      }
    }
    hc.style.cursor = cursor;
  }

  function _ensureHandleCanvasVisible() {
    if (_enhancedMode || _compositeMode || _extraTexts.length > 0) _showCompositeHandles(true);
  }

  function _attach() {
    const hc = _getHandleCanvas();
    if (!hc) { setTimeout(_attach, 300); return; }
    hc.addEventListener('mousedown',  _onDown,  { passive: false });
    hc.addEventListener('touchstart', _onDown,  { passive: false });
    window.addEventListener('mousemove', _onMove, { passive: false });
    window.addEventListener('touchmove', _onMove, { passive: false });
    window.addEventListener('mouseup',   _onUp,   { passive: true });
    window.addEventListener('touchend',  _onUp,   { passive: true });
    hc.addEventListener('mousemove', _onHover, { passive: true });
    /* Main canvas click deselects everything */
    const mc = document.getElementById('newsCanvas');
    if (mc) mc.addEventListener('click', () => {
      _selectedSpriteId = null; _selectedTextId = null;
      _drawCompositeHandles();
    });
  }

  window._ensureHandleCanvasVisible = _ensureHandleCanvasVisible;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _attach);
  else setTimeout(_attach, 400);
})();

/** Clear all composite side images and exit composite mode */
function clearAllComposite() {
  _sideSprites = [];
  _selectedSpriteId = null;
  _compositeMode = false;
  if (!_enhancedMode && _extraTexts.length === 0) _showCompositeHandles(false);
  _renderSideImageList();
  fastRedraw();
  toast('↺ Composite cleared', 'info', 1800);
}

/** Reset pan and zoom to defaults. Pass true to skip re-render. */
function resetImgAdjust(silent) {
  imgOffsetX = 0; imgOffsetY = 0; imgScale = 1.0;
  imgRotation = 0; imgFlipH = false; imgFlipV = false;
  const slider = document.getElementById('zoomSlider');
  const label  = document.getElementById('zoomVal');
  if (slider) slider.value = 100;
  if (label)  label.textContent = '100%';
  const preset = document.getElementById('cropPreset');
  if (preset) preset.value = 'none';
  if (!silent) fastRedraw();
}

/** Centre image (zero pan offsets, keep scale) */
function centerImage() {
  imgOffsetX = 0; imgOffsetY = 0;
  fastRedraw();
}

/** Rotate image by delta degrees (90/-90) */
function rotateImage(delta) {
  imgRotation = ((imgRotation + delta) % 360 + 360) % 360;
  fastRedraw();
}

/** Flip image horizontally or vertically */
function flipImage(axis) {
  if (axis === 'h') imgFlipH = !imgFlipH;
  else              imgFlipV = !imgFlipV;
  fastRedraw();
}

/** Apply a crop/scale preset */
function applyCropPreset(preset) {
  if (preset === 'none') return;
  imgOffsetX = 0; imgOffsetY = 0;
  switch (preset) {
    case 'square':    imgScale = 1.0;  break;
    case 'portrait':  imgScale = 0.85; break;   // show more vertical room
    case 'landscape': imgScale = 1.35; break;   // zoom in to fill wide
    case 'fill':      imgScale = 1.5;  break;
    case 'fit':       imgScale = 0.7;  break;
  }
  const slider = document.getElementById('zoomSlider');
  const label  = document.getElementById('zoomVal');
  if (slider) { slider.value = Math.round(imgScale * 100); }
  if (label)  { label.textContent = Math.round(imgScale * 100) + '%'; }
  _syncZoomUI(Math.round(imgScale * 100));
  if (_enhancedMode) { redrawEnhanced(); return; }
  if (selectedArticle && generatedPost) generateImage();
  const presetEl = document.getElementById('cropPreset');
  if (presetEl) presetEl.value = 'none';
}

/** Called by the zoom slider */
function onImgAdjust() {
  const slider = document.getElementById('zoomSlider');
  if (!slider) return;
  const pct = parseInt(slider.value, 10);
  imgScale = pct / 100;
  _syncZoomUI(pct);
  fastRedraw();
}

/** Sync all zoom UI elements to a given percentage */
function _syncZoomUI(pct) {
  const qbZoom = document.getElementById('qbZoom');
  const qbVal  = document.getElementById('qbZoomVal');
  if (qbZoom) qbZoom.value = pct;
  if (qbVal)  qbVal.textContent = pct + '%';
  _showZoomPill(pct + '%');
}

/** Called by the quick-bar zoom slider */
function onQbZoom(val) {
  const pct = parseInt(val, 10);
  imgScale = pct / 100;
  const qbVal = document.getElementById('qbZoomVal');
  if (qbVal) qbVal.textContent = pct + '%';
  _showZoomPill(pct + '%');
  fastRedraw();
}

/* ── Zoom pill display ── */
let _zoomPillTimer = null;
function _showZoomPill(text) {
  const pill = document.getElementById('canvasZoomPill');
  if (!pill) return;
  pill.textContent = text;
  pill.classList.add('visible');
  clearTimeout(_zoomPillTimer);
  _zoomPillTimer = setTimeout(() => pill.classList.remove('visible'), 1400);
}

/* ── Show/hide the quick bar and overlay when image is generated ── */
function _showCanvasEditor() {
  const overlay  = document.getElementById('canvasEditorOverlay');
  const quickBar = document.getElementById('canvasQuickBar');
  if (overlay)  overlay.style.display = 'block';
  if (quickBar) quickBar.classList.add('visible');
}
function _hideCanvasEditor() {
  const overlay  = document.getElementById('canvasEditorOverlay');
  const quickBar = document.getElementById('canvasQuickBar');
  if (overlay)  overlay.style.display = 'none';
  if (quickBar) quickBar.classList.remove('visible');
}

/**
 * Public fast-redraw — uses cached image, no network fetch.
 * Called by toolbar buttons, text editor, colour pickers, etc.
 */
async function fastRedraw() {
  /* Enhanced mode takes priority — redrawEnhanced handles composite sprites too */
  if (_enhancedMode && typeof redrawEnhanced === 'function') { redrawEnhanced(); return; }
  if (_compositeMode) { redrawComposite(); return; }
  const canvas = document.getElementById('newsCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;
  if (_cachedNewsImg) {
    drawNewsImage(ctx, _cachedNewsImg, CANVAS_W, CANVAS_H);
  } else {
    drawBackground(ctx, CANVAS_W, CANVAS_H);
  }
  /* Banner always on top of image layer */
  _drawNewsBanner(ctx, CANVAS_W);
  if (generatedPost) await drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
  _drawExtraTexts(ctx, CANVAS_W, CANVAS_H);
}

/* ────────────────────────────────────────────────────────────────
   CANVAS MOUSE INTERACTION
   • Drag to pan
   • Scroll/pinch to zoom
   • Click on title area to open inline text editor
   ──────────────────────────────────────────────────────────────── */
(function _initCanvasInteraction() {
  let _dragging = false;
  let _dragStartX = 0, _dragStartY = 0;
  let _lastMouseX = 0, _lastMouseY = 0;
  let _pinchDist = 0;
  let _rafPending = false;

  function _getCanvas() { return document.getElementById('newsCanvas'); }

  /* Convert CSS-pixel delta → canvas-pixel delta */
  function _scale(canvas, px) {
    const w = canvas.offsetWidth;
    if (!w) return px; /* panel not yet visible — use 1:1 */
    return px * (canvas.width / w);
  }

  /* ── Fast redraw using cached image — no network fetch ── */
  function _fastRedraw() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(async () => {
      _rafPending = false;
      const canvas = _getCanvas();
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      if (_enhancedMode && _subjectImg) {
        /* Enhanced mode — redraw background + subject (also handles composite sprites) */
        redrawEnhanced();
        return;
      }

      if (_compositeMode) {
        /* Composite mode — side subjects overlaid on centre image */
        redrawComposite();
        return;
      }

      if (_cachedNewsImg) {
        /* Fast path — use cached image, no fetch */
        canvas.width  = CANVAS_W;
        canvas.height = CANVAS_H;
        drawNewsImage(ctx, _cachedNewsImg, CANVAS_W, CANVAS_H);
        _drawNewsBanner(ctx, CANVAS_W);
        if (generatedPost) await drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
        _drawExtraTexts(ctx, CANVAS_W, CANVAS_H);
      } else if (generatedPost) {
        /* No image loaded yet — just redraw background + text */
        canvas.width  = CANVAS_W;
        canvas.height = CANVAS_H;
        drawBackground(ctx, CANVAS_W, CANVAS_H);
        _drawNewsBanner(ctx, CANVAS_W);
        await drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
        _drawExtraTexts(ctx, CANVAS_W, CANVAS_H);
      }
    });
  }

  /* ── Mouse events ── */
  function _onMouseDown(e) {
    if (e.button !== 0) return;
    const ito = document.getElementById('inlineTextOverlay');
    if (ito && ito.classList.contains('open')) return;
    /* In composite or enhanced mode the handle-canvas overlay intercepts pointer events.
       Clicks that somehow reach newsCanvas should not start a pan drag. */
    if (_compositeMode || _enhancedMode) return;
    _dragging   = true;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
    _getCanvas().style.cursor = 'grabbing';
    e.preventDefault();
  }

  function _onMouseMove(e) {
    if (!_dragging) return;
    const canvas = _getCanvas();
    imgOffsetX += _scale(canvas, e.clientX - _lastMouseX);
    imgOffsetY += _scale(canvas, e.clientY - _lastMouseY);
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
    _fastRedraw();
  }

  function _onMouseUp(e) {
    if (!_dragging) return;
    _dragging = false;
    _getCanvas().style.cursor = 'grab';
    /* Treat as a click if mouse barely moved */
    const moved = Math.abs(e.clientX - _dragStartX) + Math.abs(e.clientY - _dragStartY);
    if (moved < 6) _checkTitleClick(e);
  }

  /* ── Scroll-to-zoom ── */
  function _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.06 : 0.94;
    imgScale = Math.min(3.0, Math.max(0.25, imgScale * factor));
    _syncZoomUI(Math.round(imgScale * 100));
    _fastRedraw();
  }

  /* ── Touch events ── */
  function _touchDist(t) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function _onTouchStart(e) {
    /* In composite or enhanced mode the handle canvas handles touch interaction */
    if (_compositeMode || _enhancedMode) return;
    if (e.touches.length === 2) {
      _pinchDist = _touchDist(e.touches);
    } else if (e.touches.length === 1) {
      _dragging   = true;
      _dragStartX = e.touches[0].clientX;
      _dragStartY = e.touches[0].clientY;
      _lastMouseX = e.touches[0].clientX;
      _lastMouseY = e.touches[0].clientY;
    }
    e.preventDefault();
  }

  function _onTouchMove(e) {
    if (e.touches.length === 2) {
      const dist = _touchDist(e.touches);
      imgScale = Math.min(3.0, Math.max(0.25, imgScale * (dist / _pinchDist)));
      _pinchDist = dist;
      _syncZoomUI(Math.round(imgScale * 100));
      _fastRedraw();
    } else if (_dragging && e.touches.length === 1) {
      const canvas = _getCanvas();
      imgOffsetX += _scale(canvas, e.touches[0].clientX - _lastMouseX);
      imgOffsetY += _scale(canvas, e.touches[0].clientY - _lastMouseY);
      _lastMouseX = e.touches[0].clientX;
      _lastMouseY = e.touches[0].clientY;
      _fastRedraw();
    }
    e.preventDefault();
  }

  function _onTouchEnd() { _dragging = false; }

  /* Click on lower 60% of canvas → open inline text editor */
  function _checkTitleClick(e) {
    const canvas = _getCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const relY  = (e.clientY - rect.top) / rect.height;
    if (relY > 0.60) openInlineTextEditor();
  }

  /* ── Attach listeners — called AFTER the canvas exists ── */
  function _attach() {
    const canvas = _getCanvas();
    if (!canvas) { setTimeout(_attach, 200); return; }
    canvas.addEventListener('mousedown',  _onMouseDown,  { passive: false });
    window.addEventListener('mousemove',  _onMouseMove,  { passive: true  });
    window.addEventListener('mouseup',    _onMouseUp,    { passive: true  });
    canvas.addEventListener('wheel',      _onWheel,      { passive: false });
    canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   _onTouchEnd,   { passive: true  });
  }

  /* Script is at bottom of <body>, DOM is already parsed */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }
})();

/* ────────────────────────────────────────────────────────────────
   INLINE TEXT EDITOR (on-canvas panel)
   ──────────────────────────────────────────────────────────────── */

function openInlineTextEditor() {
  const overlay = document.getElementById('inlineTextOverlay');
  if (!overlay) return;

  /* Populate */
  const bEl = document.getElementById('iteBanner');
  const tEl = document.getElementById('iteTitle');
  const sEl = document.getElementById('iteFontSize');
  const svEl= document.getElementById('iteSizeVal');

  if (bEl) bEl.value = _textOpts.bannerText || '🚨  BREAKING NEWS';
  if (tEl) tEl.value = generatedPost ? (generatedPost.title || '') : '';
  if (sEl) { sEl.value = _textOpts.titleSize || 62; }
  if (svEl) svEl.textContent = (_textOpts.titleSize || 62) + 'px';

  /* Sync colour chips */
  document.querySelectorAll('#iteBannerColours .ite-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.colour === _textOpts.bannerColor);
  });
  document.querySelectorAll('#iteTitleColours .ite-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.colour === _textOpts.titleColor);
  });

  overlay.classList.add('open');
  if (tEl) setTimeout(() => tEl.focus(), 80);
}

function closeInlineTextEditor() {
  const overlay = document.getElementById('inlineTextOverlay');
  if (overlay) overlay.classList.remove('open');
}

/** Live-redraw while editing (called by colour chips & size slider) */
function iteRedraw() {
  fastRedraw();
}

function itePickTitle(el) {
  document.querySelectorAll('#iteTitleColours .ite-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _textOpts.titleColor = el.dataset.colour;
  iteRedraw();
}

function itePickBanner(el) {
  document.querySelectorAll('#iteBannerColours .ite-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _textOpts.bannerColor = el.dataset.colour;
  iteRedraw();
}

/** Apply button in inline editor */
function iteApply() {
  const bEl = document.getElementById('iteBanner');
  const tEl = document.getElementById('iteTitle');
  const sEl = document.getElementById('iteFontSize');

  if (bEl) _textOpts.bannerText  = bEl.value.trim() || '🚨  BREAKING NEWS';
  if (sEl) _textOpts.titleSize   = parseInt(sEl.value, 10) || 62;
  if (tEl && tEl.value.trim() && generatedPost) generatedPost.title = tEl.value.trim();

  closeInlineTextEditor();
  fastRedraw();
  if (typeof toast === 'function') toast('✅ Text updated!', 'success', 1800);
}

/** Called by arrow pan buttons. dx/dy in canvas pixels */
function panImage(dx, dy) {
  imgOffsetX += dx;
  imgOffsetY += dy;
  fastRedraw();
}

async function generateImage() {
  if (!selectedArticle || !generatedPost) {
    toast('⚠️ Please select a news article first.', 'error'); return;
  }
  /* Regenerate always exits enhanced/composite mode — user wants the original image */
  _enhancedMode    = false;
  _mainImgSprite   = null;
  _mainImgSelected = false;
  /* Note: composite mode is NOT auto-exited — it re-composites on the fresh image */
  document.getElementById('imagePanel').style.display = 'block';
  document.getElementById('imagePanel').scrollIntoView({ behavior:'smooth', block:'nearest' });

  const canvas = document.getElementById('newsCanvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  let newsImg   = null;
  let imgSource = '';

  if (customImageDataUrl) {
    try { newsImg = await loadImageFromSrc(customImageDataUrl); imgSource = '📷 Your photo'; } catch {}
  }
  if (!newsImg && selectedArticle.imageUrl) {
    const src = selectedArticle.imageUrl;
    const candidates = [
      src,
      _fetchProxyBase ? `${_fetchProxyBase}?url=${encodeURIComponent(src)}` : null,
      `https://corsproxy.io/?${encodeURIComponent(src)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(src)}`,
      `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=1080`,
    ].filter(Boolean);
    for (const c of candidates) {
      try { newsImg = await loadImageFromSrc(c, 6000); imgSource = '🌐 News photo'; break; } catch {}
    }
  }

  /* ── If no article image, fall back to the Nepal default image ── */
  let usedDefaultImg = false;
  if (!newsImg) {
    try {
      newsImg = await new Promise((resolve, reject) => {
        const img = new Image();   // NO crossOrigin — data URIs don't need it
        const tid = setTimeout(() => reject(new Error('timeout')), 4000);
        img.onload  = () => { clearTimeout(tid); resolve(img); };
        img.onerror = () => { clearTimeout(tid); reject(new Error('error')); };
        img.src = _DEFAULT_NEWS_THUMB;
      });
      imgSource = '🗺️ Nepal default';
      usedDefaultImg = true;
    } catch { /* SVG load failed — will fall through to graphic background */ }
  }

  if (newsImg) {
    _cachedNewsImg = newsImg;   /* ← cache for instant drag/zoom redraws */
    drawNewsImage(ctx, newsImg, CANVAS_W, CANVAS_H);
    _drawNewsBanner(ctx, CANVAS_W);
    document.getElementById('imgSourceBadge').textContent = imgSource;
    /* Show the canvas editor overlay + quick bar */
    document.getElementById('imgAdjustBar').style.display = 'block'; // keeps old JS guards happy
    _showCanvasEditor();
    /* Cache active image as data-URL so AI enhance can use it */
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = newsImg.naturalWidth || newsImg.width;
    tmpCanvas.height = newsImg.naturalHeight || newsImg.height;
    tmpCanvas.getContext('2d').drawImage(newsImg, 0, 0);
    try { _activeImageDataUrl = tmpCanvas.toDataURL('image/jpeg', 0.92); } catch { _activeImageDataUrl = customImageDataUrl; }
    /* AI enhance and adjust tools available for real photos; hide for default placeholder */
    document.getElementById('enhanceAIBtn').style.display = usedDefaultImg ? 'none' : 'inline-flex';
  } else {
    _cachedNewsImg = null;   /* no image available */
    drawBackground(ctx, CANVAS_W, CANVAS_H);
    _drawNewsBanner(ctx, CANVAS_W);
    document.getElementById('imgSourceBadge').textContent = '🎨 Graphic background';
    /* No image — hide overlay tools and enhance button */
    document.getElementById('imgAdjustBar').style.display = 'none';
    _hideCanvasEditor();
    document.getElementById('enhanceAIBtn').style.display = 'none';
    document.getElementById('bgStylePicker').style.display = 'none';
    _activeImageDataUrl = null;
  }
  await drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
  if (_compositeMode && _sideSprites.length > 0) {
    redrawComposite();   // async, but non-blocking — updates canvas after centre is drawn
  }

  /* Enable "Share All" buttons now that the image is ready */
  ['shareAllBtn', 'shareAllBtn2'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor  = 'pointer';
  });

  toast(newsImg ? '🖼️ Image generated!' : '🎨 Image generated (no photo)', newsImg ? 'success' : 'info');
}

function loadImageFromSrc(src, ms = 8000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const tid = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, ms);
    img.onload  = () => { clearTimeout(tid); resolve(img); };
    img.onerror = () => { clearTimeout(tid); reject(new Error('error')); };
    img.src = src;
  });
}

/* ================================================================
   IMAGE TRANSFORMATION ENGINE
   Applies layered canvas transformations so the output is a new
   creative work — not a reproduction of the source photo.
   Transformations applied (in order):
     1. Scale-to-fill crop (composition change)
     2. Pixel-level colour grade via ImageData (hue-shift + contrast)
     3. Cinematic letterbox crop (aspect ratio change)
     4. Directional blur strip along horizon (motion feel)
     5. Brand colour-wash overlay (strong tint)
     6. News graphic elements (banner, rule, branding)
   Together these constitute sufficient "creative authorship" to
   make the output a derivative/transformed work distinct from the
   original, reducing copyright exposure for editorial/news use.
================================================================ */

/**
 * Apply pixel-level colour grading to an off-screen canvas.
 * Shifts hue slightly, boosts contrast, crushes shadows, lifts highlights.
 * Returns a new ImageData to put back onto the canvas.
 */
function applyColourGrade(ctx, W, H) {
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  const preset  = (_imageTint && _imageTint.preset)  || 'cinematic';
  const opacity = (_imageTint && _imageTint.opacity != null) ? _imageTint.opacity : 0.5;

  /* ── 'none' = return pixel data untouched ── */
  if (preset === 'none') return imgData;

  for (let i = 0; i < d.length; i += 4) {
    const or = d[i], og = d[i+1], ob = d[i+2];  // original pixel
    let r = or, g = og, b = ob;
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

    if (preset === 'cinematic') {
      /* Original cinematic teal-orange grade */
      if (lum < 0.45) { r = r * 0.82; g = g * 0.98; b = Math.min(255, b * 1.12); }
      else            { r = Math.min(255, r * 1.08); g = g * 1.02; b = b * 0.88; }
      r = sCurve(r); g = sCurve(g); b = sCurve(b);
      const avg = (r + g + b) / 3, sat = 1.22;
      r = Math.min(255, Math.max(0, avg + (r - avg) * sat));
      g = Math.min(255, Math.max(0, avg + (g - avg) * sat));
      b = Math.min(255, Math.max(0, avg + (b - avg) * sat));

    } else if (preset === 'warm') {
      r = Math.min(255, r * 1.12 + 10);
      g = Math.min(255, g * 1.04);
      b = Math.max(0, b * 0.82);
      r = sCurve(r); g = sCurve(g); b = sCurve(b);

    } else if (preset === 'cool') {
      r = Math.max(0, r * 0.85);
      g = Math.min(255, g * 1.02);
      b = Math.min(255, b * 1.18 + 8);
      r = sCurve(r); g = sCurve(g); b = sCurve(b);

    } else if (preset === 'dramatic') {
      r = sCurve(sCurve(r)); g = sCurve(sCurve(g)); b = sCurve(sCurve(b));
      const avg2 = (r + g + b) / 3, sat2 = 0.55;
      r = Math.min(255, Math.max(0, avg2 + (r - avg2) * sat2));
      g = Math.min(255, Math.max(0, avg2 + (g - avg2) * sat2));
      b = Math.min(255, Math.max(0, avg2 + (b - avg2) * sat2));
      r = Math.min(255, r * 0.88 + 5);
      g = Math.min(255, g * 0.90);
      b = Math.min(255, b * 1.06 + 5);

    } else if (preset === 'vintage') {
      r = Math.min(255, r * 1.06 + 15);
      g = Math.min(255, g * 0.96 + 8);
      b = Math.max(0, b * 0.75 + 20);
      const avg3 = (r + g + b) / 3, sat3 = 0.80;
      r = Math.min(255, Math.max(0, avg3 + (r - avg3) * sat3));
      g = Math.min(255, Math.max(0, avg3 + (g - avg3) * sat3));
      b = Math.min(255, Math.max(0, avg3 + (b - avg3) * sat3));

    } else if (preset === 'noir') {
      const grey = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      const gc   = sCurve(sCurve(grey));
      r = gc; g = gc; b = gc;

    } else if (preset === 'golden') {
      r = Math.min(255, r * 1.18 + 18);
      g = Math.min(255, g * 1.06 + 5);
      b = Math.max(0, b * 0.68);
      r = sCurve(r); g = sCurve(g); b = sCurve(b);

    } else if (preset === 'custom') {
      const tc = _hexToRgb(_imageTint.custom || '#ff6600');
      r = Math.round(or * (1 - opacity) + tc.r * opacity);
      g = Math.round(og * (1 - opacity) + tc.g * opacity);
      b = Math.round(ob * (1 - opacity) + tc.b * opacity);
      r = sCurve(r); g = sCurve(g); b = sCurve(b);
      d[i] = r; d[i+1] = g; d[i+2] = b;
      continue;  // already blended, skip blend below
    }

    /* Blend graded result with original pixel according to opacity slider */
    d[i]   = Math.round(or * (1 - opacity) + r * opacity);
    d[i+1] = Math.round(og * (1 - opacity) + g * opacity);
    d[i+2] = Math.round(ob * (1 - opacity) + b * opacity);
  }
  return imgData;
}

/* Parse '#rrggbb' or '#rgb' into {r,g,b} */
function _hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(x => x+x).join('');
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/* Expose tint controls to HTML */
function setImageTintPreset(preset) {
  _imageTint.preset = preset;
  /* Highlight active chip */
  document.querySelectorAll('.tint-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.tint === preset));
  const customRow = document.getElementById('tintCustomRow');
  /* Show intensity slider for every preset except 'none' */
  if (customRow) customRow.style.display = (preset === 'none') ? 'none' : 'flex';
  fastRedraw();
}

function setImageTintCustom(hex) {
  _imageTint.custom  = hex;
  _imageTint.preset  = 'custom';
  document.querySelectorAll('.tint-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.tint === 'custom'));
  const customRow = document.getElementById('tintCustomRow');
  if (customRow) customRow.style.display = 'flex';
  fastRedraw();
}

function setImageTintOpacity(val) {
  _imageTint.opacity = parseFloat(val);
  const lbl = document.getElementById('tintOpacityVal');
  if (lbl) lbl.textContent = Math.round(val * 100) + '%';
  fastRedraw();
}

function resetImageTint() {
  _imageTint.preset  = 'none';
  _imageTint.opacity = 0.5;
  document.querySelectorAll('.tint-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.tint === 'none'));
  const customRow = document.getElementById('tintCustomRow');
  if (customRow) customRow.style.display = 'none';
  const opSlider = document.getElementById('tintOpacitySlider');
  if (opSlider) opSlider.value = 0.5;
  const lbl = document.getElementById('tintOpacityVal');
  if (lbl) lbl.textContent = '50%';
  fastRedraw();
}

/* ── Extra Text Labels (dynamic) ────────────────────────────────── */
function _drawExtraTexts(ctx, W, H) {
  _extraTexts.forEach(et => {
    if (!et.text.trim()) return;
    /* Determine the canvas-space position.
       New format uses sprite-compatible x/y/w/h/rot.
       Legacy format uses px/py or posX/posY presets. */
    let cx, cy, bw, bh, rot;
    if (et.x != null && et.w != null) {
      /* New sprite-model format */
      cx  = et.x + et.w / 2;
      cy  = et.y + et.h / 2;
      bw  = et.w;
      bh  = et.h;
      rot = et.rot || 0;
    } else {
      /* Legacy fallback */
      const padX = 60;
      cx = (et.px != null) ? et.px : W / 2;
      let y;
      if (et.py != null) y = et.py;
      else if (et.posY === 'top') y = 140;
      else if (et.posY === 'bottom') y = H - 220;
      else y = H * 0.45;
      cy  = y;
      bw  = W - padX * 2;
      bh  = (et.size || 32) * 2;
      rot = 0;
    }

    const size = et.size || 32;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    /* ── Background fill (optional) ── */
    if (et.bgColor && et.bgColor !== 'transparent' && et.bgColor !== '#00000000') {
      const padX = 18, padY = 10;
      ctx.shadowColor = 'rgba(0,0,0,0)';  // no shadow on bg rect
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = et.bgColor;
      /* Rounded rect */
      const rx = -bw / 2 - padX, ry = -bh / 2 - padY;
      const rw = bw + padX * 2,  rh = bh + padY * 2, rr = 12;
      ctx.beginPath();
      ctx.moveTo(rx + rr, ry);
      ctx.lineTo(rx + rw - rr, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rr, rr);
      ctx.lineTo(rx + rw, ry + rh - rr);
      ctx.arcTo(rx + rw, ry + rh, rx + rw - rr, ry + rh, rr);
      ctx.lineTo(rx + rr, ry + rh);
      ctx.arcTo(rx, ry + rh, rx, ry + rh - rr, rr);
      ctx.lineTo(rx, ry + rr);
      ctx.arcTo(rx, ry, rx + rr, ry, rr);
      ctx.closePath();
      ctx.fill();
    }

    ctx.font         = `${et.bold ? 'bold ' : ''}${size}px "Segoe UI",Arial,sans-serif`;
    ctx.fillStyle    = et.color || '#ffffff';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur   = 14;
    /* Wrap text inside the bounding box */
    wrapText(ctx, et.text, 0, 0, bw - 20, size * 1.35, Math.max(1, Math.floor(bh / (size * 1.35))));
    ctx.restore();
  });
}

/** Add a new extra text label and render its card in the UI */
function addExtraText() {
  const id  = _nextTextId++;
  const col = (_extraTexts.length % 5) * 80;   // stagger vertically
  const w   = 400, h = 70;
  _extraTexts.push({
    id, text: 'New Text', size: 40, color: '#ffffff', bgColor: 'transparent', bold: false,
    /* Sprite-compatible positioning fields */
    x: (CANVAS_W - w) / 2, y: Math.round(CANVAS_H * 0.40) + col,
    w, h, rot: 0,
    /* Keep legacy preset fields for backward compat */
    posX: 'center', posY: 'middle', px: null, py: null
  });
  _selectedTextId = id;
  _renderExtraTextList();
  if (window._ensureHandleCanvasVisible) window._ensureHandleCanvasVisible();
  fastRedraw();
}

/** Remove a text label by id */
function removeExtraText(id) {
  _extraTexts = _extraTexts.filter(et => et.id !== id);
  if (_selectedTextId === id) _selectedTextId = null;
  _renderExtraTextList();
  /* Hide handle canvas if nothing needs it */
  if (!_enhancedMode && !_compositeMode && _extraTexts.length === 0) _showCompositeHandles(false);
  fastRedraw();
}

/** Update a field on a text label */
function updateExtraText(id, field, val) {
  const et = _extraTexts.find(e => e.id === id);
  if (!et) return;
  if (field === 'size') val = parseInt(val, 10) || 32;
  if (field === 'bold') val = !!val;
  et[field] = val;
  /* sync size readout */
  if (field === 'size') {
    const lbl = document.querySelector(`[data-txt-id="${id}"] .txt-size-val`);
    if (lbl) lbl.textContent = val + 'px';
  }
  /* sync bg colour picker opacity */
  if (field === 'bgColor') {
    const picker = document.querySelector(`[data-bg-picker="${id}"]`);
    if (picker) picker.style.opacity = (val && val !== 'transparent') ? '1' : '0.4';
  }
  fastRedraw();
}

/** Rebuild the extra-text list UI */
function _renderExtraTextList() {
  const list = document.getElementById('extraTextList');
  if (!list) return;
  list.innerHTML = '';
  _extraTexts.forEach((et, idx) => {
    const card = document.createElement('div');
    card.className = 'extra-text-card';
    card.dataset.txtId = et.id;
    /* Resolve bg colour: 'transparent' → '#000000' with opacity trick for the picker;
       we store 'transparent' as a sentinel meaning "no background" */
    const bgPickerVal = (!et.bgColor || et.bgColor === 'transparent') ? '#000000' : et.bgColor;
    const bgPickerEnabled = et.bgColor && et.bgColor !== 'transparent';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:.68rem;font-weight:700;color:#818cf8;min-width:18px">#${idx+1}</span>
        <input type="text" value="${escHtml(et.text)}" placeholder="Enter text…" maxlength="120"
          style="flex:1;min-width:100px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);font-size:.75rem"
          oninput="updateExtraText(${et.id},'text',this.value)">
        <label title="Bold" style="cursor:pointer;font-size:.7rem;color:var(--muted)">
          <input type="checkbox" ${et.bold?'checked':''} onchange="updateExtraText(${et.id},'bold',this.checked)"> <strong>B</strong>
        </label>
        <button class="btn btn-ghost" style="padding:2px 7px;font-size:.7rem;color:#f87171;border-color:rgba(248,113,113,.3)"
          onclick="removeExtraText(${et.id})" title="Remove">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:5px;padding-left:24px">
        <label style="display:flex;align-items:center;gap:4px;font-size:.67rem;color:var(--muted);cursor:pointer" title="Text (foreground) colour">
          <span style="font-size:.7rem">🔤</span> Text
          <input type="color" value="${et.color || '#ffffff'}" title="Text colour"
            style="width:28px;height:24px;padding:0;border:none;border-radius:5px;cursor:pointer"
            oninput="updateExtraText(${et.id},'color',this.value)">
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:.67rem;color:var(--muted);cursor:pointer" title="Background colour">
          <span style="font-size:.7rem">🎨</span> BG
          <input type="checkbox" title="Enable background colour" ${bgPickerEnabled?'checked':''}
            onchange="updateExtraText(${et.id},'bgColor', this.checked ? document.querySelector('[data-bg-picker=\\'${et.id}\\']').value : 'transparent')">
          <input type="color" value="${bgPickerVal}" data-bg-picker="${et.id}" title="Background colour"
            style="width:28px;height:24px;padding:0;border:none;border-radius:5px;cursor:pointer;${bgPickerEnabled?'':'opacity:0.4'}"
            oninput="updateExtraText(${et.id},'bgColor',this.value)">
        </label>
        <label style="font-size:.67rem;color:var(--muted)">Size
          <input type="range" min="14" max="120" value="${et.size}"
            style="width:65px;vertical-align:middle;accent-color:#818cf8"
            oninput="updateExtraText(${et.id},'size',this.value)">
          <span class="txt-size-val" style="font-size:.67rem;color:#818cf8;font-weight:700">${et.size}px</span>
        </label>
      </div>`;
    list.appendChild(card);
  });
}

function resetExtraTexts() {
  _extraTexts = [];
  _selectedTextId = null;
  _renderExtraTextList();
  if (!_enhancedMode && !_compositeMode) _showCompositeHandles(false);
  fastRedraw();
}

function sCurve(v) {
  /* Maps 0-255 through a gentle S-curve for contrast */
  const x = v / 255;
  const out = x < 0.5
    ? 2 * x * x
    : 1 - Math.pow(-2 * x + 2, 2) / 2;
  return Math.min(255, Math.max(0, Math.round(out * 255)));
}

/**
 * Draw a shallow directional blur strip (simulated) at the horizon line
 * by painting a semi-transparent gradient band — adds motion/drama.
 */
function drawHorizonBlurStrip(ctx, W, H) {
  const cy = H * 0.52;
  const bh = H * 0.12;
  const grad = ctx.createLinearGradient(0, cy - bh, 0, cy + bh);
  grad.addColorStop(0,   'rgba(0,0,0,0)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, cy - bh, W, bh * 2);
}

function drawNewsImage(ctx, img, W, H) {
  /* ── 1. Off-screen canvas for colour grading + rotation/flip ── */
  const offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  const oct = offscreen.getContext('2d');

  /* Apply rotation & flip transforms */
  oct.save();
  oct.translate(W / 2, H / 2);
  if (imgRotation) oct.rotate(imgRotation * Math.PI / 180);
  if (imgFlipH) oct.scale(-1, 1);
  if (imgFlipV) oct.scale(1, -1);
  oct.translate(-W / 2, -H / 2);

  /* Scale-to-fill exactly — apply user zoom on top */
  const baseSc = Math.max(W / img.width, H / img.height);
  const scale  = baseSc * imgScale;
  const sw = img.width * scale, sh = img.height * scale;
  /* Centre the image, then apply user pan offsets */
  oct.drawImage(img,
    (W - sw) / 2 + imgOffsetX,
    (H - sh) / 2 + imgOffsetY,
    sw, sh);
  oct.restore();

  /* ── 2. Pixel colour grade (cinematic teal-orange look) ── */
  const graded = applyColourGrade(oct, W, H);
  oct.putImageData(graded, 0, 0);

  /* ── 3. Composite graded image onto main canvas ── */
  ctx.drawImage(offscreen, 0, 0);

  /* ── 4. Light brand colour-wash (subtle — keeps image visibility high) ── */
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0,   'rgba(100,10,10,0.10)');
  wash.addColorStop(0.5, 'rgba(0,0,0,0)');
  wash.addColorStop(1,   'rgba(10,10,60,0.12)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  /* ── 5. Vignette — lighter so image is clearly visible ── */
  const vignette = ctx.createRadialGradient(W/2, H/2, H * 0.22, W/2, H/2, H * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  /* ── 6. Bottom gradient — just enough for text legibility ── */
  const btmGrad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  btmGrad.addColorStop(0, 'rgba(0,0,0,0)');
  btmGrad.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = btmGrad;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  /* ── 7. Top dark gradient for banner legibility ── */
  const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.18);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.82)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, H * 0.18);

  /* ── 8. Breaking News banner — drawn separately after all image layers ── */
}

function _drawNewsBanner(ctx, W) {
  const BANNER_H = 118;

  /* ── Vivid gradient banner (deep crimson → bright orange-red) ── */
  const bannerGrad = ctx.createLinearGradient(0, 0, W, 0);
  const baseColor  = _textOpts.bannerColor || '#c0392b';
  bannerGrad.addColorStop(0,   baseColor === '#c0392b' ? '#b91c1c' : baseColor);
  bannerGrad.addColorStop(0.4, baseColor === '#c0392b' ? '#dc2626' : baseColor);
  bannerGrad.addColorStop(0.7, baseColor === '#c0392b' ? '#ef4444' : baseColor);
  bannerGrad.addColorStop(1,   baseColor === '#c0392b' ? '#f97316' : baseColor);
  ctx.fillStyle = bannerGrad;
  ctx.fillRect(0, 0, W, BANNER_H);

  /* ── Shiny gloss overlay (top half highlight) ── */
  const gloss = ctx.createLinearGradient(0, 0, 0, BANNER_H * 0.55);
  gloss.addColorStop(0, 'rgba(255,255,255,0.18)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, W, BANNER_H * 0.55);

  /* ── Left gold accent bar (wider + gradient) ── */
  const accentGrad = ctx.createLinearGradient(0, 0, 0, BANNER_H);
  accentGrad.addColorStop(0, '#fde68a');
  accentGrad.addColorStop(0.5, '#f59e0b');
  accentGrad.addColorStop(1, '#d97706');
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, 12, BANNER_H);

  /* ── Banner text with glow ── */
  const bannerLabel = _textOpts.bannerText || '🗞️  NEWS UPDATE';
  ctx.font = 'bold 52px "Segoe UI",Arial,sans-serif';
  ctx.textAlign = 'center';
  /* Glow layer */
  ctx.shadowColor = 'rgba(255,120,0,0.9)';
  ctx.shadowBlur  = 22;
  ctx.fillStyle   = '#fff7ed';
  ctx.fillText(bannerLabel, W / 2, 70);
  /* Crisp top layer */
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur  = 6;
  ctx.fillStyle   = '#ffffff';
  ctx.fillText(bannerLabel, W / 2, 70);
  ctx.shadowBlur  = 0;

  /* ── Bottom glowing rule ── */
  const ruleGrad = ctx.createLinearGradient(0, 0, W, 0);
  ruleGrad.addColorStop(0,   'rgba(253,230,138,0)');
  ruleGrad.addColorStop(0.2, 'rgba(253,230,138,0.9)');
  ruleGrad.addColorStop(0.8, 'rgba(253,230,138,0.9)');
  ruleGrad.addColorStop(1,   'rgba(253,230,138,0)');
  ctx.fillStyle = ruleGrad;
  ctx.fillRect(12, BANNER_H, W - 12, 3);

  /* ── Date stamp ── */
  const dateStr = new Date().toLocaleDateString('ne-NP', { year:'numeric', month:'short', day:'numeric' });
  ctx.font      = '20px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 20, 104);
  ctx.textAlign = 'center';
}

function drawBackground(ctx, W, H) {
  /* ── Rich deep gradient background (dark navy → deep maroon → dark slate) ── */
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0,    '#0f172a');
  grad.addColorStop(0.35, '#1e0a0a');
  grad.addColorStop(0.65, '#150e1f');
  grad.addColorStop(1,    '#0a1628');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  /* ── Subtle diagonal grid lines ── */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,60,60,0.05)';
  ctx.lineWidth = 1;
  for (let x = -H; x < W + H; x += 55) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
  }
  ctx.restore();

  /* ── Vivid radial glow — top-right crimson ── */
  const glow1 = ctx.createRadialGradient(W * 0.85, H * 0.1, 20, W * 0.85, H * 0.1, 320);
  glow1.addColorStop(0, 'rgba(220, 38, 38, 0.28)');
  glow1.addColorStop(1, 'rgba(220, 38, 38, 0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);

  /* ── Secondary glow — bottom-left violet/indigo ── */
  const glow2 = ctx.createRadialGradient(W * 0.15, H * 0.9, 10, W * 0.15, H * 0.9, 280);
  glow2.addColorStop(0, 'rgba(99, 38, 180, 0.22)');
  glow2.addColorStop(1, 'rgba(99, 38, 180, 0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  /* ── Bottom accent glow — warm amber ── */
  const glow3 = ctx.createRadialGradient(W * 0.5, H, 0, W * 0.5, H, 260);
  glow3.addColorStop(0, 'rgba(245, 158, 11, 0.15)');
  glow3.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = glow3;
  ctx.fillRect(0, 0, W, H);

  /* ── Top & bottom accent bars (vivid) ── */
  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0,   '#b91c1c');
  topBar.addColorStop(0.5, '#ef4444');
  topBar.addColorStop(1,   '#f97316');
  ctx.fillStyle = topBar;
  ctx.fillRect(0, 0, W, 10);

  const botBar = ctx.createLinearGradient(0, 0, W, 0);
  botBar.addColorStop(0,   '#f97316');
  botBar.addColorStop(0.5, '#ef4444');
  botBar.addColorStop(1,   '#b91c1c');
  ctx.fillStyle = botBar;
  ctx.fillRect(0, H - 10, W, 10);

  /* Banner drawn separately after all image layers — do NOT call here */
}

async function drawTextOverlay(ctx, post, W, H) {
  const pad = 54;
  const BANNER_BOTTOM = 116;   // keep text block below the banner

  /* ── Step 1: pick font size based on word count, then measure actual lines ── */
  const rawTitle = post.title || '';
  const wordCount = rawTitle.trim().split(/\s+/).filter(Boolean).length;

  /* Font size tiers — smaller font = more lines fit = more words visible */
  let titleSize;
  if      (wordCount <= 8)  titleSize = Math.min(_textOpts.titleSize || 62, 62);
  else if (wordCount <= 12) titleSize = Math.min(_textOpts.titleSize || 62, 54);
  else if (wordCount <= 16) titleSize = Math.min(_textOpts.titleSize || 62, 48);
  else if (wordCount <= 20) titleSize = Math.min(_textOpts.titleSize || 62, 42);
  else if (wordCount <= 25) titleSize = Math.min(_textOpts.titleSize || 62, 36);
  else                      titleSize = Math.min(_textOpts.titleSize || 62, 30);

  const TITLE_LINE_H = Math.round(titleSize * 1.28);
  const titleColor   = _textOpts.titleColor || '#ffffff';

  /* ── Step 2: measure how many lines the title actually needs ──
     Use canvas measurement with the chosen font — no artificial cap here.
     Cap only to prevent the block from consuming more than 60% of canvas. */
  ctx.font = `bold ${titleSize}px "Segoe UI",Arial,sans-serif`;
  const maxW = W - pad * 2;
  const words = rawTitle.split(' ');
  let line = '', measuredLines = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      measuredLines++;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) measuredLines++;

  /* Hard cap: title block + padding must not exceed available canvas height */
  const BRAND_H    = 116;   // avatar (96px) + padding below
  const BOTTOM_PAD = 16;
  const TOP_PAD    = 36;
  const availableH = H - BANNER_BOTTOM - 40;  // space between banner and bottom
  const maxLinesFit = Math.max(1, Math.floor((availableH - TOP_PAD - 18 - BRAND_H - BOTTOM_PAD) / TITLE_LINE_H));
  const titleLineCount = Math.min(measuredLines, maxLinesFit);

  /* ── Step 3: compute block position ── */
  const blockH = TOP_PAD + titleLineCount * TITLE_LINE_H + 18 + BRAND_H + BOTTOM_PAD;
  const blockY = Math.max(BANNER_BOTTOM + 20, H - blockH);

  /* ── Gradient overlay — rich deep fade from bottom with warm tint ── */
  const grad = ctx.createLinearGradient(0, blockY - 140, 0, H);
  grad.addColorStop(0,    'rgba(0,0,0,0)');
  grad.addColorStop(0.12, 'rgba(10,5,20,0.65)');
  grad.addColorStop(0.35, 'rgba(15,5,10,0.88)');
  grad.addColorStop(0.7,  'rgba(10,2,8,0.96)');
  grad.addColorStop(1,    'rgba(5,0,5,0.99)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, blockY - 140, W, blockH + 140);

  /* Left accent bar — vivid gradient */
  const accentBar = ctx.createLinearGradient(0, blockY, 0, blockY + blockH);
  accentBar.addColorStop(0,   '#f97316');
  accentBar.addColorStop(0.5, '#ef4444');
  accentBar.addColorStop(1,   '#dc2626');
  ctx.fillStyle = accentBar;
  ctx.fillRect(0, blockY, 10, blockH);

  let y = blockY + TOP_PAD;

  /* ── Title ── */
  ctx.font = `bold ${titleSize}px "Segoe UI",Arial,sans-serif`;
  ctx.fillStyle = titleColor;
  ctx.textAlign = 'center';
  /* Warm glow pass */
  ctx.shadowColor = 'rgba(249,115,22,0.35)'; ctx.shadowBlur = 20;
  wrapText(ctx, rawTitle, W / 2, y, maxW, TITLE_LINE_H, titleLineCount);
  /* Crisp white pass */
  ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 14;
  const drawnLines = wrapText(ctx, rawTitle, W / 2, y, maxW, TITLE_LINE_H, titleLineCount);
  y += drawnLines * TITLE_LINE_H + 18;
  ctx.shadowBlur = 0;

  /* ── Branding watermark ── */
  const showNewsWatermark = document.getElementById('newsWatermark') ? document.getElementById('newsWatermark').checked : true;
  if (showNewsWatermark) {
    await _drawAuthorWatermark(ctx, W, y);
  }

  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';

  /* Border removed — clean, borderless image */
}

/**
 * Draw a horizontal branding strip pinned to the very bottom of the canvas.
 * Layout (left → right):  [avatar circle]  |  "Shashi News Gen"  ·  URL  ·  email
 * The strip is always at the canvas bottom regardless of title height.
 */
async function _drawAuthorWatermark(ctx, W, _titleBottom, label = 'News') {
  /* Wait for the avatar image to finish loading if it hasn't yet */
  if (!_authorImg && _authorImgPromise) await _authorImgPromise;

  const H           = ctx.canvas.height || CANVAS_H;
  const wScale      = Math.min(W / 600, 1);     // scale factor for narrow canvases (Reel = 400px → 0.667)
  const STRIP_H     = Math.round(72 * Math.max(wScale, 0.65));  // shrink strip on narrow formats
  const AVATAR_R    = Math.round(26 * Math.max(wScale, 0.7));   // shrink avatar too
  const AVATAR_D    = AVATAR_R * 2;
  const PAD_L       = Math.round(22 * Math.max(wScale, 0.7));   // left padding
  const stripY      = H - STRIP_H;             // strip top-y

  ctx.save();

  /* ── Semi-transparent dark strip across full width ── */
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, stripY, W, STRIP_H);

  /* ── Thin gold separator line at top of strip ── */
  ctx.strokeStyle = 'rgba(246,173,85,0.55)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, stripY); ctx.lineTo(W, stripY);
  ctx.stroke();

  /* ── Avatar circle (left side) ── */
  const avCX = PAD_L + AVATAR_R;
  const avCY = stripY + STRIP_H / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avCX, avCY, AVATAR_R, 0, Math.PI * 2);
  ctx.clip();
  if (_authorImg) {
    const srcW = _authorImg.naturalWidth, srcH = _authorImg.naturalHeight;
    const cropSize = Math.min(srcW, srcH);
    const cropX = (srcW - cropSize) / 2;
    const cropY = (srcH - cropSize) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(_authorImg, cropX, cropY, cropSize, cropSize,
                  avCX - AVATAR_R, avCY - AVATAR_R, AVATAR_D, AVATAR_D);
  } else {
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(avCX - AVATAR_R, avCY - AVATAR_R, AVATAR_D, AVATAR_D);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${AVATAR_R}px "Segoe UI",Arial,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SJ', avCX, avCY);
  }
  ctx.restore();

  /* Gold ring around avatar */
  ctx.beginPath();
  ctx.arc(avCX, avCY, AVATAR_R + 2.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#f6ad55';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  /* ── Text block (right of avatar, vertically centred in strip) ── */
  const textX     = avCX + AVATAR_R + 16;   // start of text area
  const nameY     = stripY + STRIP_H / 2 - 11;
  const detailY   = stripY + STRIP_H / 2 + 13;

  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur  = 6;
  ctx.textAlign   = 'left';
  ctx.textBaseline = 'alphabetic';

  /* Brand name */
  ctx.font      = `bold ${Math.round(22 * Math.max(wScale, 0.7))}px "Segoe UI",Arial,sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillText(`Shashi Creator Studio — ${label}`, textX, nameY);

  /* URL + email — split into two lines on narrow canvases (< 500px) */
  const SITE_URL = 'shajais.github.io/ShashiNewsGen';
  const EMAIL    = 'shashi19.jaiswal@gmail.com';
  ctx.font      = `${Math.round(14 * Math.max(wScale, 0.7))}px "Segoe UI",Arial,sans-serif`;
  ctx.fillStyle = 'rgba(246,173,85,0.90)';
  if (W < 500) {
    /* Two lines: URL on nameY row gap, email below */
    ctx.fillText(`🌐 ${SITE_URL}`, textX, detailY);
    const emailY = detailY + Math.round(16 * Math.max(wScale, 0.7));
    ctx.fillText(`✉ ${EMAIL}`, textX, emailY);
  } else {
    ctx.fillText(`🌐 ${SITE_URL}   ✉ ${EMAIL}`, textX, detailY);
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

/* ─── Text Editor Modal ───────────────────────────────────────── */

function openTextEditor() {
  const modal = document.getElementById('textEditorModal');
  if (!modal) return;

  // Populate fields from current state
  const bannerInput = document.getElementById('teBanner');
  const titleInput  = document.getElementById('teTitle');
  const sizeSlider  = document.getElementById('teFontSize');
  const sizeLabel   = document.getElementById('teFontSizeVal');

  if (bannerInput) bannerInput.value = _textOpts.bannerText;
  if (titleInput)  titleInput.value  = generatedPost ? (generatedPost.title || '') : '';
  if (sizeSlider)  sizeSlider.value  = _textOpts.titleSize;
  if (sizeLabel)   sizeLabel.textContent = _textOpts.titleSize + 'px';

  // Sync title colour chips
  document.querySelectorAll('.te-colour-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.colour === _textOpts.titleColor);
  });

  // Sync banner colour chips
  document.querySelectorAll('.te-banner-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.colour === _textOpts.bannerColor);
  });

  modal.classList.add('open');
}

function closeTextEditor() {
  const modal = document.getElementById('textEditorModal');
  if (modal) modal.classList.remove('open');
}

function applyTextEdits() {
  const bannerInput = document.getElementById('teBanner');
  const titleInput  = document.getElementById('teTitle');
  const sizeSlider  = document.getElementById('teFontSize');

  if (bannerInput) {
    _textOpts.bannerText = bannerInput.value.trim() || '🚨  BREAKING NEWS';
  }
  if (sizeSlider) {
    _textOpts.titleSize = parseInt(sizeSlider.value, 10) || 62;
  }
  if (titleInput && titleInput.value.trim() && generatedPost) {
    generatedPost.title = titleInput.value.trim();
  }

  closeTextEditor();

  fastRedraw();

  if (typeof toast === 'function') toast('✅ Text updated!', 'success', 2000);
}

/** Update font size preview label as slider moves */
function onFontSizeSlide(val) {
  const label = document.getElementById('teFontSizeVal');
  if (label) label.textContent = val + 'px';
}

/** Title colour chip click */
function selectTextColour(el) {
  document.querySelectorAll('.te-colour-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _textOpts.titleColor = el.dataset.colour;
}

/** Title custom colour-picker change */
function setCustomTextColour(val) {
  document.querySelectorAll('.te-colour-chip').forEach(c => c.classList.remove('active'));
  _textOpts.titleColor = val;
}

/** Banner colour chip click */
function selectBannerColour(el) {
  document.querySelectorAll('.te-banner-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _textOpts.bannerColor = el.dataset.colour;
}

/** Banner custom colour-picker change */
function setCustomBannerColour(val) {
  document.querySelectorAll('.te-banner-chip').forEach(c => c.classList.remove('active'));
  _textOpts.bannerColor = val;
}

/* ──────────────────────────────────────────────────────────────── */

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  if (!text) return 0;
  const words = text.split(' ');
  let line = '', count = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + count * lineH);
      count++;
      if (count >= maxLines) return count;
      line = word;
    } else { line = test; }
  }
  if (line) { ctx.fillText(line, x, y + count * lineH); count++; }
  return count;
}

/* ================================================================
   FEATURE 4 – DOWNLOAD IMAGE
================================================================ */
function downloadImage() {
  /* Deselect sprite + hide handle overlay so handles don't appear in the download */
  const prevSelected = _selectedSpriteId;
  _selectedSpriteId = null;
  const hc = document.getElementById('compositeHandleCanvas');
  const hcWasVisible = hc && hc.style.display !== 'none';
  if (hc) { hc.style.display = 'none'; hc.style.pointerEvents = 'none'; }

  try {
    const link    = document.createElement('a');
    link.download = 'nepal-news-' + Date.now() + '.png';
    link.href     = document.getElementById('newsCanvas').toDataURL('image/png');
    link.click();
    toast('⬇️ Image downloaded!', 'success');
  } catch (e) {
    /* Cross-origin tainted canvas — open in new tab so user can save manually */
    toast('⚠️ Right-click the image → Save As to download', 'info', 5000);
    try {
      const win = window.open();
      if (win) win.document.write('<img src="' + document.getElementById('newsCanvas').toDataURL('image/png') + '" style="max-width:100%">');
    } catch {}
  } finally {
    /* Restore handle overlay and selection */
    _selectedSpriteId = prevSelected;
    if (hc && hcWasVisible) { hc.style.display = 'block'; hc.style.pointerEvents = 'auto'; }
    if (_compositeMode) _drawCompositeHandles();
  }
}

/* ================================================================
   FEATURE 5 – POST TEXT & SHARING
================================================================ */

/**
 * Share the complete post (text + generated image) using the
 * Web Share API (supported on mobile browsers and some desktop).
 * Falls back to download + copy if Web Share is not available.
 */
async function shareWithImage() {
  if (!generatedPost) { toast('⚠️ पहिले समाचार छान्नुहोस्।', 'error'); return; }

  const text = buildPostText(generatedPost, selectedArticle?.title, { includeUrl: false });
  const canvas = document.getElementById('newsCanvas');

  /* Hide handles during export */
  const prevSelected = _selectedSpriteId;
  _selectedSpriteId = null;
  const hc = document.getElementById('compositeHandleCanvas');
  const hcWasVisible = hc && hc.style.display !== 'none';
  if (hc) { hc.style.display = 'none'; hc.style.pointerEvents = 'none'; }

  try {
    /* Convert canvas to blob */
    const blob = await new Promise((resolve, reject) => {
      try { canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas empty')), 'image/png'); }
      catch(e) { reject(e); }
    });

    const file = new File([blob], 'shashinewsgen-' + Date.now() + '.png', { type: 'image/png' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      /* ✅ Web Share API with image (mobile/modern desktop) */
      await navigator.share({ text, files: [file] });
      toast('✅ साझा गरियो!', 'success');
    } else if (navigator.share) {
      /* Web Share without file (older browsers) — share text only */
      await navigator.share({ text });
      toast('✅ Text साझा गरियो! Image छुट्टै download गर्नुहोस्।', 'success');
    } else {
      /* ❌ No Web Share API — copy text + trigger download */
      try { await navigator.clipboard.writeText(text); } catch {}
      /* Trigger download */
      const link = document.createElement('a');
      link.download = 'shashinewsgen-' + Date.now() + '.png';
      link.href = URL.createObjectURL(blob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      toast('✅ Text copied + Image downloaded! Social media मा paste गर्नुहोस्।', 'success', 5000);
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      /* Canvas tainted — fall back to text-only */
      try { await navigator.clipboard.writeText(text); } catch {}
      toast('⚠️ Text copied! Image generate गरेपछि पुनः प्रयास गर्नुहोस्।', 'info', 4000);
    }
  } finally {
    _selectedSpriteId = prevSelected;
    if (hc && hcWasVisible) { hc.style.display = 'block'; hc.style.pointerEvents = 'auto'; }
    if (_compositeMode) _drawCompositeHandles();
  }
}
function getNewsIcon(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('flood') || t.includes('rain') || t.includes('landslide') || t.includes('बाढी') || t.includes('पहिरो')) return '🌧️';
  if (t.includes('earthquake') || t.includes('भूकम्प'))  return '🌍';
  if (t.includes('election') || t.includes('vote') || t.includes('निर्वाचन'))     return '🗳️';
  if (t.includes('economy') || t.includes('price') || t.includes('nrb') || t.includes('अर्थ')) return '💰';
  if (t.includes('accident') || t.includes('road') || t.includes('दुर्घटना'))     return '🚨';
  if (t.includes('health') || t.includes('hospital') || t.includes('स्वास्थ्य'))  return '🏥';
  if (t.includes('school') || t.includes('education') || t.includes('शिक्षा'))    return '🎓';
  if (t.includes('police') || t.includes('crime') || t.includes('प्रहरी'))        return '🚔';
  if (t.includes('cricket') || t.includes('football') || t.includes('क्रिकेट'))  return '🏆';
  if (t.includes('fire') || t.includes('आगलागी'))  return '🔥';
  if (t.includes('government') || t.includes('prime') || t.includes('minister') || t.includes('सरकार')) return '🏛️';
  if (t.includes('nepal') || t.includes('kathmandu') || t.includes('नेपाल'))      return '🇳🇵';
  return '📰';
}

const BRAND_NAME = 'Shashi Creator Studio 🇳🇵';
const BRAND_URL  = 'https://shajais.github.io/ShashiNewsGen/';

function buildPostText(post, rawTitle, { includeUrl = true } = {}) {
  const icon   = getNewsIcon(rawTitle || post.title || '');
  const credit = includeUrl
    ? `— ${BRAND_NAME}\n🌐 ${BRAND_URL}`
    : `— ${BRAND_NAME}`;
  return `${icon} ${post.title}\n\n${post.description}\n\n${post.hashtags.join(' ')}\n\n${credit}`;
}

function getPostText() {
  return generatedPost ? buildPostText(generatedPost, selectedArticle?.title, { includeUrl: false }) : '';
}

/* Share helpers */
let _shareUrl = '', _shareTarget = '';

function shareOnFacebook() {
  if (!generatedPost) { toast('⚠️ पहिले समाचार छान्नुहोस्।','error'); return; }
  const text = buildPostText(generatedPost, selectedArticle?.title, { includeUrl: false });
  /* Auto-download the image so user can attach it on Facebook */
  setTimeout(() => { const btn = document.getElementById('downloadBtn'); if (btn) btn.click(); }, 600);
  _shareUrl    = 'https://www.facebook.com/';
  _shareTarget = 'facebook';
  openShareModal(
    '📘 Facebook मा साझा गर्नुहोस्',
    '✅ Text copied + Image downloading!\n\nFacebook खुल्नेछ → "Photo/Video" post बनाउनुस् → downloaded image select गर्नुस् → caption Paste गर्नुस्।\n\n💡 Image watermark मा website URL छ — by Shashi News Gen',
    text
  );
}

function shareOnInstagram() {
  if (!generatedPost) { toast('⚠️ पहिले समाचार छान्नुहोस्।','error'); return; }
  const caption = buildPostText(generatedPost, selectedArticle?.title, { includeUrl: false });
  setTimeout(() => { const btn = document.getElementById('downloadBtn'); if (btn) btn.click(); }, 400);
  _shareUrl    = 'https://www.instagram.com/';
  _shareTarget = 'instagram';
  openShareModal(
    '📸 Instagram मा साझा गर्नुहोस्',
    '✅ Caption copied + Image downloading!\n\n① Downloaded image Instagram app मा खोल्नुहोस्।\n② New Post/Story → image select → caption Paste गर्नुस्।\n\n📱 Mobile मा राम्रो काम गर्छ',
    caption
  );
}

function shareOnX() {
  if (!generatedPost) { toast('⚠️ पहिले समाचार छान्नुहोस्।','error'); return; }
  const post = generatedPost;
  const tweet = `📢 ${post.title}\n\n${post.hashtags.slice(0, 3).join(' ')}\n\n— ${BRAND_NAME}`;
  setTimeout(() => { const btn = document.getElementById('downloadBtn'); if (btn) btn.click(); }, 400);
  _shareUrl    = `https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
  _shareTarget = 'x';
  openShareModal(
    '𝕏 X (Twitter) मा साझा गर्नुहोस्',
    '✅ Tweet ready + Image downloading!\n\n"Share Now" थिच्नुहोस् → X खुल्छ → downloaded image पनि attach गर्न सक्नुहुन्छ।',
    tweet
  );
}

function openShareModal(title, note, preview) {
  navigator.clipboard.writeText(preview).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = preview; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
  document.getElementById('shareModalTitle').textContent  = title;
  document.getElementById('shareModalNote').textContent   = note;
  document.getElementById('sharePreviewText').textContent = preview;
  document.getElementById('shareModal').classList.add('open');
}
function closeShareModal() { document.getElementById('shareModal').classList.remove('open'); }
function openShareWindow() { window.open(_shareUrl,'_blank','noopener,noreferrer,width=700,height=520'); closeShareModal(); }

function openCopyModal() {
  if (!generatedPost) { toast('⚠️ Generate content first.','error'); return; }
  document.getElementById('modalText').textContent = buildPostText(generatedPost, selectedArticle?.title);
  document.getElementById('copyModal').classList.add('open');
}
function closeCopyModal() { document.getElementById('copyModal').classList.remove('open'); }

async function copyText() {
  const txt = document.getElementById('modalText').textContent;
  try { await navigator.clipboard.writeText(txt); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }
  toast('✅ Copied to clipboard!', 'success');
  closeCopyModal();
}

/* ── Modal backdrop close ────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('shareModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeShareModal(); });
  document.getElementById('copyModal').addEventListener('click',  e => { if (e.target === e.currentTarget) closeCopyModal(); });
  document.getElementById('aiSettingsModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAISettings(); });
  document.getElementById('manualModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeManualModal(); });
  /* Update AI badge based on stored key */
  updateAIBadge();
  /* Auto-load news on page load / refresh */
  fetchNews();
});

/* ================================================================
   FEATURE 6 – INLINE FIELD EDITING (Hook / Title / Description)
================================================================ */

const _EDIT_MAP = {
  hook  : { display: 'outHook',  input: 'editHook',  editBtn: 'editBtnHook',  saveBtn: 'saveBtnHook',  cancelBtn: 'cancelBtnHook',  reimagineBtn: 'reimagineBtnHook',  postKey: 'hook'  },
  title : { display: 'outTitle', input: 'editTitle', editBtn: 'editBtnTitle', saveBtn: 'saveBtnTitle', cancelBtn: 'cancelBtnTitle', reimagineBtn: 'reimagineBtnTitle', postKey: 'title' },
  desc  : { display: 'outDesc',  input: 'editDesc',  editBtn: 'editBtnDesc',  saveBtn: 'saveBtnDesc',  cancelBtn: 'cancelBtnDesc',  reimagineBtn: 'reimagineBtnDesc',  postKey: 'description' },
};

/** Enter edit mode for a field (hook | title | desc) */
function startEdit(field) {
  if (!generatedPost) return;
  const m = _EDIT_MAP[field];
  const displayEl  = document.getElementById(m.display);
  const inputEl    = document.getElementById(m.input);

  /* Pre-fill textarea with current value */
  inputEl.value = generatedPost[m.postKey] || '';

  /* Swap display ↔ textarea */
  displayEl.style.display = 'none';
  inputEl.style.display   = 'block';
  inputEl.focus();
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);

  /* Toggle buttons */
  document.getElementById(m.editBtn).style.display      = 'none';
  document.getElementById(m.reimagineBtn).style.display = 'none';
  document.getElementById(m.saveBtn).style.display      = 'inline-flex';
  document.getElementById(m.cancelBtn).style.display    = 'inline-flex';
}

/**
 * AI Reimagine — rewrites a single field (hook | title | desc) with a
 * fresh creative take using Gemini. Uses a higher temperature for variety.
 */
/**
 * Update the AI/Template generation badges on each content field.
 * @param {boolean} aiUsed  - true = AI generated, false = template/fallback
 * @param {string}  providerLabel - e.g. '✨ Gemini'
 */
function setGenBadges(aiUsed, providerLabel) {
  const fields = ['Hook', 'Title', 'Desc', 'Hashtags'];
  for (const f of fields) {
    const badge = document.getElementById('badge' + f);
    if (!badge) continue;
    badge.style.display = '';
    if (aiUsed) {
      badge.className = 'gen-badge gen-badge-ai';
      badge.textContent = '✨ Gemini AI';
      badge.title = 'Content generated by Gemini AI — specific to this article';
    } else {
      badge.className = 'gen-badge gen-badge-template';
      badge.textContent = '📋 Template';
      badge.title = 'No AI key set — content generated using smart template system. Add Gemini API key for AI-generated content.';
    }
  }
}

/** Update badge for a single reimagined field */
function _setFieldBadgeAI(field) {
  const idMap = { hook: 'badgeHook', title: 'badgeTitle', desc: 'badgeDesc' };
  const badge = document.getElementById(idMap[field]);
  if (!badge) return;
  badge.style.display = '';
  badge.className = 'gen-badge gen-badge-ai';
  badge.textContent = '✨ Gemini AI';
  badge.title = 'Reimagined by Gemini AI';
}

async function reimagineField(field) {
  if (!generatedPost || !selectedArticle) {
    toast('⚠️ Please select an article first.', 'error'); return;
  }
  if (!_geminiKey && !_browserGeminiKey && !_browserGroqKey) {
    toast('⚙️ Setup your AI key first — click the AI button in the header.', 'error', 5000); return;
  }

  const m       = _EDIT_MAP[field];
  const btn     = document.getElementById(m.reimagineBtn);
  const display = document.getElementById(m.display);

  /* Show spinner on the button */
  const origHTML = btn.innerHTML;
  btn.innerHTML  = '<span class="spinner" style="width:12px;height:12px;border-width:2px;border-color:rgba(139,92,246,.3);border-top-color:#a78bfa"></span>';
  btn.disabled   = true;
  display.style.opacity = '0.4';

  const rawTitle    = selectedArticle.title || '';
  const bodySnippet = (selectedArticle.fullArticleText || selectedArticle.description || '').replace(/\s+/g, ' ').slice(0, 1000);
  const currentVal  = generatedPost[m.postKey] || '';

  /* The JSON key Gemini must return — matches _EDIT_MAP postKey */
  const jsonKey = m.postKey; /* 'hook', 'title', or 'description' */

  /* ── Field-specific prompts ── */
  let prompt = '';
  if (field === 'hook') {
    prompt = `You are a professional Nepali viral news editor.

NEWS STORY:
Title: ${rawTitle}
Body: ${bodySnippet}

TASK: Write ONE brand-new viral hook (opening line) for THIS specific news story.
The hook must be about the actual event, person, or place in this story — NOT generic.

RULES:
1. Must reference a specific detail from this story (name, place, incident, number)
2. Start with exactly 1 emoji that fits the mood (🔥😱💔⚡🚨😤🏆💣 etc.)
3. Maximum 20 Nepali words — punchy, emotional, makes people want to share
4. Nepali Devanagari script only
5. COMPLETELY different angle from existing hook — fresh emotion or perspective
6. FORBIDDEN: generic phrases like "नेपालमा ठूलो घटना", "यो समाचार हेर्नुस्", "ब्रेकिङ न्युज"
7. Existing hook (DO NOT copy): ${currentVal}

Return ONLY this JSON (no markdown, no explanation):
{"hook":"<your specific, emotional, story-relevant hook here>"}`;

  } else if (field === 'title') {
    prompt = `You are a professional Nepali SEO news editor.

NEWS STORY:
Title (source): ${rawTitle}
Body: ${bodySnippet}

TASK: Write ONE brand-new SEO headline for THIS specific story.

RULES:
1. Must contain the KEY noun from the story — actual person name, place, or event
2. Maximum 30 Nepali words
3. Nepali Devanagari script only
4. Factual, keyword-rich — reader must understand exactly what happened
5. COMPLETELY different structure and keywords from existing title
6. Existing title (DO NOT copy): ${currentVal}

Return ONLY this JSON (no markdown, no explanation):
{"title":"<your specific, keyword-rich headline here>"}`;

  } else if (field === 'desc') {
    prompt = `You are a professional Nepali news journalist.

NEWS STORY:
Title: ${rawTitle}
Body: ${bodySnippet}

TASK: Write a completely fresh description paragraph for this story.

RULES:
1. Nepali Devanagari script only
2. Exactly 3-4 sentences, 60-90 Nepali words total
3. Structure:
   - Sentence 1: What happened + who/where (use real names/places from the story)
   - Sentence 2: Key cause, context, or background detail
   - Sentence 3: Impact, reaction, or consequence
   - Sentence 4: Current status or what happens next
4. NEVER copy any sentence from the existing description or the source body
5. Existing description (DO NOT copy): ${currentVal}

Return ONLY this JSON (no markdown, no explanation):
{"description":"<your 3-4 sentence factual description here>"}`;
  }

  try {
    console.log(`[Reimagine] calling Gemini for field="${field}", jsonKey="${jsonKey}"`);
    const result = await callAI(prompt, 22000);

    /* callGemini now throws on any failure — if we get here, result is a parsed object */
    console.log('[Reimagine] parsed result keys:', Object.keys(result || {}));

    /* Try the exact key first, then try common aliases Gemini might return */
    let newVal = result?.[jsonKey];

    /* Fallback: Gemini sometimes returns "hook_text", "new_hook", "rewritten_title" etc. */
    if (!newVal) {
      const firstVal = Object.values(result || {}).find(v => typeof v === 'string' && v.trim().length > 4);
      if (firstVal) {
        console.warn(`[Reimagine] key "${jsonKey}" not found, using first string value:`, firstVal.slice(0, 60));
        newVal = firstVal;
      }
    }

    if (!newVal || newVal.trim().length < 5) {
      throw new Error(`Gemini returned no usable value for key "${jsonKey}". Got: ${JSON.stringify(result)}`);
    }

    /* Apply the new value */
    const cleaned = field === 'title' ? cleanTitle(newVal.trim()) : newVal.trim();
    generatedPost[m.postKey] = cleaned;
    display.textContent = cleaned;
    display.style.opacity = '1';

    /* Flash the card to signal success */
    display.classList.add('reimagine-flash');
    setTimeout(() => display.classList.remove('reimagine-flash'), 800);

    /* Update badge for this field to show AI */
    _setFieldBadgeAI(field);

    const fieldLabel = field === 'hook' ? 'Hook' : field === 'title' ? 'Title' : 'Description';
    toast(`✨ ${fieldLabel} reimagined by AI!`, 'success', 3000);

    /* Regenerate canvas if image is visible */
    if (document.getElementById('imagePanel').style.display !== 'none') generateImage();

  } catch (e) {
    console.error('[Reimagine] failed for field:', field, '—', e.message);
    display.style.opacity = '1';

    /* Show a meaningful error based on the prefixed error codes from callGemini */
    const em = e.message || '';
    let userMsg;
    if      (em.includes('NO_KEY'))          userMsg = '⚙️ Gemini API key not set — click the AI button to add it.';
    else if (em.includes('HTTP_400') || em.includes('API key'))  userMsg = '❌ Invalid Gemini API key — click AI to fix it.';
    else if (em.includes('HTTP_429'))        userMsg = '⏳ Rate limit hit — wait 60 s and try again.';
    else if (em.includes('HTTP_5'))          userMsg = '❌ Gemini service unavailable — try again shortly.';
    else if (em.includes('TIMEOUT'))         userMsg = '⏱️ Request timed out — check your internet connection.';
    else if (em.includes('NO_JSON'))         userMsg = '❌ AI gave bad response format — tap Reimagine again.';
    else if (em.includes('no usable value')) userMsg = '❌ AI returned empty value — tap Reimagine again.';
    else                                     userMsg = `❌ Reimagine failed: ${em.slice(0, 80)}`;

    toast(userMsg, 'error', 5000);
  }

  btn.innerHTML = origHTML;
  btn.disabled  = false;
}

/** Save edited value and regenerate image */
function saveEdit(field) {
  if (!generatedPost) return;
  const m = _EDIT_MAP[field];
  const displayEl = document.getElementById(m.display);
  const inputEl   = document.getElementById(m.input);

  const newVal = inputEl.value.trim();
  if (newVal) {
    generatedPost[m.postKey] = newVal;
    displayEl.textContent = newVal;
    /* If title changed, also clean it */
    if (field === 'title') displayEl.textContent = cleanTitle(newVal);
  }

  _closeEditMode(m);
  toast('✅ Saved! Image updated.', 'success');

  /* Regenerate canvas with updated text */
  if (selectedArticle && generatedPost) generateImage();
}

/** Cancel edit — restore original display */
function cancelEdit(field) {
  const m = _EDIT_MAP[field];
  _closeEditMode(m);
}

function _closeEditMode(m) {
  const displayEl = document.getElementById(m.display);
  const inputEl   = document.getElementById(m.input);
  inputEl.style.display   = 'none';
  displayEl.style.display = 'block';
  document.getElementById(m.editBtn).style.display      = 'inline-flex';
  document.getElementById(m.reimagineBtn).style.display = 'inline-flex';
  document.getElementById(m.saveBtn).style.display      = 'none';
  document.getElementById(m.cancelBtn).style.display    = 'none';
}

/* ================================================================
   STARTUP CHECKS
================================================================ */
(function onStartup() {
  /* Show red CORS warning banner if opened as file:// */
  if (location.protocol === 'file:') {
    const warn = document.getElementById('corsWarning');
    if (warn) warn.style.display = 'block';
    console.warn(
      '%c⚠️ CORS Warning',
      'color:red;font-size:16px;font-weight:bold',
      '\nAI features are blocked because you opened index.html directly as a file.\n' +
      'Fix: open a terminal in the project folder and run:\n\n  python server.py\n\n' +
      'Then open: http://localhost:3000'
    );
  }

  /* Fetch key availability from the server and update the AI badge.
     Keys live only in .env — the browser never sees the actual values. */
  loadKeyStatus();

  /* Retry every 10 seconds if server was offline at startup */
  setInterval(async () => {
    if (!_serverOnline && _isNodeServer) {
      await loadKeyStatus();
    }
  }, 10000);
})();

/* ================================================================
   MEME STUDIO  (global scope — called from HTML onclick handlers)
   v2  — Live trending from headlines + article-URL input
       — Canvas matches news image format:
           dark gradient BG · red top "😂 MEME" banner · avatar watermark strip
       — Gemini AI generates meme text; local templates as fallback
       — Images: Unsplash Source CDN + upload + solid BG
       — Download / copy / share
================================================================ */

/* ── State ── */
let _memeImgObj     = null;   // kept for legacy compat (single bg)
let _memeSlots      = [];     // [{type:'img'|'color', img:Image|null, color:string|null, panX:0, panY:0}]  up to 4
let _memeSelSlotIdx = -1;     // index of currently selected slot panel for panning
let _memeTextColor  = '#ffffff';
let _memeFontFamily = 'Impact';
let _memeCanvasW    = 600;
let _memeCanvasH    = 600;

/* ── Overlay images state (up to 4) ── */
let _memeOverlays      = [];   // [{img, x, y, w, h, circle, locked}]  locked=auto-layout
let _memeSelOverlayIdx = -1;
let _memeDragState     = null; // {type:'overlay'|'text', idx, startX, startY, origX, origY}

/* ── Per-text drag positions ── */
// Each entry: {x (0=centre), y, fontSize (0=use global), dragged}
// 'x' is canvas X position (use null = centred)
let _memeTextPositions = {
  top:  { x: null, y: null, fontSize: 0 },
  mid1: { x: null, y: null, fontSize: 0 },
  mid2: { x: null, y: null, fontSize: 0 },  // kept for backward compat, not shown in UI  bot:  { x: null, y: null, fontSize: 0 },
};
let _memeSelText = null; // 'top'|'mid1'|'mid2'|'bot'|null

/* ── Evergreen Nepal meme topics (shown when live fetch unavailable) ── */
const MEME_NEPAL_TOPICS_FALLBACK = [
  { emoji:'⚡', label:'Load Shedding फेरि आयो',    hint:'Nepal बिजुली कटौती र जनताको दुःख' },
  { emoji:'🚦', label:'काठमाडौं ट्राफिक जाम',       hint:'काठमाडौंको ट्राफिक र ढिलाई' },
  { emoji:'🏛️', label:'नेताको खाली वाचा',            hint:'Nepal को राजनीतिज्ञको खाली वाचा र जनताको हालत' },
  { emoji:'💸', label:'तलब र महँगी',                 hint:'Nepal मा महँगी र कम तलब' },
  { emoji:'🛂', label:'खाडी जाने नेपाली',            hint:'बिदेश जाने नेपाली कामदार' },
  { emoji:'📶', label:'Nepal Internet Speed',         hint:'नेपालको ढिलो इन्टरनेट speed' },
  { emoji:'🏥', label:'सरकारी अस्पताल',               hint:'सरकारी अस्पतालको अवस्था र सेवा' },
  { emoji:'🎓', label:'Board Exam Tension',           hint:'SEE र NEB exam को tension र preparation' },
  { emoji:'🌧️', label:'Monsoon र पहिरो',              hint:'Nepal को बाढी पहिरो र सरकारी तयारी' },
  { emoji:'🏔️', label:'Everest Tourist',              hint:'हिमाल पर्यटन र garbage' },
  { emoji:'🎬', label:'नेपाली चलचित्र',               hint:'नेपाली फिल्म र कलाकार' },
  { emoji:'🗳️', label:'Election को वाचा',             hint:'चुनाव वाचा र जनताको अपेक्षा' },
  { emoji:'🍜', label:'Dal Bhat Power',               hint:'नेपाली खाना dal bhat संस्कृति' },
  { emoji:'📱', label:'TikTok र नेपाली युवा',         hint:'नेपाली युवा र social media addiction' },
  { emoji:'🚗', label:'Traffic नियम जरिवाना',         hint:'नेपाल ट्राफिक नियम र जरिवाना' },
  { emoji:'⚽', label:'Nepal Football',               hint:'नेपाली फुटबल टिम र ANFA' },
];

/* Emojis to assign dynamically to live headline chips */
const _LIVE_TOPIC_EMOJIS = ['🔥','📰','💥','🎭','🗞️','⚡','📢','🏛️','😮','🌐'];

/* ── News Studio / Meme Studio tab switching ── */
function openNewsStudio() {
  /* Close Meme Studio, show the main News Explorer container */
  const mainContainer = document.querySelector('.container');
  const modal         = document.getElementById('memeStudioModal');
  if (modal)         modal.style.display  = 'none';
  if (mainContainer) mainContainer.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  /* Active state on buttons */
  const nb = document.getElementById('newsStudioBtn');
  const mb = document.getElementById('memeStudioBtn');
  if (nb) nb.classList.add('active-studio-btn');
  if (mb) mb.classList.remove('active-studio-btn');
}

/* ── Open / close ── */
function openMemeStudio() {
  /* Hide the main News Explorer container, show only Meme Studio */
  const mainContainer = document.querySelector('.container');
  const modal         = document.getElementById('memeStudioModal');
  if (mainContainer) mainContainer.style.display = 'none';
  modal.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  /* Active state on buttons */
  const nb = document.getElementById('newsStudioBtn');
  const mb = document.getElementById('memeStudioBtn');
  if (nb) nb.classList.remove('active-studio-btn');
  if (mb) mb.classList.add('active-studio-btn');

  /* Ensure canvas has correct dimensions before drawing */
  const canvas = document.getElementById('memeCanvas');
  if (canvas && (!canvas.width || canvas.width < 100)) {
    canvas.width  = 600;
    canvas.height = 600;
  }

  _loadMemeTrendingTopics();
  /* Reset overlays and text positions */
  _memeSlots = []; _memeImgObj = null; _memeSelSlotIdx = -1;
  _memeOverlays = []; _memeSelOverlayIdx = -1; _memeDragState = null; _memeSelText = null;
  _memeTextPositions = { top:{x:null,y:null,fontSize:0}, mid1:{x:null,y:null,fontSize:0}, mid2:{x:null,y:null,fontSize:0}, bot:{x:null,y:null,fontSize:0} };
  /* Short delay so canvas is visible/sized before drawing */
  setTimeout(() => renderMemeCanvas(), 80);
}
function closeMemeStudio() {
  /* Restore the main News Explorer container */
  const mainContainer = document.querySelector('.container');
  const modal         = document.getElementById('memeStudioModal');
  modal.style.display = 'none';
  if (mainContainer) mainContainer.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  /* Reset button states */
  const nb = document.getElementById('newsStudioBtn');
  const mb = document.getElementById('memeStudioBtn');
  if (nb) nb.classList.add('active-studio-btn');
  if (mb) mb.classList.remove('active-studio-btn');
}

/* ── Live trending topics from loaded articles + fallback ── */
async function _loadMemeTrendingTopics() {
  const grid = document.getElementById('memeTrendingGrid');
  if (!grid) return;
  /* Reset every time so re-opening always refreshes */
  grid.innerHTML = '<span style="color:var(--muted);font-size:.8rem;padding:4px">⏳ Loading live topics…</span>';

  let liveTopics = [];

  /* Pull topics from the app's cached articles if available */
  try {
    /* `articles` is the global array loaded by the main app */
    if (typeof articles !== 'undefined' && Array.isArray(articles) && articles.length > 0) {
      const seen = new Set();
      for (const a of articles) {
        const title = (a.title || a.headline || '').trim();
        if (!title || seen.has(title)) continue;
        seen.add(title);
        /* Short chip label: first ~5 words */
        const words = title.split(/\s+/);
        const label = words.slice(0, 5).join(' ') + (words.length > 5 ? '…' : '');
        liveTopics.push({
          emoji: _LIVE_TOPIC_EMOJIS[liveTopics.length % _LIVE_TOPIC_EMOJIS.length],
          label,
          hint: title,
          live: true
        });
        if (liveTopics.length >= 10) break;
      }
    }
  } catch (e) { console.warn('[MemeTopics] articles read error', e); }

  /* Merge live + fallback (live first) */
  const merged = [...liveTopics, ...MEME_NEPAL_TOPICS_FALLBACK];
  _renderMemeTrendingGrid(merged);
}

let _allMemeTopics = []; // stored for search filtering

function _renderMemeTrendingGrid(topics) {
  _allMemeTopics = topics;
  _renderTopicsFiltered(topics);
}

function _renderTopicsFiltered(topics) {
  const grid = document.getElementById('memeTrendingGrid');
  if (!grid) return;
  if (topics.length === 0) {
    grid.innerHTML = '<span style="color:var(--muted);font-size:.8rem;padding:4px">No topics found</span>';
    return;
  }
  grid.innerHTML = topics.map((t, i) =>
    `<button class="meme-topic-chip${t.live ? ' live' : ''}" data-idx="${i}">${t.emoji} ${escHtml(t.label)}</button>`
  ).join('');
  grid.querySelectorAll('.meme-topic-chip').forEach((btn, i) => {
    btn.addEventListener('click', () => memeClickTopic(topics[i].hint, topics[i].label));
  });
}

function filterMemeTrendingTopics(q) {
  if (!q || !q.trim()) { _renderTopicsFiltered(_allMemeTopics); return; }
  const lq = q.toLowerCase();
  const filtered = _allMemeTopics.filter(t =>
    t.label.toLowerCase().includes(lq) || t.hint.toLowerCase().includes(lq)
  );
  // Always show filtered results; if empty, show all but highlight the search box
  _renderTopicsFiltered(filtered.length > 0 ? filtered : _allMemeTopics);
}

function memeUseSearchTopic() {
  const q = (document.getElementById('memeTrendingSearch')?.value || '').trim();
  if (!q) return;
  document.getElementById('memeTopicInput').value = q;
  memeSetStatus('⏳ Generating meme for: ' + q);
  memeGenerateAI();
}

function memeClickTopic(hint, label) {
  document.getElementById('memeTopicInput').value = hint;
  document.getElementById('memeTopText').value    = '';
  document.getElementById('memeBottomText').value = '';
  memeSetStatus('⏳ ' + label + ' मिम तयार गर्दैछ…');
  memeGenerateAI();
}
function memeSetStatus(msg) {
  const el = document.getElementById('memeStatusMsg');
  if (el) el.textContent = msg;
}
function _memeArticleStatus(msg) {
  const el = document.getElementById('memeArticleStatus');
  if (el) el.textContent = msg;
}

/* ── Load meme from a news article URL or pasted headline ── */
async function memeFromArticle() {
  const raw = (document.getElementById('memeArticleUrl') ? document.getElementById('memeArticleUrl').value : '').trim();
  if (!raw) { toast('⚠️ URL वा headline text लेख्नुस्', 'error'); return; }

  /* If it looks like a URL, fetch article HTML and extract title + OG image */
  if (/^https?:\/\//i.test(raw)) {
    _memeArticleStatus('⏳ Article fetch गर्दैछ…');
    try {
      const html  = await fetchArticleHtml(raw);
      const title = extractPageTitle(html) || raw;
      const ogImg = extractOgImage(html);

      document.getElementById('memeTopicInput').value = title;
      _memeArticleStatus('✅ Article loaded: ' + title.slice(0, 60) + (title.length > 60 ? '…' : ''));

      /* Auto-populate image search or load OG image */
      if (ogImg) {
        _memeArticleStatus('✅ Article + image loaded');
        memeSetStatus('⏳ Article image load हुँदैछ…');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { _memeImgObj = img; renderMemeCanvas(); memeSetStatus('✅ Article image ready'); };
        img.onerror = () => {
          /* If OG image fails, fall back to keyword image search */
          memeSetStatus('ℹ️ Fallback image search…');
          const q = title.split(/\s+/).slice(0, 3).join(' ');
          document.getElementById('memeImgQuery').value = q;
          switchMemeImgSrc('search');
          searchMemeImages();
        };
        img.src = ogImg;
      } else {
        const q = title.split(/\s+/).slice(0, 3).join(' ');
        document.getElementById('memeImgQuery').value = q;
        switchMemeImgSrc('search');
        searchMemeImages();
      }
      /* Now auto-generate meme text from the title */
      memeGenerateAI();
    } catch (e) {
      _memeArticleStatus('❌ Fetch failed: ' + e.message);
    }
  } else {
    /* Treat as plain headline text */
    document.getElementById('memeTopicInput').value = raw;
    _memeArticleStatus('✅ Headline set — AI generate गर्नुस्');
    memeGenerateAI();
  }
}

/* ── Image source tabs ── */
function switchMemeImgSrc(src) {
  ['search','upload','blank'].forEach(s => {
    const panel = document.getElementById('memeSrc' + s.charAt(0).toUpperCase() + s.slice(1));
    if (panel) panel.style.display = (s === src) ? 'block' : 'none';
  });
  document.querySelectorAll('.meme-src-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.src === src));
}

/* ── Image search — multi-source for better relevance ── */
async function searchMemeImages() {
  const q    = (document.getElementById('memeImgQuery').value || '').trim();
  const grid = document.getElementById('memeImgResults');
  if (!q) { toast('⚠️ Search keyword लेख्नुस्', 'error'); return; }
  grid.innerHTML = '<span style="color:var(--muted);font-size:.8rem">🔍 Searching…</span>';

  const enc = encodeURIComponent(q);
  let thumbs = [];

  /* 1. Wikipedia direct page thumbnail */
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${enc}&prop=pageimages&pithumbsize=400&format=json&origin=*`, {signal:AbortSignal.timeout(4000)});
    if (r.ok) {
      const j = await r.json();
      for (const pg of Object.values(j.query?.pages || {}))
        if (pg.thumbnail?.source) thumbs.push(pg.thumbnail.source);
    }
  } catch (_) {}

  /* 2. Wikipedia search results thumbnails */
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc}&srlimit=6&format=json&origin=*`, {signal:AbortSignal.timeout(4000)});
    if (r.ok) {
      const j = await r.json();
      const titles = (j.query?.search || []).map(s => s.title).slice(0, 5);
      for (const t of titles) {
        try {
          const r2 = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(t)}&prop=pageimages&pithumbsize=400&format=json&origin=*`, {signal:AbortSignal.timeout(3000)});
          if (r2.ok) {
            const j2 = await r2.json();
            for (const pg of Object.values(j2.query?.pages || {}))
              if (pg.thumbnail?.source && !thumbs.includes(pg.thumbnail.source))
                thumbs.push(pg.thumbnail.source);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  /* 3. Wikimedia Commons search */
  try {
    const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${enc}&srnamespace=6&srlimit=6&format=json&origin=*`, {signal:AbortSignal.timeout(4000)});
    if (r.ok) {
      const j = await r.json();
      for (const item of (j.query?.search || []).slice(0, 4)) {
        try {
          const fn = item.title.replace('File:','');
          const r2 = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(item.title)}&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=400&format=json&origin=*`, {signal:AbortSignal.timeout(3000)});
          if (r2.ok) {
            const j2 = await r2.json();
            for (const pg of Object.values(j2.query?.pages || {}))
              if (pg.imageinfo?.[0]?.thumburl && !thumbs.includes(pg.imageinfo[0].thumburl))
                thumbs.push(pg.imageinfo[0].thumburl);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  /* 4. DuckDuckGo iframes redirect URL fallback (Picsum seeds for topic variety) */
  if (thumbs.length < 4) {
    const seed = q.replace(/\s+/g,'-').toLowerCase().replace(/[^a-z0-9-]/g,'');
    for (let i = 0; thumbs.length < 6 && i < 4; i++)
      thumbs.push(`https://picsum.photos/seed/${seed}${i}/400/400`);
  }

  thumbs = thumbs.slice(0, 8);

  if (thumbs.length === 0) {
    grid.innerHTML = '<span style="color:var(--muted);font-size:.8rem">❌ No results — try another keyword</span>';
    return;
  }

  grid.innerHTML = thumbs.map((src, idx) => {
    const safe = src.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `<div class="meme-img-result-item" style="position:relative;display:inline-block">
      <img class="meme-img-thumb" src="${src}" loading="lazy" id="memeThumb_${idx}"
        onerror="this.closest('.meme-img-result-item').style.display='none'" title="${q}">
      <div class="meme-img-thumb-btns" style="position:absolute;bottom:0;left:0;right:0;display:flex;gap:2px;padding:2px;background:rgba(0,0,0,.7)">
        <button style="flex:1;font-size:.6rem;padding:2px 3px;background:#1877f2;color:#fff;border:none;border-radius:3px;cursor:pointer"
          onclick="memeAddSlot('img','${safe}')">➕ Add</button>
        <button style="flex:1;font-size:.6rem;padding:2px 3px;background:#059669;color:#fff;border:none;border-radius:3px;cursor:pointer"
          onclick="memeAddSearchImageAsOverlay('${safe}')">⭕ Overlay</button>
      </div>
    </div>`;
  }).join('');
}

function selectMemeImage(el, src) {
  document.querySelectorAll('.meme-img-thumb').forEach(i => i.classList.remove('selected'));
  if (el) el.classList.add('selected');
  memeAddSlot('img', src);
}

/* ── Slot system: up to 4 panels rendered vertically ── */
function memeAddSlot(type, srcOrColor) {
  if (_memeSlots.length >= 4) { toast('ℹ️ Maximum 4 panels allowed — remove one first', 'info', 3000); return; }
  if (type === 'color') {
    _memeSlots.push({ type: 'color', img: null, color: srcOrColor, panX: 0, panY: 0, zoom: 1 });
    _memeImgObj = null;
    _renderSlotList();
    renderMemeCanvas();
    memeSetStatus(`🎨 Color panel ${_memeSlots.length}/4 added`);
    return;
  }
  memeSetStatus('⏳ Loading image…');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    _memeSlots.push({ type: 'img', img, color: null, panX: 0, panY: 0, zoom: 1 });
    _memeImgObj = null; // slot mode takes over
    _renderSlotList();
    renderMemeCanvas();
    memeSetStatus(`✅ Image panel ${_memeSlots.length}/4 added`);
    toast(`✅ Panel ${_memeSlots.length}/4 added`, 'success', 2000);
  };
  img.onerror = () => memeSetStatus('❌ Image load failed');
  img.src = srcOrColor;
}

function memeRemoveSlot(idx) {
  _memeSlots.splice(idx, 1);
  if (_memeSelSlotIdx >= _memeSlots.length) _memeSelSlotIdx = _memeSlots.length - 1;
  _renderSlotList();
  renderMemeCanvas();
}

function memeZoomSlot(idx, val) {
  if (!_memeSlots[idx]) return;
  _memeSlots[idx].zoom = parseFloat(val);
  const label = document.getElementById('memeZoomVal' + idx);
  if (label) label.textContent = Math.round(parseFloat(val) * 100) + '%';
  renderMemeCanvas();
}

function _renderSlotList() {
  const el = document.getElementById('memeSlotList');
  if (!el) return;
  if (_memeSlots.length === 0) {
    el.innerHTML = '<span style="color:var(--muted);font-size:.75rem">No panels yet</span>';
    return;
  }
  el.innerHTML = _memeSlots.map((s, i) => {
    const thumb = s.type === 'color'
      ? `<span style="display:inline-block;width:28px;height:28px;background:${s.color};border-radius:4px;border:1px solid #555;vertical-align:middle"></span>`
      : `<img src="${s.img.src}" style="width:28px;height:28px;object-fit:cover;border-radius:4px;vertical-align:middle">`;
    const zoomSlider = s.type === 'img'
      ? `<div style="display:flex;align-items:center;gap:4px;margin-top:3px">
           <span style="font-size:.7rem;color:var(--muted)">🔍</span>
           <input type="range" min="1" max="3" step="0.05" value="${s.zoom || 1}" style="flex:1;height:4px;accent-color:#f59e0b" oninput="memeZoomSlot(${i},this.value)">
           <span id="memeZoomVal${i}" style="font-size:.7rem;color:var(--muted);min-width:26px">${Math.round((s.zoom||1)*100)}%</span>
         </div>`
      : '';
    return `<div style="padding:3px 0;border-bottom:1px solid #2a2a2a">
      <div style="display:flex;align-items:center;gap:6px">
        ${thumb}
        <span style="font-size:.75rem;color:var(--muted);flex:1">${s.type === 'color' ? 'Color: ' + s.color : 'Image ' + (i+1)}</span>
        <button onclick="memeRemoveSlot(${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:.8rem;padding:2px 6px">✕</button>
      </div>
      ${zoomSlider}
    </div>`;
  }).join('');
}

/* ── Upload ── */
function memeLoadUpload(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const remaining = 4 - _memeSlots.length;
  if (remaining <= 0) { toast('ℹ️ Maximum 4 panels — remove one first', 'info', 3000); return; }
  const toLoad = files.slice(0, remaining);
  let loaded = 0;
  toLoad.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        _memeSlots.push({ type: 'img', img, color: null, panX: 0, panY: 0, zoom: 1 });
        _memeImgObj = null;
        loaded++;
        _renderSlotList();
        renderMemeCanvas();
        if (loaded === toLoad.length) memeSetStatus(`✅ ${loaded} image(s) added (${_memeSlots.length}/4)`);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

/* ── Solid colour ── */
function memeApplyBgColor() {
  const col = document.getElementById('memeBgColor')?.value || '#1a1a2e';
  memeAddSlot('color', col);
  memeSetStatus('🎨 Color panel added');
}

/* ─────────────────────────────────────────────────────────────
   OVERLAY IMAGES — add (search or upload), auto-layout, drag, resize, circle-crop
   Max 4 overlays. Layout:
     1 image → fills entire content zone
     2 images → left 50% / right 50%
     3 images → 33% / 33% / 33%
     4 images → 25% / 25% / 25% / 25%
   User can drag any overlay to override its auto position.
   ───────────────────────────────────────────────────────────── */

function _memeContentZone() {
  const canvas = document.getElementById('memeCanvas');
  const W = canvas.width, H = canvas.height;
  const BANNER_H = Math.round(H * 0.09);
  const STRIP_H  = 72;
  return { W, H, top: BANNER_H + 3, bottom: H - STRIP_H - 2 };
}

/* Re-calculate auto-layout positions for overlays (circular stickers in corners) */
function _memeAutoLayout() {
  const { W, H, top } = _memeContentZone();
  const BANNER_H = Math.round(H * 0.09);
  // Place 1st overlay bottom-left, 2nd bottom-right, small circular stickers
  const corners = [
    { cx: 0.12, cy: 0.80 },
    { cx: 0.88, cy: 0.80 },
  ];
  _memeOverlays.forEach((ov, i) => {
    if (ov.manualPos) return;
    const sz = Math.round(Math.min(W, H) * 0.20);
    const corner = corners[i] || { cx: 0.5, cy: 0.5 };
    ov.w = sz; ov.h = sz;
    ov.x = Math.round(W * corner.cx - sz / 2);
    ov.y = Math.round(H * corner.cy - sz / 2);
  });
}

/* Add overlay from file upload input */
function memeAddOverlayImage(input) {
  if (_memeOverlays.length >= 2) { toast('ℹ️ Maximum 2 overlays allowed', 'info', 3000); return; }
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const { W, H } = (() => { const c = document.getElementById('memeCanvas'); return {W:c.width,H:c.height}; })();
      const sz = Math.round(Math.min(W, H) * 0.20); // smaller default: 20% of canvas
      _memeOverlays.push({ img, x: 10, y: 10, w: sz, h: sz, circle: true, manualPos: false });
      _memeAutoLayout();
      _memeSelOverlayIdx = _memeOverlays.length - 1;
      _updateOverlayControls();
      _updateOverlayList();
      renderMemeCanvas();
      toast(`✅ Overlay ${_memeOverlays.length} added (${_memeOverlays.length}/2)`, 'success', 2000);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

/* Add overlay from a search-result URL */
function memeAddSearchImageAsOverlay(src) {
  if (_memeOverlays.length >= 2) { toast('ℹ️ Maximum 2 overlays allowed', 'info', 3000); return; }
  memeSetStatus('⏳ Adding overlay…');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const { W, H } = (() => { const c = document.getElementById('memeCanvas'); return {W:c.width,H:c.height}; })();
    const sz = Math.round(Math.min(W, H) * 0.20);
    _memeOverlays.push({ img, x: 10, y: 10, w: sz, h: sz, circle: true, manualPos: false });
    _memeAutoLayout();
    _memeSelOverlayIdx = _memeOverlays.length - 1;
    _updateOverlayControls();
    _updateOverlayList();
    renderMemeCanvas();
    memeSetStatus(`✅ Overlay ${_memeOverlays.length}/2 added`);
    toast(`✅ Overlay ${_memeOverlays.length}/2 added`, 'success', 2000);
  };
  img.onerror = () => memeSetStatus('❌ Could not load overlay image');
  img.src = src;
}

function memeAddOverlayCircle() {
  if (_memeSelOverlayIdx >= 0 && _memeOverlays[_memeSelOverlayIdx]) {
    _memeOverlays[_memeSelOverlayIdx].circle = !_memeOverlays[_memeSelOverlayIdx].circle;
    document.getElementById('memeOverlayCircle').checked = _memeOverlays[_memeSelOverlayIdx].circle;
    renderMemeCanvas();
  } else {
    toast('ℹ️ Select an overlay image first, then click ⭕', 'info', 3000);
  }
}

function memeRemoveSelectedOverlay() {
  if (_memeSelOverlayIdx < 0) return;
  _memeOverlays.splice(_memeSelOverlayIdx, 1);
  _memeSelOverlayIdx = _memeOverlays.length > 0 ? _memeOverlays.length - 1 : -1;
  _memeAutoLayout();
  _updateOverlayControls();
  _updateOverlayList();
  renderMemeCanvas();
}

function memeResetOverlayLayout() {
  _memeOverlays.forEach(ov => { ov.manualPos = false; });
  _memeAutoLayout();
  renderMemeCanvas();
}

function memeResizeSelectedOverlay(val) {
  if (_memeSelOverlayIdx < 0 || !_memeOverlays[_memeSelOverlayIdx]) return;
  const ov = _memeOverlays[_memeSelOverlayIdx];
  const newW = parseInt(val);
  // Keep aspect ratio only if NOT in auto-fill mode; in auto-fill let it stretch
  ov.w = newW;
  ov.h = newW; // square crop by default; user can drag height via overlay resize handle
  ov.manualPos = true; // resizing implies manual override
  _updateOverlayControls();
  renderMemeCanvas();
}

function memeToggleOverlayCircle(checked) {
  if (_memeSelOverlayIdx < 0 || !_memeOverlays[_memeSelOverlayIdx]) return;
  _memeOverlays[_memeSelOverlayIdx].circle = checked;
  renderMemeCanvas();
}

function _updateOverlayControls() {
  const ctrl = document.getElementById('memeOverlayControls');
  if (!ctrl) return;
  if (_memeSelOverlayIdx >= 0 && _memeOverlays[_memeSelOverlayIdx]) {
    ctrl.style.display = 'block';
    const ov = _memeOverlays[_memeSelOverlayIdx];
    document.getElementById('memeOverlaySize').value   = Math.min(600, Math.max(30, ov.w));
    document.getElementById('memeOverlayCircle').checked = ov.circle;
    const lbl = document.getElementById('memeOverlaySelLabel');
    if (lbl) lbl.textContent = `Photo ${_memeSelOverlayIdx + 1} selected`;
  } else {
    ctrl.style.display = 'none';
  }
  // sync text selection label
  const tsl = document.getElementById('memeTextSelLabel');
  if (tsl) tsl.textContent = _memeSelText ? `"${_memeSelText}" text selected — drag on canvas` : '';

  // Show/hide per-text size box
  const tsb = document.getElementById('memeTextSizeBox');
  if (tsb) {
    if (_memeSelText) {
      tsb.style.display = 'block';
      const pos = _memeTextPositions[_memeSelText];
      const curFs = pos.fontSize > 0 ? pos.fontSize : parseInt(document.getElementById('memeFontSize')?.value || 42);
      document.getElementById('memeTextFontSize').value = curFs;
      document.getElementById('memeTextFontSizeVal').textContent = curFs + 'px';
      const lbl = document.getElementById('memeTextSizeLabel');
      const names = { top:'Top', mid1:'Middle 1', mid2:'Middle 2', bot:'Bottom' };
      if (lbl) lbl.textContent = `"${names[_memeSelText]}" text size`;
    } else {
      tsb.style.display = 'none';
    }
  }
}

function _updateOverlayList() {
  const list = document.getElementById('memeOverlayList');
  if (!list) return;
  if (_memeOverlays.length === 0) {
    list.innerHTML = '<span style="color:var(--muted);font-size:.75rem">No overlays added yet</span>';
    return;
  }
  list.innerHTML = _memeOverlays.map((ov, i) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
      <canvas width="40" height="40" style="border-radius:4px;border:1px solid var(--border);flex-shrink:0"
        id="memeOvThumb${i}"></canvas>
      <span style="font-size:.78rem;flex:1">Photo ${i+1}${ov.circle?' ⭕':''}</span>
      <button class="btn btn-ghost" style="font-size:.72rem;padding:3px 8px" onclick="memeSelectOverlay(${i})">Select</button>
      <button class="btn" style="font-size:.72rem;padding:3px 8px;background:#ef4444;color:#fff" onclick="memeDeleteOverlay(${i})">✕</button>
    </div>`
  ).join('');
  // Draw thumbnails
  _memeOverlays.forEach((ov, i) => {
    const tc = document.getElementById(`memeOvThumb${i}`);
    if (!tc) return;
    const tctx = tc.getContext('2d');
    tctx.clearRect(0, 0, 40, 40);
    const sc = Math.min(40 / ov.img.naturalWidth, 40 / ov.img.naturalHeight);
    const tw = ov.img.naturalWidth * sc, th = ov.img.naturalHeight * sc;
    tctx.drawImage(ov.img, (40-tw)/2, (40-th)/2, tw, th);
  });
}

function memeSelectOverlay(i) {
  _memeSelOverlayIdx = i;
  _memeSelText = null;
  _updateOverlayControls();
  renderMemeCanvas();
}

function memeDeleteOverlay(i) {
  _memeOverlays.splice(i, 1);
  if (_memeSelOverlayIdx >= _memeOverlays.length) _memeSelOverlayIdx = _memeOverlays.length - 1;
  _memeAutoLayout();
  _updateOverlayControls();
  _updateOverlayList();
  renderMemeCanvas();
}

/* ─── Unified canvas drag system (overlays + text labels) ─── */

function _memeCanvasCoords(e) {
  const canvas = document.getElementById('memeCanvas');
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const src    = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
}

/* Returns bounding box of a text label on the canvas.
   For top/bot text we return null since those are now in ribbons (not draggable floats). */
function _memeTextBBox(key, W, H, BANNER_H, STRIP_H, fontSize) {
  if (key === 'top' || key === 'bot') return null; // handled by ribbons
  const pos = _memeTextPositions[key];
  const textZoneT = BANNER_H + 12;
  const textZoneB = H - STRIP_H - 8;
  const fs = (pos.fontSize > 0 ? pos.fontSize : fontSize);

  let defaultY;
  if (key === 'mid1') defaultY = Math.round((textZoneT + textZoneB) / 2) - Math.round(fs * 0.6);
  else                defaultY = Math.round((textZoneT + textZoneB) / 2) + Math.round(fs * 0.8);

  const cx  = pos.x != null ? pos.x : W / 2;
  const cy  = pos.y != null ? pos.y : defaultY;
  const bw  = W * 0.9;
  const bh  = fs * 1.6;
  return { cx, cy, x: cx - bw/2, y: cy - bh/2, w: bw, h: bh };
}

function memeCanvasMouseDown(e) {
  const { x, y } = _memeCanvasCoords(e);
  const canvas = document.getElementById('memeCanvas');
  const W = canvas.width, H = canvas.height;
  const BANNER_H = Math.round(H * 0.09);
  const STRIP_H  = 72;
  const fontSize = parseInt(document.getElementById('memeFontSize')?.value || 42);

  // 0. Check slot panel hits for panning background images
  if (_memeSlots.length > 0) {
    const zoneTop = BANNER_H + 3;
    const zoneBot = H - STRIP_H - 2;
    const zoneH   = zoneBot - zoneTop;
    const rowH    = Math.floor(zoneH / _memeSlots.length);
    for (let i = 0; i < _memeSlots.length; i++) {
      const sy = zoneTop + i * rowH;
      const sh = (i === _memeSlots.length - 1) ? (zoneBot - sy) : rowH;
      if (_memeSlots[i].type === 'img' && x >= 0 && x <= W && y >= sy && y <= sy + sh) {
        // Only select the slot if clicking in the strip — overlays/text take priority so check those first
        // Defer to after text/overlay checks below — use a flag
        // Actually: check text and overlay first; if nothing hit, then pan this slot
        break;
      }
    }
  }

  // 1. Check text label hits first (top layer)
  const textKeys = ['top','mid1','mid2','bot'];
  const textValues = {
    top:  (document.getElementById('memeTopText')?.value     || '').trim(),
    mid1: (document.getElementById('memeMiddleText1')?.value || '').trim(),
    mid2: (document.getElementById('memeMiddleText2')?.value || '').trim(),
    bot:  (document.getElementById('memeBottomText')?.value  || '').trim(),
  };
  for (const key of [...textKeys].reverse()) {
    if (!textValues[key]) continue;
    const bb = _memeTextBBox(key, W, H, BANNER_H, STRIP_H, fontSize);
    if (x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h) {
      _memeSelText       = key;
      _memeSelOverlayIdx = -1;
      _memeDragState     = { type:'text', key, startX: x, startY: y, origX: bb.cx, origY: bb.cy };
      _updateOverlayControls();
      renderMemeCanvas();
      return;
    }
  }

  // 2. Check overlay hits
  for (let i = _memeOverlays.length - 1; i >= 0; i--) {
    const ov = _memeOverlays[i];
    const hit = ov.circle
      ? Math.hypot(x - (ov.x + ov.w/2), y - (ov.y + ov.h/2)) <= ov.w/2
      : (x >= ov.x && x <= ov.x + ov.w && y >= ov.y && y <= ov.y + ov.h);
    if (hit) {
      _memeSelOverlayIdx = i;
      _memeSelText       = null;
      _memeDragState     = { type:'overlay', idx: i, startX: x, startY: y, origX: ov.x, origY: ov.y };
      _updateOverlayControls();
      renderMemeCanvas();
      return;
    }
  }
  // 3. Check slot panel hits for panning — fallback after text & overlay
  if (_memeSlots.length > 0) {
    const zoneTop = BANNER_H + 3;
    const zoneBot = H - STRIP_H - 2;
    const zoneH   = zoneBot - zoneTop;
    const rowH    = Math.floor(zoneH / _memeSlots.length);
    for (let i = 0; i < _memeSlots.length; i++) {
      const sy = zoneTop + i * rowH;
      const sh = (i === _memeSlots.length - 1) ? (zoneBot - sy) : rowH;
      if (_memeSlots[i].type === 'img' && x >= 0 && x <= W && y >= sy && y <= sy + sh) {
        _memeSelSlotIdx    = i;
        _memeSelOverlayIdx = -1;
        _memeSelText       = null;
        _memeDragState     = { type:'slot', idx: i, startX: x, startY: y, origPanX: _memeSlots[i].panX || 0, origPanY: _memeSlots[i].panY || 0 };
        _updateOverlayControls();
        renderMemeCanvas();
        return;
      }
    }
  }

  // Deselect all
  _memeSelSlotIdx    = -1;
  _memeSelOverlayIdx = -1;
  _memeSelText       = null;
  _memeDragState     = null;
  _updateOverlayControls();
  renderMemeCanvas();
}

function memeCanvasMouseMove(e) {
  if (!_memeDragState) return;
  e.preventDefault();
  const { x, y } = _memeCanvasCoords(e);
  const dx = x - _memeDragState.startX;
  const dy = y - _memeDragState.startY;

  if (_memeDragState.type === 'overlay') {
    const ov = _memeOverlays[_memeDragState.idx];
    if (!ov) return;
    ov.x = _memeDragState.origX + dx;
    ov.y = _memeDragState.origY + dy;
    ov.manualPos = true;
  } else if (_memeDragState.type === 'slot') {
    const slot = _memeSlots[_memeDragState.idx];
    if (!slot || slot.type !== 'img') return;
    slot.panX = _memeDragState.origPanX + dx;
    slot.panY = _memeDragState.origPanY + dy;
  } else if (_memeDragState.type === 'text') {
    const pos = _memeTextPositions[_memeDragState.key];
    pos.x = _memeDragState.origX + dx;
    pos.y = _memeDragState.origY + dy;
  }
  renderMemeCanvas();
}

function memeCanvasMouseUp()  { _memeDragState = null; }
function memeCanvasTouchStart(e) { e.preventDefault(); memeCanvasMouseDown(e); }
function memeCanvasTouchMove(e)  { e.preventDefault(); memeCanvasMouseMove(e); }

/* Resize selected text via slider */
function memeResizeSelectedText(val) {
  if (!_memeSelText) return;
  _memeTextPositions[_memeSelText].fontSize = parseInt(val);
  document.getElementById('memeTextFontSizeVal').textContent = val + 'px';
  renderMemeCanvas();
}

/* Reset all text positions */
function memeResetTextPositions() {
  _memeTextPositions = { top:{x:null,y:null,fontSize:0}, mid1:{x:null,y:null,fontSize:0}, mid2:{x:null,y:null,fontSize:0}, bot:{x:null,y:null,fontSize:0} };
  _memeSelText = null;
  _updateOverlayControls();
  renderMemeCanvas();
}

/* ── Style setters ── */
function setMemeTextColor(color, btn) {
  _memeTextColor = color;
  document.querySelectorAll('.meme-color-swatch').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderMemeCanvas();
}
function setMemeFont(font, btn) {
  _memeFontFamily = font;
  document.querySelectorAll('.meme-font-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderMemeCanvas();
}
function setMemeSize(w, h, btn) {
  _memeCanvasW = w; _memeCanvasH = h;
  const canvas = document.getElementById('memeCanvas');
  canvas.width = w; canvas.height = h;
  document.querySelectorAll('.meme-size-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Reset manual text positions so they recalculate for new dimensions
  _memeTextPositions = { top:{x:null,y:null,fontSize:0}, mid1:{x:null,y:null,fontSize:0}, mid2:{x:null,y:null,fontSize:0}, bot:{x:null,y:null,fontSize:0} };
  // Re-layout overlays for new canvas size
  _memeOverlays.forEach(ov => { ov.manualPos = false; });  _memeAutoLayout();
  renderMemeCanvas();
}

/* ─────────────────────────────────────────────────────────────────
   CANVAS RENDER — matches news image format:
     • Dark gradient BG with subtle red grid lines
     • Red top banner 110px: "😂 MEME" bold white, gold rule, date stamp
     • Meme text block in middle zone (Impact, stroke, auto-wrap)
     • _drawAuthorWatermark strip pinned to very bottom
   ───────────────────────────────────────────────────────────────── */
async function renderMemeCanvas() {
  const canvas = document.getElementById('memeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  /* ── 1. Background — slot panels stacked vertically, or single image, or gradient ── */
  const BANNER_H_bg = Math.round(H * 0.09);
  const STRIP_H_bg  = 72;
  const zoneTop_bg  = BANNER_H_bg + 3;
  const zoneBot_bg  = H - STRIP_H_bg - 2;
  const zoneH_bg    = zoneBot_bg - zoneTop_bg;

  if (_memeSlots.length > 0) {
    // Draw each slot as a vertical strip
    const rowH = Math.floor(zoneH_bg / _memeSlots.length);
    _memeSlots.forEach((slot, i) => {
      const sy = zoneTop_bg + i * rowH;
      const sh = (i === _memeSlots.length - 1) ? (zoneBot_bg - sy) : rowH; // last row fills remainder
      if (slot.type === 'color') {
        ctx.fillStyle = slot.color;
        ctx.fillRect(0, sy, W, sh);
      } else if (slot.img) {
        const iw = slot.img.naturalWidth, ih = slot.img.naturalHeight;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, sy, W, sh); ctx.clip();
        const scale = Math.max(W / iw, sh / ih) * (slot.zoom || 1);
        const dw = iw * scale, dh = ih * scale;
        // Apply pan offset (clamped so image never fully leaves its strip)
        const baseX = (W - dw) / 2;
        const baseY = sy + (sh - dh) / 2;
        const maxPanX = Math.max(0, (dw - W) / 2);
        const maxPanY = Math.max(0, (dh - sh) / 2);
        const px = Math.max(-maxPanX, Math.min(maxPanX, slot.panX || 0));
        const py = Math.max(-maxPanY, Math.min(maxPanY, slot.panY || 0));
        ctx.drawImage(slot.img, baseX + px, baseY + py, dw, dh);
        /* Draw selection border if this slot is selected */
        if (i === _memeSelSlotIdx) {
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3; ctx.setLineDash([6,3]);
          ctx.strokeRect(1, sy + 1, W - 2, sh - 2);
          ctx.setLineDash([]);
          /* Pan hint */
          ctx.fillStyle = 'rgba(245,158,11,0.85)'; ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText('✥ drag to pan panel ' + (i+1), W/2, sy + 4);
        }
        /* Subtle dark overlay */
        const ov = ctx.createLinearGradient(0, sy, 0, sy + sh);
        ov.addColorStop(0,   'rgba(0,0,0,0.45)');
        ov.addColorStop(0.5, 'rgba(0,0,0,0.20)');
        ov.addColorStop(1,   'rgba(0,0,0,0.55)');
        ctx.fillStyle = ov; ctx.fillRect(0, sy, W, sh);
        ctx.restore();
      }
    });
    // Fill top banner area + strip with dark if not covered
    ctx.fillStyle = 'rgba(0,0,0,0.0)';
  } else if (_memeImgObj) {
    ctx.clearRect(0, 0, W, H);
    const iw = _memeImgObj.naturalWidth, ih = _memeImgObj.naturalHeight;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(_memeImgObj, (W - dw) / 2, (H - dh) / 2, dw, dh);

    /* Subtle dark gradient overlay so text & banner are readable */
    const ov = ctx.createLinearGradient(0, 0, 0, H);
    ov.addColorStop(0,   'rgba(0,0,0,0.55)');
    ov.addColorStop(0.30,'rgba(0,0,0,0.25)');
    ov.addColorStop(0.70,'rgba(0,0,0,0.30)');
    ov.addColorStop(1,   'rgba(0,0,0,0.72)');
    ctx.fillStyle = ov; ctx.fillRect(0, 0, W, H);
  } else {
    /* Rich dark gradient background matching news image style */
    const bg = ctx.createLinearGradient(0, 0, W, H);
    const bgCol = document.getElementById('memeBgColor') ? document.getElementById('memeBgColor').value : '#0f172a';
    bg.addColorStop(0,    bgCol);
    bg.addColorStop(0.35, _shadeColor(bgCol, -20));
    bg.addColorStop(0.65, _shadeColor(bgCol, -40));
    bg.addColorStop(1,    _shadeColor(bgCol, -60));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    /* Diagonal grid pattern (like news image) */
    ctx.save();
    ctx.strokeStyle = 'rgba(192,57,43,0.07)';
    ctx.lineWidth   = 1;
    const STEP = Math.round(W / 10);
    for (let x = -H; x < W + H; x += STEP) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
    }
    ctx.restore();

    /* Radial crimson glow top-right */
    const glow1 = ctx.createRadialGradient(W*0.85, H*0.1, 20, W*0.85, H*0.1, 260);
    glow1.addColorStop(0, 'rgba(220,38,38,0.22)'); glow1.addColorStop(1, 'rgba(220,38,38,0)');
    ctx.fillStyle = glow1; ctx.fillRect(0, 0, W, H);

    /* Radial violet glow bottom-left */
    const glow2 = ctx.createRadialGradient(W*0.15, H*0.9, 10, W*0.15, H*0.9, 220);
    glow2.addColorStop(0, 'rgba(99,38,180,0.18)'); glow2.addColorStop(1, 'rgba(99,38,180,0)');
    ctx.fillStyle = glow2; ctx.fillRect(0, 0, W, H);
  }

  /* ── 2. Top & Bottom TEXT RIBBONS (replace old static banner & bot text) ──
     • Top ribbon  = dark semi-transparent band at very top, height fits topText
     • Bottom ribbon = same style at bottom, above watermark strip, fits botText
     • If no text, ribbons collapse to a thin accent line only              ── */
  const ribbonFont     = _memeFontFamily || 'Impact';
  const ribbonFontSize = parseInt(document.getElementById('memeFontSize')?.value || 42);
  const ribbonStroke   = document.getElementById('memeStroke')?.checked ?? true;
  const ribbonColor    = _memeTextColor || '#ffffff';
  const ribbonBgColor  = 'rgba(0,0,0,0.72)';
  const ACCENT_H       = 5;   // thin gold accent line height when ribbon is empty
  const PAD_V          = 14;  // vertical padding inside ribbon
  const PAD_H          = 18;  // horizontal padding inside ribbon

  const topText   = (document.getElementById('memeTopText')    ?.value || '').toUpperCase().trim();
  const mid1Text  = (document.getElementById('memeMiddleText1')?.value || '').toUpperCase().trim();
  const mid2Text  = (document.getElementById('memeMiddleText2')?.value || '').toUpperCase().trim();
  const botText   = (document.getElementById('memeBottomText') ?.value || '').toUpperCase().trim();
  const fontSize  = ribbonFontSize;
  const useStroke = ribbonStroke;

  /* Helper: measure wrapped lines for a text at a given font size */
  function measureRibbonLines(text, fs) {
    if (!text) return { lines: [], lineH: fs * 1.28, totalH: 0 };
    ctx.font = `900 ${fs}px "${ribbonFont}", Impact, "Arial Black", sans-serif`;
    const maxW = W - PAD_H * 2;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    const lineH = fs * 1.28;
    return { lines, lineH, totalH: lines.length * lineH };
  }

  /* Helper: draw a ribbon band */
  function drawRibbon(text, fs, bandY, bandH, textBaseline) {
    /* Background */
    ctx.fillStyle = ribbonBgColor;
    ctx.fillRect(0, bandY, W, bandH);
    /* Gold left accent bar */
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, bandY, 7, bandH);
    /* Gold top/bottom rule */
    ctx.fillStyle = 'rgba(245,158,11,0.6)';
    if (textBaseline === 'top')    ctx.fillRect(7, bandY + bandH - 2, W - 7, 2);
    else                           ctx.fillRect(7, bandY, W - 7, 2);

    if (!text) return;
    const { lines, lineH, totalH } = measureRibbonLines(text, fs);
    ctx.font         = `900 ${fs}px "${ribbonFont}", Impact, "Arial Black", sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';

    let startY;
    if (textBaseline === 'top')
      startY = bandY + PAD_V + fs * 0.85;    // first baseline from top
    else
      startY = bandY + bandH - PAD_V - (totalH - lineH) - fs * 0.15; // anchor from bottom

    lines.forEach((l, i) => {
      const y = startY + i * lineH;
      if (useStroke) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 4;
        ctx.lineWidth   = Math.max(3, fs * 0.12);
        ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
        ctx.strokeText(l, W / 2, y); ctx.restore();
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 5;
      ctx.fillStyle   = ribbonColor;
      ctx.fillText(l, W / 2, y); ctx.restore();
    });
  }

  /* Compute ribbon heights based on content */
  const { totalH: topTotalH }  = measureRibbonLines(topText, fontSize);
  const { totalH: botTotalH }  = measureRibbonLines(botText, fontSize);
  const TOP_RIBBON_H  = topText  ? topTotalH  + PAD_V * 2 : ACCENT_H;
  const BOT_RIBBON_H  = botText  ? botTotalH  + PAD_V * 2 : ACCENT_H;

  /* Store for text zone calculation */
  const BANNER_H = TOP_RIBBON_H;   // replaces old fixed BANNER_H usage below
  const STRIP_H  = Math.max(BOT_RIBBON_H, 72); // watermark is at least 72px

  /* Draw top ribbon */
  drawRibbon(topText, fontSize, 0, TOP_RIBBON_H, 'top');

  /* Draw bottom ribbon (above watermark) */
  const botRibbonY = H - STRIP_H;
  drawRibbon(botText, fontSize, botRibbonY, BOT_RIBBON_H, 'bottom');

  /* Left red accent bar on content zone sides */
  ctx.fillStyle = 'rgba(192,57,43,0.85)';
  ctx.fillRect(0, TOP_RIBBON_H + 2, 5, H - TOP_RIBBON_H - STRIP_H - 4);

  /* ── 3. Middle floating text (Mid1, Mid2) ── */
  const textZoneT = TOP_RIBBON_H + 10;
  const textZoneB = H - STRIP_H - 8;

  ctx.textAlign = 'center';

  function drawMemeTextAt(text, key, defaultY, baseline) {
    if (!text) return;
    const pos = _memeTextPositions[key] || { x: null, y: null, fontSize: 0 };
    const fs  = pos.fontSize > 0 ? pos.fontSize : (baseline === 'middle_custom' ? Math.round(fontSize * 0.82) : fontSize);
    const cx  = pos.x != null ? pos.x : W / 2;
    const cy  = pos.y != null ? pos.y : defaultY;

    ctx.font         = `900 ${fs}px "${_memeFontFamily}", Impact, "Arial Black", sans-serif`;
    ctx.textBaseline = 'alphabetic';
    const maxW  = W * 0.88;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    const lineH  = fs * 1.22;
    const totalH = lines.length * lineH;
    // Anchor: top=draw from cy down, bottom=draw up, middle=centre
    let startY;
    if (baseline === 'top')           startY = cy;
    else if (baseline === 'bottom')   startY = cy - totalH + lineH;
    else                              startY = cy - totalH / 2 + lineH / 2;

    lines.forEach((l, i) => {
      const y = startY + i * lineH;
      if (useStroke) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
        ctx.lineWidth   = Math.max(3, fs * 0.12);
        ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
        ctx.strokeText(l, cx, y); ctx.restore();
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
      ctx.fillStyle   = _memeTextColor;
      ctx.fillText(l, cx, y); ctx.restore();
    });

    /* Draw selection highlight handle if this text is selected */
    if (_memeSelText === key) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      // startY is the alphabetic baseline of the first line.
      // The text ascenders go ~fs*0.85 above baseline; descenders ~fs*0.2 below last line.
      const bx = cx - W * 0.45;
      const by = startY - fs * 0.85;          // top of ascenders
      const bw = W * 0.9;
      const bh = totalH + fs * 0.2;           // cover full height incl. descenders
      ctx.strokeRect(bx, by, bw, bh);
      /* Resize handle — small square at bottom-right */
      ctx.fillStyle = '#f59e0b'; ctx.setLineDash([]);
      ctx.fillRect(bx + bw - 10, by + bh - 10, 10, 10);
      ctx.restore();
    }
  }

  const midCenterY = (textZoneT + textZoneB) / 2;
  /* Top text and Bottom text are now rendered inside ribbons above — only draw mid texts here */
  drawMemeTextAt(mid1Text, 'mid1', midCenterY - Math.round(fontSize * 0.5),      'middle_custom');
  drawMemeTextAt(mid2Text, 'mid2', midCenterY + Math.round(fontSize * 0.8),      'middle_custom');

  /* ── 3b. Overlay images (rendered after text so they sit on top) ── */
  for (let i = 0; i < _memeOverlays.length; i++) {
    const ov = _memeOverlays[i];
    ctx.save();
    if (ov.circle) {
      ctx.beginPath();
      ctx.arc(ov.x + ov.w / 2, ov.y + ov.h / 2, Math.min(ov.w, ov.h) / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    // Cover-fit the image into the overlay rectangle
    const iw = ov.img.naturalWidth, ih = ov.img.naturalHeight;
    const scale = Math.max(ov.w / iw, ov.h / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(ov.img, ov.x + (ov.w - dw)/2, ov.y + (ov.h - dh)/2, dw, dh);
    ctx.restore();

    /* Selection border */
    if (i === _memeSelOverlayIdx) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3; ctx.setLineDash([6,3]);
      if (ov.circle) {
        ctx.beginPath();
        ctx.arc(ov.x + ov.w/2, ov.y + ov.h/2, Math.min(ov.w,ov.h)/2 + 4, 0, Math.PI*2);
        ctx.stroke();
      } else {
        ctx.strokeRect(ov.x - 2, ov.y - 2, ov.w + 4, ov.h + 4);
      }
      /* Resize grip — bottom-right corner */
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(ov.x + ov.w - 12, ov.y + ov.h - 12, 12, 12);
      ctx.restore();
    }
  }

  /* ── 4. Author watermark strip (avatar + name + URL) ── */
  const showWatermark = true; // always on — watermark cannot be disabled
  if (showWatermark) {
    await _drawAuthorWatermark(ctx, W, 0, 'Meme');
  }
}

/* Helper: darken/lighten a hex colour by `amount` (negative = darker) */
function _shadeColor(hex, amount) {
  try {
    let c = parseInt(hex.replace('#',''), 16);
    let r = Math.min(255, Math.max(0, (c >> 16) + amount));
    let g = Math.min(255, Math.max(0, ((c >> 8) & 0xff) + amount));
    let b = Math.min(255, Math.max(0, (c & 0xff) + amount));
    return '#' + ((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1);
  } catch { return hex; }
}

/* ── AI meme text via Gemini ── */
async function memeGenerateAI() {
  const topic = (document.getElementById('memeTopicInput') ? document.getElementById('memeTopicInput').value : '').trim();
  if (!topic) { toast('⚠️ Step 2 मा topic लेख्नुस्', 'error'); return; }

  const hasAI = (_geminiKey || _browserGeminiKey || _browserGroqKey);
  if (!hasAI) {
    toast('ℹ️ AI key छैन — template प्रयोग गर्दैछ', 'info', 3000);
    memeGenerateTemplate();
    return;
  }

  const aiLabel = (_geminiKey || _browserGeminiKey) ? '✨ Gemini' : '⚡ Groq';

  /* Show spinner */
  const spinner = document.getElementById('memeCanvasSpinner');
  if (spinner) spinner.style.display = 'flex';
  memeSetStatus(`🤖 ${aiLabel} AI ले meme text तयार गर्दैछ…`);

  const prompt = `You are a master Nepali viral meme creator. Create a funny, highly shareable two-line meme for Nepal's social media (Facebook, TikTok, Instagram, Twitter).

TOPIC: ${topic}

RULES:
- Write naturally in Nepali Devanagari script (mixing English words is totally fine and even encouraged for punchlines)
- TOP TEXT: sets up situation, expectation, or context — max 8 words, punchy
- BOTTOM TEXT: delivers the punchline or subverted expectation — max 8 words, HILARIOUS
- Style: deeply RELATABLE Nepal everyday life humor — real situations Nepali people face daily (load shedding, traffic, expensive prices, government promises, board exams, abroad dreams, TikTok addiction). Use exaggeration, irony, self-deprecating humor, mild political satire, or "expectation vs reality" format.
- The meme MUST feel like something a Nepali person would immediately share saying "यो त मेरो कुरो हो!" (this is so me!)
- Avoid anything offensive, harmful, or targeting specific individuals
- Image search query: 3-4 English words describing a FUNNY, RELATABLE, or VISUALLY EXPRESSIVE image perfectly matching the meme vibe (e.g. "confused student books", "traffic jam car honk", "empty wallet sad", "politician pointing crowd"). Choose an image that makes the meme funnier or more relatable when seen with the text.
- Caption: 1-2 fun sentences (Nepali + English mix) that explain the relatable situation + exactly 8 relevant hashtags ending with #ShashiNewsGen

Output ONLY valid JSON (no markdown, no extra text):
{"top":"<TOP TEXT>","bottom":"<BOTTOM TEXT>","img":"<image search query>","caption":"<caption with hashtags>"}`;

  try {
    const result = await callAI(prompt, 22000);
    if (spinner) spinner.style.display = 'none';
    if (result && result.top && result.bottom) {
      document.getElementById('memeTopText').value    = result.top;
      document.getElementById('memeBottomText').value = result.bottom;
      if (result.caption) document.getElementById('memeCaptionText').value = result.caption;

      const imgQ = result.img || topic.split(' ').slice(0,3).join(' ');

      /* ── Try HuggingFace FLUX image generation first ── */
      if (_browserHFKey) {
        memeSetStatus('🎨 HuggingFace AI ले meme image बनाउँदैछ…');
        try {
          const hfUrl = await fetchHuggingFaceImage(imgQ);
          const img   = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = hfUrl; });
          _memeSlots = [{ type: 'img', img, color: null }];
          _memeImgObj = null;
          _renderSlotList();
          await renderMemeCanvas();
          memeSetStatus('✅ AI मिम + HuggingFace image तयार भयो! 🎨😂');
          toast(`🎨 ${aiLabel} text + HuggingFace AI image — Meme ready!`, 'success', 4000);
        } catch (hfErr) {
          console.warn('[MemeHF] HuggingFace failed:', hfErr.message, '— falling back to web search');
          memeSetStatus('ℹ️ HF image failed — web search प्रयोग गर्दैछ…');
          document.getElementById('memeImgQuery').value = imgQ;
          switchMemeImgSrc('search');
          searchMemeImages();
          await renderMemeCanvas();
          memeSetStatus('✅ AI मिम तयार भयो! 😂');
          toast(`😂 ${aiLabel} Meme ready! (web image fallback)`, 'success', 3500);
        }
      } else {
        /* No HF key — use web image search as before */
        document.getElementById('memeImgQuery').value = imgQ;
        switchMemeImgSrc('search');
        searchMemeImages();
        await renderMemeCanvas();
        memeSetStatus('✅ AI मिम तयार भयो! 😂');
        toast(`😂 ${aiLabel} Meme ready! Image पनि search गर्दैछ…`, 'success', 3500);
      }
    } else {
      throw new Error('Bad AI response');
    }
  } catch (e) {
    if (spinner) spinner.style.display = 'none';
    console.warn('[MemeAI]', e.message);
    memeSetStatus('⚠️ AI failed — template प्रयोग गर्दैछ');
    memeGenerateTemplate();
  }
}

/* ── Template fallback bank ── */
const _MEME_TEMPLATES_BY_KW = [
  { kw:['light','बिजुली','load shed'],   top:'जब LOAD SHEDDING आउँछ',       bottom:'र EXAM ठिक भोलि छ 🕯️😩',      img:'candle dark studying night' },
  { kw:['traffic','ट्राफिक','जाम'],      top:'काठमाडौं ट्राफिक:',            bottom:'1 KM = 1 घण्टा ⏰🚦',           img:'traffic jam car stress' },
  { kw:['नेता','election','वाचा','vote'], top:'ELECTION मा नेताको PROMISE:',  bottom:'5 साल पछि: "अर्को TERM मा" 🗳️😭', img:'politician pointing crowd promises' },
  { kw:['exam','board','see','neb'],      top:'EXAM को आगाडिको रात:',         bottom:'"भोलि बिहानै पढ्छु" 📚😬',      img:'student procrastinating phone bed' },
  { kw:['internet','net','speed','wifi'], top:'NEPAL INTERNET SPEED:',        bottom:'☕ चिया खाएर आउँछु, तबसम्म LOADING… 😴', img:'buffering loading slow internet frustrated' },
  { kw:['महँगी','price','महंगाई'],         top:'बजार जाँदा POCKET:',           bottom:'घर फर्कँदा POCKET: EMPTY 💸😭', img:'empty wallet sad shopping' },
  { kw:['abroad','खाडी','foreign','bidesh'], top:'ABROAD जाने PLAN:',         bottom:'Reality: फेरि Nepal ✈️😢',      img:'person suitcase airport sad leaving' },
  { kw:['dal bhat','दाल भात','खाना','food'], top:'नेपालीको LIFE HACK:',       bottom:'जे PROBLEM होस्, DAL BHAT खा 💪😄', img:'dal bhat nepali food bowl happy' },
  { kw:['football','cricket','sport','खेल'], top:'NEPAL SPORTS:',             bottom:'"NEXT TIME जित्छौं" 😭⚽',       img:'sport fan disappointed watching tv' },
  { kw:['tiktok','social media','reels','youtube'], top:'1 VIDEO हेर्छु भनेर:',  bottom:'3 घण्टा पछि: 😵📱',            img:'person phone scrolling addicted bed' },
  { kw:['salary','तलब','payday'],         top:'PAYDAY:',                       bottom:'Bills तिरेपछि: BROKE AGAIN 😂💸', img:'empty wallet bills payday broke' },
  { kw:['rain','पानी','flood','बाढी'],    top:'Nepal मा पानी पर्‍यो भने:',    bottom:'सरकार: "RESCUE SOON आउँछ" 🌧️😒', img:'rain flood umbrella nepal village' },
  { kw:['petrol','fuel','diesel','gas'],  top:'PETROL PRICE बढ्यो:',          bottom:'बाइक धकेलेर जाने भयो 🛵😭',    img:'motorcycle pushing bike empty fuel' },
  { kw:['hospital','अस्पताल','doctor','health'], top:'सरकारी HOSPITAL मा:',   bottom:'QUEUE: 8 घण्टा, Doctor: 5 मिनेट 🏥😑', img:'hospital queue waiting long line' },
];
const _MEME_GENERIC = [
  { top:'EXPECTATION:',               bottom:'REALITY: NEPAL 😭',                     img:'expectation vs reality funny' },
  { top:'सरकारको PLAN:',              bottom:'जनताको HAAL: 🤦😅',                      img:'politician plan confused people' },
  { top:'जब PROBLEM आउँछ:',          bottom:'नेपाली: "चिया खाउँ अनि सोच्छौं" ☕😂',   img:'tea cup thinking problem relax' },
  { top:'NEPALI MAN को 3 DREAMS:',   bottom:'BIDESH, BIDESH, BIDESH 🛫😂',            img:'airplane airport dreaming travel' },
  { top:'आमाले सोध्नुभयो:',           bottom:'"पढ्दैछु" 📱😅 (MOBILE HERDING THO)', img:'teenager phone caught studying lie' },
  { top:'FRIDAY रात:',                bottom:'SATURDAY बिहान: 😴💀',                  img:'tired sleeping weekend morning funny' },
];

function memeGenerateTemplate() {
  const topic = document.getElementById('memeTopicInput') ? document.getElementById('memeTopicInput').value.toLowerCase() : '';
  let tmpl = _MEME_GENERIC[Math.floor(Math.random() * _MEME_GENERIC.length)];
  for (const t of _MEME_TEMPLATES_BY_KW) {
    if (t.kw.some(k => topic.includes(k))) { tmpl = t; break; }
  }
  document.getElementById('memeTopText').value    = tmpl.top;
  document.getElementById('memeBottomText').value = tmpl.bottom;
  const capEl = document.getElementById('memeCaptionText');
  if (capEl) {
    /* Generate a relevant caption based on the actual meme content */
    const topicLabel = document.getElementById('memeTopicInput')?.value?.trim() || 'Nepal';
    const captions = [
      `${tmpl.top}\n${tmpl.bottom}\n\n😂 Tag गर्नुस् जो यो situation मा छन्! यो share गर्न नबिर्सनुस् �\n#NepalMeme #नेपाली_मिम #${topicLabel.replace(/\s+/g,'_').replace(/[^\w_]/g,'')} #ShashiNewsGen #viral #trending #nepal #funnynepal`,
      `यो meme share गर्नुस् तपाईंको friends लाई! 😂🔥\n"${tmpl.top}" — सबैको यही हाल हो! 😭\n#NepalMeme #ShashiNewsGen #नेपालीहास्य #viral #nepal #meme #trending #relatable`,
      `😂😂 Nepali life is full of surprises!\n${tmpl.bottom}\nComment गर्नुस् — तपाईंको पनि यस्तै हो? 😅\n#NepalMeme #ShashiNewsGen #${topicLabel.replace(/\s+/g,'_').replace(/[^\w_]/g,'')} #funnynepal #trending #nepal #viral #हास्य`,
    ];
    capEl.value = captions[Math.floor(Math.random() * captions.length)];
  }
  /* Auto-search matching image for this template */
  const imgQ = tmpl.img || (topic.split(/\s+/).slice(0, 3).join(' ') || 'funny relatable meme');
  document.getElementById('memeImgQuery').value = imgQ;
  switchMemeImgSrc('search');
  searchMemeImages();
  renderMemeCanvas();
  memeSetStatus('⚡ Template meme ready!');
}

/* ── AI caption ── */
async function memeGenerateCaption() {
  const top = document.getElementById('memeTopText')    ? document.getElementById('memeTopText').value    : '';
  const bot = document.getElementById('memeBottomText') ? document.getElementById('memeBottomText').value : '';
  if (!top && !bot) { toast('⚠️ पहिले meme text लेख्नुस्', 'error'); return; }
  const hasAI = (_geminiKey || _browserGeminiKey || _browserGroqKey);
  if (!hasAI) {
    document.getElementById('memeCaptionText').value =
      `${top} ${bot} 😂😂\n#NepalMeme #नेपाली_मिम #ShashiNewsGen #viral #trending #nepal #funnynepal #meme`;
    return;
  }
  memeSetStatus('✨ Caption तयार गर्दैछ…');
  try {
    const result = await callAI(
      `Write a short funny Nepali social media caption (1-2 fun Nepali sentences mixing Nepali + English) and exactly 8 hashtags for this meme:\nTop: "${top}"\nBottom: "${bot}"\nOutput plain text only.`,
      15000
    );
    const txt = typeof result === 'string' ? result : (result && result.caption ? result.caption : '');
    if (txt) document.getElementById('memeCaptionText').value = txt;
    memeSetStatus('✅ Caption ready!');
  } catch { memeSetStatus('⚠️ Caption AI failed'); }
}

/* ── Download ── */
function downloadMeme() {
  const canvas = document.getElementById('memeCanvas');
  const a = document.createElement('a');
  a.download = 'ShashiMeme_' + Date.now() + '.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
  toast('💾 Meme downloaded!', 'success', 2500);
}

/* ── Copy to clipboard ── */
async function memeCopyImage() {
  const canvas = document.getElementById('memeCanvas');
  try {
    await new Promise((res, rej) =>
      canvas.toBlob(async blob => {
        try { await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]); res(); }
        catch (e) { rej(e); }
      })
    );
    toast('📋 Meme copied!', 'success', 2500);
  } catch { toast('⚠️ Clipboard copy failed — download गर्नुस्', 'error', 3000); }
}

/* ── Share (all studios) ── */
async function _shareCanvasToSocial(platform, canvasId, captionText, downloadFn) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const caption = captionText + '\n\nCreate yours → https://shajais.github.io/ShashiNewsGen/';

  if (platform === 'whatsapp') {
    const encoded = encodeURIComponent(caption);
    window.open('https://api.whatsapp.com/send?text=' + encoded, '_blank', 'noopener,width=620,height=520');
    return;
  }

  if (platform === 'instagram') {
    /* Instagram doesn't have a web share API for images — best UX: download + instruct */
    if (typeof downloadFn === 'function') downloadFn();
    toast('📸 Image downloaded! Instagram app खोलेर Story/Post मा upload गर्नुस्', 'info', 8000);
    return;
  }

  /* Try Web Share API (works on mobile Chrome/Safari) */
  if (navigator.canShare && platform === 'native') {
    try {
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'shashi-news-gen.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Shashi News Gen', text: caption });
        return;
      }
    } catch (e) { console.warn('Web Share:', e); }
  }

  /* Facebook — shares the site URL + quote text (images can't be shared directly via web) */
  if (platform === 'facebook') {
    const siteEnc = encodeURIComponent('https://shajais.github.io/ShashiNewsGen/');
    const textEnc = encodeURIComponent(caption);
    /* Download the image first so user can attach it manually */
    if (typeof downloadFn === 'function') downloadFn();
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${siteEnc}&quote=${textEnc}`, '_blank', 'noopener,width=620,height=520');
    toast('� Image downloaded! Facebook खुल्यो — Post मा image attach गर्न सक्नुहुन्छ', 'info', 7000);
    return;
  }

  /* Twitter / X */
  if (platform === 'twitter') {
    if (typeof downloadFn === 'function') downloadFn();
    const textEnc = encodeURIComponent(caption);
    window.open(`https://twitter.com/intent/tweet?text=${textEnc}`, '_blank', 'noopener,width=620,height=520');
    toast('💡 Image downloaded! Tweet मा image attach गर्नुस् 🐦', 'info', 6000);
    return;
  }
}

function shareMeme(platform) {
  const caption = (document.getElementById('memeCaptionText') ? document.getElementById('memeCaptionText').value : '😂 Nepal Meme!');
  _shareCanvasToSocial(platform, 'memeCanvas', caption, downloadMeme);
}

/* ================================================================
   PUZZLE STUDIO
   Viral math puzzles with Einstein photo, custom text, themes.
================================================================ */

const EINSTEIN_PHOTOS = [
  { id:'e1', label:'Einstein Classic',  emoji:'🧑‍🔬', url:'einstein3.jpg' },
  { id:'e2', label:'Einstein Brain 1',  emoji:'🧠',   url:'einstein_brain1.jpg' },
  { id:'e3', label:'Einstein Brain 2',  emoji:'�',   url:'einstein_brain2.jpg' },
];

const PUZZLE_THEMES = [
  { id:'viral',  label:'🔴 Viral Red',    bg:'#1a0000', accent:'#dc2626', text:'#ffffff', subtext:'#fca5a5', expr:'#ffffff',  badge:'#dc2626' },
  { id:'genius', label:'🟣 Genius Purple',bg:'#0f0020', accent:'#7c3aed', text:'#ffffff', subtext:'#c4b5fd', expr:'#f0e6ff', badge:'#7c3aed' },
  { id:'dark',   label:'⚫ Dark Classic', bg:'#0a0a0f', accent:'#f59e0b', text:'#ffffff', subtext:'#fde68a', expr:'#ffffff',  badge:'#f59e0b' },
  { id:'navy',   label:'🔵 Deep Navy',    bg:'#020617', accent:'#3b82f6', text:'#ffffff', subtext:'#93c5fd', expr:'#dbeafe', badge:'#3b82f6' },
  { id:'forest', label:'🟢 Forest',       bg:'#021007', accent:'#22c55e', text:'#ffffff', subtext:'#86efac', expr:'#dcfce7', badge:'#22c55e' },
  { id:'gold',   label:'🟡 Gold',         bg:'#1a1000', accent:'#eab308', text:'#ffffff', subtext:'#fef08a', expr:'#fefce8', badge:'#eab308' },
];

const PUZZLE_PRESETS = [
  { expr:'3 - 3 × 6 + 2 = ??',      answer:'-13' },
  { expr:'6 ÷ 2(1+2) = ??',        answer:'9'   },
  { expr:'1 + 1 + 1 + 1 × 0 = ??', answer:'3'   },
  { expr:'8 ÷ 2(2+2) = ??',        answer:'16'  },
  { expr:'5 + 5 × 5 - 5 = ??',     answer:'25'  },
  { expr:'2² + 2 × 2 - 2 = ??',    answer:'6'   },
  { expr:'10 - 1 - 2 × 3 = ??',    answer:'3'   },
  { expr:'√9 + 3² - 5 = ??',       answer:'7'   },
  { expr:'100 ÷ 4 × 0 + 8 = ??',   answer:'8'   },
  { expr:'4 + 4 ÷ 4 + 4 × 4 = ??', answer:'21'  },
];

let _puzzleTheme      = 'viral';
let _puzzleEinsteinId = null;
let _puzzleImgCache   = {};
let _puzzleCanvasW    = 600;
let _puzzleCanvasH    = 600;
let _puzzleInited     = false;

/* ── Einstein photo drag / resize state ── */
let _puzzlePhotoScale    = 0.55;   // fraction of canvas width (controls size)
let _puzzleDragging      = false;
let _puzzleDragStartY    = 0;
let _puzzleScaleAtDragStart = 0.55;

function openPuzzleStudio() {
  document.querySelector('.container').style.display        = 'none';
  document.getElementById('memeStudioModal').style.display  = 'none';
  document.getElementById('puzzleStudioModal').style.display = 'block';
  window.scrollTo({ top:0, behavior:'smooth' });
  ['newsStudioBtn','memeStudioBtn','puzzleStudioBtn'].forEach(id => {
    document.getElementById(id)?.classList.remove('active-studio-btn');
  });
  document.getElementById('puzzleStudioBtn')?.classList.add('active-studio-btn');
  const canvas = document.getElementById('puzzleCanvas');
  if (canvas) { canvas.width = _puzzleCanvasW; canvas.height = _puzzleCanvasH; }
  if (!_puzzleInited) { _buildEinsteinGrid(); _buildPuzzleThemeGrid(); _buildPuzzlePresetGrid(); _puzzleInited = true; }
  if (!_puzzleEinsteinId) {
    const r = EINSTEIN_PHOTOS[Math.floor(Math.random() * EINSTEIN_PHOTOS.length)];
    _selectEinsteinPhoto(r.id);
  } else { renderPuzzleCanvas(); }
}

function closePuzzleStudio() {
  document.getElementById('puzzleStudioModal').style.display = 'none';
  document.querySelector('.container').style.display = '';
  window.scrollTo({ top:0, behavior:'smooth' });
  document.getElementById('newsStudioBtn')?.classList.add('active-studio-btn');
  document.getElementById('puzzleStudioBtn')?.classList.remove('active-studio-btn');
}

/* Patch openMemeStudio + openNewsStudio to also hide puzzle modal */
const _ps_origOpenMeme = openMemeStudio;
openMemeStudio = function() {
  document.getElementById('puzzleStudioModal').style.display = 'none';
  document.getElementById('puzzleStudioBtn')?.classList.remove('active-studio-btn');
  _ps_origOpenMeme();
};
const _ps_origOpenNews = openNewsStudio;
openNewsStudio = function() {
  document.getElementById('puzzleStudioModal').style.display = 'none';
  document.getElementById('puzzleStudioBtn')?.classList.remove('active-studio-btn');
  _ps_origOpenNews();
};

function _buildEinsteinGrid() {
  const grid = document.getElementById('einsteinPhotoGrid');
  if (!grid) return;
  grid.innerHTML = '';
  EINSTEIN_PHOTOS.forEach(p => {
    const btn = document.createElement('button');
    btn.id = 'einsteinBtn_' + p.id;
    btn.title = p.label;
    btn.style.cssText = 'background:var(--card2);border:3px solid var(--border);border-radius:10px;padding:4px;cursor:pointer;transition:all .2s;width:80px;display:flex;flex-direction:column;align-items:center;gap:4px';
    btn.innerHTML = `<img src="${p.url}" alt="${p.label}" crossorigin="anonymous" style="width:72px;height:72px;object-fit:cover;border-radius:6px" onerror="this.parentElement.style.display='none'"><span style="font-size:.65rem;color:var(--muted);text-align:center;line-height:1.2">${p.emoji} ${p.label}</span>`;
    btn.onclick = () => _selectEinsteinPhoto(p.id);
    grid.appendChild(btn);
    _preloadEinsteinImg(p);
  });
}

function _preloadEinsteinImg(p) {
  if (_puzzleImgCache[p.id]) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload  = () => { _puzzleImgCache[p.id] = img; if (_puzzleEinsteinId === p.id) renderPuzzleCanvas(); };
  img.onerror = () => console.warn('[Puzzle] Einstein load failed:', p.url);
  img.src = p.url;
}

function _selectEinsteinPhoto(id) {
  _puzzleEinsteinId = id;
  /* Reset size to default when a new photo is chosen */
  _puzzlePhotoScale = 0.55;
  EINSTEIN_PHOTOS.forEach(p => {
    const btn = document.getElementById('einsteinBtn_' + p.id);
    if (btn) btn.style.borderColor = (p.id === id) ? '#7c3aed' : 'var(--border)';
  });
  if (!_puzzleImgCache[id]) _preloadEinsteinImg(EINSTEIN_PHOTOS.find(p => p.id === id));
  renderPuzzleCanvas();
}

function _buildPuzzleThemeGrid() {
  const grid = document.getElementById('puzzleThemeGrid');
  if (!grid) return;
  grid.innerHTML = '';
  PUZZLE_THEMES.forEach(t => {
    const btn = document.createElement('button');
    btn.id = 'puzzleThemeBtn_' + t.id;
    btn.textContent = t.label;
    btn.style.cssText = `padding:5px 12px;border-radius:20px;border:2px solid ${t.accent};background:${t.bg};color:${t.text};font-size:.75rem;font-weight:700;cursor:pointer;transition:all .2s;opacity:${_puzzleTheme===t.id?1:.65}`;
    btn.onclick = () => {
      _puzzleTheme = t.id;
      PUZZLE_THEMES.forEach(tt => {
        const b = document.getElementById('puzzleThemeBtn_'+tt.id);
        if (b) b.style.opacity = (tt.id===t.id)?'1':'0.65';
      });
      renderPuzzleCanvas();
    };
    grid.appendChild(btn);
  });
}

function _buildPuzzlePresetGrid() {
  const grid = document.getElementById('puzzlePresetGrid');
  if (!grid) return;
  grid.innerHTML = '';
  PUZZLE_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'meme-trending-chip';
    btn.style.fontSize = '.72rem';
    btn.textContent = p.expr;
    btn.onclick = () => {
      document.getElementById('puzzleExpr').value   = p.expr;
      document.getElementById('puzzleAnswer').value = p.answer;
      renderPuzzleCanvas();
    };
    grid.appendChild(btn);
  });
}

function setPuzzleSize(val) {
  const [w,h] = val.split('x').map(Number);
  _puzzleCanvasW = w; _puzzleCanvasH = h;
  const canvas = document.getElementById('puzzleCanvas');
  if (canvas) { canvas.width = w; canvas.height = h; }
  const lbl = document.getElementById('puzzleCanvasDims');
  if (lbl) lbl.textContent = `${w} × ${h}`;
  /* Reset photo size to default for new canvas dimensions */
  _puzzlePhotoScale = 0.55;
  renderPuzzleCanvas();
}

function puzzleRandomize() {
  const p     = PUZZLE_PRESETS[Math.floor(Math.random()*PUZZLE_PRESETS.length)];
  const photo = EINSTEIN_PHOTOS[Math.floor(Math.random()*EINSTEIN_PHOTOS.length)];
  const theme = PUZZLE_THEMES[Math.floor(Math.random()*PUZZLE_THEMES.length)];
  document.getElementById('puzzleExpr').value   = p.expr;
  document.getElementById('puzzleAnswer').value = p.answer;
  _puzzleTheme = theme.id;
  PUZZLE_THEMES.forEach(t => {
    const b = document.getElementById('puzzleThemeBtn_'+t.id);
    if (b) b.style.opacity = (t.id===theme.id)?'1':'0.65';
  });
  _selectEinsteinPhoto(photo.id);
  toast('🎲 Random puzzle!', 'success', 2000);
}

/* ── Generate a random ORDER-OF-OPERATIONS equation (whole numbers, ??  answer) ── */
function puzzleGenerateRandom() {
  /* Convert × ÷ to JS operators for safe eval */
  const toJS = op => op === '×' ? '*' : op === '÷' ? '/' : op;
  const ops = ['+', '-', '×', '÷'];
  const styles = [
    /* a OP b OP c = ??  (evaluated with proper BODMAS via JS eval) */
    () => {
      const a = _rn(1,20), b = _rn(1,10), c = _rn(1,10);
      const op1 = ops[Math.floor(Math.random()*4)];
      const op2 = ops[Math.floor(Math.random()*4)];
      // Avoid division by zero
      if ((op1 === '÷' && b === 0) || (op2 === '÷' && c === 0)) return null;
      const ans = _evalJS(`${a}${toJS(op1)}${b}${toJS(op2)}${c}`);
      return { expr: `${a} ${op1} ${b} ${op2} ${c} = ??`, answer: _fmt(ans) };
    },
    /* a OP b × c = ?? (BODMAS trap) */
    () => {
      const a = _rn(1,15), b = _rn(2,8), c = _rn(2,8);
      const op = _rn(0,1) ? '+' : '-';
      const ans = _evalJS(`${a}${toJS(op)}${b}*${c}`);
      return { expr: `${a} ${op} ${b} × ${c} = ??`, answer: _fmt(ans) };
    },
    /* a ÷ b(c+d) = ?? */
    () => {
      const c = _rn(1,5), d = _rn(1,5), b = _rn(1,4), k = _rn(1,3);
      const a = b * (c + d) * k;
      return { expr: `${a} ÷ ${b}(${c}+${d}) = ??`, answer: _fmt(a / (b * (c + d))) };
    },
    /* a + a + a + a × 0 = ?? */
    () => {
      const a = _rn(1,9);
      return { expr: `${a} + ${a} + ${a} + ${a} × 0 = ??`, answer: `${a + a + a}` };
    },
    /* √a + b² - c = ?? */
    () => {
      const sq = [1,4,9,16,25,36,49,64,81,100];
      const a  = sq[Math.floor(Math.random() * sq.length)];
      const b  = _rn(2,7), c = _rn(1,10);
      return { expr: `√${a} + ${b}² - ${c} = ??`, answer: _fmt(Math.sqrt(a) + b*b - c) };
    },
    /* a² + a × a - a = ?? */
    () => {
      const a = _rn(2,8);
      return { expr: `${a}² + ${a} × ${a} - ${a} = ??`, answer: _fmt(a*a + a*a - a) };
    },
  ];
  let result = null;
  // Retry if a style returns null (e.g. division by zero edge case)
  for (let i = 0; i < 10 && !result; i++) {
    result = styles[Math.floor(Math.random() * styles.length)]();
  }
  if (!result) return;
  document.getElementById('puzzleExpr').value   = result.expr;
  document.getElementById('puzzleAnswer').value = result.answer;
  renderPuzzleCanvas();
  toast('🎲 New random equation!', 'success', 1800);
}

/* ── Generate ANY wild random math (bigger numbers, mixed ops) ── */
function puzzleGenerateRandomAny() {
  const sq = [4,9,16,25,36,49,64,81,100,121,144];
  const templates = [
    /* pre-compute ALL random values so expr and answer use the SAME numbers */
    () => {
      const a=_rn(10,99), b=_rn(10,99), c=_rn(2,9), d=_rn(1,5);
      return { expr:`${a} + ${b} - ${c} × ${d} = ??`, answer:_fmt(a+b-c*d) };
    },
    () => {
      const a=_rn(2,12), b=_rn(2,12), e=_rn(1,20);
      return { expr:`${a}² × ${b} - ${e} = ??`, answer:_fmt(a*a*b-e) };
    },
    () => {
      const a=_rn(2,10)*_rn(2,10), b=_rn(2,10), e=_rn(1,30); // ensure clean division
      const divisor = Math.gcd ? Math.gcd(a,b) : b;
      return { expr:`${a} ÷ ${b} + ${e} = ??`, answer:_fmt(a/b+e) };
    },
    () => {
      const a=_rn(1,9), b=_rn(1,9), c=_rn(1,9), d=_rn(1,9), e=_rn(1,5);
      return { expr:`${a} + ${b} + ${c} + ${d} × 0 + ${e} = ??`, answer:`${a+b+c+e}` };
    },
    () => {
      const a=_rn(3,9), b=_rn(2,9), f=_rn(1,a-1);
      return { expr:`(${a} + ${b}) × (${a} - ${f}) = ??`, answer:_fmt((a+b)*(a-f)) };
    },
    () => {
      const a=sq[Math.floor(Math.random()*sq.length)], b=_rn(1,10), e=_rn(1,15);
      return { expr:`√${a} × ${b} + ${e} = ??`, answer:_fmt(Math.sqrt(a)*b+e) };
    },
    () => {
      const a=_rn(1,5), b=_rn(1,5), c=_rn(1,5);
      return { expr:`${a}³ + ${b}² - ${c} = ??`, answer:_fmt(a*a*a+b*b-c) };
    },
    () => {
      const a=_rn(10,50), e=_rn(1,20), f=_rn(1,10);
      return { expr:`${a} × 0 + ${e} × ${f} = ??`, answer:_fmt(e*f) };
    },
  ];
  const { expr, answer } = templates[Math.floor(Math.random()*templates.length)]();
  document.getElementById('puzzleExpr').value   = expr;
  document.getElementById('puzzleAnswer').value = answer;
  renderPuzzleCanvas();
  toast('🔀 Wild math generated!', 'success', 1800);
}

/* Helpers */
function _rn(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }
function _fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '??';
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '');
}
function _evalJS(expr) {
  try { return Function('"use strict";return (' + expr + ')')(); } catch { return null; }
}
function _evalExpr(a, op, b) {
  switch(op) { case '+': return a+b; case '-': return a-b; case '×': return a*b; case '÷': return b!==0?a/b:null; }
  return null;
}
function _solveLeft(a, op1, b, op2, c) {
  const right = _evalExpr(b, op2, c);
  return right !== null ? _evalExpr(a, op1, right) : null;
}

async function renderPuzzleCanvas() {
  const canvas = document.getElementById('puzzleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const theme = PUZZLE_THEMES.find(t => t.id === _puzzleTheme) || PUZZLE_THEMES[0];

  const expr       = (document.getElementById('puzzleExpr')?.value       || '3 - 3 × 6 + 2 = ??').trim();
  const answer     = (document.getElementById('puzzleAnswer')?.value     || '').trim();
  const showAnswer = document.getElementById('puzzleShowAnswer')?.checked;
  const topText    = (document.getElementById('puzzleTopText')?.value    || 'CAN YOU SOLVE IT?').trim();
  const subText    = (document.getElementById('puzzleSubText')?.value    || '90% FAIL THIS!').trim();
  const bottomText = (document.getElementById('puzzleBottomText')?.value || 'ONLY FOR GENIUS').trim();
  const fontSize   = parseInt(document.getElementById('puzzleFontSize')?.value || 68);
  const watermark  = document.getElementById('puzzleWatermark')?.checked !== false;

  /* ════════════════════════════════════════════════════════
     LAYOUT  (all measurements relative to W / H)
     ┌──────────────────────────────────────────────────┐
     │          TOP BAR  (full width, ~18% H)           │
     │   "Can you solve it?" — big bold pill            │
     │   "90% Fail this!"   — sub line                  │
     ├─────────────────────┬────────────────────────────┤
     │                     │  "ONLY FOR GENIUS"  label  │
     │   Einstein photo    │  ┌──────────────────────┐  │
     │   (middle-left,     │  │   math puzzle expr   │  │
     │    vertically       │  └──────────────────────┘  │
     │    centred)         │  answer (if shown)          │
     │                     │  💬 comment CTA            │
     ├─────────────────────┴────────────────────────────┤
     │              WATERMARK  (full width)             │
     └──────────────────────────────────────────────────┘
     ════════════════════════════════════════════════════ */

  const PAD    = Math.round(W * 0.035);
  const WM_H   = watermark ? Math.round(H * 0.06) : 0;
  const TOP_H  = Math.round(H * 0.20);          // top header zone
  const MID_H  = H - TOP_H - WM_H;              // middle content zone
  const MID_Y  = TOP_H;                          // where middle zone starts
  const HALF   = Math.round(W * 0.5);            // vertical split point (50/50)

  /* ═══════════════════════════════════════════════════════
     STEP 1 — Full-canvas dark background
     ═══════════════════════════════════════════════════════ */
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   theme.bg);
  grad.addColorStop(0.5, _pzLighten(theme.bg, 20));
  grad.addColorStop(1,   theme.bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  /* Subtle dot/grid texture across whole canvas */
  ctx.save();
  ctx.strokeStyle = theme.accent + '15';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 38) { ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,H); ctx.stroke(); }
  for (let gy = 0; gy < H; gy += 38) { ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(W,gy); ctx.stroke(); }
  ctx.restore();

  /* ═══════════════════════════════════════════════════════
     STEP 2 — TOP HEADER BAR (full width)
     ═══════════════════════════════════════════════════════ */
  /* Solid accent fill */
  ctx.save();
  ctx.fillStyle = theme.badge;
  _pzRoundRect(ctx, 0, 0, W, TOP_H, 0); ctx.fill();
  /* Subtle inner glow at bottom edge */
  const topEdge = ctx.createLinearGradient(0, TOP_H - 6, 0, TOP_H);
  topEdge.addColorStop(0, 'transparent');
  topEdge.addColorStop(1, 'rgba(255,255,255,0.12)');
  ctx.fillStyle = topEdge;
  ctx.fillRect(0, 0, W, TOP_H);
  ctx.restore();

  /* Line 1: "CAN YOU SOLVE IT?" — big, full width, Impact */
  {
    ctx.save();
    const line1Y = Math.round(TOP_H * 0.08);
    const line1H = Math.round(TOP_H * 0.52);
    let fs1 = Math.round(line1H * 0.78);
    ctx.font = `900 ${fs1}px Impact,Arial Black,sans-serif`;
    while (ctx.measureText(topText).width > W - PAD * 2 && fs1 > 12) {
      fs1--; ctx.font = `900 ${fs1}px Impact,Arial Black,sans-serif`;
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
    ctx.fillText(topText, W / 2, line1Y);
    ctx.restore();
  }

  /* Line 2: "90% FAIL THIS!" — slightly smaller, accent colour */
  {
    ctx.save();
    const line2Y = Math.round(TOP_H * 0.58);
    const line2H = Math.round(TOP_H * 0.36);
    let fs2 = Math.round(line2H * 0.72);
    ctx.font = `800 ${fs2}px Arial Black,Impact,sans-serif`;
    while (ctx.measureText(subText).width > W - PAD * 4 && fs2 > 10) {
      fs2--; ctx.font = `800 ${fs2}px Arial Black,Impact,sans-serif`;
    }
    ctx.fillStyle = '#ffffffcc';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5;
    ctx.fillText(subText, W / 2, line2Y);
    ctx.restore();
  }

  /* Thin accent bottom border on header */
  ctx.save();
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, TOP_H - 4, W, 4);
  ctx.restore();

  /* ═══════════════════════════════════════════════════════
     STEP 3 — Einstein photo
     Always centred in the left half of the middle zone.
     Drag up/down on canvas to resize (up = grow, down = shrink).
     ═══════════════════════════════════════════════════════ */
  const eImg = _puzzleImgCache[_puzzleEinsteinId] || null;

  if (eImg) {
    const aspect = eImg.naturalWidth / eImg.naturalHeight;
    const photoW = Math.round(W * _puzzlePhotoScale);
    const photoH = Math.round(photoW / aspect);

    /* Always centred in left half, vertically centred in middle zone */
    const drawX = Math.round((HALF - photoW) / 2);
    const drawY = MID_Y + Math.round((MID_H - photoH) / 2);

    ctx.save();
    ctx.drawImage(eImg, drawX, drawY, photoW, photoH);

    /* Right-edge fade so photo blends into right text area */
    const rFade = ctx.createLinearGradient(HALF - Math.round(W * 0.18), 0, HALF + Math.round(W * 0.04), 0);
    rFade.addColorStop(0, 'transparent');
    rFade.addColorStop(1, theme.bg);
    ctx.fillStyle = rFade;
    ctx.fillRect(drawX, drawY, photoW, photoH);

    /* Bottom-edge fade into watermark */
    if (WM_H) {
      const bFade = ctx.createLinearGradient(0, H - WM_H * 2.5, 0, H - WM_H);
      bFade.addColorStop(0, 'transparent');
      bFade.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = bFade;
      ctx.fillRect(drawX, drawY, photoW, photoH);
    }
    ctx.restore();
  } else {
    /* Placeholder */
    ctx.save();
    ctx.fillStyle = theme.accent + '22';
    ctx.fillRect(0, MID_Y, HALF, MID_H);
    ctx.font = `${Math.round(HALF * 0.3)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🧑‍🔬', HALF / 2, MID_Y + MID_H / 2);
    ctx.restore();
  }

  /* ═══════════════════════════════════════════════════════
     STEP 4 — MIDDLE-RIGHT: "Only for Genius" + Puzzle box
     ═══════════════════════════════════════════════════════ */
  const rxPad  = PAD;                                    // gap from centre split
  const rxPadR = Math.round(W * 0.06);                   // breathing room from right canvas edge
  const rxX    = HALF + rxPad;                           // right text zone x-start
  const rxW    = W - HALF - rxPad - rxPadR;              // right text zone width
  const rxMidY = MID_Y + Math.round(MID_H / 2);         // vertical centre of middle zone

  /* Helper: auto-shrink font to fit rxW, draw centred in right zone.
     Clips drawing to the right text zone so nothing bleeds over the edge. */
  function _pzR(text, font, color, shadow, y, align) {
    ctx.save();
    /* Clip to right text zone so text can never bleed past right canvas edge */
    ctx.beginPath();
    ctx.rect(rxX, MID_Y, rxW, MID_H + WM_H);
    ctx.clip();
    ctx.font = font; ctx.fillStyle = color;
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'top';
    if (shadow) { ctx.shadowColor = shadow; ctx.shadowBlur = 10; }
    let sz = parseInt(font);
    const cx = align === 'left' ? rxX : rxX + rxW / 2;
    while (ctx.measureText(text).width > rxW && sz > 10) {
      sz--; ctx.font = font.replace(/^\d+/, sz);
    }
    ctx.fillText(text, cx, y);
    ctx.restore();
    return y + sz * 1.3;
  }

  /* Vertical layout: figure out total height of right content, then
     vertically centre the whole block relative to the middle zone          */
  const geniusFs  = Math.round(H * 0.052);
  const exprBoxH  = Math.round(MID_H * 0.38);
  const ansFs     = Math.round(H * 0.034);
  const ctaFs     = Math.round(H * 0.026);
  const spacing   = Math.round(H * 0.018);

  /* Pre-calculate total block height so we can centre it */
  const geniusLabelH  = geniusFs * 1.3 + spacing;
  const underlineH    = spacing;
  const answerBlockH  = (showAnswer && answer) ? (ansFs * 1.4 + spacing * 0.5) : 0;
  const ctaBlockH     = ctaFs * 1.3;
  const totalBlockH   = geniusLabelH + underlineH + exprBoxH + spacing + answerBlockH + ctaBlockH;
  /* Start Y so the block is vertically centred in the middle zone */
  let rightY = MID_Y + Math.round((MID_H - totalBlockH) / 2);
  if (rightY < MID_Y + spacing) rightY = MID_Y + spacing;   // safety clamp

  /* 4a. "ONLY FOR GENIUS" label */
  {
    ctx.save();
    ctx.font = `italic 900 ${geniusFs}px Georgia,serif`;
    ctx.fillStyle = theme.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = theme.accent; ctx.shadowBlur = 14;
    let sz = geniusFs;
    while (ctx.measureText(bottomText).width > rxW && sz > 12) {
      sz--; ctx.font = `italic 900 ${sz}px Georgia,serif`;
    }
    ctx.fillText(bottomText, rxX + rxW / 2, rightY);
    ctx.restore();
    rightY += geniusFs * 1.3 + spacing;
  }

  /* Thin accent underline below genius label */
  ctx.save();
  ctx.strokeStyle = theme.accent + 'aa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rxX, rightY - spacing * 0.5);
  ctx.lineTo(rxX + rxW, rightY - spacing * 0.5);
  ctx.stroke();
  ctx.restore();
  rightY += spacing * 0.5;

  /* 4b. Puzzle expression box */
  {
    const boxY = rightY;
    ctx.save();
    /* Clip the entire box to the right text zone */
    ctx.beginPath();
    ctx.rect(rxX, MID_Y, rxW, MID_H + WM_H);
    ctx.clip();
    /* Box fill — subtle tinted background */
    ctx.fillStyle = theme.accent + '20';
    _pzRoundRect(ctx, rxX, boxY, rxW, exprBoxH, 18); ctx.fill();
    /* Crisp solid border — no shadow/blur */
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 3;
    _pzRoundRect(ctx, rxX, boxY, rxW, exprBoxH, 18); ctx.stroke();

    /* Expression text — NO shadow/blur at all, pure crisp */
    let fs = fontSize;
    ctx.font = `900 ${fs}px Impact,"Arial Black",sans-serif`;
    while (ctx.measureText(expr).width > rxW - 24 && fs > 14) {
      fs -= 2; ctx.font = `900 ${fs}px Impact,"Arial Black",sans-serif`;
    }
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle   = theme.expr;
    ctx.textAlign   = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(expr, rxX + rxW / 2, boxY + exprBoxH / 2);
    ctx.restore();
    rightY = boxY + exprBoxH + spacing;
  }

  /* 4c. Answer (optional) */
  if (showAnswer && answer) {
    rightY = _pzR(`✅  Answer: ${answer}`, `800 ${ansFs}px Arial,sans-serif`,
                  theme.accent + 'ee', 'rgba(0,0,0,0.6)', rightY);
    rightY += spacing * 0.5;
  }

  /* 4d. CTA — position depends on format:
     • Square / Landscape (W >= H): below the puzzle box in the right zone (in-flow)
     • Portrait / Story / Reel  (H > W): full-width centred just above watermark */
  const _isPortrait = H > W;
  if (_isPortrait) {
    /* Full-width, centred, pinned just above watermark */
    const ctaY = H - WM_H - Math.round(H * 0.055);
    let ctaSize = ctaFs;
    ctx.save();
    ctx.font = `600 ${ctaSize}px Arial,sans-serif`;
    while (ctx.measureText('💬 Comment your answer ↓').width > W - PAD * 4 && ctaSize > 10) {
      ctaSize--;
      ctx.font = `600 ${ctaSize}px Arial,sans-serif`;
    }
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = theme.subtext + 'cc';
    ctx.shadowColor  = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur   = 6;
    ctx.fillText('💬 Comment your answer ↓', W / 2, ctaY);
    ctx.restore();
  } else {
    /* Square / Landscape — draw in-flow below puzzle box inside right zone */
    _pzR('💬 Comment your answer ↓', `600 ${ctaFs}px Arial,sans-serif`,
         theme.subtext + 'cc', null, rightY);
  }

  /* ═══════════════════════════════════════════════════════
     STEP 5 — WATERMARK STRIP (full width, bottom)
     ═══════════════════════════════════════════════════════ */
  if (watermark) {
    await _drawAuthorWatermark(ctx, W, 0, 'Puzzle');
  }
}

function _pzRoundRect(ctx,x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function _pzLighten(hex,amt) {
  const h=hex.replace('#','');
  if(h.length!==6) return hex;
  return '#'+[0,2,4].map(i=>Math.min(255,parseInt(h.slice(i,i+2),16)+amt).toString(16).padStart(2,'0')).join('');
}

function downloadPuzzle() {
  const canvas = document.getElementById('puzzleCanvas');
  const expr   = (document.getElementById('puzzleExpr')?.value||'puzzle').replace(/[^\w]/g,'_').slice(0,20);
  const a = document.createElement('a');
  a.download = `puzzle_${expr}_${Date.now()}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  toast('⬇️ Puzzle downloaded!','success',2500);
}

async function puzzleCopyImage() {
  const canvas = document.getElementById('puzzleCanvas');
  try {
    await new Promise((res,rej)=>canvas.toBlob(async blob=>{
      try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);res();}
      catch(e){rej(e);}
    }));
    toast('📋 Puzzle copied!','success',2500);
  } catch { toast('⚠️ Copy failed — download गर्नुस्','error',3000); }
}

/* ── Puzzle Einstein photo — drag / resize handlers ────────────
   The canvas element has onmousedown/move/up/leave and onwheel
   handlers wired in index.html. These functions implement free
   drag-to-reposition and scroll-to-resize behaviour.
   ──────────────────────────────────────────────────────────── */
function _puzzleCanvasScale() {
  /* Returns the CSS-to-canvas pixel ratio for the puzzle canvas */
  const canvas = document.getElementById('puzzleCanvas');
  if (!canvas) return 1;
  const rect = canvas.getBoundingClientRect();
  return canvas.width / rect.width;
}

function puzzlePhotoDragStart(e) {
  e.preventDefault();
  _puzzleDragging          = true;
  const ratio              = _puzzleCanvasScale();
  _puzzleDragStartY        = e.clientY * ratio;
  _puzzleScaleAtDragStart  = _puzzlePhotoScale;
}

function puzzlePhotoDragMove(e) {
  if (!_puzzleDragging) return;
  e.preventDefault();
  const ratio   = _puzzleCanvasScale();
  /* dy in canvas pixels — drag UP (negative dy) = grow, drag DOWN = shrink */
  const dy      = e.clientY * ratio - _puzzleDragStartY;
  const canvas  = document.getElementById('puzzleCanvas');
  const H       = canvas ? canvas.height : 600;
  /* Map vertical drag distance to scale change (full canvas height = ±0.7 scale) */
  const delta   = -(dy / H) * 0.7;
  _puzzlePhotoScale = Math.min(1.2, Math.max(0.15, _puzzleScaleAtDragStart + delta));
  renderPuzzleCanvas();
}

function puzzlePhotoDragEnd(e) {
  _puzzleDragging = false;
}

function puzzlePhotoWheel(e) {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.03 : -0.03;
  _puzzlePhotoScale = Math.min(1.2, Math.max(0.15, _puzzlePhotoScale + delta));
  renderPuzzleCanvas();
}

function puzzlePhotoTouchStart(e) {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    puzzlePhotoDragStart({ clientY: t.clientY, preventDefault: () => e.preventDefault() });
  }
}

function puzzlePhotoTouchMove(e) {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    puzzlePhotoDragMove({ clientY: t.clientY, preventDefault: () => e.preventDefault() });
  } else if (e.touches.length === 2) {
    /* Pinch to resize */
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!puzzlePhotoTouchMove._lastDist) { puzzlePhotoTouchMove._lastDist = dist; return; }
    const ratio = dist / puzzlePhotoTouchMove._lastDist;
    _puzzlePhotoScale = Math.min(1.2, Math.max(0.15, _puzzlePhotoScale * ratio));
    puzzlePhotoTouchMove._lastDist = dist;
    renderPuzzleCanvas();
  }
}

function sharePuzzle(platform) {
  const expr    = document.getElementById('puzzleExpr')?.value || 'Math Puzzle';
  const caption = `🧩 Can you solve it??\n\n${expr}\n\n90% fail! Only for genius 🧠\n#MathPuzzle #ShashiNewsGen #viral #nepal #puzzle #genius #mathchallenge #trending`;
  _shareCanvasToSocial(platform, 'puzzleCanvas', caption, downloadPuzzle);
}

/* ── Puzzle Studio live-render bindings ── */
document.addEventListener('DOMContentLoaded', () => {
  ['puzzleExpr','puzzleAnswer','puzzleTopText','puzzleSubText','puzzleBottomText',
   'puzzleFontSize'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderPuzzleCanvas);
  });
  ['puzzleSize'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (id==='puzzleSize') setPuzzleSize(document.getElementById(id).value);
      else renderPuzzleCanvas();
    });
  });
  ['puzzleShowAnswer','puzzleWatermark'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderPuzzleCanvas);
  });
});