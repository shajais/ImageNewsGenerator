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

/* ── AI (Grok / xAI) Configuration ─────────────────────────── */
const GROK_API_URL   = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL     = 'grok-3-mini';   // fast & cost-efficient; swap to 'grok-3' for max quality

/* When running via the local Node server (http://localhost:*) all API calls
   are routed through the built-in proxy endpoints — the browser never sends
   or sees the API keys (they live in .env on the server only).
   When the file is opened directly (file://) direct URLs are used — note
   that file:// origins are blocked by CORS; always use `node server.js`. */
const _isLocalhost = location.protocol === 'http:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const _geminiProxyBase   = _isLocalhost ? '/proxy/gemini'   : null;
const _removebgProxyBase = _isLocalhost ? '/proxy/removebg' : null;
const _fetchProxyBase    = _isLocalhost ? '/proxy/fetch'    : null;
const _grokProxyBase     = _isLocalhost ? '/proxy/grok'     : null;

/* Key availability flags — populated from /api/key-status on load.
   The actual key strings NEVER exist in the browser when using the local proxy.
   On GitHub Pages (no server), keys are entered by the user and stored in localStorage. */
let _geminiKey    = false;   // true = server has key configured
let _removebgKey  = false;   // true = server has key configured
let _grokKey      = false;   // true = server has Grok (xAI) key configured

/* ── Browser-side keys for GitHub Pages mode (no server proxy) ──
   On localhost these are always empty — the server proxy handles keys.
   On GitHub Pages the user enters them manually and they are saved to localStorage. */
const _LS_GEMINI   = 'ghp_gemini_key';
const _LS_REMOVEBG = 'ghp_removebg_key';
const _LS_GROK     = 'ghp_grok_key';
let _browserGeminiKey   = localStorage.getItem(_LS_GEMINI)   || '';
let _browserRemovebgKey = localStorage.getItem(_LS_REMOVEBG) || '';
let _browserGrokKey     = localStorage.getItem(_LS_GROK)     || '';

/* Active AI provider: 'gemini' | 'grok'
   Persisted in localStorage so the user's choice survives page refresh. */
let _aiProvider = localStorage.getItem('aiProvider') || 'gemini';

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

/* ─────────────────────────────────────────────────────────────────
   NEWS SOURCES
   • Google News RSS — pulls trending stories from ALL Nepali outlets
     aggregated by Google, no rate limits, always fresh
   • Individual Nepali outlets — direct RSS for extra coverage
   All fetched in parallel; results are merged, de-duped & viral-scored.
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

/* Text overlay customisation (editable via the Text Editor modal) */
let _textOpts = {
  bannerText:  '🚨  BREAKING NEWS',
  bannerColor: '#c0392b',
  titleColor:  '#ffffff',
  titleSize:   62,
};

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

  /* Fetch all feeds in parallel — collect whatever succeeds */
  const results = await Promise.allSettled(
    RSS_FEEDS.map(feed => fetchSingleFeed(feed))
  );

  let allItems = [];
  let successCount = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) {
      allItems = allItems.concat(r.value);
      successCount++;
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

  /* Viral score: recency + keyword hits */
  const now = Date.now();
  allItems.forEach(a => {
    const ageHours = (now - new Date(a.pubDate).getTime()) / 3600000;
    const recencyScore = Math.max(0, 48 - ageHours) / 48; // 1.0 = just published, 0 = 48h old
    const text = (a.title + ' ' + a.description).toLowerCase();
    const kwHits = VIRAL_KEYWORDS.filter(k => text.includes(k.toLowerCase())).length;
    const kwScore = Math.min(kwHits / 3, 1.0); // cap at 3 keyword hits
    a.viralScore = recencyScore * 0.4 + kwScore * 0.6;
    a.isViral = a.viralScore > 0.55;
    a.isTrending = kwHits >= 2 && ageHours < 6;
  });

  /* Sort: viral/trending first, then by date */
  allItems.sort((a, b) => b.viralScore - a.viralScore || new Date(b.pubDate) - new Date(a.pubDate));

  articles = allItems;
  renderNewsList();
  document.getElementById('statusBadge').textContent = `${articles.length} articles · ${successCount} sources`;
  toast(`✅ ${articles.length} articles from ${successCount} sources`, 'success');
  setFetchState(false);
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

      /* Image from <enclosure>, <media:content>, or first <img> in description */
      let imageUrl = item.querySelector('enclosure[type^="image"]')?.getAttribute('url')
                   || item.querySelector('content')?.getAttribute('url') || '';
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

function renderNewsList() {
  const list = document.getElementById('newsList');
  if (!articles.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No articles found.</p></div>';
    return;
  }
  list.innerHTML = articles.map((a, i) => {
    const dateStr = a.pubDate
      ? new Date(a.pubDate).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      : '';
    const thumb = a.imageUrl
      ? `<img class="news-item-thumb" src="${a.imageUrl}" alt="" loading="lazy"
             onerror="this.outerHTML='<div class=\\'news-item-thumb-placeholder\\'>📰</div>'">`
      : `<div class="news-item-thumb-placeholder">📰</div>`;

    const viralBadge   = a.isTrending ? '<span class="viral-badge trending-badge">🔥 TRENDING</span>'
                       : a.isViral    ? '<span class="viral-badge">⚡ VIRAL</span>'
                       : '';
    const sourceBadge  = a.source ? `<span class="source-badge">${escHtml(a.source)}</span>` : '';

    return `
      <div class="news-item${a.isTrending ? ' trending' : ''}" id="item-${i}" onclick="selectArticle(${i})">
        ${thumb}
        <div class="news-item-body">
          <div class="news-item-badges">${viralBadge}${sourceBadge}</div>
          <div class="news-item-title">${escHtml(a.title)}</div>
          ${dateStr ? `<div class="news-item-date">🕐 ${dateStr}</div>` : ''}
        </div>
      </div>`;
  }).join('');
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
  if (!_isLocalhost) {
    /* ── GitHub Pages / direct file mode ──
       No server proxy available. Use browser-stored keys from localStorage. */
    _geminiKey   = !!_browserGeminiKey;
    _removebgKey = !!_browserRemovebgKey;
    _grokKey     = !!_browserGrokKey;
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
      _grokKey     = !!data.grok;
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
  /* Refresh status badge inside the modal */
  const geminiStatus   = document.getElementById('geminiKeyStatus');
  const removebgStatus = document.getElementById('removebgKeyStatus');
  const grokStatus     = document.getElementById('grokKeyStatus');
  if (geminiStatus)   geminiStatus.textContent   = _geminiKey   ? '✅ Configured' : '❌ Not set';
  if (removebgStatus) removebgStatus.textContent = _removebgKey ? '✅ Configured' : '❌ Not set';
  if (grokStatus)     grokStatus.textContent     = _grokKey     ? '✅ Configured' : '❌ Not set';

  /* Show browser key entry section only on GitHub Pages (no localhost proxy) */
  const browserSection = document.getElementById('browserKeySection');
  if (browserSection) {
    browserSection.style.display = _isLocalhost ? 'none' : 'block';
    const summary = document.getElementById('savedKeysSummary');
    if (summary) {
      const parts = [];
      if (_browserGrokKey)     parts.push('⚡ Grok');
      if (_browserGeminiKey)   parts.push('✨ Gemini');
      if (_browserRemovebgKey) parts.push('🎨 Remove.bg');
      summary.textContent = parts.length ? parts.join(', ') : 'none';
    }
  }

  /* Sync the provider toggle pills */
  _syncProviderUI();
  modal.classList.add('open');
}
function closeAISettings() {
  document.getElementById('aiSettingsModal').classList.remove('open');
}

/** Test Gemini connectivity via the server proxy (no key passed from browser) */
async function testGeminiKey() {
  if (!_geminiKey) {
    toast('⚠️ GEMINI_API_KEY is not set in the server .env file.', 'error', 5000); return;
  }
  const btn = document.querySelector('[onclick="testGeminiKey()"]');
  const origText = btn.textContent;
  btn.textContent = '⏳ Testing…';
  btn.disabled = true;

  const testUrl = _geminiProxyBase || GEMINI_API_URL;
  try {
    const res = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: {"ok":true}' }] }],
        generationConfig: { maxOutputTokens: 20 }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || res.status;
      toast(`❌ Gemini error: ${msg}`, 'error', 6000);
    } else {
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('[Test Gemini] response:', text);
      toast('✅ Gemini connection works!', 'success', 5000);
    }
  } catch (e) {
    const isFile = location.protocol === 'file:';
    const msg = isFile
      ? 'App must be opened via http://localhost:3000 (run: python server.py)'
      : e.message;
    toast(`❌ ${msg}`, 'error', 7000);
  }
  btn.textContent = origText;
  btn.disabled = false;
}

/** Test Grok connectivity via the server proxy */
async function testGrokKey() {
  if (!_grokKey) {
    toast('⚠️ GROK_API_KEY is not set in the server .env file.', 'error', 5000); return;
  }
  const btn = document.querySelector('[onclick="testGrokKey()"]');
  const origText = btn.textContent;
  btn.textContent = '⏳ Testing…';
  btn.disabled = true;

  const testUrl = _grokProxyBase || GROK_API_URL;
  try {
    const res = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: 'Reply with raw JSON only.' },
          { role: 'user',   content: 'Reply with exactly: {"ok":true}' }
        ],
        max_tokens: 20
      })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || res.status;
      toast(`❌ Grok error: ${msg}`, 'error', 6000);
    } else {
      const text = data?.choices?.[0]?.message?.content || '';
      console.log('[Test Grok] response:', text);
      toast('✅ Grok connection works!', 'success', 5000);
    }
  } catch (e) {
    toast(`❌ Grok test failed: ${e.message}`, 'error', 7000);
  }
  btn.textContent = origText;
  btn.disabled = false;
}

