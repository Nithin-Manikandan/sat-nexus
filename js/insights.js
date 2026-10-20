/* ============================================================
   SAT NEXUS — Insights, Game Plan & Smart Practice (UI)
   Built on the Progress engine (js/progress.js).
   ============================================================ */

const PLAN_KEY = 'sat_nexus_plan';
const SECTION_NAME = { reading_writing: 'Reading & Writing', math: 'Math' };

function planSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PLAN_KEY) || '{}'); } catch {}
  const d = new Date(); d.setDate(d.getDate() + 70);
  return {
    target: USER?.targetScore || saved.target || 1400,
    testDate: USER?.testDate || saved.testDate || d.toISOString().slice(0, 10),
    hoursPerDay: saved.hoursPerDay || 1.5
  };
}

const levelColor = th => {                      // θ → red…green tile colour
  const t = Math.max(0, Math.min(1, (th + 1.5) / 3.5));
  return `hsla(${Math.round(t * 140)}, 70%, 48%, .28)`;
};
const pct = x => x === null || x === undefined ? '—' : Math.round(x * 100) + '%';
const mins = s => s >= 90 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
const jsq = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/* ── Practice launchers ───────────────────────────────────────── */
function drillSkill(skill, n = 10) {
  const st = Progress.skillStats().find(s => s.skill === skill);
  beginPractice(Progress.pickForSkill(skill, n, st), `Skill drill · ${skill}`);
}
function startSmartPractice(n = 15) {
  const sub = typeof pfState !== 'undefined' ? pfState.subject : 'all';
  beginPractice(Progress.smartPick(n, sub), '⚡ Smart Practice');
}
function retryMistakes(n = 15) {
  beginPractice(Progress.openMistakes().slice(0, n).sort(() => Math.random() - 0.5), '🔁 Retry my mistakes');
}
function runDiagnostic(skillNames) {   // one question per skill, in random order
  const names = skillNames || Progress.skills().map(s => s.skill);
  const qs = names.flatMap(k => Progress.pickForSkill(k, 1, { theta: 0 }));
  beginPractice(qs.sort(() => Math.random() - 0.5), '🧭 Skill diagnostic');
}
const startDiagnostic = () => runDiagnostic();

function renderSmartStart() {
  const el = document.getElementById('smartStart'); if (!el) return;
  const n = Progress.all().length, miss = Progress.openMistakes().length;
  el.innerHTML = `
    <div class="chart-card smart-card">
      <div class="smart-main">
        <div class="smart-title">⚡ Smart Practice</div>
        <p>${n >= 10
          ? 'Fifteen questions chosen from the skills where your next hour buys the most points, at the right difficulty for you.'
          : 'Fifteen questions from across the test. As you answer, this learns your weak spots and starts targeting them.'}</p>
      </div>
      <div class="smart-actions">
        <button class="btn btn-primary" onclick="startSmartPractice()">Start Smart Practice</button>
        ${miss ? `<button class="btn btn-ghost" onclick="retryMistakes()">🔁 Retry my mistakes <span class="tutor-pip">${miss}</span></button>` : ''}
      </div>
    </div>`;
}

