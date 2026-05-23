/* ============================================================
   SAT NEXUS — Application Logic
   ============================================================ */

/* ── Supabase ─────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://oybnhgpkoqpczfvpxmmx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1xIjUk6Xmm-HXgpsqaz_CA_DRW5EzY6';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── User State ──────────────────────────────────────────────── */
let USER = null; // null until onboarding complete

function loadUser() {
  try {
    const stored = localStorage.getItem('sat_nexus_user');
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function saveUser(u) {
  USER = u;
  localStorage.setItem('sat_nexus_user', JSON.stringify(u));
}

function isGuest() {
  return USER && USER.mode === 'guest';
}

/* ── Onboarding ──────────────────────────────────────────────── */
function showOnboarding() {
  document.getElementById('onboardingOverlay').classList.add('active');
}

function hideOnboarding() {
  document.getElementById('onboardingOverlay').classList.remove('active');
}

function showOnboardTab(tab) {
  const isSignup = tab === 'signup';
  document.getElementById('panelSignup').style.display = isSignup ? '' : 'none';
  document.getElementById('panelSignin').style.display = isSignup ? 'none' : '';
  document.getElementById('tabSignup').style.background = isSignup ? 'var(--gradient-brand)' : 'transparent';
  document.getElementById('tabSignup').style.color      = isSignup ? '#fff' : 'var(--text-secondary)';
  document.getElementById('tabSignin').style.background = isSignup ? 'transparent' : 'var(--gradient-brand)';
  document.getElementById('tabSignin').style.color      = isSignup ? 'var(--text-secondary)' : '#fff';
}

function continueAsGuest() {
  saveUser({
    mode: 'guest', name: 'Guest',
    currentScore: null, targetScore: null, testDate: null,
    streak: 0, studyTime: 0, questionsAnswered: 0,
    accuracy: null, testsCompleted: 0
  });
  hideOnboarding();
  initApp();
}

async function createAccount() {
  const name    = document.getElementById('onboardName').value.trim() || 'Student';
  const email   = document.getElementById('onboardEmail').value.trim();
  const pass    = document.getElementById('onboardPassword').value;
  const current = parseInt(document.getElementById('onboardCurrent').value) || null;
  const target  = parseInt(document.getElementById('onboardTarget').value)  || null;
  const date    = document.getElementById('onboardDate').value || null;

  if (!email) { showToast('Please enter your email', 'error'); return; }
  if (pass.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }

  const btn = document.getElementById('btnSignup');
  btn.textContent = 'Creating account…'; btn.disabled = true;

  const { data, error } = await sb.auth.signUp({
    email, password: pass,
    options: {
      data: { name },
      emailRedirectTo: `${window.location.origin}/confirm.html`
    }
  });

  btn.textContent = 'Create Account →'; btn.disabled = false;

  if (error) { showToast(error.message, 'error'); return; }

  if (data.user) {
    await sb.from('profiles').upsert({
      id: data.user.id, name,
      current_score: current, target_score: target, test_date: date
    });
  }

  // Show "check your email" screen
  document.getElementById('onboardForm').innerHTML = `
    <div style="text-align:center;padding:16px 0">
      <div style="font-size:3.5rem;margin-bottom:20px">📬</div>
      <h2 style="font-size:1.25rem;margin-bottom:10px">Check your email</h2>
      <p style="color:var(--text-secondary);font-size:.87rem;line-height:1.7;margin-bottom:6px">
        We sent a confirmation link to<br>
        <strong style="color:var(--text-primary)">${email}</strong>
      </p>
      <p style="color:var(--text-muted);font-size:.8rem;margin-bottom:28px">
        Click the link in that email to activate your account.<br>Check your spam folder if you don't see it.
      </p>
      <button class="btn btn-ghost" style="width:100%;justify-content:center;font-size:.82rem" onclick="continueAsGuest()">
        Continue as Guest for now
      </button>
    </div>`;
}

async function signIn() {
  const email = document.getElementById('signinEmail').value.trim();
  const pass  = document.getElementById('signinPassword').value;

  if (!email || !pass) { showToast('Please enter email and password', 'error'); return; }

  const btn = document.getElementById('btnSignin');
  btn.textContent = 'Signing in…'; btn.disabled = true;

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

  btn.textContent = 'Sign In →'; btn.disabled = false;

  if (error) { showToast(error.message, 'error'); return; }

  const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
  if (profile?.avatar) localStorage.setItem('sat_nexus_avatar', profile.avatar);
  if (profile?.flashcard_progress) {
    fcProgressCache = profile.flashcard_progress;
    localStorage.setItem(FC_PROGRESS_KEY, JSON.stringify(fcProgressCache));
  }
  saveUser({
    mode: 'account',
    name: profile?.name || data.user.user_metadata?.name || 'Student',
    avatar:            profile?.avatar           ?? null,
    currentScore:      profile?.current_score   ?? null,
    targetScore:       profile?.target_score    ?? null,
    testDate:          profile?.test_date        ?? null,
    streak:            profile?.streak          ?? 0,
    studyTime:         profile?.study_time      ?? 0,
    questionsAnswered: profile?.questions_answered ?? 0,
    accuracy:          profile?.accuracy        ?? null,
    testsCompleted:    profile?.tests_completed ?? 0,
    topicMastery:      profile?.topic_mastery   ?? {}
  });
  hideOnboarding();
  initApp();
}

/* ── Navigation ─────────────────────────────────────────────── */
const PAGE_TITLES = {
  dashboard:   'Dashboard',
  practice:    'Practice Questions',
  fulltest:    'Full Practice Tests',
  flashcards:  'Vocab Flashcards',
  resources:   'Resource Hub',
  videos:      'Video Library',
  analytics:   'Analytics',
  roadmap:     'Study Roadmap',
  formulas:    'Formula Sheet',
  leaderboard: 'Leaderboard',
  settings:    'Settings'
};

function navigateTo(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const section = document.getElementById(`page-${page}`);
  if (section) section.classList.add('active');
  const navItem = document.querySelector(`[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  document.getElementById('topbarTitle').textContent = PAGE_TITLES[page] || page;

  if (page === 'analytics')   initAnalyticsCharts();
  if (page === 'videos')      renderVideos('all');
  if (page === 'resources')   renderResources('all', null);
  if (page === 'formulas')    renderFormulas();
  if (page === 'leaderboard') renderLeaderboard();
  if (page === 'roadmap')     initRoadmapDefaults();
  if (page === 'flashcards')  initFlashcardProgress().then(() => { applyCardFilter(); });
  if (page === 'fulltest')    initFullTestPage();
  if (page === 'practice')    renderDomainChips();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

document.getElementById('sidebarToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

/* ── Toast ───────────────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 3000) {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('hiding'); setTimeout(() => toast.remove(), 300); }, duration);
}

/* ── Dashboard ───────────────────────────────────────────────── */
/* ── Question of the Day ─────────────────────────────────────── */
function initQOTD() {
  const el = id => document.getElementById(id);
  if (!el('qotdDate')) return;
  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  el('qotdDate').textContent = dateLabel;
}

function initDashboard() {
  updateSidebarUser();
  initQOTD();
  if (!USER.questionsAnswered || USER.questionsAnswered === 0) {
    renderEmptyDashboard();
  } else {
    renderDashboard();
  }
}

function updateSidebarUser() {
  if (!USER) return;
  const nameEl = document.querySelector('.user-name');
  const scoreEl = document.querySelector('.user-score');
  const avatarEl = document.querySelector('.user-avatar');
  if (nameEl) nameEl.textContent = USER.name;
  if (scoreEl) scoreEl.textContent = USER.currentScore ? `Est. Score: ${USER.currentScore}` : 'No score yet';
  if (avatarEl) {
    const saved = USER.avatar || localStorage.getItem('sat_nexus_avatar');
    avatarEl.innerHTML = saved && saved.length <= 4 ? `<span style="font-size:1.4rem">${saved}</span>` : USER.name.slice(0,2).toUpperCase();
    avatarEl.style.cursor = 'pointer';
    avatarEl.title = 'Change avatar';
    avatarEl.onclick = showAvatarPicker;
  }
  const streakEl = document.querySelector('.streak-number');
  if (streakEl) streakEl.textContent = `🔥 ${USER.streak}`;
}

const AVATAR_OPTIONS = ['😀','🦁','🐯','🦊','🐺','🦅','🐉','⚡','🔥','🎯','🚀','💎','🌟','🎓','🏆','🧠','💪','🎸','🌊','🍀'];

function showAvatarPicker() {
  const existing = document.getElementById('avatarPickerModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'avatarPickerModal';
  modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--card-bg);border:1px solid var(--border);border-radius:16px;padding:24px;width:320px;box-shadow:0 20px 60px rgba(0,0,0,0.5)';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h3 style="margin:0;font-size:1rem">Choose Your Avatar</h3>
      <button onclick="document.getElementById('avatarPickerModal').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.2rem">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">
      ${AVATAR_OPTIONS.map(e => `<button onclick="selectAvatar('${e}')" style="background:rgba(255,255,255,0.05);border:2px solid transparent;border-radius:10px;padding:8px;font-size:1.5rem;cursor:pointer;transition:.2s" onmouseover="this.style.borderColor='var(--indigo)'" onmouseout="this.style.borderColor='transparent'">${e}</button>`).join('')}
    </div>
    <button onclick="selectAvatar('initials')" class="btn btn-ghost btn-sm" style="width:100%;justify-content:center">Use Initials (${USER.name.slice(0,2).toUpperCase()})</button>`;
  const overlay = document.createElement('div');
  overlay.id = 'avatarOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998';
  overlay.onclick = () => { modal.remove(); overlay.remove(); };
  document.body.append(overlay, modal);
}

async function selectAvatar(emoji) {
  document.getElementById('avatarPickerModal')?.remove();
  document.getElementById('avatarOverlay')?.remove();
  const val = emoji === 'initials' ? null : emoji;
  USER.avatar = val;
  localStorage.setItem('sat_nexus_avatar', val || '');
  updateSidebarUser();
  if (USER.mode === 'account') {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) await sb.from('profiles').upsert({ id: session.user.id, avatar: val });
    } catch {}
  }
  showToast('Avatar updated!', 'success', 1500);
}

function renderEmptyDashboard() {
  const chartsRow = document.getElementById('dashChartsRow');
  if (chartsRow) chartsRow.style.display = 'none';

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = USER?.name && !isGuest() ? `, ${USER.name}` : '';
  const greetEl = document.getElementById('dashGreeting');
  const subEl = document.getElementById('dashSubtitle');
  if (greetEl) greetEl.textContent = `${greet}${name} 👋 Let's get to work.`;
  if (subEl) subEl.textContent = 'Complete your first practice session to see your estimated SAT score.';

  const hero = document.getElementById('scoreHero');
  if (hero) hero.innerHTML = `
    <div style="text-align:center;width:100%;padding:20px 0">
      <div style="font-size:3rem;margin-bottom:12px">🎯</div>
      <h2 style="font-size:1.2rem;margin-bottom:8px">Welcome${USER?.name && !isGuest() ? ', ' + USER.name : ''}!</h2>
      <p style="color:var(--text-secondary);margin-bottom:20px">Complete a practice session to see your estimated SAT score here.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="navigateTo('practice')">Start Practice →</button>
        <button class="btn btn-ghost" onclick="navigateTo('roadmap')">Build My Roadmap</button>
      </div>
    </div>
  `;

  const statsGrid = document.getElementById('dashStatsGrid');
  if (statsGrid) statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-icon" style="background:rgba(245,158,11,0.15)">🔥</div><div class="stat-label">Study Streak</div><div class="stat-value" style="color:var(--amber)">0 days</div><div class="stat-change">Start studying to build a streak</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:rgba(34,211,238,0.12)">⏱️</div><div class="stat-label">Time Studied</div><div class="stat-value" style="color:var(--cyan)">0h</div><div class="stat-change">Complete your first session</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:rgba(16,185,129,0.12)">✅</div><div class="stat-label">Questions Done</div><div class="stat-value" style="color:var(--emerald)">0</div><div class="stat-change">Practice to see progress</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:rgba(129,140,248,0.15)">📝</div><div class="stat-label">Tests Completed</div><div class="stat-value" style="color:var(--indigo)">0</div><div class="stat-change">Try a full practice section</div></div>
  `;

  const masteryGrid = document.getElementById('topicMasteryGrid');
  if (masteryGrid) masteryGrid.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:16px 0">Complete practice questions to see your topic mastery here.</div>`;

  const recList = document.getElementById('recommendationsList');
  if (recList) recList.innerHTML = `
    <div class="recommendation-card" onclick="navigateTo('practice')">
      <div class="rec-icon" style="background:rgba(129,140,248,0.12)">✏️</div>
      <div style="flex:1"><div style="font-size:.88rem;font-weight:600;margin-bottom:2px">Start with a Practice Session</div><div style="font-size:.75rem;color:var(--text-muted)">See how you perform across all topics</div></div>
      <span class="badge badge-indigo">Start</span>
    </div>
    <div class="recommendation-card" onclick="navigateTo('videos')">
      <div class="rec-icon" style="background:rgba(34,211,238,0.12)">🎬</div>
      <div style="flex:1"><div style="font-size:.88rem;font-weight:600;margin-bottom:2px">Watch an SAT Strategy Video</div><div style="font-size:.75rem;color:var(--text-muted)">Build your foundational approach</div></div>
      <span class="badge badge-cyan">Watch</span>
    </div>
    <div class="recommendation-card" onclick="navigateTo('roadmap')">
      <div class="rec-icon" style="background:rgba(16,185,129,0.12)">🗺️</div>
      <div style="flex:1"><div style="font-size:.88rem;font-weight:600;margin-bottom:2px">Build Your Study Roadmap</div><div style="font-size:.75rem;color:var(--text-muted)">Set a goal and get a week-by-week plan</div></div>
      <span class="badge badge-emerald">Plan</span>
    </div>
  `;

  const recentEl = document.getElementById('recentActivity');
  if (recentEl) recentEl.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:16px 0">No activity yet. Start studying to see your history here.</div>`;

  renderPracticeHistory();
}

function renderDashboard() {
  const chartsRow = document.getElementById('dashChartsRow');
  if (chartsRow) chartsRow.style.display = '';

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = USER?.name ? `, ${USER.name}` : '';
  const greetEl = document.getElementById('dashGreeting');
  const subEl = document.getElementById('dashSubtitle');
  if (greetEl) greetEl.textContent = `${greet}${name} 👋 Let's get to work.`;
  if (subEl && USER.targetScore && USER.currentScore) {
    const gap = USER.targetScore - USER.currentScore;
    if (subEl) subEl.innerHTML = gap > 0
      ? `You're <strong style="color:var(--indigo)">${gap} points away</strong> from your goal. Here's where to focus today.`
      : `You've hit your target score of ${USER.targetScore}! 🎉 Keep pushing higher.`;
  }

  renderTopicMastery();
  renderRecommendations();
  renderRecentActivity();
  renderPracticeHistory();
  initDashboardCharts();
  animateScoreRing();

  const hero = document.getElementById('scoreHero');
  const score = USER.currentScore || 0;
  const target = USER.targetScore || 1600;
  if (hero) hero.innerHTML = `
    <div class="score-main">
      <div class="score-ring">
        <svg viewBox="0 0 100 100">
          <circle class="ring-track" cx="50" cy="50" r="40"/>
          <circle class="ring-fill" cx="50" cy="50" r="40" stroke-dasharray="251.2" stroke-dashoffset="${251.2 - (251.2 * score/1600)}" id="scoreRing"/>
        </svg>
        <div class="score-center">
          <span class="score-number">${score}</span>
          <span class="score-total">/ 1600</span>
        </div>
      </div>
      <div class="score-details">
        <h2>Estimated SAT Score</h2>
        <p>Based on your practice performance</p>
        <div class="score-target">
          <span class="score-target-label">Target:</span>
          <span class="score-target-value">${target}</span>
          ${USER.testDate ? `<span style="font-size:.75rem;color:var(--text-muted)">· Test: ${new Date(USER.testDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="score-breakdown">
      <div class="score-section-item">
        <div class="score-section-name">Questions Done</div>
        <div class="score-section-val" style="color:var(--cyan)">${USER.questionsAnswered}</div>
      </div>
      <div style="width:1px;background:var(--border)"></div>
      <div class="score-section-item">
        <div class="score-section-name">Accuracy</div>
        <div class="score-section-val" style="color:var(--emerald)">${USER.accuracy !== null ? USER.accuracy + '%' : '—'}</div>
      </div>
      <div style="width:1px;background:var(--border)"></div>
      <div class="score-section-item">
        <div class="score-section-name">Tests Done</div>
        <div class="score-section-val" style="color:var(--indigo)">${USER.testsCompleted}</div>
      </div>
    </div>
  `;

  const statsGrid = document.getElementById('dashStatsGrid');
  if (statsGrid) statsGrid.innerHTML = `
    <div class="stat-card"><div class="stat-icon" style="background:rgba(245,158,11,0.15)">🔥</div><div class="stat-label">Study Streak</div><div class="stat-value gradient-text">${USER.streak} days</div><div class="stat-change">${USER.streak > 0 ? 'Keep it going!' : 'Start a streak today'}</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:rgba(34,211,238,0.12)">⏱️</div><div class="stat-label">Time Studied</div><div class="stat-value" style="color:var(--cyan)">${USER.studyTime}h</div><div class="stat-change">Total study time</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:rgba(16,185,129,0.12)">✅</div><div class="stat-label">Questions Done</div><div class="stat-value" style="color:var(--emerald)">${USER.questionsAnswered}</div><div class="stat-change">Keep practicing!</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:rgba(129,140,248,0.15)">📝</div><div class="stat-label">Tests Completed</div><div class="stat-value" style="color:var(--indigo)">${USER.testsCompleted}</div><div class="stat-change">${USER.testsCompleted === 0 ? 'Try your first test!' : 'Great commitment!'}</div></div>
  `;
}

function animateScoreRing() {
  const ring = document.getElementById('scoreRing');
  if (!ring || !USER?.currentScore) return;
  const final = 251.2 - (251.2 * USER.currentScore / 1600);
  ring.style.strokeDashoffset = '251.2';
  setTimeout(() => { ring.style.transition = 'stroke-dashoffset 1.5s cubic-bezier(0.16,1,0.3,1)'; ring.style.strokeDashoffset = final; }, 300);
}

function renderTopicMastery() {
  const grid = document.getElementById('topicMasteryGrid');
  if (!grid) return;
  const mastery = USER?.topicMastery || {};
  if (Object.keys(mastery).length === 0) {
    grid.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:8px 0">No mastery data yet. Complete practice sessions to see topic-by-topic performance.</div>`;
    return;
  }
  grid.innerHTML = Object.entries(mastery).map(([name, pct]) => `
    <div class="topic-row">
      <span class="topic-name">${name}</span>
      <div class="topic-bar-wrap"><div class="progress-bar thin"><div class="progress-fill" style="width:${pct}%;background:${getTopicColor(pct)}"></div></div></div>
      <span class="topic-pct">${pct}%</span>
    </div>
  `).join('');
}

function getTopicColor(pct) {
  if (pct >= 80) return 'linear-gradient(90deg,#10b981,#22d3ee)';
  if (pct >= 60) return 'linear-gradient(90deg,#818cf8,#a78bfa)';
  if (pct >= 40) return 'linear-gradient(90deg,#f59e0b,#fb7185)';
  return 'linear-gradient(90deg,#fb7185,#a78bfa)';
}

function renderRecommendations() {
  const list = document.getElementById('recommendationsList');
  if (!list) return;
  list.innerHTML = `
    <div class="recommendation-card" onclick="navigateTo('practice')">
      <div class="rec-icon" style="background:rgba(129,140,248,0.12)">✏️</div>
      <div style="flex:1"><div style="font-size:.88rem;font-weight:600;margin-bottom:2px">Daily Practice Session</div><div style="font-size:.75rem;color:var(--text-muted)">20 questions across your weak topics</div></div>
      <span class="badge badge-indigo">Practice</span>
    </div>
    <div class="recommendation-card" onclick="navigateTo('videos')">
      <div class="rec-icon" style="background:rgba(34,211,238,0.12)">🎬</div>
      <div style="flex:1"><div style="font-size:.88rem;font-weight:600;margin-bottom:2px">Desmos Calculator Tricks</div><div style="font-size:.75rem;color:var(--text-muted)">Save 10+ minutes on the math section</div></div>
      <span class="badge badge-cyan">Video</span>
    </div>
    <div class="recommendation-card" onclick="navigateTo('flashcards')">
      <div class="rec-icon" style="background:rgba(16,185,129,0.12)">🃏</div>
      <div style="flex:1"><div style="font-size:.88rem;font-weight:600;margin-bottom:2px">Vocabulary Flashcards</div><div style="font-size:.75rem;color:var(--text-muted)">${SAT_FLASHCARDS.length.toLocaleString()} SAT vocabulary words</div></div>
      <span class="badge badge-emerald">Study</span>
    </div>
    <div class="recommendation-card" onclick="navigateTo('resources')">
      <div class="rec-icon" style="background:rgba(167,139,250,0.12)">🔗</div>
      <div style="flex:1"><div style="font-size:.88rem;font-weight:600;margin-bottom:2px">College Board Bluebook</div><div style="font-size:.75rem;color:var(--text-muted)">Take an official full-length practice test</div></div>
      <span class="badge badge-violet">Official</span>
    </div>
  `;
}

function renderRecentActivity() {
  const el = document.getElementById('recentActivity');
  if (!el) return;
  const sessions = JSON.parse(localStorage.getItem('sat_nexus_sessions') || '[]');
  if (sessions.length === 0) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:16px 0">No activity yet. Your practice history will appear here.</div>`;
    return;
  }
  el.innerHTML = sessions.slice(-5).reverse().map(s => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0">${s.pct >= 80 ? '✅' : s.pct >= 60 ? '📊' : '📉'}</div>
      <div style="flex:1">
        <div style="font-size:.82rem;color:var(--text-primary)">${s.label} — ${s.correct}/${s.total} correct (${s.pct}%)</div>
        <div style="font-size:.7rem;color:var(--text-muted)">${s.date}</div>
      </div>
    </div>
  `).join('');
}

function renderPracticeHistory() {
  const el = document.getElementById('practiceHistory');
  if (!el) return;
  const sessions = JSON.parse(localStorage.getItem('sat_nexus_sessions') || '[]');
  if (sessions.length === 0) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:20px;text-align:center">No practice sessions yet. Start one above!</div>`;
    return;
  }
  el.innerHTML = sessions.slice(-6).reverse().map(s => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;margin-bottom:6px">
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:600;margin-bottom:2px">${s.label}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">${s.date} · ${s.total} questions</div>
      </div>
      <span class="badge badge-indigo">${s.section === 'math' ? 'Math' : s.section === 'reading_writing' ? 'R&W' : 'Mixed'}</span>
      <div style="text-align:right">
        <div style="font-family:'JetBrains Mono',monospace;font-size:.9rem;font-weight:700;color:${s.pct>=80?'#10b981':s.pct>=60?'#f59e0b':'#fb7185'}">${s.pct}%</div>
        <div style="font-size:.7rem;color:var(--text-muted)">${s.correct}/${s.total}</div>
      </div>
    </div>
  `).join('');
}

function saveSession(session) {
  const sessions = JSON.parse(localStorage.getItem('sat_nexus_sessions') || '[]');
  sessions.push(session);
  localStorage.setItem('sat_nexus_sessions', JSON.stringify(sessions));
  // Update user stats
  if (USER) {
    USER.questionsAnswered = (USER.questionsAnswered || 0) + session.total;
    USER.testsCompleted = (USER.testsCompleted || 0) + 1;
    const allSessions = sessions;
    const totalQ = allSessions.reduce((a,s) => a + s.total, 0);
    const totalC = allSessions.reduce((a,s) => a + s.correct, 0);
    USER.accuracy = totalQ > 0 ? Math.round((totalC / totalQ) * 100) : null;
    // Update topic mastery
    if (!USER.topicMastery) USER.topicMastery = {};
    if (session.topicStats) {
      Object.entries(session.topicStats).forEach(([topic, data]) => {
        const prev = USER.topicMastery[topic];
        const newPct = Math.round((data.correct / data.total) * 100);
        USER.topicMastery[topic] = prev !== undefined ? Math.round((prev + newPct) / 2) : newPct;
      });
    }
    // Estimate score from accuracy
    if (USER.accuracy !== null && USER.questionsAnswered >= 5) {
      USER.currentScore = Math.round(400 + (USER.accuracy / 100) * 1200);
    }
    saveUser(USER);
    updateSidebarUser();
  }
}

/* ── Dashboard Charts ───────────────────────────────────────── */
let dashScoreChart, dashAccChart;
function initDashboardCharts() {
  Chart.defaults.color = '#64748b';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

  const scoreCtx = document.getElementById('scoreChart');
  if (scoreCtx && !dashScoreChart) {
    const sessions = JSON.parse(localStorage.getItem('sat_nexus_sessions') || '[]');
    const hasData = sessions.length >= 2;
    dashScoreChart = new Chart(scoreCtx, {
      type: 'line',
      data: {
        labels: hasData ? sessions.map((_, i) => `Session ${i+1}`) : ['Start', 'Now'],
        datasets: [{
          data: hasData ? sessions.map(s => s.pct) : [0, 0],
          borderColor: '#818cf8',
          backgroundColor: 'rgba(129,140,248,0.08)',
          borderWidth: 2.5, fill: true, tension: 0.4,
          pointBackgroundColor: '#818cf8', pointRadius: 4, pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: 'rgba(7,7,26,0.95)', borderColor: 'rgba(129,140,248,0.3)', borderWidth: 1, titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 10 }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 11 }, callback: v => v + '%' }, min: 0, max: 100 }
        }
      }
    });
  }

  const accCtx = document.getElementById('accuracyChart');
  const mastery = USER?.topicMastery || {};
  const topics = Object.keys(mastery).slice(0, 6);
  if (accCtx && !dashAccChart) {
    dashAccChart = new Chart(accCtx, {
      type: 'bar',
      data: {
        labels: topics.length ? topics : ['No data yet'],
        datasets: [{
          data: topics.length ? topics.map(t => mastery[t]) : [0],
          backgroundColor: ['rgba(129,140,248,0.7)', 'rgba(167,139,250,0.7)', 'rgba(251,113,133,0.7)', 'rgba(34,211,238,0.7)', 'rgba(16,185,129,0.7)', 'rgba(245,158,11,0.7)'],
          borderRadius: 6, borderSkipped: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 10 }, callback: v => v+'%' }, max: 100 }
        }
      }
    });
  }
}

/* ── Analytics Charts ──────────────────────────────────────── */
let analyticsScoreChart, analyticsAccChart;
function initAnalyticsCharts() {
  const sessions = JSON.parse(localStorage.getItem('sat_nexus_sessions') || '[]');
  const mastery = USER?.topicMastery || {};

  // Populate top metric cards with real data
  const totalQ    = sessions.reduce((a,s) => a + s.total, 0);
  const totalC    = sessions.reduce((a,s) => a + s.correct, 0);
  const accuracy  = totalQ > 0 ? Math.round(totalC / totalQ * 100) : null;
  const projected = accuracy !== null ? Math.round(400 + (accuracy / 100) * 1200) : null;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('analyticsProjected',     projected !== null ? projected.toString() : '—');
  set('analyticsProjectedSub',  projected !== null ? 'Based on practice accuracy' : 'Complete practice to see');
  set('analyticsAccuracy',      accuracy !== null ? accuracy + '%' : '—');
  set('analyticsAccuracySub',   accuracy !== null ? `${totalC}/${totalQ} correct overall` : 'No sessions yet');
  set('analyticsQCount',        totalQ.toString());
  set('analyticsQCountSub',     totalQ > 0 ? `Across ${sessions.length} session${sessions.length !== 1 ? 's' : ''}` : 'Start practicing!');
  set('analyticsSessions',      sessions.length.toString());
  set('analyticsSessionsSub',   sessions.length >= 7 ? 'Great consistency!' : sessions.length > 0 ? 'Keep it up!' : 'Goal: 1 session/day');

  const scoreCtx = document.getElementById('analyticsScoreChart');
  if (scoreCtx) {
    if (analyticsScoreChart) { analyticsScoreChart.destroy(); analyticsScoreChart = null; }
    analyticsScoreChart = new Chart(scoreCtx, {
      type: 'line',
      data: {
        labels: sessions.length ? sessions.map((_, i) => `S${i+1}`) : ['No data'],
        datasets: [{
          label: 'Accuracy %',
          data: sessions.length ? sessions.map(s => s.pct) : [0],
          borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.06)',
          borderWidth: 2.5, fill: true, tension: 0.4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 10 }, callback: v => v + '%' }, min: 0, max: 100 }
        }
      }
    });
  }

  const accCtx = document.getElementById('analyticsAccuracyChart');
  const topics = Object.keys(mastery);
  if (accCtx) {
    if (analyticsAccChart) { analyticsAccChart.destroy(); analyticsAccChart = null; }
    analyticsAccChart = new Chart(accCtx, {
      type: 'radar',
      data: {
        labels: topics.length ? topics.slice(0,8) : ['Practice to see data'],
        datasets: [{
          label: 'Mastery %',
          data: topics.length ? topics.slice(0,8).map(t => mastery[t]) : [0],
          borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.12)',
          pointBackgroundColor: '#818cf8', borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { grid: { color: 'rgba(255,255,255,0.06)' }, angleLines: { color: 'rgba(255,255,255,0.06)' }, pointLabels: { color: '#64748b', font: { size: 9 } }, ticks: { display: false }, min: 0, max: 100 } }
      }
    });
  }

  renderHeatmap();
  renderMissedTopics();
}

function renderHeatmap() {
  const grid = document.getElementById('heatmapGrid');
  if (!grid) return;
  const sessions = JSON.parse(localStorage.getItem('sat_nexus_sessions') || '[]');
  const levels = Array.from({ length: 28 }, (_, i) => {
    const daysAgo = 27 - i;
    const daySession = sessions.find(s => {
      const d = new Date(s.timestamp || 0);
      const target = new Date(); target.setDate(target.getDate() - daysAgo);
      return d.toDateString() === target.toDateString();
    });
    return daySession ? Math.min(4, Math.ceil(daySession.total / 5)) : 0;
  });
  grid.innerHTML = levels.map(l => `<div class="heatmap-cell" data-level="${l}" title="${l * 5}+ questions"></div>`).join('');
}

function renderMissedTopics() {
  const el = document.getElementById('missedTopics');
  if (!el) return;
  const mastery = USER?.topicMastery || {};
  const sorted = Object.entries(mastery).sort((a, b) => a[1] - b[1]).slice(0, 5);
  if (!sorted.length) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem">Complete practice sessions to see your weakest topics.</div>`;
    return;
  }
  el.innerHTML = sorted.map(([name, pct], i) => `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:.7rem;color:var(--text-muted);width:16px">${i+1}</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:4px"><span>${name}</span><span style="color:var(--rose)">${pct}%</span></div>
        <div class="progress-bar thin"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,#fb7185,#a78bfa)"></div></div>
      </div>
    </div>
  `).join('');
}

/* ── Practice System ────────────────────────────────────────── */
let practiceState = {
  questions: [], current: 0, answers: {}, flags: {},
  timer: null, timeLeft: 0, startTime: null, revealed: {},
  section: 'all', topic: 'all', difficulty: 'all'
};

const TIPS = [
  'Eliminate clearly wrong answers first, then choose the best remaining option.',
  'On R&W passage questions, locate the answer in the text before looking at choices.',
  'Use Desmos to graph both sides of any equation and find where they intersect.',
  'For grammar questions: read the sentence aloud. Errors often sound wrong.',
  'On statistics, know the difference between mean, median, and standard deviation.',
  'Don\'t spend more than 90 seconds on any one question. Flag it and move on.',
  'For vocabulary-in-context, substitute each choice into the sentence and pick what fits best.',
  'In transition questions, identify the logical relationship first: contrast, cause, addition, or example.',
  'In the Digital SAT, you can use Desmos to verify algebra answers instantly.',
  'For hard math, plug the answer choices back into the question to check your work.'
];

/* ── Practice Filter State ──────────────────────────────────── */
const PF_DOMAINS = {
  reading_writing: ['all', 'Information & Ideas', 'Craft & Structure', 'Expression of Ideas', 'Standard English Conventions'],
  math: ['all', 'Algebra', 'Advanced Math', 'Problem Solving & Data Analysis', 'Geometry & Trigonometry'],
  all: ['all']
};

let pfState = { subject: 'all', domain: 'all', difficulty: 'all', count: 10 };

function setPFSubject(val) {
  pfState.subject = val;
  pfState.domain = 'all';
  document.querySelectorAll('.pf-subject').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.val === val);
    b.classList.toggle('btn-ghost', b.dataset.val !== val);
    b.classList.toggle('active', b.dataset.val === val);
  });
  renderDomainChips();
}