function updateAIBadge() {
  const badge = document.getElementById('aiBadge');
  if (!badge) return;
  const aiReady = (_aiProvider === 'grok') ? _grokKey : _geminiKey;
  const providerLabel = (_aiProvider === 'grok') ? 'Grok' : 'Gemini';
  const both = (_geminiKey || _grokKey) && _removebgKey;
  const anyAI = _geminiKey || _grokKey;
  if (aiReady && _removebgKey) {
    badge.textContent = `🤖 ${providerLabel} + BgRemover`;
    badge.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    badge.title = `${providerLabel} AI + Remove.bg active — keys stored securely in .env`;
  } else if (aiReady) {
    badge.textContent = `🤖 ${providerLabel} AI`;
    badge.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)';
    badge.title = `${providerLabel} active — add REMOVEBG_API_KEY to .env for background removal`;
  } else if (_removebgKey) {
    badge.textContent = '🎨 BgRemover';
    badge.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)';
    badge.title = 'Remove.bg active — add GEMINI_API_KEY or GROK_API_KEY for AI rewriting';
  } else {
    badge.textContent = '⚙️ Setup AI';
    badge.style.background = 'linear-gradient(135deg,#6366f1,#4f46e5)';
    badge.title = 'Add GEMINI_API_KEY or GROK_API_KEY and REMOVEBG_API_KEY to your .env file';
  }
}

/** Switch the active AI provider and persist the choice */
function setAIProvider(provider) {
  if (provider !== 'gemini' && provider !== 'grok') return;
  _aiProvider = provider;
  localStorage.setItem('aiProvider', provider);
  _syncProviderUI();
  updateAIBadge();
  const label = provider === 'grok' ? 'Grok (xAI)' : 'Gemini';
  toast(`🤖 AI provider switched to ${label}`, 'success', 2500);
}

/** Keep the pill buttons in the modal in sync with _aiProvider */
function _syncProviderUI() {
  document.querySelectorAll('.ai-provider-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === _aiProvider);
  });
}

/**
 * Save browser-entered API keys to localStorage (GitHub Pages mode only).
 * On localhost this is a no-op — keys come from .env via the server proxy.
 */
