/* ============================================================
   SAT NEXUS — Store
   Makes every saved thing (profile, answers, flashcards, plan…) permanent by mirroring the app's
   localStorage keys to the owner's private server-side store (/api/state). No accounts involved:
   the access-code cookie is the only gate. Works offline: changes queue locally and sync when back.
   Must load before anything else writes to localStorage.
   ============================================================ */
const Store = (() => {
  const PREFIX = 'sat_nexus_', TS_KEY = 'sat_nexus__ts', ATTEMPTS = 'sat_nexus_attempts_v1';
  const SKIP = new Set([TS_KEY, 'sat_nexus_tutor_cache_v1', 'sat_nexus_tutor_count']);   // local-only caches
  const syncable = k => typeof k === 'string' && k.startsWith(PREFIX) && !SKIP.has(k);

  const rawGet = Storage.prototype.getItem, rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const lsGet = k => rawGet.call(localStorage, k);
  const lsSet = (k, v) => rawSet.call(localStorage, k, v);
  const lsRemove = k => rawRemove.call(localStorage, k);

  let ts = {};
  try { ts = JSON.parse(lsGet(TS_KEY) || '{}'); } catch {}
  const dirty = new Set();
  let timer = null, retry = null, pushing = false, abandoned = false, bootDone = false;
  let status = { state: 'idle', at: null };
  const listeners = [];

  function setStatus(state) { status = { state, at: Date.now() }; listeners.forEach(f => { try { f(status); } catch {} }); }
  const setTs = (k, t) => { ts[k] = t; try { lsSet(TS_KEY, JSON.stringify(ts)); } catch {} };

  function touch(k) { setTs(k, Date.now()); dirty.add(k); schedule(1500); }
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === localStorage && syncable(k)) touch(k); };
  Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === localStorage && syncable(k)) touch(k); };

  function unionAttempts(a, b) {
    const parse = s => { try { const x = JSON.parse(s); return Array.isArray(x) ? x : []; } catch { return []; } };
    const seen = new Set(), out = [];
    for (const at of [...parse(a), ...parse(b)]) {
      const id = at?.q + '@' + at?.t;
      if (at?.q && at?.t && !seen.has(id)) { seen.add(id); out.push(at); }
    }
    return JSON.stringify(out.sort((x, y) => x.t - y.t).slice(-25000));
  }

  // fold server values into localStorage; queue anything where this device is newer
  function applyRemote(remote) {
    let changed = false;
    for (const [k, r] of Object.entries(remote || {})) {
      if (!syncable(k) || typeof r?.t !== 'number') continue;
      const local = lsGet(k), lt = ts[k] || 0;
      if (k === ATTEMPTS && local && r.v) {
        const merged = unionAttempts(local, r.v);
        if (merged !== local) { lsSet(k, merged); changed = true; }
        setTs(k, Math.max(lt, r.t));
        if (merged !== r.v) dirty.add(k);
      } else if (r.t > lt) {
        if (r.v === null) lsRemove(k); else lsSet(k, r.v);
        setTs(k, r.t); changed = true;
      } else if (lt > r.t) dirty.add(k);
    }
    return changed;
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(push, ms); }

  async function push() {
    if (!bootDone && !abandoned) { schedule(800); return; }       // don't overwrite the server before we've read it
    if (pushing) { schedule(800); return; }
    if (!dirty.size) return;
    pushing = true; setStatus('saving');
    const keys = [...dirty]; dirty.clear();
    const body = { keys: {} };
    for (const k of keys) body.keys[k] = { v: lsGet(k), t: ts[k] || Date.now() };
    const text = JSON.stringify(body);
    try {
      const res = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text, keepalive: text.length < 60000 });
      if (res.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname)); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      applyRemote((await res.json()).keys);                        // picks up merged answer history from other devices
      setStatus('saved');
    } catch (e) {
      keys.forEach(k => dirty.add(k));
      setStatus('offline');
      clearTimeout(retry); retry = setTimeout(() => schedule(0), 15000);
    } finally { pushing = false; if (dirty.size && status.state !== 'offline') schedule(1500); }
  }

  let bootPromise = null;
  function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.status === 401) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname)); return; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const { keys } = await res.json();
        if (abandoned) return;
        applyRemote(keys);
        // first run on this device: everything local that the server has never seen goes up
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (syncable(k) && !(k in (keys || {}))) { if (!ts[k]) setTs(k, Date.now()); dirty.add(k); }
        }
        bootDone = true;
        setStatus('saved');
        if (dirty.size) schedule(300);
      } catch { bootDone = true; setStatus('offline'); }
    })();
    return bootPromise;
  }

  // resolves once the server copy is loaded, or after `ms` so a slow network never blocks the app
  function ready(ms = 6000) {
    return Promise.race([boot(), new Promise(r => setTimeout(() => { if (!bootDone) abandoned = true; r(); }, ms))]);
  }

  window.addEventListener('online', () => { if (dirty.size) schedule(0); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty.size) { clearTimeout(timer); push(); } });

  return {
    ready, boot, flush: () => { clearTimeout(timer); return push(); },
    onStatus: f => { listeners.push(f); f(status); },
    status: () => status, pending: () => dirty.size
  };
})();