function setPFDiff(val) {
  pfState.difficulty = val;
  document.querySelectorAll('.pf-diff').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.val === val);
    b.classList.toggle('btn-ghost', b.dataset.val !== val);
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function setPFCount(val) {
  pfState.count = val;
  document.querySelectorAll('.pf-count').forEach(b => {
    b.classList.toggle('btn-primary', String(b.dataset.val) === String(val));
    b.classList.toggle('btn-ghost', String(b.dataset.val) !== String(val));
    b.classList.toggle('active', String(b.dataset.val) === String(val));
  });
}

function setPFDomain(val) {
  pfState.domain = val;
  document.querySelectorAll('.pf-domain').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.val === val);
    b.classList.toggle('btn-ghost', b.dataset.val !== val);
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function renderDomainChips() {
  const container = document.getElementById('domainBtns');
  if (!container) return;
  const domains = PF_DOMAINS[pfState.subject] || ['all'];
  container.innerHTML = domains.map(d => {
    const label = d === 'all' ? 'All Domains' : d;
    const isActive = d === pfState.domain;
    return `<button class="btn ${isActive ? 'btn-primary' : 'btn-ghost'} btn-sm pf-domain${isActive ? ' active' : ''}" data-val="${d}" onclick="setPFDomain('${d.replace(/'/g,"\\'")}')"> ${label}</button>`;
  }).join('');
}