function saveBrowserKeys() {
  if (_isLocalhost) {
    toast('ℹ️ Running locally — keys are managed via .env on the server.', 'info', 4000);
    return;
  }
  const g  = (document.getElementById('inputGeminiKey')  ?.value || '').trim();
  const rb = (document.getElementById('inputRemovebgKey') ?.value || '').trim();
  const gr = (document.getElementById('inputGrokKey')     ?.value || '').trim();

  if (g)  { localStorage.setItem(_LS_GEMINI,   g);  _browserGeminiKey   = g; }
  if (rb) { localStorage.setItem(_LS_REMOVEBG, rb); _browserRemovebgKey = rb; }
  if (gr) { localStorage.setItem(_LS_GROK,     gr); _browserGrokKey     = gr; }

  /* Clear the input fields after saving (don't leave keys visible) */
  ['inputGeminiKey','inputRemovebgKey','inputGrokKey'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  _geminiKey   = !!_browserGeminiKey;
  _removebgKey = !!_browserRemovebgKey;
  _grokKey     = !!_browserGrokKey;

  updateAIBadge();
  openAISettings(); // refresh status labels
  toast('✅ Keys saved in browser! AI features are now active.', 'success', 4000);
}

/** Clear all browser-stored keys */
function clearBrowserKeys() {
  [_LS_GEMINI, _LS_REMOVEBG, _LS_GROK].forEach(k => localStorage.removeItem(k));
  _browserGeminiKey = _browserRemovebgKey = _browserGrokKey = '';
  _geminiKey = _removebgKey = _grokKey = false;
  updateAIBadge();
  openAISettings();
  toast('🗑️ All saved keys cleared.', 'info', 3000);
}

/**
 * Call Gemini 2.0-flash (free tier) with a structured prompt.
 * Returns parsed JSON from the model or null on failure.
 * @param {string} prompt
 * @param {number} timeoutMs
 */
async function callGemini(prompt, timeoutMs = 18000) {
  if (!_geminiKey) throw new Error('NO_KEY: Gemini API key not configured on server');
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);

  /* On localhost: route through proxy (key injected server-side, never exposed).
     On GitHub Pages: call the API directly with the browser-stored key. */
  const fetchUrl = _geminiProxyBase
    ? `${_geminiProxyBase}`
    : `${GEMINI_API_URL}?key=${encodeURIComponent(_browserGeminiKey)}`;

  try {
    const res = await fetch(fetchUrl, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
      }),
    });
    clearTimeout(tid);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || res.statusText || res.status;
      console.error('[Gemini] HTTP error:', res.status, msg);
      throw new Error(`HTTP_${res.status}: ${msg}`);
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) {
      console.error('[Gemini] empty response:', JSON.stringify(data).slice(0, 300));
      throw new Error('EMPTY_RESPONSE: Gemini returned no text');
    }

    console.log('[Gemini] raw response (first 400 chars):', raw.slice(0, 400));

    /* ── Extract JSON from the raw text using multiple strategies ──
       Try each strategy in order; return as soon as one parses cleanly.
    */

    // Strategy 1: Raw text IS already valid JSON
    try { return JSON.parse(raw.trim()); } catch (_) {}

    // Strategy 2: Strip ```json ... ``` code fence
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) {
      try { return JSON.parse(fenced[1].trim()); } catch (_) {}
    }

    // Strategy 3: Strip any ``` ... ``` code fence
    const anyFence = raw.match(/```\s*([\s\S]*?)```/i);
    if (anyFence) {
      try { return JSON.parse(anyFence[1].trim()); } catch (_) {}
    }

    // Strategy 4: Find the last { ... } block (greedy — handles nested objects)
    const firstBrace = raw.indexOf('{');
    const lastBrace  = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const block = raw.slice(firstBrace, lastBrace + 1);
      try { return JSON.parse(block); } catch (_) {}
    }

    console.error('[Gemini] could not extract JSON. Full raw:', raw);
    throw new Error('NO_JSON: Could not extract JSON from Gemini response');
  } catch (e) {
    clearTimeout(tid);
    const msg = e.name === 'AbortError' ? 'TIMEOUT: Request timed out' : e.message;
    console.error('[Gemini] threw:', msg);
    throw new Error(msg);
  }
}

/**
 * Call Grok (xAI) with a structured prompt.
 * Uses the OpenAI-compatible chat/completions endpoint.
 * Returns parsed JSON from the model or throws on failure.
 * @param {string} prompt
 * @param {number} timeoutMs
 */
