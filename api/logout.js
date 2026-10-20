import { cookieHeader } from '../lib/token.js';

export function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader('', 0) }
  });
}
