/* ============================================================
   Joylang Tools — Word Generator, Sentence Translator, Creator
   Firebase Firestore (primary) / localStorage (fallback)
   Developer: Aman Akash
   ============================================================ */

'use strict';

// ── CONFIGURATION ─────────────────────────────────────────────
// Firebase is auto-initialized via firebase-db.js (pre-configured)
// Gemini API key: enter once in the Setup tab — stored in localStorage
const GEMINI_RPM_LIMIT = 15;           // free tier: 15 requests/minute
const GEMINI_DAILY_LIMIT = 1500;       // free tier: 1500 requests/day
const GEMINI_RESET_INTERVAL_SEC = 60;  // rate limit resets every 60 seconds

// ── STATE ──────────────────────────────────────────────────────
let currentConcept = '';
let currentRawRoot = '';
let currentJoyRoot = '';
let currentLang = '';
let currentWordForms = null;
let transMode = 'ai';
let creatorComplexity = 'simple';
let apiProvider = localStorage.getItem('jl_api_provider') || 'gemini';

// Rate-limit tracking (in-memory per page session)
let requestTimestamps = [];

// ── USER IDENTITY ──────────────────────────────────────────────
function getOrCreateUserId() {
  // Prefer Firebase Auth uid if signed in
  if (window.akashCurrentUser) return window.akashCurrentUser.uid;
  let uid = localStorage.getItem('jl_user_id');
  if (!uid) {
    uid = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('jl_user_id', uid);
  }
  return uid;
}

function getCreatedByName() {
  const user = window.akashCurrentUser;
  if (!user) return 'user';
  return window.akashIsDeveloper ? 'developer' : 'user';
}

// ── AUTH STATE HANDLER ─────────────────────────────────────────
function onAuthChange(user, isDeveloper) {
  // Show/hide Setup tab
  const tabSetup = document.getElementById('tab-setup');
  const sidebarSetupHeading = document.getElementById('sidebar-setup-heading');
  const sidebarSetupLink = document.getElementById('sidebar-setup-link');
  [tabSetup, sidebarSetupHeading, sidebarSetupLink].forEach(el => {
    if (el) el.style.display = isDeveloper ? '' : 'none';
  });
  // If setup tab was open but user signed out, switch to generator
  if (!isDeveloper) {
    const setupPanel = document.getElementById('panel-setup');
    if (setupPanel && setupPanel.classList.contains('active')) openTab('generator');
  }

  // Show/hide login prompt in My Words
  const loginPrompt = document.getElementById('saved-login-prompt');
  if (loginPrompt) loginPrompt.style.display = user ? 'none' : 'block';

  // Refresh My Words view if that tab is active
  const savedPanel = document.getElementById('panel-saved');
  if (savedPanel && savedPanel.classList.contains('active')) loadSaved();

  // Update setup status if developer
  if (isDeveloper) updateSetupStatus();
}

// ── RATE LIMITING ──────────────────────────────────────────────
function checkRateLimit() {
  const now = Date.now();
  const windowMs = GEMINI_RESET_INTERVAL_SEC * 1000;
  requestTimestamps = requestTimestamps.filter(t => now - t < windowMs);
  if (requestTimestamps.length >= GEMINI_RPM_LIMIT) {
    const oldest = requestTimestamps[0];
    const waitSec = Math.ceil((windowMs - (now - oldest)) / 1000);
    throw new Error(
      `Rate limit reached (${GEMINI_RPM_LIMIT} requests/minute on Gemini free tier). ` +
      `Resets in ${waitSec} second${waitSec !== 1 ? 's' : ''}. Please wait.`
    );
  }
  requestTimestamps.push(now);
  updateRateLimitDisplay();
}

function updateRateLimitDisplay() {
  const el = document.getElementById('rate-limit-display');
  if (!el) return;
  const now = Date.now();
  const windowMs = GEMINI_RESET_INTERVAL_SEC * 1000;
  const active = requestTimestamps.filter(t => now - t < windowMs);
  const used = active.length;
  const remaining = GEMINI_RPM_LIMIT - used;
  if (used === 0) {
    el.textContent = `Gemini free tier: ${GEMINI_RPM_LIMIT} req/min · ${GEMINI_DAILY_LIMIT} req/day · Ready`;
    el.style.color = 'var(--green)';
  } else if (remaining > 0) {
    const oldest = active[0];
    const resetIn = Math.ceil((windowMs - (now - oldest)) / 1000);
    el.textContent = `API: ${used}/${GEMINI_RPM_LIMIT} requests used · ${remaining} remaining · Resets in ${resetIn}s`;
    el.style.color = remaining <= 3 ? '#e65100' : 'var(--text-muted)';
  } else {
    const oldest = active[0];
    const resetIn = Math.ceil((windowMs - (now - oldest)) / 1000);
    el.textContent = `Rate limit reached! Resets in ${resetIn}s`;
    el.style.color = '#c62828';
  }
}

// ── JOYLANG PHONOLOGY RULES ───────────────────────────────────
const VALID_CONSONANTS = new Set(['p','b','t','d','k','g','m','n','f','s','v','h','l','r','y','j']);
const DIGRAPHS = ['sh','ch','ng'];
const VALID_VOWELS = new Set(['a','e','i','o','u']);
const ILLEGAL_FINAL = new Set(['p','b','t','d','k','g','f','v','h','j']);

function applyJoylangPhonology(rawRoot) {
  const steps = [];
  let r = rawRoot.toLowerCase().replace(/[^a-z]/g, '');
  steps.push({ from: rawRoot, to: r, rule: 'Lowercase, remove non-letter characters' });

  const phoneMap = { 'q':'k','x':'sh','z':'s','c':'k','w':'v','ñ':'n','ü':'u','ö':'o','ä':'a','é':'e','â':'a','î':'i','ô':'o','û':'u' };
  let mapped = r.split('').map(c => phoneMap[c] || c).join('');
  if (mapped !== r) steps.push({ from: r, to: mapped, rule: 'Map foreign phonemes (q→k, x→sh, z→s, w→v, etc.)' });
  r = mapped;

  const validFinalConsonants = new Set(['n','m','s','l','r']);
  if (r.length > 0) {
    const last = r[r.length-1];
    if (!VALID_VOWELS.has(last) && !validFinalConsonants.has(last)) {
      const prev = r.length > 1 ? r[r.length-2] : '';
      const vowelToAdd = VALID_VOWELS.has(prev) ? prev : 'i';
      r += vowelToAdd;
      steps.push({ from: r.slice(0,-1), to: r, rule: `Illegal final consonant '${last}' — added vowel '${vowelToAdd}'` });
    }
  }

  if (r.length < 2) {
    r = r + 'u';
    steps.push({ from: r.slice(0,-1), to: r, rule: 'Root too short — padded with "u"' });
  }

  if (VALID_VOWELS.has(r[0])) {
    r = 'y' + r;
    steps.push({ from: r.slice(1), to: r, rule: 'Cannot start with vowel — prepended "y"' });
  }

  let noTriple = r.replace(/([^aeiou]{3,})/g, (match) => match.slice(0,2));
  if (noTriple !== r) {
    steps.push({ from: r, to: noTriple, rule: 'Removed consonant cluster > 2' });
    r = noTriple;
  }

  let cvcv = '';
  let insertedVowel = false;
  for (let i = 0; i < r.length; i++) {
    cvcv += r[i];
    if (!VALID_VOWELS.has(r[i]) && i+1 < r.length && !VALID_VOWELS.has(r[i+1])) {
      const digraph = r[i] + r[i+1];
      if (!DIGRAPHS.includes(digraph)) {
        cvcv += 'a';
        insertedVowel = true;
      }
    }
  }
  if (insertedVowel) {
    steps.push({ from: r, to: cvcv, rule: 'Insert vowel between consecutive consonants for CV flow' });
    r = cvcv;
  }

  const lastChar = r[r.length-1];
  if (ILLEGAL_FINAL.has(lastChar)) {
    r += 'u';
    steps.push({ from: r.slice(0,-1), to: r, rule: `Final '${lastChar}' is illegal — appended 'u'` });
  }

  return { root: r, steps };
}

