
// ══════════════════════════════════════════════════════════════════════════════
// FACE SWAP VIDEO CREATOR
// Step 1: Pick trending video template (or upload own)
// Step 2: Upload face photo
// Step 3: Choose background replacement
// Step 4: Send to HF Space (InsightFace + rembg) → download result
// ══════════════════════════════════════════════════════════════════════════════

// ── Trending video templates database ────────────────────────────────────────
const FS_TEMPLATES = [
  // Nepal trending
  { id:'np1', cat:'nepal', title:'Resham Firiri Dance', artist:'Nepali Folk', views:'12M', badge:'hot',
    thumb:'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=300&q=60',
    vidUrl:null, duration:'0:30', tags:['dance','nepal'] },
  { id:'np2', cat:'nepal', title:'Dashain Celebration', artist:'Festival Nepal', views:'8.4M', badge:'top',
    thumb:'https://images.unsplash.com/photo-1601814933824-fd0b574dd592?w=300&q=60',
    vidUrl:null, duration:'0:20', tags:['festival','nepal'] },
  { id:'np3', cat:'nepal', title:'Pokhara Reel Trend', artist:'Nepal TikTok', views:'6.1M', badge:'new',
    thumb:'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=300&q=60',
    vidUrl:null, duration:'0:15', tags:['reel','nepal'] },
  // Bollywood
  { id:'bl1', cat:'bollywood', title:'Kesariya Trend', artist:'Brahmastra', views:'42M', badge:'hot',
    thumb:'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=300&q=60',
    vidUrl:null, duration:'0:30', tags:['bollywood','dance'] },
  { id:'bl2', cat:'bollywood', title:'Jhoome Jo Pathaan', artist:'Shah Rukh Khan', views:'38M', badge:'top',
    thumb:'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=60',
    vidUrl:null, duration:'0:30', tags:['bollywood','reel'] },
  { id:'bl3', cat:'bollywood', title:'Gallan Goodiyaan', artist:'Dil Dhadakne Do', views:'22M', badge:'new',
    thumb:'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&q=60',
    vidUrl:null, duration:'0:25', tags:['bollywood','dance'] },
  // Viral Dance
  { id:'d1', cat:'dance', title:'Naatu Naatu Step', artist:'RRR Official', views:'95M', badge:'hot',
    thumb:'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=300&q=60',
    vidUrl:null, duration:'0:30', tags:['dance','viral'] },
  { id:'d2', cat:'dance', title:'Kala Chashma Reel', artist:'Viral TikTok', views:'61M', badge:'top',
    thumb:'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&q=60',
    vidUrl:null, duration:'0:20', tags:['dance','reel'] },
  { id:'d3', cat:'dance', title:'Besharam Rang', artist:'Pathaan', views:'44M', badge:'hot',
    thumb:'https://images.unsplash.com/photo-1504609773096-104ff2c73ba4?w=300&q=60',
    vidUrl:null, duration:'0:30', tags:['dance','bollywood'] },
  // Reels
  { id:'r1', cat:'reel', title:'Morning Routine Reel', artist:'Trending Reels', views:'18M', badge:'new',
    thumb:'https://images.unsplash.com/photo-1520013817300-1f4c753bb4b9?w=300&q=60',
    vidUrl:null, duration:'0:30', tags:['reel','lifestyle'] },
  { id:'r2', cat:'reel', title:'Transition Reel', artist:'Instagram Trending', views:'29M', badge:'hot',
    thumb:'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=300&q=60',
    vidUrl:null, duration:'0:15', tags:['reel','transition'] },
  { id:'r3', cat:'reel', title:'Travel Reel Nepal', artist:'Wanderlust Nepal', views:'9.2M', badge:'new',
    thumb:'https://images.unsplash.com/photo-1585016495481-91140f4e0c91?w=300&q=60',
    vidUrl:null, duration:'0:30', tags:['reel','nepal','travel'] },
];

// Background options config
const FS_BG_OPTIONS = {
  none:   { label:'Keep Original', icon:'🎬', url:null },
  black:  { label:'Black Studio',  icon:'⬛', url:null, color:'#000000' },
  white:  { label:'White Studio',  icon:'⬜', url:null, color:'#f8fafc' },
  nepal:  { label:'Nepal Mountains', icon:'🏔️', url:'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1280&q=80' },
  office: { label:'Office',        icon:'🏢', url:'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&q=80' },
  stage:  { label:'Stage',         icon:'🎤', url:'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1280&q=80' },
  custom: { label:'Custom',        icon:'📤', url:null },
};

