import { get, put } from '@vercel/blob';

// One owner, one blob. Everything the app saves (profile, answer history, flashcards, plan…) lives here,
// keyed by the app's localStorage names. The route sits behind the access-code middleware.
const PATH = 'state.json';
const KEY_OK = /^sat_nexus_[a-z0-9_]{1,60}$/i;
const ATTEMPTS = 'sat_nexus_attempts_v1';
const MAX_ATTEMPTS = 25000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function read() {
  try {
    const r = await get(PATH, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return { keys: {}, etag: null };
    const data = JSON.parse(await new Response(r.stream).text());
    return { keys: data.keys || {}, etag: r.blob.etag };
  } catch (e) {
    if (/not.?found/i.test(e?.name + ' ' + e?.message)) return { keys: {}, etag: null };
    throw e;
  }
}

// Answer history is append-only, so devices merge it instead of overwriting each other.
function unionAttempts(a, b) {
  const parse = (s) => { try { const x = JSON.parse(s); return Array.isArray(x) ? x : []; } catch { return []; } };
  const seen = new Set(), out = [];
  for (const at of [...parse(a), ...parse(b)]) {
    const id = at?.q + '@' + at?.t;
    if (at?.q && at?.t && !seen.has(id)) { seen.add(id); out.push(at); }
  }
  out.sort((x, y) => x.t - y.t);
  return JSON.stringify(out.slice(-MAX_ATTEMPTS));
}

function mergeInto(current, incoming) {
  const changed = {};
  for (const [k, inc] of Object.entries(incoming)) {
    if (!KEY_OK.test(k) || typeof inc?.t !== 'number') continue;
    if (inc.v !== null && (typeof inc.v !== 'string' || inc.v.length > 4_000_000)) continue;
    const cur = current[k];
    if (k === ATTEMPTS && cur?.v && inc.v) {
      const v = unionAttempts(cur.v, inc.v);
      current[k] = changed[k] = { v, t: Math.max(cur.t, inc.t) };
    } else if (!cur || inc.t > cur.t) {
      current[k] = changed[k] = { v: inc.v, t: inc.t };
    }
  }
  return changed;
}

export async function GET() {
  try { return json({ keys: (await read()).keys }); }
  catch { return json({ error: 'storage' }, 500); }
}

export async function PUT(request) {
  if (Number(request.headers.get('content-length') || 0) > 4_400_000) return json({ error: 'too large' }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (!body || typeof body.keys !== 'object') return json({ error: 'bad request' }, 400);

  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 30 + Math.random() * 120));
    try {
      const { keys, etag } = await read();
      const changed = mergeInto(keys, body.keys);
      await put(PATH, JSON.stringify({ keys }), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
        ...(etag ? { ifMatch: etag } : {}), cacheControlMaxAge: 60
      });
      return json({ ok: true, keys: changed });
    } catch (e) {
      // two devices saved at once → re-read and merge again
      if (!/precondition|etag|conflict/i.test(e?.name + ' ' + e?.message)) return json({ error: 'storage' }, 500);
    }
  }
  return json({ error: 'conflict' }, 409);
}
