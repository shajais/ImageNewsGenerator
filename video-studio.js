/* ================================================================
   VIDEO STUDIO — CapCut-killer Reel / Shorts editor
   Pure browser (Canvas + Web Audio + MediaRecorder)
   No server needed. Pure client-side magic.
   ================================================================ */

'use strict';

/* ── state ──────────────────────────────────────────── */
const VS = {
  clips        : [],          // [{type:'img'|'vid', src, file, duration, speed, filter, kenBurns, textOverlay, transition}]
  activeClip   : 0,
  playing      : false,
  globalFilter : 'none',
  preset       : 'cinematic',
  aspectRatio  : '9:16',      // '9:16' | '1:1' | '16:9'
  textLayers   : [],          // [{text, style, x, y, size, color, animIn}]
  audioTrack   : null,        // { name, url, AudioBuffer }
  audioOffset  : 0,
  beatMarkers  : [],          // seconds
  totalDuration: 0,
  currentTime  : 0,
  recordedChunks:[],
  mediaRecorder: null,
  _raf         : null,
  _playStart   : 0,
  _clipStart   : 0,
  _clipIdx     : 0,
  canvas       : null,
  ctx          : null,
  audioCtx     : null,
  gainNode     : null,
  _audioSrc    : null,
  _lastThumb   : {},
};

/* ── presets ─────────────────────────────────────────── */
const VS_PRESETS = {
  cinematic : { filter:'contrast(1.15) saturate(0.85) brightness(0.95)', lut:'cinematic', textColor:'#fff', overlayAlpha:0.18, overlayColor:'#000', vignette:true  },
  aesthetic : { filter:'saturate(1.4) brightness(1.05) hue-rotate(8deg)', lut:'aesthetic', textColor:'#ffe4e6', overlayAlpha:0.12, overlayColor:'#7c3aed', vignette:false },
  vlog      : { filter:'brightness(1.1) contrast(1.05) saturate(1.2)', lut:'vlog', textColor:'#fff', overlayAlpha:0.08, overlayColor:'#000', vignette:false },
  news      : { filter:'grayscale(0.15) contrast(1.2) brightness(0.98)', lut:'news', textColor:'#fff', overlayAlpha:0.22, overlayColor:'#0f172a', vignette:true  },
  motivational:{ filter:'saturate(1.6) contrast(1.1)', lut:'motivational', textColor:'#fde68a', overlayAlpha:0.10, overlayColor:'#7c2d12', vignette:false },
  vintage   : { filter:'sepia(0.45) contrast(1.1) brightness(0.95) saturate(0.8)', lut:'vintage', textColor:'#fef3c7', overlayAlpha:0.18, overlayColor:'#78350f', vignette:true  },
  neon      : { filter:'brightness(0.9) saturate(2) contrast(1.1)', lut:'neon', textColor:'#f0abfc', overlayAlpha:0.0, overlayColor:'#000', vignette:true  },
  blackwhite: { filter:'grayscale(1) contrast(1.2)', lut:'bw', textColor:'#fff', overlayAlpha:0.10, overlayColor:'#000', vignette:true  },
};

const VS_TRANSITIONS = ['none','fade','slide-left','slide-right','zoom-in','zoom-out','glitch','whip-pan','flash','blur'];
const VS_TEXT_STYLES = ['bold-center','subtitle','title-top','caption-bottom','glitch-text','neon-text','typewriter','split-reveal'];
const VS_ASPECT = { '9:16':{w:1080,h:1920}, '1:1':{w:1080,h:1080}, '16:9':{w:1920,h:1080} };

/* royalty-free / demo tracks list (YouTube Audio Library URLs or user-provided) */
const VS_TRACKS = [
  { name:'🎵 Epic Cinematic Rise',    bpm:120, mood:'epic',       url:'https://cdn.pixabay.com/audio/2023/11/06/audio_f1b3e3c5a6.mp3' },
  { name:'🔥 Trap Beat (Viral)',       bpm:140, mood:'hype',       url:'https://cdn.pixabay.com/audio/2023/05/24/audio_0a1a5e86d3.mp3' },
  { name:'💫 Lofi Aesthetic Chill',    bpm:80,  mood:'chill',      url:'https://cdn.pixabay.com/audio/2023/02/28/audio_856f1f47aa.mp3' },
  { name:'🌟 Motivational Upbeat',     bpm:128, mood:'motivation', url:'https://cdn.pixabay.com/audio/2022/10/25/audio_0c3b9f7e1b.mp3' },
  { name:'😂 Comedy Boing Vlog',       bpm:100, mood:'fun',        url:'https://cdn.pixabay.com/audio/2022/03/15/audio_6f8e8e81d3.mp3' },
  { name:'🕉️ Devotional Flute',        bpm:60,  mood:'spiritual',  url:'https://cdn.pixabay.com/audio/2022/01/20/audio_d08522dfb0.mp3' },
  { name:'🏙️ Urban Hip-Hop Swagger',   bpm:95,  mood:'swag',       url:'https://cdn.pixabay.com/audio/2023/06/07/audio_a04f1e0d80.mp3' },
  { name:'🌊 Peaceful Ambient',        bpm:70,  mood:'peaceful',   url:'https://cdn.pixabay.com/audio/2022/08/04/audio_2dde668d05.mp3' },
];

/* ── Canvas click to upload ─────────────────────────── */
function vsCanvasClick() {
  // Only trigger file picker if clicking on an empty canvas (no clip active) OR always allow
  document.getElementById('vsFileInput').click();
}