function buildWordForms(root) {
  const stem = VALID_VOWELS.has(root[root.length-1]) ? root.slice(0,-1) : root;
  const noun = applyElision(stem, 'ombu');
  const verbDict = applyElision(stem, 'uvu');
  const adj = applyElision(stem, 'oku');
  const agent = root + 'vachi';
  const abstract = root + 'chimu';
  const dim = applyElision(root, 'ichu');
  const aug = applyElision(root, 'ongu');
  const present = root + 'lo';
  const past = root + 'me';
  const future = root + 'bo';
  const prog = root + 'shilo';
  return { root, stem, noun, verbDict, adj, agent, abstract, dim, aug, present, past, future, prog };
}

function applyElision(base, suffix) {
  const lastBase = base[base.length-1];
  const firstSuffix = suffix[0];
  if (VALID_VOWELS.has(lastBase) && lastBase === firstSuffix) {
    return base.slice(0,-1) + suffix;
  }
  return base + suffix;
}

// ── SOURCE LANGUAGE ROOT SUGGESTIONS ─────────────────────────
const LANG_DATA = [
  { code:'hi', name:'Hindi', flag:'🇮🇳', desc:'Indo-Aryan · familiar to Urdu speakers', getRoots: (c) => getLangSuggestion('hi', c) },
  { code:'ar', name:'Arabic', flag:'🇸🇦', desc:'Semitic · spoken across N. Africa & Middle East', getRoots: (c) => getLangSuggestion('ar', c) },
  { code:'zh', name:'Mandarin', flag:'🇨🇳', desc:'Sinitic · most spoken language on Earth', getRoots: (c) => getLangSuggestion('zh', c) },
  { code:'ja', name:'Japanese', flag:'🇯🇵', desc:'Japonic · uses many international loanwords', getRoots: (c) => getLangSuggestion('ja', c) },
  { code:'sw', name:'Swahili', flag:'🇰🇪', desc:'Bantu · lingua franca of East Africa', getRoots: (c) => getLangSuggestion('sw', c) },
  { code:'es', name:'Spanish', flag:'🇪🇸', desc:'Romance · 500M speakers across Americas & Europe', getRoots: (c) => getLangSuggestion('es', c) },
  { code:'ta', name:'Tamil', flag:'🇮🇳', desc:'Dravidian · one of the oldest classical languages', getRoots: (c) => getLangSuggestion('ta', c) },
  { code:'tr', name:'Turkish', flag:'🇹🇷', desc:'Turkic · agglutinative like Joylang', getRoots: (c) => getLangSuggestion('tr', c) },
  { code:'en', name:'English', flag:'🇬🇧', desc:'Germanic · global lingua franca', getRoots: (c) => getLangSuggestion('en', c) },
  { code:'yo', name:'Yoruba', flag:'🇳🇬', desc:'Niger-Congo · spoken by 50M+ in West Africa', getRoots: (c) => getLangSuggestion('yo', c) }
];

