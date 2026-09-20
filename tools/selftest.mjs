/* Headless logic tests for store.js + bank.js + mathtext.js.
 *
 * Run from the repo root:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
 *     -m tools/selftest.mjs
 *
 * Only covers logic that doesn't touch the DOM — the UI is verified by hand
 * on the phone.
 */

/* ---------- browser stubs ---------- */

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.navigator = { storage: { persist: () => Promise.resolve(false) } };
globalThis.structuredClone ??= v => JSON.parse(JSON.stringify(v));
globalThis.fetch = async url => {
  const text = readFile(String(url).replace(/^\.\//, ''));
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
};

const store = await import('../js/store.js');
const bank = await import('../js/bank.js');
const { mathtext, plaintext } = await import('../js/mathtext.js');

/* ---------- harness ---------- */

let pass = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

/* ---------- bank loading ---------- */

store.init();
await bank.load();

// Expectations are derived from data/index.json, never hardcoded: adding a
// week is supposed to be a data-only change, so a growing bank must not make
// this file fail. What's being tested is that the index and the week files
// agree with each other.
const index = JSON.parse(readFile('data/index.json'));
const authoredWeeks = index.weeks.filter(w => w.file);
const expectedTotal = index.weeks.reduce((n, w) => n + (w.count || 0), 0);

const ids = bank.allIds();
eq('bank loads every question the index claims', ids.length, expectedTotal);
eq('12 weeks listed', bank.allWeeks().length, index.weeks.length);
eq('authored weeks match the index',
  bank.allWeeks().filter(bank.isAuthored).length, authoredWeeks.length);
check('bankVersion surfaced', Number.isInteger(bank.bankVersion()));
check('every id is unique', new Set(ids).size === ids.length);
check('the bank is not empty', ids.length > 0);

for (const q of ids.map(bank.getQuestion)) {
  check(`${q.id} answer in range`, q.answer >= 0 && q.answer < q.options.length);
  check(`${q.id} has explanation`, typeof q.explanation === 'string' && q.explanation.length > 20);
}

/* ---------- the 2-strikes-out review rule ---------- */

const A = ids[0];
eq('unseen question is not in review', store.isInReview(A), false);
eq('unseen state', store.stateOf(A), 'unseen');

store.recordAnswer(A, 1, false);
eq('wrong -> in review', store.isInReview(A), true);
eq('wrong -> state', store.stateOf(A), 'wrong');
eq('wrong -> not mastered', store.isMastered(A), false);

store.recordAnswer(A, 0, true);
eq('right once -> still in review', store.isInReview(A), true);
eq('right once -> learning', store.stateOf(A), 'learning');

store.recordAnswer(A, 0, true);
eq('right twice -> mastered', store.isMastered(A), true);
eq('right twice -> out of review', store.isInReview(A), false);

store.recordAnswer(A, 2, false);
eq('wrong again -> back in review', store.isInReview(A), true);
eq('wrong again -> streak reset', store.getRecord(A).streak, 0);
eq('wrong picks accumulate distinctly', store.getRecord(A).wrongPicks, [1, 2]);

// A clean first attempt counts as mastery — no limbo state.
const B = ids[1];
store.recordAnswer(B, bank.getQuestion(B).answer, true);
eq('right on first try -> mastered', store.isMastered(B), true);
eq('right on first try -> not in review', store.isInReview(B), false);
store.recordAnswer(B, bank.getQuestion(B).answer, true);
eq('still mastered after a second right', store.isMastered(B), true);

// Every attempted question must land in exactly one bucket.
for (const id of [A, B]) {
  const buckets = [store.isMastered(id), store.isInReview(id), store.stateOf(id) === 'unseen'];
  eq(`${id} is in exactly one bucket`, buckets.filter(Boolean).length, 1);
}

/* ---------- review pool ordering ---------- */

const pool = bank.reviewPool();
check('review pool holds A but not B', pool.includes(A) && !pool.includes(B));
check('review pool puts outright-wrong first',
  pool.length === 0 || store.getRecord(pool[0]).last === 0);

/* ---------- week aggregates ---------- */

const firstWeek = authoredWeeks[0].week;
const w1 = bank.weekStats(firstWeek);
eq(`week ${firstWeek} total matches its index count`, w1.total,
  authoredWeeks[0].count);
eq('week counts add up', w1.mastered + w1.inReview + w1.unseen, w1.total);

const unauthored = index.weeks.find(w => !w.file);
if (unauthored) {
  eq(`week ${unauthored.week} is empty`, bank.weekStats(unauthored.week).total, 0);
  check(`week ${unauthored.week} is not authored`,
    !bank.isAuthored(bank.getWeek(unauthored.week)));
}
eq('currentWeek follows the week just touched', bank.currentWeek(), firstWeek);

/* ---------- daily pool ---------- */

const daily = bank.dailyPool();
eq('daily pool size', daily.length, 10);
eq('daily pool has no duplicates', new Set(daily).size, daily.length);
check('daily pool is all live ids', daily.every(id => bank.getQuestion(id)));
check('daily pool leads with the review pile', daily[0] === A);
eq('daily pool is stable across calls', bank.dailyPool(), daily);

/* ---------- stats ---------- */

const s = store.stats(ids);
eq('answered counts distinct questions', s.answered, 2);
eq('stats total', s.total, expectedTotal);
check('accuracy between 0 and 1', s.accuracy > 0 && s.accuracy <= 1);
eq('streak started at 1', store.touchStreak(), 1);

/* ---------- export / import round trip ---------- */

const blob = store.buildExport(ids);
eq('export is tagged', blob.app, 'ai-quiz-app');
eq('export carries stats', blob.stats.answered, 2);
const text = JSON.stringify(blob);

store.resetAll();
eq('reset clears progress', store.stats(ids).answered, 0);

const res = store.importBlob(text, 'replace');
check('import succeeds', res.ok, res.message);
eq('import restores answered count', store.stats(ids).answered, 2);
eq('import restores the A record', store.getRecord(A).wrongPicks, [1, 2]);
eq('import restores mastery of B', store.isMastered(B), true);

// Merge must not lose newer local progress.
store.recordAnswer(A, bank.getQuestion(A).answer, true);
const nBefore = store.getRecord(A).n;
const merged = store.importBlob(text, 'merge');
check('merge succeeds', merged.ok, merged.message);
check('merge keeps the higher attempt count',
  store.getRecord(A).n >= nBefore, `n=${store.getRecord(A).n} was ${nBefore}`);
check('merge never lets correct exceed attempts',
  store.getRecord(A).c <= store.getRecord(A).n);

/* ---------- import rejections ---------- */

check('rejects junk', !store.importBlob('not json').ok);
check('rejects a foreign app', !store.importBlob('{"app":"something-else"}').ok);
check('rejects a newer schema', !store.importBlob('{"app":"ai-quiz-app","schema":99,"progress":{}}').ok);
check('rejects a blob with no progress', !store.importBlob('{"app":"ai-quiz-app","schema":1}').ok);

/* ---------- retired records survive ---------- */

store.importBlob(JSON.stringify({
  app: 'ai-quiz-app', schema: 1,
  progress: { 'w99-q001': { n: 3, c: 1, streak: 0, last: 0, lastAt: '2026-01-01', wrongPicks: [0] } },
}), 'merge');
eq('a retired id is kept, not dropped', store.retiredIds(bank.allSet()), ['w99-q001']);
eq('retired ids stay out of stats', store.stats(ids).answered, 2);
eq('compact removes exactly the retired ones', store.compact(bank.allSet()), 1);
eq('compact leaves live records alone', store.stats(ids).answered, 2);

/* ---------- paused drills ---------- */

/* The bug these pin down: sessions used to share one slot, so opening any drill
 * discarded your place in every other one. Nothing tested it, which is exactly
 * why it shipped. */

const mkSession = (mode, arg, idx, n = 10, extra = {}) => ({
  mode, arg: String(arg), idx, ids: ids.slice(0, n).concat(Array(Math.max(0, n - ids.length)).fill(ids[0])),
  results: [], date: store.today(), done: false, ...extra,
});

store.setSession(mkSession('week', 1, 4));
store.setSession(mkSession('week', 2, 7));
store.setSession(mkSession('daily', '', 3));

eq('week 1 keeps its own place', store.getSession('week', 1).idx, 4);
eq('week 2 keeps its own place', store.getSession('week', 2).idx, 7);
eq('the daily set keeps its own place', store.getSession('daily', '').idx, 3);
check('a drill never started has no session', store.getSession('week', 9) === null);
eq('no-arg getSession returns the newest', store.getSession().mode, 'daily');

check('a paused drill is resumable', store.resumableSession('week', 1)?.idx === 4);
check('idx 0 is not worth resuming', store.resumableSession('week', 3) === null);
store.setSession(mkSession('week', 4, 2, 10, { done: true }));
check('a finished drill is not resumable', store.resumableSession('week', 4) === null);
store.setSession(mkSession('week', 5, 10, 10));
check('a drill past its last question is not resumable', store.resumableSession('week', 5) === null);

store.clearSession('week', 1);
check('clearing one drill removes it', store.getSession('week', 1) === null);
eq('clearing one drill leaves the others', store.getSession('week', 2).idx, 7);

// The numeric/string arg mismatch is a real hazard: the week page passes a
// number while the router hands renderDrill a string from the URL.
eq('numeric and string args address the same drill', store.getSession('week', '2').idx, 7);

/* ---------- mathtext ---------- */

eq('escapes html', mathtext('<script>'), '&lt;script&gt;');
eq('backticks become mono', mathtext('`[1, 2]`'), '<span class="mono">[1, 2]</span>');
eq('superscript', mathtext('x^2'), 'x<sup>2</sup>');
eq('braced superscript', mathtext('e^{-x}'), 'e<sup>-x</sup>');
eq('subscript', mathtext('d_k'), 'd<sub>k</sub>');
eq('no transforms inside backticks', mathtext('`a_b`'), '<span class="mono">a_b</span>');
eq('plaintext strips markup', plaintext('`[1, 2]` and x^{2}'), '[1, 2] and x2');

/* ---------- authored content checks ---------- */

// tools/bank.py is the fuller content linter (ids, LaTeX, distractors, option
// length). These are the two rules worth failing a build over.
for (const w of bank.allWeeks().filter(bank.isAuthored)) {
  const qs = w.questions;
  if (qs.length < 6) continue;   // a half-written week isn't a mix violation
  const concept = qs.filter(q => q.kind === 'concept').length;
  const ratio = concept / qs.length;
  check(`week ${w.week} concept ratio ~60%`, ratio >= 0.5 && ratio <= 0.72,
    `${Math.round(ratio * 100)}% concept`);
  const dist = {};
  for (const q of qs.filter(q => q.options.length === 4)) dist[q.answer] = (dist[q.answer] || 0) + 1;
  const counts = [0, 1, 2, 3].map(i => dist[i] || 0);
  check(`week ${w.week} answer indices are spread`, Math.max(...counts) - Math.min(...counts) <= 4,
    `distribution ${counts.join(',')}`);
  check(`week ${w.week} has no free-text questions`, qs.every(q => Array.isArray(q.options)));
}

/* ---------- report ---------- */

print(`\n${pass} checks passed`);
if (failures.length) {
  print(`${failures.length} FAILED:`);
  for (const f of failures) print(`  ✗ ${f}`);
  // jsc has no process.exit; an uncaught throw is what makes it exit non-zero,
  // which is what lets `bank.py release` stop on a red test.
  throw new Error(`${failures.length} check(s) failed`);
}
print('all green');
