import { next } from '@vercel/functions';
import { COOKIE, getCookie, verifyToken } from './lib/token.js';

export const config = { runtime: 'nodejs', matcher: '/(.*)' };

// Reachable without an access code.
const PUBLIC = new Set(['/login.html', '/login', '/api/login', '/api/logout']);

export default async function middleware(request) {
  const { pathname, search } = new URL(request.url);
  if (PUBLIC.has(pathname)) return next();

  if (!process.env.ACCESS_CODE || !process.env.SESSION_SECRET) {
    return new Response('Access gate is not configured.', { status: 503 }); // fail closed
  }

  if (await verifyToken(getCookie(request, COOKIE))) {
    return next({ headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } });
  }

  if ((request.headers.get('accept') || '').includes('text/html')) {
    const dest = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return Response.redirect(new URL(`/login.html${dest}`, request.url), 302);
  }
  return new Response('Unauthorized', { status: 401 });
}