/* ── Insights page ────────────────────────────────────────────── */
function renderInsights() {
  const body = document.getElementById('insightsBody'); if (!body) return;
  const n = Progress.all().length;
  if (n < 10) {
    body.innerHTML = `<div class="chart-card" style="text-align:center;padding:48px 24px">
      <div style="font-size:2.4rem;margin-bottom:10px">🧬</div>
      <h3 style="margin-bottom:8px">Your Insights are waiting on data</h3>
      <p style="color:var(--text-secondary);max-width:460px;margin:0 auto 20px">Answer about 15 questions in each section and this page builds your score estimate, your Error DNA, and a skill-by-skill map. You've logged ${n} so far.</p>
      <button class="btn btn-primary" onclick="startSmartPractice()">Start Smart Practice</button></div>`;
    return;
  }
  const pr = Progress.predict(), dna = Progress.dna(), skills = Progress.skillStats();
  const sec = (label, p, color) => `
    <div class="stat-card"><div class="stat-label">${label}</div>
      <div class="stat-value" style="color:${color}">${p.ready ? p.score : '—'}</div>
      <div class="stat-change">${p.ready ? `likely ${p.lo}–${p.hi}` : `needs ${Math.max(0, 15 - p.n)} more answers`}</div></div>`;
  const med = ['reading_writing', 'math'].filter(k => dna.pace[k]).map(k => `${k === 'math' ? 'Math' : 'R&W'} ${mins(dna.pace[k].median)}`).join(' · ');

  const causeBar = dna.total >= 5
    ? `<div class="dna-bar">${dna.causeList.map(c => `<span style="flex:${c.n};background:${c.color}" title="${c.label}: ${c.n}"></span>`).join('')}</div>
       <div class="dna-list">${dna.causeList.map(c => `
         <div class="dna-row"><span class="dna-dot" style="background:${c.color}"></span>
           <div><strong>${c.label}</strong> <span class="dna-n">${Math.round(c.n / dna.total * 100)}% · ${c.n}</span>
           <div class="dna-tip">${c.tip}</div></div></div>`).join('')}</div>`
    : `<p class="dna-tip">Needs at least 5 misses to find patterns — you have ${dna.total}.</p>`;

  const traps = dna.trapList.length
    ? dna.trapList.slice(0, 5).map(t => `<div class="bar-row"><span>${t.label}</span><div class="bar"><i style="width:${t.n / dna.trapList[0].n * 100}%"></i></div><b>${t.n}</b></div>`).join('')
    : `<p class="dna-tip">No clear pattern yet in your Reading &amp; Writing misses.</p>`;
  const rules = dna.ruleList.length
    ? dna.ruleList.slice(0, 6).map(r => `<div class="bar-row"><span>${r.rule}</span><div class="bar"><i style="width:${r.n / dna.ruleList[0].n * 100}%"></i></div><b>${r.n}</b></div>`).join('')
    : `<p class="dna-tip">No grammar-rule misses logged yet.</p>`;

  const skillGrid = ['reading_writing', 'math'].map(sk => `
    <div class="skill-group"><h4>${SECTION_NAME[sk]}</h4>
      <div class="skill-grid">${skills.filter(s => s.section === sk).sort((a, b) => a.theta - b.theta).map(s => `
        <button class="skill-tile" style="background:${s.attempts ? levelColor(s.theta) : 'rgba(255,255,255,.04)'}" onclick="drillSkill('${jsq(s.skill)}')" title="Drill 10 questions">
          <span class="skill-name">${s.skill}</span>
          <span class="skill-meta">${s.attempts ? `${pct(s.acc)} · ${s.attempts} answered` : 'not tried yet'}</span>
        </button>`).join('')}</div></div>`).join('');

  body.innerHTML = `
    <div class="grid-4" style="margin-bottom:24px">
      <div class="stat-card"><div class="stat-label">Estimated Score</div>
        <div class="stat-value gradient-text">${pr.total.ready ? pr.total.score : '—'}</div>
        <div class="stat-change">${pr.total.ready ? `likely ${pr.total.lo}–${pr.total.hi}` : 'building your estimate…'}</div></div>
      ${sec('Reading & Writing', pr.rw, 'var(--violet)')}
      ${sec('Math', pr.math, 'var(--cyan)')}
      <div class="stat-card"><div class="stat-label">Answers Logged</div>
        <div class="stat-value" style="color:var(--emerald)">${n.toLocaleString()}</div>
        <div class="stat-change">${med ? 'median time ' + med : 'timing starts with your next answer'}</div></div>
    </div>

    <div class="grid-2">
      <div class="chart-card"><div class="card-header"><h3>🧬 Error DNA</h3><span class="dna-n">${dna.total} misses · last 90 days</span></div>${causeBar}</div>
      <div class="chart-card">
        <div class="card-header"><h3>Traps you fall for</h3></div>${traps}
        <div class="card-header" style="margin-top:22px"><h3>Grammar rules you miss</h3></div>${rules}
      </div>
    </div>

    <div class="chart-card" style="margin-top:20px">
      <div class="card-header"><h3>Skill map</h3><span class="dna-n">greener = stronger · tap a skill to drill it</span></div>
      ${skillGrid}
    </div>
    <p class="fineprint">Scores come from a statistical model of your answers (item-difficulty-adjusted, with a confidence range). It tightens as you answer more, and is an estimate, not a prediction of test-day results.</p>`;
}

