/* Question bank: load, index, and build the three drill pools. */

import * as store from './store.js';
import { seededShuffle, hashString } from './ui.js';

export const DAILY_SIZE = 10;

let index = null;          // parsed data/index.json
let weeks = [];            // [{week, title, file, count, questions:[]}]
let byId = new Map();      // qid -> question (with .week attached)
let liveIds = [];          // every authored qid, bank order
let liveSet = new Set();

export async function load() {
  const res = await fetch('./data/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`index.json ${res.status}`);
  index = await res.json();

  const loaded = await Promise.all(index.weeks.map(async w => {
    if (!w.file) return { ...w, questions: [] };
    const r = await fetch(w.file, { cache: 'no-cache' });
    if (!r.ok) {
      console.warn(`week ${w.week} failed to load (${r.status})`);
      return { ...w, questions: [], loadError: true };
    }
    const data = await r.json();
    const questions = (data.questions || []).map(q => ({ ...q, week: w.week }));
    return { ...w, title: data.title || w.title, topics: data.topics || [], questions };
  }));

  weeks = loaded;
  byId = new Map();
  liveIds = [];
  for (const w of weeks) {
    for (const q of w.questions) {
      byId.set(q.id, q);
      liveIds.push(q.id);
    }
  }
  liveSet = new Set(liveIds);
  store.setMeta({ bankVersionSeen: index.bankVersion ?? null });
  return { weeks, liveIds };
}

export const allWeeks = () => weeks;
export const getWeek = n => weeks.find(w => w.week === Number(n)) || null;
export const getQuestion = id => byId.get(id) || null;
export const allIds = () => liveIds;
export const allSet = () => liveSet;
export const bankVersion = () => index?.bankVersion ?? null;
export const isAuthored = w => Boolean(w.file) && w.questions.length > 0;

export function weekStats(n) {
  const w = getWeek(n);
  if (!w) return null;
  const ids = w.questions.map(q => q.id);
  const mastered = ids.filter(store.isMastered).length;
  const inReview = ids.filter(id => store.isInReview(id) && !store.isMastered(id)).length;
  const unseen = ids.filter(id => store.stateOf(id) === 'unseen').length;
  return { ids, total: ids.length, mastered, inReview, unseen, pct: ids.length ? mastered / ids.length : 0 };
}

/** Highest authored week the learner has actually touched (defaults to 1). */
export function currentWeek() {
  let best = null;
  for (const w of weeks) {
    if (!isAuthored(w)) continue;
    if (w.questions.some(q => store.stateOf(q.id) !== 'unseen')) best = w.week;
  }
  if (best == null) {
    const first = weeks.find(isAuthored);
    return first ? first.week : null;
  }
  // If that week is fully mastered, point at the next authored one.
  const s = weekStats(best);
  if (s && s.mastered === s.total) {
    const next = weeks.find(w => w.week > best && isAuthored(w));
    if (next) return next.week;
  }
  return best;
}

/* ---------- pools ---------- */

export const weekPool = n => (getWeek(n)?.questions || []).map(q => q.id);

export const weekReviewPool = n => weekPool(n).filter(store.isInReview);

export const reviewPool = () => store.reviewIds(liveIds);

/**
 * Daily quiz — not uniform random, because uniform random keeps re-serving
 * things you already know:
 *   4 from the review pool (oldest first)
 *   4 unseen, starting from the week you're furthest along in
 *   2 from weeks you've reached, for spaced recall
 * Seeded by the date so reloading doesn't reshuffle today's set.
 */
export function dailyPool(size = DAILY_SIZE) {
  const picked = [];
  const taken = new Set();
  const take = id => {
    if (!id || taken.has(id) || !liveSet.has(id)) return false;
    taken.add(id);
    picked.push(id);
    return picked.length >= size;
  };

  for (const id of reviewPool().slice(0, 4)) if (take(id)) return picked;

  const cw = currentWeek();
  const ordered = weeks
    .filter(isAuthored)
    .sort((a, b) => Math.abs(a.week - (cw ?? 1)) - Math.abs(b.week - (cw ?? 1)) || a.week - b.week);
  let unseenQuota = 4;
  for (const w of ordered) {
    for (const q of w.questions) {
      if (store.stateOf(q.id) !== 'unseen' || taken.has(q.id)) continue;
      if (take(q.id)) return picked;
      if (--unseenQuota <= 0) break;
    }
    if (unseenQuota <= 0) break;
  }

  // The tail is spaced recall of ground you've covered, not a preview. Drawing
  // it from the whole bank was fine at 3 authored weeks; at 12 it would mostly
  // serve material from weeks you haven't studied, which teaches nothing and
  // reads as noise. Falls back to the full bank only if the reached weeks can't
  // fill the set.
  const reachedIds = weeks
    .filter(w => isAuthored(w) && w.week <= (cw ?? 1))
    .flatMap(w => w.questions.map(q => q.id))
    .filter(id => liveSet.has(id));
  const tail = reachedIds.length >= size ? reachedIds : liveIds;

  const seed = hashString(`${store.today()}|${liveIds.length}`);
  for (const id of seededShuffle(tail, seed)) if (take(id)) return picked;

  return picked;
}
