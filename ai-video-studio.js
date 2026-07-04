/* ═══════════════════════════════════════════════════════════════════════════
   AI SHORT-FORM VIDEO GENERATOR  —  ai-video-studio.js
   Pipeline: Ollama LLaMA3 → ComfyUI/SDXL → XTTS v2 → AudioCraft → FFmpeg
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const AIVS = {
  topic:       '',
  niche:       'motivation',
  lang:        'nepali',
  duration:    30,
  style:       'cinematic',
  voiceStyle:  'energetic',
  musicMood:   'epic',
  videoModel:  'none',   // 'none' | 'wan2' | 'cogvideox'
  script:      null,   // {title, hook, scenes:[{narration,imagePrompt,duration}], cta}
  scenes:      [],     // [{narration, imagePrompt, duration, imageB64, videoB64, audioB64, status}]
  musicB64:    null,
  jobId:       null,
  finalVideoUrl: null,
  services:    { ollama:false, comfyui:false, wan2:false, cogvideox:false, xtts:false, audiocraft:false, ffmpeg:false },
};

// ── Service endpoints (local AI stack) ────────────────────────────────────────
const AIVS_EP = {
  script:   '/api/aivideo/script',
  image:    '/api/aivideo/image',
  wan2:     '/api/aivideo/wan2',
  cogvideo: '/api/aivideo/cogvideox',
  tts:      '/api/aivideo/tts',
  music:    '/api/aivideo/music',
  assemble: '/api/aivideo/assemble',
  status:   '/api/aivideo/status',
};

// ── Open / Close ──────────────────────────────────────────────────────────────
function openAIVideoStudio() {
  ['newsStudioModal','memeStudio','puzzleStudio','contentStudioModal',
   'videoStudioModal','faceSwapModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('aiVideoStudioModal').style.display = 'flex';
  aivsPingServices();
}

function closeAIVideoStudio() {
  document.getElementById('aiVideoStudioModal').style.display = 'none';
}

// ── Ping all local services ───────────────────────────────────────────────────
async function aivsPingServices() {
  const statusEl = document.getElementById('aivsServiceStatus');
  statusEl.innerHTML = '<span style="color:#fbbf24">⏳ Checking local AI services…</span>';
  try {
    const res = await fetch(AIVS_EP.status);
    const data = await res.json();
    AIVS.services = data.services || AIVS.services;
    renderServiceBadges();
  } catch {
    statusEl.innerHTML = '<span style="color:#f87171">⚠️ Server not reachable</span>';
  }
}

function renderServiceBadges() {
  const map = {
    ollama:      { label:'🧠 Ollama LLaMA3',    tip:'Script generation' },
    comfyui:     { label:'🖼️ ComfyUI/SDXL',     tip:'Image generation'  },
    wan2:        { label:'🌊 Wan 2.1',           tip:'Text-to-Video'     },
    cogvideox:   { label:'🧠 CogVideoX-5B',      tip:'Text/Img-to-Video' },
    xtts:        { label:'🎙️ XTTS v2',           tip:'Voice synthesis'   },
    audiocraft:  { label:'🎵 AudioCraft',         tip:'Music generation'  },
    ffmpeg:      { label:'🎞️ FFmpeg',             tip:'Video assembly'    },
  };
  let html = '';
  for (const [key, info] of Object.entries(map)) {
    const ok = AIVS.services[key];
    html += `<span class="aivs-badge ${ok ? 'ok' : 'off'}" title="${info.tip}">${info.label} ${ok ? '✅' : '❌'}</span>`;
  }
  document.getElementById('aivsServiceStatus').innerHTML = html;
}

// ── Step navigation ───────────────────────────────────────────────────────────
let _aivsStep = 1;
function aivsGoStep(n) {
  document.querySelectorAll('.aivs-step-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.aivs-stepper-item').forEach((s,i) => {
    s.classList.toggle('active',   i+1 === n);
    s.classList.toggle('done',     i+1 < n);
  });
  const pane = document.getElementById(`aivsPane${n}`);
  if (pane) pane.style.display = 'block';
  _aivsStep = n;
}

// ── STEP 1 → Generate Script via Ollama ──────────────────────────────────────
async function aivsGenerateScript() {
  const topic      = document.getElementById('aivsTopic').value.trim();
  const niche      = document.getElementById('aivsNiche').value;
  const lang       = document.getElementById('aivsLang').value;
  const duration   = parseInt(document.getElementById('aivsDuration').value) || 30;
  const style      = document.getElementById('aivsStyle').value;
  const voiceStyle = document.getElementById('aivsVoiceStyle').value;
  const musicMood  = document.getElementById('aivsMusicMood').value;

  if (!topic) { aivsToast('Please enter a topic/idea first!', 'warn'); return; }

  Object.assign(AIVS, { topic, niche, lang, duration, style, voiceStyle, musicMood });
  AIVS.videoModel = document.getElementById('aivsVideoModel')?.value || 'none';

  const btn = document.getElementById('aivsGenScriptBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Generating script…';
  aivsLog('🧠 Calling Ollama LLaMA3 for script…');

  const sceneCount = Math.max(3, Math.round(duration / 8));
  const langNote   = lang === 'nepali' ? 'Write the narration in Nepali (Devanagari script).' : 'Write the narration in English.';

  const systemPrompt = `You are an expert viral short-form video scriptwriter for ${niche} content.
${langNote}
Create ONLY valid JSON — no markdown, no explanation.`;

  const userPrompt = `Create a ${duration}-second viral ${niche} short video script about: "${topic}"

Style: ${style} | Voice: ${voiceStyle} | Music mood: ${musicMood}
Scenes: exactly ${sceneCount}

Return ONLY this JSON structure:
{
  "title": "catchy video title",
  "hook": "first 3-second attention-grabbing line",
  "scenes": [
    {
      "id": 1,
      "narration": "voiceover text for this scene",
      "imagePrompt": "detailed English image generation prompt, photorealistic, ${style} style",
      "duration": 8
    }
  ],
  "cta": "call to action text at the end",
  "hashtags": ["tag1","tag2","tag3","tag4","tag5"]
}`;

  try {
    const res = await fetch(AIVS_EP.script, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: systemPrompt, prompt: userPrompt, model: 'llama3' })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Parse JSON from LLM response
    let rawText = data.response || data.content || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM did not return valid JSON');
    AIVS.script = JSON.parse(jsonMatch[0]);
    AIVS.scenes = AIVS.script.scenes.map(s => ({
      ...s, imageB64: null, audioB64: null, status: 'pending'
    }));

    aivsLog('✅ Script generated: ' + AIVS.script.title);
    renderScriptPreview();
    aivsGoStep(2);
  } catch (e) {
    aivsLog('❌ Script error: ' + e.message, 'error');
    aivsToast('Script generation failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🧠 Generate Script';
  }
}

function renderScriptPreview() {
  const s = AIVS.script;
  let html = `
    <div class="aivs-script-card">
      <div class="aivs-script-title">🎬 ${s.title}</div>
      <div class="aivs-hook">🔥 Hook: <em>${s.hook}</em></div>
      <div class="aivs-scenes-list">`;
  s.scenes.forEach((sc, i) => {
    html += `
      <div class="aivs-scene-item" id="sceneCard${i}">
        <div class="aivs-scene-header">
          <span class="aivs-scene-num">Scene ${sc.id}</span>
          <span class="aivs-scene-dur">⏱ ${sc.duration}s</span>
          <span class="aivs-scene-status" id="sceneStatus${i}">🔲 Pending</span>
        </div>
        <div class="aivs-scene-narr">🗣 ${sc.narration}</div>
        <div class="aivs-scene-prompt">🖼 <em>${sc.imagePrompt}</em></div>
        <div class="aivs-scene-preview" id="scenePreview${i}"></div>
      </div>`;
  });
  html += `</div>
      <div class="aivs-cta">📣 CTA: ${s.cta}</div>
      <div class="aivs-tags">${(s.hashtags||[]).map(h=>`<span class="aivs-tag">#${h}</span>`).join('')}</div>
    </div>`;
  document.getElementById('aivsScriptPreview').innerHTML = html;

  // Also populate step 2 edit view
  document.getElementById('aivsScriptJson').value = JSON.stringify(s, null, 2);
}

function aivsApplyScriptEdit() {
  try {
    const edited = JSON.parse(document.getElementById('aivsScriptJson').value);
    AIVS.script = edited;
    AIVS.scenes = edited.scenes.map(s => ({
      ...s, imageB64: null, audioB64: null, status: 'pending'
    }));
    aivsToast('✅ Script updated!', 'ok');
  } catch(e) {
    aivsToast('Invalid JSON: ' + e.message, 'error');
  }
}

// ── Video model selector handler ──────────────────────────────────────────────
function aivsOnVideoModelChange(val) {
  const noteEl = document.getElementById('aivsVideoModelNote');
  const notes = {
    none:       'Static images will be generated per scene and assembled into a slideshow video.',
    wan2:       '🌊 Wan 2.1 will generate a real video clip (~5s) per scene. Requires local Wan2.1 server on port 8189. ~28GB VRAM recommended.',
    cogvideox:  '🧠 CogVideoX-5B will generate a video clip per scene from text prompts. Requires local CogVideoX server on port 8190. ~16GB VRAM.',
  };
  if (noteEl) noteEl.textContent = notes[val] || notes.none;
}

// ── Unified visuals dispatcher (images OR video) ──────────────────────────────
async function aivsGenerateVisuals() {
  const model = AIVS.videoModel || 'none';
  const titleEl  = document.getElementById('aivsStep3Title');
  const badgeEl  = document.getElementById('aivsVideoModelBadge');
  const btnEl    = document.getElementById('aivsGenVisualsBtn');

  if (model === 'wan2') {
    if (titleEl) titleEl.textContent = '🌊 Step 3 — Video Generation (Wan 2.1)';
    if (badgeEl) { badgeEl.style.display='block'; badgeEl.textContent = '🌊 Using Wan 2.1 Text-to-Video — generating ~5s video clips per scene…'; }
    if (btnEl) btnEl.textContent = '🌊 Generate Scene Videos (Wan 2.1)';
    await aivsGenerateVideoClips('wan2');
  } else if (model === 'cogvideox') {
    if (titleEl) titleEl.textContent = '🧠 Step 3 — Video Generation (CogVideoX-5B)';
    if (badgeEl) { badgeEl.style.display='block'; badgeEl.textContent = '🧠 Using CogVideoX-5B — generating AI video clips per scene…'; }
    if (btnEl) btnEl.textContent = '🧠 Generate Scene Videos (CogVideoX)';
    await aivsGenerateVideoClips('cogvideox');
  } else {
    if (titleEl) titleEl.textContent = '🖼️ Step 3 — AI Image Generation';
    if (badgeEl) badgeEl.style.display = 'none';
    if (btnEl) btnEl.textContent = '🖼️ Generate All Scene Images';
    await aivsGenerateImages();
  }
}

// ── Generate video clips (Wan 2.1 or CogVideoX) per scene ────────────────────
async function aivsGenerateVideoClips(model) {
  const endpoint = model === 'wan2' ? AIVS_EP.wan2 : AIVS_EP.cogvideo;
  const modelLabel = model === 'wan2' ? 'Wan 2.1' : 'CogVideoX-5B';
  const progress = document.getElementById('aivsImageProgress');
  const progressBar = document.getElementById('aivsImageProgressBar');

  const modelConfigs = {
    wan2: {
      size: '832x480', num_frames: 81, fps: 16,
      sample_steps: 50, guide_scale: 5.0,
    },
    cogvideox: {
      width: 720, height: 480, num_frames: 49, fps: 8,
      num_inference_steps: 50, guidance_scale: 6.0,
    },
  };

  for (let i = 0; i < AIVS.scenes.length; i++) {
    const scene = AIVS.scenes[i];
    const statusEl = document.getElementById(`sceneStatus${i}`);
    if (statusEl) statusEl.textContent = `⏳ Generating (${modelLabel})…`;
    updateSceneCard(i, 'generating');
    progress.textContent = `Generating video clip ${i+1} of ${AIVS.scenes.length} with ${modelLabel}…`;
    if (progressBar) progressBar.style.width = `${Math.round((i / AIVS.scenes.length) * 100)}%`;

    const videoPrompt = scene.imagePrompt + `, ${AIVS.style} style, smooth cinematic motion, high quality`;

    try {
      const body = model === 'wan2'
        ? { prompt: videoPrompt, negative_prompt: 'blurry, low quality, watermark, distorted', ...modelConfigs.wan2 }
        : { prompt: videoPrompt, negative_prompt: 'blurry, low quality, watermark, distorted, static', ...modelConfigs.cogvideox };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Store as videoB64 (mp4 base64) or videoUrl
      scene.videoB64  = data.video || null;
      scene.videoUrl  = data.url   || null;
      scene.status    = 'video_done';

      const previewEl = document.getElementById(`scenePreview${i}`);
      if (previewEl) {
        const src = scene.videoUrl || (scene.videoB64 ? `data:video/mp4;base64,${scene.videoB64}` : null);
        if (src) {
          previewEl.innerHTML = `<video controls loop src="${src}" style="width:100%;border-radius:8px;margin-top:6px"></video>`;
        }
      }
      if (statusEl) statusEl.textContent = `🎬 Video ready (${modelLabel})`;
      aivsLog(`✅ Scene ${i+1} video generated with ${modelLabel}`);
    } catch (e) {
      scene.status = 'video_error';
      if (statusEl) statusEl.textContent = '❌ Video failed';
      aivsLog(`❌ Scene ${i+1} video failed (${modelLabel}): ${e.message}`, 'error');
      // Fallback: try static image
      aivsLog(`⚠️ Falling back to static image for scene ${i+1}…`, 'warn');
      await aivsFallbackImage(i, scene);
    }
  }
  if (progressBar) progressBar.style.width = '100%';
  progress.textContent = `✅ All scene videos generated with ${modelLabel}!`;
}

// ── Fallback: generate a static image if video model fails ───────────────────
async function aivsFallbackImage(i, scene) {
  try {
    const res = await fetch(AIVS_EP.image, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: scene.imagePrompt + `, ${AIVS.style} style, ultra HD, cinematic lighting, 8K`,
        negative_prompt: 'blurry, low quality, watermark, text, ugly, distorted',
        width: 576, height: 1024,
        steps: 25, cfg_scale: 7.5,
        model: 'juggernautXL'
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    scene.imageB64 = data.image;
    scene.status   = 'image_done';
    const previewEl = document.getElementById(`scenePreview${i}`);
    if (previewEl && data.image) {
      previewEl.innerHTML = `<img src="data:image/png;base64,${data.image}" style="width:100%;border-radius:8px;margin-top:6px"><div style="font-size:.65rem;color:#fbbf24;margin-top:3px">⚠️ Fallback static image used</div>`;
    }
    const statusEl = document.getElementById(`sceneStatus${i}`);
    if (statusEl) statusEl.textContent = '🖼️ Fallback image';
    aivsLog(`ℹ️ Scene ${i+1} used fallback static image`);
  } catch (e2) {
    aivsLog(`❌ Scene ${i+1} fallback image also failed: ${e2.message}`, 'error');
  }
}


async function aivsGenerateImages() {
  aivsGoStep(3);
  const style    = AIVS.style;
  const progress = document.getElementById('aivsImageProgress');

  for (let i = 0; i < AIVS.scenes.length; i++) {
    const scene = AIVS.scenes[i];
    const statusEl = document.getElementById(`sceneStatus${i}`);
    if (statusEl) statusEl.textContent = '⏳ Generating…';
    updateSceneCard(i, 'generating');
    progress.textContent = `Generating image ${i+1} of ${AIVS.scenes.length}…`;

    try {
      const res = await fetch(AIVS_EP.image, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: scene.imagePrompt + `, ${style} style, ultra HD, cinematic lighting, 8K`,
          negative_prompt: 'blurry, low quality, watermark, text, ugly, distorted',
          width: 576, height: 1024,
          steps: 25, cfg_scale: 7.5,
          model: 'juggernautXL'
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      scene.imageB64 = data.image;
      scene.status   = 'image_done';

      // Show preview
      const previewEl = document.getElementById(`scenePreview${i}`);
      if (previewEl && data.image) {
        previewEl.innerHTML = `<img src="data:image/png;base64,${data.image}" style="width:100%;border-radius:8px;margin-top:6px">`;
      }
      if (statusEl) statusEl.textContent = '🖼️ Image ready';
      aivsLog(`✅ Scene ${i+1} image generated`);
    } catch (e) {
      scene.status = 'image_error';
      if (statusEl) statusEl.textContent = '❌ Image failed';
      aivsLog(`❌ Scene ${i+1} image failed: ${e.message}`, 'error');
    }
  }
  progress.textContent = '✅ All images generated!';
}

// ── STEP 4 → Generate TTS Voice via XTTS ─────────────────────────────────────
async function aivsGenerateTTS() {
  aivsGoStep(4);
  const lang       = AIVS.lang;
  const voiceStyle = AIVS.voiceStyle;
  const progress   = document.getElementById('aivsTTSProgress');

  for (let i = 0; i < AIVS.scenes.length; i++) {
    const scene = AIVS.scenes[i];
    progress.textContent = `Synthesising voice ${i+1} of ${AIVS.scenes.length}…`;

    try {
      const res = await fetch(AIVS_EP.tts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scene.narration,
          language: lang === 'nepali' ? 'ne' : 'en',
          voice_style: voiceStyle,
          speed: voiceStyle === 'energetic' ? 1.15 : 1.0
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      scene.audioB64 = data.audio;
      scene.status   = 'tts_done';
      aivsLog(`✅ Scene ${i+1} voice generated`);

      // Show audio player
      const previewEl = document.getElementById(`scenePreview${i}`);
      if (previewEl && data.audio) {
        previewEl.innerHTML += `<audio controls src="data:audio/wav;base64,${data.audio}" style="width:100%;margin-top:4px"></audio>`;
      }
    } catch (e) {
      scene.status = 'tts_error';
      aivsLog(`❌ Scene ${i+1} TTS failed: ${e.message}`, 'error');
    }
  }
  progress.textContent = '✅ All voiceovers ready!';
}

// ── STEP 5 → Generate Background Music via AudioCraft ────────────────────────
async function aivsGenerateMusic() {
  const mood     = AIVS.musicMood;
  const duration = AIVS.duration + 5;
  const progress = document.getElementById('aivsMusicProgress');
  progress.textContent = '⏳ Generating background music…';

  const moodPrompts = {
    epic:       'epic cinematic orchestral music, powerful drums, rising strings',
    lofi:       'lo-fi chill beats, soft piano, gentle rhythm, cozy atmosphere',
    upbeat:     'upbeat energetic pop, positive vibes, fast tempo',
    sad:        'emotional sad piano melody, heartfelt, touching',
    motivational:'motivational rock anthem, powerful guitar, inspiring',
    ambient:    'peaceful ambient music, nature sounds, meditation',
    nepali:     'Nepali folk fusion, madal drums, sarangi, traditional melody',
    trap:       'modern trap beats, 808 bass, hi-hats, dark atmosphere',
  };

  const musicPrompt = moodPrompts[mood] || moodPrompts.epic;

  try {
    const res = await fetch(AIVS_EP.music, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: musicPrompt, duration, model: 'musicgen-melody' })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    AIVS.musicB64 = data.audio;
    progress.textContent = '✅ Background music ready!';
    aivsLog('✅ Music generated: ' + musicPrompt);

    const musicPreview = document.getElementById('aivsMusicPreview');
    if (musicPreview && data.audio) {
      musicPreview.innerHTML = `<audio controls src="data:audio/wav;base64,${data.audio}" style="width:100%;margin-top:8px;border-radius:8px"></audio>`;
    }
  } catch (e) {
    progress.textContent = '❌ Music generation failed';
    aivsLog('❌ Music failed: ' + e.message, 'error');
  }
}

// ── STEP 6 → Assemble final video via FFmpeg ──────────────────────────────────
async function aivsAssembleVideo() {
  aivsGoStep(6);
  const progress  = document.getElementById('aivsAssembleProgress');
  const resultEl  = document.getElementById('aivsResultArea');
  progress.textContent = '⏳ Assembling video with FFmpeg…';
  aivsLog('🎞️ Sending to FFmpeg assembler…');

  try {
    const payload = {
      title:   AIVS.script?.title || 'AI Video',
      scenes:  AIVS.scenes.map(s => ({
        narration:  s.narration,
        duration:   s.duration,
        image:      s.imageB64  || null,
        video:      s.videoB64  || null,
        video_url:  s.videoUrl  || null,
        audio:      s.audioB64  || null,
      })),
      music:       AIVS.musicB64 || null,
      music_vol:   0.25,
      resolution:  '1080x1920',
      fps:         30,
      style:       AIVS.style,
      video_model: AIVS.videoModel,
      fade:        true,
    };

    const res = await fetch(AIVS_EP.assemble, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    AIVS.finalVideoUrl = data.url;
    progress.textContent = '✅ Video assembled!';
    aivsLog('🎉 Video ready: ' + data.url);

    resultEl.innerHTML = `
      <div class="aivs-result-box">
        <div style="font-size:2rem;margin-bottom:8px">🎉</div>
        <div style="font-weight:900;font-size:1.1rem;margin-bottom:12px;color:#a78bfa">Your AI Video is Ready!</div>
        <video controls src="${data.url}" style="width:100%;max-width:360px;border-radius:12px;box-shadow:0 0 30px rgba(139,92,246,.5)"></video>
        <div style="margin-top:12px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a href="${data.url}" download class="aivs-download-btn">⬇️ Download MP4</a>
          <button onclick="aivsShareToSocial()" class="aivs-share-btn">📤 Share / Post</button>
          <button onclick="aivsStartOver()" class="aivs-reset-btn">🔄 Make Another</button>
        </div>
        <div style="margin-top:10px;font-size:.72rem;color:#64748b">
          ${(AIVS.script?.hashtags||[]).map(h=>`#${h}`).join(' ')}
        </div>
      </div>`;
  } catch (e) {
    progress.textContent = '❌ Assembly failed: ' + e.message;
    aivsLog('❌ Assembly error: ' + e.message, 'error');
    resultEl.innerHTML = `<div style="color:#f87171;padding:20px;text-align:center">❌ ${e.message}<br><br>
      <small>Make sure FFmpeg is installed and server is running.</small></div>`;
  }
}

// ── Full pipeline runner ──────────────────────────────────────────────────────
async function aivsRunFullPipeline() {
  aivsGoStep(3);
  document.getElementById('aivsPipelineBtn').disabled = true;
  document.getElementById('aivsPipelineBtn').textContent = '⏳ Running AI Pipeline…';
  try {
    await aivsGenerateVisuals();
    await aivsGenerateTTS();
    await aivsGenerateMusic();
    await aivsAssembleVideo();
  } finally {
    document.getElementById('aivsPipelineBtn').disabled = false;
    document.getElementById('aivsPipelineBtn').textContent = '🚀 Run Full AI Pipeline';
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function aivsLog(msg, type = 'info') {
  const logEl = document.getElementById('aivsLog');
  if (!logEl) return;
  const colors = { info:'#a78bfa', error:'#f87171', warn:'#fbbf24' };
  const ts = new Date().toLocaleTimeString();
  logEl.innerHTML += `<div style="color:${colors[type]||'#a78bfa'}">[${ts}] ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

function aivsToast(msg, type = 'ok') {
  const colors = { ok:'#22c55e', warn:'#fbbf24', error:'#ef4444' };
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:30px;right:30px;z-index:99999;
    background:${colors[type]||'#22c55e'};color:#fff;padding:12px 20px;
    border-radius:10px;font-weight:700;font-size:.9rem;box-shadow:0 4px 20px rgba(0,0,0,.4);
    animation:fadeInUp .3s ease`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function updateSceneCard(idx, status) {
  const card = document.getElementById(`sceneCard${idx}`);
  if (!card) return;
  const cls = { pending:'', generating:'aivs-scene-generating', image_done:'aivs-scene-done', error:'aivs-scene-error' };
  card.className = 'aivs-scene-item ' + (cls[status] || '');
}

function aivsShareToSocial() {
  if (!AIVS.finalVideoUrl) return;
  if (navigator.share) {
    navigator.share({ title: AIVS.script?.title || 'My AI Video', url: AIVS.finalVideoUrl });
  } else {
    window.open(AIVS.finalVideoUrl, '_blank');
  }
}

function aivsStartOver() {
  Object.assign(AIVS, {
    topic:'', script:null, scenes:[], musicB64:null, jobId:null, finalVideoUrl:null, videoModel:'none'
  });
  document.getElementById('aivsTopic').value = '';
  const vmEl = document.getElementById('aivsVideoModel');
  if (vmEl) vmEl.value = 'none';
  aivsOnVideoModelChange('none');
  document.getElementById('aivsScriptPreview').innerHTML = '';
  document.getElementById('aivsScriptJson').value = '';
  document.getElementById('aivsResultArea').innerHTML = '';
  document.getElementById('aivsLog').innerHTML = '';
  aivsGoStep(1);
}

// ── Duration label sync ───────────────────────────────────────────────────────
function aivsUpdateDurationLabel(v) {
  document.getElementById('aivsDurationLabel').textContent = v + 's';
  AIVS.duration = parseInt(v);
}
