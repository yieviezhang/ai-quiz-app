/* Cloud sync against the Cloudflare Worker in ../worker/sync-worker.js.
 *
 * Shape of the deal: localStorage stays the source of truth for drilling, so
 * the app works with no network at all. Sync is a background reconciliation —
 * pull-merge-push on launch, push after each drill.
 *
 * The sync URL is a capability URL (it contains a random token). It is stored
 * in meta and deliberately NOT included in export blobs, so pasting an export
 * into a chat can't leak write access.
 */

import * as store from './store.js';
import * as bank from './bank.js';

const TIMEOUT_MS = 8000;
const PUSH_DEBOUNCE_MS = 1200;

let pushTimer = null;
let inFlight = false;
const listeners = new Set();

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(status()); };

/* ---------- config ---------- */

export const isEnabled = () => Boolean(store.getMeta().syncUrl);
export const syncUrl = () => store.getMeta().syncUrl || null;

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // URL-safe base64, 32 chars — matches the Worker's /s/[A-Za-z0-9_-]{24,64}
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Accepts either a bare Worker base URL (a fresh token is generated) or a full
 * previously-issued sync link (so a second device joins the same record).
 * @returns {{ok:boolean, message:string, url?:string}}
 */
export function configure(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return { ok: false, message: 'Paste your Worker URL first.' };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: "That doesn't look like a URL. It should start with https://" };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'The sync URL must be https.' };
  }

  const existing = parsed.pathname.match(/^\/s\/([A-Za-z0-9_-]{24,64})$/);
  const url = existing
    ? `${parsed.origin}/s/${existing[1]}`
    : `${parsed.origin}/s/${randomToken()}`;

  store.setMeta({ syncUrl: url, lastSyncAt: null, lastSyncError: null });
  emit();
  return { ok: true, url, message: existing ? 'Joined your existing sync record.' : 'Sync link created.' };
}

export function disable() {
  store.setMeta({ syncUrl: null, lastSyncAt: null, lastSyncError: null });
  emit();
}

export function status() {
  const m = store.getMeta();
  return {
    enabled: Boolean(m.syncUrl),
    url: m.syncUrl || null,
    lastSyncAt: m.lastSyncAt || null,
    error: m.lastSyncError || null,
    busy: inFlight,
  };
}

/* ---------- transport ---------- */

async function request(method, body) {
  const url = syncUrl();
  if (!url) throw new Error('Sync is not set up.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      throw new Error(data?.error === 'kv_not_bound'
        ? 'The Worker has no KV namespace bound as AIQUIZ.'
        : `Sync server returned ${res.status}.`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- operations ---------- */

/** Pull remote progress and merge it in. Never destructive. */
export async function pull() {
  const remote = await request('GET');
  if (!remote || remote.empty) return { merged: 0, empty: true };
  const res = store.importBlob(JSON.stringify(remote), 'merge');
  if (!res.ok) throw new Error(res.message);
  return { merged: res.changed, empty: false };
}

export async function push() {
  const blob = store.buildExport(bank.allIds());
  await request('PUT', JSON.stringify(blob));
  return blob;
}

/** Pull, merge, then push the reconciled state back. */
export async function syncNow({ silent = false } = {}) {
  if (!isEnabled() || inFlight) return status();
  inFlight = true;
  emit();
  try {
    await pull();
    await push();
    store.setMeta({ lastSyncAt: new Date().toISOString(), lastSyncError: null });
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'Sync timed out.' : (err?.message || 'Sync failed.');
    store.setMeta({ lastSyncError: message });
    if (!silent) console.warn('[sync]', message);
  } finally {
    inFlight = false;
    emit();
  }
  return status();
}

/** Coalesce the bursts of writes a finished drill produces into one push. */
export function pushSoon() {
  if (!isEnabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncNow({ silent: true }); }, PUSH_DEBOUNCE_MS);
}

/** Verify a fresh setup end to end, so failures surface at configure time. */
export async function test() {
  try {
    await request('GET');
    await push();
    store.setMeta({ lastSyncAt: new Date().toISOString(), lastSyncError: null });
    emit();
    return { ok: true, message: 'Connected. Your progress is backed up.' };
  } catch (err) {
    const message = err?.name === 'AbortError'
      ? 'No response from the Worker — check the URL.'
      : (err?.message || 'Could not reach the Worker.');
    store.setMeta({ lastSyncError: message });
    emit();
    return { ok: false, message };
  }
}

/* ---------- lifecycle ---------- */

export function install() {
  if (!isEnabled()) return;

  if (navigator.onLine !== false) syncNow({ silent: true });

  // A home-screen PWA is resumed rather than reloaded, so visibilitychange is
  // the only reliable "app opened" signal. Throttled to avoid churn.
  let last = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - last < 60000) return;
    last = Date.now();
    syncNow({ silent: true });
  });

  // Catch up whatever failed while offline.
  window.addEventListener('online', () => syncNow({ silent: true }));
}
