import { cookieHeader, issueToken, MAX_AGE, safeEqual } from '../lib/token.js';

// Best-effort throttle: per warm instance only, so it slows guessing but is not a hard global limit.
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 5;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export async function POST(request) {
  const { ACCESS_CODE } = process.env;
  if (!ACCESS_CODE || !process.env.SESSION_SECRET) return json({ error: 'Not configured' }, 503);

  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (fails.get(ip) || []).filter((t) => now - t < WINDOW);
  if (recent.length >= MAX_FAILS) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);

  let code = '';
  try { code = String((await request.json()).code || '').trim(); } catch {}

  if (!code || !(await safeEqual(code, ACCESS_CODE))) {
    recent.push(now);
    fails.set(ip, recent);
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: 'Incorrect access code.' }, 401);
  }

  fails.delete(ip);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(await issueToken(), MAX_AGE) });
}