/* ── Game Plan page ───────────────────────────────────────────── */
function savePlanSettings() {
  const target = parseInt(document.getElementById('planTarget').value) || 1400;
  const testDate = document.getElementById('planDate').value;
  const hoursPerDay = parseFloat(document.getElementById('planHours').value) || 1.5;
  if (!testDate || new Date(testDate) < new Date(new Date().toDateString())) { showToast('Pick a test date in the future.', 'error'); return; }
  try { localStorage.setItem(PLAN_KEY, JSON.stringify({ target, testDate, hoursPerDay })); } catch {}
  if (USER) { USER.targetScore = target; USER.testDate = testDate; saveUser(USER); }
  renderPlan();
}

function todaysTasks(plan, hoursPerDay) {
  const budget = Math.round(hoursPerDay * 60);
  const tasks = [];
  const miss = Progress.openMistakes().length;
  let left = budget;
  const untested = plan.rows.filter(r => r.untested).slice(0, 8);
  if (untested.length >= 3) {
    const m = Math.min(15, Math.round(budget * 0.25)); left -= m;
    tasks.push({ icon: '🧭', title: `Diagnose ${untested.length} untried skills`, detail: `1 question each — so the plan knows where you really stand`, min: m,
                 run: `runDiagnostic(${JSON.stringify(untested.map(r => r.skill))})` });
  }
  if (miss >= 3) {
    const m = Math.max(8, Math.round(budget * 0.15)); left -= m;
    tasks.push({ icon: '🔁', title: `Retry ${Math.min(miss, 10)} missed questions`, detail: 'Until you can get them right cold', min: m, run: 'retryMistakes(10)' });
  }
  const top = plan.rows.filter(r => !r.untested || !untested.length).slice(0, 3);
  const wsum = top.reduce((a, r) => a + r.perHour, 0) || 1;
  top.forEach(r => {
    const m = Math.max(10, Math.round(Math.max(left, 20) * r.perHour / wsum));
    const perQ = r.section === 'math' ? 130 : 90;
    const n = Math.max(5, Math.round(m * 60 / perQ));
    tasks.push({ icon: r.section === 'math' ? '📐' : '📖', title: `Drill: ${r.skill}`, detail: `${n} questions · about ${r.perHour.toFixed(1)} pts per hour right now`, min: m, run: `drillSkill('${jsq(r.skill)}', ${n})` });
  });
  return tasks;
}