/* ── Mobile panel tabs ──────────────────────────────── */
function vsMobileTab(panel) {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) return;
  document.querySelectorAll('.vs-mobile-tab').forEach((t, i) => {
    const panels = ['left','center','right'];
    t.classList.toggle('active', panels[i] === panel);
  });
  const left   = document.getElementById('vsPanelLeft');
  const center = document.getElementById('vsPanelCenter');
  const right  = document.getElementById('vsPanelRight');
  // On mobile, center is always a div.vs-center not vs-panel, so handle separately
  if (left)   { left.classList.toggle('vs-mobile-open',   panel === 'left');   }
  if (right)  { right.classList.toggle('vs-mobile-open',  panel === 'right');  }
  // Center always visible on mobile via flex order, just scroll to it
  if (panel === 'center' && center) center.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function openVideoStudio() {
  // hide other modals / container
  const hide = ['contentStudioModal','memeStudioModal','puzzleStudioModal','newsStudioModal'];
  hide.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const footer = document.querySelector('footer');
  if (footer) footer.style.display = 'none';

  document.getElementById('videoStudioModal').style.display = 'block';
  document.body.style.overflow = 'hidden';

  // highlight nav button
  ['newsStudioBtn','memeStudioBtn','puzzleStudioBtn','contentStudioBtn','videoStudioBtn'].forEach(id =>
    document.getElementById(id)?.classList.remove('active-studio-btn'));
  document.getElementById('videoStudioBtn')?.classList.add('active-studio-btn');

  vsInit();
}
function closeVideoStudio() {
  document.getElementById('videoStudioModal').style.display = 'none';
  document.body.style.overflow = '';
  const footer = document.querySelector('footer');
  if (footer) footer.style.display = '';
  document.getElementById('videoStudioBtn')?.classList.remove('active-studio-btn');
  vsStop();
}

function vsInit() {
  VS.canvas = document.getElementById('vsPreviewCanvas');
  VS.ctx    = VS.canvas.getContext('2d');
  vsSetAspect(VS.aspectRatio);
  vsRenderPlaceholder();
  vsRebuildTimeline();
  vsUpdateStats();
  // keyboard shortcuts
  document.addEventListener('keydown', vsKeyHandler, { once: false });
  // Show canvas upload hint when empty
  _vsUpdateCanvasHint();
}

function vsKeyHandler(e) {
  const modal = document.getElementById('videoStudioModal');
  if (!modal || modal.style.display === 'none') return;
  if (e.code === 'Space') { e.preventDefault(); VS.playing ? vsStop() : vsPlay(); }
  if (e.code === 'KeyR')  { e.preventDefault(); vsExport(); }
}

/* ── aspect ratio ───────────────────────────────────── */
function vsSetAspect(ratio) {
  VS.aspectRatio = ratio;
  const dim = VS_ASPECT[ratio] || VS_ASPECT['9:16'];
  const preview = document.getElementById('vsPreviewWrap');
  // Scale for preview (max 360px tall)
  const scale = Math.min(360 / dim.h, 640 / dim.w);
  VS.canvas.width  = dim.w;
  VS.canvas.height = dim.h;
  VS.canvas.style.width  = Math.round(dim.w * scale) + 'px';
  VS.canvas.style.height = Math.round(dim.h * scale) + 'px';
  document.querySelectorAll('.vs-aspect-btn').forEach(b => b.classList.toggle('active', b.dataset.ratio === ratio));
  vsRenderPlaceholder();
}

/* ── file upload ────────────────────────────────────── */
function vsHandleFiles(files) {
  const arr = Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
  if (!arr.length) return vsToast('❌ Please upload images or videos only');
  arr.forEach(f => vsAddClip(f));
}

function vsAddClip(file) {
  const type = file.type.startsWith('video/') ? 'vid' : 'img';
  const url  = URL.createObjectURL(file);
  const clip = {
    type, src: url, file, name: file.name,
    duration : type === 'img' ? 3 : null,
    speed    : 1,
    filter   : 'inherit',
    kenBurns : 'zoom-in',
    transition: 'fade',
    textOverlay: '',
    textPos  : 'bottom',
    trimStart: 0,
    trimEnd  : null,
    _imgEl   : null,
    _vidEl   : null,
    hasAudio : false,
  };
  if (type === 'img') {
    const img = new Image();
    img.onload = () => { clip._imgEl = img; vsRebuildTimeline(); vsUpdateStats(); if (VS.clips.length === 1) vsRenderClip(0, 0); };
    img.src = url;
  } else {
    const vid = document.createElement('video');
    vid.src = url;
    vid.muted = true;  // muted ONLY for canvas drawing — audio handled separately via Web Audio
    vid.preload = 'auto';
    vid.crossOrigin = 'anonymous';
    vid.onloadedmetadata = () => {
      clip.duration = vid.duration / clip.speed;
      clip.trimEnd  = vid.duration;
      clip._vidEl   = vid;
      // Check if video has audio
      clip.hasAudio = (vid.mozHasAudio !== undefined ? vid.mozHasAudio :
                       vid.webkitAudioDecodedByteCount !== undefined ? vid.webkitAudioDecodedByteCount > 0 : true);
      vsRebuildTimeline(); vsUpdateStats();
      if (VS.clips.length === 1) vsRenderClip(0, 0);
    };
    // Preload fully to avoid pausing/stuttering during playback
    vid.load();
  }
  VS.clips.push(clip);
  vsRebuildTimeline();
  vsToast('✅ Added: ' + file.name.substring(0, 30));
}

/* ── timeline ───────────────────────────────────────── */
function vsRebuildTimeline() {
  const tl = document.getElementById('vsTimeline');
  if (!tl) return;
  tl.innerHTML = '';

  VS.totalDuration = VS.clips.reduce((s, c) => s + (c.duration || 3), 0);

  VS.clips.forEach((clip, i) => {
    const dur = clip.duration || 3;
    const pct = VS.totalDuration > 0 ? Math.max(6, (dur / VS.totalDuration) * 100) : 12;
    const div = document.createElement('div');
    div.className = 'vs-tl-clip' + (i === VS.activeClip ? ' vs-tl-active' : '');
    div.style.width = pct + '%';
    div.dataset.idx = i;
    div.innerHTML = `
      <div class="vs-tl-thumb" id="vsThumb${i}">
        ${clip.type === 'vid' ? '🎬' : '🖼️'}
      </div>
      <div class="vs-tl-label">${_vsShortName(clip.name)} · ${dur.toFixed(1)}s</div>
      <div class="vs-tl-dur">${vsSpeedLabel(clip.speed)}</div>
      <button class="vs-tl-del" onclick="vsDeleteClip(${i})" title="Delete">✕</button>`;
    div.onclick = (e) => { if (!e.target.classList.contains('vs-tl-del')) vsSelectClip(i); };
    tl.appendChild(div);
    // generate thumb
    _vsGenThumb(clip, i);
  });

  // add clip button
  const add = document.createElement('div');
  add.className = 'vs-tl-add';
  add.innerHTML = '<label for="vsFileInput">＋ Add</label>';
  tl.appendChild(add);

  vsUpdateStats();
  _vsUpdateCanvasHint();
}

