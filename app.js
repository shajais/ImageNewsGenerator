/* ================================================================
   Nepal Viral News Generator — Application Logic
   app.js
================================================================ */

/* ── Globals ─────────────────────────────────────────────────── */
const CANVAS_W  = 1080;
const CANVAS_H  = 1080;

/* ── AI (Gemini) Configuration ──────────────────────────────── */
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
let _geminiKey    = localStorage.getItem('gemini_api_key')   || '';
let _removebgKey  = localStorage.getItem('removebg_api_key') || '';

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

/* Multiple RSS feeds — fetched in parallel for maximum coverage */
const RSS_FEEDS = [
  { url: 'https://www.onlinekhabar.com/feed',               name: 'Online Khabar',  lang: 'ne' },
  { url: 'https://www.setopati.com/feed',                    name: 'Setopati',       lang: 'ne' },
  { url: 'https://ratopati.com/feed',                        name: 'Ratopati',       lang: 'ne' },
  { url: 'https://www.ekantipur.com/rss/',                   name: 'eKantipur',      lang: 'ne' },
  { url: 'https://thehimalayantimes.com/feed/',              name: 'Himalayan Times', lang: 'en' },
  { url: 'https://kathmandupost.com/rss',                    name: 'Kathmandu Post', lang: 'en' },
];
const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

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
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p style="color:var(--text)">Could not load news from any source.</p>
        <p style="margin-top:8px;font-size:.8rem;color:var(--muted)">
          Try on a personal hotspot, or use the manual option below.
        </p>
        <button class="btn btn-ghost" style="margin-top:14px" onclick="showManualInput()">✏️ Enter News Manually</button>
      </div>`;
    toast('❌ All feeds failed. Try manual mode.', 'error', 5000);
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
      const cleanDesc = fullText.slice(0, 1500);
      const rawHtml   = item.description || '';
      return {
        title, description: cleanDesc, rawHtml, imageUrl,
        pubDate, link,
        source: feed.name,
        sourceLang: feed.lang,
        fullArticleText: null, /* populated on-demand when article is selected */
      };
    });
  } catch {
    clearTimeout(tid);
    return [];
  }
}

/* ================================================================
   MANUAL INPUT — URL or raw text, fetches full article if URL
================================================================ */
function showManualInput() {
  document.getElementById('newsList').innerHTML = `
    <div class="manual-input-panel">
      <div class="manual-input-header">
        <span class="manual-input-icon">✏️</span>
        <div>
          <div class="manual-input-title">Manual Article Entry</div>
          <div class="manual-input-sub">Paste a URL <em>or</em> type/paste news text — one entry per box.</div>
        </div>
      </div>

      <div id="manualEntries">
        <div class="manual-entry" data-idx="0">
          <div class="manual-entry-num">1</div>
          <div class="manual-entry-body">
            <textarea class="manual-textarea"
              placeholder="🔗 Paste a news URL (e.g. https://www.onlinekhabar.com/…)&#10;— or —&#10;📝 Paste/type the news headline or article text directly"
              rows="3"></textarea>
            <div class="manual-entry-hint">
              <span class="hint-url">🔗 URL detected → will fetch full article automatically</span>
              <span class="hint-text">📝 Text mode → uses your text as the article body</span>
            </div>
          </div>
          <button class="manual-remove-btn" onclick="removeManualEntry(this)" title="Remove">✕</button>
        </div>
      </div>

      <div class="manual-input-actions">
        <button class="btn btn-ghost manual-add-btn" onclick="addManualEntry()">＋ Add Another</button>
        <button class="btn btn-primary manual-load-btn" id="manualLoadBtn" onclick="loadManualArticles()">
          <span>🚀</span> Fetch &amp; Load
        </button>
      </div>
      <div id="manualStatus" class="manual-status"></div>
    </div>`;

  /* Wire up live URL/text detection hints per textarea */
  wireManualHints();
}

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
  const entries = [...document.querySelectorAll('.manual-entry')];
  const inputs  = entries.map(e => e.querySelector('.manual-textarea')?.value.trim()).filter(v => v && v.length > 3);

  if (!inputs.length) { toast('⚠️ Please enter at least one URL or text.', 'error'); return; }

  const btn = document.getElementById('manualLoadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Processing…';

  const statusEl = document.getElementById('manualStatus');
  statusEl.innerHTML = '';

  const loaded = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const label = isValidUrl(input) ? `Entry ${i + 1}: fetching <code>${escHtml(new URL(input).hostname)}</code>…`
                                    : `Entry ${i + 1}: processing text…`;
    statusEl.innerHTML += `<div class="manual-status-row" id="msr-${i}">
      <span class="spinner" style="width:12px;height:12px;border-width:2px"></span> ${label}
    </div>`;

    try {
      const article = await buildManualArticle(input, i);
      loaded.push(article);
      document.getElementById('msr-' + i).innerHTML =
        `<span style="color:#4ade80">✅</span> Entry ${i + 1}: <strong>${escHtml(article.title.slice(0, 60))}${article.title.length > 60 ? '…' : ''}</strong>`;
    } catch (err) {
      document.getElementById('msr-' + i).innerHTML =
        `<span style="color:#f87171">⚠️</span> Entry ${i + 1}: ${escHtml(err.message)}`;
    }
  }

  if (!loaded.length) {
    btn.disabled = false;
    btn.innerHTML = '<span>🚀</span> Fetch &amp; Load';
    toast('❌ Could not process any entries.', 'error');
    return;
  }

  articles = loaded;
  renderNewsList();
  document.getElementById('statusBadge').textContent = `${loaded.length} article${loaded.length > 1 ? 's' : ''} loaded`;
  toast(`✅ ${loaded.length} article${loaded.length > 1 ? 's' : ''} ready — click to generate!`, 'success', 4000);

  btn.disabled = false;
  btn.innerHTML = '<span>🚀</span> Fetch &amp; Load';
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
 * Fetch raw HTML from a URL using a proxy chain.
 * Handles both allorigins (JSON wrapper) and corsproxy (raw HTML).
 */
async function fetchRawHtml(url) {
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
        /* allorigins wraps the page in { contents: "..." } */
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
   AI REWRITING ENGINE  (Gemini 1.5-flash — Free Tier)
   Rewrites hook, title, description and hashtags so the output
   is 100% original, SEO-friendly and copyright-safe.
================================================================ */

/**
 * Save / load Gemini API key via a small UI modal.
 * The key is persisted in localStorage so the user only needs to enter it once.
 */
function openAISettings() {
  document.getElementById('geminiKeyInput').value   = localStorage.getItem('gemini_api_key')   || '';
  document.getElementById('removebgKeyInput').value = localStorage.getItem('removebg_api_key') || '';
  document.getElementById('aiSettingsModal').classList.add('open');
}
function closeAISettings() {
  document.getElementById('aiSettingsModal').classList.remove('open');
}
function saveAISettings() {
  const gKey = document.getElementById('geminiKeyInput').value.trim();
  const rKey = document.getElementById('removebgKeyInput').value.trim();

  if (gKey) {
    localStorage.setItem('gemini_api_key', gKey);
    _geminiKey = gKey;
  } else {
    localStorage.removeItem('gemini_api_key');
    _geminiKey = '';
  }

  if (rKey) {
    localStorage.setItem('removebg_api_key', rKey);
    _removebgKey = rKey;
  } else {
    localStorage.removeItem('removebg_api_key');
    _removebgKey = '';
  }

  const msgs = [];
  if (gKey)  msgs.push('Gemini AI');
  if (rKey)  msgs.push('Remove.bg');
  toast(msgs.length ? `✅ ${msgs.join(' + ')} enabled!` : 'ℹ️ Keys cleared. Using template mode.', msgs.length ? 'success' : 'info', 4000);

  closeAISettings();
  updateAIBadge();
}

function updateAIBadge() {
  const badge = document.getElementById('aiBadge');
  if (!badge) return;
  const both = _geminiKey && _removebgKey;
  const any  = _geminiKey || _removebgKey;
  if (both) {
    badge.textContent = '🤖 AI Active';
    badge.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
    badge.title = 'Gemini + Remove.bg active — click to manage keys';
  } else if (any) {
    badge.textContent = '🤖 AI Partial';
    badge.style.background = 'linear-gradient(135deg,#f59e0b,#d97706)';
    badge.title = (_geminiKey ? 'Gemini active' : 'Remove.bg active') + ' — click to add the other key';
  } else {
    badge.textContent = '⚙️ Setup AI';
    badge.style.background = 'linear-gradient(135deg,#6366f1,#4f46e5)';
    badge.title = 'Click to enter your free API keys';
  }
}

/**
 * Call Gemini 2.0-flash (free tier) with a structured prompt.
 * Returns parsed JSON from the model or null on failure.
 * @param {string} prompt
 * @param {number} timeoutMs
 */
async function callGemini(prompt, timeoutMs = 18000) {
  if (!_geminiKey) return null;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(_geminiKey)}`, {
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
          /* NOTE: responseMimeType intentionally omitted — not universally supported on free tier */
        },
      }),
    });
    clearTimeout(tid);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.warn('[Gemini] HTTP', res.status, errData?.error?.message || '');
      return null;
    }
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) { console.warn('[Gemini] empty response'); return null; }

    /* ── Robust JSON extraction ──
       The model may return:
         1. A bare JSON object            { "hook": "…" }
         2. Fenced with ```json … ```
         3. Fenced with ``` … ```
         4. JSON embedded in prose text   …text… { "hook": "…" } …text…
    */
    let cleaned = raw
      .replace(/^[\s\S]*?```json\s*/i, '')   // strip everything before ```json
      .replace(/^```\s*/i, '')                // or bare ```
      .replace(/```[\s\S]*$/i, '')            // strip closing fence + anything after
      .trim();

    /* If still not starting with { , grab the first { … } block from raw */
    if (!cleaned.startsWith('{')) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) cleaned = m[0].trim();
    }

    if (!cleaned) { console.warn('[Gemini] no JSON found in response'); return null; }
    return JSON.parse(cleaned);
  } catch (e) {
    clearTimeout(tid);
    console.warn('[Gemini] error:', e.message);
    return null;
  }
}

/**
 * AI-rewrite all four content fields in one single API call to save quota.
 * Returns { hook, title, description, hashtags } or null on failure.
 *
 * The prompt instructs Gemini to:
 *  - Write 100% original content — no direct copy of source sentences
 *  - Use Nepali language throughout (Devanagari script)
 *  - Make the hook emotionally engaging and viral
 *  - Make the title SEO-optimised (under 12 words)
 *  - Write 3-4 factual sentences in the description (60-90 Nepali words)
 *  - Generate 6 relevant hashtags mixing Nepali + English
 */
async function rewriteWithAI(rawTitle, articleBody, sourceLang) {
  if (!_geminiKey) return null;

  /* Prepare a concise news summary (max 800 chars) to keep the prompt small */
  const bodySnippet = (articleBody || '').replace(/\s+/g, ' ').slice(0, 800).trim();
  const langNote = sourceLang === 'ne' ? 'Nepali' : sourceLang === 'hi' ? 'Hindi' : 'English';

  const prompt = `You are a professional Nepali viral news editor.

TASK: Rewrite the following news story in creative, SEO-friendly Nepali (Devanagari script).
The output must be 100% original — no sentence should match the source word-for-word.

SOURCE NEWS (in ${langNote}):
Title: ${rawTitle}
Body: ${bodySnippet}

STRICT RULES:
1. All text values must be in Nepali (Devanagari script) — hashtags can mix Nepali + English
2. hook: one punchy emotional viral line, max 20 words, start with 1 relevant emoji
3. title: SEO headline, max 12 Nepali words, factual, keyword-rich
4. description: 3-4 original sentences, 60-90 Nepali words, covers what/who/impact/next steps
5. hashtags: array of 6 strings mixing Nepali and English hashtags
6. Output MUST be a single raw JSON object — no markdown fences, no explanation, no extra text

Output exactly this JSON structure (replace all values):
{"hook":"हुक यहाँ","title":"शीर्षक यहाँ","description":"विवरण यहाँ","hashtags":["#नेपालसमाचार","#BreakingNews","#Nepal","#नेपाल","#Kathmandu","#NepalNews"]}`;

  const result = await callGemini(prompt, 20000);
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
    hashtags:    hashtags.slice(0, 6).map(h => h.startsWith('#') ? h : '#' + h),
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
  document.getElementById('outHashtags').innerHTML =
    hashtags.map(h => `<span class="hashtag">${escHtml(h)}</span>`).join('');

  generatedPost = { hook, title: nepaliTitle, description: desc, hashtags, link: selectedArticle.link || '' };

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

  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': _removebgKey },
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
  const slider = document.getElementById('zoomSlider');
  const label  = document.getElementById('zoomVal');
  if (slider) slider.value = 100;
  if (label)  label.textContent = '100%';
  if (!silent) {
    if (_enhancedMode) { redrawEnhanced(); return; }
    if (selectedArticle && generatedPost) generateImage();
  }
}

/** Called by the zoom slider */
function onImgAdjust() {
  const pct = parseInt(document.getElementById('zoomSlider').value, 10);
  document.getElementById('zoomVal').textContent = pct + '%';
  imgScale = pct / 100;
  if (_enhancedMode) { redrawEnhanced(); return; }
  if (selectedArticle && generatedPost) generateImage();
}

/** Called by arrow pan buttons. dx/dy in canvas pixels */
function panImage(dx, dy) {
  imgOffsetX += dx;
  imgOffsetY += dy;
  if (_enhancedMode) { redrawEnhanced(); return; }
  if (selectedArticle && generatedPost) generateImage();
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
      `https://corsproxy.io/?${encodeURIComponent(src)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(src)}`,
      `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=1080`,
    ];
    for (const c of candidates) {
      try { newsImg = await loadImageFromSrc(c, 6000); imgSource = '🌐 News photo'; break; } catch {}
    }
  }

  if (newsImg) {
    drawNewsImage(ctx, newsImg, CANVAS_W, CANVAS_H);
    document.getElementById('imgSourceBadge').textContent = imgSource;
    /* Show the adjust toolbar for ANY image (uploaded OR from URL) */
    document.getElementById('imgAdjustBar').style.display = 'block';
    /* Cache active image as data-URL so AI enhance can use it */
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = newsImg.naturalWidth || newsImg.width;
    tmpCanvas.height = newsImg.naturalHeight || newsImg.height;
    tmpCanvas.getContext('2d').drawImage(newsImg, 0, 0);
    try { _activeImageDataUrl = tmpCanvas.toDataURL('image/jpeg', 0.92); } catch { _activeImageDataUrl = customImageDataUrl; }
    document.getElementById('enhanceAIBtn').style.display = 'inline-flex';
  } else {
    drawBackground(ctx, CANVAS_W, CANVAS_H);
    document.getElementById('imgSourceBadge').textContent = '🎨 Graphic background';
    /* No image — hide adjust toolbar and enhance button */
    document.getElementById('imgAdjustBar').style.display = 'none';
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
  /* ── 1. Off-screen canvas for colour grading ── */
  const offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  const oct = offscreen.getContext('2d');

  /* Scale-to-fill exactly — apply user zoom on top */
  const baseSc = Math.max(W / img.width, H / img.height);
  const scale  = baseSc * imgScale;          // imgScale defaults to 1.0
  const sw = img.width * scale, sh = img.height * scale;
  /* Centre the image, then apply user pan offsets */
  oct.drawImage(img,
    (W - sw) / 2 + imgOffsetX,
    (H - sh) / 2 + imgOffsetY,
    sw, sh);

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
  /* Red banner bar */
  ctx.fillStyle = '#c0392b';
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
  ctx.fillText('🚨  BREAKING NEWS', W / 2, 88);
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

  /* ── Measure title line count first so we can layout bottom-up ── */
  ctx.font = 'bold 62px "Segoe UI",Arial,sans-serif';
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

  const TITLE_LINE_H = 78;
  const BRAND_H      = 36;
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
  ctx.font = 'bold 62px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 16;
  const drawnLines = wrapText(ctx, post.title, W / 2, y, W - pad * 2, TITLE_LINE_H, 3);
  y += drawnLines * TITLE_LINE_H + 18;
  ctx.shadowBlur = 0;

  /* ── Branding watermark ── */
  ctx.font = 'bold 22px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.50)';
  ctx.textAlign = 'right';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 5;
  ctx.fillText('© Shashi News Generator', W - 28, y + 22);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
}

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
  if (!_geminiKey) {
    toast('⚙️ Setup your free Gemini API key first — click the AI button in the header.', 'error', 5000); return;
  }

  const m       = _EDIT_MAP[field];
  const btn     = document.getElementById(m.reimagineBtn);
  const display = document.getElementById(m.display);

  /* Show spinner on the button */
  const origHTML = btn.innerHTML;
  btn.innerHTML  = '<span class="spinner" style="width:12px;height:12px;border-width:2px;border-color:rgba(139,92,246,.3);border-top-color:#a78bfa"></span>';
  btn.disabled   = true;
  display.style.opacity = '0.4';

  const rawTitle   = selectedArticle.title || '';
  const bodySnippet = (selectedArticle.fullArticleText || selectedArticle.description || '').slice(0, 600);
  const currentVal  = generatedPost[m.postKey] || '';

  /* Build a field-specific prompt */
  let prompt = '';
  if (field === 'hook') {
    prompt = `You are a professional Nepali viral news editor.

TASK: Write ONE brand-new viral hook (opening line) for the news story below.
It must be COMPLETELY DIFFERENT from the existing hook — fresh angle, different emotion.

News Title: ${rawTitle}
News Body: ${bodySnippet}
Existing Hook (DO NOT reuse): ${currentVal}

STRICT RULES:
1. Nepali language only (Devanagari script)
2. Maximum 20 Nepali words
3. Start with exactly 1 relevant emoji
4. Emotionally gripping and shareable
5. Output MUST be a single raw JSON object — no markdown, no explanation, no extra text

Output exactly this JSON (replace the value):
{"hook":"नयाँ हुक यहाँ लेख्नुहोस्"}`;

  } else if (field === 'title') {
    prompt = `You are a professional Nepali SEO news editor.

TASK: Write ONE brand-new SEO headline for the news story below.
It must be COMPLETELY DIFFERENT from the existing title.

News Title (source): ${rawTitle}
News Body: ${bodySnippet}
Existing Title (DO NOT reuse): ${currentVal}

STRICT RULES:
1. Nepali language only (Devanagari script)
2. Maximum 12 Nepali words
3. Factual, keyword-rich, no clickbait
4. Different keywords and structure from existing title
5. Output MUST be a single raw JSON object — no markdown, no explanation, no extra text

Output exactly this JSON (replace the value):
{"title":"नयाँ शीर्षक यहाँ लेख्नुहोस्"}`;

  } else if (field === 'desc') {
    prompt = `You are a professional Nepali news writer.

TASK: Rewrite the description for this news story in a completely fresh way.
Same core facts, but entirely different sentence structures and word choices.

News Title: ${rawTitle}
News Body: ${bodySnippet}
Existing Description (DO NOT copy): ${currentVal}

STRICT RULES:
1. Nepali language only (Devanagari script)
2. Exactly 3-4 sentences, 60-90 Nepali words total
3. Cover: what happened · who is involved · impact · what happens next
4. Zero sentence overlap with existing description
5. Output MUST be a single raw JSON object — no markdown, no explanation, no extra text

Output exactly this JSON (replace the value):
{"description":"नयाँ विवरण यहाँ लेख्नुहोस्"}`;
  }

  try {
    const result = await callGemini(prompt, 18000);
    const newVal = result?.[field === 'desc' ? 'description' : field];

    if (!newVal || !/[\u0900-\u097F]{3,}/.test(newVal)) {
      throw new Error('No valid Nepali content returned');
    }

    /* Apply the new value */
    const cleaned = field === 'title' ? cleanTitle(newVal.trim()) : newVal.trim();
    generatedPost[m.postKey] = cleaned;
    display.textContent = cleaned;
    display.style.opacity = '1';

    /* Flash the card green to signal success */
    display.classList.add('reimagine-flash');
    setTimeout(() => display.classList.remove('reimagine-flash'), 800);

    toast(`✨ ${field === 'hook' ? 'Hook' : field === 'title' ? 'Title' : 'Description'} reimagined by AI!`, 'success', 3000);

    /* Regenerate canvas if image is visible */
    if (document.getElementById('imagePanel').style.display !== 'none') generateImage();

  } catch (e) {
    console.warn('[Reimagine] failed:', e.message);
    display.style.opacity = '1';
    toast('❌ AI reimagine failed — try again.', 'error');
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