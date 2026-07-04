'use strict';
/*
 * AI PANDIT — Frontend Logic
 * Handles: Gemini chat, ritual state machine, Web TTS/STT,
 *          Hindu calendar, panchang, guided pooja session
 */

// ══════════════════════════════════════════════════════════════
//  CONFIGURATION
// ══════════════════════════════════════════════════════════════
const PANDIT_CONFIG = {
  server: window.location.origin,
  defaultLang: 'hi',
  ttsLang: { hi: 'hi-IN', en: 'en-IN', sa: 'hi-IN' },
  ttsRate: 0.82,
  ttsPitch: 0.6,   // lower = deeper male voice
  ttsVolume: 1.0,
  maxHistory: 14,
};

const PANDIT_SYSTEM_PROMPT = `You are AI Pandit Ji, a deeply learned Vedic scholar and priest rooted in the Smarta and Puranic tradition. You help Hindu devotees with:
- Complete step-by-step pooja vidhis in simple Hindi
- Mantra chanting with pronunciation guidance (Devanagari + transliteration)
- Hindu calendar: tithis, vrats, ekadashi, purnima, amavasya, festivals and muhurat advice
- Answers about Vedas, Upanishads, Puranas, Dharma Shastra, and daily Dharma
- Identifying which pooja/vrat suits a devotee's problem or desire, with practical home-based instructions
- Astrology: general suggestive spiritual guidance ONLY — never absolute life predictions or fear-inducing statements

RULES:
1. Always respond in Hindi unless the user writes in English.
2. Use respectful, warm Sanskrit-Hindi vocabulary (like a knowledgeable pandit would speak).
3. For every pooja step, give specific practical instructions (quantities, timing, substitutions for missing items).
4. Cite the Purana/Shastra source when relevant (e.g., "शिव पुराण के अनुसार...").
5. For astrology, say "यह एक सुझाव है" and recommend spiritual practices, NEVER declare destinies.
6. If a devotee mentions a problem (illness, debt, marriage delay, enemy trouble), suggest the appropriate pooja/vrat/mantra with reason.
7. Mantras must be written in Devanagari. Also provide transliteration when asked.
8. Keep responses warm, encouraging, and practical — a pandit at home, not a textbook.
9. Always end ritual instructions with a reminder to seek a qualified human pandit for complex ceremonies.
10. When giving a Sankalpa, use the devotee's actual naam and gotra from their profile.
11. For any new problem or ailment, ask one clarifying question before giving advice (like a real pandit would).
12. Reference today's panchang naturally in your advice ("आज शुक्रवार है, लक्ष्मी पूजा के लिए उत्तम दिन है...")`;

