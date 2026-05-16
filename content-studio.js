/* ================================================================
   CONTENT STUDIO  - content-studio.js
   9-tab AI-powered social media post generator
   Tabs: ad | festival | politician | quote | health | facts | atomic | quiz | success
   ================================================================ */

'use strict';

/* -- State -- */
const _csPhotos       = {};   // { tabKey: HTMLImageElement }
const _csPhotoOffsets = {};   // { tabKey: { dx, dy } }  — pan offset in canvas-px within clip box
const _csPhotoZoom    = {};   // { tabKey: Number }       — zoom multiplier (1.0 = cover-fill)
const _csPhotoRects   = {};   // { tabKey: { x,y,w,h } } — last drawn clip box (for hit-test)
let   _csPhotoDrag    = null; // active drag: { key, startX, startY, baseDx, baseDy }
let   _csTab     = 'ad';
let   _csW       = 600, _csH = 600;
let   _csCaption = '';

/* -- Ad state -- */
let _adLastData    = null;
let _adImages      = [];   // [{ img, x, y, w, h, circle, noBg, cropX, cropY, cropW, cropH }]
let _adOverlay     = null; // { img, x, y, r }
let _adAutoLayout  = true;
let _adTemplate    = 'bold-offer';
let _adLayers      = [];   // [{ id, type, text, x, y, w, fontSize, color, bold, align, visible, badge }]
let _adDragState   = null; // active text-layer drag: { layerId, ox, oy }
let _adLayerPosOverride = {}; // { layerId: { x, y } } — user-dragged positions
let _adRibbonColor = '';   // '' = use accent, or a hex colour string
let _adCanvasFocused = false;
let _adSelectedImgIdx = -1; // index of currently selected image
let _adImgDragState   = null; // { idx, mode:'move'|'resize', corner, ox, oy, origX, origY, origW, origH }
let _adCanvasBorder   = 'none'; // canvas decorative border
let _adProductFontSize = 0;     // 0 = auto (7% of W); set by slider

/* -- Open / Close -- */
function openContentStudio() {
  document.querySelector('.container').style.display           = 'none';
  document.getElementById('memeStudioModal').style.display     = 'none';
  document.getElementById('puzzleStudioModal').style.display   = 'none';
  document.getElementById('contentStudioModal').style.display  = 'block';
  const _footer = document.querySelector('footer');
  if (_footer) _footer.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  ['newsStudioBtn','memeStudioBtn','puzzleStudioBtn','contentStudioBtn'].forEach(id =>
    document.getElementById(id)?.classList.remove('active-studio-btn'));
  document.getElementById('contentStudioBtn')?.classList.add('active-studio-btn');
  csRenderBlank();
  setTimeout(_csAdUpdateDragOverlay, 100);
}

function closeContentStudio() {
  document.getElementById('contentStudioModal').style.display = 'none';
  document.querySelector('.container').style.display = '';
  const _footer = document.querySelector('footer');
  if (_footer) _footer.style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.getElementById('contentStudioBtn')?.classList.remove('active-studio-btn');
}

/* Patch existing studio openers to also hide content studio */
(function() {
  const _origOpenMeme  = window.openMemeStudio;
  const _origOpenPuzzle = window.openPuzzleStudio;
  const _origOpenNews  = window.openNewsStudio;
  window.openMemeStudio = function() {
    document.getElementById('contentStudioModal').style.display = 'none';
    document.getElementById('contentStudioBtn')?.classList.remove('active-studio-btn');
    _origOpenMeme && _origOpenMeme();
  };
  window.openPuzzleStudio = function() {
    document.getElementById('contentStudioModal').style.display = 'none';
    document.getElementById('contentStudioBtn')?.classList.remove('active-studio-btn');
    _origOpenPuzzle && _origOpenPuzzle();
  };
  window.openNewsStudio = function() {
    document.getElementById('contentStudioModal').style.display = 'none';
    document.getElementById('contentStudioBtn')?.classList.remove('active-studio-btn');
    _origOpenNews && _origOpenNews();
  };
})();

/* -- Tab switching -- */
function csSwitch(tab) {
  if (_csTab !== 'ad' && tab === 'ad') {
    setTimeout(_csAdUpdateDragOverlay, 50);
  } else if (_csTab === 'ad' && tab !== 'ad') {
    _csAdHideOverlay();
  }
  // Show logo overlay only on politician tab when logo is loaded
  _csLogoOverlayVisible(tab === 'politician' && !!_politicianLogo);
  _csTab = tab;
  document.querySelectorAll('.cs-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.cs-pane').forEach(p => p.classList.toggle('active', p.id === 'csPane-' + tab));
  csRenderBlank();
  // Show/hide conditional rows
  if (tab === 'festival') {
    document.getElementById('csFestival').dispatchEvent(new Event('change'));
  }
  if (tab === 'quote') {
    csQuoteLoadDB();
  }
  if (tab === 'health') {
    csHealthLoadDB();
  }
}

/* -- Conditional rows -- */
document.addEventListener('DOMContentLoaded', () => {
  const festSel = document.getElementById('csFestival');
  if (festSel) {
    festSel.addEventListener('change', () => {
      const v = festSel.value;
      document.getElementById('csFestivalCustomRow').style.display = v === 'custom' ? 'block' : 'none';
      _csFestPopulateGreetings(v);
    });
    // Populate on first load
    _csFestPopulateGreetings(festSel.value);
    _csFestPopulateBgGrid(festSel.value);
    // Pre-fill banner text for the default occasion
    csFestivalChanged(festSel.value);
  }
  const quoteTypeHidden = document.getElementById('csQuoteType');
  document.querySelectorAll('[onclick*="csQuoteType"]').forEach(b => b.addEventListener('click', () => {
    const v = quoteTypeHidden?.value;
    document.getElementById('csQuoteFamousRow').style.display  = v === 'famous'  ? 'block' : 'none';
    document.getElementById('csQuoteCustomRow').style.display  = v === 'custom'  ? 'block' : 'none';
  }));
  const succCountry = document.getElementById('csSuccessCountry');
  document.querySelectorAll('[onclick*="csSuccessCountry"]').forEach(b => b.addEventListener('click', () => {
    document.getElementById('csSuccessCountryCustomRow').style.display = succCountry?.value === 'custom' ? 'block' : 'none';
  }));

  // ── Live-preview: re-render canvas on ANY input/select/textarea change in cs-left ──
  const csLeft = document.querySelector('.cs-left');
  if (csLeft) {
    const liveHandler = () => {
      // determine active tab and re-render accordingly
      const activePane = document.querySelector('.cs-pane.active');
      if (!activePane) return;
      const tab = activePane.id.replace('csPane-', '');
      if (tab === 'ad') {
        csAdLiveRender();
      } else {
        csRenderBlank();
      }
    };
    csLeft.addEventListener('input',  liveHandler);
    csLeft.addEventListener('change', liveHandler);
  }

  // ── Photo pan & zoom within fixed clip box ──
  (function _initCsPhotoPanZoom() {
    const PHOTO_TABS = ['festival', 'politician', 'quote', 'success'];

    function _pt(canvas, e) {
      const rect = canvas.getBoundingClientRect();
      const src  = e.touches ? e.touches[0] : e;
      const sx   = (canvas.width  || _csW) / rect.width;
      const sy   = (canvas.height || _csH) / rect.height;
      return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
    }

    function _insideRect(r, px, py) {
      return r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    }

    // ── Mouse drag to pan ──
    function _onDown(e) {
      const key = PHOTO_TABS.includes(_csTab) ? _csTab : null; if (!key) return;
      if (!_csPhotos[key]) return;
      const canvas = document.getElementById('csCanvas'); if (!canvas) return;
      const p = _pt(canvas, e);
      if (!_insideRect(_csPhotoRects[key], p.x, p.y)) return;
      e.preventDefault();
      const off = _csPhotoOffsets[key] || { dx: 0, dy: 0 };
      _csPhotoDrag = { key, startX: p.x, startY: p.y, baseDx: off.dx, baseDy: off.dy };
      canvas.style.cursor = 'grabbing';
    }

    function _onMove(e) {
      const canvas = document.getElementById('csCanvas'); if (!canvas) return;
      if (!_csPhotoDrag) {
        // Hover: show grab cursor when over the photo box
        const key = PHOTO_TABS.includes(_csTab) ? _csTab : null;
        if (key && _csPhotos[key]) {
          const p = _pt(canvas, e);
          canvas.style.cursor = _insideRect(_csPhotoRects[key], p.x, p.y) ? 'grab' : '';
        }
        return;
      }
      e.preventDefault();
      const { key, startX, startY, baseDx, baseDy } = _csPhotoDrag;
      const p = _pt(canvas, e);
      _csPhotoOffsets[key] = { dx: baseDx + (p.x - startX), dy: baseDy + (p.y - startY) };
      csRenderBlank();
    }

    function _onUp() {
      if (_csPhotoDrag) {
        _csPhotoDrag = null;
        const canvas = document.getElementById('csCanvas');
        if (canvas) canvas.style.cursor = '';
      }
    }

    // ── Scroll / pinch to zoom ──
    function _onWheel(e) {
      const key = PHOTO_TABS.includes(_csTab) ? _csTab : null; if (!key) return;
      if (!_csPhotos[key]) return;
      const canvas = document.getElementById('csCanvas'); if (!canvas) return;
      const p = _pt(canvas, e);
      if (!_insideRect(_csPhotoRects[key], p.x, p.y)) return;
      e.preventDefault();
      const delta  = e.deltaY < 0 ? 0.08 : -0.08;
      const cur    = _csPhotoZoom[key] || 1.0;
      _csPhotoZoom[key] = Math.min(4, Math.max(0.5, cur + delta));
      csRenderBlank();
    }

    function _attach() {
      const canvas = document.getElementById('csCanvas'); if (!canvas) { setTimeout(_attach, 300); return; }
      canvas.addEventListener('mousedown',  _onDown, { passive: false });
      canvas.addEventListener('touchstart', _onDown, { passive: false });
      window.addEventListener('mousemove',  _onMove, { passive: false });
      window.addEventListener('touchmove',  _onMove, { passive: false });
      window.addEventListener('mouseup',    _onUp,   { passive: true });
      window.addEventListener('touchend',   _onUp,   { passive: true });
      canvas.addEventListener('wheel',      _onWheel, { passive: false });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _attach);
    else _attach();
  })();
});