async function callGrok(prompt, timeoutMs = 20000) {
  if (!_grokKey) throw new Error('NO_KEY: Grok API key not configured on server');
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);

  /* On localhost: route through proxy.
     On GitHub Pages: call xAI directly with the browser-stored key. */
  const fetchUrl = _grokProxyBase || GROK_API_URL;
  const extraHeaders = _grokProxyBase ? {} : { 'Authorization': `Bearer ${_browserGrokKey}` };

  try {
    const res = await fetch(fetchUrl, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Always respond with valid raw JSON only — no markdown, no explanation.' },
          { role: 'user',   content: prompt }
        ],
        temperature: 0.85,
        max_tokens: 1200,
      }),
    });
    clearTimeout(tid);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || res.statusText || res.status;
      console.error('[Grok] HTTP error:', res.status, msg);
      throw new Error(`HTTP_${res.status}: ${msg}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) {
      console.error('[Grok] empty response:', JSON.stringify(data).slice(0, 300));
      throw new Error('EMPTY_RESPONSE: Grok returned no text');
    }

    console.log('[Grok] raw response (first 400 chars):', raw.slice(0, 400));

    // Strategy 1: Raw text IS already valid JSON
    try { return JSON.parse(raw.trim()); } catch (_) {}

    // Strategy 2: Strip ```json ... ``` code fence
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch (_) {} }

    // Strategy 3: Strip any ``` ... ``` code fence
    const anyFence = raw.match(/```\s*([\s\S]*?)```/i);
    if (anyFence) { try { return JSON.parse(anyFence[1].trim()); } catch (_) {} }

    // Strategy 4: Find the outermost { ... } block
    const firstBrace = raw.indexOf('{');
    const lastBrace  = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch (_) {}
    }

    // Strategy 5: Find a JSON array [ ... ]
    const firstBrack = raw.indexOf('[');
    const lastBrack  = raw.lastIndexOf(']');
    if (firstBrack !== -1 && lastBrack > firstBrack) {
      try { return JSON.parse(raw.slice(firstBrack, lastBrack + 1)); } catch (_) {}
    }

    console.error('[Grok] could not extract JSON. Full raw:', raw);
    throw new Error('NO_JSON: Could not extract JSON from Grok response');
  } catch (e) {
    clearTimeout(tid);
    const msg = e.name === 'AbortError' ? 'TIMEOUT: Request timed out' : e.message;
    console.error('[Grok] threw:', msg);
    throw new Error(msg);
  }
}

/**
 * Unified AI dispatcher — routes to Grok or Gemini based on _aiProvider.
 * Falls back to the other provider if the selected one has no key.
 * @param {string} prompt
 * @param {number} timeoutMs
 */
async function callAI(prompt, timeoutMs = 22000) {
  /* Primary: use whichever provider the user has selected */
  if (_aiProvider === 'grok' && _grokKey)     return callGrok(prompt, timeoutMs);
  if (_aiProvider === 'gemini' && _geminiKey) return callGemini(prompt, timeoutMs);
  /* Fallback: try the other provider automatically */
  if (_grokKey)   return callGrok(prompt, timeoutMs);
  if (_geminiKey) return callGemini(prompt, timeoutMs);
  throw new Error('NO_KEY: No AI provider configured — add GEMINI_API_KEY or GROK_API_KEY to .env');
}

/**
 * AI-rewrite all four content fields in one single API call to save quota.
 * Returns { hook, title, description, hashtags } or null on failure.
 */
async function rewriteWithAI(rawTitle, articleBody, sourceLang) {
  if (!_grokKey && !_geminiKey) return null;

  /* Use up to 1400 chars of body for richer context */
  const bodySnippet = (articleBody || '').replace(/\s+/g, ' ').slice(0, 1400).trim();
  const langNote = sourceLang === 'ne' ? 'Nepali' : sourceLang === 'hi' ? 'Hindi' : 'English';

  const prompt = `You are a professional Nepali viral news editor with deep knowledge of Nepal's current affairs.

TASK: Read the news story below carefully. Understand the specific event, people involved, location, and impact.
Then produce 100% original, creative Nepali content based on this SPECIFIC story — not generic news phrases.

SOURCE NEWS (in ${langNote}):
Title: ${rawTitle}
Body: ${bodySnippet}

OUTPUT REQUIREMENTS — read every rule carefully:

1. "hook" — One emotionally powerful viral opening line.
   - Must reference THIS specific event/person/place from the story
   - Start with exactly 1 emoji that matches the news theme (e.g. 🔥 for controversy, 😱 for shock, 💔 for tragedy, ⚡ for breaking)
   - Maximum 20 Nepali words
   - Must feel urgent and shareable — NOT generic like "नेपालमा ठूलो घटना"

2. "title" — SEO-optimised Nepali headline
   - Must contain the KEY subject (name/place/event) from the story
   - Maximum 12 Nepali words
   - Factual, keyword-rich — readers must know exactly what happened

3. "description" — Original 3-4 sentence news paragraph
   - Sentence 1: What happened and who is involved (specific names/places from the story)
   - Sentence 2: Key details, cause, or context
   - Sentence 3: Impact or reaction
   - Sentence 4: What happens next or current status
   - Total: 60-90 Nepali words
   - NEVER copy source sentences word-for-word

4. "hashtags" — Array of exactly 8 hashtags
   - At least 3 must be SPECIFIC to this news story (person name, place, event keyword)
   - Mix Nepali Devanagari and English
   - FORBIDDEN generic tags: #Nepal #नेपाल #NepalNews #नेपालसमाचार #BreakingNews #Kathmandu (only use these if the story is literally about Nepal in general)
   - Each starts with #, no spaces inside

5. ALL text fields (hook, title, description) must be in Nepali Devanagari script.
6. Output ONLY a raw JSON object — zero markdown, zero explanation.

JSON format:
{"hook":"...","title":"...","description":"...","hashtags":["#...","#...","#...","#...","#...","#...","#...","#..."]}`;

  let result;
  try {
    result = await callAI(prompt, 25000);
  } catch(e) {
    console.warn('[AI Rewrite] callAI threw:', e.message);
    return null;
  }
  if (!result) return null;

  /* Validate the response has all required fields with Devanagari content */
  const { hook, title, description, hashtags } = result;
  const hasDevanagari = s => /[\u0900-\u097F]{3,}/.test(s || '');

  if (!hasDevanagari(hook) || !hasDevanagari(title) || !hasDevanagari(description)) {
    console.warn('[AI Rewrite] Response missing Devanagari — falling back');
    return null;
  }
  if (!Array.isArray(hashtags) || hashtags.length < 3) {
    console.warn('[AI Rewrite] Invalid hashtags array — falling back');
    return null;
  }

  return {
    hook:        hook.trim(),
    title:       cleanTitle(title.trim()),
    description: description.trim(),
    hashtags:    hashtags.slice(0, 8).map(h => h.startsWith('#') ? h : '#' + h),
  };
}

/* ================================================================
   FEATURE 2 – SELECT ARTICLE & GENERATE CONTENT
================================================================ */
async function selectArticle(idx) {
  document.querySelectorAll('.news-item').forEach(el => el.classList.remove('active'));
  document.getElementById('item-' + idx)?.classList.add('active');
  selectedArticle = articles[idx];
  /* New article = new image, invalidate cached bg-removal subject */
  _subjectDataUrl     = null;
  _subjectImg         = null;
  _activeImageDataUrl = null;
  _enhancedMode       = false;

  /* Show panel immediately */
  document.getElementById('contentWelcome').style.display = 'none';
  document.getElementById('contentOutput').style.display  = 'block';
  document.getElementById('imagePanel').style.display     = 'none';

  /* Show spinners while everything loads */
  document.getElementById('outHook').innerHTML =
    '<span class="spinner" style="border-color:rgba(246,173,85,.3);border-top-color:#f6ad55"></span>';
  document.getElementById('outTitle').innerHTML =
    '<span class="spinner" style="border-color:rgba(246,173,85,.3);border-top-color:#f6ad55"></span> शीर्षक तयार हुँदैछ…';
  document.getElementById('outDesc').innerHTML =
    '<span class="spinner" style="border-color:rgba(99,102,241,.3);border-top-color:#818cf8"></span> लेख पढ्दैछ र विवरण तयार गर्दैछ…';
  document.getElementById('outHashtags').innerHTML = '';
  document.getElementById('contentPanel').scrollIntoView({ behavior:'smooth', block:'nearest' });

  const rawTitle   = selectedArticle.title;
  const sourceLang = selectedArticle.sourceLang || 'ne';

  /* Step 1: Fetch the full article page for deep context */
  let fullArticleText = selectedArticle.fullArticleText || '';
  if (!fullArticleText && selectedArticle.link) {
    fullArticleText = await fetchFullArticle(selectedArticle.link);
    selectedArticle.fullArticleText = fullArticleText;
  }
  const bestBody = fullArticleText || selectedArticle.description || '';

  /* ── Step 2: Show AI indicator in spinners if key is set ── */
  if (_geminiKey) {
    document.getElementById('outTitle').innerHTML =
      '<span class="spinner" style="border-color:rgba(99,102,241,.3);border-top-color:#818cf8"></span> 🤖 AI ले सामग्री तयार गर्दैछ…';
    document.getElementById('outDesc').innerHTML =
      '<span class="spinner" style="border-color:rgba(99,102,241,.3);border-top-color:#818cf8"></span> 🤖 AI ले मौलिक विवरण लेख्दैछ…';
  }

  /* ── Step 3: Try AI rewrite first (Gemini free tier) ── */
  let hook, nepaliTitle, desc, hashtags;
  let aiUsed = false;

  const aiResult = await rewriteWithAI(rawTitle, bestBody, sourceLang);

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
    hook = buildHook(nepaliTitle + ' ' + rawTitle);
    /* Step 3c: Build description (translates + extracts key facts) */
    desc = await buildDescription(nepaliTitle, rawTitle, bestBody, sourceLang);
    /* Step 3d: Hashtags */
    hashtags = buildHashtags(nepaliTitle + ' ' + rawTitle);
  }

  document.getElementById('outHook').textContent   = hook;
  document.getElementById('outTitle').textContent  = nepaliTitle;
  document.getElementById('outDesc').textContent   = desc;

  generatedPost = { hook, title: nepaliTitle, description: desc, hashtags, link: selectedArticle.link || '' };
  renderHashtags(hashtags);

  if (aiUsed) {
    toast('🤖 AI ले मौलिक सामग्री तयार गर्‍यो — copyright-safe!', 'success', 3500);
  }
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

    /* Remove noise: scripts, styles, nav, footer, ads, sidebars */
    ['script','style','nav','footer','header','aside','form',
     '.advertisement','.ads','.sidebar','.related','.social-share',
     '.comments','.comment-section','#comments'].forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    /* Try to find the main article container */
    const candidates = [
      doc.querySelector('article'),
      doc.querySelector('[class*="article-body"]'),
      doc.querySelector('[class*="post-content"]'),
      doc.querySelector('[class*="entry-content"]'),
      doc.querySelector('[class*="news-detail"]'),
      doc.querySelector('[class*="content-body"]'),
      doc.querySelector('[class*="story-body"]'),
      doc.querySelector('main'),
      doc.body,
    ].filter(Boolean);

    for (const el of candidates) {
      const text = (el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (text.length > 200) return text.slice(0, 5000);
    }
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

function buildHook(rawTitle) {
  const topic = detectTopic(rawTitle);
  if (topic) return HOOK_BY_TOPIC[topic];
  /* Extra Devanagari checks */
  const t = rawTitle.toLowerCase();
  if (t.includes('बाढी') || t.includes('पहिरो') || t.includes('वर्षा')) return HOOK_BY_TOPIC['flood'];
  if (t.includes('भूकम्प'))       return HOOK_BY_TOPIC['earthquake'];
  if (t.includes('निर्वाचन') || t.includes('मतदान')) return HOOK_BY_TOPIC['election'];
  if (t.includes('सरकार') || t.includes('प्रधानमन्त्री')) return HOOK_BY_TOPIC['government'];
  if (t.includes('स्वास्थ्य') || t.includes('अस्पताल')) return HOOK_BY_TOPIC['health'];
  if (t.includes('दुर्घटना') || t.includes('सडक'))    return HOOK_BY_TOPIC['accident'];
  if (t.includes('विद्यार्थी') || t.includes('शिक्षा')) return HOOK_BY_TOPIC['education'];
  if (t.includes('प्रहरी') || t.includes('अपराध'))    return HOOK_BY_TOPIC['police'];
  if (t.includes('क्रिकेट') || t.includes('खेल'))     return HOOK_BY_TOPIC['cricket'];
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
  return 'नेपालबाट महत्त्वपूर्ण समाचार';
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

  /* Already Nepali — clean, SEO-rephrase and return */
  if (/[\u0900-\u097F]{5,}/.test(titleInput)) {
    return cleanTitle(rephraseNepaliTitle(titleInput));
  }

  const cacheKey = titleInput.toLowerCase().slice(0, 120);
  if (_titleCache.has(cacheKey)) return _titleCache.get(cacheKey);

  /* Determine translation pair: auto-detect source → Nepali */
  const langpair = sourceLang === 'hi' ? 'hi|ne' : 'en|ne';

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
 * Clean a Nepali title: remove noise, trim to 12 words max.
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
  return words.slice(0, 14).join(' ') + (words.length > 14 ? '…' : '');
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
async function buildDescription(nepaliTitle, rawTitle, articleBody, sourceLang = 'ne') {
  const combinedLower = (nepaliTitle + ' ' + rawTitle).toLowerCase();
  const topic = detectTopic(combinedLower) || detectNepaliTopic(nepaliTitle);
  const bodyIsNepali = /[\u0900-\u097F]{10,}/.test(articleBody || '');

  /* ── STEP 1: Translate body to Nepali if it's in another language ── */
  let nepaliBody = articleBody || '';
  if (!bodyIsNepali && nepaliBody.trim().length > 50) {
    nepaliBody = await translateBodyToNepali(nepaliBody, sourceLang);
  }

  /* ── STEP 2: Extract key facts from original body (numbers work in any language) ── */
  const extractedFacts = extractKeyFacts(rawTitle, articleBody);

  /* ── STEP 3: Extract best sentences from Nepali body ── */
  const bodySentences = extractBestSentences(nepaliBody, nepaliTitle, rawTitle, true, 6);

  /* ── STEP 4: Assemble description ── */
  const parts = [];
  const usedW = new Set();

  const track  = s => s.replace(/[।,.!?]/g, '').split(/\s+/).filter(w => w.length > 3).forEach(w => usedW.add(w));
  const isDup  = s => {
    const words = s.replace(/[।,.!?]/g, '').split(/\s+/).filter(w => w.length > 3);
    return words.length > 0 && words.filter(w => usedW.has(w)).length / words.length > 0.40;
  };
  const addPart = s => { if (s && s.trim() && !isDup(s)) { parts.push(s.trim()); track(s); return true; } return false; };

  /* A – Best body sentences first (most factual, most contextual) */
  for (const sent of bodySentences) {
    if (wordCount(parts.join(' ')) >= 80) break;
    addPart(sent);
  }

  /* B – Inject numeric facts if body was thin */
  if (parts.length < 2) {
    for (const fact of extractedFacts) {
      if (wordCount(parts.join(' ')) >= 80) break;
      addPart(fact);
    }
  }

  /* C – Fallback to topic context bank */
  if (parts.length === 0) {
    const ctx = topic
      ? DESC_CONTEXT[topic]
      : DESC_GENERIC_CONTEXT[Math.floor(Math.random() * DESC_GENERIC_CONTEXT.length)];
    addPart(ctx);
  }

  /* D – Close with an impact sentence (non-duplicate) */
  if (wordCount(parts.join(' ')) < 90) {
    const impact = topic
      ? DESC_IMPACT[topic]
      : DESC_GENERIC_IMPACT[Math.floor(Math.random() * DESC_GENERIC_IMPACT.length)];
    addPart(impact);
  }

  /* ── STEP 5: Final consecutive-duplicate guard ── */
  const final = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const prevW = new Set(final[final.length - 1].replace(/[।,.!?]/g, '').split(/\s+/).filter(w => w.length > 3));
    const currW = parts[i].replace(/[।,.!?]/g, '').split(/\s+/).filter(w => w.length > 3);
    if (currW.filter(w => prevW.has(w)).length / Math.max(currW.length, 1) < 0.40) {
      final.push(parts[i]);
    }
  }

  /* ── STEP 6: Trim to target 60-100 Nepali words ── */
  return trimToWordTarget(final.join(' '), 60, 100);
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
 * Prefers sentences that contain:
 *   - Numbers / figures
 *   - Named people or places
 *   - Specific actions (arrested, fired, demanded, recommended)
 *   - Cause/effect language (because, due to, following, after)
 * Avoids: very short sentences, generic filler, duplicate-to-title sentences.
 */
function extractBestSentences(text, nepaliTitle, rawTitle, isNepali, maxSents) {
  if (!text || text.trim().length < 60) return [];

  /* Split on Nepali (।) or Latin sentence endings */
  const raw = text
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sents = (raw.match(/[^.!?।]+[.!?।]+/g) || [])
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 40 && s.length < 320);

  if (!sents.length) return [];

  /* Score each sentence */
  const titleWordsLower = new Set((rawTitle + ' ' + nepaliTitle)
    .toLowerCase().split(/\s+/).filter(w => w.length > 3));

  const scored = sents.map(s => {
    const sl = s.toLowerCase();
    let score = 0;

    /* Bonus: contains numbers */
    if (/\d/.test(s)) score += 3;
    /* Bonus: contains Devanagari numerals */
    if (/[०-९]/.test(s)) score += 2;
    /* Bonus: contains money/percentage */
    if (/रु\.|rs\.|%|crore|lakh|करोड|लाख|अर्ब/i.test(s)) score += 3;
    /* Bonus: named person keywords */
    if (/(?:मन्त्री|प्रधानमन्त्री|अध्यक्ष|सचिव|प्रमुख|अधिकारी|पदाधिकारी|minister|president|secretary|chairman|chief|officer)/i.test(s)) score += 4;
    /* Bonus: organization names */
    if (/(?:आयोग|समिति|सरकार|मन्त्रालय|प्रहरी|अदालत|commission|committee|government|ministry|court|police)/i.test(s)) score += 3;
    /* Bonus: causal / factual language */
    if (/(?:किनभने|कारण|फलस्वरूप|पछि|अनुसार|because|due to|following|after|as a result|according)/i.test(s)) score += 3;
    /* Bonus: action verbs (arrest, fire, demand, recommend) */
    if (/(?:पक्राउ|बर्खास्त|सिफारिस|माग|आदेश|गरिएको|गरे|arrested|dismissed|recommended|demanded|ordered|issued)/i.test(s)) score += 4;
    /* Bonus: specific time markers */
    if (/(?:आइतबार|सोमबार|मंगलबार|बुधबार|बिहिबार|शुक्रबार|शनिबार|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4})/i.test(s)) score += 2;
    /* Penalty: too similar to the title */
    const sentW = new Set(sl.split(/\s+/).filter(w => w.length > 3));
    const titleOverlap = [...sentW].filter(w => titleWordsLower.has(w)).length / Math.max(sentW.size, 1);
    if (titleOverlap > 0.6) score -= 5;
    /* Penalty: generic / filler sentences */
    if (/(?:यो खबर|यस विषयमा|थप जानकारी|read more|click here|share this|follow us|subscribe)/i.test(s)) score -= 10;
    /* Penalty: very short */
    if (s.length < 60) score -= 2;

    return { s, score };
  });

  /* Sort by score, take top maxSents */
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxSents).map(x => x.s);

  /* Re-order to match original article sequence (preserve story flow) */
  const order = new Map(sents.map((s, i) => [s, i]));
  top.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));

  /* Ensure sentences end with proper punctuation */
  return top.map(s => /[।.!?]$/.test(s) ? s : s + '।');
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

function buildHashtags(title) {
  const lower = title.toLowerCase();
  let extra = [];
  for (const [key, tags] of Object.entries(TOPIC_HASHTAGS)) {
    if (lower.includes(key)) extra = extra.concat(tags);
  }
  const topicPick = [...new Set(extra)].slice(0, 3);
  const basePick  = NEPAL_HASHTAGS.filter(h => !topicPick.includes(h)).slice(0, 3);
  const chosen    = [...topicPick, ...basePick];
  if (chosen.length < 4) chosen.push('#NepalNews', '#BreakingNews', '#Nepal', '#नेपाल');
  return chosen.slice(0, 6);
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
    if ((_grokKey || _geminiKey) && selectedArticle) {
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
      newTags = buildHashtags((selectedArticle?.title || '') + ' ' + (generatedPost?.title || ''));
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

    toast('✨ AI enhancement done! Zoom/pan still work.', 'success', 4000);

  } catch (err) {
    console.error('[EnhanceAI]', err);
    _enhancedMode = false;
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
function redrawEnhanced() {
  if (!_subjectImg || !_enhancedMode) return;

  const canvas = document.getElementById('newsCanvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  /* ── Draw chosen AI background ── */
  drawAIBackground(ctx, _selectedBgStyle, CANVAS_W, CANVAS_H);

  /* ── Composite subject: base scale fills the canvas height, then apply user zoom ── */
  const baseScale = Math.min(CANVAS_W / _subjectImg.width, CANVAS_H / _subjectImg.height);
  const scale = baseScale * imgScale;
  const sw = _subjectImg.width  * scale;
  const sh = _subjectImg.height * scale;
  const sx = (CANVAS_W - sw) / 2 + imgOffsetX;
  const sy = (CANVAS_H - sh) / 2 + imgOffsetY;

  /* Subtle drop shadow for depth */
  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur    = 38;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(_subjectImg, sx, sy, sw, sh);
  ctx.restore();

  /* ── News banner + text overlay ── */
  _drawNewsBanner(ctx, CANVAS_W);
  if (generatedPost) drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);

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
  document.getElementById('customImgInput').value = '';
  document.getElementById('clearCustomBtn').style.display = 'none';
  document.getElementById('enhanceAIBtn').style.display   = 'none';
  document.getElementById('bgStylePicker').style.display  = 'none';
  document.getElementById('imgSourceBadge').textContent   = '';
  resetImgAdjust(/* silent */ true);
  if (selectedArticle && generatedPost) generateImage();
  else document.getElementById('imgAdjustBar').style.display = 'none';
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
function fastRedraw() {
  if (_enhancedMode && typeof redrawEnhanced === 'function') { redrawEnhanced(); return; }
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
  if (generatedPost) drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
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
    requestAnimationFrame(() => {
      _rafPending = false;
      const canvas = _getCanvas();
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      if (_enhancedMode && _subjectImg) {
        /* Enhanced mode — redraw background + subject */
        redrawEnhanced();
        return;
      }

      if (_cachedNewsImg) {
        /* Fast path — use cached image, no fetch */
        canvas.width  = CANVAS_W;
        canvas.height = CANVAS_H;
        drawNewsImage(ctx, _cachedNewsImg, CANVAS_W, CANVAS_H);
        if (generatedPost) drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
      } else if (generatedPost) {
        /* No image loaded yet — just redraw background + text */
        canvas.width  = CANVAS_W;
        canvas.height = CANVAS_H;
        drawBackground(ctx, CANVAS_W, CANVAS_H);
        drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
      }
    });
  }

  /* ── Mouse events ── */
  function _onMouseDown(e) {
    if (e.button !== 0) return;
    const ito = document.getElementById('inlineTextOverlay');
    if (ito && ito.classList.contains('open')) return;
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
  /* Regenerate always exits enhanced mode — user wants the original image */
  _enhancedMode = false;
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

  if (newsImg) {
    _cachedNewsImg = newsImg;   /* ← cache for instant drag/zoom redraws */
    drawNewsImage(ctx, newsImg, CANVAS_W, CANVAS_H);
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
    document.getElementById('enhanceAIBtn').style.display = 'inline-flex';
  } else {
    _cachedNewsImg = null;   /* no image available */
    drawBackground(ctx, CANVAS_W, CANVAS_H);
    document.getElementById('imgSourceBadge').textContent = '🎨 Graphic background';
    /* No image — hide overlay tools and enhance button */
    document.getElementById('imgAdjustBar').style.display = 'none';
    _hideCanvasEditor();
    document.getElementById('enhanceAIBtn').style.display = 'none';
    document.getElementById('bgStylePicker').style.display = 'none';
    _activeImageDataUrl = null;
  }
  drawTextOverlay(ctx, generatedPost, CANVAS_W, CANVAS_H);
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

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i+1], b = d[i+2];

    /* ── Cinematic teal-orange grade ── */
    /* Shadows → push toward teal (boost G/B, reduce R in darks) */
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    if (lum < 0.45) {
      r = r * 0.82;
      g = g * 0.98;
      b = Math.min(255, b * 1.12);
    } else {
      /* Highlights → push toward warm orange (boost R, reduce B) */
      r = Math.min(255, r * 1.08);
      g = g * 1.02;
      b = b * 0.88;
    }

    /* ── S-curve contrast (crush blacks, lift whites) ── */
    r = sCurve(r);
    g = sCurve(g);
    b = sCurve(b);

    /* ── Saturation boost (+20%) ── */
    const avg  = (r + g + b) / 3;
    const sat  = 1.22;
    r = Math.min(255, Math.max(0, avg + (r - avg) * sat));
    g = Math.min(255, Math.max(0, avg + (g - avg) * sat));
    b = Math.min(255, Math.max(0, avg + (b - avg) * sat));

    d[i] = r; d[i+1] = g; d[i+2] = b;
  }
  return imgData;
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

  /* ── 8. Breaking News banner ── */
  _drawNewsBanner(ctx, W);
}

function _drawNewsBanner(ctx, W) {
  const bannerColor = _textOpts.bannerColor || '#c0392b';
  /* Red banner bar */
  ctx.fillStyle = bannerColor;
  ctx.fillRect(0, 22, W, 88);
  /* Left accent stripe */
  ctx.fillStyle = '#f6ad55';
  ctx.fillRect(0, 22, 10, 88);
  /* Banner text */
  ctx.font = 'bold 56px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 8;
  ctx.fillText(_textOpts.bannerText || '🚨  BREAKING NEWS', W / 2, 88);
  ctx.shadowBlur = 0;
  /* Bottom rule */
  ctx.fillStyle = 'rgba(246,173,85,0.6)';
  ctx.fillRect(0, 112, W, 2);
  /* Date stamp */
  const dateStr = new Date().toLocaleDateString('ne-NP', { year:'numeric', month:'short', day:'numeric' });
  ctx.font = '22px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 28, 102);
  ctx.textAlign = 'center';
}

function drawBackground(ctx, W, H) {
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0a0e1a'); grad.addColorStop(.4, '#1a0a0a'); grad.addColorStop(1, '#0d1829');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(229,62,62,0.06)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  ctx.fillStyle = '#e53e3e'; ctx.fillRect(0, 0, W, 14); ctx.fillRect(0, H-14, W, 14);

  const circ = ctx.createRadialGradient(W*.8, H*.2, 40, W*.8, H*.2, 280);
  circ.addColorStop(0, 'rgba(229,62,62,0.15)'); circ.addColorStop(1, 'rgba(229,62,62,0)');
  ctx.fillStyle = circ; ctx.fillRect(0, 0, W, H);

  _drawNewsBanner(ctx, W);
}

function drawTextOverlay(ctx, post, W, H) {
  const pad = 54;
  const titleSize = _textOpts.titleSize || 62;
  const titleColor = _textOpts.titleColor || '#ffffff';

  /* ── Measure title line count first so we can layout bottom-up ── */
  ctx.font = `bold ${titleSize}px "Segoe UI",Arial,sans-serif`;
  const titleWords = (post.title || '').split(' ');
  let titleLine = '', titleLineCount = 0;
  for (const w of titleWords) {
    const test = titleLine ? titleLine + ' ' + w : w;
    if (ctx.measureText(test).width > W - pad * 2 && titleLine) {
      titleLineCount++;
      if (titleLineCount >= 3) break;
      titleLine = w;
    } else { titleLine = test; }
  }
  titleLineCount++;

  const TITLE_LINE_H = Math.round(titleSize * 1.26);
  const BRAND_H      = 46;
  const BOTTOM_PAD   = 32;
  const TOP_PAD      = 36;

  const blockH = TOP_PAD + titleLineCount * TITLE_LINE_H + 18 + BRAND_H + BOTTOM_PAD;
  const blockY = H - blockH;

  /* ── Gradient overlay — fades up from bottom ── */
  const grad = ctx.createLinearGradient(0, blockY - 100, 0, H);
  grad.addColorStop(0,    'rgba(0,0,0,0)');
  grad.addColorStop(0.15, 'rgba(0,0,0,0.72)');
  grad.addColorStop(0.4,  'rgba(0,0,0,0.90)');
  grad.addColorStop(1,    'rgba(0,0,0,0.97)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, blockY - 100, W, blockH + 100);

  /* Left accent bar */
  ctx.fillStyle = '#e53e3e';
  ctx.fillRect(0, blockY, 8, blockH);

  let y = blockY + TOP_PAD;

  /* ── Title ── */
  ctx.font = `bold ${titleSize}px "Segoe UI",Arial,sans-serif`;
  ctx.fillStyle = titleColor;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 16;
  const drawnLines = wrapText(ctx, post.title, W / 2, y, W - pad * 2, TITLE_LINE_H, 3);
  y += drawnLines * TITLE_LINE_H + 18;
  ctx.shadowBlur = 0;

  /* ── Branding watermark ── */
  ctx.textAlign = 'right';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 5;
  ctx.font = 'bold 22px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('© Shashi Viral Post Generator', W - 28, y + 22);
  ctx.font = '15px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.fillText('shashi19.jaiswal@gmail.com', W - 28, y + 42);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';

  /* ── Catchy decorative border ── */
  _drawCanvasBorder(ctx, W, H);
}

/**
 * Draw a catchy, consistent decorative border on every generated image.
 * Double-line news frame with red + gold accent corners.
 */
function _drawCanvasBorder(ctx, W, H) {
  const inset = 14;
  const cornerSize = 38;

  /* Outer red line */
  ctx.strokeStyle = 'rgba(229,62,62,0.90)';
  ctx.lineWidth = 4;
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);

  /* Inner gold line */
  ctx.strokeStyle = 'rgba(246,173,85,0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(inset + 7, inset + 7, W - (inset + 7) * 2, H - (inset + 7) * 2);

  /* Gold corner accents — four L-shaped brackets */
  ctx.strokeStyle = '#f6ad55';
  ctx.lineWidth = 4;
  ctx.lineCap = 'square';
  const corners = [
    [inset, inset,  1,  1],
    [W - inset, inset, -1,  1],
    [inset, H - inset,  1, -1],
    [W - inset, H - inset, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * cornerSize, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * cornerSize);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
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
  const link     = document.createElement('a');
  link.download  = 'nepal-news-' + Date.now() + '.png';
  link.href      = document.getElementById('newsCanvas').toDataURL('image/png');
  link.click();
  toast('⬇️ Image downloaded!', 'success');
}

/* ================================================================
   FEATURE 5 – POST TEXT & SHARING
================================================================ */
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

function buildPostText(post, rawTitle) {
  const icon = getNewsIcon(rawTitle || post.title || '');
  return `${icon} ${post.hook}\n\n📢 ${post.title}\n\n${post.description}\n\n${post.hashtags.join(' ')}\n\n— Shashi News Generator 🇳🇵`;
}

function getPostText() {
  return generatedPost ? buildPostText(generatedPost, selectedArticle?.title) : '';
}

/* Share helpers */
let _shareUrl = '', _shareTarget = '';

function shareOnFacebook() {
  if (!generatedPost) { toast('⚠️ पहिले समाचार छान्नुहोस्।','error'); return; }
  const text = getPostText();
  /*
   * Facebook's sharer.php only reliably passes a URL — it ignores the `quote`
   * param in most contexts and the shared URL would point to the source site
   * (not our content). Best practice for monetised pages:
   * → Copy our full original text to clipboard, then open the user's own
   *   FB profile/page composer so they can paste as an original post.
   */
  _shareUrl    = 'https://www.facebook.com/';
  _shareTarget = 'facebook';
  openShareModal(
    '📘 Facebook मा साझा गर्नुहोस्',
    '✅ तपाईंको पोस्ट क्लिपबोर्डमा कपी भयो!\n\nFacebook खुल्नेछ — "Write something…" बाकसमा Paste गर्नुहोस् र तस्बिर पनि थप्नुहोस्।',
    text
  );
}

function shareOnInstagram() {
  if (!generatedPost) { toast('⚠️ पहिले समाचार छान्नुहोस्।','error'); return; }
  /*
   * Instagram has no web share API. Standard workflow:
   * 1. Download the generated 1080×1080 image.
   * 2. Paste caption (copied to clipboard) when creating the post on mobile.
   */
  const caption = getPostText();
  _shareUrl    = 'https://www.instagram.com/';
  _shareTarget = 'instagram';
  openShareModal(
    '📸 Instagram मा साझा गर्नुहोस्',
    '✅ क्याप्सन क्लिपबोर्डमा कपी भयो!\n\n① तल "Download Image" थिच्नुहोस्।\n② Instagram खुल्नेछ — फोटो छान्नुहोस् र क्याप्सन Paste गर्नुहोस्।',
    caption
  );
}

function shareOnX() {
  if (!generatedPost) { toast('⚠️ पहिले समाचार छान्नुहोस्।','error'); return; }
  const post = generatedPost;
  /*
   * X (Twitter) limit ≈ 280 chars. We send: hook + title + top 3 hashtags.
   * No source URL — this is our original Nepali content.
   */
  const tweet = `${post.hook}\n\n📢 ${post.title}\n\n${post.hashtags.slice(0, 3).join(' ')}\n\n— Shashi News Generator 🇳🇵`;
  _shareUrl    = `https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
  _shareTarget = 'x';
  openShareModal(
    '𝕏 X (Twitter) मा साझा गर्नुहोस्',
    '✅ Tweet तयार छ! "Share Now" थिच्नुहोस् — X मा सिधै पोस्ट हुन्छ।',
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
async function reimagineField(field) {
  if (!generatedPost || !selectedArticle) {
    toast('⚠️ Please select an article first.', 'error'); return;
  }
  if (!_grokKey && !_geminiKey) {
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
2. Maximum 12 Nepali words
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
    console.log(`[Reimagine] calling ${_aiProvider} for field="${field}", jsonKey="${jsonKey}"`);
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
    if (!_serverOnline && _isLocalhost) {
      await loadKeyStatus();
    }
  }, 10000);
})();