function launchPractice() {
  startPractice(pfState.subject, pfState.domain === 'all' ? 'all' : pfState.domain, pfState.count, pfState.difficulty);
}

function surprisePractice() {
  const subjects = ['reading_writing', 'math', 'all'];
  const counts = [5, 10, 15, 20];
  const diffs = ['all', 'easy', 'medium', 'hard'];
  const randSubject = subjects[Math.floor(Math.random() * subjects.length)];
  const randCount = counts[Math.floor(Math.random() * counts.length)];
  const randDiff = diffs[Math.floor(Math.random() * diffs.length)];
  const domainsForSubject = PF_DOMAINS[randSubject] || ['all'];
  const randDomain = domainsForSubject[Math.floor(Math.random() * domainsForSubject.length)];

  setPFSubject(randSubject);
  setPFDomain(randDomain);
  setPFDiff(randDiff);
  setPFCount(randCount);
  showToast(`Surprise: ${randSubject === 'all' ? 'Both' : randSubject === 'math' ? 'Math' : 'ELA'} · ${randCount}Q · ${randDiff === 'all' ? 'Any difficulty' : randDiff}`, 'info');
}

function startPractice(section, topic, numQuestions, diffOverride) {
  const diff = diffOverride || 'all';
  practiceState.section = section;
  practiceState.topic = topic;
  practiceState.difficulty = diff;

  let pool = SAT_QUESTIONS.filter(q => {
    if (section !== 'all' && q.section !== section) return false;
    if (topic !== 'all' && q.topic !== topic) return false;
    if (diff !== 'all' && q.difficulty !== diff) return false;
    return true;
  });

  if (pool.length === 0) {
    showToast(`No ${diff} questions found for this topic. Showing all difficulties.`, 'info');
    pool = SAT_QUESTIONS.filter(q => {
      if (section !== 'all' && q.section !== section) return false;
      if (topic !== 'all' && q.topic !== topic) return false;
      return true;
    });
  }
  if (pool.length === 0) pool = SAT_QUESTIONS;

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  practiceState.questions = shuffled.slice(0, Math.min(numQuestions, shuffled.length));
  practiceState.current = 0;
  practiceState.answers = {};
  practiceState.flags = {};
  practiceState.revealed = {};
  practiceState.startTime = Date.now();

  const sLabel = section === 'math' ? 'Math' : section === 'reading_writing' ? 'R&W' : 'Mixed';
  const dLabel = diff === 'all' ? '' : ` · ${diff.charAt(0).toUpperCase()+diff.slice(1)}`;
  document.getElementById('practiceModeName').textContent = `${sLabel}${dLabel} · ${topic !== 'all' ? topic : 'All Topics'}`;

  const totalMins = Math.ceil(practiceState.questions.length * 1.5);
  practiceState.timeLeft = totalMins * 60;
  startTimer();

  document.getElementById('practiceHome').classList.add('hidden');
  document.getElementById('practiceResults').classList.add('hidden');
  document.getElementById('practiceActive').classList.remove('hidden');

  renderQuestion();
  updateNavGrid();
  rotateTip();
}