function _vsUpdateCanvasHint() {
  // When no clips, canvas itself shows an upload prompt — show hint overlay too
  const hint = document.getElementById('vsCanvasUploadHint');
  const wrap = document.getElementById('vsPreviewWrap');
  if (!hint || !wrap) return;
  if (!VS.clips.length) {
    hint.style.opacity = '1';
    wrap.title = 'Click to add photos/videos';
  } else {
    hint.style.opacity = '0';
    wrap.title = 'Click to add more photos/videos';
  }
}

function _vsShortName(n) { return (n||'clip').replace(/\.[^.]+$/, '').substring(0,12); }

function _vsGenThumb(clip, i) {
  if (VS._lastThumb[i]) return;
  if (clip._imgEl) {
    const tc = document.createElement('canvas'); tc.width=60; tc.height=60;
    const tx = tc.getContext('2d');
    tx.drawImage(clip._imgEl, 0, 0, 60, 60);
    const el = document.getElementById('vsThumb' + i);
    if (el) { el.innerHTML=''; const img=document.createElement('img'); img.src=tc.toDataURL(); img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:4px'; el.appendChild(img); }
    VS._lastThumb[i] = true;
  } else if (clip._vidEl) {
    clip._vidEl.currentTime = 0.1;
    clip._vidEl.onseeked = () => {
      const tc = document.createElement('canvas'); tc.width=60; tc.height=60;
      tc.getContext('2d').drawImage(clip._vidEl, 0, 0, 60, 60);
      const el = document.getElementById('vsThumb' + i);
      if (el) { el.innerHTML=''; const img=document.createElement('img'); img.src=tc.toDataURL(); img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:4px'; el.appendChild(img); }
      VS._lastThumb[i] = true;
    };
  }
}

function vsDeleteClip(i) {
  VS.clips.splice(i, 1);
  delete VS._lastThumb[i];
  if (VS.activeClip >= VS.clips.length) VS.activeClip = Math.max(0, VS.clips.length - 1);
  vsRebuildTimeline();
  if (VS.clips.length) vsRenderClip(VS.activeClip, 0);
  else vsRenderPlaceholder();
}

function vsSelectClip(i) {
  VS.activeClip = i;
  vsRebuildTimeline();
  vsRenderClip(i, 0);
  vsPopulateClipControls(i);
}

function vsPopulateClipControls(i) {
  const c = VS.clips[i];
  if (!c) return;
  const sp = document.getElementById('vsClipSpeed');
  const kb = document.getElementById('vsClipKenBurns');
  const tr = document.getElementById('vsClipTransition');
  const dur = document.getElementById('vsClipDuration');
  const txt = document.getElementById('vsClipText');
  const tp  = document.getElementById('vsClipTextPos');
  if (sp)  sp.value  = c.speed;
  if (kb)  kb.value  = c.kenBurns;
  if (tr)  tr.value  = c.transition;
  if (dur) { dur.value = c.duration || 3; dur.disabled = c.type === 'vid'; }
  if (txt) txt.value = c.textOverlay || '';
  if (tp)  tp.value  = c.textPos || 'bottom';
}

/* ── clip settings ──────────────────────────────────── */
function vsApplyClipSpeed(val) {
  const c = VS.clips[VS.activeClip]; if (!c) return;
  c.speed = parseFloat(val) || 1;
  if (c.type === 'vid' && c._vidEl) {
    c.duration = (c.trimEnd || c._vidEl.duration) / c.speed;
  }
  vsRebuildTimeline();
  document.getElementById('vsSpeedLabel').textContent = vsSpeedLabel(c.speed);
}

function vsSpeedLabel(s) {
  s = parseFloat(s) || 1;
  if (s <= 0.25) return '🐢 0.25x';
  if (s <= 0.5)  return '🐌 0.5x';
  if (s === 1)   return '▶️ 1x';
  if (s <= 2)    return '⚡ 2x';
  if (s <= 4)    return '🚀 4x';
  return s + 'x';
}

function vsApplyKenBurns(val) {
  const c = VS.clips[VS.activeClip]; if (!c) return;
  c.kenBurns = val;
}
function vsApplyTransition(val) {
  const c = VS.clips[VS.activeClip]; if (!c) return;
  c.transition = val;
}
function vsApplyClipDuration(val) {
  const c = VS.clips[VS.activeClip]; if (!c || c.type === 'vid') return;
  c.duration = parseFloat(val) || 3;
  vsRebuildTimeline();
}
function vsApplyClipText(val) {
  const c = VS.clips[VS.activeClip]; if (!c) return;
  c.textOverlay = val;
}
function vsApplyClipTextPos(val) {
  const c = VS.clips[VS.activeClip]; if (!c) return;
  c.textPos = val;
}

/* ── render engine ──────────────────────────────────── */
function vsRenderPlaceholder() {
  const { ctx, canvas: cv } = VS;
  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(124,58,237,0.2)';
  ctx.fillRect(0, 0, cv.width, cv.height);
  // grid lines
  ctx.strokeStyle = 'rgba(139,92,246,0.15)';
  ctx.lineWidth = 1;
  for (let x = 0; x < cv.width; x += 80) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,cv.height); ctx.stroke(); }
  for (let y = 0; y < cv.height; y += 80) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(cv.width,y); ctx.stroke(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Clickable area indicator
  ctx.fillStyle = 'rgba(139,92,246,0.15)';
  const bw = cv.width * 0.65, bh = cv.height * 0.22;
  const bx = (cv.width - bw)/2, by = cv.height/2 - bh/2 - 10;
  _vsRoundRect(ctx, bx, by, bw, bh, 18);
  ctx.strokeStyle = 'rgba(139,92,246,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); _vsRoundRectPath(ctx, bx, by, bw, bh, 18); ctx.stroke();

  ctx.fillStyle = 'rgba(200,180,255,0.9)';
  ctx.font = `bold ${Math.round(cv.width * 0.065)}px sans-serif`;
  ctx.fillText('📸 Click Here', cv.width/2, cv.height/2 - 22);
  ctx.font = `${Math.round(cv.width * 0.033)}px sans-serif`;
  ctx.fillStyle = 'rgba(196,181,253,0.8)';
  ctx.fillText('to add Photos & Videos', cv.width/2, cv.height/2 + 26);
  ctx.font = `${Math.round(cv.width * 0.026)}px sans-serif`;
  ctx.fillStyle = 'rgba(148,163,184,0.6)';
  ctx.fillText('or drag & drop in the left panel', cv.width/2, cv.height/2 + 58);
}

function vsRenderClip(idx, progress) {
  const c = VS.clips[idx]; if (!c) { vsRenderPlaceholder(); return; }
  const { ctx, canvas: cv } = VS;
  const p = VS_PRESETS[VS.preset] || VS_PRESETS.cinematic;

  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);

  // Ken Burns transform
  const kb = _vsKenBurnsMatrix(c.kenBurns, progress, cv.width, cv.height);
  ctx.save();
  ctx.transform(kb.sx, 0, 0, kb.sy, kb.tx, kb.ty);

  if (c._imgEl) {
    const img = c._imgEl;
    const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
    // cover: fill canvas maintaining aspect ratio (no distortion)
    const scale = Math.max(cv.width/iw, cv.height/ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cv.width - dw) / 2, dy = (cv.height - dh) / 2;
    ctx.filter = p.filter;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.filter = 'none';
  } else if (c._vidEl) {
    const vid = c._vidEl;
    const vw = vid.videoWidth || cv.width, vh = vid.videoHeight || cv.height;
    // cover: fill canvas maintaining aspect ratio (no distortion)
    const scale = Math.max(cv.width/vw, cv.height/vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = (cv.width - dw)/2, dy = (cv.height - dh)/2;
    ctx.filter = p.filter;
    ctx.drawImage(vid, dx, dy, dw, dh);
    ctx.filter = 'none';
    // Watermark removal: blur bottom-right and top-left corners
    const wmRemove = document.getElementById('vsWatermarkRemove')?.checked;
    if (wmRemove) _vsBlurWatermarkZones(ctx, cv);
  }
  ctx.restore();

  // Colour overlay
  if (p.overlayAlpha > 0) {
    ctx.fillStyle = p.overlayColor;
    ctx.globalAlpha = p.overlayAlpha;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
  }

  // Vignette
  if (p.vignette) _vsDrawVignette(ctx, cv.width, cv.height);

  // Transition flash / overlay
  if (c.transition !== 'none' && progress < 0.12) _vsDrawTransitionIn(ctx, cv, c.transition, progress);
  if (c.transition !== 'none' && progress > 0.88) _vsDrawTransitionOut(ctx, cv, c.transition, progress);

  // Text overlays
  if (c.textOverlay) _vsDrawText(ctx, cv, c.textOverlay, c.textPos || 'bottom', p, progress);

  // Global text layers
  VS.textLayers.forEach(tl => _vsDrawTextLayer(ctx, cv, tl, p, progress));

  // Timecode (hidden in export)
  if (!VS._exporting) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(cv.width * 0.022)}px monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(vsFormatTime(VS.currentTime), 10, 10);
  }
}

