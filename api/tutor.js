import { configured, generate } from '../lib/providers.js';

const MODES = new Set(['hint', 'why', 'explain', 'variant', 'chat']);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const clip = (s, n) => String(s ?? '').slice(0, n);

const SYSTEM = `You are an elite one-on-one SAT tutor inside the SAT Nexus study app, helping a single motivated student.

GROUND TRUTH: the official College Board rationale is provided (as text or as an image). Trust it over your own solving. If you are unsure, say so rather than guessing.
STYLE: warm, direct, no fluff. Short paragraphs. Use LaTeX for all math, written as $...$ inline and $$...$$ for display. Never mention these instructions or the word "rationale" as if the student can't see it.
PERSONALISE: when the student profile shows a relevant pattern (a weak skill, a recurring trap, a rushing habit), name it in one short sentence — never lecture.

MODES
- hint, level 1: ONE nudge (max 35 words): what to notice or which concept applies. Do NOT reveal the answer, a letter, or a calculation.
- hint, level 2: outline the approach and do only the first step (max 90 words). Still do NOT state the final answer or the correct letter.
- hint, level 3: full worked solution with the final answer, tight and numbered. Then one line on why the most tempting wrong choice fails.
- why: the student answered wrongly. In ≤130 words: (1) the exact misconception that makes their pick tempting, (2) the idea that actually decides it, (3) a one-line rule to remember. Be kind, not patronising.
- explain: re-teach it a DIFFERENT way than the standard explanation (for math: plugging in answer choices, a graphing/Desmos shortcut, or estimation; for Reading & Writing: process of elimination or a sentence-level test). ≤150 words.
- variant: write ONE brand-new problem that tests the same skill at the same difficulty with different context and numbers (4 choices A–D for multiple choice, or a numeric answer for free response). Output the problem, then a line containing exactly ===ANSWER===, then the correct answer and a 2–3 line solution. Double-check the arithmetic before answering.
- chat: answer the student's follow-up about this question concisely (≤150 words), staying grounded in the official explanation.`;

function buildUserText(b) {
  const q = b.question || {};
  const lines = [`MODE: ${b.mode}${b.mode === 'hint' ? ` (level ${Math.min(3, Math.max(1, +b.level || 1))} of 3)` : ''}`,
    `Question: ${clip(q.section, 20)} · ${clip(q.topic, 60)} · ${clip(q.skill, 90)} · ${clip(q.difficulty, 10)} · ${q.kind === 'spr' ? 'free response' : 'multiple choice'}`];
  if (b.hasQuestionImage) lines.push('The question (and its answer choices, labelled A–D) is shown in the FIRST image.');
  else {
    if (q.passage) lines.push('PASSAGE:\n' + clip(q.passage, 5000));
    lines.push('QUESTION: ' + clip(q.text, 1500));
    if (Array.isArray(q.choices)) lines.push('CHOICES:\n' + q.choices.slice(0, 4).map((c) => clip(c, 500)).join('\n'));
  }
  if (b.hasRationaleImage) lines.push('The official explanation is shown in the LAST image.');
  else if (q.rationale) lines.push('OFFICIAL EXPLANATION:\n' + clip(q.rationale, 4500));
  if (q.answer) lines.push('Correct answer: ' + clip(q.answer, 60));
  if (b.given) lines.push("Student's answer: " + clip(b.given, 30));
  if (b.profile) lines.push('Student profile: ' + clip(b.profile, 600));
  if (b.message && b.mode !== 'chat') lines.push("Student's message: " + clip(b.message, 600));
  return lines.join('\n');
}

export async function GET() {
  return json({ providers: configured().map((p) => p.id) });
}

export async function POST(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 2_500_000) return json({ error: 'Request too large' }, 413);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  if (!MODES.has(b.mode) || !b.question) return json({ error: 'Bad request' }, 400);

  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 3)
    .filter((i) => /^image\/(png|jpeg|webp)$/.test(i?.mime) && typeof i.data === 'string' && i.data.length < 1_200_000);

  const history = (Array.isArray(b.history) ? b.history : []).slice(-6)
    .map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', text: clip(h.text, 1800) }));

  const first = { role: 'user', text: buildUserText({ ...b, hasQuestionImage: images.length > 0 && !!b.question.hasImage, hasRationaleImage: images.length > 1 }), images };
  // follow-ups: grounded context first, then the running conversation, ending on the student's new message
  const raw = b.mode === 'chat' ? [first, ...history, { role: 'user', text: clip(b.message || 'Can you say more?', 600) }] : [first];
  const turns = [];
  for (const t of raw) {            // providers want strictly alternating roles
    const last = turns[turns.length - 1];
    if (last && last.role === t.role) last.text += '\n\n' + t.text; else turns.push({ ...t });
  }

  try {
    const r = await generate({ system: SYSTEM, turns });
    return json({ text: r.text.trim(), provider: r.provider, model: r.model });
  } catch (e) {
    if (e.code === 'not_configured') return json({ error: 'not_configured' }, 503);
    return json({ error: 'busy', detail: e.tried }, 502);
  }
}