const SUGGESTION_TABLE = {
  'rain':    { hi:'varsha', ar:'matar',  zh:'yu',     ja:'ame',   sw:'mvua',   es:'luvia',  ta:'mazhai', tr:'yagmur', en:'reinu',  yo:'ojo' },
  'sun':     { hi:'surya',  ar:'shams',  zh:'taiyo',  ja:'hina',  sw:'jua',    es:'solo',   ta:'suriyan',tr:'gunes',  en:'sanu',   yo:'orun' },
  'fire':    { hi:'agni',   ar:'naru',   zh:'huo',    ja:'hi',    sw:'moto',   es:'fuego',  ta:'tee',    tr:'ates',   en:'fairu',  yo:'ina' },
  'water':   { hi:'jal',    ar:'maa',    zh:'shui',   ja:'mizu',  sw:'maji',   es:'agua',   ta:'tanni',  tr:'su',     en:'watu',   yo:'omi' },
  'tree':    { hi:'vriksha',ar:'shajara',zh:'shu',    ja:'ki',    sw:'mti',    es:'arbolu', ta:'maram',  tr:'agachu', en:'trimu',  yo:'igi' },
  'house':   { hi:'ghar',   ar:'beit',   zh:'fangzi', ja:'ie',    sw:'nyumba', es:'kasa',   ta:'veedu',  tr:'ev',     en:'hausu',  yo:'ile' },
  'road':    { hi:'rasta',  ar:'tariq',  zh:'lu',     ja:'michi', sw:'njia',   es:'kamino', ta:'vazhi',  tr:'yol',    en:'rodu',   yo:'ona' },
  'sky':     { hi:'aakash', ar:'sama',   zh:'tian',   ja:'sora',  sw:'anga',   es:'sielo',  ta:'vaanam', tr:'gok',    en:'skaiyu', yo:'orun' },
  'moon':    { hi:'chandra',ar:'qamar',  zh:'yueliang',ja:'tsuki',sw:'mwezi',  es:'luna',   ta:'nilaavu',tr:'ay',     en:'muunu',  yo:'osupa' },
  'star':    { hi:'tara',   ar:'najm',   zh:'xing',   ja:'hoshi', sw:'nyota',  es:'estrelu',ta:'naksha', tr:'yildiz', en:'staru',  yo:'irawole' },
  'mountain':{ hi:'pahar',  ar:'jabal',  zh:'shan',   ja:'yama',  sw:'mlima',  es:'monto',  ta:'malai',  tr:'dag',    en:'mountu', yo:'oke' },
  'river':   { hi:'nadi',   ar:'nahr',   zh:'he',     ja:'kawa',  sw:'mto',    es:'rio',    ta:'aaru',   tr:'nehir',  en:'riveru', yo:'odo' },
  'flower':  { hi:'phool',  ar:'zahra',  zh:'hua',    ja:'hana',  sw:'ua',     es:'floru',  ta:'poo',    tr:'chichek',en:'flawu',  yo:'ododo' },
  'bird':    { hi:'panchhi',ar:'tairu',  zh:'niao',   ja:'tori',  sw:'ndege',  es:'pajaru', ta:'paravai',tr:'kush',   en:'birdu',  yo:'eye' },
  'fish':    { hi:'machli', ar:'samak',  zh:'yu',     ja:'sakana',sw:'samaki', es:'pesu',   ta:'meen',   tr:'balik',  en:'fishu',  yo:'eja' },
  'cat':     { hi:'billi',  ar:'qittu',  zh:'mao',    ja:'neko',  sw:'paka',   es:'gatu',   ta:'poonai', tr:'kedi',   en:'katu',   yo:'ologbo' },
  'dog':     { hi:'kutta',  ar:'kalbu',  zh:'gou',    ja:'inu',   sw:'mbwa',   es:'peru',   ta:'naai',   tr:'kopek',  en:'dogu',   yo:'aja' },
  'run':     { hi:'doro',   ar:'rakada', zh:'pao',    ja:'hashiru',sw:'kimbia', es:'koru',  ta:'odu',    tr:'kosh',   en:'ranu',   yo:'sa' },
  'sing':    { hi:'gaana',  ar:'gana',   zh:'chang',  ja:'uta',   sw:'imba',   es:'kantaru',ta:'paadu',  tr:'sharkiyu',en:'singu', yo:'ko' },
  'dance':   { hi:'naach',  ar:'raqs',   zh:'wu',     ja:'odoru', sw:'cheza',  es:'bailu',  ta:'aadu',   tr:'dans',   en:'dansu',  yo:'jo' },
  'book':    { hi:'kitaab', ar:'kitab',  zh:'shu',    ja:'hon',   sw:'kitabu', es:'libru',  ta:'pustak', tr:'kitap',  en:'buku',   yo:'iwe' },
  'school':  { hi:'vidyalay',ar:'madrasa',zh:'xuexiao',ja:'gakko',sw:'shule',  es:'eskola', ta:'palliku',tr:'okul',   en:'skulu',  yo:'ile-iwe' },
  'work':    { hi:'kaam',   ar:'amal',   zh:'gongzuo',ja:'shigoto',sw:'kazi',  es:'trabahu',ta:'velai',  tr:'is',     en:'werku',  yo:'ise' },
  'happy':   { hi:'khush',  ar:'saeed',  zh:'kaixin', ja:'ureshii',sw:'furaha', es:'felisu', ta:'santosham',tr:'mutlu',en:'hapiyu',yo:'ayonu' },
  'love':    { hi:'prem',   ar:'hubu',   zh:'ai',     ja:'ai',    sw:'upendo', es:'amor',   ta:'anbu',   tr:'sevgi',  en:'luvu',   yo:'ife' },
  'friend':  { hi:'dost',   ar:'sadiq',  zh:'pengyou',ja:'tomodachi',sw:'rafiki',es:'amigo',ta:'natpu',  tr:'arkadas',en:'frend',  yo:'ore' },
  'food':    { hi:'khana',  ar:'akl',    zh:'shiwu',  ja:'tabemono',sw:'chakula',es:'komida',ta:'unavu',  tr:'yemek',  en:'fudu',   yo:'ounje' },
  'dream':   { hi:'sapna',  ar:'hulm',   zh:'meng',   ja:'yume',  sw:'ndoto',  es:'suenyo', ta:'kanavuu',tr:'ruya',   en:'drimu',  yo:'ala' },
  'cloud':   { hi:'badal',  ar:'sahab',  zh:'yun',    ja:'kumo',  sw:'wingu',  es:'nube',   ta:'megam',  tr:'bulut',  en:'klawdu', yo:'awosanma' },
  'color':   { hi:'rang',   ar:'laun',   zh:'yanse',  ja:'iro',   sw:'rangi',  es:'koloru', ta:'niram',  tr:'renk',   en:'koloru', yo:'awo' },
  'time':    { hi:'samay',  ar:'waqt',   zh:'shijian',ja:'jikan', sw:'wakati', es:'tiempu', ta:'neram',  tr:'zaman',  en:'taimu',  yo:'akoko' },
  'peace':   { hi:'shanti', ar:'salam',  zh:'heping', ja:'heiwa', sw:'amani',  es:'pasu',   ta:'shanti', tr:'baris',  en:'piisu',  yo:'aalafia' }
};

function getLangSuggestion(langCode, concept) {
  const key = concept.toLowerCase().trim();
  if (SUGGESTION_TABLE[key] && SUGGESTION_TABLE[key][langCode]) return SUGGESTION_TABLE[key][langCode];
  for (const [k, v] of Object.entries(SUGGESTION_TABLE)) {
    if (key.includes(k) || k.includes(key)) {
      if (v[langCode]) return v[langCode];
    }
  }
  return key.replace(/[^a-z]/g, '').substring(0, 5) || 'rota';
}

// ── TAB MANAGEMENT ─────────────────────────────────────────────
function openTab(tabName) {
  document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tool-tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('panel-' + tabName);
  if (panel) panel.classList.add('active');
  const tabs = document.querySelectorAll('.tool-tab');
  const tabIndex = ['generator','translator','creator','saved','setup'].indexOf(tabName);
  if (tabs[tabIndex]) tabs[tabIndex].classList.add('active');
  if (tabName === 'saved') loadSaved();
  if (tabName === 'setup') updateSetupStatus();
}

// ── WORD GENERATOR ─────────────────────────────────────────────
function setGenStep(n) {
  ['gen-step1','gen-step2','gen-step3','gen-step4'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (i === n-1) ? 'block' : 'none';
  });
  ['step1','step2','step3','step4'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'step' + (i < n-1 ? ' done' : i === n-1 ? ' active' : '');
  });
}

function searchWord() {
  const query = document.getElementById('genInput').value.trim();
  if (!query) return;
  currentConcept = query;

  const found = document.getElementById('gen-found');
  const notFound = document.getElementById('gen-notfound');
  const errEl = document.getElementById('gen-error');
  found.classList.remove('visible');
  notFound.classList.remove('visible');
  errEl.classList.remove('visible');

  const q = query.toLowerCase();
  const match = JOYLANG_DICT.find(e =>
    e.en.toLowerCase().includes(q) || q.includes(e.en.toLowerCase()) ||
    e.root.toLowerCase() === q || e.noun.toLowerCase() === q
  );

  const savedWords = getSavedWords();
  const savedMatch = savedWords.find(w =>
    w.en && (w.en.toLowerCase().includes(q) || q.includes(w.en.toLowerCase()))
  );

  const hit = match || savedMatch;
  if (hit) {
    document.getElementById('gen-found-root').textContent = hit.root;
    const forms = document.getElementById('gen-found-forms');
    forms.innerHTML = [
      hit.noun ? `<div class="result-form-card"><div class="form-label">Noun</div><div class="form-value">${hit.noun}</div></div>` : '',
      hit.verb && hit.verb !== '—' ? `<div class="result-form-card"><div class="form-label">Verb (dict.)</div><div class="form-value">${hit.verb}</div></div>` : '',
      hit.adj && hit.adj !== '—' ? `<div class="result-form-card"><div class="form-label">Adjective</div><div class="form-value">${hit.adj}</div></div>` : '',
    ].join('');
    const ex = hit.ex || hit.example || '';
    document.getElementById('gen-found-ex').textContent = ex;
    found.classList.add('visible');
  } else {
    document.getElementById('gen-notfound-query').textContent = query;
    notFound.classList.add('visible');
  }
}

function genReset() {
  currentConcept = ''; currentRawRoot = ''; currentJoyRoot = ''; currentLang = '';
  document.getElementById('genInput').value = '';
  document.getElementById('gen-found').classList.remove('visible');
  document.getElementById('gen-notfound').classList.remove('visible');
  document.getElementById('gen-error').classList.remove('visible');
  setGenStep(1);
}