function _vsKenBurnsMatrix(type, p, W, H) {
  // p = 0..1 progress through clip
  const eased = p < 0.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;
  let sx=1, sy=1, tx=0, ty=0;
  if (type === 'zoom-in')     { const s=1+(eased*0.12); sx=s;sy=s; tx=(W*(1-s))/2; ty=(H*(1-s))/2; }
  else if (type === 'zoom-out'){ const s=1.12-(eased*0.12); sx=s;sy=s; tx=(W*(1-s))/2; ty=(H*(1-s))/2; }
  else if (type === 'pan-left'){ tx = -(eased * W * 0.08); }
  else if (type === 'pan-right'){ tx = (eased * W * 0.08); }
  else if (type === 'tilt-up'){ ty = -(eased * H * 0.06); }
  else if (type === 'drift')  { const s=1.05; sx=s;sy=s; tx=((1-s)*W/2)+(eased*W*0.04); ty=((1-s)*H/2)+(eased*H*0.03); }
  return { sx, sy, tx, ty };
}

function _vsDrawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function _vsDrawTransitionIn(ctx, cv, type, p) {
  const alpha = Math.max(0, 1 - p/0.12);
  ctx.globalAlpha = alpha;
  if (type === 'fade' || type === 'flash') { ctx.fillStyle = type === 'flash' ? '#fff' : '#000'; ctx.fillRect(0,0,cv.width,cv.height); }
  else if (type === 'blur') { /* canvas blur approximation — overlay */ ctx.fillStyle='#000'; ctx.fillRect(0,0,cv.width,cv.height); }
  ctx.globalAlpha = 1;
}

function _vsDrawTransitionOut(ctx, cv, type, p) {
  const alpha = Math.min(1, (p - 0.88) / 0.12);
  ctx.globalAlpha = alpha;
  if (type === 'fade' || type === 'flash') { ctx.fillStyle = type === 'flash' ? '#fff' : '#000'; ctx.fillRect(0,0,cv.width,cv.height); }
  else if (type === 'glitch') {
    ctx.fillStyle = `rgba(${Math.random()>0.5?'255,0,0':'0,0,255'},0.5)`;
    ctx.fillRect(0, cv.height * (0.3 + Math.random()*0.4), cv.width, 4 + Math.random()*12);
  }
  ctx.globalAlpha = 1;
}

function _vsDrawText(ctx, cv, text, pos, preset, progress) {
  if (!text) return;
  const W = cv.width, H = cv.height;
  const fsz = Math.round(W * 0.055);
  ctx.save();

  // slide-up animation
  const slideP = Math.min(1, progress / 0.15);
  const slideY = (1 - slideP) * 60;

  const padding = W * 0.06;
  let y = pos === 'top' ? H * 0.10 : pos === 'middle' ? H * 0.50 : H * 0.82;
  y += slideY;

  // background pill
  ctx.font = `bold ${fsz}px sans-serif`;
  const maxW = W * 0.88;
  const lines = _vsWrapText(ctx, text, maxW, fsz);
  const boxH  = lines.length * (fsz * 1.35) + 20;
  const boxY  = y - 14;

  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  _vsRoundRect(ctx, W/2 - maxW/2 - 12, boxY, maxW + 24, boxH, 12);

  ctx.fillStyle = preset.textColor || '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  lines.forEach((line, li) => {
    ctx.fillText(line, W/2, y + li * (fsz * 1.35));
  });
  ctx.restore();
}

