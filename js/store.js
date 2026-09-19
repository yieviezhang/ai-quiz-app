/* Progress persistence.
 *
 * Progress lives in localStorage; the question bank lives in Cache Storage.
 * They are different storage systems, so shipping a new bank physically
 * cannot wipe your history. The load-bearing piece is that question IDs
 * ("w01-q007") are stable and append-only — see AUTHORING.md.
 */

const K_PROGRESS = 'aiquiz:v1:progress';
const K_META = 'aiquiz:v1:meta';
const K_SESSION = 'aiquiz:v1:session';

export const SCHEMA = 1;
export const MASTERY_STREAK = 2;

const DEFAULT_PROGRESS = { schema: SCHEMA, q: {} };
const DEFAULT_META = {
  schema: SCHEMA,
  streakDays: 0,
  lastDrillDate: null,
  bankVersionSeen: null,
  lastExportAt: null,
  sound: false,
  daily: null, // { date, ids, idx, results }
};

let progress = { ...DEFAULT_PROGRESS, q: {} };
let meta = { ...DEFAULT_META };

/* ---------- dates ---------- */

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(isoA, isoB) {
  const a = new Date(`${isoA}T00:00:00`);
  const b = new Date(`${isoB}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

/* ---------- io ---------- */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : structuredClone(fallback);
  } catch {
    // Corrupt or unavailable storage must never brick the app.
    return structuredClone(fallback);
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('storage write failed', key, err);
    return false;
  }
}

export function init() {
  progress = readJSON(K_PROGRESS, DEFAULT_PROGRESS);
  if (!progress.q || typeof progress.q !== 'object') progress.q = {};
  progress.schema = SCHEMA;

  meta = { ...DEFAULT_META, ...readJSON(K_META, DEFAULT_META) };

  // Best-effort durability; Safari may ignore it, which is fine.
  navigator.storage?.persist?.().catch(() => {});
}

const saveProgress = () => writeJSON(K_PROGRESS, progress);
const saveMeta = () => writeJSON(K_META, meta);

/* ---------- reading ---------- */

export const getRecord = id => progress.q[id] || null;

/**
 * Mastered = a perfect record, or two consecutive rights since your last miss.
 *
 * The perfect-record clause matters: getting a question right the first time
 * you ever see it is stronger evidence than getting it right after being shown
 * the answer, so it shouldn't need a second pass. The 2-strikes rule exists to
 * govern *recovery from a miss*, not to gate clean first attempts.
 */
export function isMastered(id) {
  const r = progress.q[id];
  if (!r || !r.n) return false;
  return r.c === r.n || r.streak >= MASTERY_STREAK;
}

/** Attempted, has missed at least once, and hasn't recovered yet. */
export function isInReview(id) {
  const r = progress.q[id];
  if (!r || !r.n) return false;
  return !isMastered(id);
}

/** 'unseen' | 'wrong' | 'learning' | 'mastered' — partitions the whole bank. */
export function stateOf(id) {
  const r = progress.q[id];
  if (!r || !r.n) return 'unseen';
  if (isMastered(id)) return 'mastered';
  return r.last === 0 ? 'wrong' : 'learning';
}

/** Review pool for the given live IDs, oldest-attempted first. */
export function reviewIds(liveIds) {
  return liveIds
    .filter(isInReview)
    .sort((a, b) => {
      const ra = progress.q[a], rb = progress.q[b];
      // Outright-wrong before merely-unmastered.
      if (ra.last !== rb.last) return ra.last - rb.last;
      return String(ra.lastAt || '').localeCompare(String(rb.lastAt || ''));
    });
}

export function stats(liveIds) {
  let answered = 0, mastered = 0, inReview = 0, attempts = 0, correct = 0;
  for (const id of liveIds) {
    const r = progress.q[id];
    if (!r || !r.n) continue;
    answered++;
    attempts += r.n;
    correct += r.c;
    if (isMastered(id)) mastered++;
    else if (isInReview(id)) inReview++;
  }
  return {
    total: liveIds.length,
    answered,
    mastered,
    inReview,
    unseen: liveIds.length - answered,
    accuracy: attempts ? correct / attempts : 0,
    streakDays: meta.streakDays || 0,
  };
}

/** Records for IDs no longer in the bank — kept, never auto-deleted. */
export function retiredIds(liveSet) {
  return Object.keys(progress.q).filter(id => !liveSet.has(id));
}

/* ---------- writing ---------- */

export function recordAnswer(id, picked, isCorrect) {
  const r = progress.q[id] || { n: 0, c: 0, streak: 0, last: 1, lastAt: null, wrongPicks: [] };
  r.n += 1;
  r.last = isCorrect ? 1 : 0;
  if (isCorrect) {
    r.c += 1;
    r.streak += 1;
  } else {
    r.streak = 0;
    if (!Array.isArray(r.wrongPicks)) r.wrongPicks = [];
    if (typeof picked === 'number' && !r.wrongPicks.includes(picked)) r.wrongPicks.push(picked);
  }
  r.lastAt = today();
  progress.q[id] = r;
  saveProgress(); // synchronous per answer; never batch on unload — iOS drops those events
  return r;
}

/** Call once per drill; advances the day streak. */
export function touchStreak() {
  const t = today();
  if (meta.lastDrillDate === t) return meta.streakDays;
  meta.streakDays = meta.lastDrillDate && daysBetween(meta.lastDrillDate, t) === 1
    ? (meta.streakDays || 0) + 1
    : 1;
  meta.lastDrillDate = t;
  saveMeta();
  return meta.streakDays;
}

/* ---------- meta ---------- */

export const getMeta = () => meta;

export function setMeta(patch) {
  Object.assign(meta, patch);
  saveMeta();
  return meta;
}

/** Days since the last export, or null if never. */
export function daysSinceExport() {
  return meta.lastExportAt ? daysBetween(meta.lastExportAt, today()) : null;
}

/* ---------- daily quiz bookkeeping ---------- */

export function getDaily() {
  const d = meta.daily;
  return d && d.date === today() ? d : null;
}

export const setDaily = d => setMeta({ daily: d });

/* ---------- in-flight session ---------- */

export const getSession = () => readJSON(K_SESSION, null);
export const setSession = s => writeJSON(K_SESSION, s);
export const clearSession = () => { try { localStorage.removeItem(K_SESSION); } catch {} };

/* ---------- export / import ---------- */

export function buildExport(liveIds) {
  const s = stats(liveIds);
  return {
    app: 'ai-quiz-app',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    bankVersion: meta.bankVersionSeen,
    stats: {
      answered: s.answered,
      mastered: s.mastered,
      inReview: s.inReview,
      accuracy: Math.round(s.accuracy * 100) / 100,
      streakDays: s.streakDays,
    },
    meta: {
      streakDays: meta.streakDays,
      lastDrillDate: meta.lastDrillDate,
      sound: meta.sound,
    },
    progress: progress.q,
  };
}

/**
 * @param {string} text raw pasted JSON
 * @param {'merge'|'replace'} mode
 * @returns {{ok:boolean, message:string, changed?:number}}
 */
export function importBlob(text, mode = 'merge') {
  let blob;
  try {
    blob = JSON.parse(String(text).trim());
  } catch {
    return { ok: false, message: "That isn't valid JSON. Copy the whole blob, including the braces." };
  }
  if (!blob || blob.app !== 'ai-quiz-app') {
    return { ok: false, message: 'That backup is from a different app.' };
  }
  if (typeof blob.schema === 'number' && blob.schema > SCHEMA) {
    return { ok: false, message: `That backup is from a newer version (schema ${blob.schema}). Update the app first.` };
  }
  const incoming = blob.progress;
  if (!incoming || typeof incoming !== 'object') {
    return { ok: false, message: 'That backup has no progress in it.' };
  }

  let changed = 0;
  if (mode === 'replace') {
    progress.q = {};
  }
  for (const [id, raw] of Object.entries(incoming)) {
    if (!/^w\d{2}-q\d{3}$/.test(id) || !raw || typeof raw !== 'object') continue;
    const rec = {
      n: Number(raw.n) || 0,
      c: Number(raw.c) || 0,
      streak: Number(raw.streak) || 0,
      last: raw.last === 0 ? 0 : 1,
      lastAt: typeof raw.lastAt === 'string' ? raw.lastAt : null,
      wrongPicks: Array.isArray(raw.wrongPicks) ? raw.wrongPicks.filter(n => Number.isInteger(n)) : [],
    };
    const mine = progress.q[id];
    if (!mine || mode === 'replace') {
      progress.q[id] = rec;
      changed++;
      continue;
    }
    // Merge: keep whichever record has seen more attempts, and take the newer
    // outcome. Merge-first matters because the realistic import is "restore
    // after clearing Safari data", where replace could destroy newer progress.
    const winner = rec.n > mine.n ? rec : mine;
    const newer = String(rec.lastAt || '') > String(mine.lastAt || '') ? rec : mine;
    const merged = {
      n: Math.max(rec.n, mine.n),
      c: Math.max(rec.c, mine.c),
      streak: winner.streak,
      last: newer.last,
      lastAt: newer.lastAt,
      wrongPicks: [...new Set([...mine.wrongPicks, ...rec.wrongPicks])],
    };
    merged.c = Math.min(merged.c, merged.n);
    progress.q[id] = merged;
    changed++;
  }

  if (blob.meta && typeof blob.meta === 'object') {
    if (Number.isInteger(blob.meta.streakDays)) {
      meta.streakDays = mode === 'replace'
        ? blob.meta.streakDays
        : Math.max(meta.streakDays || 0, blob.meta.streakDays);
    }
    if (typeof blob.meta.lastDrillDate === 'string') {
      meta.lastDrillDate = String(blob.meta.lastDrillDate) > String(meta.lastDrillDate || '')
        ? blob.meta.lastDrillDate : meta.lastDrillDate;
    }
  }
  saveProgress();
  saveMeta();
  return { ok: true, changed, message: `Restored ${changed} question${changed === 1 ? '' : 's'}.` };
}

export function resetAll() {
  progress = { schema: SCHEMA, q: {} };
  meta = { ...DEFAULT_META };
  saveProgress();
  saveMeta();
  clearSession();
}

export function compact(liveSet) {
  const gone = retiredIds(liveSet);
  for (const id of gone) delete progress.q[id];
  saveProgress();
  return gone.length;
}