// ── State ─────────────────────────────────────────────────────────────────────
const _fs = {
  step: 1,
  selectedTpl: null,     // template object or { custom:true, file/url }
  srcFile: null,         // face photo File
  selectedBg: 'none',    // bg key
  bgFile: null,          // custom bg File
  resultBlob: null,
  resultIsVideo: false,
  currentCat: 'all',
};

// ── Open / Close ───────────────────────────────────────────────────────────────
function openFaceSwapStudio() {
  const modal = document.getElementById('faceSwapModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Restore saved HF URL
  const hfInput = document.getElementById('fsHfUrl');
  if (hfInput) hfInput.value = localStorage.getItem('ghp_hf_faceswap_url') || '';
  // Restore disclaimer
  if (localStorage.getItem('ghp_fs_disclaimer') === '1') {
    const chk = document.getElementById('fsDisclaimerCheck');
    if (chk) { chk.checked = true; _applyDisclaimer(true); }
  }
  // Render templates
  fsRenderTemplates('all');
  // Go to step 1
  fsGoStep(1, true);
}

function closeFaceSwapStudio() {
  document.getElementById('faceSwapModal').style.display = 'none';
  document.body.style.overflow = '';
}

// ── Step navigation ────────────────────────────────────────────────────────────
function fsGoStep(n, force) {
  // Validate before advancing
  if (!force) {
    if (n > 1 && !_fs.selectedTpl) { showToast('Please select a video template first', 3000); fsGoStep(1,true); return; }
    if (n > 2 && !_fs.srcFile) { showToast('Please upload your face photo', 3000); return; }
    if (n > 2 && localStorage.getItem('ghp_fs_disclaimer') !== '1') { showToast('Please accept the terms first', 3000); return; }
  }
  _fs.step = n;
  [1,2,3,4].forEach(i => {
    document.getElementById('fsStep'+i).style.display = i === n ? 'block' : 'none';
    const tab = document.getElementById('fsTab'+i);
    tab.classList.toggle('active', i === n);
    tab.style.borderBottomColor = i === n ? '#7c3aed' : 'transparent';
    tab.style.color = i === n ? '#a78bfa' : '';
  });
  // Update summary on step 4
  if (n === 4) _fsUpdateSummary();
}

// ── Template rendering ─────────────────────────────────────────────────────────
function fsRenderTemplates(cat) {
  _fs.currentCat = cat;
  const grid = document.getElementById('fsTplGrid');
  const customSection = document.getElementById('fsCustomSection');
  if (!grid) return;

  if (cat === 'custom') {
    grid.innerHTML = '';
    customSection.style.display = 'block';
    return;
  }
  customSection.style.display = 'none';

  const list = cat === 'all' ? FS_TEMPLATES : FS_TEMPLATES.filter(t => t.cat === cat);
  grid.innerHTML = list.map(t => `
    <div class="fs-tpl-card${_fs.selectedTpl?.id === t.id ? ' selected':''}" onclick="fsSelectTemplate('${t.id}')" id="fsTplCard_${t.id}">
      ${t.badge ? `<span class="fs-tpl-badge ${t.badge}">${t.badge==='hot'?'🔥':t.badge==='new'?'✨':'⭐'} ${t.badge.toUpperCase()}</span>` : ''}
      <img src="${t.thumb}" alt="${t.title}" loading="lazy">
      <div class="fs-tpl-card-body">
        <div class="fs-tpl-title">${t.title}</div>
        <div class="fs-tpl-meta">👁️ ${t.views} · ⏱ ${t.duration}</div>
      </div>
    </div>
  `).join('');
}

function fsFilterCat(cat, btn) {
  document.querySelectorAll('.fs-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  fsRenderTemplates(cat);
}

function fsSelectTemplate(id) {
  const tpl = FS_TEMPLATES.find(t => t.id === id);
  if (!tpl) return;
  _fs.selectedTpl = tpl;
  // Update card styles
  document.querySelectorAll('.fs-tpl-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById('fsTplCard_'+id);
  if (card) card.classList.add('selected');
  // Show selected bar
  document.getElementById('fsSelectedThumb').src = tpl.thumb;
  document.getElementById('fsSelectedTitle').textContent = tpl.title;
  document.getElementById('fsSelectedMeta').textContent = `👁️ ${tpl.views} · ⏱ ${tpl.duration} · 🎵 ${tpl.artist}`;
  document.getElementById('fsSelectedTpl').style.display = 'flex';
  document.getElementById('fsNext1').disabled = false;
}

function fsClearTemplate() {
  _fs.selectedTpl = null;
  document.getElementById('fsSelectedTpl').style.display = 'none';
  document.getElementById('fsNext1').disabled = true;
  document.querySelectorAll('.fs-tpl-card').forEach(c => c.classList.remove('selected'));
}

// Custom video upload
function fsVidDropped(e) {
  e.preventDefault();
  document.getElementById('fsSrcDrop') && (document.getElementById('fsSrcDrop').style.borderColor = '');
  const file = e.dataTransfer.files[0];
  if (file) fsVidFileChanged({ target: { files: [file] } });
}
function fsVidFileChanged(e) {
  const file = e.target.files[0]; if (!file) return;
  _fs.selectedTpl = { custom:true, file, title: file.name, thumb: null };
  document.getElementById('fsVidDropLabel').textContent = '✅ ' + file.name;
  document.getElementById('fsNext1').disabled = false;
  showToast('Video selected: ' + file.name, 2500);
}
function fsVidUrlChanged(val) {
  if (!val.trim()) return;
  _fs.selectedTpl = { custom:true, url: val.trim(), title: 'Pasted URL', thumb: null };
  document.getElementById('fsNext1').disabled = false;
}

// ── Face photo ─────────────────────────────────────────────────────────────────
function handleFsDisclaimer() {
  const checked = document.getElementById('fsDisclaimerCheck').checked;
  _applyDisclaimer(checked);
  if (checked) localStorage.setItem('ghp_fs_disclaimer','1');
  else localStorage.removeItem('ghp_fs_disclaimer');
}
function _applyDisclaimer(on) {
  const box = document.getElementById('fsDisclaimerBox');
  if (box) box.style.opacity = on ? '.5' : '1';
  _fsUpdateNext2();
}

function fsSrcChanged(e) {
  const file = e.target.files[0]; if (!file) return;
  _fs.srcFile = file;
  const img = document.getElementById('fsSrcPreview');
  img.src = URL.createObjectURL(file);
  img.style.display = 'block';
  document.getElementById('fsSrcPlaceholder').style.display = 'none';
  _fsUpdateNext2();
}
function fsSrcDropped(e) {
  e.preventDefault();
  document.getElementById('fsSrcDrop').style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file) fsSrcChanged({ target: { files: [file] } });
}
function _fsUpdateNext2() {
  const ok = _fs.srcFile && localStorage.getItem('ghp_fs_disclaimer') === '1';
  const btn = document.getElementById('fsNext2');
  if (btn) btn.disabled = !ok;
}

// ── Background ─────────────────────────────────────────────────────────────────
function fsSelectBg(key, el) {
  _fs.selectedBg = key;
  document.querySelectorAll('.fs-bg-opt').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  if (key === 'custom') document.getElementById('fsBgImgInput').click();
}
function fsBgImgChanged(e) {
  const file = e.target.files[0]; if (!file) return;
  _fs.bgFile = file;
  FS_BG_OPTIONS.custom.url = URL.createObjectURL(file);
  const prev = document.getElementById('fsBgImgPreview');
  prev.src = FS_BG_OPTIONS.custom.url;
  prev.style.display = 'block';
  document.getElementById('fsBgImgIcon').style.display = 'none';
  showToast('Custom background set ✅', 2000);
}

// ── Summary (step 4) ──────────────────────────────────────────────────────────
function _fsUpdateSummary() {
  const tpl = _fs.selectedTpl;
  const thumb = document.getElementById('fsSumThumb');
  const title = document.getElementById('fsSumTitle');
  if (tpl) {
    thumb.src = tpl.thumb || '';
    thumb.style.display = tpl.thumb ? 'block' : 'none';
    title.textContent = tpl.title || 'Custom Video';
  }
  const face = document.getElementById('fsSumFace');
  if (_fs.srcFile) face.src = URL.createObjectURL(_fs.srcFile);

  const bgCfg = FS_BG_OPTIONS[_fs.selectedBg] || FS_BG_OPTIONS.none;
  const sumBg = document.getElementById('fsSumBg');
  const sumBgLabel = document.getElementById('fsSumBgLabel');
  sumBg.textContent = bgCfg.icon;
  sumBgLabel.textContent = bgCfg.label;
  if (bgCfg.url) sumBg.style.backgroundImage = `url('${bgCfg.url}')`;
}

// ── Core: run swap ─────────────────────────────────────────────────────────────
async function runFaceSwap() {
  if (!_fs.selectedTpl || !_fs.srcFile) return;

  const progress = document.getElementById('fsProgress');
  const progressMsg = document.getElementById('fsProgressMsg');
  const progressBar = document.getElementById('fsProgressBar');
  const resultBox = document.getElementById('fsResultBox');
  const createBtn = document.getElementById('fsCreateBtn');

  progress.style.display = 'block';
  resultBox.style.display = 'none';
  createBtn.disabled = true;
  progressBar.style.width = '5%';

  const setMsg = (msg, pct) => {
    progressMsg.textContent = msg;
    if (pct !== undefined) progressBar.style.width = pct + '%';
  };

  try {
    let resultBlob = null;
    let isVideo = false;

    const hfUrl = (document.getElementById('fsHfUrl')?.value || '').trim().replace(/\/$/, '');

    if (hfUrl) {
      setMsg('Connecting to HuggingFace Space…', 10);
      resultBlob = await _fsCallHFSpace(hfUrl, setMsg);
      // Detect video vs image
      isVideo = resultBlob.type.startsWith('video/');
    } else if (window._isNodeServer) {
      setMsg('Sending to local server…', 15);
      resultBlob = await _fsCallLocalServer(setMsg);
    } else {
      throw new Error('No backend configured. Please paste your HuggingFace Space URL above.');
    }

    _fs.resultBlob = resultBlob;
    _fs.resultIsVideo = isVideo;
    progressBar.style.width = '100%';

    const url = URL.createObjectURL(resultBlob);
    const resVideo = document.getElementById('fsResultVideo');
    const resImg = document.getElementById('fsResultImg');
    if (isVideo) {
      resVideo.src = url; resVideo.style.display = 'block';
      resImg.style.display = 'none';
    } else {
      resImg.src = url; resImg.style.display = 'block';
      resVideo.style.display = 'none';
    }
    resultBox.style.display = 'block';
    progress.style.display = 'none';
    showToast('🎬 Video created successfully!', 3500);
  } catch (err) {
    progress.style.display = 'none';
    progressBar.style.width = '0%';
    showToast('❌ ' + err.message, 9000);
    console.error('[FaceSwap]', err);
  } finally {
    createBtn.disabled = false;
  }
}

// ── HuggingFace Gradio REST ────────────────────────────────────────────────────
async function _fsCallHFSpace(baseUrl, setMsg) {
  // Build payload — send face photo + bg choice + template info
  async function uploadFile(file, label) {
    const fd = new FormData(); fd.append('files', file);
    const r = await fetch(baseUrl + '/upload', { method:'POST', body:fd });
    if (!r.ok) throw new Error('HF upload failed (' + label + '): ' + r.status);
    return (await r.json())[0];
  }

  setMsg('Uploading face photo…', 20);
  const facePath = await uploadFile(_fs.srcFile, 'face');

  // Upload bg image if custom
  let bgPath = null;
  if (_fs.selectedBg === 'custom' && _fs.bgFile) {
    setMsg('Uploading background image…', 30);
    bgPath = await uploadFile(_fs.bgFile, 'bg');
  }

  // Upload template video if custom file
  let vidPath = null;
  if (_fs.selectedTpl.custom && _fs.selectedTpl.file) {
    setMsg('Uploading your video…', 35);
    vidPath = await uploadFile(_fs.selectedTpl.file, 'video');
  }

  setMsg('Queuing face swap job on GPU…', 45);
  const sessionHash = Math.random().toString(36).slice(2);
  const payload = {
    fn_index: 0,
    session_hash: sessionHash,
    data: [
      { path: facePath, orig_name: _fs.srcFile.name },
      vidPath ? { path: vidPath, orig_name: _fs.selectedTpl.file.name }
               : (_fs.selectedTpl.vidUrl || _fs.selectedTpl.url || null),
      _fs.selectedBg,
      bgPath ? { path: bgPath } : (FS_BG_OPTIONS[_fs.selectedBg]?.url || null),
    ]
  };

  const joinRes = await fetch(baseUrl + '/queue/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!joinRes.ok) throw new Error('HF queue/join failed: ' + joinRes.status);
  const { event_id } = await joinRes.json();

  setMsg('Processing on GPU (this takes ~30–60s)…', 55);

  return await new Promise((resolve, reject) => {
    const es = new EventSource(baseUrl + '/queue/data?session_hash=' + event_id);
    let pct = 55;
    const ticker = setInterval(() => {
      pct = Math.min(pct + 2, 92);
      setMsg('Processing on GPU…', pct);
    }, 1500);
    const timeout = setTimeout(() => { clearInterval(ticker); es.close(); reject(new Error('HF Space timeout (120s) — try a shorter video')); }, 120000);

    es.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.msg === 'process_completed') {
          clearTimeout(timeout); clearInterval(ticker); es.close();
          const output = msg.output?.data?.[0];
          if (!output) { reject(new Error('HF returned no output')); return; }
          setMsg('Downloading result…', 95);
          if (typeof output === 'string' && output.startsWith('data:')) {
            resolve(await (await fetch(output)).blob());
          } else if (output?.url) {
            const url = output.url.startsWith('http') ? output.url : baseUrl + '/file=' + output.url;
            resolve(await (await fetch(url)).blob());
          } else { reject(new Error('Unexpected output format from HF Space')); }
        } else if (msg.msg === 'queue_full') {
          clearTimeout(timeout); clearInterval(ticker); es.close();
          reject(new Error('HF Space queue is full — please try again in a minute'));
        } else if (msg.msg === 'error') {
          clearTimeout(timeout); clearInterval(ticker); es.close();
          reject(new Error('HF Space error: ' + (msg.output?.error || 'unknown')));
        }
      } catch(_) {}
    };
    es.onerror = () => { clearTimeout(timeout); clearInterval(ticker); es.close(); reject(new Error('Connection to HF Space lost')); };
  });
}

