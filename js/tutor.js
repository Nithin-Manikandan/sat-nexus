/* ============================================================
   SAT NEXUS — AI Tutor (client)
   Talks to /api/tutor, which fails over across whichever providers have keys configured.
   Math questions are images, so the question + choices are composited into one picture and sent
   alongside the official rationale image.
   ============================================================ */
const Tutor = (() => {
  const CACHE_KEY = 'sat_nexus_tutor_cache_v1', COUNT_KEY = 'sat_nexus_tutor_count', DAILY_CAP = 80;
  const ctx = { qid: null, level: 0, history: [], busy: false, last: null, variantAnswer: null };
  let hints = {};                       // question id -> hints used this session (for the attempt log)
  let configured = null;                // null = unknown

  const $ = id => document.getElementById(id);
  const imgCache = new Map();

  /* ── small helpers ─────────────────────────────────────────── */
  const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; } };
  const writeCache = (k, v) => {
    try {
      const c = readCache(); c[k] = v;
      const keys = Object.keys(c); if (keys.length > 150) keys.slice(0, keys.length - 150).forEach(x => delete c[x]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch {}
  };
  function underDailyCap() {
    const day = new Date().toISOString().slice(0, 10);
    try {
      const c = JSON.parse(localStorage.getItem(COUNT_KEY) || '{}');
      if (c.day !== day) { c.day = day; c.n = 0; }
      if (c.n >= DAILY_CAP) return false;
      c.n++; localStorage.setItem(COUNT_KEY, JSON.stringify(c));
    } catch {}
    return true;
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // tiny markdown: **bold**, lists, paragraphs. Math ($…$) is left for KaTeX.
  function md(text) {
    const lines = esc(text).split('\n');
    const out = []; let list = null;
    const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.t}>`); list = null; } };
    const inline = s => s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    for (const raw of lines) {
      const ul = /^\s*[-•*]\s+(.*)/.exec(raw), ol = /^\s*\d+[.)]\s+(.*)/.exec(raw);
      if (ul || ol) {
        const t = ul ? 'ul' : 'ol';
        if (!list || list.t !== t) { flush(); list = { t, items: [] }; }
        list.items.push(inline((ul || ol)[1]));
      } else if (!raw.trim()) { flush(); }
      else { flush(); out.push(`<p>${inline(raw)}</p>`); }
    }
    flush();
    return out.join('');
  }
  function typeset(el) {
    try {
      if (window.renderMathInElement) window.renderMathInElement(el, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true },
                     { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }],
        throwOnError: false
      });
    } catch {}
  }

  /* ── images for math questions ─────────────────────────────── */
  function loadImg(file) {
    if (!imgCache.has(file)) imgCache.set(file, new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = MATH_IMG_DIR + file;
    }));
    return imgCache.get(file);
  }
  const blobToB64 = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); });

  // question + labelled choices stacked on a white canvas → one JPEG
  async function questionComposite(q) {
    const stem = await loadImg(q.img[0]);
    let parts = [{ im: stem }];
    if (q.choicesImg) parts.push({ im: await loadImg(q.choicesImg[0]) });
    else if (q.choiceImgs) for (let i = 0; i < q.choiceImgs.length; i++) parts.push({ im: await loadImg(q.choiceImgs[i][0]), label: 'ABCD'[i] + ')' });
    const pad = 14, labelW = 44;
    const W = Math.max(...parts.map(p => p.im.width + (p.label ? labelW : 0))) + pad * 2;
    const H = parts.reduce((a, p) => a + p.im.height + pad, pad);
    const scale = Math.min(1, 1100 / W);
    const cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    const g = cv.getContext('2d'); g.scale(scale, scale);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.font = 'bold 30px sans-serif'; g.textBaseline = 'middle';
    let y = pad;
    for (const p of parts) {
      if (p.label) g.fillText(p.label, pad, y + p.im.height / 2);
      g.drawImage(p.im, pad + (p.label ? labelW : 0), y);
      y += p.im.height + pad;
    }
    return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  async function rationaleB64(q) {
    const r = await fetch(MATH_IMG_DIR + q.rationaleImg[0]);
    return blobToB64(await r.blob());
  }

  async function payload(q, mode, extra) {
    const body = {
      mode, level: ctx.level, given: extra.given || '', message: extra.message || '', history: extra.history || [],
      profile: Progress.profileSummary(),
      question: {
        section: q.section, topic: q.topic, skill: q.subtopic, difficulty: q.difficulty, kind: q.kind || 'mc',
        answer: q.selfGraded ? '' : Array.isArray(q.answer) ? q.answer.join(' or ') : q.answer
      }
    };
    if (q.img) {
      body.question.hasImage = true;
      body.images = [{ mime: 'image/jpeg', data: await questionComposite(q) }];
      if (q.rationaleImg) body.images.push({ mime: 'image/png', data: await rationaleB64(q) });
    } else {
      Object.assign(body.question, { passage: q.passage, text: q.text, choices: q.choices, rationale: q.explanation });
    }
    return body;
  }

  /* ── networking ────────────────────────────────────────────── */
  async function request(body) {
    const res = await fetch('/api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j;
    const e = new Error(j.error || 'failed'); e.code = j.error; e.status = res.status; throw e;
  }
  async function checkConfigured() {
    if (configured !== null) return configured;
    try { const j = await (await fetch('/api/tutor')).json(); configured = (j.providers || []).length > 0; }
    catch { configured = null; }
    return configured;
  }

  /* ── UI ────────────────────────────────────────────────────── */
  function setOut(html, cls = '') { const o = $('tutorOut'); if (o) { o.className = 'tutor-out ' + cls; o.innerHTML = html; typeset(o); } }
  function appendOut(html, cls = '') {
    const o = $('tutorOut'); if (!o) return;
    const d = document.createElement('div'); d.className = 'tutor-msg ' + cls; d.innerHTML = html; o.appendChild(d); typeset(d);
    d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const thinking = () => `<div class="tutor-thinking"><span></span><span></span><span></span></div>`;

  function actionsFor(q, given, revealed, correct) {
    if (!revealed) {
      const n = ctx.level;
      const label = n === 0 ? '💡 Give me a hint' : n === 1 ? '💡 Next hint' : n === 2 ? '🔓 Show full solution' : null;
      return label ? `<button class="btn btn-ghost btn-sm" onclick="Tutor.hint()">${label} <span class="tutor-pip">${Math.min(n + 1, 3)}/3</span></button>` : '';
    }
    return [
      correct ? '' : `<button class="btn btn-primary btn-sm" onclick="Tutor.run('why')">🧠 Why did I miss this?</button>`,
      `<button class="btn btn-ghost btn-sm" onclick="Tutor.run('explain')">🔁 Explain another way</button>`,
      `<button class="btn btn-ghost btn-sm" onclick="Tutor.run('variant')">🎲 Similar problem</button>`
    ].join('');
  }

  // called by renderQuestion() every time the question (or its answered state) changes
  function mount(q, given, revealed, correct) {
    const panel = $('tutorPanel'); if (!panel) return;
    if (ctx.qid !== q.id) { Object.assign(ctx, { qid: q.id, level: hints[q.id] || 0, history: [], last: null, variantAnswer: null }); setOut(''); $('tutorChat')?.classList.add('hidden'); }
    ctx.q = q; ctx.given = given; ctx.revealed = revealed; ctx.correct = correct;
    $('tutorActions').innerHTML = actionsFor(q, given, revealed, correct);
  }

  async function call(mode, { message = '', cacheable = true } = {}) {
    const q = ctx.q; if (!q || ctx.busy) return;
    const given = ctx.given || '';
    const cacheKey = `${mode}:${ctx.level}:${q.id}:${given}`;
    const hit = cacheable && !message ? readCache()[cacheKey] : null;
    if (hit) { show(mode, hit, message); return; }
    if (!underDailyCap()) { setOut(`<div class="tutor-note">You've hit today's tutor limit (${DAILY_CAP} requests). It resets tomorrow.</div>`); return; }

    ctx.busy = true;
    if (message) appendOut(`<p>${esc(message)}</p>`, 'user'); else setOut('');
    const wait = document.createElement('div'); wait.innerHTML = thinking(); $('tutorOut').appendChild(wait);
    try {
      const body = await payload(q, mode, { given, message, history: ctx.history });
      const r = await request(body);
      wait.remove();
      if (cacheable && !message) writeCache(cacheKey, r.text);
      show(mode, r.text, message);
    } catch (e) {
      wait.remove();
      if (e.code === 'not_configured') { configured = false; setOut(notConfigured()); }
      else setOut(`<div class="tutor-note">${e.code === 'busy' ? 'Every AI provider is busy right now — try again in a minute.' : 'Couldn’t reach the tutor. Check your connection and try again.'}</div>`);
    } finally { ctx.busy = false; }
  }

  function show(mode, text, message) {
    let main = text, answerPart = null;
    if (mode === 'variant' && text.includes('===ANSWER===')) [main, answerPart] = text.split('===ANSWER===');
    ctx.variantAnswer = answerPart;
    const html = `<div class="tutor-msg ai">${md(main)}${answerPart ? `<button class="btn btn-ghost btn-sm" id="tutorReveal" onclick="Tutor.reveal()">Reveal answer</button><div id="tutorAnswer" class="hidden">${md(answerPart)}</div>` : ''}</div>`;
    if (message) appendOut(md(main), 'ai'); else setOut(html);
    ctx.history.push(...(message ? [{ role: 'user', text: message }] : []), { role: 'assistant', text });
    ctx.history = ctx.history.slice(-8);
    const chat = $('tutorChat'); if (chat) chat.classList.remove('hidden');
    typeset($('tutorOut'));
  }

  const notConfigured = () => `<div class="tutor-note"><strong>The tutor isn't switched on yet.</strong><br>
    Add at least one API key in Vercel (Project → Settings → Environment Variables): <code>GROQ_API_KEY</code>, <code>GEMINI_API_KEY</code>, <code>OPENROUTER_API_KEY</code> or <code>ANTHROPIC_API_KEY</code>, then redeploy. Everything else in the app works without it.</div>`;

  function hint() {
    const q = ctx.q; if (!q || ctx.busy || ctx.level >= 3) return;
    ctx.level++;
    hints[q.id] = ctx.level;
    $('tutorActions').innerHTML = actionsFor(q, ctx.given, ctx.revealed, ctx.correct);
    call('hint');
  }
  function run(mode) { call(mode, { cacheable: mode !== 'variant' }); }
  function reveal() { $('tutorAnswer')?.classList.remove('hidden'); $('tutorReveal')?.remove(); typeset($('tutorAnswer')); }
  function send(ev) {
    ev.preventDefault();
    const input = $('tutorInput'); const m = input.value.trim(); if (!m) return;
    input.value = ''; call('chat', { message: m, cacheable: false });
  }

  return { mount, hint, run, reveal, send, hintsUsed: id => hints[id] || 0, checkConfigured };
})();