// ══════════════════════════════════════════════════════════════
//  DEVOTEE PROFILE  (persisted in localStorage)
// ══════════════════════════════════════════════════════════════
function loadDevoteeProfile() {
  try {
    const raw = localStorage.getItem('pandit_devotee_profile');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function showProfileModal() {
  const modal = $('profile-modal');
  if (!modal) return;
  const profile = loadDevoteeProfile();
  if (profile) {
    if ($('profile-naam'))  $('profile-naam').value  = profile.naam  || '';
    if ($('profile-gotra')) $('profile-gotra').value = profile.gotra || '';
    if ($('profile-rashi')) $('profile-rashi').value = profile.rashi || '';
    document.querySelectorAll('.sampradaya-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === (profile.sampradaya || 'स्मार्त'));
    });
  }
  modal.classList.add('open');
}

function closeProfileModal() {
  const modal = $('profile-modal');
  if (modal) modal.classList.remove('open');
}

function selectSampradaya(btn) {
  document.querySelectorAll('.sampradaya-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function saveProfile() {
  const naam      = ($('profile-naam')?.value  || '').trim();
  const gotra     = ($('profile-gotra')?.value || '').trim();
  const rashi     = $('profile-rashi')?.value  || '';
  const sampBtn   = document.querySelector('.sampradaya-btn.active');
  const sampradaya = sampBtn ? sampBtn.dataset.val : 'स्मार्त';
  const profile = { naam, gotra, rashi, sampradaya };
  localStorage.setItem('pandit_devotee_profile', JSON.stringify(profile));
  closeProfileModal();
  // Reset history so next query gets the updated profile in system prompt
  panditState.history = [];
  updateSankalpCard();
  if (naam) {
    const parts = [];
    if (gotra)     parts.push(`आपका गोत्र ${gotra} है`);
    if (rashi)     parts.push(`राशि ${rashi} है`);
    if (sampradaya) parts.push(`परंपरा ${sampradaya} है`);
    const detail = parts.length ? ' ' + parts.join(', ') + '.' : '.';
    const greet = `🙏 ${naam} जी, नमस्ते!\n\nआपका परिचय मिला।${detail}\n\nमैं अब आपकी परंपरा और राशि के अनुसार व्यक्तिगत मार्गदर्शन दे सकता हूँ। संकल्प में आपका नाम और गोत्र स्वतः आएगा। कोई भी पूजा, व्रत या समस्या पूछें।`;
    addMsg('ai', greet);
    if (panditState.voiceEnabled) panditSpeak(greet);
  }
  // Update header button label
  const hBtn = $('profile-header-btn');
  if (hBtn && naam) hBtn.textContent = `👤 ${naam.split(' ')[0]}`;
}

function updateSankalpCard() {
  const profile = loadDevoteeProfile();
  const el = $('sankalpa-devotee-text');
  const promptEl = $('sankalpa-profile-prompt');
  if (!el) return;
  if (profile && profile.naam) {
    const gotraText = profile.gotra ? `, ${profile.gotra} गोत्रोत्पन्न` : '';
    const rashiText = profile.rashi ? `, ${profile.rashi} राशि` : '';
    el.innerHTML = `<strong>${profile.naam}</strong>${gotraText}${rashiText}`;
    if (promptEl) promptEl.style.display = 'none';
  } else {
    el.innerHTML = '(नाम)';
    if (promptEl) promptEl.style.display = 'block';
  }
}

function buildSankalpText() {
  const profile = loadDevoteeProfile();
  const naam  = profile?.naam  || 'नाम लें';
  const gotra = profile?.gotra || 'अपना गोत्र';
  return `ओम विष्णुर्विष्णुर्विष्णुः। अद्य, अहं ${naam}, ${gotra} गोत्रोत्पन्नः, इदं पूजां करिष्ये। भगवान मेरी मनोकामना पूर्ण करें।`;
}

// Build context-aware system prompt with devotee profile + today's panchang
function buildSystemPrompt() {
  const profile = loadDevoteeProfile();
  const p = window.PANDIT_DB ? window.PANDIT_DB.getPanchang(new Date()) : null;

  const profileSection = (profile && profile.naam)
    ? `\n\nDEVOTEE PROFILE:\n- नाम: ${profile.naam}\n- गोत्र: ${profile.gotra || 'अज्ञात'}\n- राशि: ${profile.rashi || 'अज्ञात'}\n- संप्रदाय: ${profile.sampradaya || 'स्मार्त'}\nAlways address this devotee as "${profile.naam} जी". In any Sankalpa, use naam="${profile.naam}" and gotra="${profile.gotra || 'कश्यप'}".`
    : `\n\nDEVOTEE PROFILE: Not yet provided. For any ritual or pooja request, kindly ask: "आपका शुभ नाम और गोत्र क्या है?" before giving a personalised vidhi.`;

  const panchangSection = p
    ? `\n\nTODAY'S PANCHANG:\n- वार: ${p.varar}\n- तिथि: ${p.paksha} ${p.tithi}\n- नक्षत्र: ${p.nakshatra}\nUse this naturally when giving muhurat or timing advice ("आज ${p.varar} है, ${p.tithi} तिथि है, इसलिए...").`
    : '';

  return PANDIT_SYSTEM_PROMPT + profileSection + panchangSection;
}

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
let panditState = {
  lang: 'hi',
  history: [],               // Gemini conversation history
  ritual: null,              // Active ritual object
  ritualStep: 0,             // Current step index
  ritualPhase: 'idle',       // idle | samagri | sankalpa | steps | samapan
  speaking: false,           // TTS currently speaking
  listening: false,          // STT active
  geminiKey: '',             // loaded from server or user input
  voiceEnabled: true,
  avatarMood: 'namaste',     // namaste | chanting | explaining | thinking | blessing
};

// ══════════════════════════════════════════════════════════════
//  DOM HELPERS
// ══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function addMsg(role, text, options = {}) {
  const feed = $('pandit-chat-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = `pc-msg pc-msg-${role}`;
  if (options.isStep) div.classList.add('pc-msg-step');
  const avatar = role === 'ai'
    ? '<div class="pc-msg-avatar">🕉️</div>'
    : '<div class="pc-msg-avatar pc-msg-avatar-user">🙏</div>';
  const time = new Date().toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `${role === 'ai' ? avatar : ''}
    <div class="pc-msg-body">
      <div class="pc-msg-text">${text.replace(/\n/g, '<br>')}</div>
      <div class="pc-msg-time">${time}</div>
    </div>
    ${role === 'user' ? avatar : ''}`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  return div;
}

function setAvatarMood(mood) {
  panditState.avatarMood = mood;
  const avatar = $('pandit-avatar-img');
  if (!avatar) return;
  const moods = {
    namaste: '🙏', chanting: '🕉️', explaining: '📖',
    thinking: '🤔', blessing: '✨', listening: '👂',
  };
  avatar.textContent = moods[mood] || '🙏';
  avatar.dataset.mood = mood;
}

function setStatus(text, type = 'info') {
  // Update both the header status badge and the avatar area status
  const el = $('pandit-status');
  if (el) { el.textContent = text; el.dataset.type = type; }
  const av = $('avatar-status');
  if (av) { av.textContent = text; av.dataset.type = type; }
}

// ══════════════════════════════════════════════════════════════
//  TTS — Web Speech Synthesis
// ══════════════════════════════════════════════════════════════
function panditSpeak(text, onEnd) {
  if (!panditState.voiceEnabled || !window.speechSynthesis) {
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const clean = text
    .replace(/<[^>]+>/g, '')          // strip HTML tags
    .replace(/ॐ/g, 'ओम')             // ॐ → ओम so TTS pronounces it
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // strip all emoji (supplementary plane)
    .replace(/[\u2600-\u27BF]/g, '')  // strip misc symbols & dingbats
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // strip more emoji ranges
    .replace(/[*_~`#>]/g, '')         // strip markdown symbols
    .replace(/\s{2,}/g, ' ')          // collapse extra spaces
    .trim();
  const chunks = splitTextForTTS(clean);
  let idx = 0;

  function speakNext() {
    if (idx >= chunks.length) {
      panditState.speaking = false;
      setAvatarMood('namaste');
      updateMicBtn();
      if (onEnd) onEnd();
      return;
    }
    const utt = new SpeechSynthesisUtterance(chunks[idx++]);
    utt.lang = PANDIT_CONFIG.ttsLang[panditState.lang] || 'hi-IN';
    utt.rate = PANDIT_CONFIG.ttsRate;
    utt.pitch = PANDIT_CONFIG.ttsPitch;
    utt.volume = PANDIT_CONFIG.ttsVolume;
    // Pick a male Hindi voice for Pandit Ji
    // Male voice name keywords across Windows/Android/macOS
    const MALE_KEYWORDS = ['male','man','hemant','kalpana','ravi','rajan','deepak','arjun','hindi male','google hindi'];
    const voices = window.speechSynthesis.getVoices();
    const hiVoices = voices.filter(v => v.lang === 'hi-IN' || v.lang.startsWith('hi'));
    // 1. Prefer explicitly named male Hindi voices
    let chosen = hiVoices.find(v => MALE_KEYWORDS.some(k => v.name.toLowerCase().includes(k)));
    // 2. On Windows, "Microsoft Hemant" is the default male Hindi voice
    if (!chosen) chosen = voices.find(v => v.name.toLowerCase().includes('hemant'));
    // 3. Fall back to first available Hindi voice (still apply low pitch)
    if (!chosen) chosen = hiVoices[0];
    if (chosen && panditState.lang !== 'en') utt.voice = chosen;
    utt.onstart = () => { panditState.speaking = true; setAvatarMood('chanting'); };
    utt.onend = speakNext;
    utt.onerror = speakNext;
    window.speechSynthesis.speak(utt);
  }
  speakNext();
}

function splitTextForTTS(text, max = 200) {
  // Split on sentence boundaries to avoid TTS cutting off
  const sentences = text.match(/[^।\.!\?]+[।\.!\?]*/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > max) {
      if (current.trim()) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function stopSpeaking() {
  window.speechSynthesis && window.speechSynthesis.cancel();
  panditState.speaking = false;
  setAvatarMood('namaste');
}

// ══════════════════════════════════════════════════════════════
//  STT — Web Speech Recognition
// ══════════════════════════════════════════════════════════════
let recognition = null;
function initSTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = PANDIT_CONFIG.ttsLang[panditState.lang] || 'hi-IN';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onresult = e => {
    const transcript = e.results[0][0].transcript.trim();
    if (transcript) {
      $('pandit-input').value = transcript;
      stopListening();
      sendMessage(transcript);
    }
  };
  r.onerror = () => { stopListening(); setStatus('माइक्रोफोन में समस्या हुई', 'error'); };
  r.onend = () => { if (panditState.listening) stopListening(); };
  return r;
}

function startListening() {
  if (panditState.speaking) stopSpeaking();
  if (!recognition) recognition = initSTT();
  if (!recognition) { setStatus('यह ब्राउज़र आवाज़ पहचान नहीं करता', 'warn'); return; }
  recognition.lang = PANDIT_CONFIG.ttsLang[panditState.lang] || 'hi-IN';
  try {
    recognition.start();
    panditState.listening = true;
    setStatus('सुन रहे हैं...', 'listening');
    setAvatarMood('listening');
    updateMicBtn();
  } catch (e) { /* already started */ }
}

function stopListening() {
  if (recognition) try { recognition.stop(); } catch(e){}
  panditState.listening = false;
  setStatus('', 'info');
  setAvatarMood('namaste');
  updateMicBtn();
}

function toggleMic() {
  if (panditState.listening) stopListening();
  else startListening();
}

function updateMicBtn() {
  const btn = $('pandit-mic-btn');
  if (!btn) return;
  btn.classList.toggle('active', panditState.listening);
  btn.title = panditState.listening ? 'सुनना बंद करें' : 'बोलकर पूछें';
  btn.textContent = panditState.listening ? '🔴' : '🎤';
}

// ══════════════════════════════════════════════════════════════
//  GEMINI QUERY
// ══════════════════════════════════════════════════════════════
async function queryPandit(userMessage) {
  // Build conversation — embed system prompt into the very first user turn
  // (avoids system_instruction field which some API versions reject)
  const recent = panditState.history.slice(-PANDIT_CONFIG.maxHistory);
  const contents = [];
  for (const h of recent) {
    contents.push({ role: h.role, parts: [{ text: h.text }] });
  }
  // If no prior history, prepend the system persona to the user message
  const fullMsg = recent.length === 0
    ? buildSystemPrompt() + '\n\n---\nDevotee: ' + userMessage
    : userMessage;
  contents.push({ role: 'user', parts: [{ text: fullMsg }] });

  const body = {
    contents,
    generationConfig: { temperature: 0.75, maxOutputTokens: 1024 },
  };

  // Helper: fetch + safe JSON parse with clear errors
  async function callProxy(url, extraHeaders) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      // Non-JSON body means a server/proxy error page — extract a readable message
      const raw = await res.text();
      const snippet = raw.replace(/<[^>]+>/g, ' ').trim().slice(0, 120);
      throw new Error(`Server error (${res.status}): ${snippet}`);
    }
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return extractGeminiText(data);
  }

  // 1. Get user-supplied key first (takes priority over server-side key)
  const keyEl = $('pandit-gemini-key');
  const userKey = (keyEl ? keyEl.value.trim() : '') ||
                  localStorage.getItem('pandit_gemini_key') || '';

  // 2. If user key exists → call Gemini directly (CORS-enabled, works from any origin)
  if (userKey) {
    const GEMINI_DIRECT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(userKey)}`;
    return await callProxy(GEMINI_DIRECT);
  }

  // 3. No user key → try server-side proxy (requires Python/Node server with .env key)
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal) {
    try {
      return await callProxy(`${PANDIT_CONFIG.server}/proxy/gemini`);
    } catch (e) {
      // Server key not configured — fall through to ask user for key
    }
  }

  // 4. No key available at all
  throw new Error(
    'Gemini API key नहीं मिली।\n' +
    'कृपया ⚙️ Settings खोलें और अपनी Gemini API key डालें।\n' +
    'मुफ़्त key यहाँ मिलेगी: https://aistudio.google.com/app/apikey'
  );
}

function extractGeminiText(data) {
  // Handle safety blocks
  const fb = data?.promptFeedback;
  if (fb?.blockReason) {
    throw new Error(`प्रश्न को AI ने block किया (${fb.blockReason})। कृपया अलग शब्दों में पूछें।`);
  }
  try {
    const text = data.candidates[0].content.parts[0].text;
    if (!text) throw new Error('empty');
    return text;
  } catch (e) {
    throw new Error('पंडित जी का उत्तर समझ नहीं आया। कृपया फिर कोशिश करें।');
  }
}

// ══════════════════════════════════════════════════════════════
//  SEND MESSAGE (main entry point)
// ══════════════════════════════════════════════════════════════
async function sendMessage(text) {
  text = (text || $('pandit-input').value || '').trim();
  if (!text) return;
  $('pandit-input').value = '';

  addMsg('user', text);
  panditState.history.push({ role: 'user', text });
  setAvatarMood('thinking');
  setStatus('पंडित जी सोच रहे हैं...', 'thinking');

  const thinkEl = addMsg('ai', '<span class="pc-thinking">🕉️ प्रतीक्षा करें...</span>');

  try {
    const reply = await queryPandit(text);
    thinkEl.querySelector('.pc-msg-text').innerHTML = reply.replace(/\n/g, '<br>');
    panditState.history.push({ role: 'model', text: reply });
    setStatus('', 'info');
    setAvatarMood('explaining');
    if (panditState.voiceEnabled) {
      panditSpeak(reply, () => setAvatarMood('namaste'));
    }
  } catch (err) {
    thinkEl.querySelector('.pc-msg-text').innerHTML =
      `<span style="color:#fca5a5">⚠️ ${err.message}</span>`;
    setStatus(err.message, 'error');
    setAvatarMood('namaste');
  }
}

// ══════════════════════════════════════════════════════════════
//  RITUAL STATE MACHINE
// ══════════════════════════════════════════════════════════════
function startRitual(poojaId) {
  const pooja = window.PANDIT_DB.poojas.find(p => p.id === poojaId);
  if (!pooja) return;

  panditState.ritual = pooja;
  panditState.ritualStep = 0;
  panditState.ritualPhase = 'samagri';

  renderRitualPanel(pooja);
  showPhase('samagri');

  // Auto-switch to the Ritual tab so the user can see the samagri list + button
  if (typeof switchTab === 'function') {
    switchTab('tab-ritual', 'view-ritual');
  }

  const greeting = `${pooja.name} के लिए आपका स्वागत है।\n\nयह पूजा ${pooja.deity} की उपासना है। अवधि: ${pooja.duration}। सर्वश्रेष्ठ दिन: ${pooja.bestDay}।\n\nपहले "पूजा मार्गदर्शन" टैब में सामग्री की सूची देखें, सभी वस्तुएं एकत्र करें और चेकबॉक्स टिक करें। फिर "सामग्री तैयार है — आगे बढ़ें" बटन दबाएं।`;
  addMsg('ai', greeting);
  if (panditState.voiceEnabled) panditSpeak(greeting);
}

function showPhase(phase) {
  panditState.ritualPhase = phase;
  qsa('.pc-phase').forEach(el => el.classList.remove('active'));
  const el = $(phase === 'idle' ? 'pc-phase-idle' : `pc-phase-${phase}`);
  if (el) el.classList.add('active');
  updateRitualProgress();
}

function updateRitualProgress() {
  const ritual = panditState.ritual;
  if (!ritual) return;
  const total = ritual.steps.length;
  const done = panditState.ritualStep;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = $('ritual-progress-bar');
  const label = $('ritual-progress-label');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = `चरण ${done} / ${total}`;
}

function renderSamagri(pooja) {
  const list = $('samagri-list');
  if (!list) return;
  list.innerHTML = pooja.samagri.map((s, i) => `
    <div class="samagri-item" id="si-${i}">
      <input type="checkbox" id="sc-${i}" onchange="checkSamagri(${i})">
      <label for="sc-${i}">
        <strong>${s.item}</strong> — ${s.qty}
        ${s.purpose ? `<em>(${s.purpose})</em>` : ''}
        ${s.sub ? `<span class="sub-note">विकल्प: ${s.sub}</span>` : ''}
      </label>
    </div>`).join('');
  const header = $('samagri-header');
  if (header) header.textContent = `${pooja.name} — सामग्री सूची`;
}

function renderRitualPanel(pooja) {
  const title = $('ritual-title');
  if (title) title.textContent = pooja.name;
  renderSamagri(pooja);
  const stepsEl = $('ritual-steps-list');
  if (stepsEl) {
    stepsEl.innerHTML = pooja.steps.map((s, i) => `
      <div class="ritual-step-item ${i === 0 ? 'current' : ''}" id="rst-${i}" onclick="goToStep(${i})">
        <span class="step-num">${s.n}</span>
        <span class="step-title">${s.title}</span>
        <span class="step-check" id="stck-${i}"></span>
      </div>`).join('');
  }
}

function checkSamagri(i) {
  const el = $(`si-${i}`);
  if (el) el.classList.toggle('checked', $(`sc-${i}`).checked);
}

function allSamagriChecked() {
  const ritual = panditState.ritual;
  if (!ritual) return true;
  const checks = ritual.samagri.map((_, i) => $(`sc-${i}`)?.checked);
  return checks.every(Boolean);
}

function proceedToSankalpa() {
  if (!allSamagriChecked()) {
    const msg = 'कृपया सभी सामग्री एकत्र करके चेकबॉक्स टिक करें।\n\nयदि कोई वस्तु उपलब्ध न हो तो पंडित जी से विकल्प पूछें।';
    addMsg('ai', msg);
    if (panditState.voiceEnabled) panditSpeak(msg);
    return;
  }
  showPhase('sankalpa');
  const ritual = panditState.ritual;
  const sankalpText = `बहुत अच्छे! सामग्री तैयार है। अब संकल्प करें।\n\n🙏 संकल्प मंत्र:\n${ritual.steps[0]?.mantraHi || 'ॐ विष्णुर्विष्णुर्विष्णुः...'}\n\nबाएं हाथ में जल लें, दाएं हाथ से ढकें। अपना नाम और पूजा का उद्देश्य मन में बोलें। फिर जल जमीन पर या पूजा पात्र में छोड़ें।\n\n"मैं तैयार हूँ" बोलें या नीचे का बटन दबाएं।`;
  addMsg('ai', sankalpText);
  if (panditState.voiceEnabled) panditSpeak(sankalpText);
}

function startSteps() {
  showPhase('steps');
  panditState.ritualStep = 0;
  presentStep(0);
}

function presentStep(idx) {
  const ritual = panditState.ritual;
  if (!ritual) return;
  if (idx >= ritual.steps.length) {
    finishRitual();
    return;
  }
  panditState.ritualStep = idx;
  updateRitualProgress();

  // Highlight active step in sidebar
  qsa('.ritual-step-item').forEach((el, i) => {
    el.classList.toggle('current', i === idx);
    el.classList.toggle('done', i < idx);
    const check = $(`stck-${i}`);
    if (check) check.textContent = i < idx ? '✅' : i === idx ? '▶' : '';
  });

  const step = ritual.steps[idx];
  const total = ritual.steps.length;
  const msg = `\n📿 चरण ${idx + 1} / ${total}: **${step.title}**\n\n${step.instruction || ''}\n\n${step.mantraHi ? `🕉️ मंत्र:\n${step.mantraHi}` : ''}\n\n${step.duration ? `⏱ अनुमानित समय: ${step.duration}` : ''}`;

  addMsg('ai', msg, { isStep: true });
  if (panditState.voiceEnabled) {
    const speakText = `चरण ${idx + 1}: ${step.title}। ${step.instruction || ''}। ${step.mantraHi ? step.mantraHi : ''}`;
    panditSpeak(speakText);
  }

  // Update step display
  const stepDisplay = $('current-step-display');
  if (stepDisplay) {
    stepDisplay.innerHTML = `
      <div class="step-n">चरण ${idx + 1} / ${total}</div>
      <div class="step-t">${step.title}</div>
      <div class="step-inst">${step.instruction || ''}</div>
      ${step.mantraHi ? `<div class="step-mantra">${step.mantraHi}</div>` : ''}
      ${step.duration ? `<div class="step-dur">⏱ ${step.duration}</div>` : ''}`;
  }
}

function nextStep() {
  presentStep(panditState.ritualStep + 1);
}

function prevStep() {
  if (panditState.ritualStep > 0) presentStep(panditState.ritualStep - 1);
}

function goToStep(idx) {
  if (panditState.ritualPhase === 'steps') presentStep(idx);
}

function repeatCurrentMantra() {
  const ritual = panditState.ritual;
  if (!ritual) return;
  const step = ritual.steps[panditState.ritualStep];
  if (step && step.mantraHi) panditSpeak(step.mantraHi);
}

function finishRitual() {
  showPhase('samapan');
  const ritual = panditState.ritual;
  const msg = `🎊 ${ritual.name} सम्पन्न हुई!\n\n🙏 पूजा फल: ${(ritual.benefits || []).join(', ')}\n\nभगवान आपकी मनोकामना पूर्ण करें। प्रसाद सभी को वितरित करें। किसी भी प्रश्न के लिए पंडित जी से पूछें।`;
  addMsg('ai', msg);
  if (panditState.voiceEnabled) panditSpeak(msg);
  panditState.ritual = null;
  panditState.ritualPhase = 'idle';
}

function endRitual() {
  panditState.ritual = null;
  panditState.ritualStep = 0;
  panditState.ritualPhase = 'idle';
  showPhase('idle');
  addMsg('ai', 'पूजा सत्र समाप्त किया। नमस्ते! 🙏');
}

// ══════════════════════════════════════════════════════════════
//  PANCHANG DISPLAY
// ══════════════════════════════════════════════════════════════
function loadPanchang(date) {
  date = date || new Date();
  const p = window.PANDIT_DB.getPanchang(date);
  const festivalHtml = p.festivals.length
    ? p.festivals.map(f => `<div class="panchang-festival">${f.name}</div>`).join('')
    : '';
  const el = $('panchang-display');
  if (!el) return;
  el.innerHTML = `
    <div class="panchang-row"><span>वार</span><strong>${p.varar}</strong></div>
    <div class="panchang-row"><span>पक्ष</span><strong>${p.paksha}</strong></div>
    <div class="panchang-row"><span>तिथि</span><strong>${p.tithi}</strong></div>
    <div class="panchang-row"><span>नक्षत्र</span><strong>${p.nakshatra}</strong></div>
    <div class="panchang-row"><span>योग</span><strong>${p.yoga}</strong></div>
    ${festivalHtml ? `<div class="panchang-festival-block">${festivalHtml}</div>` : ''}`;
}

function loadCalendar() {
  const upcoming = window.PANDIT_DB.getUpcomingFestivals(45);
  const el = $('calendar-list');
  if (!el) return;
  el.innerHTML = upcoming.length
    ? upcoming.map(f => {
        const d = new Date(f.date);
        const dayStr = d.toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', weekday: 'short' });
        const daysLeft = Math.round((d - new Date()) / 86400000);
        const badge = daysLeft === 0 ? '🔴 आज' : daysLeft === 1 ? '🟠 कल' : `${daysLeft} दिन बाद`;
        return `<div class="cal-item cal-${f.type}" onclick="showFestivalDetail('${f.date}')">
          <div class="cal-date">${dayStr}</div>
          <div class="cal-name">${f.name}</div>
          <div class="cal-badge">${badge}</div>
        </div>`;
      }).join('')
    : '<div style="padding:12px;color:#94a3b8">कोई आगामी त्योहार नहीं मिला</div>';
}

function showFestivalDetail(dateStr) {
  const f = window.PANDIT_DB.festivals.find(x => x.date === dateStr);
  if (!f) return;
  let detail = `${f.name}`;
  if (f.vidhi) detail += `\n\nविधि: ${f.vidhi}`;
  if (f.mantra) detail += `\n\nमंत्र: ${f.mantra}`;
  addMsg('ai', detail);
  if (panditState.voiceEnabled) panditSpeak(detail);
}

// ══════════════════════════════════════════════════════════════
//  POOJA MENU RENDER
// ══════════════════════════════════════════════════════════════
function renderPoojaMenu() {
  const el = $('pooja-menu');
  if (!el) return;
  el.innerHTML = window.PANDIT_DB.poojas.map(p => `
    <button class="pooja-btn" onclick="startRitual('${p.id}')" title="${p.occasion}">
      <span class="pooja-icon">${p.icon}</span>
      <span class="pooja-name">${p.name}</span>
      <span class="pooja-day">${p.bestDay.split(' ')[0]}</span>
    </button>`).join('');
}

// ══════════════════════════════════════════════════════════════
//  PROBLEM SOLVER
// ══════════════════════════════════════════════════════════════
function showProblemSolver() {
  const el = $('problems-list');
  if (!el) return;
  el.innerHTML = window.PANDIT_DB.problems.map((p, i) => `
    <div class="problem-item" onclick="showRemedy(${i})">
      <div class="problem-q">🔸 ${p.problem}</div>
    </div>`).join('');
  togglePanel('panel-problems');
}

function showRemedy(i) {
  const p = window.PANDIT_DB.problems[i];
  const msg = `🔸 समस्या: ${p.problem}\n\n🙏 उपाय:\n${p.remedy}\n\n⏰ उत्तम समय: ${p.time}`;
  addMsg('ai', msg);
  if (panditState.voiceEnabled) panditSpeak(msg);
  // Also suggest starting the pooja if applicable
  if (p.pooja) {
    setTimeout(() => {
      const poojaInfo = window.PANDIT_DB.poojas.find(x => x.id === p.pooja);
      if (poojaInfo) {
        const offer = $('remedy-start-btn');
        if (offer) {
          offer.dataset.pooja = p.pooja;
          offer.textContent = `${poojaInfo.icon} ${poojaInfo.name} शुरू करें`;
          offer.style.display = 'inline-flex';
        }
      }
    }, 300);
  }
}

function startRecommendedPooja() {
  const btn = $('remedy-start-btn');
  if (btn && btn.dataset.pooja) startRitual(btn.dataset.pooja);
}

// ══════════════════════════════════════════════════════════════
//  MANTRA QUICK ACCESS
// ══════════════════════════════════════════════════════════════
function speakMantra(key) {
  const db = window.PANDIT_DB.mantras;
  let text;
  if (key === 'mahamrityunjaya') text = db.mahamrityunjaya.hi;
  else if (key === 'gayatri') text = db.gayatri.hi;
  else if (key === 'panchakshara') text = db.panchakshara.hi;
  else if (key === 'ganesh') text = 'ॐ गं गणपतये नमः। वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ। निर्विघ्नं कुरु मे देव सर्वकार्येषु सर्वदा।।';
  if (!text) return;
  addMsg('ai', `🕉️ ${text}`);
  panditSpeak(text);
}

function togglePanel(panelId) {
  const allPanels = ['panel-poojas', 'panel-problems', 'panel-mantras', 'panel-calendar'];
  allPanels.forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('open', id === panelId && !el.classList.contains('open'));
  });
}

// ══════════════════════════════════════════════════════════════
//  LANGUAGE SWITCH
// ══════════════════════════════════════════════════════════════
function setLanguage(lang) {
  panditState.lang = lang;
  if (recognition) recognition.lang = PANDIT_CONFIG.ttsLang[lang] || 'hi-IN';
  const langBtns = qsa('.lang-btn');
  langBtns.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  const greet = lang === 'en'
    ? 'Language switched to English. How can I help you?'
    : lang === 'sa'
    ? 'संस्कृत भाषा चयन हुआ। आपकी सेवा में तत्पर हूँ। 🙏'
    : 'भाषा हिंदी में बदल दी गई। पंडित जी की सेवा में आपका स्वागत है। 🙏';
  addMsg('ai', greet);
}

// ══════════════════════════════════════════════════════════════
//  VOICE TOGGLE
// ══════════════════════════════════════════════════════════════
function toggleVoice() {
  panditState.voiceEnabled = !panditState.voiceEnabled;
  const btn = $('voice-toggle-btn');
  if (btn) {
    btn.textContent = panditState.voiceEnabled ? '🔊 आवाज़ चालू' : '🔇 आवाज़ बंद';
    btn.classList.toggle('muted', !panditState.voiceEnabled);
  }
  if (!panditState.voiceEnabled) stopSpeaking();
}

// ══════════════════════════════════════════════════════════════
//  GREETING ON LOAD
// ══════════════════════════════════════════════════════════════
function panditGreet() {
  const db = window.PANDIT_DB;
  const p = db.getPanchang(new Date());
  const profile = loadDevoteeProfile();
  const upcoming = db.getUpcomingFestivals(3);
  const festMsg = upcoming.length
    ? `\n\nआगामी पर्व: ${upcoming.map(f => f.name).join(', ')}`
    : '';

  let greet;
  if (profile && profile.naam) {
    greet = `🙏 ${profile.naam} जी, नमस्ते! AI पंडित जी की सेवा में पुनः स्वागत है।\n\nआज ${p.varar} है। ${p.paksha} ${p.tithi} तिथि, ${p.nakshatra} नक्षत्र।${festMsg}\n\nआप मुझसे कोई भी पूजा, मंत्र, व्रत, या आध्यात्मिक समस्या के बारे में पूछ सकते हैं।`;
  } else {
    greet = `🙏 नमस्ते! AI पंडित जी की सेवा में आपका स्वागत है।\n\nआज ${p.varar} है। ${p.paksha} ${p.tithi} तिथि, ${p.nakshatra} नक्षत्र।${festMsg}\n\n👤 व्यक्तिगत संकल्प और मार्गदर्शन के लिए ऊपर "👤 परिचय" बटन दबाकर अपना नाम और गोत्र बताएं।\n\nया सीधे कोई भी पूजा, मंत्र या प्रश्न पूछें।`;
  }
  addMsg('ai', greet);
  if (panditState.voiceEnabled) {
    setTimeout(() => panditSpeak(greet), 800);
  }
}

// ══════════════════════════════════════════════════════════════
//  QUICK QUESTION PROMPTS
// ══════════════════════════════════════════════════════════════
const QUICK_PROMPTS = [
  'आज का शुभ मुहूर्त क्या है?',
  'सोमवार का व्रत कैसे करें?',
  'एकादशी व्रत के नियम बताएं',
  'महामृत्युंजय मंत्र का अर्थ बताएं',
  'शादी के लिए अच्छा मुहूर्त कैसे देखें?',
  'पितृ दोष क्या है और उपाय?',
  'गायत्री मंत्र का जाप कब करें?',
  'नवरात्रि में क्या करें?',
];

function renderQuickPrompts() {
  const el = $('quick-prompts');
  if (!el) return;
  el.innerHTML = QUICK_PROMPTS.map(q =>
    `<button class="quick-prompt-btn" onclick="sendMessage('${q.replace(/'/g,"\\'")}')">💬 ${q}</button>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════
//  KEY HANDLING (Enter to send)
// ══════════════════════════════════════════════════════════════
function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
function initPandit() {
  loadPanchang();
  loadCalendar();
  renderPoojaMenu();
  renderQuickPrompts();
  updateSankalpCard();
  panditGreet();

  // Update header profile button label if naam already saved
  const profile = loadDevoteeProfile();
  const hBtn = $('profile-header-btn');
  if (hBtn && profile?.naam) hBtn.textContent = `👤 ${profile.naam.split(' ')[0]}`;

  // Show profile modal on first visit (after greeting settles)
  if (!profile) {
    setTimeout(() => showProfileModal(), 2200);
  }

  // Auto-load voices
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => { /* voices ready */ };
  }

  // Show/hide STT button based on support
  const micBtn = $('pandit-mic-btn');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (micBtn && !SR) {
    micBtn.style.opacity = '0.4';
    micBtn.title = 'यह ब्राउज़र voice input नहीं करता (Chrome/Edge उपयोग करें)';
  }

  // Greeting
  setAvatarMood('namaste');
  setStatus('पंडित जी उपस्थित हैं', 'info');
}

document.addEventListener('DOMContentLoaded', initPandit);