function _vsDrawTextLayer(ctx, cv, tl, preset, progress) {
  const W = cv.width, H = cv.height;
  ctx.save();
  ctx.font = `bold ${tl.size || Math.round(W*0.06)}px sans-serif`;
  ctx.fillStyle = tl.color || preset.textColor || '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tl.text, (tl.x||0.5)*W, (tl.y||0.5)*H);
  ctx.restore();
}

function _vsWrapText(ctx, text, maxW, lineH) {
  const words = text.split(' '); const lines = []; let cur = '';
  words.forEach(w => {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  });
  if (cur) lines.push(cur);
  return lines;
}

function _vsRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  _vsRoundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
}

function _vsRoundRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

/* ── Watermark removal: blur common watermark zones ── */
function _vsBlurWatermarkZones(ctx, cv) {
  // Common watermark positions: bottom-right, top-right, top-left, bottom-left corners
  const zones = [
    { x: cv.width * 0.62, y: cv.height * 0.88, w: cv.width * 0.38, h: cv.height * 0.12 },  // bottom-right
    { x: cv.width * 0.62, y: 0,                 w: cv.width * 0.38, h: cv.height * 0.07 },  // top-right
    { x: 0,               y: 0,                 w: cv.width * 0.30, h: cv.height * 0.07 },  // top-left
    { x: 0,               y: cv.height * 0.92,  w: cv.width * 0.35, h: cv.height * 0.08 },  // bottom-left
  ];
  zones.forEach(z => {
    // Smear blur by pixel-sampling (canvas doesn't have native blur on drawImage)
    ctx.save();
    ctx.filter = 'blur(14px) brightness(0.95)';
    const snap = ctx.getImageData(z.x, z.y, Math.max(1,z.w), Math.max(1,z.h));
    ctx.putImageData(snap, z.x, z.y);
    ctx.filter = 'none';
    // Overlay a soft semi-transparent fill matching background to soften
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.restore();
  });
}

/* ── playback ───────────────────────────────────────── */
function vsPlay() {
  if (!VS.clips.length) return vsToast('📁 Add at least one clip first');
  VS.playing = true;
  VS._playStart = performance.now() - VS.currentTime * 1000;
  VS._clipIdx   = _vsClipAtTime(VS.currentTime);
  VS._clipStart = _vsClipStartTime(VS._clipIdx);

  // Ensure AudioContext is running
  if (!VS.audioCtx) VS.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (VS.audioCtx.state === 'suspended') VS.audioCtx.resume();

  // Connect video audio sources through Web Audio (preserves original video audio)
  VS.clips.forEach((c, idx) => {
    if (c._vidEl) {
      c._vidEl.playbackRate = c.speed || 1;
      // Wire video audio through gainNode if not already done
      if (!c._audioSrcNode) {
        try {
          const srcNode = VS.audioCtx.createMediaElementSource(c._vidEl);
          c._audioSrcNode = srcNode;
          // If background music is loaded, blend at lower volume; else full video audio
          const vol = VS.audioTrack?.buffer ? 0.85 : 1.0;
          const vidGain = VS.audioCtx.createGain();
          vidGain.gain.value = vol;
          srcNode.connect(vidGain).connect(VS.audioCtx.destination);
          c._vidGainNode = vidGain;
        } catch(e) { /* already connected */ }
      }
    }
  });

  // Start current video clip
  const c = VS.clips[VS._clipIdx];
  if (c?._vidEl) {
    c._vidEl.muted = false;
    c._vidEl.playbackRate = c.speed || 1;
    c._vidEl.play().catch(()=>{});
  }

  document.getElementById('vsPlayBtn').textContent = '⏸️ Pause';
  _vsRAF();

  // Background music track
  if (VS.audioTrack?.buffer) {
    if (VS._audioSrc) try { VS._audioSrc.stop(); } catch(_){}
    const src = VS.audioCtx.createBufferSource();
    src.buffer = VS.audioTrack.buffer;
    src.loop   = true;
    VS.gainNode = VS.audioCtx.createGain();
    VS.gainNode.gain.value = parseFloat(document.getElementById('vsVolumeSlider')?.value || 0.5);
    src.connect(VS.gainNode).connect(VS.audioCtx.destination);
    src.start(0, VS.audioOffset % VS.audioTrack.buffer.duration);
    VS._audioSrc = src;
  }
}

function vsStop() {
  VS.playing = false;
  if (VS._raf) { cancelAnimationFrame(VS._raf); VS._raf = null; }
  if (VS._audioSrc) try { VS._audioSrc.stop(); } catch(_){}
  VS.clips.forEach(c => { if (c._vidEl) { c._vidEl.pause(); } });
  document.getElementById('vsPlayBtn').textContent = '▶️ Play';
}

function vsTogglePlay() { VS.playing ? vsStop() : vsPlay(); }

function _vsRAF() {
  if (!VS.playing) return;
  const now   = performance.now();
  VS.currentTime = (now - VS._playStart) / 1000;

  if (VS.currentTime >= VS.totalDuration) {
    VS.currentTime = 0;
    VS._playStart  = now;
    VS._clipIdx    = 0;
    VS._clipStart  = 0;
    VS.clips.forEach(c => {
      if (c._vidEl) {
        c._vidEl.pause();
        c._vidEl.currentTime = c.trimStart || 0;
      }
    });
  }

  // find current clip
  const ci = _vsClipAtTime(VS.currentTime);
  const clipChanged = ci !== VS._clipIdx;

  if (clipChanged) {
    // Pause old clip
    const old = VS.clips[VS._clipIdx];
    if (old?._vidEl) old._vidEl.pause();

    VS._clipIdx   = ci;
    VS._clipStart = _vsClipStartTime(ci);
    const c = VS.clips[ci];
    if (c?._vidEl) {
      c._vidEl.currentTime = (c.trimStart || 0);
      c._vidEl.playbackRate = c.speed || 1;
      c._vidEl.play().catch(()=>{});
    }
  }

  const c = VS.clips[ci];
  const clipLocal = VS.currentTime - VS._clipStart;
  const clipDur   = c?.duration || 3;
  const progress  = Math.min(1, clipLocal / clipDur);

  if (c?._vidEl && !clipChanged) {
    // Only correct video time if drift > 0.3s to avoid constant seeking (which causes stuttering)
    const vid    = c._vidEl;
    const target = (c.trimStart || 0) + clipLocal * (c.speed || 1);
    if (Math.abs(vid.currentTime - target) > 0.3) {
      vid.currentTime = target;
    }
    if (vid.paused && VS.playing) vid.play().catch(()=>{});
  }

  VS.activeClip = ci;
  vsRenderClip(ci, progress);
  _vsUpdateScrubber();

  VS._raf = requestAnimationFrame(_vsRAF);
}