function renderQuestion() {
  const q = practiceState.questions[practiceState.current];
  if (!q) return;
  const idx   = practiceState.current;
  const total = practiceState.questions.length;

  document.getElementById('progressLabel').textContent = `Q ${idx + 1} of ${total}`;

  document.getElementById('questionMeta').innerHTML = `
    <span class="badge badge-indigo">${q.section === 'math' ? 'Math' : 'R&W'}</span>
    <span class="badge badge-${q.section === 'math' ? 'cyan' : 'violet'}">${q.topic}</span>
    <span class="difficulty-${q.difficulty}">${q.difficulty.charAt(0).toUpperCase()+q.difficulty.slice(1)}</span>
    <span class="question-number">Q ${idx+1} / ${total}</span>
  `;

  const passageEl = document.getElementById('questionPassage');
  if (q.passage) { passageEl.textContent = q.passage; passageEl.style.display = 'block'; }
  else passageEl.style.display = 'none';

  document.getElementById('questionText').textContent = q.text;

  const revealed  = practiceState.revealed[idx];
  const selected  = practiceState.answers[idx];

  document.getElementById('answerChoices').innerHTML = q.choices.map((choice, i) => {
    const letter = ['A','B','C','D'][i];
    let cls = 'answer-choice';
    if (revealed) {
      if (letter === q.answer) cls += ' correct';
      else if (letter === selected) cls += ' incorrect';
    } else if (letter === selected) cls += ' selected';
    return `
      <div class="${cls}" onclick="selectAnswer('${letter}')">
        <div class="choice-letter">${letter}</div>
        <div class="choice-text">${choice.substring(3)}</div>
      </div>`;
  }).join('');

  const expCard = document.getElementById('explanationCard');
  if (revealed) {
    expCard.classList.remove('hidden');
    document.getElementById('explanationText').textContent = q.explanation;
  } else {
    expCard.classList.add('hidden');
  }

  document.getElementById('prevBtn').disabled = idx === 0;
  document.getElementById('nextBtn').textContent = idx === total - 1 ? 'Finish ✓' : 'Next →';
  document.getElementById('flagBtn').style.color = practiceState.flags[idx] ? '#f59e0b' : '';
}

function selectAnswer(letter) {
  const idx = practiceState.current;
  if (practiceState.revealed[idx]) return;
  practiceState.answers[idx] = letter;
  practiceState.revealed[idx] = true;
  renderQuestion();
  updateNavGrid();
  updateSessionProgress();
}

function prevQuestion() { if (practiceState.current > 0) { practiceState.current--; renderQuestion(); updateNavGrid(); } }

function nextQuestion() {
  const total = practiceState.questions.length;
  if (practiceState.current < total - 1) { practiceState.current++; renderQuestion(); updateNavGrid(); }
  else showResults();
}

function toggleFlag() {
  const idx = practiceState.current;
  practiceState.flags[idx] = !practiceState.flags[idx];
  document.getElementById('flagBtn').style.color = practiceState.flags[idx] ? '#f59e0b' : '';
  updateNavGrid();
}

function updateNavGrid() {
  const grid = document.getElementById('questionNavGrid');
  if (!grid) return;
  grid.innerHTML = practiceState.questions.map((_, i) => {
    let cls = 'qnav-btn';
    if (i === practiceState.current) cls += ' active';
    else if (practiceState.answers[i]) cls += ' answered';
    if (practiceState.flags[i]) cls += ' flagged';
    return `<div class="${cls}" onclick="practiceState.current=${i};renderQuestion();updateNavGrid()">${i+1}</div>`;
  }).join('');
}

function updateSessionProgress() {
  const answered = Object.keys(practiceState.answers).length;
  const flagged  = Object.keys(practiceState.flags).filter(k => practiceState.flags[k]).length;
  const total    = practiceState.questions.length;
  document.getElementById('answerCount').textContent = `${answered} answered`;
  document.getElementById('flagCount').textContent   = `${flagged} flagged`;
  document.getElementById('sessionProgress').style.width = `${(answered/total)*100}%`;
}