function renderPlan() {
  const body = document.getElementById('planBody'); if (!body) return;
  const st = planSettings();
  const plan = Progress.plan(st);
  const days = plan.days, now = plan.now.total;
  const status = plan.onTrack === null ? '' : plan.onTrack
    ? `<span class="chip chip-good">On track</span> following this plan projects <b>${plan.projected}</b>, above your ${st.target} target.`
    : `<span class="chip chip-warn">Stretch goal</span> this plan projects <b>${plan.projected}</b> — ${st.target - plan.projected} short. More hours per day, or a later test date, closes it.`;
  const tasks = todaysTasks(plan, st.hoursPerDay);
  const sparse = Progress.all().length < 30;

  body.innerHTML = `
    <div class="chart-card plan-form">
      <label>Target score <input id="planTarget" type="number" min="400" max="1600" step="10" value="${st.target}" /></label>
      <label>Test date <input id="planDate" type="date" value="${st.testDate}" /></label>
      <label>Study time per day
        <select id="planHours">${[0.5, 1, 1.5, 2, 3, 4].map(h => `<option value="${h}" ${h === st.hoursPerDay ? 'selected' : ''}>${h} hour${h === 1 ? '' : 's'}</option>`).join('')}</select></label>
      <button class="btn btn-primary" onclick="savePlanSettings()">Update plan</button>
    </div>

    <div class="grid-4" style="margin:20px 0">
      <div class="stat-card"><div class="stat-label">Now</div><div class="stat-value">${now.ready ? now.score : '—'}</div>
        <div class="stat-change">${now.ready ? `likely ${now.lo}–${now.hi}` : 'answer more to see'}</div></div>
      <div class="stat-card"><div class="stat-label">Projected on test day</div><div class="stat-value gradient-text">${plan.projected}</div>
        <div class="stat-change">if you follow this plan</div></div>
      <div class="stat-card"><div class="stat-label">Target</div><div class="stat-value" style="color:var(--emerald)">${st.target}</div>
        <div class="stat-change">${days} days left</div></div>
      <div class="stat-card"><div class="stat-label">Study hours available</div><div class="stat-value" style="color:var(--cyan)">${Math.round(plan.totalHours)}h</div>
        <div class="stat-change">${st.hoursPerDay}h × ${days} days</div></div>
    </div>
    <div class="plan-status">${status}</div>
    ${sparse ? `<div class="tutor-note" style="margin:14px 0">The plan is still running mostly on averages — you've logged ${Progress.all().length} answers. <a href="#" onclick="startDiagnostic();return false">Run a 29-question diagnostic</a> to sharpen it fast.</div>` : ''}

    <div class="chart-card" style="margin-top:20px">
      <div class="card-header"><h3>Today's plan</h3><span class="dna-n">${st.hoursPerDay}h budget</span></div>
      <div class="task-list">${tasks.map(t => `
        <div class="task"><div class="task-icon">${t.icon}</div>
          <div class="task-main"><div class="task-title">${t.title}</div><div class="task-detail">${t.detail}</div></div>
          <div class="task-min">${t.min} min</div>
          <button class="btn btn-primary btn-sm" onclick="${t.run.replace(/"/g, '&quot;')}">Start</button></div>`).join('')}</div>
    </div>

    <div class="chart-card" style="margin-top:20px">
      <div class="card-header"><h3>Where the points are</h3><span class="dna-n">ranked by points gained per study hour</span></div>
      <div class="table-scroll"><table class="plan-table">
        <thead><tr><th>Skill</th><th>Level</th><th>Pts / hour</th><th>Planned</th><th>Gain</th><th></th></tr></thead>
        <tbody>${plan.rows.slice(0, 14).map(r => `<tr>
          <td><b>${r.skill}</b><div class="dna-n">${SECTION_NAME[r.section]}${r.untested ? ' · untested' : ''}</div></td>
          <td><div class="bar"><i style="width:${Math.max(4, Math.min(100, (r.theta + 2) / 4.5 * 100))}%;background:${levelColor(r.theta).replace('.28', '.9')}"></i></div></td>
          <td>${r.perHour.toFixed(1)}</td><td>${r.hours.toFixed(1)}h</td><td>+${Math.round(r.pts)}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="drillSkill('${jsq(r.skill)}')">Drill</button></td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <p class="fineprint">Points per hour come from your estimated level on each skill, how much of the test it covers, and diminishing returns on repeated practice. The projection is a model, not a promise.</p>`;
}

/* ── Backup & sync (Settings) ─────────────────────────────────── */
function exportProgress() {
  const blob = new Blob([Progress.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sat-nexus-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}
function importProgress(input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try { const n = Progress.importJSON(String(r.result)); showToast(`Imported — ${n} new answers added.`, 'success'); updateProgressStatus(); }
    catch { showToast('That file is not a valid progress export.', 'error'); }
    input.value = '';
  };
  r.readAsText(f);
}
async function retryCloudSync() {
  await Progress.retrySync();
  showToast('Sync attempted — see status below.', 'info');
  updateProgressStatus();
}
async function updateProgressStatus() {
  const el = document.getElementById('progressStatus'); if (!el) return;
  let signedIn = false;
  try { signedIn = !!(await sb.auth.getSession()).data.session; } catch {}
  const off = (() => { try { return localStorage.getItem('sat_nexus_sync_disabled') === '1'; } catch { return false; } })();
  el.textContent = `${Progress.all().length.toLocaleString()} answers saved on this device. ` + (!signedIn
    ? 'Sign in to sync them across devices.'
    : off ? 'Cloud sync is off — your Supabase profile needs an "attempts" column (see setup notes), then press Retry.'
          : 'Cloud sync is on.');
}