function _vsClipAtTime(t) {
  let acc = 0;
  for (let i = 0; i < VS.clips.length; i++) {
    acc += VS.clips[i].duration || 3;
    if (t < acc) return i;
  }
  return Math.max(0, VS.clips.length - 1);
}

function _vsClipStartTime(idx) {
  let s = 0;
  for (let i = 0; i < idx; i++) s += VS.clips[i].duration || 3;
  return s;
}

function _vsUpdateScrubber() {
  const sc = document.getElementById('vsScrubber');
  if (sc && VS.totalDuration > 0) sc.value = (VS.currentTime / VS.totalDuration) * 100;
  const tc = document.getElementById('vsTimecode');
  if (tc) tc.textContent = vsFormatTime(VS.currentTime) + ' / ' + vsFormatTime(VS.totalDuration);
}

function vsSeek(pct) {
  VS.currentTime = (pct / 100) * VS.totalDuration;
  VS._playStart  = performance.now() - VS.currentTime * 1000;
  const ci = _vsClipAtTime(VS.currentTime);
  VS._clipIdx  = ci; VS._clipStart = _vsClipStartTime(ci);
  const c = VS.clips[ci]; if (!c) return;
  const clipLocal = VS.currentTime - VS._clipStart;
  vsRenderClip(ci, Math.min(1, clipLocal / (c.duration || 3)));
}