/* -- Radio button helper -- */
function csRadio(btn, hiddenId) {
  const container = btn.closest('.cs-field') || btn.parentElement;
  container.querySelectorAll('.cs-radio-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const hidden = document.getElementById(hiddenId);
  if (hidden) {
    hidden.value = btn.dataset.val;
    // Fire change event so the live-preview delegation picks it up
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/* -- Background swatch helper -- */
function csSelectBg(btn, swatchesId) {
  document.getElementById(swatchesId)?.querySelectorAll('.cs-bg-swatch').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  csRenderBlank(); // re-render preview background
}

/* -- Border style helper -- */
function csSelectBorder(btn) {
  document.getElementById('csBorderGrid')?.querySelectorAll('.cs-border-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  csRenderBlank();
}

/* -- Photo loader -- */
function csLoadPhoto(input, previewId) {
  const file = input.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const key = previewId.replace('cs','').replace('PhotoPreview','').toLowerCase();
      _csPhotos[key] = img;
      _csPhotoOffsets[key] = { dx: 0, dy: 0 };   // reset pan
      _csPhotoZoom[key]    = 1.0;                 // reset zoom
      const span = document.getElementById(previewId);
      if (span) span.textContent = '✅ ' + file.name;
      _csShowPhotoDragHint();
      csRenderBlank();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* -- Hint toast on canvas -- */
function _csShowPhotoDragHint() {
  const wrap = document.getElementById('csCanvasWrap');
  if (!wrap) return;
  let hint = document.getElementById('_csPhotoDragHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = '_csPhotoDragHint';
    hint.textContent = '✋ Drag to pan · scroll to zoom inside circle/box';
    hint.style.cssText = 'position:absolute;bottom:44px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#f6ad55;font-size:12px;padding:5px 14px;border-radius:20px;pointer-events:none;z-index:20;white-space:nowrap;transition:opacity .4s;border:1px solid rgba(246,173,85,.3)';
    wrap.appendChild(hint);
  }
  hint.style.opacity = '1';
  clearTimeout(hint._t);
  hint._t = setTimeout(() => { hint.style.opacity = '0'; }, 3500);
}

/* -- Reset photo pan+zoom to default -- */
function csResetPhotoPos(key) {
  _csPhotoOffsets[key] = { dx: 0, dy: 0 };
  _csPhotoZoom[key]    = 1.0;
  csRenderBlank();
}

function csSetSize(w, h, btn) {
  _csW = w; _csH = h;
  const canvas = document.getElementById('csCanvas');
  if (canvas) { canvas.width = w; canvas.height = h; }
  document.querySelectorAll('.meme-size-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  csRenderBlank();
}

/* -- Get active bg key -- */
function _csActiveBg(swatchesId) {
  const active = document.getElementById(swatchesId)?.querySelector('.cs-bg-swatch.active');
  return active?.dataset.bg || 'gradient-dark';
}

/* -- Canvas helper -- */
function _csGetCanvas() {
  const canvas = document.getElementById('csCanvas');
  if (!canvas) return { ctx: null, W: _csW, H: _csH };
  canvas.width  = _csW;
  canvas.height = _csH;
  return { ctx: canvas.getContext('2d'), W: _csW, H: _csH };
}

/* -- Blank canvas render (preview while filling form) -- */
function csRenderBlank() {
  if (_csTab === 'ad') { csAdLiveRender(); return; }
  // Dispatch to per-tab renderer if available (prevents photo bleed)
  const tabDispatch = {
    festival:  () => typeof _csRenderFestival  === 'function' && _csRenderFestival(null),
    politician:() => typeof _csRenderPolitician=== 'function' && _csRenderPolitician(null),
    quote:     () => typeof _csRenderQuote     === 'function' && _csRenderQuote(null),
    health:    () => {
      // Re-render with current selected habit so bg/photo changes don't wipe content
      if (_csHealthSelected && typeof _csRenderHealth === 'function') {
        const habit = _csHealthSelected;
        _csRenderHealth({
          title: '� Health Tips',
          habits: [{ bad_habit: habit.bad, bad_impact: habit.bad_impact, good_habit: habit.good, good_impact: habit.good_impact }],
          tip: habit.tip,
          closing: habit.closing,
        });
      } else if (_csHealthResearchActive && typeof _csRenderHealth === 'function') {
        csHealthShowResearch();
      } else if (typeof _csRenderHealth === 'function') {
        _csRenderHealth(null);
      }
    },
    facts:     () => typeof _csRenderFacts     === 'function' && _csRenderFacts(null),
    atomic:    () => typeof _csRenderAtomic    === 'function' && _csRenderAtomic(null),
    quiz:      () => typeof _csRenderQuiz      === 'function' && _csRenderQuiz(null),
    success:   () => typeof _csRenderSuccess   === 'function' && _csRenderSuccess(null),
    poll:      () => typeof _csRenderPoll      === 'function' && _csRenderPoll(null),
  };
  if (tabDispatch[_csTab]) { tabDispatch[_csTab](); return; }

  const canvas = document.getElementById('csCanvas');
  if (!canvas) return;
  canvas.width  = _csW;
  canvas.height = _csH;
  const ctx = canvas.getContext('2d');
  const W = _csW, H = _csH;
  _csDrawBackground(ctx, W, H, 'gradient-dark');
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle   = '#fff';
  ctx.font        = `bold ${Math.round(W * 0.04)}px sans-serif`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Content Studio — Generate & Run', W / 2, H / 2);
  ctx.restore();
}

/* -- Draw background helper -- */
function _csDrawBackground(ctx, W, H, bgKey) {
  ctx.clearRect(0, 0, W, H);
  const gradients = {
    'gradient-dark':     ['#0a0f1e', '#1e293b'],
    'gradient-purple':   ['#1e0538', '#7c3aed'],
    'gradient-red':      ['#450a0a', '#dc2626'],
    'gradient-green':    ['#022c22', '#059669'],
    'gradient-gold':     ['#431407', '#d97706'],
    'gradient-pink':     ['#500724', '#a855f7'],
    'gradient-blue':     ['#0c1a2e', '#2563eb'],
    'gradient-teal':     ['#042f2e', '#0891b2'],
    'gradient-orange':   ['#431407', '#ea580c'],
    'gradient-rose':     ['#4c0519', '#e11d48'],
    'gradient-emerald':  ['#052e16', '#16a34a'],
    'gradient-indigo':   ['#1e1b4b', '#4338ca'],
    'gradient-saffron':  ['#7c2d12', '#f59e0b'],
    'gradient-maroon':   ['#450a0a', '#991b1b'],
    'gradient-navy':     ['#0c1445', '#1e3a8a'],
    'gradient-midnight': ['#0a0a0a', '#1c1c2e'],
    'nepal-flag':        ['#003893', '#dc143c'],
    'white-clean':       ['#f8fafc', '#e2e8f0'],
    'space-dark':        ['#000008', '#0d0a2e'],
    'bokeh':             ['#060310', '#1e1b4b'],
    'health-emerald':    ['#064e3b', '#059669'],
    'health-ocean':      ['#0c4a6e', '#0284c7'],
    'health-teal':       ['#134e4a', '#0d9488'],
    'health-purple':     ['#3b0764', '#7e22ce'],
    'health-slate':      ['#0f172a', '#1e293b'],
    'health-warm':       ['#431407', '#c2410c'],
    'health-rose':       ['#4c0519', '#be123c'],
    'health-white':      ['#f0fdf4', '#dcfce7'],
  };
  const stops = gradients[bgKey] || gradients['gradient-dark'];
  const isLight = bgKey === 'white-clean' || bgKey === 'health-white';

  // Rich multi-stop gradient
  const grad = ctx.createLinearGradient(0, 0, W * 0.7, H);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.55, stops[1]);
  grad.addColorStop(1, stops[0]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Radial accent glows
  if (!isLight) {
    const g1 = ctx.createRadialGradient(W*0.15, H*0.15, 0, W*0.15, H*0.15, W*0.55);
    g1.addColorStop(0, 'rgba(167,139,250,0.18)');
    g1.addColorStop(1, 'rgba(167,139,250,0)');
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

    const g2 = ctx.createRadialGradient(W*0.85, H*0.85, 0, W*0.85, H*0.85, W*0.5);
    g2.addColorStop(0, 'rgba(59,130,246,0.14)');
    g2.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  }

  // Subtle diagonal grid
  ctx.save();
  ctx.globalAlpha = isLight ? 0.05 : 0.07;
  ctx.strokeStyle = isLight ? '#334155' : 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 0.5;
  const step = Math.round(W / 14);
  for (let x = -H; x < W + H; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
  }
  ctx.restore();
}

/* -- Draw photo (circle or rect) -- */
function _csDrawPhoto(ctx, img, x, y, w, h, circle = false, offKey = null) {
  if (!img) return;

  // Record the clip-box rect so the pan/zoom event handler can hit-test it
  if (offKey) _csPhotoRects[offKey] = { x, y, w, h };

  // Retrieve pan offset and zoom for this tab key
  const off  = offKey ? (_csPhotoOffsets[offKey] || { dx: 0, dy: 0 }) : { dx: 0, dy: 0 };
  const zoom = offKey ? (_csPhotoZoom[offKey]    || 1.0)              : 1.0;

  ctx.save();
  // Clip to the fixed layout box (circle or rounded-rect) — this NEVER moves
  if (circle) {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.clip();
  } else {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 12);
    else ctx.rect(x, y, w, h);
    ctx.clip();
  }

  // Cover-fill the box with the image, then apply zoom + pan offset
  const iw = img.naturalWidth  || img.width  || 1;
  const ih = img.naturalHeight || img.height || 1;
  const baseSc = Math.max(w / iw, h / ih) * zoom;
  const imgW   = iw * baseSc,  imgH = ih * baseSc;

  // Centre the zoomed image in the box, then shift by pan offset
  let imgX = x + (w - imgW) / 2 + off.dx;
  let imgY = y + (h - imgH) / 2 + off.dy;

  // Clamp so the image always covers the box edges (no empty gaps)
  imgX = Math.min(x, Math.max(x - (imgW - w), imgX));
  imgY = Math.min(y, Math.max(y - (imgH - h), imgY));

  ctx.drawImage(img, imgX, imgY, imgW, imgH);
  ctx.restore();
}

/* -- Wrap text helper -- */
function _csWrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  const drawn = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + drawn.length * lineH);
      drawn.push(line); line = w;
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y + drawn.length * lineH); drawn.push(line); }
  return drawn.length;
}

/* -- Draw watermark (matches News Generator style) -- */
function _csWatermark(ctx, W, H) {
  const wScale  = Math.min(W / 600, 1);
  const STRIP_H = Math.round(34 * Math.max(wScale, 0.65));
  const AVT_R   = Math.round(10 * Math.max(wScale, 0.65));
  const FONT    = Math.round(10.5 * Math.max(wScale, 0.65));
  const PAD_R   = Math.round(10 * Math.max(wScale, 0.65));
  const stripY  = H - STRIP_H;

  ctx.save();

  // Dark strip
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, stripY, W, STRIP_H);

  // Gold separator
  ctx.strokeStyle = 'rgba(246,173,85,0.50)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, stripY); ctx.lineTo(W, stripY); ctx.stroke();

  const cy = stripY + STRIP_H / 2;

  // Section label for current tab
  const sectionMap = { ad:'Ad Post', festival:'Occasions', politician:'Politician', quote:'Quote',
    health:'Health Tips', facts:'Unknown Facts', atomic:'Atomic Habits', quiz:'Quiz',
    success:'Success Story', poll:'Poll', news:'News', meme:'Meme' };
  const section = (typeof _csTab !== 'undefined' && sectionMap[_csTab]) ? sectionMap[_csTab] : 'Content';

  // Build text parts
  const authorImg = (typeof _authorImg !== 'undefined') ? _authorImg : null;
  ctx.font = `bold ${FONT}px "Segoe UI",Arial,sans-serif`;
  const nameStr = `Shashi Creator Studio \u2014 ${section}`;
  const nameW   = ctx.measureText(nameStr).width;
  ctx.font = `${FONT}px "Segoe UI",Arial,sans-serif`;
  const urlStr  = `  \u00b7  shajais.github.io/ShashiNewsGen`;
  const urlW    = ctx.measureText(urlStr).width;

  // Total width: avatar + gap + name + url
  const GAP = Math.round(5 * Math.max(wScale, 0.65));
  const totalW  = AVT_R * 2 + GAP + nameW + urlW;
  const startX  = Math.max(GAP, W - PAD_R - totalW);

  // Avatar
  const avCX = startX + AVT_R, avCY = cy;
  ctx.save();
  ctx.beginPath(); ctx.arc(avCX, avCY, AVT_R, 0, Math.PI * 2); ctx.clip();
  if (authorImg) {
    const srcW = authorImg.naturalWidth, srcH = authorImg.naturalHeight;
    const crop = Math.min(srcW, srcH);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(authorImg, (srcW-crop)/2, (srcH-crop)/2, crop, crop,
                  avCX-AVT_R, avCY-AVT_R, AVT_R*2, AVT_R*2);
  } else {
    ctx.fillStyle = '#7c3aed'; ctx.fillRect(avCX-AVT_R, avCY-AVT_R, AVT_R*2, AVT_R*2);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${AVT_R}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SJ', avCX, avCY);
  }
  ctx.restore();
  // Gold ring
  ctx.beginPath(); ctx.arc(avCX, avCY, AVT_R + 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#f6ad55'; ctx.lineWidth = 1.5; ctx.stroke();

  // Name text
  const textX = startX + AVT_R * 2 + GAP;
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.font = `bold ${FONT}px "Segoe UI",Arial,sans-serif`;
  ctx.fillText(nameStr, textX, cy);

  // URL text
  ctx.fillStyle = 'rgba(246,173,85,0.90)';
  ctx.font = `${FONT}px "Segoe UI",Arial,sans-serif`;
  ctx.fillText(urlStr, textX + nameW, cy);

  ctx.shadowBlur = 0;
  ctx.restore();
}

/* -- Draw decorated border -- */
function _csDrawBorder(ctx, W, H, style) {
  const icons = {
    flowers:   ['🌸','🌼','🌺','🌹','🌻'],
    diyas:     ['🪔','✨','🎆','🌟','⭐'],
    stars:     ['⭐','🌟','✨','💫','🌠'],
    leaves:    ['🍃','🌿','🌱','🍀','🌾'],
    geometric: null,
    mandala:   null,
  };

  if (style === 'geometric') {
    // Draw geometric corner accents
    ctx.save();
    ctx.strokeStyle = 'rgba(245,158,11,0.7)';
    ctx.lineWidth = 3;
    const cs = 40; // corner size
    [[0,0,1,1],[W,0,-1,1],[0,H,1,-1],[W,H,-1,-1]].forEach(([cx,cy,sx,sy]) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx*cs, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy*cs);
      ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(245,158,11,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.restore();
    return;
  }

  if (style === 'mandala') {
    ctx.save();
    ctx.strokeStyle = 'rgba(167,139,250,0.4)';
    ctx.lineWidth = 2;
    for (let r = 20; r <= 60; r += 20) {
      [[r,r],[W-r,r],[r,H-r],[W-r,H-r]].forEach(([cx,cy]) => {
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.stroke();
      });
    }
    ctx.restore();
    return;
  }

  const emojis = icons[style] || icons.flowers;
  const size = Math.round(W * 0.045);
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const margin = size * 1.2;
  const count  = Math.floor((W - margin * 2) / (size * 1.4));
  for (let i = 0; i <= count; i++) {
    const fx = margin + i * (W - margin * 2) / count;
    ctx.fillText(emojis[i % emojis.length], fx, margin);
    ctx.fillText(emojis[i % emojis.length], fx, H - margin);
  }
  const countY = Math.floor((H - margin * 2) / (size * 1.4));
  for (let i = 1; i < countY; i++) {
    const fy = margin + i * (H - margin * 2) / countY;
    ctx.fillText(emojis[i % emojis.length], margin, fy);
    ctx.fillText(emojis[(i + 2) % emojis.length], W - margin, fy);
  }
}

/* ================================================================
   AI GENERATION
   Uses Gemini via /api/gemini (same endpoint as the main app)
   ================================================================ */
async function _csCallAI(prompt) {
  try {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    return data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    console.warn('AI call failed:', err);
    return null;
  }
}

function _csShowSpinner(show) {
  const sp = document.getElementById('csSpinner');
  if (sp) sp.style.display = show ? 'flex' : 'none';
}
function _csSetStatus(msg) {
  const el = document.getElementById('csStatus');
  if (el) el.textContent = msg;
}
function _csShowCaption(text) {
  _csCaption = text;
  const box = document.getElementById('csCaptionBox');
  const txt = document.getElementById('csCaptionText');
  if (box && txt) {
    box.style.display = 'block';
    txt.value = text;
    _csRenderCaptionPreview();
  }
}

/* ── Caption colour engine ── */
// Bright palette — designed to pop on dark AND light backgrounds
const _CAPTION_COLORS = [
  '#f59e0b','#34d399','#60a5fa','#f472b6','#a78bfa',
  '#fb923c','#4ade80','#38bdf8','#e879f9','#fde68a',
  '#f87171','#2dd4bf','#818cf8','#fdba74','#86efac',
];
// Per-group override map: key = group index, value = colour hex
let _captionGroupColors = {};

function _csRenderCaptionPreview() {
  const preview = document.getElementById('csCaptionColorPreview');
  const tools   = document.getElementById('csCaptionColorTools');
  if (!preview) return;

  const text = document.getElementById('csCaptionText')?.value || '';
  if (!text.trim()) { preview.style.display = 'none'; if (tools) tools.style.display = 'none'; return; }

  // Split into word tokens (keep whitespace/newlines as separate tokens)
  const tokens = text.split(/(\s+)/);
  const words  = tokens.filter(t => t.trim().length > 0);

  if (words.length === 0) { preview.style.display = 'none'; return; }

  // Group words in chunks of 2–3
  const chunkSize = words.length <= 6 ? 2 : 3;
  const groups = [];
  let wIdx = 0;
  for (const tok of tokens) {
    if (!tok.trim()) { groups.push({ type: 'ws', val: tok }); continue; }
    const gi = Math.floor(wIdx / chunkSize);
    groups.push({ type: 'word', val: tok, gi });
    wIdx++;
  }
  const numGroups = Math.ceil(words.length / chunkSize);

  // Assign colours — cycle palette, skip over background-clashing colours
  preview.innerHTML = groups.map(g => {
    if (g.type === 'ws') return g.val.replace(/\n/g, '<br>');
    const baseColor = _captionGroupColors[g.gi] ?? _CAPTION_COLORS[g.gi % _CAPTION_COLORS.length];
    return `<span class="cs-cap-word" data-gi="${g.gi}" style="color:${baseColor};font-weight:700;cursor:pointer" onclick="_csPickCaptionGroup(${g.gi})" title="Click to change colour">${g.val}</span>`;
  }).join('');

  preview.style.display = 'block';
  if (tools) tools.style.display = 'flex';

  // Build swatch strip
  _csRenderCaptionSwatches(numGroups);
}

let _captionActiveGroup = null;

function _csPickCaptionGroup(gi) {
  _captionActiveGroup = gi;
  // Highlight selected group
  document.querySelectorAll('.cs-cap-word').forEach(el => {
    el.style.outline = el.dataset.gi == gi ? '2px solid #fff' : 'none';
    el.style.borderRadius = '2px';
  });
  _csRenderCaptionSwatches();
}

function _csRenderCaptionSwatches() {
  const strip = document.getElementById('csCaptionColorSwatches');
  if (!strip) return;
  strip.innerHTML = _CAPTION_COLORS.map(c => `
    <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;border:2px solid rgba(255,255,255,.25);transition:transform .1s"
      title="${c}"
      onmouseover="this.style.transform='scale(1.25)'" onmouseout="this.style.transform=''"
      onclick="_csCaptionSetColor('${c}')"></span>`).join('');
}

function _csCaptionSetColor(color) {
  if (_captionActiveGroup === null) return;
  _captionGroupColors[_captionActiveGroup] = color;
  _csRenderCaptionPreview();
  // Re-select the group visually
  setTimeout(() => _csPickCaptionGroup(_captionActiveGroup), 10);
}

function _csRandomizeCaptionColors() {
  _captionGroupColors = {};
  // Shuffle palette so each call gives a fresh random set
  const shuffled = [..._CAPTION_COLORS].sort(() => Math.random() - .5);
  const text = document.getElementById('csCaptionText')?.value || '';
  const words = text.split(/\s+/).filter(Boolean);
  const chunkSize = words.length <= 6 ? 2 : 3;
  const n = Math.ceil(words.length / chunkSize);
  for (let i = 0; i < n; i++) {
    _captionGroupColors[i] = shuffled[i % shuffled.length];
  }
  _csRenderCaptionPreview();
}

/* -- Quick (template-only, no AI) -- */
function csQuick(tab) {
  const quick = {
    ad: { caption: '🔥 Special Offer!\n✨ Our Premium Service - Run Now!\n📞 Contact Today!\n\n#Nepal #Business #Sale #Offer', render: _csRenderAd },
    festival:  { caption: '🪔 Best Wishes! Happy Festival!\n#NepalFestival', render: _csRenderFestival },
    politician:{ caption: '🙏 Happy Birthday - Heartfelt Wishes!\n#Nepal #Politics', render: _csRenderPolitician },
    quote: {
      caption: '"सफलता एक यात्रा हो — गन्तव्य होइन।"\n— प्रेरणादायक उद्धरण\n#Motivation #Nepal #Nepali',
      render: (d) => {
        const type = document.getElementById('csQuoteType')?.value || 'motivational';
        // Custom: render from textarea + creator name
        if (type === 'custom') {
          const q = document.getElementById('csQuoteCustomText')?.value?.trim() || '';
          const a = document.getElementById('csQuoteCreatorName')?.value?.trim() || '';
          return _csRenderQuote({ quote: q, author: a });
        }
        // Anonymous: use selected/DB quote with "Anonymous" author
        if (type === 'anonymous') {
          const q = document.getElementById('csQuoteSelectedText')?.value?.trim() || '';
          if (q) return _csRenderQuote({ quote: q, author: 'Anonymous' });
        }
        // Famous / motivational: try DB quote
        if (typeof QUOTES_DB !== 'undefined') {
          const item = dbGetRandomQuote(type);
          if (item) {
            const q = typeof item === 'object' ? item.quote : item;
            const a = typeof item === 'object' ? (item.author || '') : '';
            return _csRenderQuote({ quote: q, author: a });
          }
        }
        _csRenderQuote(d);
      }
    },
    health: {
      caption: '💊 स्वस्थ बानीहरू\n🌿 आजैदेखि सुरु गर्नुस्!\n#HealthTips #Nepal #Wellness',
      render: () => {
        const cat = document.getElementById('csHealthCategory')?.value || 'all';
        const h = healthDbRandom(cat) || HEALTH_DB[0];
        _csRenderHealth({
          title: '� Health Tips',
          habits: [{ bad_habit: h.bad, bad_impact: h.bad_impact, good_habit: h.good, good_impact: h.good_impact }],
          tip: h.tip, closing: h.closing,
        });
      }
    },
    facts: {
      caption: '🌌 Did You Know?\n#Facts #Science #UnknownFacts',
      render: () => {
        const cat = document.getElementById('csFactsCategory')?.value || 'random';
        const item = (cat === 'random') ? factsDbRandomAny() : (factsDbRandom(cat) || factsDbRandomAny());
        if (item) {
          _csShowCaption((item.title || '🌌 Did You Know?') + '\n\n' + (item.fact || '') + '\n\n' + (item.wow ? '💡 ' + item.wow : '') + '\n\n' + (item.source ? '📚 Source: ' + item.source : '') + '\n\n#Facts #UnknownFacts #DidYouKnow #Nepal #Knowledge');
          return _csRenderFacts(item);
        }
        _csRenderFacts(null);
      }
    },
    atomic:    { caption: '☢️ Improve 1% Every Day!\nIn 365 days you will be 37x better! 🚀\n#AtomicHabits #Nepal', render: _csRenderAtomic },
    quiz:      { caption: '🧠 Brain Teaser - Write your answer in comments!\n#Quiz #Nepal #Brain', render: _csRenderQuiz },
    success:   { caption: '🏆 Inspirational Success Story!\nNever give up - Keep moving forward!\n#Success #Nepal #Inspiration', render: _csRenderSuccess },
    poll:      { caption: '📊 के तपाईंलाई यो कुरा मन पर्छ?\n\n✅ YES   ❌ NO\n\n#Poll #Nepal #Opinion', render: () => {
      // Pre-fill question if blank
      const qEl = document.getElementById('csPollCaption');
      if (qEl && !qEl.value.trim()) qEl.value = 'के तपाईंलाई यो कुरा मन पर्छ? / Do you agree with this?';
      _csRenderPoll(null);
    }},
  };
  const q = quick[tab];
  if (!q) return;
  _csShowCaption(q.caption);
  _csSetStatus('⭐ Quick template ready!');
  q.render(null);
}

/* -- Main generate -- */
async function csGenerate(tab) {
  _csShowSpinner(true);
  _csSetStatus('🤖 AI is thinking...');

  let prompt = '';
  let renderFn = null;
  let aiData = {};

  switch (tab) {
    case 'ad': {
 const product  = document.getElementById('csAdProduct')?.value?.trim() || ' ';
      const tagline  = document.getElementById('csAdTagline')?.value?.trim()  || '';
      const details  = document.getElementById('csAdDetails')?.value?.trim()  || '';
      const location = document.getElementById('csAdLocation')?.value?.trim() || '';
      const contact  = document.getElementById('csAdContact')?.value?.trim()  || '';
      prompt = `Create a flashy, professional Nepali advertisement post for Nepal social media.
Product/Brand: "${product}". Tagline: "${tagline}". Details: ${details}. Location: ${location}. Contact: ${contact}.
Make it highly attractive, use power words, urgency, benefits.
Write:
1. A punchy bold Nepali headline (max 8 words, UPPERCASE style)
2. Catchy Nepali tagline (1 line)
3. Main ad body in Nepali (2-3 lines, benefits/offer)
4. Irresistible CTA in Nepali with urgency (1 line)
5. 6 relevant hashtags in Nepali/English
Format as JSON: { "headline": "...", "tagline": "...", "body": "...", "cta": "...", "hashtags": "..." }`;
      renderFn = _csRenderAd;
      break;
    }
    case 'festival': {
      const festVal = document.getElementById('csFestival')?.value;
      const festName = festVal === 'custom' ? document.getElementById('csFestivalCustom')?.value : festVal;
      const personName = document.getElementById('csFestivalName')?.value?.trim() || '';
      prompt = `Write a warm Nepali festival greeting post for "${festName}".
${personName ? `From: ${personName}` : ''}
Write:
1. Nepali greeting title (festive, max 8 words)
2. Nepali message body (2-3 lines, warm wishes)
3. 5 relevant hashtags
Format as JSON: { "title": "...", "message": "...", "hashtags": "..." }`;
      aiData = { festName, personName };
      renderFn = _csRenderFestival;
      break;
    }
    case 'politician': {
 const name = document.getElementById('csPoliticianName')?.value?.trim() || '';
      const party    = document.getElementById('csPoliticianParty')?.value?.trim()    || '';
 const occasion = document.getElementById('csPoliticianOccasion')?.value?.trim() || ' ';
      prompt = `Create a respectful Nepali political banner caption for ${name} ${party ? '('+party+')' : ''} on occasion: "${occasion}".
Write:
1. Main banner title in Nepali (short, powerful, max 8 words)
2. Subtitle/tagline in Nepali (1-2 lines)
3. 5 hashtags
Format as JSON: { "title": "...", "subtitle": "...", "hashtags": "..." }`;
      aiData = { name, party, occasion };
      renderFn = _csRenderPolitician;
      break;
    }
    case 'quote': {
      const type = document.getElementById('csQuoteType')?.value || 'motivational';
      const personality = document.getElementById('csQuotePersonality')?.value?.trim() || '';
      const customText  = document.getElementById('csQuoteCustomText')?.value?.trim() || '';
      const topic = document.getElementById('csQuoteTopic')?.value?.trim() || 'success';
      if (type === 'custom' && customText) {
        const translated = await _csCallAI(`Translate this quote accurately to Nepali Devanagari, keeping it grammatically correct and natural: "${customText}". Return only the Nepali translation, nothing else.`);
        const nepaliQuote = translated?.trim() || customText;
        const creatorName = document.getElementById('csQuoteCreatorName')?.value?.trim() || '';
        _csShowSpinner(false);
        _csShowCaption(`"${nepaliQuote}"${creatorName ? '\n— ' + creatorName : ''}\n#Nepal #Motivation`);
        _csSetStatus('✅ Custom quote translated!');
        _csRenderQuote({ quote: nepaliQuote, author: creatorName });
        return;
      }
      prompt = `Generate ${type === 'famous' && personality ? 'a real famous quote by ' + personality : 'a ' + type} quote about "${topic}" in Nepali (Devanagari script). The quote must be grammatically correct, naturally articulated Nepali.
${type === 'famous' && personality ? `The author is ${personality}. Provide their name in Nepali Devanagari and also in English.` : ''}
${type === 'anonymous' ? 'This is an anonymous quote — set author as "अज्ञात" and authorEn as "Anonymous".' : ''}
Respond ONLY as JSON with these exact keys:
{ "quote": "<Nepali quote text>", "author": "<author in Nepali or empty>", "authorEn": "<author in English or empty>", "explanation": "<1-line Nepali explanation of why it matters>", "hashtags": "#Nepal #Motivation #Quote #Nepali #Inspiration" }`;
      renderFn = _csRenderQuote;
      break;
    }
    case 'health': {
      const topic    = document.getElementById('csHealthTopic')?.value?.trim() || '';
      const audience = document.getElementById('csHealthAudience')?.value || 'general';
      const audienceLabel = { general:'सबैका लागि', elderly:'वृद्धवृद्धाका लागि', youth:'युवाहरूका लागि', mothers:'आमाहरूका लागि' }[audience] || 'सबैका लागि';
      prompt = `तपाईं एक स्वास्थ्य विशेषज्ञ हुनुहुन्छ। "${topic}" बारे ${audienceLabel} एउटा स्वास्थ्य बानीको पोस्ट बनाउनुस् — एउटा नराम्रो बानी र एउटा राम्रो बानी।

JSON मात्र फर्काउनुस् (कुनै markdown नभई):
{
  "title": "इमोजीसहित आकर्षक नेपाली शीर्षक (अधिकतम ८ शब्द)",
  "habits": [
    {
      "bad_habit": "मानिसहरूले गर्ने नराम्रो बानी (१-२ वाक्य)",
      "bad_impact": "त्यो बानीले गर्ने नोक्सान (१-२ वाक्य)",
      "good_habit": "राम्रो विकल्प बानी (१-२ वाक्य)",
      "good_impact": "राम्रो बानीले ल्याउने फाइदा (१-२ वाक्य)"
    }
  ],
  "tip": "एउटा छोटो व्यावहारिक सुझाव",
  "closing": "छोटो प्रेरणादायी बन्द वाक्य",
  "hashtags": "#Nepal #Health #Wellness #Nepali #HealthTips"
}`;
      aiData = { topic };
      renderFn = _csRenderHealth;
      break;
    }
    case 'facts': {
      const category = document.getElementById('csFactsCategory')?.value || 'random';
      const specific = document.getElementById('csFactsTopic')?.value?.trim() || '';
      const categoryLabels = {
        space:'space & astronomy', 'human-body':'human body & anatomy', universe:'universe & cosmology',
        science:'science & physics/chemistry', technology:'technology & AI/computers', nature:'nature & environment',
        ayurveda:'Ayurveda & herbal medicine', religion:'spirituality & religion', finance:'finance & economics',
        history:'world history', psychology:'psychology & behaviour', animals:'animals & wildlife',
        health:'health & biology', time:'time & physics of time', nepal:'Nepal facts & culture',
        random:''
      };
      const domainHint = specific
        ? `specifically about: "${specific}"`
        : (category === 'random'
          ? `from ANY one of these domains (pick randomly): space, human body, universe, science, technology, nature, Ayurveda, spirituality, finance, world history, psychology, animals, health/biology, time — choose the most SURPRISING and UNKNOWN one`
          : `from the domain: ${categoryLabels[category] || category}`);

      const randomSeed = Math.floor(Math.random() * 10000); // force variety
      prompt = `Generate one mind-blowing, little-known (unknown) fact in Nepali (Devanagari script) ${domainHint}. (seed:${randomSeed})
The fact MUST be:
- Scientifically/historically accurate and verified
- Genuinely surprising — not commonly known
- Engaging and shareable on social media

Return ONLY this JSON (no markdown, no extra text):
{ "title": "<emoji> <Nepali attention-grabbing title, max 8 words>", "fact": "<fact in Nepali, 2-3 sentences, detailed and specific>", "wow": "<why it is mind-blowing, 1-2 Nepali sentences>", "source": "<source / reference in English or Nepali>", "hashtags": "#Facts #DidYouKnow #UnknownFacts #Nepal #Knowledge" }`;
      aiData = { category };
      renderFn = _csRenderFacts;
      break;
    }
    case 'atomic': {
 const habit = document.getElementById('csAtomicHabit')?.value?.trim() || ' ';
      const type  = document.getElementById('csAtomicType')?.value || 'build';
      const typeLabel = { build:'build', break:'break bad habit', '1pct':'1% daily improvement', identity:'identity-based change' }[type];
      prompt = `Create an Atomic Habits-inspired post in Nepali about: "${habit}" (focus: ${typeLabel}).
Use James Clear's principles.
Write:
1. Powerful Nepali headline about this habit change (max 8 words)
2. Core insight in Nepali (2-3 sentences)
3. Action step in Nepali (1 concrete daily action)
4. Motivational closing in Nepali (1 line)
5. 5 hashtags
Format as JSON: { "headline": "...", "insight": "...", "action": "...", "closing": "...", "hashtags": "..." }`;
      aiData = { habit };
      renderFn = _csRenderAtomic;
      break;
    }
    case 'quiz': {
      const qtype = document.getElementById('csQuizType')?.value || 'logical';
      const diff  = document.getElementById('csQuizDiff')?.value || 'medium';
      const showAns = document.getElementById('csQuizAnswer')?.value || 'hidden';
      prompt = `Create a ${diff} ${qtype} quiz/puzzle question in Nepali (Devanagari script) for a social media post.
The question should be engaging, shareable, and appropriate for Nepal audience.
Write:
1. The question in Nepali (clear, engaging)
2. 4 multiple choice options in Nepali (A, B, C, D) - only for MCQ types
3. The correct answer
4. Brief explanation in Nepali (why that answer is correct)
5. Engaging call-to-action in Nepali (e.g. " comment - ")
6. 5 hashtags
Format as JSON: { "question": "...", "options": ["A...","B...","C...","D..."], "answer": "...", "explanation": "...", "cta": "...", "hashtags": "...", "show_answer": ${showAns === 'show'} }`;
      renderFn = _csRenderQuiz;
      break;
    }
    case 'success': {
 const person = document.getElementById('csSuccessPerson')?.value?.trim() || ' ';
      const countryVal  = document.getElementById('csSuccessCountry')?.value            || 'nepal';
      const countryName = countryVal === 'custom' ? document.getElementById('csSuccessCountryCustom')?.value?.trim() : countryVal;
      const field       = document.getElementById('csSuccessField')?.value?.trim()       || '';
      const achievement = document.getElementById('csSuccessAchievement')?.value?.trim() || '';
      prompt = `Write an inspiring success story post in Nepali (Devanagari script) about: "${person}" from ${countryName}.
${field ? 'Field: '+field+'.' : ''} ${achievement ? 'Achievement: '+achievement+'.' : ''}
Write:
1. Inspiring Nepali title (max 10 words)
2. Story in Nepali (3-4 sentences: challenge -> journey -> success -> lesson)
3. Key lesson/quote in Nepali (1-2 sentences)
4. Motivational closing in Nepali (1 line)
5. 5 hashtags
Format as JSON: { "title": "...", "story": "...", "lesson": "...", "closing": "...", "hashtags": "..." }`;
      aiData = { person };
      renderFn = _csRenderSuccess;
      break;
    }
    case 'poll': {
      const topic   = document.getElementById('csPollTopic')?.value?.trim() || '';
      const caption = document.getElementById('csPollCaption')?.value?.trim() || '';
      const type    = document.getElementById('csPollType')?.value || 'yesno';
      if (!topic) {
        _csShowSpinner(false);
        _csSetStatus('⚠️ Please enter a Topic/Context above the generate button first!');
        return;
      }
      prompt = `You are a viral Nepali social media content creator. Create a highly specific, engaging poll post about: "${topic}".
${caption ? `Additional context: ${caption}` : ''}
The poll MUST be directly about "${topic}" — do NOT write generic questions.
${type === 'yesno' ? 'It is a YES/NO poll.' : 'Create 4 specific multiple choice options directly about the topic.'}

Rules:
- The question must mention the specific topic/person/event by name
- Write in a mix of Nepali (Devanagari) and English for maximum reach
- Be bold, opinionated and engaging — not neutral

Return ONLY valid JSON (no markdown, no code blocks):
{ "question": "specific poll question mentioning ${topic}", "choices": [${type === 'yesno' ? '"✅ हो / YES","❌ होइन / NO"' : '"choice1","choice2","choice3","choice4"'}], "caption": "2-line engaging caption with emojis", "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5", "imageSearch": "1-4 word Wikipedia image search keyword for ${topic}" }`;
      renderFn = async (aiResult) => {
        // 1. Push AI result into form fields
        if (aiResult?.question) {
          const qEl = document.getElementById('csPollCaption');
          if (qEl) qEl.value = aiResult.question;
        }
        if (aiResult?.choices && type === 'custom') {
          const cEl = document.getElementById('csPollChoices');
          if (cEl) cEl.value = aiResult.choices.join('\n');
        }
        // 2. Render canvas immediately with AI data
        _csRenderPoll(aiResult);
        // 3. Auto-search and load image if no image already uploaded
        const hasImage = _pollImages.length > 0;
        if (!hasImage && aiResult?.imageSearch) {
          _csSetStatus('🖼️ Loading relevant image for "' + aiResult.imageSearch + '"…');
          await _csPollAutoLoadWikiImage(aiResult.imageSearch, topic);
          _csRenderPoll(aiResult);
        }
        _csShowSpinner(false);
        _csSetStatus('🤖 AI Poll generated for: ' + topic);
      };
      break;
    }
  }

  let aiResult = null;
  const rawText = await _csCallAI(prompt);
  if (rawText) {
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      aiResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch { aiResult = null; }
  }

  _csShowSpinner(false);
  if (!aiResult) {
    _csSetStatus(tab === 'poll' ? '❌ AI failed — check your topic and try again.' : '⭐ Quick template ready!');
    if (tab !== 'poll') csQuick(tab);
    return;
  }

  // Poll tab: renderFn is async and manages spinner + status itself
  if (tab === 'poll') {
    renderFn && renderFn(aiResult);
    return;
  }

  _csSetStatus('🤖 AI is thinking...');
  // Build caption from result
  const captionParts = [];
  // Health tab: use styled caption builder
  if (tab === 'health' && aiResult.habits?.[0]) {
    const h0 = aiResult.habits[0];
    const captionStyle = document.getElementById('csHealthCaptionStyle')?.value || 'emoji';
    const habitObj = { bad_habit: h0.bad_habit, bad_impact: h0.bad_impact, good_habit: h0.good_habit, good_impact: h0.good_impact, tip: aiResult.tip, category: '' };
    _csShowCaption(_csHealthBuildCaption(habitObj, captionStyle));
  } else {
    ['headline','title','quote','question'].forEach(k => aiResult[k] && captionParts.push(aiResult[k]));
    ['subtitle','body','message','story','insight','fact','tips','action','closing','explanation','cta'].forEach(k => {
      if (aiResult[k]) captionParts.push(Array.isArray(aiResult[k]) ? aiResult[k].map((t,i) => `${i+1}. ${t}`).join('\n') : aiResult[k]);
    });
    if (aiResult.author) captionParts.push('- ' + aiResult.author);
    if (aiResult.hashtags) captionParts.push('\n' + aiResult.hashtags);
    _csShowCaption(captionParts.join('\n\n'));
  }
  renderFn && renderFn(aiResult);
}

/* ================================================================
   AD HELPER FUNCTIONS
   ================================================================ */

/* -- Live render triggered by form input changes -- */
function csAdLiveRender() {
  _csRenderAd(_adLastData);
}

/* -- Sync text layers from current form inputs (upsert: preserve dragged positions) -- */
function _csAdSyncLayers(accent) {
  const W = _csW, H = _csH;
  const { ctx } = _csGetCanvas();
  const product  = document.getElementById('csAdProduct')?.value?.trim()  || '';
  const tagline  = document.getElementById('csAdTagline')?.value?.trim()  || '';
  const details  = document.getElementById('csAdDetails')?.value?.trim()  || '';
  const location = document.getElementById('csAdLocation')?.value?.trim() || '';
  const contact  = document.getElementById('csAdContact')?.value?.trim()  || '';

  // Helper: get position — use dragged override if exists, else default
  function pos(id, defX, defY) {
    const ov = _adLayerPosOverride[id];
    return ov ? { x: ov.x, y: ov.y } : { x: defX, y: defY };
  }

  _adLayers = [];
  // Always add product as a movable layer (all templates)
  if (product) {
    const ribbonTemplates = ['bold-offer','promo-banner','festive-sale','elegant'];
    const onRibbon = ribbonTemplates.includes(_adTemplate);
    const bi = (_adCanvasBorder && _adCanvasBorder !== 'none') ? _csBorderInset(_adCanvasBorder) : 0;
    // Use shared helper so product Y is always vertically centred inside the ribbon
    let defY;
    if (onRibbon) {
      const rH = _csAdComputeRibbonH(ctx, W, H, bi);
      const productFontSize = _adProductFontSize || Math.round(W * 0.07);
      // Measure actual line count so we can centre the whole text block
      let lines = 1;
      if (product) {
        ctx.save();
        ctx.font = `900 ${productFontSize}px sans-serif`;
        const maxRW = W * 0.88;
        let lineAcc = '';
        product.split(' ').forEach(w => {
          const test = lineAcc ? lineAcc + ' ' + w : w;
          if (ctx.measureText(test).width > maxRW && lineAcc) { lines++; lineAcc = w; } else { lineAcc = test; }
        });
        ctx.restore();
      }
      // Total block height: lineHeight * (lines-1) + fontSize for the last line
      const lineHeight = productFontSize * 1.3;
      const blockH = lineHeight * (lines - 1) + productFontSize;
      // Centre block vertically between borderInset and bottom of ribbon
      defY = bi + Math.round((rH - bi - blockH) / 2);
      defY = Math.max(defY, bi + 4);
    } else {
      defY = H * 0.08;
    }
    const defColor = onRibbon ? '#ffffff' : (accent || '#f59e0b');
    const p = pos('product', W * 0.05, defY);
    _adLayers.push({ id:'product', type:'headline', text: product.toUpperCase(),
      x: p.x, y: p.y, w: W * 0.9, fontSize: _adProductFontSize || Math.round(W * 0.07),
      color: defColor, bold: true, align: 'center', visible: true, badge: false });
  }
  if (tagline) {
    const p = pos('tagline', W*0.05, H*0.19);
    _adLayers.push({ id:'tagline', type:'subtext', text: tagline,
      x: p.x, y: p.y, w: W*0.9, fontSize: Math.round(W*0.042),
      color: '#ffffff', bold: false, align: 'center', visible: true, badge: false });
  }
  if (details) {
    const p = pos('details', W*0.05, H*0.72);
    _adLayers.push({ id:'details', type:'subtext', text: details,
      x: p.x, y: p.y, w: W*0.9, fontSize: Math.round(W*0.033),
      color: 'rgba(255,255,255,0.85)', bold: false, align: 'center', visible: true, badge: false });
  }
  const contactLine = [location ? '📍 '+location : '', contact ? '📞 '+contact : ''].filter(Boolean).join('   ');
  if (contactLine) {
    // Place contact ABOVE the watermark strip (watermark = ~72px tall at 600px, scaled)
    const wScale   = Math.min(W / 600, 1);
    const wmH      = Math.round(34 * Math.max(wScale, 0.65));
    const contactY = H - wmH - Math.round(W * 0.055); // just above watermark
    const p = pos('contact', W*0.04, contactY);
    _adLayers.push({ id:'contact', type:'subtext', text: contactLine,
      x: p.x, y: p.y, w: W*0.92, fontSize: Math.round(W*0.03),
      color: 'rgba(255,255,255,0.9)', bold: false, align: 'center', visible: true, badge: false });
  }
}

/* -- Auto-layout images in the middle zone -- */
function _csAdRebuildImagePositions() {
  const W = _csW, H = _csH;
  const count = _adImages.length;
  if (!count) return;
  const zoneTop = H * 0.26, zoneH = H * 0.44;
  const imgSize = Math.min(Math.floor((W * 0.86) / count) - 10, Math.floor(zoneH * 0.95));
  const totalW  = imgSize * count + 8 * (count - 1);
  let startX    = (W - totalW) / 2;
  _adImages.forEach(item => {
    item.x = startX; item.y = zoneTop + (zoneH - imgSize) / 2;
    item.w = imgSize; item.h = imgSize;
    startX += imgSize + 8;
  });
}

/* -- Setup / refresh canvas pointer-drag for text layers AND images -- */
function _csAdUpdateDragOverlay() {
  const canvas = document.getElementById('csCanvas');
  if (!canvas || canvas._adDragBound) return;
  canvas._adDragBound = true;

  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }

  // Returns {idx, corner:'tl'|'tr'|'bl'|'br'|null} if near a resize handle, else null
  function hitImgHandle(cx, cy) {
    const HANDLE = Math.max(18, _csW * 0.035);
    for (let i = _adImages.length - 1; i >= 0; i--) {
      const im = _adImages[i];
      if (!im.w) continue;
      const corners = { tl:[im.x, im.y], tr:[im.x+im.w, im.y], bl:[im.x, im.y+im.h], br:[im.x+im.w, im.y+im.h] };
      for (const [corner, [hx, hy]] of Object.entries(corners)) {
        if (Math.abs(cx - hx) < HANDLE && Math.abs(cy - hy) < HANDLE) return { idx: i, corner };
      }
    }
    return null;
  }

  function hitImg(cx, cy) {
    for (let i = _adImages.length - 1; i >= 0; i--) {
      const im = _adImages[i];
      if (!im.w) continue;
      if (cx >= im.x && cx <= im.x + im.w && cy >= im.y && cy <= im.y + im.h) return i;
    }
    return -1;
  }

  function hitOverlay(cx, cy) {
    if (!_adOverlay) return false;
    const ov = _adOverlay;
    return Math.hypot(cx - (ov.x + ov.r), cy - (ov.y + ov.r)) <= ov.r + 10;
  }

  // Returns true if near the bottom-right resize handle of the overlay circle
  function hitOverlayHandle(cx, cy) {
    if (!_adOverlay) return false;
    const ov = _adOverlay;
    const hx = ov.x + ov.r * 2, hy = ov.y + ov.r * 2;
    return Math.hypot(cx - hx, cy - hy) <= Math.max(14, _csW * 0.025);
  }

  function hitLayer(cx, cy) {
    for (let i = _adLayers.length - 1; i >= 0; i--) {
      const l = _adLayers[i];
      if (!l.visible || !l.text) continue;
      const lineH  = l.fontSize * 1.3;
      const lines  = Math.max(1, Math.ceil(l.text.length * l.fontSize * 0.55 / l.w));
      const hBound = lineH * lines + l.fontSize;
      if (cx >= l.x - 8 && cx <= l.x + l.w + 8 && cy >= l.y - 8 && cy <= l.y + hBound) return l;
    }
    return null;
  }

  function onDown(e) {
    if (_csTab !== 'ad') return;
    const { x, y } = canvasXY(e);
    _adCanvasFocused = true;

    // 1. Check resize handles first (only if an image is already selected)
    if (_adSelectedImgIdx >= 0) {
      const handle = hitImgHandle(x, y);
      if (handle) {
        e.preventDefault();
        const im = _adImages[handle.idx];
        _adImgDragState = { idx: handle.idx, mode: 'resize', corner: handle.corner,
          ox: x, oy: y, origX: im.x, origY: im.y, origW: im.w, origH: im.h };
        _adAutoLayout = false;
        canvas.style.cursor = 'nwse-resize';
        return;
      }
    }

    // 2. Check overlay (logo) hit — resize handle first, then move
    if (hitOverlayHandle(x, y)) {
      e.preventDefault();
      const ov = _adOverlay;
      _adSelectedImgIdx = -1;
      _adDragState = null;
      _adOverlayDragState = { mode: 'resize', ox: x, oy: y, origR: ov.r, origX: ov.x, origY: ov.y };
      canvas.style.cursor = 'nwse-resize';
      return;
    }
    if (hitOverlay(x, y)) {
      e.preventDefault();
      const ov = _adOverlay;
      _adSelectedImgIdx = -1;
      _adDragState = null;
      _adOverlayDragState = { mode: 'move', ox: x - ov.x, oy: y - ov.y, origR: ov.r };
      canvas.style.cursor = 'grabbing';
      return;
    }

    // 3. Check image body hit
    const imgIdx = hitImg(x, y);
    if (imgIdx >= 0) {
      _adSelectedImgIdx = imgIdx;
      const im = _adImages[imgIdx];
      _adImgDragState = { idx: imgIdx, mode: 'move', ox: x - im.x, oy: y - im.y };
      _adAutoLayout = false;
      canvas.style.cursor = 'grabbing';
      csAdLiveRender();
      return;
    }

    // 4. Check text layer hit
    const layer = hitLayer(x, y);
    if (layer) {
      e.preventDefault();
      _adSelectedImgIdx = -1;
      _adDragState = { layerId: layer.id, ox: x - layer.x, oy: y - layer.y };
      canvas.style.cursor = 'grabbing';
      csAdLiveRender();
      return;
    }

    // 5. Deselect
    _adSelectedImgIdx = -1;
    csAdLiveRender();
  }

  let _adOverlayDragState = null;

  function onMove(e) {
    if (_csTab !== 'ad') { canvas.style.cursor = ''; return; }
    const { x, y } = canvasXY(e);

    if (_adImgDragState) {
      e.preventDefault();
      const ds = _adImgDragState;
      const im = _adImages[ds.idx];
      if (!im) return;
      if (ds.mode === 'move') {
        im.x = x - ds.ox;
        im.y = y - ds.oy;
      } else if (ds.mode === 'resize') {
        const dx = x - ds.ox, dy = y - ds.oy;
        const MIN = 40;
        if (ds.corner === 'br') {
          im.w = Math.max(MIN, ds.origW + dx);
          im.h = Math.max(MIN, ds.origH + dy);
        } else if (ds.corner === 'bl') {
          const nw = Math.max(MIN, ds.origW - dx);
          im.x  = ds.origX + (ds.origW - nw);
          im.w  = nw;
          im.h  = Math.max(MIN, ds.origH + dy);
        } else if (ds.corner === 'tr') {
          im.w  = Math.max(MIN, ds.origW + dx);
          const nh = Math.max(MIN, ds.origH - dy);
          im.y  = ds.origY + (ds.origH - nh);
          im.h  = nh;
        } else if (ds.corner === 'tl') {
          const nw = Math.max(MIN, ds.origW - dx);
          const nh = Math.max(MIN, ds.origH - dy);
          im.x = ds.origX + (ds.origW - nw);
          im.y = ds.origY + (ds.origH - nh);
          im.w = nw; im.h = nh;
        }
      }
      csAdLiveRender();
      return;
    }

    if (_adOverlayDragState) {
      e.preventDefault();
      const ds = _adOverlayDragState;
      if (ds.mode === 'resize') {
        const dx = x - ds.ox, dy = y - ds.oy;
        const delta = (dx + dy) / 2;
        _adOverlay.r = Math.max(16, Math.round(ds.origR + delta));
      } else {
        _adOverlay.x = x - ds.ox;
        _adOverlay.y = y - ds.oy;
      }
      csAdLiveRender();
      return;
    }

    if (_adDragState) {
      e.preventDefault();
      const nx = x - _adDragState.ox;
      const ny = y - _adDragState.oy;
      _adLayerPosOverride[_adDragState.layerId] = { x: nx, y: ny };
      const layer = _adLayers.find(l => l.id === _adDragState.layerId);
      if (layer) { layer.x = nx; layer.y = ny; }
      csAdLiveRender();
      return;
    }

    // Hover cursor
    if (_adSelectedImgIdx >= 0 && hitImgHandle(x, y)) { canvas.style.cursor = 'nwse-resize'; }
    else if (hitOverlayHandle(x, y))  { canvas.style.cursor = 'nwse-resize'; }
    else if (hitOverlay(x, y))  { canvas.style.cursor = 'grab'; }
    else if (hitImg(x, y) >= 0) { canvas.style.cursor = 'grab'; }
    else if (hitLayer(x, y))    { canvas.style.cursor = 'grab'; }
    else                         { canvas.style.cursor = 'default'; }
  }

  function onUp() {
    _adImgDragState = null;
    _adDragState    = null;
    _adOverlayDragState = null;
    canvas.style.cursor = _adSelectedImgIdx >= 0 ? 'grab' : '';
  }

  function onLeave() {
    if (!_adImgDragState && !_adDragState && !_adOverlayDragState) {
      _adCanvasFocused = false;
      if (_csTab === 'ad') csAdLiveRender(); // only re-render when actually on ad tab
    }
    canvas.style.cursor = 'default';
  }

  canvas.addEventListener('pointerdown',   onDown,  { passive: false });
  canvas.addEventListener('pointermove',   onMove,  { passive: false });
  canvas.addEventListener('pointerup',     onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave',  onLeave);
}

/* -- Reset all user-dragged positions back to defaults -- */
function csAdResetPositions() {
  _adLayerPosOverride = {};
  csAdLiveRender();
}

/* -- Set ribbon colour -- */
function csAdRibbonColor(btn, color) {
  _adRibbonColor = color;
  document.getElementById('csAdRibbonSwatches')?.querySelectorAll('.cs-bg-swatch')
    .forEach(b => b.classList.toggle('active', b === btn));
  csAdLiveRender();
}

/* -- Shared helper: compute ribbon height so _csAdSyncLayers & _csAdDrawTemplate always agree -- */
function _csAdComputeRibbonH(ctx, W, H, borderInset) {
  borderInset = borderInset || 0;
  const product = document.getElementById('csAdProduct')?.value?.trim() || '';
  const productFontSize = _adProductFontSize || Math.round(W * 0.07);
  let ribbonLines = 1;
  if (product) {
    ctx.save();
    ctx.font = `900 ${productFontSize}px sans-serif`;
    const maxRW = W * 0.88;
    let lineAcc = '';
    product.split(' ').forEach(w => {
      const test = lineAcc ? lineAcc + ' ' + w : w;
      if (ctx.measureText(test).width > maxRW && lineAcc) { ribbonLines++; lineAcc = w; } else { lineAcc = test; }
    });
    ctx.restore();
  }
  // padding: 8px top + 8px bottom inside ribbon, plus border inset
  const padding = borderInset + Math.round(H * 0.018);
  return Math.max(Math.round(H * 0.1), padding * 2 + productFontSize * ribbonLines);
}

/* -- Set canvas border -- */
function csAdSetBorder(btn, style) {
  _adCanvasBorder = style;
  document.getElementById('csAdBorderBtns')?.querySelectorAll('.cs-radio-btn')
    .forEach(b => b.classList.toggle('active', b === btn));
  csAdLiveRender();
}

/* -- Set product/service name font size -- */
function csAdSetProductFontSize(val) {
  _adProductFontSize = parseInt(val, 10) || 0;
  const label = document.getElementById('csAdProductFontSizeLabel');
  if (label) label.textContent = _adProductFontSize ? _adProductFontSize + 'px' : 'Auto';
  csAdLiveRender();
}

/* -- Toggle image circle/square mode -- */
function csAdImgCircle(el) {
  if (_adSelectedImgIdx >= 0) {
    _adImages[_adSelectedImgIdx].circle = el.checked;
    csAdLiveRender();
  }
}

/* -- Deselect image -- */
function csAdDeselect() {
  _adSelectedImgIdx = -1;
  document.getElementById('csAdImgShapeRow') && (document.getElementById('csAdImgShapeRow').style.display = 'none');
  csAdLiveRender();
}

/* -- Update shape row UI when selection changes -- */
function _csAdUpdateShapeRow() {
  const row = document.getElementById('csAdImgShapeRow');
  const tog = document.getElementById('csAdImgCircleToggle');
  if (!row) return;
  if (_adSelectedImgIdx >= 0 && _adImages[_adSelectedImgIdx]) {
    row.style.display = 'block';
    if (tog) tog.checked = !!_adImages[_adSelectedImgIdx].circle;
  } else {
    row.style.display = 'none';
  }
}

/* -- Remove background from a specific uploaded image -- */
async function csAdRemovePhotoBg(idx) {
  const item = _adImages[idx];
  if (!item) return;
  // Use existing removeBackground() from app.js if available
  if (typeof removeBackground === 'function') {
    _csSetStatus('🚫 Removing background…');
    const canvas2 = document.createElement('canvas');
    canvas2.width = item.img.naturalWidth || item.img.width;
    canvas2.height = item.img.naturalHeight || item.img.height;
    canvas2.getContext('2d').drawImage(item.img, 0, 0);
    const dataUrl = canvas2.toDataURL('image/png');
    try {
      const resultUrl = await removeBackground(dataUrl);
      if (resultUrl) {
        const newImg = new Image();
        newImg.onload = () => { item.img = newImg; item.noBg = true; csAdLiveRender(); _csSetStatus('✅ Background removed!'); };
        newImg.src = resultUrl;
      } else { _csSetStatus('⚠️ Remove BG failed'); }
    } catch(e) { _csSetStatus('⚠️ Remove BG error: ' + e.message); }
  } else {
    // Fallback: local colour-based removal using _localRemoveBackground
    if (typeof _localRemoveBackground === 'function') {
      _csSetStatus('🚫 Removing background (local)…');
      const canvas2 = document.createElement('canvas');
      canvas2.width = item.img.naturalWidth || item.img.width;
      canvas2.height = item.img.naturalHeight || item.img.height;
      canvas2.getContext('2d').drawImage(item.img, 0, 0);
      const dataUrl = canvas2.toDataURL('image/png');
      const resultUrl = await _localRemoveBackground(dataUrl);
      if (resultUrl) {
        const newImg = new Image();
        newImg.onload = () => { item.img = newImg; item.noBg = true; csAdLiveRender(); _csSetStatus('✅ BG removed (local)'); };
        newImg.src = resultUrl;
      }
    } else {
      if (typeof toast === 'function') toast('⚠️ Remove BG requires a Remove.bg API key — configure it in Settings', 'error', 4000);
    }
  }
}

/* -- Remove BG from selected image or all images if none selected -- */
async function csAdRemoveBgSelected() {
  if (_adImages.length === 0) {
    if (typeof toast === 'function') toast('Upload at least one image first', 'error', 2500);
    return;
  }
  if (_adSelectedImgIdx >= 0 && _adImages[_adSelectedImgIdx]) {
    await csAdRemovePhotoBg(_adSelectedImgIdx);
  } else {
    // Apply to all images sequentially
    for (let i = 0; i < _adImages.length; i++) {
      if (!_adImages[i].noBg) await csAdRemovePhotoBg(i);
    }
    _csAdRenderThumbs();
  }
}

/* -- Add product photos -- */
function csAdAddPhotos(input) {
  const files = Array.from(input.files || []);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const idx = _adImages.push({ img, x: 0, y: 0, w: 0, h: 0, circle: false, noBg: false }) - 1;
        _csAdRenderThumbs();
        csAdLiveRender();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

/* -- Render photo thumbnails with remove/delete controls -- */
function _csAdRenderThumbs() {
  const container = document.getElementById('csAdPhotoThumbs');
  if (!container) return;
  container.innerHTML = '';
  _adImages.forEach((item, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'ad-photo-thumb';
    thumb.style.cssText = 'position:relative;display:inline-block;margin:4px 4px 0 0;border-radius:6px;overflow:visible';
    const c = document.createElement('canvas');
    c.width = 54; c.height = 54;
    c.style.cssText = 'width:54px;height:54px;border-radius:6px;display:block;border:2px solid #7c3aed';
    const tCtx = c.getContext('2d');
    tCtx.drawImage(item.img, 0, 0, 54, 54);
    thumb.appendChild(c);
    // Delete button
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Remove photo';
    del.style.cssText = 'position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:#ef4444;color:#fff;font-size:.6rem;cursor:pointer;line-height:1;padding:0;z-index:2';
    del.onclick = () => { _adImages.splice(idx, 1); _csAdRenderThumbs(); csAdLiveRender(); };
    thumb.appendChild(del);
    // Remove BG button
    const rbg = document.createElement('button');
    rbg.textContent = item.noBg ? '✅' : '🚫BG';
    rbg.title = item.noBg ? 'BG removed' : 'Remove background';
    rbg.style.cssText = 'position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:.55rem;padding:1px 5px;border-radius:4px;border:none;background:#1e1b4b;color:#a78bfa;cursor:pointer;z-index:2';
    rbg.onclick = () => csAdRemovePhotoBg(idx);
    thumb.appendChild(rbg);
    container.appendChild(thumb);
  });
}

/* -- Add overlay / logo -- */
function csAdAddOverlay(input) {
  const file = input.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const r = Math.round(_csW * 0.09);
      // Place logo inside the border-safe zone
      const bi = (_adCanvasBorder && _adCanvasBorder !== 'none') ? _csBorderInset(_adCanvasBorder) : 0;
      const safeMargin = Math.max(bi, 14);
      _adOverlay = { img, x: _csW - r*2 - safeMargin, y: safeMargin, r };
      csAdLiveRender();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

/* -- Add extra text layer -- */
function csAdAddTextLayer(type) {
  const W = _csW, H = _csH;
  const isBadge = type === 'badge';
  _adLayers.push({
    id: 'layer_' + Date.now(), type,
    text: type === 'headline' ? 'YOUR HEADLINE' : type === 'badge' ? 'OFFER!' : 'Subtext here',
    x: W*0.05, y: H * (isBadge ? 0.72 : 0.5), w: W*0.9,
    fontSize: isBadge ? Math.round(W*0.05) : Math.round(W*0.04),
    color: '#ffffff', bold: isBadge, align: 'center', visible: true, badge: isBadge
  });
  csAdLiveRender();
}

/* -- Select ad template -- */
function csAdTemplate(btn, tmpl) {
  _adTemplate = tmpl;
  document.getElementById('csAdTemplateGrid')?.querySelectorAll('.ad-tmpl-btn')
    .forEach(b => b.classList.toggle('active', b === btn));
  csAdLiveRender();
}

/* -- AI Enhance: generate improved text via AI for current ad -- */
async function csAdAiEnhance() {
  const product  = document.getElementById('csAdProduct')?.value?.trim();
  if (!product) { if (typeof toast === 'function') toast('Please enter a product name first', 'error', 2500); return; }
  _csShowSpinner(true);
  _csSetStatus('🤖 AI enhancing ad copy...');
  const tagline  = document.getElementById('csAdTagline')?.value?.trim()  || '';
  const details  = document.getElementById('csAdDetails')?.value?.trim()  || '';
  const location = document.getElementById('csAdLocation')?.value?.trim() || '';
  const contact  = document.getElementById('csAdContact')?.value?.trim()  || '';
  const prompt = `Create a highly compelling advertisement for: "${product}". Tagline: "${tagline}". Details: ${details}. Location: ${location}. Contact: ${contact}.
Generate an improved version with:
1. A punchy headline (UPPERCASE, max 8 words)
2. A better tagline/offer (1 line)
3. A short description (1-2 sentences)
Format as JSON: { "headline": "...", "tagline": "...", "body": "..." }`;
  const rawText = await _csCallAI(prompt);
  _csShowSpinner(false);
  if (rawText) {
    try {
      const m = rawText.match(/\{[\s\S]*\}/);
      const r = m ? JSON.parse(m[0]) : null;
      if (r) {
        if (r.headline && document.getElementById('csAdProduct'))  document.getElementById('csAdProduct').value  = r.headline;
        if (r.tagline  && document.getElementById('csAdTagline'))  document.getElementById('csAdTagline').value  = r.tagline;
        if (r.body     && document.getElementById('csAdDetails'))  document.getElementById('csAdDetails').value  = r.body;
        _csSetStatus('✅ Ad copy enhanced!');
        csAdLiveRender();
        return;
      }
    } catch(e) {}
  }
  _csSetStatus('⚠️ AI enhancement failed - try again');
}

/* ================================================================
   MAIN AD RENDERER
   ================================================================ */
function _csRenderAd(data) {
  _adLastData = data;
  const { ctx, W, H } = _csGetCanvas();
  const bg      = _csActiveBg('csAdBgSwatches');
  const isLight = bg === 'white-clean';
  const accent  = isLight ? '#7c3aed' : '#f59e0b';

  // Sync text layers from form inputs (preserve user positions)
  _csAdSyncLayers(accent);
  // Auto-place images in zone between tagline and description
  if (_adImages.length && _adAutoLayout) _csAdRebuildImagePositions();

  const hasBorder = _adCanvasBorder && _adCanvasBorder !== 'none';
  const borderInset = hasBorder ? _csBorderInset(_adCanvasBorder) : 0;

  // 1. Background + template decorations (clipped to inset zone so border never overlaps content)
  ctx.save();
  if (hasBorder) {
    ctx.beginPath();
    ctx.rect(borderInset, borderInset, W - borderInset * 2, H - borderInset * 2);
    ctx.clip();
  }
  _csAdDrawTemplate(ctx, W, H, bg, isLight, accent, borderInset);

 
  // 2. Draw images — or placeholder if none
  if (_adImages.length === 0) {
    const plH = Math.round(H * 0.35), plW = Math.round(W * 0.55);
    const plX = (W - plW) / 2, plY = H * 0.26;
    ctx.save();
    ctx.strokeStyle = accent + '66'; ctx.lineWidth = 2; ctx.setLineDash([6,5]);
    if (ctx.roundRect) ctx.roundRect(plX, plY, plW, plH, 14); else ctx.rect(plX, plY, plW, plH);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = accent + '22';
    if (ctx.roundRect) ctx.roundRect(plX, plY, plW, plH, 14); else ctx.rect(plX, plY, plW, plH);
    ctx.fill();
    ctx.fillStyle = accent + 'bb';
    ctx.font = `${Math.round(W * 0.07)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🖼️', W/2, plY + plH * 0.38);
    ctx.font = `bold ${Math.round(W * 0.032)}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('Upload product photo', W/2, plY + plH * 0.68);
    ctx.restore();
  }
  _adImages.forEach((item, idx) => {
    if (!item.w) return;
    const isSelected = idx === _adSelectedImgIdx;
    ctx.save();
    if (item.circle) {
      ctx.beginPath(); ctx.arc(item.x+item.w/2, item.y+item.h/2, Math.min(item.w,item.h)/2, 0, Math.PI*2); ctx.clip();
      _csAdDrawImg(ctx, item.img, item.x, item.y, item.w, item.h); ctx.restore();
      ctx.save();
      ctx.strokeStyle = isSelected ? '#a78bfa' : accent; ctx.lineWidth = isSelected ? 3 : 4;
      ctx.beginPath(); ctx.arc(item.x+item.w/2, item.y+item.h/2, Math.min(item.w,item.h)/2, 0, Math.PI*2); ctx.stroke();
    } else {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(item.x, item.y, item.w, item.h, 10); else ctx.rect(item.x, item.y, item.w, item.h);
      ctx.clip(); _csAdDrawImg(ctx, item.img, item.x, item.y, item.w, item.h); ctx.restore();
      ctx.save();
      if (isSelected) {
        ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2.5; ctx.setLineDash([5,4]);
        ctx.strokeRect(item.x, item.y, item.w, item.h);
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.lineWidth=2; ctx.strokeRect(item.x, item.y, item.w, item.h);
      }
    }
    // Resize handles on selected image
    if (isSelected && _adCanvasFocused) {
      const HANDLE = Math.max(14, _csW * 0.03);
      [[item.x,item.y],[item.x+item.w,item.y],[item.x,item.y+item.h],[item.x+item.w,item.y+item.h]].forEach(([hx,hy]) => {
        ctx.restore(); ctx.save();
        ctx.fillStyle = '#a78bfa'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, hy, HANDLE/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      });
      // "Crop hint" label
      ctx.restore(); ctx.save();
      ctx.fillStyle = 'rgba(167,139,250,0.85)';
      ctx.font = `bold ${Math.round(_csW*0.022)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('✂ drag corners to resize · drag body to move', item.x + item.w/2, item.y - 6);
    }
    ctx.restore();
  });

  // Separator line below images
  if (_adImages.length) {
    const maxY = Math.max(..._adImages.map(i => i.y+i.h));
    ctx.save(); ctx.strokeStyle=accent+'55'; ctx.lineWidth=1; ctx.setLineDash([4,6]);
    ctx.beginPath(); ctx.moveTo(W*0.08, maxY+8); ctx.lineTo(W*0.92, maxY+8); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }

  // Starburst "SALE/OFFER" badge — shown on festive-sale and promo-banner templates
  if (_adTemplate === 'festive-sale' || _adTemplate === 'promo-banner') {
    const sbR = Math.round(W * 0.11);
    const sbX = W - sbR - 14, sbY = Math.round(H * 0.15);
    const taglineVal = document.getElementById('csAdTagline')?.value?.trim() || '';
    const sbLabel = taglineVal.match(/\d+%/) ? taglineVal.match(/\d+%/)[0] : 'SALE!';
    ctx.save();
    // Draw starburst spikes
    ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    const spikes = 12;
    for (let s = 0; s < spikes * 2; s++) {
      const angle = (s / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = s % 2 === 0 ? sbR : sbR * 0.72;
      const px = sbX + Math.cos(angle) * r, py = sbY + Math.sin(angle) * r;
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // Inner circle
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sbX, sbY, sbR * 0.62, 0, Math.PI * 2); ctx.fill();
    // Label
    ctx.fillStyle = '#dc2626';
    ctx.font = `900 ${Math.round(sbR * 0.52)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sbLabel, sbX, sbY);
    ctx.restore();
  }

  // 3. Overlay logo — drawn INSIDE clip so it respects the inset zone
  // (moved to after ctx.restore() below so border-inset clip never truncates it)

  // 4. Text layers (exact case from input - NO toUpperCase)
  _adLayers.forEach(layer => {
    if (!layer.visible || !layer.text) return;
    ctx.save(); ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=8;
    if (layer.badge) {
      ctx.font = `900 ${layer.fontSize}px sans-serif`;
      const tw = ctx.measureText(layer.text).width;
      const bW = tw + layer.fontSize*1.4, bH = layer.fontSize+20;
      const bX = layer.x + (layer.w-bW)/2;
      ctx.shadowOffsetY=4; ctx.fillStyle=accent; _csRoundRect(ctx, bX, layer.y, bW, bH, bH/2);
      ctx.shadowBlur=0; ctx.shadowOffsetY=0;
      const sheen=ctx.createLinearGradient(bX,layer.y,bX,layer.y+bH/2);
      sheen.addColorStop(0,'rgba(255,255,255,.22)'); sheen.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=sheen; _csRoundRect(ctx, bX, layer.y, bW, bH/2, bH/2);
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(layer.text+' ->', bX+bW/2, layer.y+bH/2);
    } else {
      ctx.font = `${layer.bold?'900':'500'} ${layer.fontSize}px sans-serif`;
      ctx.fillStyle = layer.color; ctx.textAlign = layer.align||'center'; ctx.textBaseline = 'top';
      const tx = layer.align==='center' ? layer.x+layer.w/2 : layer.x;
      const linesDrawn = _csWrapText(ctx, layer.text, tx, layer.y, layer.w, layer.fontSize*1.3);
      // Draw dashed drag-handle outline ONLY when canvas is focused/active
      const isDraggable = ['product','tagline','details','contact'].includes(layer.id);
      if (isDraggable && _adCanvasFocused) {
        ctx.shadowBlur = 0;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(167,139,250,0.55)';
        ctx.lineWidth = 1.5;
        const boxH = layer.fontSize * 1.3 * linesDrawn + 6;
        ctx.strokeRect(layer.x - 4, layer.y - 4, layer.w + 8, boxH + 8);
        ctx.setLineDash([]);
        // Drag icon in top-right corner
        ctx.fillStyle = 'rgba(167,139,250,0.7)';
        ctx.font = `${Math.round(layer.fontSize * 0.55)}px sans-serif`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('✋', layer.x + layer.w + 4, layer.y - 4);
      }
    }
    ctx.restore();
  });

  // End content clip — restore before drawing overlay, watermark and border
  // so they are NEVER truncated by the border-inset clip region
  ctx.restore();

  // 3. Overlay logo (outside clip so it's never cropped by border inset)
  if (_adOverlay) {
    const ov = _adOverlay; ctx.save();
    ctx.shadowColor=accent; ctx.shadowBlur=14; ctx.strokeStyle=accent; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(ov.x+ov.r, ov.y+ov.r, ov.r, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur=0; ctx.beginPath(); ctx.arc(ov.x+ov.r, ov.y+ov.r, ov.r, 0, Math.PI*2); ctx.clip();
    _csAdDrawImg(ctx, ov.img, ov.x, ov.y, ov.r*2, ov.r*2); ctx.restore();
    // Resize handle at bottom-right
    if (_adCanvasFocused) {
      const hx = ov.x + ov.r * 2, hy = ov.y + ov.r * 2;
      ctx.save();
      ctx.beginPath(); ctx.arc(hx, hy, Math.max(7, _csW * 0.013), 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 5;
      ctx.fill();
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.shadowBlur = 0; ctx.stroke();
      ctx.restore();
    }
  }

  // Watermark (outside clip so bottom edge is never cut off by border inset)
  _csWatermark(ctx, W, H);
  // Draw border on top of everything so it is always crisp and fully visible
  if (hasBorder) _csDrawCanvasBorder(ctx, W, H, _adCanvasBorder, accent);
  // Sync shape-row UI
  _csAdUpdateShapeRow();
}

/* -- Template decorative backgrounds -- */
function _csAdDrawTemplate(ctx, W, H, bg, isLight, accent, borderInset) {
  borderInset = borderInset || 0;
  _csDrawBackground(ctx, W, H, bg);
  // Ribbon color: use custom if set, otherwise accent
  const ribbonColor = _adRibbonColor || accent;
  // Use shared helper — same value as _csAdSyncLayers uses
  const ribbonH = _csAdComputeRibbonH(ctx, W, H, borderInset);

  switch (_adTemplate) {
    case 'bold-offer': {
      ctx.save(); ctx.fillStyle=isLight?'rgba(124,58,237,.06)':'rgba(255,255,255,.03)';
      ctx.beginPath(); ctx.moveTo(W*.55,0); ctx.lineTo(W,0); ctx.lineTo(W*.45,H); ctx.lineTo(0,H); ctx.closePath(); ctx.fill(); ctx.restore();
      // Top ribbon (product name rendered as draggable layer)
      const rg=ctx.createLinearGradient(0,0,W,0);
      rg.addColorStop(0, ribbonColor);
      rg.addColorStop(1, isLight ? '#3b82f6' : _adRibbonColor ? ribbonColor+'cc' : '#f97316');
      ctx.fillStyle=rg; ctx.fillRect(0,0,W,ribbonH);
      ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(0,H*.87,W,H*.13); break;
    }
    case 'elegant': {
      ctx.strokeStyle=isLight?'#d97706':ribbonColor+'88'; ctx.lineWidth=3; ctx.strokeRect(10,10,W-20,H-20);
      ctx.lineWidth=1; ctx.strokeRect(18,18,W-36,H-36);
      // Elegant top banner (product name rendered as draggable layer)
      ctx.fillStyle=ribbonColor+'22'; ctx.fillRect(0,0,W,ribbonH);
      ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(0,H*.87,W,H*.13); break;
    }
    case 'split-photo': {
      const pg=ctx.createLinearGradient(0,0,W*.46,H); pg.addColorStop(0,ribbonColor+'cc'); pg.addColorStop(1,ribbonColor+'44');
      ctx.fillStyle=pg; ctx.fillRect(0,0,W*.46,H);
      ctx.fillStyle=isLight?'#f8fafc':'#0a0f1e';
      ctx.beginPath(); ctx.moveTo(W*.42,0); ctx.lineTo(W*.52,0); ctx.lineTo(W*.46,H); ctx.lineTo(W*.36,H); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(0,H*.87,W,H*.13); break;
    }
    case 'promo-banner': {
      ctx.save(); ctx.translate(W/2, H*.5); ctx.globalAlpha=0.1; ctx.fillStyle=ribbonColor;
      ctx.beginPath();
      for(let p=0;p<16;p++){const a=(p/16)*Math.PI*2,r=p%2===0?W*.52:W*.32;p===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}
      ctx.closePath(); ctx.fill(); ctx.restore();
      // Ribbon only — product name rendered as draggable layer
      ctx.fillStyle=ribbonColor; ctx.fillRect(0,0,W,ribbonH);
      ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(0,H*.87,W,H*.13); break;
    }
    case 'minimal': {
      ctx.fillStyle=isLight?'#fff':'#0f172a'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle=ribbonColor; ctx.fillRect(0,0,Math.round(W*.012),H);
      ctx.strokeStyle=ribbonColor+'55'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(W*.012,H*.12); ctx.lineTo(W,H*.12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W*.012,H*.87); ctx.lineTo(W,H*.87); ctx.stroke(); break;
    }
    case 'festive-sale': {
      ctx.save();
      const cc=['#f59e0b','#ef4444','#10b981','#3b82f6','#a855f7'];
      for(let i=0;i<50;i++){
        ctx.fillStyle=cc[i%cc.length]; ctx.globalAlpha=Math.random()*.45+.2;
        const r=Math.random()*5+2;
        ctx.beginPath(); ctx.arc(Math.random()*W, Math.random()*(H*.18), r, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(Math.random()*W, H-Math.random()*(H*.12), r, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
      const ag=ctx.createLinearGradient(0,0,W,0); ag.addColorStop(0,ribbonColor); ag.addColorStop(.5,accent); ag.addColorStop(1,ribbonColor);
      ctx.fillStyle=ag; ctx.fillRect(0,0,W,Math.round(H*.12));
      // Product name rendered as draggable layer
      ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(0,H*.87,W,H*.13); break;
    }
    default: break;
  }
}

/* -- Image draw helper (cover-fill) -- */
function _csAdDrawImg(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth||img.width, ih = img.naturalHeight||img.height;
  if (!iw||!ih) return;
  const s = Math.max(w/iw, h/ih);
  ctx.drawImage(img, x+(w-iw*s)/2, y+(h-ih*s)/2, iw*s, ih*s);
}

/* -- Hide drag overlay when switching tabs -- */
function _csAdHideOverlay() {
  const ov = document.getElementById('csAdDragOverlay');
  if (ov) { ov.style.display = 'none'; ov.style.pointerEvents = 'none'; }
}

/* ══════════════════════════════════════════════════════
   FESTIVAL GREETING DATA & HELPERS
   ══════════════════════════════════════════════════════ */
const _csFestGreetings = {
  dashain: [
    'विजयादशमीको पावन अवसरमा तपाईं र तपाईंको सम्पूर्ण परिवारमा सुख, शान्ति र समृद्धिको हार्दिक कामना। जय माँ दुर्गा! 🙏',
    'असत्यमाथि सत्यको विजयको यस पर्वमा तपाईंको जीवनमा सधैं खुशी र सफलता आओस्। दशैंको हार्दिक शुभकामना! 🎉',
    'Wishing you and your family a very Happy Dashain! May Goddess Durga bless you with health, happiness, and prosperity. Subhakamana! 🙏🌺',
  ],
  tihar: [
    'दीपावलीको दियाको उज्यालोले तपाईंको जीवन सधैं प्रकाशमान रहोस्। यमपञ्चकको मङ्गलमय शुभकामना! 🪔✨',
    'लक्ष्मीमाताको कृपाले तपाईंको घर-परिवार धन-धान्यले सदा भरिपूर्ण रहोस्। तिहारको हार्दिक शुभकामना! 🪔🌸',
    'Happy Diwali & Tihar! May the festival of lights fill your home with joy, prosperity, and love. Wishing you a sparkling celebration! 🪔💛',
  ],
  chhath: [
    'भगवान सूर्य र छठी माइयाको आशीर्वादले तपाईंको परिवारमा सुख र समृद्धि आओस्। छठ पर्वको हार्दिक शुभकामना! 🌅🙏',
    'उदाउँदो सूर्यको किरणले तपाईंको जीवनमा उज्यालो र नयाँ उमंग भरिदियोस्। पावन छठ महापर्वको शुभकामना! 🌅🌸',
  ],
  holi: [
    'रंगहरूको यस पर्वले तपाईंको जीवनमा खुशी र उमंगका रंग भरिदियोस्। होलीको हार्दिक शुभकामना! 🎨🌈',
    'होलीको रंगीन शुभकामना! यो पर्व तपाईंको जीवनमा नयाँ रंग र नयाँ उत्साह ल्याओस्। 🎨💛🌺',
    'Wishing you a colourful and joyful Holi! May this festival of colours bring happiness, love, and laughter into your life. Happy Holi! 🌈🎉',
  ],
  teej: [
    'हरितालिका तीजको पावन अवसरमा सम्पूर्ण महिलावर्गमा सुख, सौभाग्य र मङ्गलको कामना! 💃🌺',
    'पति-पत्नीको माया र सम्बन्ध सदा मजबुत रहोस्। तीजको हार्दिक शुभकामना! 💃🌸',
  ],
  'maghe-sankranti': [
    'घिउ-चाकुको मिठास जस्तै तपाईंको जीवन सधैं मिठो र खुशीमय रहोस्। माघे सङ्क्रान्तिको हार्दिक शुभकामना! 🌾🙏',
    'नयाँ ऋतुको सुरुवातमा नयाँ उमंग र उत्साह आओस्। माघे सङ्क्रान्तिको शुभकामना! 🌾☀️',
  ],
  'buddha-jayanti': [
    'भगवान बुद्धको शान्ति, करुणा र अहिंसाको सन्देश हाम्रो जीवनमा उज्यालो ल्याओस्। बुद्ध जयन्तीको हार्दिक शुभकामना! ☸️🌸',
    'May Lord Buddha\'s teachings of peace, compassion and wisdom guide us toward enlightenment and harmony. Happy Buddha Jayanti! ☸️✨',
  ],
  'new-year': [
    'नयाँ वर्षमा तपाईंको सबै सपना पूरा होस् र जीवनमा सुख-शान्ति आओस्। नयाँ वर्षको हार्दिक मङ्गलमय शुभकामना! 🎆🎉',
    'नयाँ वर्ष २०८२ को हार्दिक शुभकामना! यो नयाँ वर्षले तपाईंको जीवनमा खुशी, स्वास्थ्य र समृद्धि ल्याओस्। 🎆🌟',
    'Wishing you a very Happy New Year! May this new year bring new hope, new beginnings, and endless happiness. Cheers to a bright new year! 🥂🎉',
  ],
  christmas: [
    'प्रभु येशू ख्रीष्टको जन्मोत्सवको यस पावन अवसरमा शान्ति, प्रेम र खुशीको कामना! क्रिसमसको हार्दिक शुभकामना! 🎄⭐',
    'Merry Christmas & Happy New Year! May the spirit of Christmas fill your heart with joy, peace, and love. Wishing you a wonderful holiday season! 🎄🎁⭐',
    'Season\'s Greetings! Wishing you a joyful Christmas and a prosperous New Year. May Santa bring you all the happiness you deserve! 🎅🎄🎁',
  ],
  eid: [
    'अल्लाहको रहमत र बरकत तपाईंको परिवारमा सदा रहोस्। ईदुल फित्र तथा ईदुल अज्हाको हार्दिक मुबारकबाद! ☪️🌙',
    'Eid Mubarak! May Allah bless you and your family with happiness, health, and prosperity. Wishing you a joyous celebration filled with peace and love! ☪️🌙✨',
  ],
  birthday: [
    'तपाईंको यस विशेष दिनमा ढेरै खुशी र माया! ईश्वरले तपाईंलाई दीर्घायु, स्वास्थ्य र सफलता दिनुहोस्। जन्मदिनको हार्दिक शुभकामना! 🎂🎉',
    'Happy Birthday! 🎂 Wishing you a day filled with joy, laughter, and love. May all your dreams come true and this year be your best one yet! 🎁🎈',
    'उमेर बढ्दै जाँदा जीवन झन् सुन्दर र अर्थपूर्ण बन्दै जाओस्। जन्मदिनको खुशीमा हार्दिक बधाई! Happy Birthday! 🎂🌸💐',
  ],
  custom: [
    'यस विशेष अवसरमा तपाईं र तपाईंको परिवारमा सुख, शान्ति र समृद्धि आओस्। हार्दिक शुभकामना! 🙏🎉',
    'Heartfelt greetings on this auspicious occasion! Wishing you joy, peace, and blessings on this special celebration. 🌺✨',
  ],
};

const _csFestThemes = {
  dashain:           { bg0:'#1a0a00', bg1:'#4a1000', bg2:'#8b2500', accent:'#f59e0b', accent2:'#fef08a', emojis:['🎉','🌺','🏔️','⚔️','🎊','🌼','🙏','⭐','🌸','🏵️'], border:'flowers' },
  tihar:             { bg0:'#0c0800', bg1:'#3d1c00', bg2:'#7c3a00', accent:'#fbbf24', accent2:'#fde68a', emojis:['🪔','✨','🌟','💛','🎆','🌸','🪅','⭐','💫','🌼'], border:'diyas' },
  chhath:            { bg0:'#1a0800', bg1:'#7c2d00', bg2:'#c2410c', accent:'#f97316', accent2:'#fed7aa', emojis:['🌅','🌊','☀️','🌸','🌾','🙏','🌺','💧','⭐','🌻'], border:'leaves' },
  holi:              { bg0:'#1a001a', bg1:'#500050', bg2:'#8b1a8b', accent:'#f0abfc', accent2:'#fae8ff', emojis:['🎨','🌈','💛','💚','💙','❤️','💜','🎊','🌸','🎉'], border:'flowers' },
  teej:              { bg0:'#1a0008', bg1:'#7f1d1d', bg2:'#be123c', accent:'#fda4af', accent2:'#ffe4e6', emojis:['💃','🌺','🌹','💗','🌸','🪷','✨','💎','🎀','👗'], border:'flowers' },
  'maghe-sankranti': { bg0:'#0a1a00', bg1:'#14532d', bg2:'#166534', accent:'#84cc16', accent2:'#d9f99d', emojis:['🌾','☀️','🌿','🍃','🌻','🌱','🌄','✨','🙏','🌼'], border:'leaves' },
  'buddha-jayanti':  { bg0:'#0d0d1a', bg1:'#1e1b4b', bg2:'#312e81', accent:'#c7d2fe', accent2:'#e0e7ff', emojis:['☸️','🕯️','🌸','🙏','🪷','🌟','🧘','✨','💫','🌺'], border:'geometric' },
  'new-year':        { bg0:'#000d1a', bg1:'#0c2a4a', bg2:'#0e4a7a', accent:'#38bdf8', accent2:'#e0f2fe', emojis:['🎆','🎇','✨','🥂','🎉','⭐','🌟','💫','🎊','🎈'], border:'stars' },
  christmas:         { bg0:'#001a00', bg1:'#14532d', bg2:'#166534', accent:'#fca5a5', accent2:'#fee2e2', emojis:['🎄','⭐','🎁','❄️','🦌','🎅','🌟','🔔','⛄','✨'], border:'stars' },
  eid:               { bg0:'#001a16', bg1:'#064e3b', bg2:'#065f46', accent:'#6ee7b7', accent2:'#d1fae5', emojis:['☪️','🌙','⭐','✨','🕌','🌟','💚','🎊','🌺','🙏'], border:'geometric' },
  birthday:          { bg0:'#1a001a', bg1:'#831843', bg2:'#9d174d', accent:'#f9a8d4', accent2:'#fce7f3', emojis:['🎂','🎉','🎁','🎈','🌟','🥳','💝','🎊','🎀','✨'], border:'flowers' },
  custom:            { bg0:'#0d0d1a', bg1:'#1e1b4b', bg2:'#2e1065', accent:'#c084fc', accent2:'#ede9fe', emojis:['🎉','🌟','✨','💫','🌸','🎊','🙏','⭐','💐','🎆'], border:'mandala' },
};

function csFestivalChanged(val) {
  const customRow = document.getElementById('csFestivalCustomRow');
  if (customRow) customRow.style.display = val === 'custom' ? '' : 'none';
  // Clear uploaded BG image — it should not carry over to a different occasion
  _festBgImage = null;
  const bgUpload = document.getElementById('csFestBgUpload');
  if (bgUpload) bgUpload.value = '';
  const bgImgName = document.getElementById('csFestBgImgName');
  if (bgImgName) bgImgName.textContent = '';
  const bgImgClear = document.getElementById('csFestBgImgClear');
  if (bgImgClear) bgImgClear.style.display = 'none';
  // Auto-fill banner text for the selected occasion
  const bannerEl = document.getElementById('csFestivalBanner');
  if (bannerEl) {
    const autoNepali = {
      dashain:'दशैंको शुभकामना! 🎉', tihar:'तिहारको शुभकामना! 🪔',
      chhath:'छठ पर्वको शुभकामना! 🌅', holi:'होलीको शुभकामना! 🎨',
      teej:'तीजको शुभकामना! 💃', 'maghe-sankranti':'माघे सङ्क्रान्तिको शुभकामना! 🌾',
      'buddha-jayanti':'बुद्ध जयन्तीको शुभकामना! ☸️', 'new-year':'नयाँ वर्षको शुभकामना! 🎆',
      christmas:'Merry Christmas! 🎄', eid:'ईद मुबारक! ☪️', birthday:'जन्मदिनको शुभकामना! 🎂',
      custom: '',
    };
    bannerEl.value = autoNepali[val] || '';
  }
  _csFestPopulateGreetings(val);
  _csFestPopulateBgGrid(val);
}

let _festGreetFontSize = 30;
function csFestGreetFontSizeChange(val) {
  _festGreetFontSize = parseInt(val) || 30;
  document.getElementById('csFestGreetFontSizeLabel').textContent = _festGreetFontSize;
  csQuick('festival');
}

/* ── Background image upload ── */
let _festBgImage = null;

/* ── Politician logo ── */
let _politicianLogo = null;
// Logo position/size in canvas-space (pixels on the 600×600 canvas)
let _logoX = null, _logoY = null, _logoSize = null;

function _csLogoDefaults() {
  // Place bottom-right by default when logo is first loaded
  _logoSize = Math.round(_csW * 0.13);
  _logoX = _csW - _logoSize - Math.round(_csW * 0.04);
  _logoY = _csH - _logoSize - Math.round(_csH * 0.06);
}

/* Sync the overlay drag-box position/size to match canvas coordinates */
function _csLogoSyncOverlay() {
  const wrap = document.getElementById('csCanvasWrap');
  const box  = document.getElementById('csLogoDragBox');
  const overlay = document.getElementById('csLogoOverlay');
  if (!wrap || !box || !overlay) return;
  const rect = wrap.getBoundingClientRect();
  const scaleX = rect.width  / _csW;
  const scaleY = rect.height / _csH;
  box.style.left   = (_logoX * scaleX) + 'px';
  box.style.top    = (_logoY * scaleY) + 'px';
  box.style.width  = (_logoSize * scaleX) + 'px';
  box.style.height = (_logoSize * scaleY) + 'px';
}

/* Show/hide the overlay based on tab and logo state */
function _csLogoOverlayVisible(show) {
  const overlay = document.getElementById('csLogoOverlay');
  if (overlay) overlay.style.display = show ? '' : 'none';
}

/* ── Drag logic ── */
let _logoDragging = false, _logoDragOX = 0, _logoDragOY = 0;
function csLogoDragStart(e) {
  if (e.target.id === 'csLogoResizeHandle') return; // handled by resize
  e.preventDefault();
  _logoDragging = true;
  const pt = e.touches ? e.touches[0] : e;
  const wrap = document.getElementById('csCanvasWrap').getBoundingClientRect();
  const scaleX = _csW / wrap.width, scaleY = _csH / wrap.height;
  _logoDragOX = (pt.clientX - wrap.left) * scaleX - _logoX;
  _logoDragOY = (pt.clientY - wrap.top)  * scaleY - _logoY;

  const onMove = ev => {
    if (!_logoDragging) return;
    const p = ev.touches ? ev.touches[0] : ev;
    const r = document.getElementById('csCanvasWrap').getBoundingClientRect();
    const sx = _csW / r.width, sy = _csH / r.height;
    _logoX = Math.min(_csW - _logoSize, Math.max(0, (p.clientX - r.left) * sx - _logoDragOX));
    _logoY = Math.min(_csH - _logoSize, Math.max(0, (p.clientY - r.top)  * sy - _logoDragOY));
    _csLogoSyncOverlay();
    csQuick('politician');
  };
  const onUp = () => { _logoDragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, {passive:false});
  document.addEventListener('touchend', onUp);
}

/* ── Resize logic ── */
let _logoResizing = false, _logoResizeOX = 0, _logoResizeOY = 0, _logoResizeOSize = 0;
function csLogoResizeStart(e) {
  e.preventDefault(); e.stopPropagation();
  _logoResizing = true;
  const pt = e.touches ? e.touches[0] : e;
  const wrap = document.getElementById('csCanvasWrap').getBoundingClientRect();
  _logoResizeOX = pt.clientX;
  _logoResizeOY = pt.clientY;
  _logoResizeOSize = _logoSize;
  const scaleX = _csW / wrap.width;

  const onMove = ev => {
    if (!_logoResizing) return;
    const p = ev.touches ? ev.touches[0] : ev;
    const r = document.getElementById('csCanvasWrap').getBoundingClientRect();
    const sx = _csW / r.width;
    const delta = ((p.clientX - _logoResizeOX) + (p.clientY - _logoResizeOY)) / 2 * sx;
    _logoSize = Math.min(_csW * 0.45, Math.max(Math.round(_csW * 0.04), Math.round(_logoResizeOSize + delta)));
    _csLogoSyncOverlay();
    csQuick('politician');
  };
  const onUp = () => { _logoResizing = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, {passive:false});
  document.addEventListener('touchend', onUp);
}

function csPoliticianLoadLogo(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      _politicianLogo = img;
      _csLogoDefaults();   // set default position/size
      document.getElementById('csPoliticianLogoName').textContent = file.name;
      document.getElementById('csPoliticianLogoClear').style.display = '';
      _csLogoOverlayVisible(true);
      csQuick('politician');
      setTimeout(_csLogoSyncOverlay, 50); // sync after canvas renders
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function csPoliticianClearLogo() {
  _politicianLogo = null;
  _logoX = _logoY = _logoSize = null;
  _csLogoOverlayVisible(false);
  document.getElementById('csPoliticianLogoName').textContent = '';
  document.getElementById('csPoliticianLogoClear').style.display = 'none';
  document.getElementById('csPoliticianLogo').value = '';
  csQuick('politician');
}
function csFestLoadBgImage(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      _festBgImage = img;
      document.getElementById('csFestBgImgName').textContent = file.name;
      document.getElementById('csFestBgImgClear').style.display = '';
      csQuick('festival');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function csFestClearBgImage() {
  _festBgImage = null;
  document.getElementById('csFestBgImgName').textContent = '';
  document.getElementById('csFestBgImgClear').style.display = 'none';
  document.getElementById('csFestBgUpload').value = '';
  const first = document.querySelector('#csFestBgGrid .cs-border-btn');
  if (first) first.classList.add('active');
  csQuick('festival');
}

/* ── Photo position ── */
let _festPhotoPos = 'center';
function csFestSetPhotoPos(btn) {
  document.querySelectorAll('#csFestPhotoPos .cs-seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _festPhotoPos = btn.dataset.pos;
  csQuick('festival');
}

/* ── BG variant index ── */
let _festBgVariant = 0;
function _csFestSelectBg(btn, idx) {
  document.querySelectorAll('#csFestBgGrid .cs-border-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _festBgVariant = idx;
  csQuick('festival');
}

const _csFestBgVariants = {
  dashain:         ['🟤 Crimson Gold','🟣 Deep Maroon','🟡 Saffron Orange','🟢 Forest Teal','⚫ Dark Slate'],
  tihar:           ['🟠 Dark Amber','🟡 Golden Night','🔵 Midnight Diya','🟣 Velvet Purple','🟢 Emerald Glow'],
  chhath:          ['🟠 Sunrise Orange','🔴 Deep Dusk','🔵 River Blue','🟤 Terracotta','⚫ Charcoal Night'],
  holi:            ['🌈 Rainbow Splash','🟣 Purple Burst','⚪ Pastel Soft','🔵 Cool Splash','🟤 Warm Earth'],
  teej:            ['🔴 Classic Red','🟣 Rose Pink','🟤 Maroon Floral','🟡 Golden Red','⚫ Deep Noir'],
  'maghe-sankranti':['🟢 Forest Green','🟡 Harvest Gold','🟤 Earth Tone','🔵 Cool Winter','⚫ Dark Green'],
  'buddha-jayanti': ['🔵 Indigo Calm','🟡 Golden Lotus','⚪ White Peace','🟣 Deep Violet','🟢 Jade Serenity'],
  'new-year':       ['🔵 Midnight Blue','🟣 Cosmic Purple','⚫ Dark Firework','🔴 Ruby Night','🟡 Champagne Gold'],
  christmas:        ['🟢 Classic Green','🔴 Red Velvet','⚫ Dark Elegant','🔵 Frosty Blue','🟡 Gold Christmas'],
  eid:              ['🟢 Emerald Night','🔵 Teal Moon','🟣 Royal Purple','🟤 Sand Gold','⚫ Midnight Black'],
  birthday:         ['🟣 Pink Glam','🔵 Party Blue','🟡 Gold Confetti','🔴 Ruby Celebration','🟢 Mint Fresh'],
  custom:           ['🟣 Purple Mystic','🔵 Ocean Blue','⚫ Dark Elegant','🟤 Warm Copper','🟢 Forest Night'],
};

// Per-occasion, per-variant gradient stops [bg0, bg1, bg2]  (5 variants each)
const _csFestBgPalettes = {
  dashain:         [['#1a0500','#5a1200','#a01f00'],['#1a0012','#4a0530','#8b1260'],['#1a0d00','#7a3000','#c26000'],['#001a12','#004a30','#007a50'],['#0a0a0a','#1e1e2e','#30304a']],
  tihar:           [['#0c0800','#3d1c00','#7c3a00'],['#0d0a00','#554000','#a07800'],['#000820','#001a4a','#002a7a'],['#0d001a','#350045','#600080'],['#001a0a','#004520','#007040']],
  chhath:          [['#1a0800','#7c2d00','#c2410c'],['#1a0000','#5c0808','#a01010'],['#00081a','#002550','#003d80'],['#1a0800','#5c2800','#8c4810'],['#0a0a0a','#1e1e1e','#302e2a']],
  holi:            [['#0a001a','#2e0055','#5b009e'],['#1a001a','#500050','#8b1a8b'],['#f0e6ff','#e0c8ff','#cba8ff'],['#001a2e','#003060','#005090'],['#1a0d00','#5c3000','#9a5a10']],
  teej:            [['#1a0008','#7f1d1d','#be123c'],['#1a0018','#600040','#a0006a'],['#1a0008','#5c0018','#960030'],['#1a0e00','#6a3800','#b06000'],['#050005','#1a001a','#2e0030']],
  'maghe-sankranti':[['#0a1a00','#14532d','#166534'],['#1a1200','#6a4a00','#a07800'],['#0d0800','#3d2000','#6a3c00'],['#001018','#003040','#005568'],['#001500','#003500','#005500']],
  'buddha-jayanti': [['#0d0d1a','#1e1b4b','#312e81'],['#0d0d00','#2d2a00','#5a5000'],['#0d0d0d','#1e1e1e','#2e2e2e'],['#0d0020','#200060','#3800a0'],['#001a10','#003525','#005a3a']],
  'new-year':       [['#000d1a','#0c2a4a','#0e4a7a'],['#0d001a','#2e0060','#5500b0'],['#000000','#0a001a','#14003a'],['#1a0000','#4a0808','#800010'],['#0d0a00','#3a3000','#6a5500']],
  christmas:        [['#001a00','#14532d','#166534'],['#1a0000','#5c0808','#901010'],['#050505','#101010','#1a1a1a'],['#00101a','#002a4a','#003d70'],['#1a1000','#4a3000','#7a5200']],
  eid:              [['#001a16','#064e3b','#065f46'],['#001a1a','#003d3d','#006060'],['#0d001a','#280040','#480070'],['#1a1000','#4a3000','#7a5a00'],['#000000','#050505','#101010']],
  birthday:         [['#1a001a','#831843','#9d174d'],['#001a2e','#003d6a','#0060a0'],['#1a1200','#5c4200','#a07000'],['#1a0000','#5c0808','#901010'],['#001a0a','#004520','#007040']],
  custom:           [['#0d0d1a','#1e1b4b','#2e1065'],['#001a20','#003050','#005080'],['#050505','#0f0f0f','#1a1a1a'],['#1a0a00','#4a2500','#7a4200'],['#001a10','#003525','#005a3a']],
};

function _csFestGetPalette(festVal) {
  const palettes = _csFestBgPalettes[festVal] || _csFestBgPalettes.custom;
  return palettes[_festBgVariant % palettes.length];
}

function _csFestPopulateBgGrid(val) {
  const grid = document.getElementById('csFestBgGrid');
  if (!grid) return;
  const labels = _csFestBgVariants[val] || _csFestBgVariants.custom;
  grid.style.gridTemplateColumns = `repeat(${labels.length},1fr)`;
  grid.innerHTML = labels.map((lbl, i) =>
    `<button class="cs-border-btn${i===_festBgVariant?' active':''}" onclick="_csFestSelectBg(this,${i})" style="font-size:10px;padding:5px 2px;">${lbl}</button>`
  ).join('');
  _festBgVariant = 0;
}

function _csFestPopulateGreetings(val) {
  const sel = document.getElementById('csFestivalGreeting');
  const ta  = document.getElementById('csFestivalGreetingCustom');
  if (!sel) return;
  const list = _csFestGreetings[val] || _csFestGreetings.custom;
  sel.innerHTML = list.map((g,i)=>`<option value="${i}">Greeting ${i+1}</option>`).join('') + '<option value="custom">✍️ Write manually…</option>';
  if (ta) ta.value = list[0] || '';
  sel._greetList = list;
}

function csFestivalGreetingChange(idx) {
  const sel = document.getElementById('csFestivalGreeting');
  const ta  = document.getElementById('csFestivalGreetingCustom');
  if (!ta || !sel) return;
  if (idx === 'custom') { ta.value = ''; ta.focus(); return; }
  const list = sel._greetList || (_csFestGreetings[document.getElementById('csFestival')?.value] || _csFestGreetings.custom);
  ta.value = list[parseInt(idx)] || '';
}

/* Draw scattered emoji/symbols as background decoration */
function _csFestDrawDecorEmojis(ctx, W, H, emojis, count) {
  ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const zones = [ // avoid center portrait area
    [0,0,W*0.22,H], [W*0.78,0,W*0.22,H],
    [W*0.22,0,W*0.56,H*0.08], [W*0.22,H*0.92,W*0.56,H*0.08],
  ];
  let placed = 0;
  for (let i = 0; placed < count; i++) {
    const zi = i % zones.length;
    const [zx,zy,zw,zh] = zones[zi];
    const seed1 = (i*2654435761)>>>0, seed2 = (i*2246822519)>>>0;
    const x = zx + (seed1 % Math.max(1,Math.round(zw)));
    const y = zy + (seed2 % Math.max(1,Math.round(zh)));
    const sz = 16 + (i % 4) * 10;
    const alpha = 0.10 + (i % 5) * 0.07;
    ctx.globalAlpha = alpha;
    ctx.font = `${sz}px serif`;
    ctx.fillText(emojis[i % emojis.length], x, y);
    placed++;
  }
  ctx.restore();
}

/* Draw small twinkling star-cross motifs */
function _csFestDrawStarField(ctx, W, H, color, count) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  for (let i = 0; i < count; i++) {
    const s1 = (i * 1664525 + 1013904223) >>> 0;
    const s2 = (s1 * 22695477 + 1) >>> 0;
    const x = s1 % W, y = s2 % H;
    const r = (i % 3) + 1;
    const a = 0.15 + (i % 5) * 0.09;
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.moveTo(x-r,y); ctx.lineTo(x+r,y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x,y-r); ctx.lineTo(x,y+r); ctx.stroke();
  }
  ctx.restore();
}

/* Draw diya flame decorations for Tihar */
function _csFestDrawDiyas(ctx, W, H) {
  ctx.save();
  const positions = [[W*0.08,H*0.82],[W*0.18,H*0.88],[W*0.82,H*0.82],[W*0.92,H*0.86],
                     [W*0.05,H*0.55],[W*0.95,H*0.55],[W*0.13,H*0.3],[W*0.87,H*0.3]];
  for (const [dx,dy] of positions) {
    const r = W*0.022;
    // bowl
    ctx.beginPath(); ctx.arc(dx, dy+r*0.3, r, 0, Math.PI); ctx.closePath();
    ctx.fillStyle = '#92400e'; ctx.globalAlpha = 0.6; ctx.fill();
    // flame
    const fg = ctx.createRadialGradient(dx, dy-r*0.5, 0, dx, dy, r*1.3);
    fg.addColorStop(0,'rgba(255,255,150,0.9)'); fg.addColorStop(0.5,'rgba(255,120,0,0.6)'); fg.addColorStop(1,'rgba(255,50,0,0)');
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = fg; ctx.beginPath();
    ctx.ellipse(dx, dy-r*0.4, r*0.4, r*1.1, 0, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

/* Draw color-splash blobs for Holi */
function _csFestDrawHoliSplashes(ctx, W, H, opacity) {
  ctx.save();
  const alpha = opacity ?? 0.55;
  const splashColors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#06b6d4'];
  const blobs = [
    [W*0.05,H*0.1,W*0.14],[W*0.9,H*0.08,W*0.12],[W*0.02,H*0.7,W*0.11],
    [W*0.92,H*0.75,W*0.13],[W*0.5,H*0.97,W*0.10],[W*0.08,H*0.45,W*0.09],
    [W*0.93,H*0.42,W*0.10],[W*0.25,H*0.04,W*0.08],[W*0.75,H*0.04,W*0.08],
    [W*0.18,H*0.88,W*0.07],[W*0.82,H*0.9,W*0.07],[W*0.5,H*0.05,W*0.06],
  ];
  blobs.forEach(([bx,by,br],i) => {
    const g = ctx.createRadialGradient(bx,by,0,bx,by,br);
    g.addColorStop(0, splashColors[i%splashColors.length]+'ee');
    g.addColorStop(1, splashColors[i%splashColors.length]+'00');
    ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(bx,by,br,br*0.65,(i*0.45),0,Math.PI*2); ctx.fill();
  });
  ctx.restore();
}

/* Draw snowflakes for Christmas / New Year */
function _csFestDrawSnow(ctx, W, H) {
  ctx.save(); ctx.fillStyle = '#fff';
  for (let i = 0; i < 60; i++) {
    const s1=(i*1664525+1013904223)>>>0, s2=(s1*22695477+1)>>>0;
    const x=s1%W, y=s2%H, r=(i%3)*1.2+0.8;
    ctx.globalAlpha=0.2+(i%4)*0.1; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

/* Draw crescent + star motifs for Eid */
function _csFestDrawCrescent(ctx, W, H, color) {
  ctx.save();
  [[W*0.1,H*0.1,W*0.06],[W*0.88,H*0.12,W*0.05],[W*0.05,H*0.6,W*0.04],[W*0.94,H*0.55,W*0.04]].forEach(([cx,cy,r]) => {
    ctx.globalAlpha = 0.35; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = 'transparent';
    // cut inner circle to make crescent
    ctx.save(); ctx.globalCompositeOperation='destination-out';
    ctx.globalAlpha=0.35; ctx.beginPath(); ctx.arc(cx+r*0.45,cy-r*0.1,r*0.78,0,Math.PI*2); ctx.fill();
    ctx.restore();
    // star beside
    ctx.globalAlpha=0.3; ctx.fillStyle=color;
    ctx.font=`${Math.round(r*1.4)}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('★',cx+r*1.3,cy-r*0.6);
  });
  ctx.restore();
}

/* ══════════════════════════════════════════════════════
   FESTIVAL RENDERER
   ══════════════════════════════════════════════════════ */
function _csRenderFestival(data) {
  const { ctx, W, H } = _csGetCanvas();
  const festVal  = document.getElementById('csFestival')?.value || 'tihar';
  const theme    = _csFestThemes[festVal] || _csFestThemes.custom;
  const { accent, accent2, emojis } = theme;
  const [bg0, bg1, bg2] = _csFestGetPalette(festVal);

  ctx.clearRect(0, 0, W, H);

  /* ── 1. Background — always draw gradient first ── */
  if (festVal === 'holi' && _festBgVariant === 2) {
    // Pastel soft white base for Holi
    ctx.fillStyle = '#f8f0ff'; ctx.fillRect(0, 0, W, H);
    _csFestDrawHoliSplashes(ctx, W, H, 0.75);
  } else if (festVal === 'holi') {
    // Vivid colour-burst background for Holi — diagonal colour bands
    const holiColors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899'];
    for (let i = 0; i < holiColors.length; i++) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(Math.max(0,(i-0.5)/holiColors.length), 'rgba(0,0,0,0)');
      g.addColorStop(i/holiColors.length, holiColors[i]+'99');
      g.addColorStop(Math.min(1,(i+0.5)/holiColors.length), 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    const bgGrad = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,H*0.6);
    bgGrad.addColorStop(0, bg2+'88'); bgGrad.addColorStop(1, bg0+'cc');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
    _csFestDrawHoliSplashes(ctx, W, H, 0.6);
  } else {
    const bgGrad = ctx.createRadialGradient(W*0.3, H*0.2, 0, W*0.5, H*0.5, H*0.9);
    bgGrad.addColorStop(0, bg2); bgGrad.addColorStop(0.55, bg1); bgGrad.addColorStop(1, bg0);
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  }

  // If user uploaded a BG image, draw it on top as a soft watermark overlay
  if (_festBgImage) {
    const iw = _festBgImage.naturalWidth || _festBgImage.width;
    const ih = _festBgImage.naturalHeight || _festBgImage.height;
    const s  = Math.max(W / iw, H / ih);
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.drawImage(_festBgImage, (W - iw*s)/2, (H - ih*s)/2, iw*s, ih*s);
    ctx.restore();
  }

  /* ── 2. Occasion art ── */
  if (festVal === 'tihar' || festVal === 'chhath') {
    _csFestDrawDiyas(ctx, W, H);
  } else if (festVal === 'christmas' || festVal === 'new-year') {
    _csFestDrawSnow(ctx, W, H);
  } else if (festVal === 'eid') {
    _csFestDrawCrescent(ctx, W, H, accent);
  }
  if (festVal !== 'holi') _csFestDrawHoliSplashes; // skip for non-holi

  /* ── 3. Emoji decorations + sparkle ── */
  _csFestDrawDecorEmojis(ctx, W, H, emojis, 26);
  _csFestDrawStarField(ctx, W, H, accent2, 55);

  /* ── 4. Centre glow ── */
  const glow = ctx.createRadialGradient(W/2, H*0.4, 0, W/2, H*0.4, W*0.5);
  glow.addColorStop(0,'rgba(255,255,255,0.07)'); glow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  /* ── 5. Decorative border — disabled ── */

  /* ── 6. Layout constants ── */
  const bi          = Math.round(W * 0.045); // border inset safe margin
  const photo       = _csPhotos['festival'];
  const photoPos    = _festPhotoPos || 'center';
  const photoSize   = Math.round(Math.min(W, H) * 0.26);
  // For bottom positions: photo goes to bottom corner, text uses full width
  const isBottomPos = photoPos === 'bottom-left' || photoPos === 'bottom-right';

  /* ── 7. Content layout: determine text column ── */
  let textX, textW, textAlign;
  if (isBottomPos && photo) {
    // Text spans full canvas width, photo placed in corner below
    textX     = W / 2;
    textW     = W * 0.82;
    textAlign = 'center';
  } else {
    textX     = W / 2;
    textW     = W * 0.82;
    textAlign = 'center';
  }

  /* ── 8. Top photo (centre-top position) ── */
  const photoTop = bi + Math.round(H * 0.04);
  if (photo && !isBottomPos) {
    const px = (W - photoSize) / 2;
    ctx.save();
    for (let r = 3; r >= 0; r--) {
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.08 + r * 0.07; ctx.lineWidth = 8 - r * 1.5;
      ctx.beginPath(); ctx.arc(W/2, photoTop + photoSize/2, photoSize/2 + 8 + r*8, 0, Math.PI*2); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = accent; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(W/2, photoTop + photoSize/2, photoSize/2 + 5, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    _csDrawPhoto(ctx, photo, px, photoTop, photoSize, photoSize, true, 'festival');
    ctx.save(); ctx.font=`${Math.round(W*0.040)}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.globalAlpha=0.9;
    ctx.fillText(emojis[0], W/2 + photoSize/2*0.68, photoTop + photoSize/2 - photoSize/2*0.68);
    ctx.restore();
  }

  /* ── 9. Content start Y ── */
  const contentTop = (photo && !isBottomPos)
    ? photoTop + photoSize + Math.round(H * 0.035)
    : bi + Math.round(H * 0.10);

  /* ── 10. Ribbon — user-editable banner text, falling back to auto-generated ── */
  const greetingRaw = document.getElementById('csFestivalGreetingCustom')?.value?.trim()
    || data?.message
    || (_csFestGreetings[festVal] || _csFestGreetings.custom)[0];
  // Detect if greeting is primarily English (>50% ASCII words)
  const words       = greetingRaw.split(/\s+/);
  const asciiWords  = words.filter(w => /^[\x00-\x7F]+$/.test(w)).length;
  const isEnglish   = asciiWords / words.length > 0.5;

  const ribbonNepali = {
    dashain:'दशैंको शुभकामना! 🎉', tihar:'तिहारको शुभकामना! 🪔',
    chhath:'छठ पर्वको शुभकामना! 🌅', holi:'होलीको शुभकामना! 🎨',
    teej:'तीजको शुभकामना! 💃', 'maghe-sankranti':'माघे सङ्क्रान्तिको शुभकामना! 🌾',
    'buddha-jayanti':'बुद्ध जयन्तीको शुभकामना! ☸️','new-year':'नयाँ वर्षको शुभकामना! 🎆',
    christmas:'Merry Christmas! 🎄', eid:'ईद मुबारक! ☪️', birthday:'जन्मदिनको शुभकामना! 🎂',
  };
  const ribbonEnglish = {
    dashain:'Happy Dashain! 🎉', tihar:'Happy Tihar & Diwali! 🪔',
    chhath:'Happy Chhath Puja! 🌅', holi:'Happy Holi! 🎨',
    teej:'Happy Teej! 💃', 'maghe-sankranti':'Happy Maghe Sankranti! 🌾',
    'buddha-jayanti':'Happy Buddha Jayanti! ☸️','new-year':'Happy New Year! 🎆',
    christmas:'Merry Christmas! 🎄', eid:'Eid Mubarak! ☪️', birthday:'Happy Birthday! 🎂',
  };
  const ribbonMap  = isEnglish ? ribbonEnglish : ribbonNepali;
  const autoRibbon = festVal === 'custom'
    ? ((document.getElementById('csFestivalCustom')?.value || 'Occasion') + (isEnglish ? ' Greetings! 🎉' : ' को शुभकामना! 🎉'))
    : (ribbonMap[festVal] || 'शुभकामना! 🎉');
  // Use user-edited banner input if not empty, otherwise auto-generate
  const ribbonText = document.getElementById('csFestivalBanner')?.value?.trim() || autoRibbon;

  const badgeH = Math.round(H * 0.068);
  const badgeW = W * 0.82;
  const badgeX = (W - badgeW) / 2;
  const badgeY = contentTop;

  const bgrad = ctx.createLinearGradient(badgeX, 0, badgeX + badgeW, 0);
  bgrad.addColorStop(0,'rgba(0,0,0,0)'); bgrad.addColorStop(0.10, accent+'cc');
  bgrad.addColorStop(0.90, accent+'cc'); bgrad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.save();
  ctx.fillStyle = bgrad;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeH/2);
  else ctx.rect(badgeX, badgeY, badgeW, badgeH);
  ctx.fill();
  let badgeFontSize = Math.round(badgeH * 0.50);
  ctx.font = `bold ${badgeFontSize}px serif`;
  while (ctx.measureText(ribbonText).width > badgeW * 0.88 && badgeFontSize > 11) {
    badgeFontSize--; ctx.font = `bold ${badgeFontSize}px serif`;
  }
  ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 5;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ribbonText, W/2, badgeY + badgeH/2);
  ctx.restore();

  /* ── 11. Decorative line below ribbon ── */
  const lineY = badgeY + badgeH + 8;
  ctx.save();
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.45;
  ctx.beginPath(); ctx.moveTo(W*0.15, lineY); ctx.lineTo(W*0.85, lineY); ctx.stroke();
  ctx.restore();

  /* ── 12. Greeting body text ── */
  const fontSize   = _festGreetFontSize || 30;
  const lineHeight = Math.round(fontSize * 1.52);
  const textStartY = lineY + 14;

  const wrappedLines = [];
  let curLine = '';
  ctx.save();
  ctx.font = `${fontSize}px serif`;
  for (const w of words) {
    const test = curLine ? curLine + ' ' + w : w;
    if (ctx.measureText(test).width > textW && curLine) {
      wrappedLines.push(curLine); curLine = w;
    } else { curLine = test; }
  }
  if (curLine) wrappedLines.push(curLine);

  ctx.fillStyle  = accent2;
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
  ctx.textAlign  = textAlign; ctx.textBaseline = 'top';
  let curY = textStartY;
  for (const line of wrappedLines) {
    ctx.fillText(line, textX, curY); curY += lineHeight;
  }
  ctx.restore();

  /* ── 13. Divider ── */
  const divY = curY + 5;
  ctx.save();
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(W*0.12, divY); ctx.lineTo(W*0.88, divY); ctx.stroke();
  ctx.fillStyle = accent; ctx.globalAlpha = 0.7;
  ctx.save(); ctx.translate(W/2, divY); ctx.rotate(Math.PI/4); ctx.fillRect(-4,-4,8,8); ctx.restore();
  ctx.restore();

  /* ── 14. Person's name (centre position only; bottom-pos name is drawn beside photo in section 15) ── */
  const name = document.getElementById('csFestivalName')?.value?.trim();
  if (name && !isBottomPos) {
    const nameY = H - Math.round(80 * Math.min(W/600,1)) - 14;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
    ctx.fillStyle = accent;
    ctx.font = `bold italic ${Math.round(fontSize * 0.70)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('— ' + name + ' —', W/2, nameY);
    ctx.restore();
  }

  /* ── 15. Bottom-corner photo ── */
  if (photo && isBottomPos) {
    const ringPad  = Math.round(photoSize * 0.18) + 8;
    const margin   = bi + ringPad + 4;
    const px       = photoPos === 'bottom-left' ? margin : W - margin - photoSize;
    const py       = H - margin - photoSize;
    ctx.save();
    for (let r = 2; r >= 0; r--) {
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.10 + r*0.08; ctx.lineWidth = 6 - r*1.5;
      ctx.beginPath(); ctx.arc(px + photoSize/2, py + photoSize/2, photoSize/2 + 6 + r*6, 0, Math.PI*2); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(px + photoSize/2, py + photoSize/2, photoSize/2 + 4, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    _csDrawPhoto(ctx, photo, px, py, photoSize, photoSize, true, 'festival');

    // Name beside the photo (right side for bottom-left photo; left side for bottom-right photo)
    if (name) {
      ctx.save();
      const nameFontSize = Math.round(fontSize * 0.62);
      ctx.font = `bold italic ${nameFontSize}px serif`;
      ctx.fillStyle = accent2;
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
      ctx.textBaseline = 'middle';
      const nameCY = py + photoSize / 2;
      if (photoPos === 'bottom-left') {
        ctx.textAlign = 'left';
        const nameX = px + photoSize + ringPad + 4;
        const maxNameW = W - nameX - bi - 8;
        // wrap name if too long
        const nameWords = name.split(' ');
        let nameLine1 = '', nameLine2 = '';
        for (const nw of nameWords) {
          const test = nameLine1 ? nameLine1 + ' ' + nw : nw;
          if (ctx.measureText(test).width > maxNameW && nameLine1) { nameLine2 += (nameLine2?' ':'')+nw; }
          else { nameLine1 = test; }
        }
        if (nameLine2) {
          ctx.fillText(nameLine1, nameX, nameCY - nameFontSize*0.55);
          ctx.fillText(nameLine2, nameX, nameCY + nameFontSize*0.55);
        } else {
          ctx.fillText('— ' + name + ' —', nameX, nameCY);
        }
      } else {
        ctx.textAlign = 'right';
        const nameX = px - ringPad - 4;
        const maxNameW = nameX - bi - 8;
        const nameWords = name.split(' ');
        let nameLine1 = '', nameLine2 = '';
        for (const nw of nameWords) {
          const test = nameLine1 ? nameLine1 + ' ' + nw : nw;
          if (ctx.measureText(test).width > maxNameW && nameLine1) { nameLine2 += (nameLine2?' ':'')+nw; }
          else { nameLine1 = test; }
        }
        if (nameLine2) {
          ctx.fillText(nameLine1, nameX, nameCY - nameFontSize*0.55);
          ctx.fillText(nameLine2, nameX, nameCY + nameFontSize*0.55);
        } else {
          ctx.fillText('— ' + name + ' —', nameX, nameCY);
        }
      }
      ctx.restore();
    }
    // Emoji corner badge (above circle)
    ctx.save(); ctx.font=`${Math.round(W*0.038)}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.globalAlpha=0.85;
    ctx.fillText(emojis[0], px + photoSize/2 + photoSize*0.45, py - 10);
    ctx.restore();
  }

  _csWatermark(ctx, W, H);
}

/* -- POLITICIAN -- */
function _csRenderPolitician(data) {
  const { ctx, W, H } = _csGetCanvas();
  const bgKey = _csActiveBg('csPoliticianBgSwatches');

  // ── Professional theme palettes ──
  const themes = {
    'navy-gold':       { bg0:'#0a0f2e', bg1:'#1a2a6c', bg2:'#243b8a', accent:'#d4a017', accent2:'#f5d76e', bar:'#d4a017' },
    'gradient-dark':   { bg0:'#0d0d1a', bg1:'#1a1a2e', bg2:'#252540', accent:'#7c3aed', accent2:'#c4b5fd', bar:'#7c3aed' },
    'charcoal-amber':  { bg0:'#111111', bg1:'#1c1c1c', bg2:'#2a2a2a', accent:'#f59e0b', accent2:'#fde68a', bar:'#f59e0b' },
    'burgundy-silver': { bg0:'#1a0008', bg1:'#3b0016', bg2:'#5a0022', accent:'#c0c0c0', accent2:'#e8e8e8', bar:'#c0c0c0' },
    'forest-cream':    { bg0:'#031003', bg1:'#0a2e0a', bg2:'#14532d', accent:'#d4edaa', accent2:'#f0ffd4', bar:'#86c949' },
    'deep-teal':       { bg0:'#001a1e', bg1:'#00292e', bg2:'#065f46', accent:'#5eead4', accent2:'#ccfbf1', bar:'#5eead4' },
    'gradient-gold':   { bg0:'#3a1800', bg1:'#78350f', bg2:'#92400e', accent:'#fbbf24', accent2:'#fef3c7', bar:'#fbbf24' },
    'gradient-red':    { bg0:'#3b0000', bg1:'#7f1d1d', bg2:'#991b1b', accent:'#fca5a5', accent2:'#fee2e2', bar:'#f87171' },
    'nepal-flag':      { bg0:'#001550', bg1:'#003893', bg2:'#003893', accent:'#dc143c', accent2:'#ffe0e6', bar:'#dc143c' },
  };
  const th = themes[bgKey] || themes['navy-gold'];

  // Draw background radial gradient
  const bgGrad = ctx.createRadialGradient(W*0.3, H*0.2, 0, W*0.5, H*0.5, H*0.95);
  bgGrad.addColorStop(0, th.bg2); bgGrad.addColorStop(0.55, th.bg1); bgGrad.addColorStop(1, th.bg0);
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

  // Subtle diagonal stripe pattern
  ctx.save(); ctx.globalAlpha = 0.04;
  for (let x = -H; x < W + H; x += 38) {
    ctx.fillStyle = th.accent;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+20,0); ctx.lineTo(x+20+H,H); ctx.lineTo(x+H,H); ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // Bottom accent bar
  const barH = Math.round(H * 0.038);
  const barGrad = ctx.createLinearGradient(0,0,W,0);
  barGrad.addColorStop(0,'rgba(0,0,0,0)'); barGrad.addColorStop(0.2,th.bar+'dd');
  barGrad.addColorStop(0.8,th.bar+'dd'); barGrad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = barGrad; ctx.fillRect(0, H - barH, W, barH);

  // Thin top accent line
  ctx.fillStyle = th.accent + 'aa'; ctx.fillRect(0, 0, W, 4);

  // ── Photo ──
  const photo = _csPhotos['politician'];
  const photoH = Math.round(H * 0.60);
  const photoW = Math.round(W * 0.44);
  const photoX = W * 0.04;
  const photoY = (H - photoH) / 2;

  if (photo) {
    // Glow behind photo
    ctx.save();
    const glow = ctx.createRadialGradient(photoX+photoW/2, photoY+photoH/2, photoW*0.1, photoX+photoW/2, photoY+photoH/2, photoW*0.7);
    glow.addColorStop(0, th.accent+'33'); glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Draw photo — _csDrawPhoto clips to the fixed rounded-rect and applies pan/zoom inside
    _csDrawPhoto(ctx, photo, photoX, photoY, photoW, photoH, false, 'politician');

    // Accent border around the fixed box
    ctx.save();
    const r = Math.round(photoW * 0.06);
    ctx.strokeStyle = th.accent; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(photoX, photoY, photoW, photoH, r) : ctx.rect(photoX, photoY, photoW, photoH);
    ctx.stroke();
    ctx.restore();
  }

  // ── Text area — vertically centred on the photo ──
  const textX  = photo ? W * 0.52 : W * 0.08;
  const textW  = photo ? W * 0.44 : W * 0.88;
  const textAlign = photo ? 'left' : 'center';
  const textAnchorX = photo ? textX : W / 2;

  const name    = document.getElementById('csPoliticianName')?.value?.trim() || '';
  const party    = document.getElementById('csPoliticianParty')?.value?.trim() || '';
  const occasion  = data?.title || document.getElementById('csPoliticianOccasion')?.value?.trim() || '';
  const message   = document.getElementById('csPoliticianMessage')?.value?.trim() || '';

  // Measure total text block height so we can centre it on the photo
  const nameFontSize     = Math.round(W * 0.056);
  const partyFontSize    = Math.round(W * 0.030);
  const occasionFontSize = Math.round(W * 0.044);
  const msgFontSize      = Math.round(W * 0.028);
  const gap = Math.round(H * 0.018);
  const dividerH = 3 + gap * 2;

  const nameLineH     = Math.round(nameFontSize * 1.25);
  const partyLineH    = party   ? Math.round(partyFontSize * 1.3) + gap : 0;
  const occasionLineH = occasion ? Math.round(occasionFontSize * 1.25) + gap : 0;
  const msgLineH      = message  ? Math.round(msgFontSize * 1.4) * Math.max(1, Math.ceil(message.length / 35)) + gap : 0;

  /* Pre-measure name wrapping to get accurate total height */
  ctx.font = `900 ${nameFontSize}px serif`;
  const nameActualLines = name ? _csWrapTextArray(ctx, name, textW).length : 1;
  const nameActualH = nameLineH * nameActualLines;

  const totalTextH    = nameActualH + gap + partyLineH + dividerH + occasionLineH + msgLineH;

  const blockTopY = photo
    ? Math.max(photoY, photoY + (photoH - totalTextH) / 2)
    : H * 0.18;

  let curY = blockTopY;

  // Party name (above the person's name)
  if (party) {
    ctx.save();
    ctx.font = `bold ${partyFontSize}px sans-serif`;
    ctx.fillStyle = th.accent;
    ctx.textAlign = textAlign; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
    // Wrap if needed
    _csWrapText(ctx, party.toUpperCase(), textAnchorX, curY, textW, Math.round(partyFontSize * 1.3));
    ctx.restore();
    curY += partyLineH;
  }

  // Person name (large, bold)
  ctx.save();
  ctx.font = `900 ${nameFontSize}px serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = textAlign; ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10;
  const nameLines = _csWrapText(ctx, name, textAnchorX, curY, textW, nameLineH);
  ctx.restore();
  curY += nameLineH * nameLines + gap;

  // Accent divider line
  ctx.save();
  const divW = textW * 0.65;
  const divX = photo ? textX : W/2 - divW/2;
  const divGrad = ctx.createLinearGradient(divX, 0, divX + divW, 0);
  divGrad.addColorStop(0, th.accent + 'ff'); divGrad.addColorStop(1, th.accent + '00');
  ctx.fillStyle = divGrad; ctx.fillRect(divX, curY, divW, 3);
  ctx.restore();
  curY += dividerH;

  // Occasion / title
  if (occasion) {
    ctx.save();
    ctx.font = `bold ${occasionFontSize}px serif`;
    ctx.fillStyle = th.accent2;
    ctx.textAlign = textAlign; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
    const occLines = _csWrapText(ctx, occasion, textAnchorX, curY, textW, Math.round(occasionFontSize * 1.3));
    ctx.restore();
    curY += Math.round(occasionFontSize * 1.3) * occLines + gap;
  }

  // Additional message (optional)
  if (message) {
    ctx.save();
    ctx.font = `${msgFontSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.textAlign = textAlign; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 5;
    _csWrapText(ctx, message, textAnchorX, curY, textW, Math.round(msgFontSize * 1.5));
    ctx.restore();
  }

  // ── Logo (optional) — draggable/resizable, position stored in _logoX/_logoY/_logoSize ──
  if (_politicianLogo) {
    if (_logoX === null) _csLogoDefaults();
    const lx = _logoX, ly = _logoY, ls = _logoSize;
    // Soft glow ring
    ctx.save();
    ctx.shadowColor = th.accent + 'cc'; ctx.shadowBlur = 14;
    ctx.strokeStyle = th.accent; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(lx + ls/2, ly + ls/2, ls/2 + 3, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    // Circular clip + draw
    ctx.save();
    ctx.beginPath(); ctx.arc(lx + ls/2, ly + ls/2, ls/2, 0, Math.PI*2); ctx.clip();
    ctx.drawImage(_politicianLogo, lx, ly, ls, ls);
    ctx.restore();
    // Sync overlay handle position after render
    setTimeout(_csLogoSyncOverlay, 0);
  }

  _csWatermark(ctx, W, H);
}

/* -- QUOTE -- */
function _csRenderQuote(data) {
  const { ctx, W, H } = _csGetCanvas();
  const bg = _csActiveBg('csQuoteBgSwatches');
  _csDrawBackground(ctx, W, H, bg);
  const isLight = bg === 'white-clean';

  // Theme accent colours per background
  const themeAccent = {
    'gradient-dark':    ['#60a5fa', '#93c5fd'],
    'gradient-purple':  ['#e879f9', '#d946ef'],
    'gradient-gold':    ['#fde68a', '#fbbf24'],
    'gradient-teal':    ['#5eead4', '#2dd4bf'],
    'gradient-rose':    ['#fda4af', '#fb7185'],
    'gradient-emerald': ['#86efac', '#4ade80'],
    'gradient-indigo':  ['#a5b4fc', '#818cf8'],
    'bokeh':            ['#f0abfc', '#c084fc'],
    'white-clean':      ['#7c3aed', '#4f46e5'],
    'gradient-saffron': ['#fed7aa', '#fdba74'],
  };
  const [accentA, accentB] = themeAccent[bg] || ['#60a5fa', '#93c5fd'];

  const photo    = _csPhotos['quote'];
  const hasPhoto = !!photo;
  const pSize    = Math.round(Math.min(W, H) * 0.18);

  const quote    = data?.quote || document.getElementById('csQuoteSelectedText')?.value?.trim() || '';

  // Resolve author based on quote type
  let author = data?.author ?? null;
  if (author === null || author === undefined) {
    const qType = document.getElementById('csQuoteType')?.value || 'motivational';
    if (qType === 'anonymous') {
      const showName = document.getElementById('csAnonShowName')?.checked !== false;
      const anonName = document.getElementById('csQuoteAnonName')?.value?.trim();
      author = showName ? (anonName || 'Anonymous') : '';
    } else if (qType === 'custom') {
      author = document.getElementById('csQuoteCreatorName')?.value?.trim() || '';
    } else {
      author = document.getElementById('csQuoteSelectedAuthor')?.textContent?.replace(/^—\s*/, '').trim() || '';
    }
  }
  const hasAuthor = !!(author && author.trim());

  // ── Metrics (sizes / gaps) ──
  const quoteFontSize  = Math.round(W * 0.047);
  const quoteLineH     = Math.round(quoteFontSize * 1.45);
  const quoteMaxW      = W * 0.82;
  const dividerGap     = Math.round(H * 0.028);   // space above & below divider
  const photoGap       = Math.round(H * 0.018);   // gap above photo
  const authorFontSize = Math.round(W * 0.036);
  const authorLineH    = Math.round(authorFontSize * 1.5);
  const expFontSize    = Math.round(W * 0.027);
  const expLineH       = Math.round(expFontSize * 1.45);

  // ── PASS 1: measure quote line count without drawing ──
  ctx.font = `italic ${quoteFontSize}px 'Noto Sans Devanagari', Georgia, serif`;
  const quoteText = '\u201C' + (quote || '\u2026') + '\u201D';
  let measLine = '', measLines = 0;
  for (const w of quoteText.split(' ')) {
    const test = measLine ? measLine + ' ' + w : w;
    if (ctx.measureText(test).width > quoteMaxW && measLine) { measLines++; measLine = w; }
    else measLine = test;
  }
  if (measLine) measLines++;
  const quoteBlockH = measLines * quoteLineH;

  // ── Measure explanation lines ──
  let expLines = 0;
  if (data?.explanation) {
    ctx.font = `${expFontSize}px 'Noto Sans Devanagari', sans-serif`;
    let expLine = '';
    for (const w of data.explanation.split(' ')) {
      const test = expLine ? expLine + ' ' + w : w;
      if (ctx.measureText(test).width > W * 0.78 && expLine) { expLines++; expLine = w; }
      else expLine = test;
    }
    if (expLine) expLines++;
  }
  const expBlockH = expLines * expLineH;

  // ── Total content height ──
  const dividerH     = 2;
  const photoBlockH  = hasPhoto ? pSize + photoGap : 0;
  const authorBlockH = hasAuthor ? authorLineH : 0;
  const expTotalH    = expBlockH > 0 ? expBlockH + Math.round(H * 0.015) : 0;
  const photoNameGap = Math.round(H * 0.032); // generous gap between photo and name

  // Divider always rendered — keeps visual consistency
  const totalH = quoteBlockH
    + dividerGap + dividerH + dividerGap
    + photoBlockH
    + (hasPhoto && hasAuthor ? photoNameGap : 0)
    + authorBlockH
    + expTotalH;

  // Usable vertical space — top line will be drawn just above cursor; bottom reserved for watermark
  const topPad    = H * 0.07;
  const bottomPad = H * 0.10;   // leave room for watermark
  const usableH   = H - topPad - bottomPad;

  // Centre the content block vertically in the usable area
  let cursor = topPad + Math.max(0, (usableH - totalH) / 2);

  // ── Decorative: faint giant quote mark ──
  ctx.save();
  ctx.globalAlpha = isLight ? 0.07 : 0.10;
  ctx.fillStyle = accentA;
  ctx.font = `900 ${Math.round(W * 0.55)}px Georgia, serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('\u201C', W * -0.01, H * -0.08);
  ctx.restore();

  // ── Top decorative line — always just above the quote text ──
  const topLineY = cursor - Math.round(H * 0.022);
  const grad1 = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
  grad1.addColorStop(0, 'transparent');
  grad1.addColorStop(0.5, accentA);
  grad1.addColorStop(1, 'transparent');
  ctx.fillStyle = grad1;
  ctx.fillRect(W * 0.1, topLineY, W * 0.8, 2);

  // ── PASS 2: draw quote text ──
  ctx.fillStyle = isLight ? '#1e293b' : '#f1f5f9';
  ctx.font = `italic ${quoteFontSize}px 'Noto Sans Devanagari', Georgia, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  _csWrapText(ctx, quoteText, W / 2, cursor, quoteMaxW, quoteLineH);
  cursor += quoteBlockH;

  // ── Divider — always shown ──
  cursor += dividerGap;
  const gradDiv = ctx.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
  gradDiv.addColorStop(0, accentB + '00');
  gradDiv.addColorStop(0.5, accentA);
  gradDiv.addColorStop(1, accentB + '00');
  ctx.fillStyle = gradDiv;
  ctx.fillRect(W * 0.3, cursor, W * 0.4, dividerH);
  cursor += dividerH + dividerGap;

  // ── Photo circle ──
  if (hasPhoto) {
    cursor += photoGap;
    const cx = W / 2;
    const cy = cursor + pSize / 2;
    ctx.save();
    ctx.shadowColor = accentA;
    ctx.shadowBlur  = 18;
    ctx.strokeStyle = accentA;
    ctx.lineWidth   = 3;
    ctx.beginPath(); ctx.arc(cx, cy, pSize / 2 + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    _csDrawPhoto(ctx, photo, cx - pSize / 2, cy - pSize / 2, pSize, pSize, true, 'quote');
    cursor += pSize;
    if (hasAuthor) cursor += photoNameGap; // generous space between photo and name
  }

  // ── Author name ──
  if (hasAuthor) {
    ctx.fillStyle = accentA;
    ctx.font = `700 ${authorFontSize}px 'Noto Sans Devanagari', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('\u2014 ' + author, W / 2, cursor);
    cursor += authorLineH;
  }

  // ── Explanation ──
  if (data?.explanation) {
    cursor += Math.round(H * 0.015);
    ctx.fillStyle = isLight ? '#64748b' : 'rgba(241,245,249,0.60)';
    ctx.font = `${expFontSize}px 'Noto Sans Devanagari', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    _csWrapText(ctx, data.explanation, W / 2, cursor, W * 0.78, expLineH);
  }

  // ── Bottom decorative line ──
  ctx.fillStyle = grad1;
  ctx.fillRect(W * 0.1, H - H * 0.04 - 2, W * 0.8, 2);

  _csWatermark(ctx, W, H);
}

/* ================================================================
   QUOTE DB UI HELPERS
   ================================================================ */

/* Toggle anonymous name input visibility/enabled state */
function csAnonToggleName(checkbox) {
  const nameInput = document.getElementById('csQuoteAnonName');
  if (!nameInput) return;
  nameInput.disabled = !checkbox.checked;
  nameInput.style.opacity = checkbox.checked ? '1' : '0.35';
}

/* Called when quote category tab changes — loads DB quote cards */
function csQuoteLoadDB() {
  setTimeout(() => {
    const type = document.getElementById('csQuoteType')?.value || 'motivational';
    const isCustom  = type === 'custom';
    const isFamous  = type === 'famous';
    const isAnon    = type === 'anonymous';

    // ── Clear photo from previous category so it doesn't bleed across ──
    _csPhotos['quote']       = null;
    _csPhotoOffsets['quote'] = { dx: 0, dy: 0 };
    _csPhotoZoom['quote']    = 1.0;
    const prevPrev = document.getElementById('csQuotePhotoPreview');
    if (prevPrev) prevPrev.textContent = '';
    const personPhotos = document.getElementById('csQuotePersonPhotos');
    if (personPhotos) personPhotos.innerHTML = '';

    const _qDBRow = document.getElementById('csQuoteDBRow');
    const _qSelRow = document.getElementById('csQuoteSelectedRow');
    const _qFamRow = document.getElementById('csQuoteFamousRow');
    const _qCusRow = document.getElementById('csQuoteCustomRow');
    const _qAnonRow = document.getElementById('csQuoteAnonRow');
    if (_qDBRow)   _qDBRow.style.display   = isCustom ? 'none' : 'block';
    if (_qSelRow)  _qSelRow.style.display  = isCustom ? 'none' : 'block';
    if (_qFamRow)  _qFamRow.style.display  = isFamous ? 'block' : 'none';
    if (_qCusRow)  _qCusRow.style.display  = isCustom ? 'block' : 'none';
    if (_qAnonRow) _qAnonRow.style.display = isAnon   ? 'block' : 'none';

    if (!isCustom) _csQuoteRenderCards(type);
  }, 30);
}

/* Render quote cards from DB */
function _csQuoteRenderCards(type) {
  const list = document.getElementById('csQuoteDBList');
  const countEl = document.getElementById('csQuoteDBCount');
  if (!list) return;

  if (typeof QUOTES_DB === 'undefined') {
    list.innerHTML = '<div style="color:#94a3b8;font-size:.8rem;padding:8px">Quote database loading…</div>';
    return;
  }

  const arr = QUOTES_DB[type] || [];
  countEl && (countEl.textContent = `(${arr.length} quotes)`);

  // Show up to 20 shuffled cards
  const sample = [...arr].sort(() => Math.random() - 0.5).slice(0, 20);

  list.innerHTML = sample.map((item, i) => {
    const isObj    = typeof item === 'object';
    const quoteNp  = isObj ? item.quote  : item;
    const author   = isObj ? item.author : '';
    const authorEn = isObj ? (item.authorEn || '') : '';
    const display  = author ? `${author}${authorEn ? ' ('+authorEn+')' : ''}` : '';
    return `<div class="quote-db-card" onclick="csQuoteSelectCard(this)" 
      data-quote="${quoteNp.replace(/"/g,'&quot;')}" 
      data-author="${(author||'').replace(/"/g,'&quot;')}"
      data-author-en="${(authorEn||'').replace(/"/g,'&quot;')}">
      <div class="quote-db-card-text">${quoteNp}</div>
      ${display ? `<div class="quote-db-card-author">— ${display}</div>` : ''}
    </div>`;
  }).join('');
}

/* User clicks a quote card */
function csQuoteSelectCard(el) {
  document.querySelectorAll('.quote-db-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const q        = el.dataset.quote    || '';
  const author   = el.dataset.author   || '';
  const authorEn = el.dataset.authorEn || '';
  const textEl   = document.getElementById('csQuoteSelectedText');
  const authorEl = document.getElementById('csQuoteSelectedAuthor');
  // Store both on the author element for lang toggle
  if (authorEl) {
    authorEl.dataset.np = author;
    authorEl.dataset.en = authorEn;
    const lang = document.getElementById('csQuoteAuthorLang')?.value || 'np';
    const display = lang === 'en' ? (authorEn || author) : (author || authorEn);
    authorEl.textContent = display ? '— ' + display : '';
  }
  if (textEl) textEl.value = q;
  // Show photo suggestions for famous tab — also fill personality name input
  const type = document.getElementById('csQuoteType')?.value;
  if (type === 'famous' && (author || authorEn)) {
    const nameInput = document.getElementById('csQuotePersonality');
    if (nameInput) nameInput.value = authorEn || author;
    _csQuoteShowPersonPhotos(authorEn || author, author);
  }
  csQuotePreviewUpdate();
}

/* ── Famous person photo suggestions ── */
// Curated Wikimedia Commons thumbnail URLs (public domain / CC)
const _FAMOUS_PHOTOS = {
  'Mahatma Gandhi':        ['https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Mahatma-Gandhi%2C_studio%2C_1931.jpg/220px-Mahatma-Gandhi%2C_studio%2C_1931.jpg','https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Gandhi_spinning.jpg/220px-Gandhi_spinning.jpg'],
  'Albert Einstein':       ['https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/220px-Albert_Einstein_Head.jpg','https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Einstein_1921_by_F_Schmutzer_-_restoration.jpg/220px-Einstein_1921_by_F_Schmutzer_-_restoration.jpg'],
  'Winston Churchill':     ['https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Sir_Winston_Churchill_-_19086236948.jpg/220px-Sir_Winston_Churchill_-_19086236948.jpg'],
  'A.P.J. Abdul Kalam':   ['https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/A._P._J._Abdul_Kalam.jpg/220px-A._P._J._Abdul_Kalam.jpg'],
  'Gautam Buddha':         ['https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Buddhastatue.jpg/220px-Buddhastatue.jpg','https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Seated_Buddha_Amitabha_statue.jpg/220px-Seated_Buddha_Amitabha_statue.jpg'],
  'Nelson Mandela':        ['https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Nelson_Mandela_1994.jpg/220px-Nelson_Mandela_1994.jpg','https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Nelson_Mandela-2008_%28edit%29.jpg/220px-Nelson_Mandela-2008_%28edit%29.jpg'],
  'Abraham Lincoln':       ['https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Abraham_Lincoln_O-77_matte_collodion_print.jpg/220px-Abraham_Lincoln_O-77_matte_collodion_print.jpg'],
  'Martin Luther King Jr.':['https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Martin_Luther_King%2C_Jr..jpg/220px-Martin_Luther_King%2C_Jr..jpg'],
  'Swami Vivekananda':     ['https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Swami_Vivekananda.jpg/220px-Swami_Vivekananda.jpg','https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Vivekananda_Chicago_1893.jpg/220px-Vivekananda_Chicago_1893.jpg'],
  'Dalai Lama':            ['https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Dalailama1_20121014_4639.jpg/220px-Dalailama1_20121014_4639.jpg'],
  'Steve Jobs':            ['https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Steve_Jobs_Headshot_2010-CROP_%28cropped_2%29.jpg/220px-Steve_Jobs_Headshot_2010-CROP_%28cropped_2%29.jpg'],
  'Confucius':             ['https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Confucius_Tang_Dynasty.jpg/220px-Confucius_Tang_Dynasty.jpg'],
  'Laozi':                 ['https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Zhuangzi-Laozi.jpg/220px-Zhuangzi-Laozi.jpg'],
  'Aristotle':             ['https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Aristotle_Altemps_Inv8575.jpg/220px-Aristotle_Altemps_Inv8575.jpg'],
  'Plato':                 ['https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Plato_Silanion_Musei_Capitolini_MC1377.jpg/220px-Plato_Silanion_Musei_Capitolini_MC1377.jpg'],
  'Socrates':              ['https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Socrate_du_Louvre.jpg/220px-Socrate_du_Louvre.jpg'],
  'Benjamin Franklin':     ['https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Benjamin_Franklin_age_16.jpg/220px-Benjamin_Franklin_age_16.jpg'],
  'Henry Ford':            ['https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Henry_ford_1919.jpg/220px-Henry_ford_1919.jpg'],
  'Walt Disney':           ['https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Walt_Disney_1946.JPG/220px-Walt_Disney_1946.JPG'],
  'Eleanor Roosevelt':     ['https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Eleanor_Roosevelt_portrait_1933.jpg/220px-Eleanor_Roosevelt_portrait_1933.jpg'],
  'Napoleon Hill':         ['https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Napoleon_Hill.jpg/220px-Napoleon_Hill.jpg'],
  'Oprah Winfrey':         ['https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Oprah_in_2014.jpg/220px-Oprah_in_2014.jpg'],
  'Helen Keller':          ['https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Helen_Keller_circa_1920.jpg/220px-Helen_Keller_circa_1920.jpg'],
  'Marcus Aurelius':       ['https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/MSR-ra-61-b-1.jpg/220px-MSR-ra-61-b-1.jpg'],
  'Muhammad Ali':          ['https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Muhammad_Ali_NYWTS.jpg/220px-Muhammad_Ali_NYWTS.jpg'],
  'Nelson Mandela':        ['https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Nelson_Mandela_1994.jpg/220px-Nelson_Mandela_1994.jpg'],
  'Bhagat Singh':          ['https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Bhagat_Singh_1929.jpg/220px-Bhagat_Singh_1929.jpg'],
  'Pablo Picasso':         ['https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Pablo_picasso_1.jpg/220px-Pablo_picasso_1.jpg'],
  'Mark Twain':            ['https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Mark_Twain_by_AF_Bradley.jpg/220px-Mark_Twain_by_AF_Bradley.jpg'],
  'Warren Buffett':        ['https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Warren_Buffett_KU_Visit.jpg/220px-Warren_Buffett_KU_Visit.jpg'],
  'Friedrich Nietzsche':   ['https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Nietzsche187a.jpg/220px-Nietzsche187a.jpg'],
  'Dale Carnegie':         ['https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/Dale_Carnegie.jpg/220px-Dale_Carnegie.jpg'],
  'Prithvi Narayan Shah':  ['https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Prithvinarayan.jpg/220px-Prithvinarayan.jpg'],
};

function _csQuoteShowPersonPhotos(authorEn, authorNp) {
  const wrap = document.getElementById('csQuotePersonPhotos');
  if (!wrap) return;

  const displayName = authorEn || authorNp || '';
  if (!displayName) return;

  // Find matching key in curated map (case-insensitive, match on any word)
  const nameLower = displayName.toLowerCase();
  const matchKey = Object.keys(_FAMOUS_PHOTOS).find(k => {
    const kl = k.toLowerCase();
    // exact or partial: "Confucius" matches "confucius" in name, or name contains a word from key
    return kl === nameLower ||
      nameLower.includes(kl) ||
      kl.includes(nameLower) ||
      kl.split(' ').some(w => w.length > 3 && nameLower.includes(w)) ||
      nameLower.split(' ').some(w => w.length > 3 && kl.includes(w));
  });
  const presetPhotos = matchKey ? _FAMOUS_PHOTOS[matchKey] : [];

  // Build the container — preset photos on top, Wikipedia results below
  wrap.innerHTML = `
    <div style="margin-top:8px">
      <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">📸 Photos for <strong style="color:#f59e0b">${displayName}</strong> — click to use, or upload your own above</div>
      <div id="csQuotePhotoGrid" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        ${presetPhotos.map(url => `
          <img src="${url}"
            style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:2px solid rgba(255,255,255,.15);cursor:pointer;transition:border-color .15s;display:none"
            onload="this.style.display='inline-block'"
            onmouseover="this.style.borderColor='#f59e0b'"
            onmouseout="this.style.borderColor='rgba(255,255,255,.15)'"
            onclick="csQuoteUsePersonPhoto(this)"
            title="Click to use this photo"
          >`).join('')}
      </div>
      <div id="csQuoteSearchResults" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        <span style="font-size:11px;color:#94a3b8">� Searching Wikipedia…</span>
      </div>
    </div>`;

  // Always fire Wikipedia search for the best portrait result
  _csQuoteWikiSearch(displayName);
}

function csQuoteUsePersonPhoto(imgEl) {
  const src = imgEl.src;
  const preview = document.getElementById('csQuotePhotoPreview');

  // Helper to store the loaded image into quote slot
  function _store(img) {
    _csPhotos['quote'] = img;
    _csPhotoOffsets['quote'] = { dx: 0, dy: 0 };
    _csPhotoZoom['quote'] = 1.0;
    if (preview) preview.textContent = '✅ Photo loaded';
    csRenderBlank();
  }

  // First try: load WITH crossOrigin (needed for canvas drawImage without taint)
  const img1 = new Image();
  img1.crossOrigin = 'anonymous';
  img1.onload = () => _store(img1);
  img1.onerror = () => {
    // Second try: load WITHOUT crossOrigin so it at least renders on canvas
    // (canvas will be tainted but image is visible)
    const img2 = new Image();
    img2.onload = () => _store(img2);
    img2.onerror = () => {
      // Last resort: fetch as blob to bypass CORS
      fetch(src)
        .then(r => r.blob())
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          const img3 = new Image();
          img3.onload = () => _store(img3);
          img3.src = blobUrl;
        })
        .catch(() => {
          if (preview) preview.textContent = '⚠️ Could not load — please upload manually';
        });
    };
    img2.src = src;
  };
  img1.src = src;
}

/* Called when personality name input changes — re-show photos */
function csQuotePersonalityInput(val) {
  if (val.trim().length > 2) {
    _csQuoteShowPersonPhotos(val.trim(), val.trim());
  }
}

/* Re-search button handler — reads name from personality input */
function csQuoteSearchPhoto() {
  const q = document.getElementById('csQuotePersonality')?.value?.trim();
  if (!q) return;
  // Always rebuild the photo section (ensures containers exist) then search
  _csQuoteShowPersonPhotos(q, q);
}

/* Internal: fetch Wikipedia thumbnail for a name and render into #csQuoteSearchResults */
function _csQuoteWikiSearch(name) {
  const resultsEl = document.getElementById('csQuoteSearchResults');
  if (!resultsEl) return;

  // Strategy 1: direct title lookup
  const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&format=json&pithumbsize=220&origin=*`;
  fetch(apiUrl)
    .then(r => r.json())
    .then(data => {
      const pages = data?.query?.pages || {};
      const imgs = Object.values(pages).filter(p => p.thumbnail).map(p => p.thumbnail.source);
      if (imgs.length) {
        // Strategy 1 succeeded — render and STOP (no further chaining)
        _csQuoteRenderWikiResults(imgs);
        return;
      }
      // Strategy 2: opensearch to find the correct page title
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=3&format=json&origin=*`;
      fetch(searchUrl)
        .then(r => r.json())
        .then(sData => {
          const titles = (sData[1] || []);
          if (!titles.length) {
            const el = document.getElementById('csQuoteSearchResults');
            if (el) el.innerHTML = '<span style="font-size:11px;color:#64748b;font-style:italic">No photos found — upload manually above.</span>';
            return;
          }
          const bestTitle = titles[0];
          const imgUrl2 = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(bestTitle)}&prop=pageimages&format=json&pithumbsize=220&origin=*`;
          fetch(imgUrl2)
            .then(r => r.json())
            .then(data2 => {
              const pages2 = data2?.query?.pages || {};
              const imgs2 = Object.values(pages2).filter(p => p.thumbnail).map(p => p.thumbnail.source);
              const el = document.getElementById('csQuoteSearchResults');
              if (!el) return;
              if (imgs2.length) {
                _csQuoteRenderWikiResults(imgs2);
              } else {
                el.innerHTML = '<span style="font-size:11px;color:#64748b;font-style:italic">No photos found — upload manually above.</span>';
              }
            });
        })
        .catch(() => {
          const el = document.getElementById('csQuoteSearchResults');
          if (el) el.innerHTML = '<span style="font-size:11px;color:#ef4444">Search failed. Please upload photo manually.</span>';
        });
    })
    .catch(() => {
      const el = document.getElementById('csQuoteSearchResults');
      if (el) el.innerHTML = '<span style="font-size:11px;color:#ef4444">Search failed. Please upload photo manually.</span>';
    });
}

function _csQuoteRenderWikiResults(imgs) {
  const resultsEl = document.getElementById('csQuoteSearchResults');
  if (!resultsEl) return;
  resultsEl.innerHTML = imgs.map(url => `
    <img src="${url}"
      style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:2px solid rgba(255,255,255,.15);cursor:pointer;transition:border-color .15s;display:none"
      onload="this.style.display='inline-block'"
      onmouseover="this.style.borderColor='#f59e0b'" onmouseout="this.style.borderColor='rgba(255,255,255,.15)'"
      onclick="csQuoteUsePersonPhoto(this)" title="Click to use">`).join('');
}


/* Shuffle the DB cards */
function csQuoteShuffleDB() {
  const type = document.getElementById('csQuoteType')?.value || 'motivational';
  _csQuoteRenderCards(type);
}

/* Toggle author name language (Nepali / English) */
function csQuoteAuthorLangToggle(btn, lang) {
  document.querySelectorAll('[data-lang-btn]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const hidden = document.getElementById('csQuoteAuthorLang');
  if (hidden) hidden.value = lang;
  const authorEl = document.getElementById('csQuoteSelectedAuthor');
  if (authorEl) {
    const np = authorEl.dataset.np || '';
    const en = authorEl.dataset.en || '';
    const display = lang === 'en' ? (en || np) : (np || en);
    authorEl.textContent = display ? '— ' + display : '';
  }
  csQuotePreviewUpdate();
}

/* Preview update on text input */
function csQuotePreviewUpdate() {
  const q = document.getElementById('csQuoteSelectedText')?.value || '';
  const type = document.getElementById('csQuoteType')?.value || 'motivational';
  let a;
  if (type === 'anonymous') {
    a = 'Anonymous';
  } else if (type === 'custom') {
    a = document.getElementById('csQuoteCreatorName')?.value?.trim() || '';
  } else {
    a = document.getElementById('csQuoteSelectedAuthor')?.textContent?.replace(/^—\s*/, '').trim() || '';
  }
  _csRenderQuote({ quote: q, author: a });
}

/* Use DB quote directly (no AI) */
function csQuoteFromDB() {
  const type = document.getElementById('csQuoteType')?.value || 'motivational';
  if (type === 'custom') {
    const q = document.getElementById('csQuoteCustomText')?.value?.trim() || '';
    const a = document.getElementById('csQuoteCreatorName')?.value?.trim() || '';
    _csRenderQuote({ quote: q, author: a });
    _csShowCaption(`"${q}"${a ? '\n— ' + a : ''}\n\n#Nepal #Nepali #motivation`);
    _csSetStatus('✅ Custom quote rendered!');
    return;
  }
  if (type === 'anonymous') {
    const q = document.getElementById('csQuoteSelectedText')?.value?.trim() || '';
    const anonName = document.getElementById('csQuoteAnonName')?.value?.trim() || 'Anonymous';
    _csRenderQuote({ quote: q, author: anonName });
    _csShowCaption(`"${q}"\n— ${anonName}\n\n#Nepal #Nepali #motivation`);
    _csSetStatus('✅ Anonymous quote rendered!');
    return;
  }

  const q    = document.getElementById('csQuoteSelectedText')?.value?.trim();
  const a    = document.getElementById('csQuoteSelectedAuthor')?.textContent?.replace(/^—\s*/,'').trim() || '';

  if (!q) {
    // pick random from DB
    const item = dbGetRandomQuote(type);
    if (!item) { csQuick('quote'); return; }
    const quoteText = typeof item === 'object' ? item.quote : item;
    const auth      = typeof item === 'object' ? (item.author || '') : '';
    _csRenderQuote({ quote: quoteText, author: auth });
    _csShowCaption(`"${quoteText}"${auth ? '\n— ' + auth : ''}\n\n#Nepal #Nepali #motivation`);
    _csSetStatus('✅ DB quote rendered!');
    return;
  }
  _csRenderQuote({ quote: q, author: a });
  _csShowCaption(`"${q}"${a ? '\n— ' + a : ''}\n\n#Nepal #Nepali #motivation`);
  _csSetStatus('✅ DB quote rendered!');
}

/* Initialize quote DB on tab first open */
(function _initQuoteTab() {
  document.addEventListener('DOMContentLoaded', () => {
    // Load motivational quotes on init
    setTimeout(() => csQuoteLoadDB(), 500);
  });
})();

/* ── HEALTH DB BROWSER ────────────────────────────────────────── */
let _csHealthSelected = null;

function csHealthSelectCat(btn) {
  document.querySelectorAll('#csHealthCatBtns .cs-radio-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('csHealthCategory').value = btn.dataset.val;
  csHealthRenderDB();
}

function csHealthShuffleDB() {
  csHealthRenderDB(true);
}

function csHealthRenderDB(shuffle = false) {
  const cat = document.getElementById('csHealthCategory')?.value || 'all';
  let pool = cat === 'all' ? [...HEALTH_DB] : HEALTH_DB.filter(h => h.category === cat);
  if (shuffle) pool = pool.sort(() => Math.random() - 0.5);
  const countEl = document.getElementById('csHealthDbCount');
  if (countEl) countEl.textContent = `(${pool.length} habits)`;
  const container = document.getElementById('csHealthDbCards');
  if (!container) return;
  container.innerHTML = '';
  pool.forEach((habit, i) => {
    const card = document.createElement('div');
    card.className = 'cs-health-db-card';
    card.dataset.idx = i;
    const catEmoji = { sleep:'😴', exercise:'🏃', diet:'🥗', water:'💧', screen:'📱', stress:'🧘', posture:'🪑', hygiene:'🧼', breathing:'🌬️', mindset:'🧠', addiction:'🚭', digestion:'🫁' }[habit.category] || '💊';
    card.innerHTML = `<div class="cs-health-card-cat">${catEmoji} ${habit.category}</div>
      <div class="cs-health-card-bad">❌ ${habit.bad.length > 70 ? habit.bad.slice(0,70)+'…' : habit.bad}</div>
      <div class="cs-health-card-good">✅ ${habit.good.length > 70 ? habit.good.slice(0,70)+'…' : habit.good}</div>`;
    card.onclick = () => csHealthPickCard(habit, card);
    container.appendChild(card);
  });
}

function csHealthCaptionStyle(btn, style) {
  document.querySelectorAll('#csHealthCaptionStyleBtns .cs-radio-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('csHealthCaptionStyle');
  if (el) el.value = style;
}

function _csHealthBuildCaption(habit, style) {
  const bad  = habit.bad   || habit.bad_habit   || '';
  const good = habit.good  || habit.good_habit  || '';
  const tip  = habit.tip   || '';
  const cat  = habit.category ? habit.category.charAt(0).toUpperCase() + habit.category.slice(1) : 'Health';
  switch (style) {
    case 'bold':
      return `🔴 नराम्रो बानी:\n${bad}\n\n🟢 राम्रो बानी:\n${good}\n\n💡 ${tip}\n\n#Nepal #Health #Wellness`;
    case 'minimal':
      return `❌ ${bad}\n\n✅ ${good}\n\n💡 ${tip}`;
    case 'hashtag':
      return `${good}\n\n💡 ${tip}\n\n#Nepal #NepaliHealth #स्वस्थ_बानी #${cat}Habit #Wellness #HealthTips #NepaliLifestyle #SundayMotivation #DailyHabit #HealthyLiving`;
    case 'emoji':
    default:
      return `🌿 ${cat} स्वस्थ बानी!\n\n❌ नराम्रो: ${bad}\n\n✅ राम्रो: ${good}\n\n💡 टिप्स: ${tip}\n\n#Nepal #Health #Wellness #Nepali #HealthTips`;
  }
}

function csHealthPickCard(habit, cardEl) {
  _csHealthSelected = habit;
  _csHealthResearchActive = false;
  document.querySelectorAll('.cs-health-db-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  const box = document.getElementById('csHealthSelectedBox');
  const prev = document.getElementById('csHealthSelectedPreview');
  if (box && prev) {
    prev.innerHTML = `<b style="color:#f87171">❌ ${habit.bad}</b><br><span style="color:#fca5a5;font-size:11px">⚠️ ${habit.bad_impact}</span><br><br><b style="color:#6ee7b7">✅ ${habit.good}</b><br><span style="color:#a7f3d0;font-size:11px">💚 ${habit.good_impact}</span>`;
    box.style.display = 'block';
  }
  // Render on canvas immediately
  const data = {
    title: `💚 ${habit.category.charAt(0).toUpperCase()+habit.category.slice(1)} Habit`,
    habits: [{ bad_habit: habit.bad, bad_impact: habit.bad_impact, good_habit: habit.good, good_impact: habit.good_impact }],
    tip: habit.tip,
    closing: habit.closing,
  };
  _csRenderHealth(data);
  const captionStyle = document.getElementById('csHealthCaptionStyle')?.value || 'emoji';
  _csShowCaption(_csHealthBuildCaption(habit, captionStyle));
  _csSetStatus('✅ Habit loaded!');
}

/* Called when Health tab opens */
/* ── LATEST RESEARCH TIPS DB ─────────────────────────────────── */
const _HEALTH_RESEARCH_DB = [
  { emoji:'🧠', title:'बिहानको घाम दिमागलाई फाइदाजनक', finding:'हार्वर्ड विश्वविद्यालयको २०२४ को अध्ययनअनुसार बिहान १० मिनेट घाममा बस्दा शरीरको कोर्टिसोल ३०% बढ्छ, जसले सारा दिन एकाग्रता र सम्झनाशक्ति सुधार्छ।', source:'Harvard Health, 2024', category:'mindset' },
  { emoji:'🚶', title:'७,००० पाइला हिँड्दा मुटुको रोग आधा हुन्छ', finding:'JAMA Internal Medicine (२०२४) को रिपोर्टअनुसार दैनिक ७,००० वा सोभन्दा बढी पाइला हिँड्ने मानिसहरूमा मुटुसम्बन्धी मृत्युको जोखिम ५०% कम हुन्छ।', source:'JAMA Internal Medicine, 2024', category:'exercise' },
  { emoji:'💧', title:'खाना अघि पानी पिउँदा तौल घट्छ', finding:'Clinical Nutrition (२०२४): खाना खानुभन्दा ३० मिनेट अघि ५०० मिली पानी पिउँदा क्यालोरी सेवन १३% घट्छ र तौल सन्तुलनमा राख्न मद्दत गर्छ।', source:'Clinical Nutrition, 2024', category:'water' },
  { emoji:'😴', title:'७–९ घण्टा निद्राले दिमाग सफा राख्छ', finding:'Nature Neuroscience (२०२४): ७ देखि ९ घण्टाको गहिरो निद्रामा दिमागको ग्लिम्फेटिक प्रणालीले अल्जाइमरसँग जोडिएका विषाक्त पदार्थ सफा गर्छ।', source:'Nature Neuroscience, 2024', category:'sleep' },
  { emoji:'🥦', title:'हरियो तरकारीले क्यान्सरको जोखिम घटाउँछ', finding:'Cell Metabolism (२०२४): ब्रोकोली र फूलगोभीमा पाइने सल्फोराफेनले NRF2 मार्ग सक्रिय गरी क्यान्सर कोशिकाको वृद्धि ४०% सम्म रोक्न सक्छ।', source:'Cell Metabolism, 2024', category:'diet' },
  { emoji:'📵', title:'सुत्नुअघि स्क्रिन नहेर्दा निद्रा २८% राम्रो हुन्छ', finding:'Sleep Medicine Reviews (२०२४): मोबाइल र ल्यापटपको नीलो प्रकाशले मेलाटोनिन २ घण्टासम्म थप्न रोक्छ। सुत्नुभन्दा १ घण्टा अघि स्क्रिन बन्द गर्दा निद्राको गुणस्तर २८% सुधार हुन्छ।', source:'Sleep Medicine Reviews, 2024', category:'screen' },
  { emoji:'🧘', title:'५ मिनेट गहिरो सास फेर्दा रक्तचाप घट्छ', finding:'American Heart Association (२०२४): दैनिक ५ मिनेट लयबद्ध गहिरो सास फेर्दा सिस्टोलिक रक्तचाप ९ mmHg घट्छ, जुन केही औषधिको बराबर असरकारक छ।', source:'Hypertension / AHA, 2024', category:'stress' },
  { emoji:'🦠', title:'आन्द्राको स्वास्थ्यले मानसिक स्वास्थ्यलाई असर गर्छ', finding:'Nature (२०२४): आन्द्रामा पाइने ९५ प्रकारका ब्याक्टेरियाले सिधै सेरोटोनिन र डोपामिन उत्पादन गर्छन्। दही र किण्वित खानाले डिप्रेसन ३२% कम गर्छ।', source:'Nature, 2024', category:'digestion' },
  { emoji:'🚭', title:'धुम्रपान छाड्दा १ वर्षमा मुटुको जोखिम आधा हुन्छ', finding:'Circulation (२०२४): धुम्रपान छाडेको १२ महिनामा हार्ट अट्याकको जोखिम ५०% घट्छ। ३ महिनामै फोक्सोको कार्यक्षमता उल्लेखनीय रूपमा सुधार हुन्छ।', source:'Circulation / AHA, 2024', category:'addiction' },
  { emoji:'🏋️', title:'हप्तामा २ पटक कसरत गर्दा उमेर लम्बिन्छ', finding:'BMJ (२०२४): हप्तामा मात्र २ पटक, २०–२५ मिनेट भारोत्तोलन वा बल कसरत गर्दा सबै कारणबाट हुने मृत्युको जोखिम २३% घट्छ।', source:'BMJ, 2024', category:'exercise' },
  { emoji:'🌿', title:'प्रकृतिमा समय बिताउँदा तनाव २५% घट्छ', finding:'Environmental Health Perspectives (२०२४): हरियो ठाउँमा २ घण्टा बिताउँदा कोर्टिसोल (तनाव हर्मोन) २५% घट्छ र रोगप्रतिरोधक क्षमता बढ्छ।', source:'Env. Health Perspectives, 2024', category:'stress' },
  { emoji:'🦷', title:'दाँतको सरसफाइले मुटुको रोग रोक्छ', finding:'Circulation (२०२४): मसुरोको सूजन भएका मानिसहरूमा हार्ट अट्याकको जोखिम दोब्बर हुन्छ। दैनिक फ्लस गर्दा यो जोखिम उल्लेखनीय रूपमा कम हुन्छ।', source:'Circulation, 2024', category:'hygiene' },
];

function csHealthShowResearch() {
  _csHealthResearchActive = true;
  _csHealthSelected = null; // deselect any habit
  const shuffled = [..._HEALTH_RESEARCH_DB].sort(() => Math.random() - 0.5);
  const tips = shuffled.slice(0, 2);
  _csRenderHealth({ research: tips, title: '🔬 Latest Health Research' });
  // Build caption
  const caption = tips.map((t, i) =>
    `${i+1}. ${t.emoji} ${t.title}\n${t.finding}\n📰 ${t.source}`
  ).join('\n\n') + '\n\n#स्वास्थ्य #HealthResearch #Nepal #Wellness #HealthTips';
  _csShowCaption(caption);
  _csSetStatus('✅ Research tips loaded!');
}

function csHealthLoadDB() {
  setTimeout(() => csHealthRenderDB(), 300);
}

/* ── HEALTH HABITS — CANVAS RENDERER ─────────────────────────── */
/* ── Health card style state ── */
let _csHealthCardStyle    = 'gradient';   // 'gradient' | 'solid' | 'glass' | 'outline'
let _csHealthPhotoLayout  = 'side-right'; // 'side-right' | 'side-left' | 'top-rect' | 'top-circle' | 'bottom'
let _csHealthResearchActive = false;      // true when research tips mode is active
let _csHealthTextMode     = 'auto';       // 'auto' | 'colorful'
let _csHealthColorPalette = 'vivid';      // 'vivid' | 'pastel' | 'neon' | 'warm' | 'cool'

const _CS_HEALTH_PALETTES = {
  vivid:  ['#f59e0b','#34d399','#60a5fa','#f472b6','#a78bfa','#fb923c','#4ade80','#38bdf8'],
  pastel: ['#fde68a','#bbf7d0','#bfdbfe','#fbcfe8','#ddd6fe','#fed7aa','#a7f3d0','#bae6fd'],
  neon:   ['#faff00','#00ff88','#00eeff','#ff00cc','#bf00ff','#ff6600','#00ffaa','#ff3300'],
  warm:   ['#fbbf24','#f97316','#ef4444','#ec4899','#fde68a','#fb923c','#fca5a5','#fdba74'],
  cool:   ['#38bdf8','#34d399','#818cf8','#2dd4bf','#60a5fa','#4ade80','#a78bfa','#67e8f9'],
};

function csHealthSetTextMode(btn, mode) {
  _csHealthTextMode = mode;
  document.querySelectorAll('#csHealthTextModeAuto,#csHealthTextModeColor').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const palette = document.getElementById('csHealthColorPalette');
  if (palette) palette.style.display = mode === 'colorful' ? 'block' : 'none';
  csRenderBlank();
}

function csHealthSetPalette(btn, palette) {
  _csHealthColorPalette = palette;
  document.querySelectorAll('[data-palette]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const inp = document.getElementById('csHealthColorPaletteVal');
  if (inp) inp.value = palette;
  csRenderBlank();
}

// Draw text word-by-word with cycling palette colours
function _csDrawColorWords(ctx, text, x, y, maxW, lineH, palette) {
  const colors = _CS_HEALTH_PALETTES[palette] || _CS_HEALTH_PALETTES.vivid;
  const words = text.split(' ');
  let line = [], lineWords = [], colorIdx = 0;
  let curY = y;

  function flushLine(words, isLast) {
    let curX = x;
    for (const w of words) {
      ctx.fillStyle = colors[colorIdx % colors.length];
      colorIdx++;
      ctx.fillText(w, curX, curY);
      curX += ctx.measureText(w + ' ').width;
    }
    if (!isLast) curY += lineH;
  }

  let lineW = 0;
  let currentLine = [];
  for (const word of words) {
    const ww = ctx.measureText(word + ' ').width;
    if (lineW + ww > maxW && currentLine.length > 0) {
      flushLine(currentLine, false);
      curY += lineH;
      currentLine = [word];
      lineW = ww;
    } else {
      currentLine.push(word);
      lineW += ww;
    }
  }
  if (currentLine.length > 0) flushLine(currentLine, true);
  return Math.round((curY - y) / lineH) + 1;
}

function csHealthSetCardStyle(btn, style) {
  _csHealthCardStyle = style;
  document.querySelectorAll('[data-health-style]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (_csHealthSelected) {
    csHealthPickCard(_csHealthSelected, document.querySelector('.cs-health-db-card.selected') || document.createElement('div'));
  } else { _csRenderHealth(null); }
}

function csHealthSetPhotoLayout(btn, layout) {
  _csHealthPhotoLayout = layout;
  document.querySelectorAll('#csHealthPhotoLayoutBtns .cs-radio-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (_csHealthSelected) {
    csHealthPickCard(_csHealthSelected, document.querySelector('.cs-health-db-card.selected') || document.createElement('div'));
  } else { _csRenderHealth(null); }
}

function _csRenderHealth(data) {
  const { ctx, W, H } = _csGetCanvas();
  const bg = _csActiveBg('csHealthBgSwatches');
  _csDrawBackground(ctx, W, H, bg);

  const isLight    = bg === 'health-white' || bg === 'white-clean';
  const cardStyle  = _csHealthCardStyle   || 'gradient';
  const photoLayout = _csHealthPhotoLayout || 'side-right';

  // ── Per-theme palette ─────────────────────────────────────────
  const themeMap = {
    'health-emerald': { accent:'#f59e0b', badSolid:'#3b0000',  goodSolid:'#001a3b',  badBorder:'#f43f5e', goodBorder:'#38bdf8', badGrad:['#4a0000','#2d0000'], goodGrad:['#00243f','#001428'], tipTxt:'#fde68a', tipBg:'rgba(0,0,0,0.55)' },
    'health-ocean':   { accent:'#f59e0b', badSolid:'#2e0050',  goodSolid:'#00284f',  badBorder:'#c084fc', goodBorder:'#22d3ee', badGrad:['#3b0066','#1e0038'], goodGrad:['#003366','#001f40'], tipTxt:'#fde68a', tipBg:'rgba(0,0,0,0.55)' },
    'health-teal':    { accent:'#fbbf24', badSolid:'#3a0a00',  goodSolid:'#001a36',  badBorder:'#fb923c', goodBorder:'#818cf8', badGrad:['#4a1000','#2e0800'], goodGrad:['#00233a','#001428'], tipTxt:'#fff176', tipBg:'rgba(0,0,0,0.55)' },
    'health-purple':  { accent:'#f59e0b', badSolid:'#3b0000',  goodSolid:'#00003b',  badBorder:'#fb7185', goodBorder:'#60a5fa', badGrad:['#4d0000','#300000'], goodGrad:['#00004d','#000030'], tipTxt:'#fde68a', tipBg:'rgba(0,0,0,0.55)' },
    'health-slate':   { accent:'#f59e0b', badSolid:'#3a0a0a',  goodSolid:'#0a1940',  badBorder:'#f87171', goodBorder:'#38bdf8', badGrad:['#4d1010','#2e0808'], goodGrad:['#0d2050','#081530'], tipTxt:'#fde68a', tipBg:'rgba(0,0,0,0.60)' },
    'health-warm':    { accent:'#fde68a', badSolid:'#3c0020',  goodSolid:'#001440',  badBorder:'#f472b6', goodBorder:'#67e8f9', badGrad:['#4f0030','#300020'], goodGrad:['#001a50','#000e30'], tipTxt:'#ffffff', tipBg:'rgba(0,0,0,0.55)' },
    'health-rose':    { accent:'#fde68a', badSolid:'#280040',  goodSolid:'#002030',  badBorder:'#c084fc', goodBorder:'#34d399', badGrad:['#360054','#200034'], goodGrad:['#002840','#001525'], tipTxt:'#ffffff', tipBg:'rgba(0,0,0,0.55)' },
    'health-white':   { accent:'#7c3aed', badSolid:'#fde8e8',  goodSolid:'#e8f0fe',  badBorder:'#dc2626', goodBorder:'#2563eb', badGrad:['#fee2e2','#fecaca'], goodGrad:['#dbeafe','#bfdbfe'], tipTxt:'#3b0764', tipBg:'rgba(237,233,254,0.85)' },
    'white-clean':    { accent:'#7c3aed', badSolid:'#fde8e8',  goodSolid:'#e8f0fe',  badBorder:'#dc2626', goodBorder:'#2563eb', badGrad:['#fee2e2','#fecaca'], goodGrad:['#dbeafe','#bfdbfe'], tipTxt:'#3b0764', tipBg:'rgba(237,233,254,0.85)' },
  };
  const theme = themeMap[bg] || themeMap['health-slate'];
  const accent      = theme.accent;
  const badImpColor = isLight ? '#991b1b' : '#ffd6d6';
  const goodImpColor = isLight ? '#1d4ed8' : '#bfdbfe';

  const sc    = Math.min(W / 600, H / 750, 1);
  const PAD   = Math.round(W * 0.048);
  const WMARK = Math.round(34 * Math.min(W / 600, 1));
  const usableH = H - WMARK;

  // ── TITLE BANNER ──────────────────────────────────────────────
  const bannerH = Math.round(H * 0.115);
  ctx.save();
  ctx.fillStyle = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0.52)';
  ctx.fillRect(0, 0, W, bannerH);
  const bannerLine = ctx.createLinearGradient(0, 0, W, 0);
  bannerLine.addColorStop(0, theme.badBorder);
  bannerLine.addColorStop(0.5, accent);
  bannerLine.addColorStop(1, theme.goodBorder);
  ctx.fillStyle = bannerLine;
  ctx.fillRect(0, bannerH - 4, W, 4);
  const title = '💊 Health Tips';
  ctx.fillStyle = isLight ? '#1e293b' : '#ffffff';
  ctx.font = `900 ${Math.round(W * 0.050)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(title, W / 2, bannerH / 2);
  ctx.restore();

  // ── PHOTO — layout-aware ──────────────────────────────────────
  const photo = _csPhotos?.['health'];

  // Helper: draw a photo in a box (rounded rect or circle) with shadow + border
  function _drawPhotoBox(px, py, pw, ph, isCircle, borderColor) {
    if (!photo) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.70)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    if (isCircle) { ctx.arc(px + pw/2, py + ph/2, pw/2, 0, Math.PI*2); }
    else { if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 12); else ctx.rect(px, py, pw, ph); }
    ctx.fill();
    ctx.restore();
    _csDrawPhoto(ctx, photo, px, py, pw, ph, isCircle, 'health');
    ctx.save();
    ctx.strokeStyle = borderColor; ctx.lineWidth = 3;
    if (isCircle) { ctx.beginPath(); ctx.arc(px + pw/2, py + ph/2, pw/2 + 1, 0, Math.PI*2); ctx.stroke(); }
    else { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 12); else ctx.rect(px, py, pw, ph); ctx.stroke(); }
    ctx.restore();
  }

  // Layout geometry
  let contentX, contentW, contentStartY, photoReservedBottom = 0;
  const afterBanner = bannerH + Math.round(H * 0.016);

  if (!photo) {
    contentX = PAD; contentW = W - PAD * 2; contentStartY = afterBanner;
  } else if (photoLayout === 'side-right') {
    const pW = Math.round(W * 0.30); const pH = Math.round(H * 0.32);
    const pX = W - PAD - pW; const pY = afterBanner;
    _drawPhotoBox(pX, pY, pW, pH, false, theme.goodBorder);
    contentX = PAD; contentW = W - PAD * 2 - pW - Math.round(W * 0.025); contentStartY = afterBanner;
  } else if (photoLayout === 'side-left') {
    const pW = Math.round(W * 0.30); const pH = Math.round(H * 0.32);
    _drawPhotoBox(PAD, afterBanner, pW, pH, false, theme.badBorder);
    contentX = PAD + pW + Math.round(W * 0.025); contentW = W - contentX - PAD; contentStartY = afterBanner;
  } else if (photoLayout === 'top-rect') {
    const pW = W - PAD * 2; const pH = Math.round(H * 0.22);
    _drawPhotoBox(PAD, afterBanner, pW, pH, false, theme.goodBorder);
    contentX = PAD; contentW = W - PAD * 2; contentStartY = afterBanner + pH + Math.round(H * 0.014);
  } else if (photoLayout === 'top-circle') {
    const pr = Math.round(W * 0.13);
    const cx = W / 2 - pr, cy = afterBanner;
    _drawPhotoBox(cx, cy, pr * 2, pr * 2, true, accent);
    // "Name" label bar under circle
    ctx.save();
    ctx.fillStyle = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, afterBanner + pr * 2 + 6, W, Math.round(H * 0.04));
    ctx.restore();
    contentX = PAD; contentW = W - PAD * 2; contentStartY = afterBanner + pr * 2 + 6 + Math.round(H * 0.04) + Math.round(H * 0.01);
  } else if (photoLayout === 'bottom') {
    const pH = Math.round(H * 0.20);
    photoReservedBottom = pH + Math.round(H * 0.016);
    contentX = PAD; contentW = W - PAD * 2; contentStartY = afterBanner;
    // Draw photo after cards (deferred below)
  } else {
    contentX = PAD; contentW = W - PAD * 2; contentStartY = afterBanner;
  }

  // ── HABIT CARDS LAYOUT ────────────────────────────────────────
  const habit    = data?.habits?.[0];
  const tipH     = data?.tip ? Math.round(H * 0.072) : 0;
  const bottomH  = tipH + WMARK + Math.round(H * 0.012) + photoReservedBottom;
  const cardsH   = usableH - contentStartY - bottomH;
  const gap      = Math.round(H * 0.032);

  // ── Text colors — always readable regardless of theme ─────────
  const bodyTxt         = isLight ? '#111827' : '#ffffff';
  const badImpTxtColor  = isLight ? '#7f1d1d' : '#fecdd3';
  const goodImpTxtColor = isLight ? '#1e3a8a' : '#bae6fd';

  // ── Measure-only helper (counts wrap lines without drawing) ───
  function _measureLines(font, text, maxW) {
    ctx.font = font;
    const words = text.split(' ');
    let line = '', count = 1;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { line = w; count++; }
      else line = test;
    }
    return count;
  }

  if (habit) {
    const pillH   = Math.round(Math.max(sc * 26, 20));
    const pillW   = Math.round(Math.max(sc * 155, 115));
    const pillX   = contentX + 14;
    const textPad = contentX + 16;
    const textW   = contentW - 26;
    const spacingBelowPill = Math.round(H * 0.022);
    const sectionPadBottom = Math.round(H * 0.014);

    // ── Helper: draw a FLAT section bg ────────────────────────
    function _drawFlat(x, y, w, h, isBad) {
      ctx.save();
      ctx.fillStyle = isLight
        ? (isBad ? 'rgba(255,220,220,0.72)' : 'rgba(210,232,255,0.72)')
        : (isBad ? 'rgba(60,0,0,0.60)'      : 'rgba(0,15,50,0.60)');
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = isBad ? theme.badBorder : theme.goodBorder;
      ctx.fillRect(x, y, w, 3);
      ctx.restore();
    }

    // Font sizes
    let bFsz = Math.round(Math.max(W * 0.034, 13));
    let bLh  = Math.round(bFsz * 1.55);
    let iFsz = Math.round(bFsz * 0.84);
    let iLh  = Math.round(iFsz * 1.45);

    const badTxt    = habit.bad_habit  || '';
    const badImpStr = '⚠️  ' + (habit.bad_impact  || '');
    const goodTxt   = habit.good_habit || '';
    const goodImpStr = '💡  ' + (habit.good_impact || '');

    // ── Measure bad section ───────────────────────────────────
    const bBodyLines = _measureLines(`700 ${bFsz}px sans-serif`,    badTxt,    textW);
    const bImpLines  = _measureLines(`italic ${iFsz}px sans-serif`, badImpStr, textW);
    const badSecH    = 8 + pillH + spacingBelowPill + bBodyLines * bLh + 4 + bImpLines * iLh + sectionPadBottom;

    // ── Measure good section ──────────────────────────────────
    const gBodyLines = _measureLines(`700 ${bFsz}px sans-serif`,    goodTxt,    textW);
    const gImpLines  = _measureLines(`italic ${iFsz}px sans-serif`, goodImpStr, textW);
    const goodSecH   = 8 + pillH + spacingBelowPill + gBodyLines * bLh + 4 + gImpLines * iLh + sectionPadBottom;

    const badY  = contentStartY;
    const goodY = badY + badSecH + gap;

    // ── Draw BAD SECTION ──────────────────────────────────────
    _drawFlat(contentX, badY, contentW, badSecH, true);

    // Pill label
    ctx.save();
    ctx.fillStyle = theme.badBorder;
    ctx.fillRect(pillX, badY + 8, pillW, pillH);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(pillX, badY + 8, pillW, pillH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(Math.max(sc*14,12))}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('❌  नराम्रो बानी', pillX + pillW/2, badY + 8 + pillH/2);
    ctx.restore();

    // Vertically centre text block within the remaining space below pill
    const badTextBlockH = bBodyLines * bLh + 4 + bImpLines * iLh;
    const badTextAreaH  = badSecH - (8 + pillH + spacingBelowPill) - sectionPadBottom;
    const badTextOffY   = Math.max(0, Math.floor((badTextAreaH - badTextBlockH) / 2));
    const badBodyY      = badY + 8 + pillH + spacingBelowPill + badTextOffY;

    ctx.fillStyle = bodyTxt;
    ctx.font = `700 ${bFsz}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let bLines;
    if (_csHealthTextMode === 'colorful') {
      bLines = _csDrawColorWords(ctx, badTxt, textPad, badBodyY, textW, bLh, _csHealthColorPalette);
    } else {
      bLines = _csWrapText(ctx, badTxt, textPad, badBodyY, textW, bLh);
    }
    ctx.fillStyle = badImpTxtColor;
    ctx.font = `italic ${iFsz}px sans-serif`;
    if (_csHealthTextMode === 'colorful') {
      _csDrawColorWords(ctx, badImpStr, textPad, badBodyY + bLines * bLh + 4, textW, iLh, _csHealthColorPalette);
    } else {
      _csWrapText(ctx, badImpStr, textPad, badBodyY + bLines * bLh + 4, textW, iLh);
    }

    // ── Draw GOOD SECTION ─────────────────────────────────────
    _drawFlat(contentX, goodY, contentW, goodSecH, false);

    ctx.save();
    ctx.fillStyle = theme.goodBorder;
    ctx.fillRect(pillX, goodY + 8, pillW, pillH);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(pillX, goodY + 8, pillW, pillH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(Math.max(sc*14,12))}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('✅  राम्रो बानी', pillX + pillW/2, goodY + 8 + pillH/2);
    ctx.restore();

    const goodTextBlockH = gBodyLines * bLh + 4 + gImpLines * iLh;
    const goodTextAreaH  = goodSecH - (8 + pillH + spacingBelowPill) - sectionPadBottom;
    const goodTextOffY   = Math.max(0, Math.floor((goodTextAreaH - goodTextBlockH) / 2));
    const goodBodyY      = goodY + 8 + pillH + spacingBelowPill + goodTextOffY;

    ctx.fillStyle = bodyTxt;
    ctx.font = `700 ${bFsz}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let gLines;
    if (_csHealthTextMode === 'colorful') {
      gLines = _csDrawColorWords(ctx, goodTxt, textPad, goodBodyY, textW, bLh, _csHealthColorPalette);
    } else {
      gLines = _csWrapText(ctx, goodTxt, textPad, goodBodyY, textW, bLh);
    }
    ctx.fillStyle = goodImpTxtColor;
    ctx.font = `italic ${iFsz}px sans-serif`;
    if (_csHealthTextMode === 'colorful') {
      _csDrawColorWords(ctx, goodImpStr, textPad, goodBodyY + gLines * bLh + 4, textW, iLh, _csHealthColorPalette);
    } else {
      _csWrapText(ctx, goodImpStr, textPad, goodBodyY + gLines * bLh + 4, textW, iLh);
    }

  } else if (data?.research) {
    // ── RESEARCH TIPS MODE ─────────────────────────────────
    const tips = data.research.slice(0, 2);
    const rPad = 12; // inner padding top/bottom

    tips.forEach((tip, i) => {
      const titleFsz = Math.round(Math.max(W * 0.033, 13));
      const titleLh  = Math.round(titleFsz * 1.45);
      const findFsz  = Math.round(Math.max(W * 0.028, 11));
      const findLh   = Math.round(findFsz * 1.5);
      const srcFsz   = Math.round(findFsz * 0.85);
      const rTextW   = contentW - 28;

      // Measure all lines first
      const tLineCount = _measureLines(`900 ${titleFsz}px sans-serif`, tip.emoji + '  ' + tip.title, rTextW);
      const fLineCount = _measureLines(`${findFsz}px sans-serif`, tip.finding, rTextW);
      // total content block height
      const contentBlockH = tLineCount * titleLh + 6 + fLineCount * findLh + 4 + Math.round(srcFsz * 1.4);
      const rH = contentBlockH + rPad * 2 + 4; // +4 for top accent bar

      // Y position — stack tip 0 then tip 1 with gap
      const ry = i === 0
        ? contentStartY
        : contentStartY + tips.slice(0,1).reduce((acc, t2) => {
            const tl = _measureLines(`900 ${titleFsz}px sans-serif`, t2.emoji + '  ' + t2.title, rTextW);
            const fl = _measureLines(`${findFsz}px sans-serif`, t2.finding, rTextW);
            const cb = tl * titleLh + 6 + fl * findLh + 4 + Math.round(srcFsz * 1.4);
            return acc + cb + rPad * 2 + 4;
          }, 0) + gap;

      // Flat bg — sized to content
      ctx.save();
      ctx.fillStyle = isLight ? 'rgba(224,242,254,0.88)' : 'rgba(0,20,50,0.80)';
      ctx.fillRect(contentX, ry, contentW, rH);
      ctx.fillStyle = accent;
      ctx.fillRect(contentX, ry, contentW, 4);
      ctx.restore();

      // Text block — vertically centred inside the band
      const textStartY = ry + 4 + rPad;

      // Title
      ctx.fillStyle = bodyTxt;
      ctx.font = `900 ${titleFsz}px sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      let tLines;
      if (_csHealthTextMode === 'colorful') {
        tLines = _csDrawColorWords(ctx, tip.emoji + '  ' + tip.title, contentX + 14, textStartY, rTextW, titleLh, _csHealthColorPalette);
      } else {
        tLines = _csWrapText(ctx, tip.emoji + '  ' + tip.title, contentX + 14, textStartY, rTextW, titleLh);
      }

      // Finding
      const findY = textStartY + tLines * titleLh + 6;
      ctx.fillStyle = isLight ? '#1e293b' : '#e2e8f0';
      ctx.font = `${findFsz}px sans-serif`;
      let fLines;
      if (_csHealthTextMode === 'colorful') {
        fLines = _csDrawColorWords(ctx, tip.finding, contentX + 14, findY, rTextW, findLh, _csHealthColorPalette);
      } else {
        fLines = _csWrapText(ctx, tip.finding, contentX + 14, findY, rTextW, findLh);
      }

      // Source
      const srcY = findY + fLines * findLh + 4;
      ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
      ctx.font = `italic ${srcFsz}px sans-serif`;
      ctx.fillText('📰 ' + tip.source, contentX + 14, srcY);
    });
  } else {
    ctx.fillStyle = isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(W * 0.036)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('बानी छान्नुस् वा AI Generate गर्नुस्', W/2, contentStartY + cardsH/2);
  }

  // ── BOTTOM PHOTO (deferred) ───────────────────────────────────
  if (photo && photoLayout === 'bottom') {
    const pH = Math.round(H * 0.20);
    const pY = usableH - tipH - pH - Math.round(H * 0.016);
    _drawPhotoBox(PAD, pY, W - PAD * 2, pH, false, theme.goodBorder);
  }

  // ── TIP STRIP ─────────────────────────────────────────────────
  if (data?.tip) {
    const tipY    = usableH - tipH - Math.round(H * 0.040);
    const tipBoxW = W - PAD * 2;
    const tipBoxH = tipH - 4;
    const tipTextX = PAD + 18;
    const tipMaxW  = tipBoxW - 22; // space after the accent bar + right pad

    ctx.save();
    // Draw background
    ctx.fillStyle = isLight ? 'rgba(255,255,255,0.92)' : 'rgba(5,5,15,0.88)';
    ctx.fillRect(PAD, tipY, tipBoxW, tipBoxH);
    ctx.fillStyle = theme.tipBg;
    ctx.fillRect(PAD, tipY, tipBoxW, tipBoxH);
    // Accent bar
    ctx.fillStyle = accent;
    ctx.fillRect(PAD, tipY, 5, tipBoxH);

    // Auto-shrink font until text fits on one line
    const tipFullText = '💡  ' + data.tip;
    let tipFsz = Math.round(W * 0.030);
    ctx.font = `700 ${tipFsz}px sans-serif`;
    while (ctx.measureText(tipFullText).width > tipMaxW && tipFsz > 10) {
      tipFsz--;
      ctx.font = `700 ${tipFsz}px sans-serif`;
    }

    ctx.fillStyle = isLight ? '#1e1b4b' : '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(tipFullText, tipTextX, tipY + tipBoxH / 2);
    ctx.restore();
  }

  _csWatermark(ctx, W, H);
}

/* -- UNKNOWN FACTS -- */
function _csRenderFacts(data) {
  const { ctx, W, H } = _csGetCanvas();
  const bg = _csActiveBg('csFactsBgSwatches');
  _csDrawBackground(ctx, W, H, bg);

  // Category-aware accent colour
  const cat = data?.category || document.getElementById('csFactsCategory')?.value || 'space';
  const accentMap = {
    space:'#a5f3fc', universe:'#c4b5fd', science:'#6ee7b7', 'human-body':'#fca5a5',
    health:'#86efac', technology:'#7dd3fc', nature:'#bbf7d0', ayurveda:'#d9f99d',
    religion:'#fde68a', finance:'#fcd34d', history:'#f9a8d4', psychology:'#e9d5ff',
    animals:'#fed7aa', time:'#bfdbfe', nepal:'#fef08a', random:'#a5f3fc'
  };
  const accent = accentMap[cat] || '#a5f3fc';

  // Decorative dots / sparkles (subtle)
  ctx.save();
  ctx.fillStyle = accent;
  for (let i = 0; i < 40; i++) {
    const sx = Math.random() * W, sy = Math.random() * H * 0.45;
    const sr = Math.random() * 1.8 + 0.3;
    ctx.globalAlpha = Math.random() * 0.35 + 0.08;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // "DID YOU KNOW?" badge
  const badgeY = H * 0.04;
  const badgeH = Math.round(H * 0.065);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.18;
  _csRoundRect(ctx, W * 0.12, badgeY, W * 0.76, badgeH, badgeH/2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.font = `900 ${Math.round(W * 0.038)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('💡 के तपाईंलाई थाहा छ?', W/2, badgeY + badgeH/2);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.round(W * 0.058)}px sans-serif`;
  ctx.textBaseline = 'top';
  const title = data?.title || '🌌 Did You Know?';
  const tLines = _csWrapText(ctx, title, W/2, H * 0.13, W * 0.88, Math.round(W * 0.07));

  // Accent divider
  const divY = H * 0.13 + tLines * Math.round(W * 0.07) + 8;
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(W * 0.08, divY, W * 0.84, 2);
  ctx.globalAlpha = 1;

  // Fact text
  ctx.fillStyle = '#f1f5f9';
  ctx.font = `${Math.round(W * 0.041)}px serif`;
  const fact = data?.fact || ' ';
  const fLines = _csWrapText(ctx, fact, W/2, divY + 14, W * 0.88, Math.round(W * 0.051));

  // Wow factor box
  const wowY = divY + 14 + fLines * Math.round(W * 0.051) + 12;
  if (data?.wow && wowY < H * 0.82) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.12;
    _csRoundRect(ctx, W * 0.06, wowY, W * 0.88, H * 0.12, 10);
    ctx.globalAlpha = 1;
    // left accent bar
    ctx.fillStyle = accent;
    ctx.fillRect(W * 0.06, wowY, 4, H * 0.12);
    ctx.fillStyle = '#fde68a';
    ctx.font = `italic ${Math.round(W * 0.034)}px serif`;
    ctx.textBaseline = 'top';
    _csWrapText(ctx, '✨ ' + data.wow, W/2, wowY + 10, W * 0.80, Math.round(W * 0.042));
  }

  // Source chip at bottom
  if (data?.source) {
    const srcY = H * 0.855;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.15;
    _csRoundRect(ctx, W * 0.08, srcY, W * 0.84, H * 0.058, 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.font = `${Math.round(W * 0.026)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('� ' + data.source, W/2, srcY + H * 0.029);
  }

  _csWatermark(ctx, W, H);
}

/* -- ATOMIC HABITS -- */
function _csRenderAtomic(data) {
  const { ctx, W, H } = _csGetCanvas();
  const bg = _csActiveBg('csAtomicBgSwatches');
  _csDrawBackground(ctx, W, H, bg);

  // 1% badge
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.round(W * 0.55)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('1%', W/2, H/2);
  ctx.restore();

  // Accent bar top
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 0, Math.round(W * 0.08), H);

  // Headline
  ctx.fillStyle = '#fef08a';
  ctx.font = `900 ${Math.round(W * 0.065)}px sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const hl = data?.headline || '';
  _csWrapText(ctx, hl, W * 0.12, H * 0.08, W * 0.82, Math.round(W * 0.078));

  // Insight
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(W * 0.038)}px sans-serif`;
  const insight = data?.insight || '1% improvement every day makes you 37x better in a year.';
  const iLines = _csWrapText(ctx, insight, W * 0.12, H * 0.24, W * 0.82, Math.round(W * 0.048));

  // Action box
  const actionY = H * 0.24 + iLines * W * 0.048 + 20;
  ctx.fillStyle = 'rgba(245,158,11,0.15)';
  _csRoundRect(ctx, W * 0.1, actionY, W * 0.8, H * 0.16, 10);
  ctx.fillStyle = '#f59e0b';
  ctx.font = `bold ${Math.round(W * 0.032)}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('✅  ', W * 0.14, actionY + H * 0.04);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(W * 0.036)}px sans-serif`;
  _csWrapText(ctx, data?.action || document.getElementById('csAtomicHabit')?.value || '', W * 0.14, actionY + H * 0.07, W * 0.72, Math.round(W * 0.044));

  // Closing
  if (data?.closing) {
    ctx.fillStyle = '#fde68a';
    ctx.font = `bold italic ${Math.round(W * 0.034)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(data.closing, W/2, H - Math.round(34 * Math.min(W/600,1)) - 10);
  }
  _csWatermark(ctx, W, H);
}

/* -- QUIZ -- */
function _csRenderQuiz(data) {
  const { ctx, W, H } = _csGetCanvas();
  const bg = _csActiveBg('csQuizBgSwatches');
  _csDrawBackground(ctx, W, H, bg);

  // Header
  const qtype = document.getElementById('csQuizType')?.value || 'logical';
  const quizHeaders = { logical:'🧩 Logic Puzzle!', math:'🔢 Math Challenge!', gk:'🌏 GK Quiz!', nepal:'🇳🇵 Nepal Quiz!', riddle:'🕵️ Riddle Time!' };
  const quizHeaderText = quizHeaders[qtype] || '🧠 Quiz Time!';
  ctx.fillStyle = '#818cf8';
  ctx.fillRect(0, 0, W, Math.round(H * 0.11));
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.round(W * 0.048)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(quizHeaderText, W/2, Math.round(H * 0.055));

  // Question
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(W * 0.048)}px serif`;
  ctx.textBaseline = 'top';
  const question = data?.question || ' ';
  const qLines = _csWrapText(ctx, question, W/2, H * 0.14, W * 0.85, Math.round(W * 0.058));

  // Options
  const options = data?.options || [];
  const optColors = ['rgba(99,102,241,.25)', 'rgba(16,185,129,.25)', 'rgba(245,158,11,.25)', 'rgba(239,68,68,.25)'];
  const optLabels = ['A', 'B', 'C', 'D'];
  const optStartY = H * 0.14 + qLines * Math.round(W * 0.058) + 16;
  const optH = Math.round(H * 0.1);
  options.slice(0, 4).forEach((opt, i) => {
    const oy = optStartY + i * (optH + 8);
    ctx.fillStyle = optColors[i];
    _csRoundRect(ctx, W * 0.06, oy, W * 0.88, optH, 10);
    ctx.fillStyle = '#a5b4fc';
    ctx.font = `900 ${Math.round(W * 0.038)}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(optLabels[i] + '.', W * 0.1, oy + optH / 2);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(W * 0.034)}px sans-serif`;
    _csWrapText(ctx, opt, W * 0.2, oy + optH * 0.22, W * 0.7, Math.round(W * 0.038));
  });

  // Answer (if show_answer)
  if (data?.show_answer && data?.answer) {
    const ansY = optStartY + options.length * (optH + 8) + 8;
    ctx.fillStyle = 'rgba(16,185,129,0.3)';
    _csRoundRect(ctx, W * 0.06, ansY, W * 0.88, optH, 10);
    ctx.fillStyle = '#6ee7b7';
    ctx.font = `bold ${Math.round(W * 0.036)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
 ctx.fillText('✅  ' + data.answer, W/2, ansY + optH/2);
  }

  // CTA
  ctx.fillStyle = '#818cf8';
  ctx.font = `bold ${Math.round(W * 0.035)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(data?.cta || 'Write your answer in comments! 💬', W/2, H - Math.round(34 * Math.min(W/600,1)) - 10);

  _csWatermark(ctx, W, H);
}

/* -- SUCCESS STORY -- */
function _csRenderSuccess(data) {
  const { ctx, W, H } = _csGetCanvas();
  const bg = _csActiveBg('csSuccessBgSwatches');
  _csDrawBackground(ctx, W, H, bg);

  // Trophy accent
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.font = `${Math.round(W * 0.6)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('', W/2, H/2);
  ctx.restore();

  // Header ribbon
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, Math.round(H * 0.1));
  ctx.fillStyle = '#fef08a';
  ctx.font = `900 ${Math.round(W * 0.048)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🏆 SUCCESS STORY 🏆', W/2, Math.round(H * 0.05));

  // Photo
  const photo = _csPhotos['success'];
  const pW = Math.round(W * 0.38), pH = Math.round(H * 0.38);
  const pX = W * 0.05, pY = H * 0.12;
  if (photo) {
    _csDrawPhoto(ctx, photo, pX, pY, pW, pH, false, 'success');
    ctx.strokeStyle = '#d97706'; ctx.lineWidth = 4;
    ctx.strokeRect(pX, pY, pW, pH);
  }

  // Text area
  const tX = photo ? pX + pW + 16 : W * 0.05;
  const tW = photo ? W * 0.52 : W * 0.9;
  const tY = H * 0.13;

  // Person name
  ctx.fillStyle = '#fef08a';
  ctx.font = `900 ${Math.round(W * 0.052)}px serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const person = document.getElementById('csSuccessPerson')?.value || data?.person || '';
  if (person) _csWrapText(ctx, person, tX, tY, tW, Math.round(W * 0.062));

  // Story
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(W * 0.033)}px sans-serif`;
  const story = data?.story || ' ';
  const sLines = _csWrapText(ctx, story, tX, tY + W * 0.075, tW, Math.round(W * 0.04));

  // Lesson box (below photo + story)
  const lessonY = Math.max(pY + pH, tY + W * 0.075 + sLines * W * 0.04) + 16;
  ctx.fillStyle = 'rgba(245,158,11,0.2)';
  _csRoundRect(ctx, W * 0.04, lessonY, W * 0.92, H * 0.13, 10);
  ctx.fillStyle = '#fbbf24';
  ctx.font = `bold italic ${Math.round(W * 0.036)}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  _csWrapText(ctx, data?.lesson || '  - ', W/2, lessonY + H * 0.035, W * 0.84, Math.round(W * 0.044));

  // Closing
  if (data?.closing) {
    ctx.fillStyle = '#fde68a';
    ctx.font = `bold ${Math.round(W * 0.03)}px sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(data.closing, W/2, H - Math.round(34 * Math.min(W/600,1)) - 10);
  }
  _csWatermark(ctx, W, H);
}

/* -- Canvas border overlay -- */
/* -- Returns safe inset pixels for each border style so content doesn't overlap -- */
function _csBorderInset(style) {
  switch (style) {
    case 'gold-frame':      return 20;
    case 'neon-glow':       return 20;
    case 'double-line':     return 18;
    case 'diagonal-strips': return 22;
    case 'rounded-glow':    return 22;
    case 'film-strip':      return 0; // film-strip uses strips at edges, handled separately
    default: return 0;
  }
}

function _csDrawCanvasBorder(ctx, W, H, style, accent) {
  ctx.save();
  switch (style) {
    case 'gold-frame': {
      // Outer glow
      ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 18;
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, W-8, H-8);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(254,240,138,0.5)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(14, 14, W-28, H-28);
      // Ornament corners
      const cs = 32;
      [[[4,4],[1,1]],[[W-4,4],[-1,1]],[[4,H-4],[1,-1]],[[W-4,H-4],[-1,-1]]].forEach(([[cx,cy],[sx,sy]])=>{
        ctx.strokeStyle='#f59e0b'; ctx.lineWidth=4;
        ctx.beginPath(); ctx.moveTo(cx+sx*cs,cy); ctx.lineTo(cx,cy); ctx.lineTo(cx,cy+sy*cs); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2); ctx.fillStyle='#f59e0b'; ctx.fill();
      });
      break;
    }
    case 'neon-glow': {
      const nc = accent || '#a78bfa';
      ctx.shadowColor = nc; ctx.shadowBlur = 22;
      ctx.strokeStyle = nc; ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, W-8, H-8);
      ctx.shadowBlur = 42; ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, W-8, H-8);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
      ctx.strokeRect(14, 14, W-28, H-28);
      break;
    }
    case 'double-line': {
      ctx.strokeStyle = accent || '#f59e0b'; ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, W-8, H-8);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(12, 12, W-24, H-24);
      break;
    }
    case 'diagonal-strips': {
      const inset = 18;
      // Clip to border region only (exclude center), no destination-out needed
      ctx.save();
      ctx.beginPath();
      // Outer rect (full canvas)
      ctx.rect(0, 0, W, H);
      // Inner rect cutout (clockwise = fill-rule excludes center)
      ctx.rect(inset, inset, W - inset * 2, H - inset * 2);
      ctx.clip('evenodd');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = accent || '#f59e0b';
      const sw = 14, gap = 20;
      ctx.beginPath();
      for (let x = -H; x < W + H; x += gap) {
        ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.lineTo(x + H + sw, H); ctx.lineTo(x + sw, 0);
      }
      ctx.fill();
      ctx.restore();
      // border outline
      ctx.strokeStyle = accent || '#f59e0b'; ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, W-8, H-8);
      break;
    }
    case 'rounded-glow': {
      ctx.shadowColor = accent || '#7c3aed'; ctx.shadowBlur = 28;
      ctx.strokeStyle = accent || '#7c3aed'; ctx.lineWidth = 5;
      _csRoundRectStroke(ctx, 6, 6, W-12, H-12, 24);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      _csRoundRectStroke(ctx, 16, 16, W-32, H-32, 18);
      break;
    }
    case 'film-strip': {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      const stripW = Math.round(W * 0.055);
      ctx.fillRect(0, 0, stripW, H);
      ctx.fillRect(W - stripW, 0, stripW, H);
      ctx.fillRect(0, 0, W, Math.round(H * 0.03));
      ctx.fillRect(0, H - Math.round(H * 0.03), W, Math.round(H * 0.03));
      // sprocket holes
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const holeH = stripW * 0.55, holeW = stripW * 0.55, holeR = 3;
      for (let y = holeH; y < H - holeH * 2; y += holeH * 2.4) {
        [stripW*0.22, W - stripW + stripW*0.22].forEach(hx => {
          _csRoundRectFill(ctx, hx, y, holeW, holeH, holeR);
        });
      }
      break;
    }
  }
  ctx.restore();
}

function _csRoundRectStroke(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x,y,w,h,r); else { ctx.rect(x,y,w,h); }
  ctx.stroke();
}
function _csRoundRectFill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x,y,w,h,r); else { ctx.rect(x,y,w,h); }
  ctx.fill();
}

/* -- Rounded rect helper -- */
function _csRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); }
  else {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  ctx.fill();
}

/* -- Download -- */
function csDownload() {
  const canvas = document.getElementById('csCanvas');
  if (!canvas) return;
  const a = document.createElement('a');
  a.download = `content-studio-${_csTab}-${Date.now()}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

/* -- Copy image -- */
async function csCopyImage() {
  const canvas = document.getElementById('csCanvas');
  if (!canvas) return;
  try {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
 if (typeof toast === 'function') toast('📋 Image copied!', 'success', 2000);
  } catch { if (typeof toast === 'function') toast('❌ Copy failed - use Download instead', 'error', 3000); }
}

/* -- Copy caption -- */
function csCopyCaption() {
  navigator.clipboard.writeText(_csCaption).then(() => {
 if (typeof toast === 'function') toast('📋 Caption copied!', 'success', 2000);
  });
}

/* -- AI Enhance Caption -- */
async function csAiEnhanceCaption() {
  if (!_csCaption) { if (typeof toast === 'function') toast('Generate content first!', 'error', 2500); return; }
  _csShowSpinner(true);
  _csSetStatus('🤖 Enhancing caption...');
  const prompt = `Improve this social media caption to make it more engaging, add relevant emojis, better hashtags, and a compelling call-to-action. Keep the same language (Nepali or English). Original:\n${_csCaption}\n\nReturn only the improved caption text, no extra explanation.`;
  const result = await _csCallAI(prompt);
  _csShowSpinner(false);
  if (result) {
    _csShowCaption(result.trim());
    _csSetStatus('✅ Caption enhanced!');
  } else {
    _csSetStatus('⚠️ Enhancement failed - try again');
  }
}

/* -- Share -- */
function csShare(platform) {
  const caption = (_csCaption || 'Shashi Creator Studio 🇳🇵') + '\n\n#ShashiCreatorStudio #Nepal #Viral #Trending';
  if (typeof _shareCanvasToSocial === 'function') {
    _shareCanvasToSocial(platform, 'csCanvas', caption, csDownload);
  }
}

/* ================================================================
   FEEDBACK MODAL
================================================================ */
function openFeedbackModal() {
  const m = document.getElementById('feedbackModal');
  if (m) { m.style.display = 'flex'; }
}
function closeFeedbackModal() {
  const m = document.getElementById('feedbackModal');
  if (m) m.style.display = 'none';
}
function submitFeedback(e) {
  e.preventDefault();
  const name = document.getElementById('fbName')?.value || '';
  const email = document.getElementById('fbEmail')?.value || '';
  const msg  = document.getElementById('fbMsg')?.value || '';
  const subject = encodeURIComponent(`Feedback from ${name || 'User'} — Shashi Creator Studio`);
  const body    = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${msg}`);
  window.open(`mailto:shashi19.jaiswal@gmail.com?subject=${subject}&body=${body}`, '_blank');
  closeFeedbackModal();
  if (typeof toast === 'function') toast('📤 Opening email client…', 'success', 2500);
}
// Close on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('feedbackModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFeedbackModal();
  });
});

/* ================================================================
   POLL / YES-NO GENERATOR
================================================================ */
function _csPollToggleChoices() {
  const type = document.getElementById('csPollType')?.value;
  const row  = document.getElementById('csPollCustomChoicesRow');
  if (row) row.style.display = type === 'custom' ? 'block' : 'none';
  csRenderBlank();
}

/* ── Poll multi-image state ── */
// Each entry: { img: Image, ox: number, oy: number }  (ox/oy = pan offset in %, −50..+50)
let _pollImages = [];

function csPollLoadImages(input) {
  const files = Array.from(input.files || []).slice(0, 4 - _pollImages.length);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        if (_pollImages.length < 4) {
          _pollImages.push({ img, ox: 0, oy: 0 });
          _csPollRenderThumbs();
          csQuick('poll');
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function _csPollRenderThumbs() {
  const wrap = document.getElementById('csPollPhotoThumbs');
  if (!wrap) return;
  if (!_pollImages.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = _pollImages.map((entry, i) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px">
      <div style="position:relative;display:inline-block">
        <img src="${entry.img.src}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:2px solid #7c3aed;display:block">
        <button onclick="csPollRemoveImage(${i})" style="position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1;padding:0" title="Remove">✕</button>
      </div>
      <span style="font-size:10px;color:rgba(255,255,255,0.5)">Pan ${_pollImages.length > 1 ? (i+1) : ''}</span>
      <div style="display:grid;grid-template-columns:24px 24px 24px;grid-template-rows:24px 24px 24px;gap:2px">
        <div></div>
        <button onclick="csPollPanImage(${i},0,-10)" style="${_panBtnStyle()}" title="Up">▲</button>
        <div></div>
        <button onclick="csPollPanImage(${i},-10,0)" style="${_panBtnStyle()}" title="Left">◀</button>
        <button onclick="csPollPanImage(${i},0,0,true)" style="${_panBtnStyle('reset')}" title="Reset">●</button>
        <button onclick="csPollPanImage(${i},10,0)" style="${_panBtnStyle()}" title="Right">▶</button>
        <div></div>
        <button onclick="csPollPanImage(${i},0,10)" style="${_panBtnStyle()}" title="Down">▼</button>
        <div></div>
      </div>
    </div>`
  ).join('');
}

function _panBtnStyle(type) {
  const base = 'width:24px;height:24px;border:none;border-radius:4px;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;';
  return type === 'reset'
    ? base + 'background:rgba(99,102,241,0.3);color:#a5b4fc;'
    : base + 'background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);';
}

function csPollPanImage(idx, dx, dy, reset) {
  if (!_pollImages[idx]) return;
  if (reset) {
    _pollImages[idx].ox = 0;
    _pollImages[idx].oy = 0;
  } else {
    _pollImages[idx].ox = Math.max(-50, Math.min(50, (_pollImages[idx].ox || 0) + dx));
    _pollImages[idx].oy = Math.max(-50, Math.min(50, (_pollImages[idx].oy || 0) + dy));
  }
  _csPollRenderThumbs();
  csQuick('poll');
}

function csPollRemoveImage(idx) {
  _pollImages.splice(idx, 1);
  _csPollRenderThumbs();
  csQuick('poll');
}

function csPollClearImages() {
  _pollImages = [];
  _csPollRenderThumbs();
  csQuick('poll');
}

/* Auto-search Wikipedia for a relevant image and load it into _pollImages */
async function _csPollAutoLoadWikiImage(searchTerm, fallbackTopic) {
  const tryLoad = async (term) => {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(term)}&prop=pageimages&format=json&pithumbsize=600&origin=*`;
    try {
      const r = await fetch(apiUrl);
      const data = await r.json();
      const pages = data?.query?.pages || {};
      const imgs = Object.values(pages).filter(p => p.thumbnail).map(p => p.thumbnail.source);
      return imgs[0] || null;
    } catch { return null; }
  };

  const tryOpenSearch = async (term) => {
    try {
      const r = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(term)}&limit=3&format=json&origin=*`);
      const d = await r.json();
      const titles = d[1] || [];
      for (const title of titles) {
        const url = await tryLoad(title);
        if (url) return url;
      }
    } catch {}
    return null;
  };

  let imgUrl = await tryLoad(searchTerm) || await tryOpenSearch(searchTerm);
  if (!imgUrl && fallbackTopic !== searchTerm) {
    imgUrl = await tryOpenSearch(fallbackTopic);
  }
  if (!imgUrl) return;

  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      _pollImages = [{ img, ox: 0, oy: 0 }];
      _csPollRenderThumbs();
      resolve();
    };
    img.onerror = () => resolve();
    img.src = imgUrl;
  });
}

function _csRenderPoll(data) {
  const { ctx, W, H } = _csGetCanvas();
  if (!ctx) return;

  const bgKey    = _csActiveBg('csPollBgSwatches') || 'poll-navy';
  const layout   = document.getElementById('csPollLayout')?.value || 'image-top';
  const question = data?.question || document.getElementById('csPollCaption')?.value?.trim() || 'तपाईंको मत के छ? / What is your opinion?';
  const customMsg = document.getElementById('csPollCustomMsg')?.value?.trim() || '';
  const pollType = document.getElementById('csPollType')?.value || 'yesno';
  let choices    = pollType === 'yesno' ? ['YES', 'NO'] :
    (document.getElementById('csPollChoices')?.value || 'Option A\nOption B').split('\n').filter(Boolean).slice(0, 4);
  if (data?.choices) choices = data.choices;
  // Support multi-image (_pollImages) or legacy single photo
  const photos = _pollImages.length ? _pollImages : (_csPhotos['poll'] ? [{ img: _csPhotos['poll'], ox: 0, oy: 0 }] : []);
  const photo  = photos[0]?.img || null;   // primary image (for fullbg / image-top / image-middle)
  const photoOx = photos[0]?.ox || 0;
  const photoOy = photos[0]?.oy || 0;

  // ── Professional theme palettes ──
  const pollThemes = {
    'poll-navy':       { bg0:'#040816', bg1:'#0a0f2e', bg2:'#1a2a6c', yes:'#1d4ed8', no:'#dc2626', accent:'#60a5fa', accent2:'#fbbf24', choiceColors:['#1d4ed8','#dc2626','#7c3aed','#059669'] },
    'gradient-dark':   { bg0:'#050510', bg1:'#0f172a', bg2:'#1e293b', yes:'#7c3aed', no:'#ef4444', accent:'#a78bfa', accent2:'#fde68a', choiceColors:['#7c3aed','#ef4444','#3b82f6','#10b981'] },
    'poll-charcoal':   { bg0:'#050505', bg1:'#111111', bg2:'#222222', yes:'#f59e0b', no:'#ef4444', accent:'#f59e0b', accent2:'#ffffff', choiceColors:['#f59e0b','#ef4444','#3b82f6','#10b981'] },
    'gradient-purple': { bg0:'#150530', bg1:'#2e1065', bg2:'#4c1d95', yes:'#a855f7', no:'#f43f5e', accent:'#d8b4fe', accent2:'#fde68a', choiceColors:['#a855f7','#f43f5e','#38bdf8','#34d399'] },
    'gradient-blue':   { bg0:'#030e20', bg1:'#0f2040', bg2:'#1e3a5f', yes:'#2563eb', no:'#dc2626', accent:'#93c5fd', accent2:'#fde68a', choiceColors:['#2563eb','#dc2626','#7c3aed','#10b981'] },
    'gradient-red':    { bg0:'#1a0000', bg1:'#450a0a', bg2:'#7f1d1d', yes:'#ef4444', no:'#1d4ed8', accent:'#fca5a5', accent2:'#fef9c3', choiceColors:['#16a34a','#dc2626','#2563eb','#f59e0b'] },
    'gradient-teal':   { bg0:'#00100e', bg1:'#042f2e', bg2:'#065f46', yes:'#0d9488', no:'#dc2626', accent:'#5eead4', accent2:'#fde68a', choiceColors:['#0d9488','#dc2626','#2563eb','#f59e0b'] },
    'gradient-gold':   { bg0:'#1a0800', bg1:'#451a03', bg2:'#78350f', yes:'#d97706', no:'#dc2626', accent:'#fbbf24', accent2:'#ffffff', choiceColors:['#d97706','#dc2626','#2563eb','#059669'] },
  };
  const th = pollThemes[bgKey] || pollThemes['poll-navy'];

  // ── Background ──
  ctx.clearRect(0, 0, W, H);
  const bgGrad = ctx.createRadialGradient(W*0.3, H*0.2, 0, W*0.5, H*0.5, H*0.95);
  bgGrad.addColorStop(0, th.bg2); bgGrad.addColorStop(0.55, th.bg1); bgGrad.addColorStop(1, th.bg0);
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

  // Subtle grid pattern
  ctx.save(); ctx.globalAlpha = 0.04; ctx.strokeStyle = th.accent; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();

  // Top accent bar
  ctx.fillStyle = th.accent + 'aa'; ctx.fillRect(0, 0, W, 4);

  const WMARK_H = Math.round(34 * Math.min(W/600,1));
  const pad     = Math.round(W * 0.05);
  const innerW  = W - pad * 2;
  let curY      = 14;

  // Helper: draw image with cover-fill + pan offset (ox/oy in % of overflow, −50..+50)
  function _pollDrawImg(img, ox, oy, dx, dy, dw, dh) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s  = Math.max(dw / iw, dh / ih);
    const baseX = dx + (dw - iw * s) / 2;
    const baseY = dy + (dh - ih * s) / 2;
    const overflowX = Math.abs(dw - iw * s);
    const overflowY = Math.abs(dh - ih * s);
    const px = baseX + (ox / 100) * overflowX;
    const py = baseY + (oy / 100) * overflowY;
    ctx.drawImage(img, px, py, iw * s, ih * s);
  }

  // ── PHOTO placement ──
  const photoH_top    = Math.round(H * 0.50);  // large image fills top half
  const photoH_middle = Math.round(H * 0.32);

  if (photo && layout === 'image-top') {
    if (photos.length > 1) {
      // Horizontal strip: divide width equally among all images
      const stripH = photoH_top;
      const imgW   = Math.round(W / photos.length);
      photos.forEach((entry, i) => {
        const ix = i * imgW;
        ctx.save();
        ctx.beginPath(); ctx.rect(ix, 0, imgW, stripH); ctx.clip();
        _pollDrawImg(entry.img, entry.ox, entry.oy, ix, 0, imgW, stripH);
        // Minimal bottom-only scrim so text below remains readable
        const ov = ctx.createLinearGradient(0, stripH * 0.55, 0, stripH);
        ov.addColorStop(0,'rgba(0,0,0,0)'); ov.addColorStop(1,'rgba(0,0,0,0.38)');
        ctx.fillStyle = ov; ctx.fillRect(ix,0,imgW,stripH);
        // Separator line between images
        if (i > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(ix,0); ctx.lineTo(ix,stripH); ctx.stroke();
        }
        ctx.restore();
      });
      curY = stripH + 6;
    } else {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, photoH_top); ctx.clip();
      _pollDrawImg(photo, photoOx, photoOy, 0, 0, W, photoH_top);
      // Minimal bottom scrim only
      const ov = ctx.createLinearGradient(0, photoH_top * 0.55, 0, photoH_top);
      ov.addColorStop(0,'rgba(0,0,0,0)'); ov.addColorStop(1,'rgba(0,0,0,0.40)');
      ctx.fillStyle = ov; ctx.fillRect(0,0,W,photoH_top);
      ctx.restore();
      curY = photoH_top + 6;
    }
  } else if (photo && layout === 'fullbg') {
    ctx.save();
    ctx.beginPath(); ctx.rect(0,0,W,H-WMARK_H-4); ctx.clip();
    ctx.globalAlpha = 0.72;
    _pollDrawImg(photo, photoOx, photoOy, 0, 0, W, H);
    ctx.globalAlpha = 1;
    // Dark vignette to keep text readable without killing brightness
    const vig = ctx.createRadialGradient(W/2, H/2, H*0.15, W/2, H/2, H*0.75);
    vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,0.52)');
    ctx.fillStyle = vig; ctx.fillRect(0,0,W,H);
    ctx.restore();
    curY = 18;
    // For fullbg, we'll pin the text block to bottom — mark this so question/buttons anchor there
  }

  // ── Question text ──
  const qFS = Math.round(Math.min(W*0.052, 30));

  // For fullbg: pre-compute total block height and anchor to bottom
  if (layout === 'fullbg') {
    // Estimate question lines
    ctx.save();
    ctx.font = `bold ${qFS}px "Segoe UI", Arial, sans-serif`;
    const qLinesEst = _csWrapTextArray(ctx, question, innerW);
    ctx.restore();
    const qBlockH = qFS * 1.35 * qLinesEst.length + 14;

    // Estimate customMsg lines
    const scale2 = Math.min(W / 600, H / 600, 1.4);
    const msgFS2 = customMsg ? Math.round(Math.min(W * 0.038, 20) * scale2) : 0;
    let msgBlockH2 = 0;
    if (customMsg && msgFS2) {
      ctx.save();
      ctx.font = `600 ${msgFS2}px "Segoe UI", Arial, sans-serif`;
      const ml = _csWrapTextArray(ctx, customMsg, innerW);
      msgBlockH2 = ml.length * msgFS2 * 1.3 + 8;
      ctx.restore();
    }

    // Estimate button block height
    const btnHEst = Math.round(Math.min(W * 0.15, H * 0.14, 72) * scale2);
    const totalEst = qBlockH + msgBlockH2 + btnHEst + 16;
    curY = H - WMARK_H - totalEst - 18;
  }

  ctx.save();
  ctx.font = `bold ${qFS}px "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  const qLines = _csWrapTextArray(ctx, question, innerW);
  qLines.forEach((line, i) => ctx.fillText(line, W/2, curY + i * qFS * 1.35));
  ctx.restore();
  curY += qFS * 1.35 * qLines.length + (layout === 'image-top' ? 6 : 14);

  // ── Image Middle (centred between question and choices) ──
  if (photo && layout === 'image-middle') {
    curY += 18; // extra top padding so image sits lower
    if (photos.length > 1) {
      // Horizontal strip across full width
      const stripH = photoH_middle;
      const imgW   = Math.round(W / photos.length);
      photos.forEach((entry, i) => {
        const ix = i * imgW;
        ctx.save();
        ctx.beginPath(); ctx.rect(ix, curY, imgW, stripH); ctx.clip();
        _pollDrawImg(entry.img, entry.ox, entry.oy, ix, curY, imgW, stripH);
        if (i > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(ix, curY); ctx.lineTo(ix, curY + stripH); ctx.stroke();
        }
        ctx.restore();
      });
      // Accent border around entire strip
      ctx.save(); ctx.strokeStyle = th.accent; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.7;
      ctx.strokeRect(0, curY, W, stripH); ctx.restore();
      curY += stripH + 14;
    } else {
      const imgW = Math.round(W * 0.70);
      const imgX = (W - imgW) / 2;
      const r    = Math.round(imgW * 0.04);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(imgX, curY, imgW, photoH_middle, r) : ctx.rect(imgX, curY, imgW, photoH_middle);
      ctx.clip();
      _pollDrawImg(photo, photoOx, photoOy, imgX, curY, imgW, photoH_middle);
      ctx.restore();
      // Border ring
      ctx.save();
      ctx.strokeStyle = th.accent; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(imgX, curY, imgW, photoH_middle, r) : ctx.rect(imgX, curY, imgW, photoH_middle);
      ctx.stroke(); ctx.restore();
      curY += photoH_middle + 14;
    }
  }

  // Button dimensions — compact, capped so they never dominate the canvas
  const remainingH = H - WMARK_H - curY - 12;
  const scale = Math.min(W / 600, H / 600, 1.4);
  const msgFS = customMsg ? Math.round(Math.min(W * 0.038, 20) * scale) : 0;

  // Pre-measure custom message height so buttons sit below it
  let msgBlockH = 0;
  if (customMsg && msgFS) {
    ctx.save();
    ctx.font = `600 ${msgFS}px "Segoe UI", Arial, sans-serif`;
    const msgLines = _csWrapTextArray(ctx, customMsg, innerW);
    msgBlockH = msgLines.length * msgFS * 1.3 + 8;
    ctx.restore();
  }

  const maxBtnH    = Math.round(Math.min(W * 0.15, H * 0.14, 72) * scale);
  const choiceCount  = choices.length;
  const sideBySide   = choiceCount === 2;

  // Button size same across all layouts
  const btnH = sideBySide
    ? Math.min(maxBtnH, Math.round((remainingH - msgBlockH) * 0.70))
    : Math.min(maxBtnH, Math.round((remainingH - msgBlockH - (choiceCount - 1) * 8) / choiceCount));

  const btnFS      = Math.round(Math.min(btnH * 0.34, W * 0.042, 22));
  const btnAreaH   = sideBySide ? btnH : choiceCount * btnH + (choiceCount - 1) * 8;
  const totalBlock = msgBlockH + btnAreaH;
  // For image-top: flow directly below question (no centering gap). Other layouts: centre vertically.
  const blockStartY = (layout === 'image-top')
    ? curY + 8
    : curY + Math.round((remainingH - totalBlock) / 2);

  // ── Custom message — rendered directly above choices ──
  if (customMsg && msgFS) {
    ctx.save();
    ctx.font = `600 ${msgFS}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = th.accent2 || '#fbbf24';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    const msgLines = _csWrapTextArray(ctx, customMsg, innerW);
    msgLines.forEach((ln, i) => ctx.fillText(ln, W / 2, blockStartY + i * msgFS * 1.3));
    ctx.restore();
  }

  const btnStartY = blockStartY + msgBlockH;
  const emojiYN    = pollType === 'yesno';

  if (sideBySide) {
    // Two buttons side by side with gap
    const gap    = Math.round(W * 0.04);
    const bw     = Math.round((innerW - gap) / 2);
    const by     = btnStartY;
    const yesX   = pad;
    const noX    = pad + bw + gap;
    const cols   = [th.yes, th.no];
    const labels = emojiYN ? ['✅  YES', '❌  NO'] : choices;
    const emojis = emojiYN ? ['✅','❌'] : ['🔵','🔴'];

    [yesX, noX].forEach((bx, i) => {
      const col = cols[i];
      // Glow
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.globalAlpha = 0.35;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, btnH, btnH*0.12) : ctx.rect(bx, by, bw, btnH); ctx.fill();
      ctx.restore();
      // Button fill
      ctx.save(); ctx.globalAlpha = 0.92;
      const bGrad = ctx.createLinearGradient(bx, by, bx, by+btnH);
      bGrad.addColorStop(0, col + 'ee'); bGrad.addColorStop(1, col + '99');
      ctx.fillStyle = bGrad;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, btnH, btnH*0.12) : ctx.rect(bx, by, bw, btnH); ctx.fill();
      ctx.restore();
      // Emoji
      ctx.save(); ctx.font = `${Math.round(btnH*0.38)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(emojis[i], bx + bw/2, by + btnH*0.33);
      ctx.restore();
      // Label
      ctx.save();
      ctx.font = `900 ${btnFS}px "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
      ctx.fillText(labels[i].replace(/^[✅❌]\s*/,''), bx + bw/2, by + btnH*0.70);
      ctx.restore();
    });
  } else {
    // Multiple choices stacked
    choices.forEach((choice, i) => {
      const by = btnStartY + i * (btnH + 8);
      const col = th.choiceColors[i % th.choiceColors.length];
      // Glow
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.globalAlpha = 0.25;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(pad, by, innerW, btnH, btnH*0.35) : ctx.rect(pad, by, innerW, btnH); ctx.fill();
      ctx.restore();
      // Fill
      ctx.save(); ctx.globalAlpha = 0.88;
      const bGrad = ctx.createLinearGradient(pad, by, W-pad, by);
      bGrad.addColorStop(0, col+'dd'); bGrad.addColorStop(1, col+'88');
      ctx.fillStyle = bGrad;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(pad, by, innerW, btnH, btnH*0.35) : ctx.rect(pad, by, innerW, btnH); ctx.fill();
      ctx.restore();
      // Label
      ctx.save();
      ctx.font = `bold ${btnFS}px "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
      ctx.fillText(choice, W/2, by + btnH/2);
      ctx.restore();
    });
  }

  _csWatermark(ctx, W, H);
}

// Helper: wrap text and return array of lines
function _csWrapTextArray(ctx, text, maxW) {
  const words = text.split(' ');
  let line = '', lines = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
