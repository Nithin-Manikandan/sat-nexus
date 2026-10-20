// Shared by middleware.js and api/login.js. Web Crypto only, so it runs on the edge and in Node.
const enc = new TextEncoder();

export const COOKIE = 'sat_access';
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Key mixes both secrets, so rotating ACCESS_CODE also revokes every existing session.
async function hmac(message) {
  const { SESSION_SECRET, ACCESS_CODE } = process.env;
  if (!SESSION_SECRET || !ACCESS_CODE) return null;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(`${SESSION_SECRET}:${ACCESS_CODE}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

// Constant-time string compare (hash first so lengths always match).
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function issueToken() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const sig = await hmac(String(exp));
  return sig && `${exp}.${sig}`;
}

export async function verifyToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(exp);
  return !!expected && safeEqual(sig, expected);
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