function vsFormatTime(s) {
  s = Math.max(0, s || 0);
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}.${String(Math.round((s%1)*10)).padStart(1,'0')}`;
}

/* ── presets ─────────────────────────────────────────── */
function vsSelectPreset(name) {
  VS.preset = name;
  document.querySelectorAll('.vs-preset-card').forEach(c => c.classList.toggle('active', c.dataset.preset === name));
  const ci = VS.activeClip;
  if (VS.clips[ci]) vsRenderClip(ci, 0);
}

/* ── global text layer ──────────────────────────────── */
function vsAddTextLayer() {
  const txt = document.getElementById('vsGlobalText')?.value?.trim();
  if (!txt) return vsToast('✏️ Type some text first');
  VS.textLayers.push({ text: txt, x: 0.5, y: 0.5, size: null, color: '#fff' });
  vsRebuildTextLayerList();
  document.getElementById('vsGlobalText').value = '';
}
function vsClearTextLayers() { VS.textLayers = []; vsRebuildTextLayerList(); }
function vsRebuildTextLayerList() {
  const el = document.getElementById('vsTextLayerList'); if (!el) return;
  el.innerHTML = VS.textLayers.map((t,i) => `<div class="vs-text-chip">${t.text}<button onclick="vsRemoveTextLayer(${i})">✕</button></div>`).join('');
}
function vsRemoveTextLayer(i) { VS.textLayers.splice(i,1); vsRebuildTextLayerList(); }

/* ── audio ───────────────────────────────────────────── */
function vsSelectTrack(idx) {
  const track = VS_TRACKS[idx]; if (!track) return;
  vsToast('⏳ Loading track: ' + track.name + ' …');
  if (!VS.audioCtx) VS.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  fetch(track.url)
    .then(r => r.arrayBuffer())
    .then(buf => VS.audioCtx.decodeAudioData(buf))
    .then(decoded => {
      VS.audioTrack = { ...track, buffer: decoded };
      vsToast('🎵 Track loaded: ' + track.name);
      document.getElementById('vsCurrentTrack').textContent = track.name;
      vsDetectBeats(decoded);
    })
    .catch(() => {
      vsToast('⚠️ Could not load track (CORS). Try uploading your own music.');
    });
}

function vsUploadAudio(file) {
  if (!file) return;
  if (!VS.audioCtx) VS.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const url = URL.createObjectURL(file);
  fetch(url).then(r => r.arrayBuffer()).then(buf => VS.audioCtx.decodeAudioData(buf)).then(decoded => {
    VS.audioTrack = { name: file.name, url, buffer: decoded, bpm: null };
    vsToast('🎵 Custom track loaded: ' + file.name);
    document.getElementById('vsCurrentTrack').textContent = '🎵 ' + file.name;
    vsDetectBeats(decoded);
  }).catch(() => vsToast('❌ Could not decode audio file'));
}

/* simple beat detection via energy analysis */
function vsDetectBeats(buffer) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.04); // 40ms windows
  const energies = [];
  for (let i = 0; i < data.length - windowSize; i += windowSize) {
    let e = 0;
    for (let j = 0; j < windowSize; j++) e += data[i+j] * data[i+j];
    energies.push({ t: i / sampleRate, e: e / windowSize });
  }
  const avg = energies.reduce((s,v) => s + v.e, 0) / energies.length;
  VS.beatMarkers = energies.filter(v => v.e > avg * 2.2).map(v => v.t);
  vsToast(`🥁 ${VS.beatMarkers.length} beats detected`);
  _vsRenderBeatMarkers();
}

function _vsRenderBeatMarkers() {
  const tc = document.getElementById('vsBeatTrack'); if (!tc || !VS.totalDuration) return;
  tc.innerHTML = '';
  VS.beatMarkers.forEach(t => {
    if (t > VS.totalDuration) return;
    const div = document.createElement('div');
    div.className = 'vs-beat-marker';
    div.style.left = (t / VS.totalDuration * 100) + '%';
    tc.appendChild(div);
  });
}

/* auto-cut: set clip durations to match beat intervals */
function vsAutoCutToBeats() {
  if (!VS.beatMarkers.length) return vsToast('🥁 No beats detected — load a track first');
  if (!VS.clips.length) return vsToast('📁 Add clips first');
  const intervals = VS.beatMarkers.slice(0, VS.clips.length + 1);
  VS.clips.forEach((c, i) => {
    if (i < intervals.length - 1) {
      const dur = intervals[i+1] - intervals[i];
      if (c.type === 'img') c.duration = Math.max(0.5, dur);
    }
  });
  vsRebuildTimeline();
  vsToast('✅ Clips synced to beat!');
}

function vsSetVolume(val) {
  if (VS.gainNode) VS.gainNode.gain.value = parseFloat(val);
}

/* ── one-click template apply ───────────────────────── */
const VS_TEMPLATES = {
  // ── Viral content templates ──
  'viral-travel': { preset:'cinematic',    kenBurns:'zoom-in',   transition:'fade',       defaultText:'✈️ Travel Vibes',     speed:1 },
  'motivational': { preset:'motivational', kenBurns:'zoom-out',  transition:'flash',      defaultText:'💪 Keep Going!',       speed:1 },
  'aesthetic':    { preset:'aesthetic',    kenBurns:'drift',     transition:'fade',       defaultText:'🌸 Aesthetic Life',    speed:0.8 },
  'vlog':         { preset:'vlog',         kenBurns:'pan-left',  transition:'slide-left', defaultText:'📹 My Day Vlog',       speed:1 },
  'slo-mo':       { preset:'cinematic',    kenBurns:'zoom-in',   transition:'fade',       defaultText:'💫 Slow Motion',       speed:0.25 },
  'timelapse':    { preset:'vlog',         kenBurns:'zoom-out',  transition:'none',       defaultText:'⏩ Timelapse',          speed:4 },
  'news-reel':    { preset:'news',         kenBurns:'tilt-up',   transition:'zoom-in',    defaultText:'📰 Breaking News',     speed:1 },
  'birthday':     { preset:'aesthetic',    kenBurns:'zoom-in',   transition:'flash',      defaultText:'🎂 Happy Birthday!',   speed:1 },
  'neon-night':   { preset:'neon',         kenBurns:'drift',     transition:'glitch',     defaultText:'🌃 Night Vibes',       speed:1 },
  'vintage-film': { preset:'vintage',      kenBurns:'pan-right', transition:'fade',       defaultText:'🎞️ Film Roll',         speed:1 },
  // ── Motion effect templates ──
  'fade-in-out':  { preset:'cinematic',    kenBurns:'none',      transition:'fade',       defaultText:'',                     speed:1,    _note:'Smooth fade between every clip' },
  'zoom-in-out':  { preset:'cinematic',    kenBurns:'zoom-in',   transition:'zoom-out',   defaultText:'',                     speed:1,    _note:'Zoom in on entry, zoom out on exit' },
  'slow-motion':  { preset:'cinematic',    kenBurns:'zoom-in',   transition:'fade',       defaultText:'🐌 Slow Motion',        speed:0.5,  _note:'0.5x slow-mo cinematic' },
  'fast-motion':  { preset:'vlog',         kenBurns:'zoom-out',  transition:'flash',      defaultText:'⚡ Fast Cut',           speed:2,    _note:'2x fast motion' },
  'pan-slide':    { preset:'cinematic',    kenBurns:'pan-left',  transition:'slide-left', defaultText:'',                     speed:1,    _note:'Horizontal pan + slide transition' },
  'glitch-pop':   { preset:'neon',         kenBurns:'drift',     transition:'glitch',     defaultText:'⚡ Glitch Pop',         speed:1,    _note:'Glitch + neon style' },
  'whip-snap':    { preset:'vlog',         kenBurns:'pan-right', transition:'whip-pan',   defaultText:'💨 Snap!',              speed:1.25, _note:'Whip pan transition snap' },
  'blur-reveal':  { preset:'aesthetic',    kenBurns:'zoom-in',   transition:'blur',       defaultText:'🌀 Blur Reveal',        speed:0.9,  _note:'Blur in/out reveal effect' },
};

function vsApplyTemplate(key) {
  const t = VS_TEMPLATES[key]; if (!t) return;
  VS.preset = t.preset;
  VS.clips.forEach(c => {
    c.kenBurns   = t.kenBurns;
    c.transition = t.transition;
    c.speed      = t.speed;
    if (c.type === 'vid' && c._vidEl) c.duration = c._vidEl.duration / c.speed;
    if (!c.textOverlay) c.textOverlay = t.defaultText;
    c.textPos = 'bottom';
  });
  document.querySelectorAll('.vs-template-card').forEach(el => el.classList.toggle('active', el.dataset.tpl === key));
  vsSelectPreset(t.preset);
  vsRebuildTimeline();
  if (VS.clips[VS.activeClip]) vsRenderClip(VS.activeClip, 0);
  vsToast('✅ Template "' + key + '" applied to all clips!');
}

/* ── export / record ────────────────────────────────── */
function vsExport() {
  if (!VS.clips.length) return vsToast('📁 Add clips before exporting');

  const qualityBps  = parseInt(document.getElementById('vsExportQuality')?.value || '8000000');
  const formatPref  = document.getElementById('vsExportFormat')?.value || 'webm';

  vsToast('🎬 Rendering HD video… do not close this tab');
  VS._exporting = true;
  vsStop();
  VS.currentTime = 0;

  // Show progress bar
  const progWrap  = document.getElementById('vsExportProgress');
  const progLabel = document.getElementById('vsExportLabel');
  const progBar   = document.getElementById('vsExportBar');
  if (progWrap) progWrap.style.display = 'block';
  if (progLabel) progLabel.textContent = '⏳ Rendering…';
  if (progBar) progBar.style.width = '0%';

  // Choose codec
  const mimeTypes = formatPref === 'mp4'
    ? ['video/mp4;codecs=h264,aac','video/mp4']
    : ['video/webm;codecs=vp9,opus','video/webm;codecs=vp9','video/webm;codecs=vp8,opus','video/webm'];
  const mimeType = mimeTypes.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch(_){ return false; } }) || 'video/webm';

  const stream = VS.canvas.captureStream(30);

  // ── Audio mix: video audio + background music ──
  if (!VS.audioCtx) VS.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (VS.audioCtx.state === 'suspended') VS.audioCtx.resume();

  const dest = VS.audioCtx.createMediaStreamDestination();

  // Connect all video audio clips to export destination
  VS.clips.forEach(c => {
    if (c._vidEl && c._audioSrcNode) {
      const exportGain = VS.audioCtx.createGain();
      exportGain.gain.value = VS.audioTrack?.buffer ? 0.8 : 1.0;
      c._audioSrcNode.connect(exportGain).connect(dest);
    }
  });

  // Background music
  let exportMusicSrc = null;
  if (VS.audioTrack?.buffer) {
    exportMusicSrc = VS.audioCtx.createBufferSource();
    exportMusicSrc.buffer = VS.audioTrack.buffer;
    exportMusicSrc.loop   = true;
    const musicGain = VS.audioCtx.createGain();
    musicGain.gain.value = parseFloat(document.getElementById('vsVolumeSlider')?.value || 0.5);
    exportMusicSrc.connect(musicGain).connect(dest);
    exportMusicSrc.start(0);
  }

  // Add audio tracks to video stream
  dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));

  VS.recordedChunks = [];
  VS.mediaRecorder   = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: qualityBps,
    audioBitsPerSecond: 192000,
  });
  VS.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) VS.recordedChunks.push(e.data); };
  VS.mediaRecorder.onstop = () => {
    if (exportMusicSrc) try { exportMusicSrc.stop(); } catch(_){}
    if (progBar) progBar.style.width = '100%';
    if (progLabel) progLabel.textContent = '✅ Done! Downloading…';
    setTimeout(() => { if (progWrap) progWrap.style.display = 'none'; }, 3000);
    vsDownloadExport(mimeType);
  };
  VS.mediaRecorder.start(100);

  // Play through at real-time for export
  vsPlay();

  const exportDur = VS.totalDuration * 1000 + 800;
  let elapsed = 0;
  const tick = 500;
  const progressInterval = setInterval(() => {
    elapsed += tick;
    const pct = Math.min(95, (elapsed / exportDur) * 100);
    if (progBar) progBar.style.width = pct + '%';
    if (progLabel) progLabel.textContent = `⏳ Rendering… ${Math.round(pct)}%`;
  }, tick);

  setTimeout(() => {
    clearInterval(progressInterval);
    vsStop();
    VS.mediaRecorder.stop();
    VS._exporting = false;
  }, Math.min(exportDur, 120000)); // cap 2 min
}

function vsDownloadExport(mimeType) {
  const ext  = (mimeType || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(VS.recordedChunks, { type: mimeType || 'video/webm' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'shashi-hd-video-' + Date.now() + '.' + ext;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
  vsToast('✅ HD Video downloaded!');
}

/* ── split clip (future advanced) ──────────────────── */
function vsSplitClip() {
  const c = VS.clips[VS.activeClip]; if (!c || c.type !== 'vid') return vsToast('⚠️ Select a video clip to split');
  const clipStart = _vsClipStartTime(VS.activeClip);
  const splitAt   = VS.currentTime - clipStart;
  if (splitAt <= 0.1 || splitAt >= (c.duration || 3) - 0.1) return vsToast('⚠️ Seek to a point inside the clip to split');
  // create second clip as copy
  const c2 = { ...c, trimStart: (c.trimStart||0) + splitAt * c.speed, trimEnd: c.trimEnd, duration: ((c.trimEnd||c._vidEl?.duration||0) - (c.trimStart||0) - splitAt * c.speed) / c.speed };
  c.trimEnd  = (c.trimStart||0) + splitAt * c.speed;
  c.duration = splitAt;
  VS.clips.splice(VS.activeClip + 1, 0, c2);
  vsRebuildTimeline();
  vsToast('✂️ Clip split at ' + vsFormatTime(splitAt));
}

/* ── reorder clips ───────────────────────────────────── */
function vsMoveClipLeft(i) {
  if (i === 0) return;
  [VS.clips[i-1], VS.clips[i]] = [VS.clips[i], VS.clips[i-1]];
  if (VS.activeClip === i) VS.activeClip = i-1;
  vsRebuildTimeline();
}
function vsMoveClipRight(i) {
  if (i >= VS.clips.length - 1) return;
  [VS.clips[i], VS.clips[i+1]] = [VS.clips[i+1], VS.clips[i]];
  if (VS.activeClip === i) VS.activeClip = i+1;
  vsRebuildTimeline();
}

/* ── stats ───────────────────────────────────────────── */
function vsUpdateStats() {
  const el = document.getElementById('vsStats'); if (!el) return;
  el.textContent = `${VS.clips.length} clips · ${vsFormatTime(VS.totalDuration)} · ${VS.aspectRatio}`;
}

/* ── toast ───────────────────────────────────────────── */
function vsToast(msg) {
  let t = document.getElementById('vsToast');
  if (!t) { t = document.createElement('div'); t.id='vsToast'; t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e1b4b;color:#c4b5fd;border:1px solid #7c3aed;padding:10px 22px;border-radius:50px;font-size:14px;z-index:99999;pointer-events:none;opacity:0;transition:opacity .3s'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._to);
  t._to = setTimeout(() => t.style.opacity = '0', 3000);
}

/* ── drag-and-drop on timeline ──────────────────────── */
function vsInitDrop() {
  const zone = document.getElementById('vsDropZone');
  if (!zone) return;
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('vs-drop-active'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('vs-drop-active'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('vs-drop-active');
    vsHandleFiles(e.dataTransfer.files);
  });
  // Also support drag on the canvas itself
  const canvas = document.getElementById('vsPreviewWrap');
  if (canvas) {
    canvas.addEventListener('dragover', e => { e.preventDefault(); canvas.style.outline = '3px dashed #7c3aed'; });
    canvas.addEventListener('dragleave', () => { canvas.style.outline = ''; });
    canvas.addEventListener('drop', e => {
      e.preventDefault(); canvas.style.outline = '';
      vsHandleFiles(e.dataTransfer.files);
    });
  }
  // Responsive: default open left panel on desktop, center on mobile
  if (window.innerWidth <= 768) vsMobileTab('center');
}

/* call on DOMContentLoaded */
document.addEventListener('DOMContentLoaded', () => {
  vsInitDrop();
});