function goToStep2() {
  setGenStep(2);
  document.getElementById('gen-concept-display').textContent = currentConcept;
  const grid = document.getElementById('langGrid');
  grid.innerHTML = LANG_DATA.map(lang => {
    const suggestion = lang.getRoots(currentConcept);
    return `
      <div class="lang-card" onclick="selectLang('${lang.code}','${lang.name}','${suggestion}')" id="lang-${lang.code}">
        <div class="lang-name">${lang.flag} ${lang.name}</div>
        <div class="lang-root">${suggestion}</div>
        <div class="lang-note">${lang.desc}</div>
      </div>`;
  }).join('');
  document.getElementById('root-editor').style.display = 'none';
}

function selectLang(code, name, suggestion) {
  currentLang = name;
  document.querySelectorAll('.lang-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById('lang-' + code);
  if (card) card.classList.add('selected');
  document.getElementById('chosen-lang-name').textContent = name;
  document.getElementById('rootInput').value = suggestion;
  document.getElementById('root-editor').style.display = 'block';
}

function goToStep3() {
  const rawRoot = document.getElementById('rootInput').value.trim();
  if (!rawRoot) { alert('Please enter a root word first.'); return; }
  currentRawRoot = rawRoot;
  setGenStep(3);

  const { root, steps } = applyJoylangPhonology(rawRoot);
  currentJoyRoot = root;
  document.getElementById('joyRootInput').value = root;

  const display = document.getElementById('phonology-display');
  display.innerHTML = `
    <div class="phonology-step"><strong style="color:#f9a825">Input root:</strong> ${rawRoot}</div>
    ${steps.map(s => `<div class="phonology-step">&nbsp;&nbsp;<span class="arrow">→</span> <span style="color:#81c784">${s.to}</span> <span style="color:#888;font-size:.85rem">(${s.rule})</span></div>`).join('')}
    <div class="phonology-step" style="margin-top:8px;"><strong style="color:#f9a825">Final Joylang root:</strong> <span class="joylang-output">${root}</span></div>
  `;
}

function goToStep4() {
  const finalRoot = document.getElementById('joyRootInput').value.trim().toLowerCase();
  if (!finalRoot) { alert('Please confirm the Joylang root.'); return; }
  currentJoyRoot = finalRoot;
  currentWordForms = buildWordForms(finalRoot);
  setGenStep(4);

  document.getElementById('gen-final-root').textContent = finalRoot;
  const forms = document.getElementById('gen-final-forms');
  const f = currentWordForms;
  forms.innerHTML = [
    `<div class="result-form-card"><div class="form-label">Noun</div><div class="form-value">${f.noun}</div></div>`,
    `<div class="result-form-card"><div class="form-label">Verb (dict.)</div><div class="form-value">${f.verbDict}</div></div>`,
    `<div class="result-form-card"><div class="form-label">Adjective</div><div class="form-value">${f.adj}</div></div>`,
    `<div class="result-form-card"><div class="form-label">Present</div><div class="form-value">${f.present}</div></div>`,
    `<div class="result-form-card"><div class="form-label">Past</div><div class="form-value">${f.past}</div></div>`,
    `<div class="result-form-card"><div class="form-label">Agent</div><div class="form-value">${f.agent}</div></div>`,
    `<div class="result-form-card"><div class="form-label">Diminutive</div><div class="form-value">${f.dim}</div></div>`,
    `<div class="result-form-card"><div class="form-label">Augmentative</div><div class="form-value">${f.aug}</div></div>`,
  ].join('');

  const collide = JOYLANG_DICT.find(e => e.root === finalRoot || e.noun === f.noun);
  const warnEl = document.getElementById('gen-collision-warn');
  warnEl.style.display = collide ? 'block' : 'none';
  if (collide) warnEl.textContent = `⚠ Collision: root "${finalRoot}" already exists (${collide.en}). Consider adjusting.`;
}

async function saveNewWord() {
  if (!currentWordForms) return;
  const domain = document.getElementById('save-domain').value.trim() || 'Community';
  const hindi = document.getElementById('save-hindi').value.trim();
  const example = document.getElementById('save-example').value.trim();
  const user = window.akashCurrentUser;
  const word = {
    root: currentJoyRoot,
    noun: currentWordForms.noun,
    verb: currentWordForms.verbDict,
    adj: currentWordForms.adj,
    en: currentConcept,
    hi: hindi,
    domain,
    ex: example,
    sourceLang: currentLang,
    createdBy: getCreatedByName(),
    creatorId: getOrCreateUserId(),
    creatorName: user ? (user.displayName || user.email) : null,
    createdAt: new Date().toISOString(),
    type: 'word'
  };
  const confirmEl = document.getElementById('save-confirm');
  try {
    await saveItem('words', word);
    confirmEl.textContent = '✓ Word saved to community database!';
    confirmEl.style.color = 'var(--green)';
    confirmEl.style.display = 'block';
  } catch(e) {
    confirmEl.textContent = '⚠ Saved locally (cloud sync failed: ' + e.message + ')';
    confirmEl.style.color = '#e65100';
    confirmEl.style.display = 'block';
  }
  setTimeout(() => { confirmEl.style.display = 'none'; }, 4000);
}

// ── SENTENCE TRANSLATOR ────────────────────────────────────────
function setTransMode(mode) {
  transMode = mode;
  document.getElementById('mode-ai').style.background = mode === 'ai' ? 'var(--green)' : 'var(--text-muted)';
  document.getElementById('mode-rule').style.background = mode === 'rule' ? 'var(--green)' : 'var(--text-muted)';
  document.getElementById('mode-desc').textContent = mode === 'ai'
    ? `AI mode uses Gemini to translate with full grammar understanding. Free tier: ${GEMINI_RPM_LIMIT} req/min, ${GEMINI_DAILY_LIMIT} req/day.`
    : 'Rule-based works offline using dictionary lookup + SOV word reordering. Limited but always available — no API key needed.';
  checkApiWarnings();
}

function clearTransResult() {
  document.getElementById('trans-output').classList.remove('visible');
  document.getElementById('trans-error').classList.remove('visible');
}

async function translateSentence() {
  const text = document.getElementById('translateInput').value.trim();
  if (!text) return;
  const btn = document.getElementById('translateBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Translating…';
  clearTransResult();

  try {
    let result;
    if (transMode === 'ai') {
      result = await aiTranslate(text, 'translate');
    } else {
      result = ruleBasedTranslate(text);
    }
    showTransResult(result);
  } catch(e) {
    showError('trans-error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Translate';
    updateRateLimitDisplay();
  }
}

function showTransResult(result) {
  document.getElementById('trans-joy').innerHTML = result.joylang || '';
  const hindiEl = document.getElementById('trans-hindi');
  if (result.hindi) {
    hindiEl.textContent = result.hindi;
    hindiEl.style.display = 'block';
  } else {
    hindiEl.style.display = 'none';
  }
  const breakdown = document.getElementById('trans-breakdown');
  if (result.breakdown && result.breakdown.length) {
    breakdown.style.display = 'block';
    breakdown.innerHTML = '<div style="font-size:.85rem;color:#888;margin-bottom:6px;">Word-by-word breakdown:</div>' +
      result.breakdown.map(b => `<div class="breakdown-row"><span class="joy-word">${b.joy}</span><span class="eng-word">${b.eng}</span></div>`).join('');
  } else {
    breakdown.style.display = 'none';
  }
  document.getElementById('trans-output').classList.add('visible');
}

// ── SENTENCE CREATOR ───────────────────────────────────────────
function setComplexity(level) {
  creatorComplexity = level;
  ['simple','medium','rich'].forEach(l => {
    document.getElementById('cx-' + l).style.background = l === level ? 'var(--green)' : 'var(--text-muted)';
  });
}

function clearCreatorResult() {
  document.getElementById('creator-output').classList.remove('visible');
  document.getElementById('creator-error').classList.remove('visible');
}

async function createSentence() {
  const text = document.getElementById('creatorInput').value.trim();
  if (!text) return;
  const btn = document.getElementById('creatorBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Creating…';
  clearCreatorResult();

  try {
    const result = await aiTranslate(text, 'create', creatorComplexity);
    document.getElementById('creator-joy').innerHTML = result.joylang || '';
    const creatorHindi = document.getElementById('creator-hindi');
    if (result.hindi) { creatorHindi.textContent = result.hindi; creatorHindi.style.display = 'block'; }
    else { creatorHindi.style.display = 'none'; }
    const breakdown = document.getElementById('creator-breakdown');
    if (result.breakdown && result.breakdown.length) {
      breakdown.style.display = 'block';
      breakdown.innerHTML = '<div style="font-size:.85rem;color:#888;margin-bottom:6px;">Word-by-word breakdown:</div>' +
        result.breakdown.map(b => `<div class="breakdown-row"><span class="joy-word">${b.joy}</span><span class="eng-word">${b.eng}</span></div>`).join('');
    }
    if (result.newWords && result.newWords.length) {
      document.getElementById('creator-new-words').style.display = 'block';
      document.getElementById('creator-new-words-list').innerHTML =
        result.newWords.map(w => `<span style="background:#333;color:#81c784;padding:2px 8px;border-radius:4px;margin:2px;display:inline-block;font-weight:700">${w}</span>`).join('');
    } else {
      document.getElementById('creator-new-words').style.display = 'none';
    }
    document.getElementById('creator-output').classList.add('visible');
  } catch(e) {
    showError('creator-error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Sentence';
    updateRateLimitDisplay();
  }
}

// ── AI API CALL ────────────────────────────────────────────────
const JOYLANG_SYSTEM_PROMPT = `You are a Joylang language expert. Joylang is a constructed auxiliary language with these core rules:

PHONOLOGY: 5 vowels (a e i o u) + 19 consonants (p b t d k g m n ng f s v h sh ch j l r y). Words must end in vowel or n/m/s/l/r only. Penultimate stress.

GRAMMAR:
- Word order: SOV (Subject Object Verb)
- Negation: ve- prefix on verb only (e.g., vekachilo = do not eat)
- Questions: ka at sentence start (e.g., Ka tenu kachilo? = Do you eat?)
- Present tense: root + -lo | Past: root + -me | Future: root + -bo
- Progressive aspect: root + -shi + tense (e.g., kachishilo = is eating)
- Perfect aspect: root + -vi + tense (e.g., kachivilo = has eaten)
- Noun class: stem + -ombu | Verb citation: stem + -uvu | Adjective: stem + -oku
- Cases: -sa(nom) -ko(acc) -ra(dat) -ni(gen) -me(loc) -ta(abl) -e(voc)
- Plural: noun + -chi | Adverb: root + -nu
- Pronouns: anu(I) tenu(you) venu(he/she/they) + -chi(plural) + -shi(reflexive)
- Postpositions: boshi(from) pela(for/please) nishi(near) tama(until) komi(with) sela(without)
- Conjunctions: chi(and) ova(or) teva(but) yenu(because) nashi...tashi(if...then)
- Evidentials (sentence-final, optional): diru(I saw it) shoru(I heard) niru(I infer) boru(I read)
- Demonstratives: eshi(this) oshi(that) + -chi(plural)
- Key question words: kenu(who) chenu(what) kanu(where) manu(when) yenu(why) henu(how) lokenu(which)
- Key copula: melo (be/exist) — never dropped

CORE VOCABULARY (some key roots): mavi(water) sato(friend) jovi(happy) kachi(eat) rona(love) shoju(laugh) nalu(sleep) nashi(learn) belo(come) velo(go) melo(be) doshi(see) shap(speak) jan(know) sam(understand) yoch(think) dil(give) sah(help) krup(thank) man(want) chah(need) ban(make) kar(do) paso(walk) rako(run) sun(hear) nov(smell) ras(taste) spar(feel) grik(home) nago(city) gram(village) vidya(school) karyu(office) pust(book) surya(sun) chan(moon) nadi(river) parvat(mountain) varsh(rain) gadi(car) mata(parent) kutum(family) dush(sad) uttej(excited) bhay(afraid) shanti(peace) priya(like) sundar(beautiful) shucha(clean) nav(new) puran(old) bolo(big) laghu(small) golo(good) dos(bad) tapi(hot) shiti(cold) abunu(now) ajunu(today) kalanu(tomorrow) bitianu(yesterday) sadanu(always) kadanu(never) bolonu(very) dhirenu(slowly)

When asked to TRANSLATE: convert English to Joylang faithfully following SOV order.
When asked to CREATE: generate an original, natural Joylang sentence expressing the given idea.

Always respond with valid JSON in this exact format:
{
  "joylang": "the complete Joylang sentence or sentences",
  "hindi": "the Hindi translation of the sentence (Devanagari script)",
  "breakdown": [{"joy": "joylang_word", "eng": "english meaning / role"}],
  "newWords": ["list any invented roots you had to create"],
  "notes": "brief explanation of any grammar choices"
}`;

async function aiTranslate(text, mode, complexity = 'simple') {
  checkRateLimit();

  const apiKey = localStorage.getItem('jl_api_key');
  if (!apiKey) throw new Error('No API key configured. Go to the Setup tab and enter your Gemini API key (free at aistudio.google.com).');

  const modeInstructions = {
    translate: `TRANSLATE this English sentence to Joylang: "${text}"`,
    create: `CREATE a Joylang sentence (${complexity} complexity level: ${
      complexity === 'simple' ? 'N5 level, use only basic grammar (present tense, simple SOV)' :
      complexity === 'medium' ? 'N4 level, use cases, tenses, aspects naturally' :
      'Advanced: use evidentials, conjunctions, derivational suffixes richly'
    }) that expresses this idea: "${text}"`
  };

  const instruction = modeInstructions[mode];
  const provider = localStorage.getItem('jl_api_provider') || 'gemini';
  return provider === 'anthropic' ? await callClaude(apiKey, instruction) : await callGemini(apiKey, instruction);
}

async function callClaude(apiKey, instruction) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: JOYLANG_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: instruction }]
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${response.status}`);
  }
  const data = await response.json();
  return parseAIResponse(data.content[0]?.text || '');
}

async function callGemini(apiKey, instruction) {
  const fullPrompt = JOYLANG_SYSTEM_PROMPT + '\n\n' + instruction;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
      })
    }
  );
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const errMsg = errData.error?.message || '';
    if (response.status === 429) {
      throw new Error(
        `Rate limit hit (HTTP 429). Gemini free tier: ${GEMINI_RPM_LIMIT} req/min, ${GEMINI_DAILY_LIMIT} req/day. ` +
        `Wait ${GEMINI_RESET_INTERVAL_SEC} seconds and try again.`
      );
    }
    if (response.status === 400 && errMsg.includes('API_KEY')) {
      throw new Error('Invalid Gemini API key. Keys should start with "AIzaSy…". Check aistudio.google.com > API Keys.');
    }
    throw new Error(errMsg || `Gemini API error ${response.status}. Check your API key.`);
  }
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseAIResponse(raw);
}

function parseAIResponse(raw) {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error('Unexpected response format from AI. Try again.');
  try {
    return JSON.parse(jsonMatch[1]);
  } catch(e) {
    throw new Error('Could not parse AI response. Try again.');
  }
}

// ── RULE-BASED TRANSLATOR (offline fallback) ───────────────────
function ruleBasedTranslate(text) {
  const words = text.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/);
  const breakdown = [];
  const translated = [];

  words.forEach(word => {
    const match = JOYLANG_DICT.find(e =>
      e.en.toLowerCase().split(/[\/\s]/).some(en => en.trim() === word)
    );
    if (match) {
      translated.push(match.root);
      breakdown.push({ joy: match.root + 'lo', eng: word + ' (root)' });
    } else if (['i','me','myself'].includes(word)) {
      translated.push('anu'); breakdown.push({ joy:'anu', eng:'I/me' });
    } else if (['you','your'].includes(word)) {
      translated.push('tenu'); breakdown.push({ joy:'tenu', eng:'you' });
    } else if (['he','she','they','it'].includes(word)) {
      translated.push('venu'); breakdown.push({ joy:'venu', eng:'he/she/they' });
    } else if (['we','us'].includes(word)) {
      translated.push('anuchi'); breakdown.push({ joy:'anuchi', eng:'we' });
    } else if (['is','am','are','be'].includes(word)) {
      translated.push('melo'); breakdown.push({ joy:'melo', eng:'be/is' });
    } else {
      breakdown.push({ joy: '(?)', eng: word + ' (not found)' });
    }
  });

  return {
    joylang: translated.join(' ') + '.',
    breakdown,
    notes: 'Rule-based translation — limited accuracy. Use AI mode for better results.'
  };
}

// ── SAVE SENTENCE ──────────────────────────────────────────────
async function saveSentence(source) {
  const joyEl = document.getElementById(source === 'translator' ? 'trans-joy' : 'creator-joy');
  const engEl = document.getElementById(source === 'translator' ? 'translateInput' : 'creatorInput');
  const hindiEl = document.getElementById(source === 'translator' ? 'trans-hindi' : 'creator-hindi');
  if (!joyEl || !engEl) return;
  const user = window.akashCurrentUser;
  const sentence = {
    joylang: joyEl.textContent,
    english: engEl.value.trim(),
    hindi: hindiEl ? hindiEl.textContent : '',
    source,
    createdBy: getCreatedByName(),
    creatorId: getOrCreateUserId(),
    creatorName: user ? (user.displayName || user.email) : null,
    createdAt: new Date().toISOString(),
    type: 'sentence'
  };
  const confirmId = source === 'translator' ? 'trans-save-confirm' : 'creator-save-confirm';
  const confirmEl = document.getElementById(confirmId);
  try {
    await saveItem('sentences', sentence);
    if (confirmEl) {
      confirmEl.textContent = '✓ Sentence saved to community database!';
      confirmEl.style.color = '#81c784';
      confirmEl.style.display = 'block';
      setTimeout(() => confirmEl.style.display='none', 4000);
    }
  } catch(e) {
    if (confirmEl) {
      confirmEl.textContent = '⚠ Saved locally (cloud sync failed)';
      confirmEl.style.color = '#f9a825';
      confirmEl.style.display = 'block';
      setTimeout(() => confirmEl.style.display='none', 4000);
    }
  }
}

// ── STORAGE (Firebase / localStorage) ─────────────────────────
function getSavedWords() {
  try { return JSON.parse(localStorage.getItem('jl_words') || '[]'); } catch { return []; }
}
function getSavedSentences() {
  try { return JSON.parse(localStorage.getItem('jl_sentences') || '[]'); } catch { return []; }
}

async function saveItem(collection, item) {
  const db = window.akashDB;
  if (db) {
    try {
      const { addDoc, collection: col } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await addDoc(col(db, collection), item);
      updateDbStatus(true);
      return;
    } catch(e) { console.warn('Firebase save failed, using localStorage:', e); }
  }
  // Fallback: localStorage
  const key = collection === 'words' ? 'jl_words' : 'jl_sentences';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  existing.push(item);
  localStorage.setItem(key, JSON.stringify(existing));
}

async function loadSaved() {
  const words = getSavedWords();
  const sentences = getSavedSentences();
  const db = window.akashDB;
  const uid = window.akashCurrentUser ? window.akashCurrentUser.uid : localStorage.getItem('jl_user_id');

  if (db && uid) {
    try {
      const { getDocs, collection: col, query, where } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const wSnap = await getDocs(query(col(db, 'words'), where('creatorId', '==', uid)));
      const sSnap = await getDocs(query(col(db, 'sentences'), where('creatorId', '==', uid)));
      wSnap.forEach(d => words.push(d.data()));
      sSnap.forEach(d => sentences.push(d.data()));
      updateDbStatus(true);
    } catch(e) { console.warn('Firebase load failed:', e); }
  }
  renderSaved(words, sentences);
}

function openSavedTab(tab) {
  document.getElementById('subpanel-mine').style.display = tab === 'mine' ? '' : 'none';
  document.getElementById('subpanel-community').style.display = tab === 'community' ? '' : 'none';
  document.getElementById('subtab-mine').classList.toggle('active', tab === 'mine');
  document.getElementById('subtab-community').classList.toggle('active', tab === 'community');
  if (tab === 'community') loadCommunity();
}

async function loadCommunity() {
  const wordsEl = document.getElementById('community-words-list');
  const sentEl = document.getElementById('community-sentences-list');
  if (wordsEl) wordsEl.innerHTML = '<p style="color:var(--text-muted);">Loading…</p>';
  if (sentEl) sentEl.innerHTML = '<p style="color:var(--text-muted);">Loading…</p>';

  const db = window.akashDB;
  if (!db) {
    if (wordsEl) wordsEl.innerHTML = '<p style="color:#c62828;">Not connected to Firebase. Community data requires an internet connection.</p>';
    return;
  }
  try {
    const { getDocs, collection: col, query, orderBy, limit } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const [wSnap, sSnap] = await Promise.all([
      getDocs(query(col(db, 'words'), orderBy('createdAt', 'desc'), limit(200))),
      getDocs(query(col(db, 'sentences'), orderBy('createdAt', 'desc'), limit(100)))
    ]);
    const words = [], sentences = [];
    wSnap.forEach(d => words.push(d.data()));
    sSnap.forEach(d => sentences.push(d.data()));
    renderCommunity(words, sentences);
  } catch(e) {
    if (wordsEl) wordsEl.innerHTML = `<p style="color:#c62828;">Failed to load: ${e.message}</p>`;
  }
}

function renderCommunity(words, sentences) {
  const wCountEl = document.getElementById('community-word-count');
  const sCountEl = document.getElementById('community-sentence-count');
  if (wCountEl) wCountEl.textContent = words.length;
  if (sCountEl) sCountEl.textContent = sentences.length;

  const wordsList = document.getElementById('community-words-list');
  if (wordsList) {
    if (words.length) {
      wordsList.innerHTML = words.map(w => {
        const badge = w.createdBy === 'developer'
          ? '<span class="creator-badge creator-dev">Dev</span>'
          : '<span class="creator-badge creator-user">Community</span>';
        const creator = w.creatorName ? ` · <span style="color:#aaa;">${w.creatorName}</span>` : '';
        return `<div class="saved-word-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div class="swc-joy">${w.root} · ${w.noun || ''}</div>
            ${badge}
          </div>
          <div class="swc-en">${w.en || ''}${w.hi ? ' · <span style="color:#e65100;">' + w.hi + '</span>' : ''}</div>
          <div class="swc-meta">${w.domain || ''}${w.sourceLang ? ' · ' + w.sourceLang : ''}${creator}</div>
        </div>`;
      }).join('');
    } else {
      wordsList.innerHTML = '<p style="color:var(--text-muted);">No community words yet — seed the dictionary first, or create a word using the Word Generator.</p>';
    }
  }

  const sentList = document.getElementById('community-sentences-list');
  if (sentList) {
    if (sentences.length) {
      sentList.innerHTML = sentences.map(s => {
        const badge = s.createdBy === 'developer'
          ? '<span class="creator-badge creator-dev">Dev</span>'
          : '<span class="creator-badge creator-user">Community</span>';
        const creator = s.creatorName ? `by ${s.creatorName} · ` : '';
        return `<div style="background:var(--white);border:1px solid var(--border);border-radius:8px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
            <div style="font-weight:700;color:var(--green-dark);font-size:1.05rem;">${s.joylang}</div>
            ${badge}
          </div>
          <div style="color:var(--text-muted);font-size:.9rem;">${s.english || ''}</div>
          ${s.hindi ? `<div style="color:#e65100;font-size:.88rem;margin-top:3px;">${s.hindi}</div>` : ''}
          <div style="font-size:.75rem;color:#aaa;margin-top:4px;">${creator}${new Date(s.createdAt||Date.now()).toLocaleDateString()}</div>
        </div>`;
      }).join('');
    } else {
      sentList.innerHTML = '<p style="color:var(--text-muted);">No community sentences yet. Use the Translator or Creator to add some.</p>';
    }
  }
}

function renderSaved(words, sentences) {
  document.getElementById('word-count').textContent = words.length;
  document.getElementById('sentence-count').textContent = sentences.length;

  const wordsList = document.getElementById('saved-words-list');
  if (words.length) {
    wordsList.innerHTML = words.map(w => {
      const badge = w.createdBy === 'developer'
        ? '<span class="creator-badge creator-dev">Dev</span>'
        : '<span class="creator-badge creator-user">Community</span>';
      return `<div class="saved-word-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div class="swc-joy">${w.root} · ${w.noun || ''}</div>
          ${badge}
        </div>
        <div class="swc-en">${w.en || ''}${w.hi ? ' · <span style="color:#e65100;">' + w.hi + '</span>' : ''}</div>
        <div class="swc-meta">${w.domain || ''} · ${w.sourceLang || ''}</div>
      </div>`;
    }).join('');
  } else {
    wordsList.innerHTML = '<p style="color:var(--text-muted);">No words saved yet. Use the Word Generator to create words.</p>';
  }

  const sentList = document.getElementById('saved-sentences-list');
  if (sentences.length) {
    sentList.innerHTML = sentences.map(s => {
      const badge = s.createdBy === 'developer'
        ? '<span class="creator-badge creator-dev">Dev</span>'
        : '<span class="creator-badge creator-user">Community</span>';
      return `<div style="background:var(--white);border:1px solid var(--border);border-radius:8px;padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div style="font-weight:700;color:var(--green-dark);font-size:1.05rem;">${s.joylang}</div>
          ${badge}
        </div>
        <div style="color:var(--text-muted);font-size:.9rem;">${s.english || ''}</div>
        ${s.hindi ? `<div style="color:#e65100;font-size:.88rem;margin-top:3px;">${s.hindi}</div>` : ''}
        <div style="font-size:.75rem;color:#aaa;margin-top:4px;">${s.source || ''} · ${new Date(s.createdAt||Date.now()).toLocaleDateString()}</div>
      </div>`;
    }).join('');
  } else {
    sentList.innerHTML = '<p style="color:var(--text-muted);">No sentences saved yet. Use the Translator or Creator tools.</p>';
  }
}

function exportData() {
  const data = {
    words: getSavedWords(),
    sentences: getSavedSentences(),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'joylang-data.json';
  a.click();
}

// ── SEED DATABASE ──────────────────────────────────────────────
async function seedDatabase() {
  const btn = document.getElementById('seed-btn');
  const statusEl = document.getElementById('seed-status');
  const db = window.akashDB;
  if (!db) {
    if (statusEl) { statusEl.textContent = '✗ Firebase not connected. Cannot seed.'; statusEl.style.color = '#c62828'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Seeding…'; }
  if (statusEl) { statusEl.textContent = 'Checking existing entries…'; statusEl.style.color = 'var(--text-muted)'; }

  try {
    const { addDoc, getDocs, collection: col } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    // ── Seed words ──────────────────────────────────────────────
    const wordSnap = await getDocs(col(db, 'words'));
    const existingRoots = new Set();
    wordSnap.forEach(d => existingRoots.add(d.data().root));
    const wordsToAdd = JOYLANG_DICT.filter(w => !existingRoots.has(w.root));

    let wordCount = 0;
    for (const word of wordsToAdd) {
      await addDoc(col(db, 'words'), {
        ...word,
        createdBy: 'developer',
        creatorId: 'developer',
        createdAt: new Date().toISOString()
      });
      wordCount++;
      if (statusEl && wordCount % 10 === 0) {
        statusEl.textContent = `Seeding words… ${wordCount}/${wordsToAdd.length}`;
      }
    }

    // ── Seed sentences ──────────────────────────────────────────
    const sentSnap = await getDocs(col(db, 'sentences'));
    const existingJoy = new Set();
    sentSnap.forEach(d => existingJoy.add(d.data().joylang));
    const sentsToAdd = JOYLANG_SENTENCES.filter(s => !existingJoy.has(s.joylang));

    if (statusEl) statusEl.textContent = `Words done. Seeding sentences…`;
    let sentCount = 0;
    for (const sent of sentsToAdd) {
      await addDoc(col(db, 'sentences'), {
        ...sent,
        createdBy: 'developer',
        creatorId: 'developer',
        createdAt: new Date().toISOString()
      });
      sentCount++;
      if (statusEl && sentCount % 20 === 0) {
        statusEl.textContent = `Seeding sentences… ${sentCount}/${sentsToAdd.length}`;
      }
    }

    if (statusEl) {
      statusEl.textContent =
        `✓ Seeded ${wordCount} words (${existingRoots.size} already existed) · ` +
        `${sentCount} sentences (${existingJoy.size} already existed).`;
      statusEl.style.color = 'var(--green)';
    }
  } catch(e) {
    if (statusEl) { statusEl.textContent = `✗ Seed failed: ${e.message}`; statusEl.style.color = '#c62828'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Seed Dictionary to DB'; }
  }
}

// ── SETUP / CONFIG ─────────────────────────────────────────────
function switchProvider(provider) {
  localStorage.setItem('jl_api_provider', provider);
  apiProvider = provider;
  const hints = {
    gemini: `Google Gemini selected. Free tier: ${GEMINI_RPM_LIMIT} req/min · ${GEMINI_DAILY_LIMIT} req/day · Resets every ${GEMINI_RESET_INTERVAL_SEC}s. Get a free key at aistudio.google.com → API Keys.`,
    anthropic: 'Anthropic Claude selected. Requires a paid API key from console.anthropic.com.'
  };
  const hintEl = document.getElementById('provider-hint');
  if (hintEl) hintEl.textContent = hints[provider] || '';
  const gBox = document.getElementById('provider-gemini-box');
  const aBox = document.getElementById('provider-anthropic-box');
  if (gBox) gBox.style.borderColor = provider === 'gemini' ? 'var(--green)' : 'var(--border)';
  if (aBox) aBox.style.borderColor = provider === 'anthropic' ? 'var(--green)' : 'var(--border)';
  updateSetupStatus();
  checkApiWarnings();
}

function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) { document.getElementById('api-key-status').textContent = 'Please enter a key first.'; return; }
  localStorage.setItem('jl_api_key', key);
  document.getElementById('api-key-status').innerHTML = '<span style="color:var(--green)">✓ API key saved securely in your browser.</span>';
  document.getElementById('apiKeyInput').value = '';
  checkApiWarnings();
  updateSetupStatus();
}

function clearApiKey() {
  localStorage.removeItem('jl_api_key');
  document.getElementById('api-key-status').innerHTML = '<span style="color:#c62828">Custom API key cleared. Default pre-configured key will be used.</span>';
  checkApiWarnings();
  updateSetupStatus();
}

function updateDbStatus(isCloud) {
  const badges = document.querySelectorAll('.db-status');
  badges.forEach(b => {
    b.className = 'db-status ' + (isCloud ? 'cloud' : 'local');
    b.textContent = isCloud ? 'Firebase Cloud' : 'Local Storage';
  });
}

function checkApiWarnings() {
  const hasKey = !!localStorage.getItem('jl_api_key');
  ['translator','creator'].forEach(t => {
    const warn = document.getElementById(t + '-api-warn');
    if (warn) warn.style.display = (transMode === 'rule' && t === 'translator') ? 'none' : (hasKey ? 'none' : 'block');
  });
}

function updateSetupStatus() {
  const panel = document.getElementById('setup-status-panel');
  if (!panel) return;
  const hasKey = !!localStorage.getItem('jl_api_key');
  const provider = localStorage.getItem('jl_api_provider') || 'gemini';
  const providerLabel = provider === 'gemini' ? 'Google Gemini (free)' : 'Anthropic Claude (paid)';
  const dbConnected = !!window.akashDB;
  const userId = getOrCreateUserId();

  panel.innerHTML = [
    `<div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.2rem">${hasKey ? '✅' : '⚠️'}</span>
      <div><strong>AI Provider: ${providerLabel}</strong><br>
      <span style="color:var(--text-muted);font-size:.9rem;">
        ${hasKey ? 'API key saved — AI tools active' : 'No API key yet — enter key in Setup to activate AI tools'} ·
        Free tier: ${GEMINI_RPM_LIMIT} req/min · ${GEMINI_DAILY_LIMIT} req/day · Resets every ${GEMINI_RESET_INTERVAL_SEC}s
      </span></div>
    </div>`,
    `<div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.2rem">${dbConnected ? '✅' : '⚠️'}</span>
      <div><strong>Firebase Database</strong><br>
      <span style="color:var(--text-muted);font-size:.9rem;">${dbConnected ? '✓ Pre-configured &amp; connected — words and sentences sync to cloud' : 'Connecting… (auto-configured)'}</span></div>
    </div>`,
    `<div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:1.2rem">✅</span>
      <div><strong>Dictionary</strong><br>
      <span style="color:var(--text-muted);font-size:.9rem;">${JOYLANG_DICT.length} words loaded from static dictionary</span></div>
    </div>`,
    (() => {
      const user = window.akashCurrentUser;
      if (user) {
        return `<div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.2rem">👤</span>
          <div><strong>Signed in as ${user.displayName || user.email}</strong><br>
          <span style="color:var(--text-muted);font-size:.9rem;">Your words are tagged with your account UID: <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">${user.uid.substring(0,16)}…</code></span></div>
        </div>`;
      }
      return `<div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.2rem">🪪</span>
        <div><strong>Anonymous Session</strong><br>
        <span style="color:var(--text-muted);font-size:.9rem;">Tagged with: <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;">${userId}</code> · Sign in with Google to link to your account.</span></div>
      </div>`;
    })()
  ].join('');
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
}

// ── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Ensure Gemini is the default provider and pre-configured key is ready
  if (!localStorage.getItem('jl_api_provider')) {
    localStorage.setItem('jl_api_provider', 'gemini');
  }

  const savedProvider = localStorage.getItem('jl_api_provider') || 'gemini';
  const providerRadio = document.getElementById('provider-' + savedProvider);
  if (providerRadio) providerRadio.checked = true;
  switchProvider(savedProvider);

  const keyStatus = document.getElementById('api-key-status');
  if (keyStatus) {
    if (localStorage.getItem('jl_api_key')) {
      keyStatus.innerHTML = '<span style="color:var(--green)">✓ Gemini API key saved — AI tools ready.</span>';
    } else {
      keyStatus.innerHTML = '<span style="color:#e65100;">⚠ No API key yet. Enter your Gemini key below to activate AI tools. Key is free at <strong>aistudio.google.com</strong>.</span>';
    }
  }

  // Wait for Firebase to be ready
  function onDbReady() {
    updateDbStatus(!!window.akashDB);
    updateSetupStatus();
  }
  if (window.akashDB !== undefined) {
    onDbReady();
  } else {
    window.addEventListener('akash-db-ready', onDbReady, { once: true });
  }

  // Default translator to rule-based (works without API key)
  setTransMode('rule');

  checkApiWarnings();
  setComplexity('simple');
  updateRateLimitDisplay();

  // Auth state — fires immediately from firebase-db.js if already resolved
  function handleAuthChange(e) {
    const { user, isDeveloper } = e.detail || {};
    onAuthChange(user, isDeveloper);
  }
  window.addEventListener('akash-auth-change', handleAuthChange);
  // Also apply current state in case event already fired
  if (window.akashCurrentUser !== undefined) {
    onAuthChange(window.akashCurrentUser, window.akashIsDeveloper || false);
  }

  // Refresh rate limit display every 5 seconds
  setInterval(updateRateLimitDisplay, 5000);

  const topSearch = document.getElementById('topSearchInput');
  if (topSearch) {
    topSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter' && topSearch.value.trim()) {
        window.location.href = 'dictionary.html#search=' + encodeURIComponent(topSearch.value.trim());
      }
    });
  }
});