function startTimer() {
  clearInterval(practiceState.timer);
  updateTimerDisplay();
  practiceState.timer = setInterval(() => {
    practiceState.timeLeft--;
    updateTimerDisplay();
    if (practiceState.timeLeft <= 0) { clearInterval(practiceState.timer); showToast('Time\'s up!', 'info'); showResults(); }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(practiceState.timeLeft / 60);
  const secs = practiceState.timeLeft % 60;
  const el = document.getElementById('timerText');
  const display = document.getElementById('timerDisplay');
  if (el) el.textContent = `${mins}:${secs.toString().padStart(2,'0')}`;
  if (display) {
    display.classList.toggle('warning', practiceState.timeLeft <= 300 && practiceState.timeLeft > 60);
    display.classList.toggle('critical', practiceState.timeLeft <= 60);
  }
}

function showResults() {
  clearInterval(practiceState.timer);
  const qs = practiceState.questions;
  const correct = qs.filter((q, i) => practiceState.answers[i] === q.answer).length;
  const total   = qs.length;
  const pct     = Math.round((correct / total) * 100);
  const elapsed = Math.round((Date.now() - practiceState.startTime) / 1000);
  const avgTime = total > 0 ? Math.round(elapsed / total) : 0;

  // Build topic stats
  const topicStats = {};
  qs.forEach((q, i) => {
    if (!topicStats[q.topic]) topicStats[q.topic] = { correct: 0, total: 0 };
    topicStats[q.topic].total++;
    if (practiceState.answers[i] === q.answer) topicStats[q.topic].correct++;
  });

  // Save session
  saveSession({
    label: document.getElementById('practiceModeName').textContent,
    section: practiceState.section,
    correct, total, pct, avgTime,
    timestamp: Date.now(),
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    topicStats
  });

  document.getElementById('practiceActive').classList.add('hidden');
  document.getElementById('practiceResults').classList.remove('hidden');

  const msgs = pct >= 90 ? 'Outstanding! You\'re crushing it. 🏆' :
               pct >= 80 ? 'Great work! Nearly there. 💪' :
               pct >= 70 ? 'Good progress. Keep practicing. 📈' :
               pct >= 60 ? 'Solid effort. Review your mistakes carefully.' :
                           'Keep going — every session builds your foundation.';

  document.getElementById('resultsScore').textContent = `${pct}%`;
  document.getElementById('resultsMessage').textContent = msgs;
  document.getElementById('resultsSectionLabel').textContent = `${document.getElementById('practiceModeName').textContent} · ${total} Questions`;

  document.getElementById('resultsGrid').innerHTML = [
    { label: 'Correct', val: correct, color: '#10b981' },
    { label: 'Incorrect', val: total - correct, color: '#fb7185' },
    { label: 'Avg. Time', val: `${avgTime}s`, color: '#22d3ee' }
  ].map(s => `<div class="stat-card" style="text-align:center"><div class="stat-value" style="color:${s.color}">${s.val}</div><div class="stat-label" style="margin-top:4px">${s.label}</div></div>`).join('');

  showToast(`Session complete! ${correct}/${total} correct (${pct}%)`, pct >= 70 ? 'success' : 'info');
}

function reviewResults() {
  const reviewEl = document.getElementById('resultsReview');
  reviewEl.innerHTML = `<h3 style="margin-bottom:16px;font-size:1rem">Full Question Review</h3>` +
    practiceState.questions.map((q, i) => {
      const userAns = practiceState.answers[i];
      const correct = userAns === q.answer;
      return `
        <div style="background:${correct?'rgba(16,185,129,0.06)':'rgba(251,113,133,0.06)'};border:1px solid ${correct?'rgba(16,185,129,0.2)':'rgba(251,113,133,0.2)'};border-radius:12px;padding:16px;margin-bottom:12px">
          <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
            <span>${correct ? '✅' : '❌'}</span>
            <span class="badge badge-indigo">${q.topic}</span>
            <span class="difficulty-${q.difficulty}">${q.difficulty}</span>
          </div>
          ${q.passage ? `<div style="font-size:.78rem;color:var(--text-muted);border-left:2px solid var(--border);padding-left:8px;margin-bottom:8px;line-height:1.5">${q.passage.slice(0,200)}${q.passage.length>200?'…':''}</div>` : ''}
          <p style="font-size:.875rem;margin-bottom:10px">${q.text}</p>
          <div style="font-size:.8rem;margin-bottom:8px">
            <span style="color:var(--text-muted)">Your answer: </span>
            <strong style="color:${correct?'#10b981':'#fb7185'}">${userAns || 'Skipped'}</strong>
            ${!correct ? `&nbsp;&nbsp;<span style="color:var(--text-muted)">Correct: </span><strong style="color:#10b981">${q.answer}</strong>` : ''}
          </div>
          <div style="font-size:.8rem;color:var(--text-secondary);padding:8px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid ${correct?'#10b981':'#818cf8'}">${q.explanation}</div>
        </div>`;
    }).join('');
}

function endPractice() {
  clearInterval(practiceState.timer);
  document.getElementById('practiceHome').classList.remove('hidden');
  document.getElementById('practiceActive').classList.add('hidden');
  document.getElementById('practiceResults').classList.add('hidden');
  renderPracticeHistory();
}

function rotateTip() {
  const el = document.getElementById('practiceTip');
  if (el) el.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}

/* ── Flashcards ──────────────────────────────────────────────── */
const FC_PROGRESS_KEY = 'sat_nexus_flashcard_progress';
let fcProgressCache = null;

let cardState = { cards: [...SAT_FLASHCARDS], current: 0, flipped: false };

function getWordDifficulty(word) {
  const l = word.length;
  return l <= 6 ? 'easy' : l <= 9 ? 'medium' : 'hard';
}

async function initFlashcardProgress() {
  if (fcProgressCache !== null) return;
  if (USER.mode === 'account') {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { data } = await sb.from('profiles').select('flashcard_progress').eq('id', session.user.id).single();
        if (data?.flashcard_progress && Object.keys(data.flashcard_progress).length > 0) {
          fcProgressCache = data.flashcard_progress;
          localStorage.setItem(FC_PROGRESS_KEY, JSON.stringify(fcProgressCache));
          return;
        }
      }
    } catch {}
  }
  try { fcProgressCache = JSON.parse(localStorage.getItem(FC_PROGRESS_KEY) || '{}'); } catch { fcProgressCache = {}; }
}

function loadCardProgress() {
  return fcProgressCache || {};
}

async function saveCardProgress(word, status) {
  const p = loadCardProgress();
  p[word] = status;
  fcProgressCache = p;
  localStorage.setItem(FC_PROGRESS_KEY, JSON.stringify(p));
  if (USER.mode === 'account') {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) await sb.from('profiles').upsert({ id: session.user.id, flashcard_progress: p });
    } catch {}
  }
}

function getCardProgressCounts() {
  const p = loadCardProgress();
  const vals = Object.values(p);
  return {
    correct:   vals.filter(v => v === 'correct').length,
    incorrect: vals.filter(v => v === 'incorrect').length
  };
}

function renderCard() {
  const card = cardState.cards[cardState.current];
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

  // Always update the all-time counts
  const counts = getCardProgressCounts();
  set('gotItCount', counts.correct);
  set('hardCount',  counts.incorrect);

  if (!card) {
    set('flashcardCounter', '0 cards');
    set('remainingCount', '0');
    const fc = document.getElementById('flashcard');
    if (fc) fc.style.display = 'none';
    const empty = document.getElementById('fcEmptyState');
    if (empty) empty.style.display = 'flex';
    const progBar = document.getElementById('flashcardProgress');
    if (progBar) progBar.style.width = '0%';
    return;
  }
  const fc2 = document.getElementById('flashcard');
  if (fc2) fc2.style.display = '';
  const empty2 = document.getElementById('fcEmptyState');
  if (empty2) empty2.style.display = 'none';

  set('cardWord', card.word);
  set('cardPronunciation', card.pronunciation || '');
  set('cardDefinition', card.definition);
  set('cardExample', `"${card.example}"`);

  const diff = getWordDifficulty(card.word);
  const prog = loadCardProgress();
  const wordStatus = prog[card.word];
  const statusBadge = wordStatus === 'correct'
    ? `<span style="background:rgba(16,185,129,0.15);color:var(--emerald);padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:600;margin-left:8px">✓ Known</span>`
    : wordStatus === 'incorrect'
      ? `<span style="background:rgba(251,113,133,0.15);color:var(--rose);padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:600;margin-left:8px">✕ Review</span>`
      : '';
  setHTML('cardDifficulty', `<span class="difficulty-${diff}">${diff.charAt(0).toUpperCase()+diff.slice(1)}</span>${statusBadge}`);

  set('flashcardCounter', `Card ${cardState.current + 1} of ${cardState.cards.length}`);
  const lbl = document.getElementById('flashcardTotalLabel');
  if (lbl) lbl.textContent = SAT_FLASHCARDS.length.toLocaleString();
  const progBar = document.getElementById('flashcardProgress');
  if (progBar) progBar.style.width = `${((cardState.current + 1) / cardState.cards.length) * 100}%`;
  const fc = document.getElementById('flashcard');
  if (fc) { cardState.flipped = false; fc.classList.remove('flipped'); }
  set('remainingCount', cardState.cards.length);
}

function flipCard()  { cardState.flipped = !cardState.flipped; document.getElementById('flashcard').classList.toggle('flipped', cardState.flipped); }

function nextCard() {
  if (cardState.current < cardState.cards.length - 1) { cardState.current++; renderCard(); }
  else { showToast('End of deck!', 'info'); cardState.current = 0; renderCard(); }
}

function prevCard() { if (cardState.current > 0) { cardState.current--; renderCard(); } }

async function markCard(status) {
  const card = cardState.cards[cardState.current];
  if (!card) return;
  await saveCardProgress(card.word, status === 'easy' ? 'correct' : 'incorrect');
  if (status === 'easy') showToast(`✓ Marked "${card.word}" as known`, 'success', 1200);
  else showToast(`✕ Marked "${card.word}" for review`, 'info', 1200);
  nextCard();
}

function shuffleCards() { cardState.cards.sort(() => Math.random() - 0.5); cardState.current = 0; renderCard(); showToast('Cards shuffled!', 'info', 1500); }

async function resetCardProgress() {
  if (!confirm('Reset ALL flashcard progress? Your "Got Right" and "Got Wrong" history will be cleared.')) return;
  fcProgressCache = {};
  localStorage.removeItem(FC_PROGRESS_KEY);
  if (USER.mode === 'account') {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session) await sb.from('profiles').upsert({ id: session.user.id, flashcard_progress: {} });
    } catch {}
  }
  showToast('Flashcard progress reset!', 'info');
  applyCardFilter();
}

let cardFilter = { difficulty: 'all', letter: 'all', status: 'all' };

function applyCardFilter() {
  const letterRanges = { 'a-h': ['a','h'], 'i-p': ['i','p'], 'q-z': ['q','z'] };
  const progress = loadCardProgress();
  cardState.cards = SAT_FLASHCARDS.filter(c => {
    const diff  = getWordDifficulty(c.word);
    const first = c.word[0].toLowerCase();
    const wStatus = progress[c.word] || 'unseen';
    const diffOk   = cardFilter.difficulty === 'all' || diff === cardFilter.difficulty;
    const statusOk = cardFilter.status === 'all'
      || (cardFilter.status === 'unseen'    && wStatus === 'unseen')
      || (cardFilter.status === 'correct'   && wStatus === 'correct')
      || (cardFilter.status === 'incorrect' && wStatus === 'incorrect');
    let letterOk = true;
    if (cardFilter.letter !== 'all') {
      if (letterRanges[cardFilter.letter]) {
        const [lo, hi] = letterRanges[cardFilter.letter];
        letterOk = first >= lo && first <= hi;
      } else {
        letterOk = first === cardFilter.letter;
      }
    }
    return diffOk && statusOk && letterOk;
  });
  cardState.current = 0;
  renderCard();
  showToast(`Showing ${cardState.cards.length} word${cardState.cards.length !== 1 ? 's' : ''}`, 'info', 1200);
}