// ── Local server fallback ──────────────────────────────────────────────────────
async function _fsCallLocalServer(setMsg) {
  const fd = new FormData();
  fd.append('face_photo', _fs.srcFile);
  if (_fs.selectedTpl?.file) fd.append('target_video', _fs.selectedTpl.file);
  if (_fs.selectedTpl?.url) fd.append('target_url', _fs.selectedTpl.url);
  fd.append('bg_mode', _fs.selectedBg);
  if (_fs.bgFile) fd.append('bg_image', _fs.bgFile);
  setMsg('Processing on local server…', 40);
  const res = await fetch('http://localhost:3000/api/faceswap', { method:'POST', body:fd });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Local server error ' + res.status); }
  return await res.blob();
}

// ── Result actions ─────────────────────────────────────────────────────────────
function fsSaveResult() {
  if (!_fs.resultBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(_fs.resultBlob);
  a.download = _fs.resultIsVideo ? 'face-swap-video.mp4' : 'face-swap-result.jpg';
  a.click();
  showToast('💾 Saved!', 2000);
}

function fsShareResult() {
  if (!_fs.resultBlob) return;
  if (navigator.share) {
    const file = new File([_fs.resultBlob], _fs.resultIsVideo ? 'video.mp4':'image.jpg', { type: _fs.resultBlob.type });
    navigator.share({ files:[file], title:'My Face Swap Video', text:'Created with Shashi Creator Studio 🎬' })
      .catch(e => showToast('Share cancelled', 2000));
  } else {
    fsSaveResult();
    showToast('📋 Download the file and share manually', 3000);
  }
}

function fsUseAsNews() {
  if (!_fs.resultBlob || _fs.resultIsVideo) {
    showToast('Only image results can be used in News Studio', 3000); return;
  }
  const file = new File([_fs.resultBlob], 'faceswap.jpg', { type:'image/jpeg' });
  const dt = new DataTransfer(); dt.items.add(file);
  const bgInput = document.getElementById('customBgInput');
  if (bgInput) { bgInput.files = dt.files; bgInput.dispatchEvent(new Event('change')); }
  closeFaceSwapStudio();
  if (typeof openNewsStudio === 'function') openNewsStudio();
  showToast('🎭 Image set as background in News Studio!', 3500);
}

function fsReset() {
  _fs.selectedTpl = null; _fs.srcFile = null;
  _fs.selectedBg = 'none'; _fs.bgFile = null;
  _fs.resultBlob = null; _fs.resultIsVideo = false;
  // Reset face upload
  const srcPrev = document.getElementById('fsSrcPreview');
  if (srcPrev) { srcPrev.src=''; srcPrev.style.display='none'; }
  const srcPh = document.getElementById('fsSrcPlaceholder');
  if (srcPh) srcPh.style.display='';
  const srcInput = document.getElementById('fsSrcInput');
  if (srcInput) srcInput.value='';
  // Reset bg selection
  document.querySelectorAll('.fs-bg-opt').forEach(c => c.classList.remove('selected'));
  const noneOpt = document.getElementById('fsBgOpt_none');
  if (noneOpt) noneOpt.classList.add('selected');
  // Reset result
  const rb = document.getElementById('fsResultBox');
  if (rb) rb.style.display='none';
  // Reset template
  fsClearTemplate();
  fsRenderTemplates('all');
  fsGoStep(1, true);
}
