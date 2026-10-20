/* ============================================================
   SAT NEXUS — Progress engine
   Attempt log (saved locally + synced to Supabase when signed in), ability / score model,
   "Error DNA" miss classifier, and the points-per-hour study planner.
   Pure logic only: no DOM, so it can be tested in Node.
   ============================================================ */
const Progress = (() => {
  const KEY = 'sat_nexus_attempts_v1';
  const MAX_ATTEMPTS = 25000;       // local cap
  const MAX_SYNCED = 6000;          // most recent attempts pushed to the cloud
  const SYNC_FLAG = 'sat_nexus_sync_disabled';

  /* ── model constants ───────────────────────────────────────── */
  // Rasch (1-parameter logistic) item difficulty offsets, in logits, by labelled difficulty.
  const DIFF_B = { easy: -1.0, medium: 0.1, hard: 1.2 };
  // Section score = 520 + 110·θ (θ = 0 is an average student; ~1 logit ≈ 1 SD ≈ 110 pts), clipped to 200–800.
  const SCORE_MID = 520, SCORE_PER_LOGIT = 110;
  const toScore = th => Math.max(200, Math.min(800, Math.round((SCORE_MID + SCORE_PER_LOGIT * th) / 10) * 10));
  // Share of each section's questions by official test domain.
  const DOMAIN_W = {
    'Craft & Structure': .28, 'Information & Ideas': .26, 'Standard English Conventions': .26, 'Expression of Ideas': .20,
    'Algebra': .35, 'Advanced Math': .35, 'Problem Solving & Data Analysis': .15, 'Geometry & Trigonometry': .15
  };
  // Typical seconds per question by section/difficulty (used until you have your own timing data).
  const DEFAULT_SEC = { reading_writing: { easy: 45, medium: 60, hard: 80 }, math: { easy: 55, medium: 85, hard: 115 } };
  const MIN_FOR_SCORE = 15;         // attempts in a section before we show a score for it

  let attempts = [];
  let qIndex = null, skillList = null;
  let shown = { key: null, at: 0 };
  let syncTimer = null;

  /* ── question index ────────────────────────────────────────── */
  function index() {
    if (qIndex) return qIndex;
    qIndex = new Map();
    const seen = new Map();
    for (const q of SAT_QUESTIONS) {
      qIndex.set(q.id, q);
      const k = q.section + '|' + q.subtopic;
      if (!seen.has(k)) seen.set(k, { skill: q.subtopic, section: q.section, topic: q.topic, n: 0 });
      seen.get(k).n++;
    }
    skillList = [...seen.values()];
    // each skill's weight inside its section: domain share split evenly across that domain's skills
    const perDomain = {};
    skillList.forEach(s => { perDomain[s.topic] = (perDomain[s.topic] || 0) + 1; });
    skillList.forEach(s => { s.w = (DOMAIN_W[s.topic] || .25) / perDomain[s.topic]; });
    ['reading_writing', 'math'].forEach(sec => {
      const tot = skillList.filter(s => s.section === sec).reduce((a, s) => a + s.w, 0) || 1;
      skillList.filter(s => s.section === sec).forEach(s => { s.w /= tot; });
    });
    return qIndex;
  }
  const skills = () => { index(); return skillList; };
  const questionById = id => index().get(id);

  /* ── storage ───────────────────────────────────────────────── */
  // attempt: { q: questionId, t: epoch ms, c: 1|0, a: given answer, ms: time spent, m: 'practice'|'test', h: hints used }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      attempts = Array.isArray(raw) ? raw.filter(a => a && a.q && a.t) : [];
    } catch { attempts = []; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(attempts)); }
    catch { attempts = attempts.slice(-MAX_ATTEMPTS / 2); try { localStorage.setItem(KEY, JSON.stringify(attempts)); } catch {} }
    scheduleSync();
  }

  function markShown(key) {            // call whenever a question is put on screen
    if (shown.key !== key) shown = { key, at: Date.now() };
  }
  const elapsed = () => Math.min(Date.now() - shown.at, 5 * 60 * 1000);

  function record({ q, given, correct, mode = 'practice', hints = 0, ms }) {
    attempts.push({
      q: q.id, t: Date.now(), c: correct ? 1 : 0, a: String(given ?? '').slice(0, 24),
      ms: ms ?? elapsed(), m: mode, ...(hints ? { h: hints } : {})
    });
    if (attempts.length > MAX_ATTEMPTS) attempts = attempts.slice(-MAX_ATTEMPTS);
    persist();
  }

  /* ── cloud sync (Supabase profiles.attempts jsonb; best effort) ─ */
  const pack = a => [a.q, a.t, a.c, a.ms, a.m === 'test' ? 1 : 0, a.a, a.h || 0];
  const unpack = r => ({ q: r[0], t: r[1], c: r[2], ms: r[3], m: r[4] ? 'test' : 'practice', a: r[5], ...(r[6] ? { h: r[6] } : {}) });

  function merge(remote) {
    const have = new Set(attempts.map(a => a.q + '@' + a.t));
    let added = 0;
    for (const a of remote) if (!have.has(a.q + '@' + a.t)) { attempts.push(a); added++; }
    if (added) { attempts.sort((x, y) => x.t - y.t); if (attempts.length > MAX_ATTEMPTS) attempts = attempts.slice(-MAX_ATTEMPTS); }
    return added;
  }

  async function session() {
    try { return (await sb.auth.getSession()).data.session; } catch { return null; }
  }
  function syncDisabled() { try { return localStorage.getItem(SYNC_FLAG) === '1'; } catch { return false; } }

  async function pull() {
    if (syncDisabled()) return 0;
    const s = await session(); if (!s) return 0;
    try {
      const { data, error } = await sb.from('profiles').select('attempts').eq('id', s.user.id).single();
      if (error) throw error;
      const added = merge((data?.attempts || []).map(unpack));
      if (added) { try { localStorage.setItem(KEY, JSON.stringify(attempts)); } catch {} }
      return added;
    } catch (e) { markSyncUnavailable(e); return 0; }
  }
  async function push() {
    if (syncDisabled()) return;
    const s = await session(); if (!s) return;
    try {
      const { error } = await sb.from('profiles').upsert({ id: s.user.id, attempts: attempts.slice(-MAX_SYNCED).map(pack) });
      if (error) throw error;
    } catch (e) { markSyncUnavailable(e); }
  }
  function markSyncUnavailable(e) {
    // most likely the `attempts` column doesn't exist yet — keep working locally and stop retrying
    console.warn('[Progress] cloud sync unavailable, saving locally only:', e?.message || e);
    try { localStorage.setItem(SYNC_FLAG, '1'); } catch {}
  }
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(push, 4000); }
  const retrySync = () => { try { localStorage.removeItem(SYNC_FLAG); } catch {} return pull().then(push); };

  /* ── ability model (Bayesian 1PL, Newton–Raphson) ──────────── */
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const itemB = a => { const q = qIndex.get(a.q); return q ? (DIFF_B[q.difficulty] ?? 0) : null; };

  // MAP estimate of θ with a Normal(priorMean, priorSd²) prior. Returns {theta, se, n}.
  function ability(list, priorMean = 0, priorSd = 1.5) {
    index();
    const items = list.map(a => ({ c: a.c, b: itemB(a) })).filter(i => i.b !== null);
    let th = priorMean;
    const p2 = priorSd * priorSd;
    let hess = -1 / p2;
    for (let it = 0; it < 25; it++) {
      let g = -(th - priorMean) / p2; hess = -1 / p2;
      for (const i of items) { const p = sigmoid(th - i.b); g += i.c - p; hess -= p * (1 - p); }
      const step = g / hess;
      th -= step;
      if (Math.abs(step) < 1e-6) break;
    }
    return { theta: th, se: Math.sqrt(1 / -hess), n: items.length };
  }

  const bySection = sec => attempts.filter(a => qIndex.get(a.q)?.section === sec);

  function skillStats() {
    index();
    const secTheta = {};
    ['reading_writing', 'math'].forEach(sec => { secTheta[sec] = ability(bySection(sec)); });
    const groups = {};
    for (const a of attempts) {
      const q = qIndex.get(a.q); if (!q) continue;
      (groups[q.section + '|' + q.subtopic] ||= []).push(a);
    }
    return skillList.map(s => {
      const list = groups[s.section + '|' + s.skill] || [];
      const est = ability(list, secTheta[s.section].theta, 1.0);   // shrink toward the section estimate
      const c = list.reduce((x, a) => x + a.c, 0);
      return { ...s, attempts: list.length, correct: c, acc: list.length ? c / list.length : null,
               theta: est.theta, se: est.se, secTheta: secTheta[s.section].theta };
    });
  }

  function predict() {
    index();
    const out = {};
    let ready = true, tot = 0, varSum = 0;
    for (const [key, sec] of [['rw', 'reading_writing'], ['math', 'math']]) {
      const e = ability(bySection(sec));
      const ok = e.n >= MIN_FOR_SCORE;
      ready = ready && ok;
      const score = toScore(e.theta);
      out[key] = { ready: ok, n: e.n, theta: e.theta, score,
                   lo: toScore(e.theta - 1.28 * e.se), hi: toScore(e.theta + 1.28 * e.se) };
      tot += score; varSum += Math.pow(1.28 * e.se * SCORE_PER_LOGIT, 2);
    }
    const half = Math.round(Math.sqrt(varSum) / 10) * 10;
    out.total = { ready, score: tot, lo: Math.max(400, tot - half), hi: Math.min(1600, tot + half) };
    return out;
  }

  /* ── Error DNA ─────────────────────────────────────────────── */
  const CAUSES = {
    rushed:   { label: 'Rushed',        color: '#fb7185', tip: 'You answered far faster than usual and missed a skill you normally know. Slow down on the first read and re-check what is being asked.' },
    timesink: { label: 'Time sink',     color: '#f59e0b', tip: 'These ate far more time than they should. Set a hard cap (about 90 s), flag it, and come back at the end.' },
    gap:      { label: 'Concept gap',   color: '#818cf8', tip: 'You are missing the underlying idea for this skill. Study the rule, then drill it — more mixed practice will not fix this.' },
    slip:     { label: 'Close call',    color: '#22d3ee', tip: 'You normally get this skill right. Check the answer against the question wording before locking it in.' },
    repeat:   { label: 'Repeat miss',   color: '#a78bfa', tip: 'You have missed this exact question before. Write down the rule it tests and retry it tomorrow.' }
  };
  // Wrong-answer patterns the College Board rationales describe for Reading & Writing distractors.
  const TRAPS = {
    extreme:  { label: 'Too extreme / overstated', re: /\b(extreme|overstat|too strong|absolute|always|never|exaggerat|overgeneraliz)/i },
    beyond:   { label: 'Not supported by the text', re: /\b(not (?:supported|stated|mentioned|indicated|suggested)|nothing in the text|goes beyond|no (?:evidence|information)|unsupported|speculat)/i },
    opposite: { label: 'Says the opposite',         re: /\b(opposite|contradict|reverses?|conflicts? with)/i },
    offtopic: { label: 'True but off-topic',        re: /\b(unrelated|irrelevant|does not address|doesn.t address|not relevant|off.topic|doesn.t focus|not (?:the )?focus)/i },
    partial:  { label: 'Only part of the answer',   re: /\b(only (?:part|one|some)|partial|incomplete|too narrow|just one|one aspect)/i },
    misread:  { label: 'Misread the text',          re: /\b(misread|misinterpret|confus)/i }
  };
  // the rationale segment that explains why one specific wrong choice is wrong
  function wrongChoiceRationale(q, letter) {
    if (!q.explanation || !letter) return '';
    const m = new RegExp('Choice ' + letter + ' is incorrect([\\s\\S]*?)(?=Choice [A-D] is (?:incorrect|the best answer|correct)|$)').exec(q.explanation);
    return m ? m[1] : '';
  }
  const grammarRule = q => (/The convention being tested is ([^.]+)\./.exec(q.explanation || '') || [])[1] || null;

  function expectedSec(q, list) {
    const own = list.filter(a => qIndex.get(a.q)?.section === q.section && qIndex.get(a.q)?.difficulty === q.difficulty && a.c && a.ms > 3000);
    if (own.length >= 8) { const s = own.map(a => a.ms / 1000).sort((x, y) => x - y); return s[s.length >> 1]; }
    return DEFAULT_SEC[q.section][q.difficulty] || 70;
  }

  // Why was this attempt wrong?  -> { cause, trap, rule }
  function classify(a, ctx) {
    const q = qIndex.get(a.q); if (!q || a.c) return null;
    const sk = ctx.skillAcc.get(q.section + '|' + q.subtopic);
    const priorMiss = ctx.history.some(h => h.q === a.q && h.t < a.t && !h.c);
    const exp = expectedSec(q, ctx.history), sec = a.ms / 1000;
    const accBefore = sk && sk.n >= 5 ? sk.c / sk.n : null;
    let cause;
    if (priorMiss) cause = 'repeat';
    else if (sec < exp * 0.45 && (accBefore === null || accBefore >= 0.6)) cause = 'rushed';
    else if (sec > exp * 1.7) cause = 'timesink';
    else if (accBefore !== null && accBefore < 0.55) cause = 'gap';
    else cause = accBefore !== null && accBefore >= 0.75 ? 'slip' : 'gap';

    let trap = null, rule = null;
    if (q.section === 'reading_writing') {
      rule = grammarRule(q);
      const seg = wrongChoiceRationale(q, a.a);
      if (!rule) trap = Object.keys(TRAPS).find(k => TRAPS[k].re.test(seg)) || null;
    }
    return { cause, trap, rule, q };
  }

  function dna({ days = 90 } = {}) {
    index();
    const since = Date.now() - days * 864e5;
    const skillAcc = new Map();
    const result = { total: 0, causes: {}, traps: {}, rules: {}, weakSkills: [], pace: {}, missed: 0 };
    const history = [];
    for (const a of attempts) {                          // chronological
      const q = qIndex.get(a.q); if (!q) continue;
      const k = q.section + '|' + q.subtopic;
      if (a.t >= since && !a.c) {
        const r = classify(a, { skillAcc, history });
        if (r) {
          result.total++;
          result.causes[r.cause] = (result.causes[r.cause] || 0) + 1;
          if (r.trap) result.traps[r.trap] = (result.traps[r.trap] || 0) + 1;
          if (r.rule) result.rules[r.rule] = (result.rules[r.rule] || 0) + 1;
        }
      }
      const s = skillAcc.get(k) || { n: 0, c: 0 }; s.n++; s.c += a.c; skillAcc.set(k, s);
      history.push(a);
    }
    result.missed = result.total;
    // pace: your median seconds per question vs the typical benchmark
    for (const sec of ['reading_writing', 'math']) {
      const t = attempts.filter(a => qIndex.get(a.q)?.section === sec && a.ms > 3000).map(a => a.ms / 1000).sort((x, y) => x - y);
      if (t.length >= 5) result.pace[sec] = { median: Math.round(t[t.length >> 1]), n: t.length, bench: sec === 'math' ? 95 : 70 };
    }
    const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
    result.causeList = sorted(result.causes).map(([k, n]) => ({ key: k, n, ...CAUSES[k] }));
    result.trapList = sorted(result.traps).map(([k, n]) => ({ key: k, n, label: TRAPS[k].label }));
    result.ruleList = sorted(result.rules).map(([rule, n]) => ({ rule, n }));
    return result;
  }

  /* ── Mistake notebook ─────────────────────────────────────── */
  // questions whose most recent attempt was wrong
  function openMistakes() {
    index();
    const last = new Map();
    for (const a of attempts) last.set(a.q, a);
    return [...last.values()].filter(a => !a.c).sort((x, y) => y.t - x.t).map(a => qIndex.get(a.q)).filter(Boolean);
  }

  /* ── Planner: where do study hours buy the most points? ───── */
  const THETA_CAP = 2.2;       // a realistic ceiling (~760 per section) we plan toward
  const PLASTICITY = 0.6;      // share of the remaining headroom study can realistically close
  const TAU_H = 6;             // hours of focused work on one skill to close ~63% of that share

  // marginal section-score gain per extra hour on a skill, given h hours already spent on it
  const marginal = (s, h) => SCORE_PER_LOGIT * s.w * Math.max(0, THETA_CAP - s.theta) * PLASTICITY / TAU_H * Math.exp(-h / TAU_H);

  function plan({ target, testDate, hoursPerDay = 1 }) {
    const stats = skillStats();
    const now = predict();
    const days = Math.max(1, Math.ceil((new Date(testDate) - Date.now()) / 864e5));
    const totalHours = Math.min(days * hoursPerDay, 600);
    // greedy: hand out 15-minute blocks to whichever skill currently buys the most points
    const hrs = new Map(stats.map(s => [s.section + '|' + s.skill, 0]));
    for (let b = 0; b < totalHours * 4; b++) {
      let best = null, bg = -1;
      for (const s of stats) { const g = marginal(s, hrs.get(s.section + '|' + s.skill)); if (g > bg) { bg = g; best = s; } }
      hrs.set(best.section + '|' + best.skill, hrs.get(best.section + '|' + best.skill) + 0.25);
    }
    let projRW = now.rw.theta, projM = now.math.theta;
    const rows = stats.map(s => {
      const h = hrs.get(s.section + '|' + s.skill);
      const gainTheta = Math.max(0, THETA_CAP - s.theta) * PLASTICITY * (1 - Math.exp(-h / TAU_H));
      if (s.section === 'math') projM += s.w * gainTheta; else projRW += s.w * gainTheta;
      return { ...s, hours: h, perHour: marginal(s, 0), pts: SCORE_PER_LOGIT * s.w * gainTheta, untested: s.attempts < 4 };
    }).sort((a, b) => b.perHour - a.perHour);
    const projected = toScore(projRW) + toScore(projM);
    return { days, totalHours, now, rows, projected, target, onTrack: target ? projected >= target : null,
             gap: target ? target - now.total.score : null };
  }

  // difficulty to serve for a skill given your estimated ability on it
  const diffFor = th => th < -0.3 ? 'easy' : th < 0.9 ? 'medium' : 'hard';

  // Pick n questions from a skill: unseen first, difficulty near your level, wrong-before as a tie-break.
  function pickForSkill(skill, n, st) {
    index();
    const seen = new Map();
    for (const a of attempts) { const r = seen.get(a.q) || { n: 0, lastC: 1 }; r.n++; r.lastC = a.c; seen.set(a.q, r); }
    const target = st ? (DIFF_B[diffFor(st.theta)]) : 0.1;
    const scored = SAT_QUESTIONS.filter(q => q.subtopic === skill && !q.selfGraded).map(q => {
      const s = seen.get(q.id);
      const fit = -Math.abs((DIFF_B[q.difficulty] ?? 0) - target);
      return { q, score: (s ? (s.lastC ? -2 : 1) : 3) + fit + Math.random() * 0.8 };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, n).map(x => x.q);
  }

  // Smart session: spread n questions over the skills with the highest points-per-hour.
  function smartPick(n = 15, section = null) {
    const stats = skillStats().filter(s => !section || section === 'all' || s.section === section);
    const ranked = stats.map(s => ({ s, g: marginal(s, 0) * (s.attempts < 4 ? 1.25 : 1) })).sort((a, b) => b.g - a.g);
    const top = ranked.slice(0, Math.min(5, ranked.length));
    const wsum = top.reduce((a, r) => a + r.g, 0) || 1;
    const out = [];
    top.forEach((r, i) => {
      const k = i === top.length - 1 ? n - out.length : Math.max(1, Math.round(n * r.g / wsum));
      out.push(...pickForSkill(r.s.skill, Math.min(k, n - out.length), r.s));
    });
    return out.sort(() => Math.random() - 0.5);
  }

  /* ── profile summary for the AI tutor ─────────────────────── */
  function profileSummary() {
    if (attempts.length < 10) return '';
    const st = skillStats().filter(s => s.attempts >= 4).sort((a, b) => a.theta - b.theta);
    const d = dna();
    const parts = [`${attempts.length} questions logged.`];
    if (st.length) parts.push('Weakest skills: ' + st.slice(0, 3).map(s => `${s.skill} (${Math.round(s.acc * 100)}%)`).join('; ') + '.');
    if (d.causeList[0]) parts.push(`Most common miss cause: ${d.causeList[0].label.toLowerCase()}.`);
    if (d.trapList[0]) parts.push(`Falls for "${d.trapList[0].label.toLowerCase()}" wrong answers most.`);
    if (d.ruleList[0]) parts.push(`Often misses grammar rule: ${d.ruleList[0].rule}.`);
    return parts.join(' ');
  }

  /* ── misc ──────────────────────────────────────────────────── */
  const all = () => attempts;
  const exportJSON = () => JSON.stringify({ v: 1, attempts: attempts.map(pack) });
  function importJSON(text) {
    const d = JSON.parse(text);
    const added = merge((d.attempts || []).map(unpack));
    persist();
    return added;
  }
  function clear() { attempts = []; try { localStorage.removeItem(KEY); } catch {} scheduleSync(); }
  function _setAttempts(list) { attempts = list; }   // test hook

  try { load(); } catch { attempts = []; }

  return { record, markShown, elapsed, all, skills, skillStats, predict, dna, plan, smartPick, pickForSkill, openMistakes,
           profileSummary, diffFor, questionById, pull, push, retrySync, exportJSON, importJSON, clear,
           CAUSES, TRAPS, _setAttempts, toScore, ability };
})();