function setStatusFilter(status, btn) {
  document.querySelectorAll('.status-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  cardFilter.status = status;
  applyCardFilter();
}

function setDiffFilter(diff, btn) {
  document.querySelectorAll('.diff-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  cardFilter.difficulty = diff;
  applyCardFilter();
}

function setLetterFilter(letter, btn) {
  document.querySelectorAll('.letter-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // If a range chip was clicked, reset the dropdown; if dropdown was used, deactivate range chips
  if (!btn) { document.querySelectorAll('.letter-chip').forEach(c => c.classList.remove('active')); }
  cardFilter.letter = letter;
  applyCardFilter();
}

/* ── Resources ───────────────────────────────────────────────── */
function renderResources(filterType, filterSource) {
  const grid = document.getElementById('resourceGrid');
  if (!grid) return;
  let filtered = SAT_RESOURCES;
  if (filterType && filterType !== 'all') filtered = filtered.filter(r => r.type === filterType);
  if (filterSource) filtered = filtered.filter(r => r.source === filterSource);

  grid.innerHTML = filtered.map(r => `
    <div class="resource-card" onclick="openResource('${r.id}')">
      <div class="resource-card-top">
        <div class="resource-source-icon" style="background:${getSourceColor(r.source)}">${r.icon}</div>
        <div>
          <div class="resource-title">${r.title}</div>
          <div class="resource-desc">${r.desc}</div>
          ${r.note ? `<div style="font-size:.72rem;color:var(--amber);margin-top:4px">⚠️ ${r.note}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        ${r.sections.map(s => `<span class="badge badge-indigo">${s === 'math' ? 'Math' : 'R&W'}</span>`).join('')}
        <span class="badge badge-${r.improvement === 'Very High' ? 'emerald' : r.improvement === 'High' ? 'cyan' : 'amber'}">${r.improvement} Impact</span>
      </div>
      <div class="resource-footer">
        <div class="resource-meta">
          <span class="resource-rating">★ ${r.rating}</span>
          <span class="resource-type-tag">${r.type}</span>
          <span style="font-size:.7rem;color:var(--text-muted)">${r.source}</span>
        </div>
        <span class="badge ${r.free ? 'badge-emerald' : 'badge-amber'}">${r.free ? 'Free' : 'Paid'}</span>
      </div>
    </div>
  `).join('') || `<div style="color:var(--text-muted);padding:32px;grid-column:1/-1;text-align:center">No resources match this filter.</div>`;
}

function getSourceColor(source) {
  const m = { 'Khan Academy':'rgba(16,185,129,0.12)', 'College Board':'rgba(129,140,248,0.12)', 'Desmos':'rgba(34,211,238,0.12)', 'PrepScholar':'rgba(167,139,250,0.12)', 'Magoosh':'rgba(245,158,11,0.12)', 'Albert.io':'rgba(251,113,133,0.12)', 'Barrons':'rgba(129,140,248,0.1)', 'Princeton Review':'rgba(251,113,133,0.1)', 'Ivy Lounge':'rgba(34,211,238,0.1)' };
  return m[source] || 'rgba(255,255,255,0.06)';
}

function openResource(id) {
  const r = SAT_RESOURCES.find(x => x.id === id);
  if (!r) return;
  if (r.url && r.url !== '#') window.open(r.url, '_blank');
  else showToast('Link coming soon.', 'info');
}

document.getElementById('resourceFilters')?.addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('#resourceFilters .filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  renderResources(chip.dataset.filter, chip.dataset.source || null);
});

/* ── Full Practice Test Engine ──────────────────────────────── */
const FT_MODULES = [
  { label: 'Module 1 — Reading & Writing', section: 'reading_writing', count: 27, minutes: 32, difficulty: 'easy' },
  { label: 'Module 2 — Reading & Writing', section: 'reading_writing', count: 27, minutes: 32, difficulty: 'medium' },
  { label: 'Module 1 — Math',             section: 'math',            count: 22, minutes: 35, difficulty: 'easy' },
  { label: 'Module 2 — Math',             section: 'math',            count: 22, minutes: 35, difficulty: 'hard'  }
];

let ftState = null;
let ftTimerInterval = null;

function initFullTestPage() {
  document.getElementById('fulltestHub').style.display = '';
  document.getElementById('fulltestActive').style.display = 'none';
  document.getElementById('fulltestReport').style.display = 'none';
  showFTTab('official');
  renderFTHistory();
}

function showFTTab(tab) {
  const isOfficial = tab === 'official';
  const offBtn  = document.getElementById('ftTabOfficial');
  const genBtn  = document.getElementById('ftTabGenerated');
  const offPanel = document.getElementById('ftPanelOfficial');
  const genPanel = document.getElementById('ftPanelGenerated');
  if (offPanel) offPanel.style.display = isOfficial ? '' : 'none';
  if (genPanel) genPanel.style.display = isOfficial ? 'none' : '';
  if (offBtn) {
    offBtn.style.background = isOfficial ? 'linear-gradient(135deg,var(--indigo),var(--violet))' : 'transparent';
    offBtn.style.color      = isOfficial ? '#fff' : 'var(--text-secondary)';
  }
  if (genBtn) {
    genBtn.style.background = isOfficial ? 'transparent' : 'linear-gradient(135deg,var(--indigo),var(--violet))';
    genBtn.style.color      = isOfficial ? 'var(--text-secondary)' : '#fff';
  }
}

function renderFTHistory() {
  const el = document.getElementById('fulltestHistory');
  if (!el) return;
  const results = JSON.parse(localStorage.getItem('sat_nexus_fulltests') || '[]');
  if (!results.length) {
    el.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;padding:16px 0">No completed tests yet. Start your first one above!</div>`;
    return;
  }
  el.innerHTML = results.slice().reverse().slice(0, 5).map(r => `
    <div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;margin-bottom:8px">
      <div style="flex:1">
        <div style="font-size:.87rem;font-weight:600;margin-bottom:2px">Practice Test ${r.testNum}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">${r.date}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'JetBrains Mono',monospace;font-size:1.3rem;font-weight:800;background:linear-gradient(135deg,#818cf8,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${r.total}</div>
        <div style="font-size:.7rem;color:var(--text-muted)">R&W: ${r.rw} · Math: ${r.math}</div>
      </div>
    </div>
  `).join('');
}

function startFullTest(testNum) {
  // Build question bank for each module — use a deterministic seed based on testNum
  const allRW   = SAT_QUESTIONS.filter(q => q.section === 'reading_writing');
  const allMath = SAT_QUESTIONS.filter(q => q.section === 'math');

  const pick = (arr, diff, n, offset) => {
    const pool = diff === 'easy'
      ? arr.filter(q => q.difficulty === 'easy')
      : diff === 'medium'
        ? arr.filter(q => q.difficulty !== 'hard')
        : arr;
    // Deterministic shuffle using testNum + offset
    const shuffled = pool.slice().sort((a, b) => {
      const ha = simpleHash(a.id + testNum + offset);
      const hb = simpleHash(b.id + testNum + offset);
      return ha - hb;
    });
    return shuffled.slice(0, Math.min(n, shuffled.length));
  };

  const modules = [
    { ...FT_MODULES[0], questions: pick(allRW,   'easy',   27, 0) },
    { ...FT_MODULES[1], questions: pick(allRW,   'medium', 27, 1) },
    { ...FT_MODULES[2], questions: pick(allMath, 'easy',   22, 2) },
    { ...FT_MODULES[3], questions: pick(allMath, 'hard',   22, 3) }
  ];

  ftState = {
    testNum,
    modules,
    moduleIdx: 0,
    questionIdx: 0,
    answers: modules.map(m => new Array(m.questions.length).fill(null)),
    revealed: modules.map(m => new Array(m.questions.length).fill(false)),
    flags: modules.map(m => new Array(m.questions.length).fill(false)),
    timeLeft: modules[0].minutes * 60,
    paused: false,
    startTime: Date.now()
  };

  document.getElementById('fulltestHub').style.display = 'none';
  document.getElementById('fulltestActive').style.display = '';
  document.getElementById('fulltestReport').style.display = 'none';

  ftRenderQuestion();
  ftStartTimer();
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function ftStartTimer() {
  clearInterval(ftTimerInterval);
  ftTimerInterval = setInterval(() => {
    if (ftState.paused) return;
    ftState.timeLeft--;
    const el = document.getElementById('ftTimer');
    if (!el) return;
    const m = Math.floor(ftState.timeLeft / 60);
    const s = ftState.timeLeft % 60;
    el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (ftState.timeLeft <= 60) el.style.color = 'var(--rose)';
    else if (ftState.timeLeft <= 300) el.style.color = 'var(--amber)';
    else el.style.color = 'var(--emerald)';
    if (ftState.timeLeft <= 0) ftTimeUp();
  }, 1000);
}

function ftTimeUp() {
  clearInterval(ftTimerInterval);
  showToast("Time's up for this module!", 'info', 3000);
  setTimeout(() => ftAdvanceModule(), 1500);
}

function pauseFullTest() {
  if (!ftState) return;
  ftState.paused = !ftState.paused;
  const btn = document.getElementById('ftPauseBtn');
  if (btn) btn.textContent = ftState.paused ? '▶ Resume' : '⏸ Pause';
  if (!ftState.paused) ftStartTimer();
}

function quitFullTest() {
  if (!confirm('Quit this test? Your progress will be lost.')) return;
  clearInterval(ftTimerInterval);
  ftState = null;
  initFullTestPage();
}

function ftRenderQuestion() {
  if (!ftState) return;
  const mod = ftState.modules[ftState.moduleIdx];
  const q   = mod.questions[ftState.questionIdx];
  if (!q) return;

  const total = mod.questions.length;
  const idx   = ftState.questionIdx;
  const pct   = ((idx) / total) * 100;

  document.getElementById('ftModuleLabel').textContent    = mod.label;
  document.getElementById('ftProgressLabel').textContent  = `Question ${idx + 1} of ${total}`;
  document.getElementById('ftProgressBar').style.width    = pct + '%';

  document.getElementById('ftQuestionMeta').innerHTML = `
    <span class="badge badge-${mod.section === 'math' ? 'indigo' : 'violet'}">${mod.section === 'math' ? 'Math' : 'R&W'}</span>
    <span class="badge badge-${mod.section === 'math' ? 'cyan' : 'indigo'}">${q.topic}</span>
    <span class="difficulty-${q.difficulty}">${q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)}</span>
  `;

  const passageEl = document.getElementById('ftPassage');
  if (q.passage) { passageEl.textContent = q.passage; passageEl.style.display = 'block'; }
  else { passageEl.style.display = 'none'; }

  document.getElementById('ftQuestionText').textContent = q.text;

  const revealed = ftState.revealed[ftState.moduleIdx][idx];
  const selected = ftState.answers[ftState.moduleIdx][idx];

  document.getElementById('ftAnswerChoices').innerHTML = q.choices.map((choice, i) => {
    const letter = ['A','B','C','D'][i];
    let cls = 'answer-choice';
    if (revealed) {
      if (letter === q.answer)  cls += ' correct';
      else if (letter === selected) cls += ' incorrect';
    } else if (letter === selected) cls += ' selected';
    return `<div class="${cls}" onclick="ftSelectAnswer('${letter}')">
      <div class="choice-letter">${letter}</div>
      <div class="choice-text">${choice.substring(3)}</div>
    </div>`;
  }).join('');

  const expCard = document.getElementById('ftExplanationCard');
  if (revealed) {
    expCard.classList.remove('hidden');
    document.getElementById('ftExplanationText').textContent = q.explanation;
  } else {
    expCard.classList.add('hidden');
  }

  document.getElementById('ftPrevBtn').disabled = idx === 0 && ftState.moduleIdx === 0;
  document.getElementById('ftFlagBtn').style.color = ftState.flags[ftState.moduleIdx][idx] ? '#f59e0b' : '';

  const isLastQ  = idx === total - 1;
  const isLastMod = ftState.moduleIdx === ftState.modules.length - 1;
  const nextBtn  = document.getElementById('ftNextBtn');
  if (isLastQ && isLastMod) nextBtn.textContent = 'Finish Test ✓';
  else if (isLastQ) nextBtn.textContent = 'Next Module →';
  else nextBtn.textContent = 'Next →';
}

function ftSelectAnswer(letter) {
  if (!ftState) return;
  const mIdx = ftState.moduleIdx;
  const qIdx = ftState.questionIdx;
  if (ftState.revealed[mIdx][qIdx]) return;
  ftState.answers[mIdx][qIdx] = letter;
  ftState.revealed[mIdx][qIdx] = true;
  ftRenderQuestion();
}

function ftPrevQ() {
  if (!ftState) return;
  if (ftState.questionIdx > 0) {
    ftState.questionIdx--;
    ftRenderQuestion();
  }
}

function ftNextQ() {
  if (!ftState) return;
  const mod   = ftState.modules[ftState.moduleIdx];
  const isLast = ftState.questionIdx === mod.questions.length - 1;

  if (isLast) {
    ftAdvanceModule();
  } else {
    ftState.questionIdx++;
    ftRenderQuestion();
  }
}

function ftFlagQ() {
  if (!ftState) return;
  const m = ftState.moduleIdx;
  const q = ftState.questionIdx;
  ftState.flags[m][q] = !ftState.flags[m][q];
  ftRenderQuestion();
}

function ftAdvanceModule() {
  clearInterval(ftTimerInterval);
  if (!ftState) return;

  if (ftState.moduleIdx < ftState.modules.length - 1) {
    ftState.moduleIdx++;
    ftState.questionIdx = 0;
    ftState.timeLeft = ftState.modules[ftState.moduleIdx].minutes * 60;
    const timerEl = document.getElementById('ftTimer');
    if (timerEl) timerEl.style.color = 'var(--emerald)';
    ftRenderQuestion();
    ftStartTimer();
    showToast(`Starting ${ftState.modules[ftState.moduleIdx].label}`, 'info', 3000);
  } else {
    ftFinishTest();
  }
}

function ftFinishTest() {
  clearInterval(ftTimerInterval);
  if (!ftState) return;

  // Compute scores per module
  const modScores = ftState.modules.map((mod, mIdx) => {
    let correct = 0;
    mod.questions.forEach((q, qIdx) => {
      if (ftState.answers[mIdx][qIdx] === q.answer) correct++;
    });
    return { correct, total: mod.questions.length, pct: Math.round(correct / mod.questions.length * 100) };
  });

  // R&W score (modules 0 + 1): scale 200-800
  const rwCorrect = modScores[0].correct + modScores[1].correct;
  const rwTotal   = modScores[0].total   + modScores[1].total;
  const rwPct     = rwCorrect / rwTotal;
  const rwScore   = Math.round(200 + rwPct * 600 / 10) * 10;

  // Math score (modules 2 + 3): scale 200-800
  const mCorrect  = modScores[2].correct + modScores[3].correct;
  const mTotal    = modScores[2].total   + modScores[3].total;
  const mPct      = mCorrect / mTotal;
  const mScore    = Math.round(200 + mPct * 600 / 10) * 10;

  const totalScore = rwScore + mScore;

  // Save result
  const result = {
    testNum: ftState.testNum,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    total: totalScore, rw: rwScore, math: mScore
  };
  const results = JSON.parse(localStorage.getItem('sat_nexus_fulltests') || '[]');
  results.push(result);
  localStorage.setItem('sat_nexus_fulltests', JSON.stringify(results));

  // Update user stats
  if (USER) {
    USER.testsCompleted = (USER.testsCompleted || 0) + 1;
    USER.currentScore   = totalScore;
    saveUser(USER);
    updateSidebarUser();
  }

  // Render report
  document.getElementById('fulltestActive').style.display  = 'none';
  document.getElementById('fulltestReport').style.display  = '';

  document.getElementById('ftTotalScore').textContent = totalScore;
  document.getElementById('ftRWScore').textContent    = rwScore;
  document.getElementById('ftMathScore').textContent  = mScore;

  document.getElementById('ftModuleBreakdown').innerHTML = ftState.modules.map((mod, mIdx) => {
    const s = modScores[mIdx];
    const color = s.pct >= 80 ? 'var(--emerald)' : s.pct >= 60 ? 'var(--amber)' : 'var(--rose)';
    return `<div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:12px;padding:16px">
      <div style="font-size:.7rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${mod.label}</div>
      <div style="font-size:1.8rem;font-weight:800;color:${color};margin-bottom:4px">${s.pct}%</div>
      <div style="font-size:.78rem;color:var(--text-muted)">${s.correct} / ${s.total} correct</div>
      <div style="margin-top:8px;background:rgba(255,255,255,0.06);border-radius:6px;height:6px;overflow:hidden">
        <div style="height:100%;background:${color};width:${s.pct}%;border-radius:6px;transition:width 1s ease"></div>
      </div>
    </div>`;
  }).join('');

  // Wrong answers
  const wrong = [];
  ftState.modules.forEach((mod, mIdx) => {
    mod.questions.forEach((q, qIdx) => {
      if (ftState.answers[mIdx][qIdx] !== q.answer) {
        wrong.push({ q, chosen: ftState.answers[mIdx][qIdx], mod: mod.label });
      }
    });
  });

  document.getElementById('ftWrongCount').textContent = `${wrong.length} missed`;
  document.getElementById('ftWrongList').innerHTML = wrong.slice(0, 10).map(w => `
    <div style="background:rgba(251,113,133,0.05);border:1px solid rgba(251,113,133,0.15);border-radius:12px;padding:14px">
      <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:6px">${w.mod}</div>
      <div style="font-size:.88rem;font-weight:500;margin-bottom:10px;line-height:1.5">${w.q.text.slice(0, 120)}${w.q.text.length > 120 ? '…' : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="background:rgba(251,113,133,0.15);color:var(--rose);padding:3px 10px;border-radius:6px;font-size:.78rem">Your answer: ${w.chosen || 'skipped'}</span>
        <span style="background:rgba(16,185,129,0.15);color:var(--emerald);padding:3px 10px;border-radius:6px;font-size:.78rem">Correct: ${w.q.answer}</span>
      </div>
      <div style="font-size:.78rem;color:var(--text-muted);line-height:1.5">${w.q.explanation}</div>
    </div>
  `).join('');

  if (wrong.length > 10) {
    document.getElementById('ftWrongList').innerHTML += `<div style="font-size:.8rem;color:var(--text-muted);text-align:center;padding:8px">And ${wrong.length - 10} more — retake the test to review all.</div>`;
  }
}

/* ── Videos ──────────────────────────────────────────────────── */
function renderVideos(filter) {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;
  const filtered = filter === 'all'
    ? SAT_VIDEOS
    : filter === 'strategy'
      ? SAT_VIDEOS.filter(v => v.section === 'all')
      : SAT_VIDEOS.filter(v => v.section === filter);
  const colors   = { K:'#10b981', S:'#818cf8', P:'#a78bfa', B:'#f472b6', D:'#22d3ee' };

  grid.innerHTML = filtered.map(v => `
    <div class="video-card" onclick="openVideo('${v.id}')">
      <div class="video-thumb" style="position:relative;overflow:hidden;background:#0a0a1a">
        <img
          src="https://img.youtube.com/vi/${v.videoId}/maxresdefault.jpg"
          onerror="this.src='https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg';this.onerror=null"
          alt="${v.title.replace(/"/g,'&quot;')}"
          style="width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s ease"
          class="video-thumb-img"
        />
        <div class="video-play-overlay"><div class="play-btn-large"><svg width="20" height="20" viewBox="0 0 20 20" fill="white"><path d="M7 5l10 5-10 5V5z"/></svg></div></div>
        <div class="video-duration">${v.duration}</div>
      </div>
      <div class="video-info">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:22px;height:22px;border-radius:50%;background:${colors[v.channelAvatar]||'#818cf8'};display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff;flex-shrink:0">${v.channelAvatar}</div>
          <span class="video-channel">${v.channel}</span>
          <span style="margin-left:auto;font-size:.7rem;color:var(--text-muted)">${v.views} views</span>
        </div>
        <div class="video-title">${v.title}</div>
        <div class="video-tags" style="margin-top:8px">
          <span class="badge badge-${v.section==='math'?'indigo':'violet'}" style="font-size:.65rem">${v.section==='math'?'Math':v.section==='reading_writing'?'R&W':'All'}</span>
          <span class="difficulty-${v.difficulty}" style="font-size:.65rem">${v.difficulty}</span>
          <span style="font-size:.7rem;color:var(--amber)">★ ${v.rating}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function openVideo(id) {
  const v = SAT_VIDEOS.find(x => x.id === id);
  if (!v) return;
  document.getElementById('modalTitle').textContent = v.title;
  document.getElementById('modalMeta').textContent  = `${v.channel} · ${v.duration} · ${v.views} views`;
  document.getElementById('modalDesc').textContent  = v.description;
  document.getElementById('modalTags').innerHTML =
    `<span class="badge badge-indigo">${v.section==='math'?'Math':v.section==='reading_writing'?'R&W':'All'}</span>
     <span class="badge badge-violet">${v.topic}</span>
     <span class="difficulty-${v.difficulty}">${v.difficulty}</span>
     <span style="font-size:.7rem;color:var(--amber)">★ ${v.rating}</span>`;
  document.getElementById('modalTimestamps').innerHTML = v.timestamps
    ? `<div style="font-size:.8rem;font-weight:600;margin-bottom:8px;color:var(--text-secondary)">Key Timestamps</div>` +
      v.timestamps.map(t => `<div style="font-size:.78rem;color:var(--text-muted);padding:3px 0;font-family:'JetBrains Mono',monospace">${t}</div>`).join('') : '';
  document.getElementById('videoIframe').src = `https://www.youtube.com/embed/${v.videoId}?autoplay=1&rel=0&modestbranding=1`;
  document.getElementById('videoModal').classList.add('active');
}

function closeVideoModal() {
  document.getElementById('videoModal').classList.remove('active');
  document.getElementById('videoIframe').src = '';
}

document.getElementById('videoFilters')?.addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  document.querySelectorAll('#videoFilters .filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  renderVideos(chip.dataset.filter || 'all');
});

document.getElementById('videoModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('videoModal')) closeVideoModal();
});

/* ── Formulas ────────────────────────────────────────────────── */
function renderFormulas(filter = '') {
  const container = document.getElementById('formulaContent');
  if (!container) return;
  const f = filter.toLowerCase();
  let html = '';
  for (const [cat, formulas] of Object.entries(SAT_FORMULAS)) {
    const shown = formulas.filter(x => !f || x.name.toLowerCase().includes(f) || x.expr.toLowerCase().includes(f) || x.note.toLowerCase().includes(f));
    if (!shown.length) continue;
    html += `
      <div class="formula-section">
        <h3>${cat}</h3>
        <div class="formula-grid">
          ${shown.map(x => `
            <div class="formula-card">
              <div class="formula-name">${x.name}</div>
              <div class="formula-expr">${x.expr}</div>
              <div class="formula-note">${x.note}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }
  container.innerHTML = html || `<div style="color:var(--text-muted);padding:24px">No formulas match "${filter}".</div>`;
}

function filterFormulas(val) { renderFormulas(val.toLowerCase()); }

/* ── Roadmap ─────────────────────────────────────────────────── */
function initRoadmapDefaults() {
  const dateInput = document.getElementById('testDate');
  if (dateInput && !dateInput.value) {
    const d = new Date(); d.setDate(d.getDate() + 70);
    dateInput.valueAsDate = d;
  }
  if (USER?.currentScore) document.getElementById('currentScore').value = USER.currentScore;
  if (USER?.targetScore)  document.getElementById('targetScore').value  = USER.targetScore;
  if (USER?.testDate)     document.getElementById('testDate').value     = USER.testDate;
}

function buildRoadmap() {
  const current = parseInt(document.getElementById('currentScore').value) || null;
  const target  = parseInt(document.getElementById('targetScore').value)  || null;
  const date    = document.getElementById('testDate').value;
  const hours   = parseInt(document.getElementById('weeklyHours').value) || 8;

  if (!current) { showToast('Please enter your current score.', 'error'); return; }
  if (!target)  { showToast('Please enter your target score.', 'error'); return; }
  if (current >= target) { showToast('Your target score must be higher than your current score.', 'error'); return; }
  if (!date) { showToast('Please select a test date.', 'error'); return; }

  const roadmap = generateRoadmap(current, target, date, hours);

  document.getElementById('roadmapSetup').classList.add('hidden');
  document.getElementById('roadmapDisplay').classList.remove('hidden');
  document.getElementById('roadmapHeadline').textContent = `Your ${roadmap.weeksLeft}-Week Roadmap`;
  document.getElementById('roadmapSubline').textContent  = `${current} → ${target} · ${roadmap.weeksLeft} weeks · ${hours}h/week`;

  document.getElementById('roadmapStats').innerHTML = [
    { label: 'Points to Gain',   val: `+${roadmap.scoreDiff}`, color: 'var(--indigo)' },
    { label: 'Weeks Available',  val: roadmap.weeksLeft,        color: 'var(--cyan)' },
    { label: 'Total Study Hours',val: `${roadmap.totalHours}h`, color: 'var(--emerald)' },
    { label: 'Points / Week',    val: `+${Math.round(roadmap.scoreDiff / roadmap.weeksLeft)}`, color: 'var(--violet)' }
  ].map(s => `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value" style="color:${s.color}">${s.val}</div></div>`).join('');

  document.getElementById('roadmapTimeline').innerHTML = roadmap.weeks.map(w => `
    <div class="roadmap-week ${w.completed ? 'completed' : w.current ? 'current' : ''}">
      <div class="week-header">
        <div class="week-title">${w.title}</div>
        <div class="week-dates">${w.startDate} — ${w.endDate}</div>
      </div>
      <div class="week-tasks">
        ${w.tasks.map(t => `<div class="week-task"><span class="task-icon">${t.icon}</span><span>${t.text}</span></div>`).join('')}
      </div>
    </div>`).join('');

  showToast(`Roadmap generated! ${roadmap.weeksLeft} weeks to ${target}.`, 'success');
}

function resetRoadmap() {
  document.getElementById('roadmapSetup').classList.remove('hidden');
  document.getElementById('roadmapDisplay').classList.add('hidden');
}

/* ── Leaderboard — empty until populated ─────────────────────── */
function renderLeaderboard() {
  const el = document.getElementById('leaderboardList');
  if (!el) return;
  const sessions = JSON.parse(localStorage.getItem('sat_nexus_sessions') || '[]');
  if (sessions.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--text-muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">🏆</div>
        <div style="font-size:.9rem;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">No leaderboard data yet</div>
        <div style="font-size:.8rem">Complete practice sessions to see your stats here. Rankings will be added when community features launch.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:16px" onclick="navigateTo('practice')">Start Practicing →</button>
      </div>`;
    return;
  }
  const totalQ = sessions.reduce((a,s) => a + s.total, 0);
  const totalC = sessions.reduce((a,s) => a + s.correct, 0);
  const acc = totalQ > 0 ? Math.round(totalC / totalQ * 100) : 0;
  el.innerHTML = `
    <div style="padding:12px;border-radius:10px;background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.25);display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--gradient-brand);display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;color:#fff">${USER?.name?.slice(0,2).toUpperCase()||'ME'}</div>
      <div style="flex:1">
        <div style="font-size:.875rem;font-weight:600">${USER?.name || 'You'} <span style="color:var(--indigo);font-size:.7rem">(You)</span></div>
        <div style="font-size:.72rem;color:var(--text-muted)">${sessions.length} sessions · ${totalQ} questions</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'JetBrains Mono',monospace;font-size:.95rem;font-weight:700">${acc}%</div>
        <div style="font-size:.72rem;color:var(--text-muted)">accuracy</div>
      </div>
    </div>
    <div style="text-align:center;color:var(--text-muted);font-size:.82rem;padding:16px">Community leaderboards coming soon. Keep practicing to build your score history.</div>`;
}

/* ── Focus Mode ──────────────────────────────────────────────── */
let focusInterval = null, focusTime = 25 * 60;

document.getElementById('focusBtn')?.addEventListener('click', () => {
  document.getElementById('focusOverlay').classList.add('active');
  focusTime = 25 * 60;
  updateFocusDisplay();
  focusInterval = setInterval(() => {
    focusTime--;
    updateFocusDisplay();
    if (focusTime <= 0) { clearInterval(focusInterval); showToast('Focus session complete!', 'success'); exitFocus(); }
  }, 1000);
});

function updateFocusDisplay() {
  const m = Math.floor(focusTime / 60), s = focusTime % 60;
  document.getElementById('focusTimer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
}
function exitFocus() { clearInterval(focusInterval); document.getElementById('focusOverlay').classList.remove('active'); }

/* ── Keyboard Shortcuts ──────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeVideoModal(); exitFocus(); }
  const practiceActive = !document.getElementById('practiceActive').classList.contains('hidden');
  if (practiceActive) {
    if (e.key === 'ArrowRight') nextQuestion();
    if (e.key === 'ArrowLeft')  prevQuestion();
    if (['a','b','c','d'].includes(e.key.toLowerCase())) selectAnswer(e.key.toUpperCase());
  }
  if (e.key === ' ') { e.preventDefault(); flipCard(); }
});

/* ── Settings ────────────────────────────────────────────────── */
function resetAllProgress() {
  if (!confirm('This will clear all your practice history and scores. Are you sure?')) return;
  localStorage.removeItem('sat_nexus_sessions');
  if (USER) {
    USER.questionsAnswered = 0;
    USER.testsCompleted = 0;
    USER.accuracy = null;
    USER.currentScore = null;
    USER.topicMastery = {};
    USER.streak = 0;
    saveUser(USER);
  }
  if (dashScoreChart) { dashScoreChart.destroy(); dashScoreChart = null; }
  if (dashAccChart)   { dashAccChart.destroy();   dashAccChart   = null; }
  showToast('Progress reset.', 'info');
  navigateTo('dashboard');
}

async function signOut() {
  await sb.auth.signOut();
  localStorage.removeItem('sat_nexus_user');
  localStorage.removeItem('sat_nexus_sessions');
  USER = null;
  showOnboarding();
}

/* ── Init ────────────────────────────────────────────────────── */
function initApp() {
  updateSidebarUser();
  initDashboard();
  renderCard();
  renderFormulas();
  renderDomainChips();

  // Stagger entrance animations
  document.querySelectorAll('.stat-card').forEach((card, i) => {
    card.style.opacity = '0'; card.style.transform = 'translateY(16px)';
    setTimeout(() => { card.style.transition = 'opacity 0.4s ease, transform 0.4s ease'; card.style.opacity = '1'; card.style.transform = 'translateY(0)'; }, i * 60 + 100);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Check for an active Supabase session first (returning logged-in user)
  const { data: { session } } = await sb.auth.getSession();

  if (session) {
    const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    saveUser({
      mode: 'account',
      name:              profile?.name              ?? session.user.user_metadata?.name ?? 'Student',
      currentScore:      profile?.current_score     ?? null,
      targetScore:       profile?.target_score      ?? null,
      testDate:          profile?.test_date         ?? null,
      streak:            profile?.streak            ?? 0,
      studyTime:         profile?.study_time        ?? 0,
      questionsAnswered: profile?.questions_answered ?? 0,
      accuracy:          profile?.accuracy          ?? null,
      testsCompleted:    profile?.tests_completed   ?? 0,
      topicMastery:      profile?.topic_mastery     ?? {}
    });
    initApp();
    showToast(`Welcome back, ${USER.name}!`, 'info', 3000);
  } else {
    // Fall back to local user (guest) or show onboarding
    USER = loadUser();
    if (USER) {
      initApp();
    } else {
      showOnboarding();
    }
  }
});
