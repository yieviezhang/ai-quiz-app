/* The drill: present → answer → reveal → continue → summary.
 * Never auto-advances; the explanation is the point of the app. */

import * as bank from './bank.js';
import * as store from './store.js';
import * as router from './router.js';
import * as chrome from './chrome.js';
import { copyAskClaude } from './share.js';
import { mathtext } from './mathtext.js';
import { $, el, clear, checkmark, crossmark, bigRing, statusDot, toast, plural } from './ui.js';

let state = null;

/* ---------- pools ---------- */

function buildPool(mode, arg) {
  switch (mode) {
    case 'week': return bank.weekPool(arg);
    case 'weekreview': return bank.weekReviewPool(arg);
    case 'review': return bank.reviewPool();
    case 'daily': return bank.dailyPool();
    case 'ids': return String(arg).split(',').filter(id => bank.getQuestion(id));
    default: return [];
  }
}

function label(mode, arg) {
  switch (mode) {
    case 'week': return `Week ${arg}`;
    case 'weekreview': return `Week ${arg} · Review`;
    case 'review': return 'Review';
    case 'daily': return 'Daily Quiz';
    default: return 'Drill';
  }
}

/* ---------- lifecycle ---------- */

export function start(mode, arg = '') {
  const ids = buildPool(mode, arg);
  if (!ids.length) {
    toast('Nothing to drill here yet.');
    return;
  }
  state = { mode, arg: String(arg), ids, idx: 0, results: [], date: store.today(), done: false };
  store.setSession(state);
  store.touchStreak();
  const suffix = String(arg) ? `/${encodeURIComponent(String(arg))}` : '';
  router.go(`/drill/${mode}${suffix}`);
}

/** Route handler for #/drill/:mode(/:arg) */
export function renderDrill({ mode, arg = '' }) {
  // A finished session must not be resumed — it would bounce straight back
  // to the summary instead of starting a fresh set.
  if (!matches(state, mode, arg) || state.done) {
    const saved = store.getSession();
    state = matches(saved, mode, arg) && !saved.done ? saved : null;
  }
  if (!state) {
    const ids = buildPool(mode, arg);
    if (!ids.length) {
      chrome.setHeader(null);
      chrome.setTabbar(true);
      toast('Nothing to drill here yet.');
      router.go('/', { replace: true });
      return;
    }
    state = { mode, arg: String(arg), ids, idx: 0, results: [], date: store.today(), done: false };
    store.setSession(state);
    store.touchStreak();
  }

  // A bank update could retire a question mid-session.
  state.ids = state.ids.filter(id => bank.getQuestion(id));
  if (!state.ids.length) { router.go('/', { replace: true }); return; }
  if (state.idx >= state.ids.length) { finish(); return; }

  chrome.showScreen('screen-drill');
  chrome.setTabbar(false);
  renderQuestion();
}

function matches(s, mode, arg) {
  return Boolean(s) && s.mode === mode && s.arg === String(arg) && Array.isArray(s.ids) && s.ids.length > 0;
}

/* ---------- question ---------- */

function renderQuestion() {
  const q = bank.getQuestion(state.ids[state.idx]);
  const n = state.ids.length;

  chrome.setHeader({
    title: `${state.idx + 1} of ${n}`,
    left: { text: 'Close', onClick: () => exitDrill() },
    progress: state.idx / n,
  });

  const options = el('div', { class: 'options' },
    q.options.map((opt, i) => el('button', {
      class: 'option',
      type: 'button',
      'data-i': i,
      onclick: () => answer(i),
    },
      el('span', { class: 'option__text', html: mathtext(opt) }),
      i === q.answer ? checkmark() : crossmark()
    ))
  );

  clear($('#drill-body')).append(
    el('div', {},
      el('span', { class: 'drill__kind', text: q.kind === 'compute' ? 'Calculate' : 'Concept' }),
      el('h2', { class: 'drill__prompt', html: mathtext(q.prompt) }),
      el('p', { class: 'drill__topic', text: `${label(state.mode, state.arg)} · ${q.topic}` })
    ),
    options
  );
  $('#main').scrollTop = 0;
}

function answer(picked) {
  const q = bank.getQuestion(state.ids[state.idx]);
  const isCorrect = picked === q.answer;

  const options = $('#drill-body .options');
  options.classList.add('is-locked');
  for (const btn of options.children) {
    const i = Number(btn.dataset.i);
    if (i === q.answer) btn.classList.add('is-correct');
    else if (i === picked) btn.classList.add('is-wrong');
    else btn.classList.add('is-muted');
  }

  store.recordAnswer(q.id, picked, isCorrect);
  state.results.push({ id: q.id, picked, correct: isCorrect });
  store.setSession(state);
  tick(isCorrect);

  $('#drill-body').append(buildReveal(q, picked, isCorrect));
  requestAnimationFrame(() => {
    $('#drill-body').lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  });
}

function buildReveal(q, picked, isCorrect) {
  const last = state.idx === state.ids.length - 1;
  return el('div', { class: 'reveal' },
    el('div', { class: `reveal__verdict ${isCorrect ? 'is-correct' : 'is-wrong'}` },
      isCorrect ? 'Correct' : 'Not quite'),
    el('p', { class: 'reveal__body', html: mathtext(q.explanation) }),
    el('div', { class: 'reveal__actions' },
      el('button', {
        class: 'btn btn--primary',
        type: 'button',
        text: last ? 'See results' : 'Continue',
        onclick: advance,
      }),
      !isCorrect && el('button', {
        class: 'btn btn--quiet',
        type: 'button',
        text: 'Ask Claude about this',
        // Must stay synchronous: iOS rejects clipboard writes after an await.
        onclick: () => copyAskClaude(q, picked),
      })
    )
  );
}

function advance() {
  state.idx += 1;
  if (state.idx >= state.ids.length) { finish(); return; }
  store.setSession(state);
  renderQuestion();
}

function exitDrill() {
  // Keep the session so re-entering resumes; answers are already saved.
  store.setSession(state);
  const home = state.mode === 'week' || state.mode === 'weekreview' ? `/week/${state.arg}` : '/';
  router.go(home, { replace: true });
}

function finish() {
  state.done = true;
  store.setSession(state);
  if (state.mode === 'daily') {
    const correct = state.results.filter(r => r.correct).length;
    store.setDaily({ date: store.today(), done: true, score: correct, total: state.ids.length });
  }
  router.go('/summary', { replace: true });
}

/* ---------- summary ---------- */

export function renderSummary() {
  const s = matches(state, state?.mode, state?.arg) ? state : store.getSession();
  if (!s || !s.results?.length) { router.go('/', { replace: true }); return; }
  state = s;

  const total = s.results.length;
  const correct = s.results.filter(r => r.correct).length;
  const missed = s.results.filter(r => !r.correct);
  const pct = total ? correct / total : 0;
  const home = s.mode === 'week' || s.mode === 'weekreview' ? `/week/${s.arg}` : '/';

  chrome.showScreen('screen-summary');
  chrome.setTabbar(false);
  chrome.setHeader({ title: label(s.mode, s.arg), right: { text: 'Done', onClick: () => leaveSummary(home) } });

  const headline = pct === 1 ? 'Clean sweep.'
    : pct >= 0.8 ? 'Strong set.'
    : pct >= 0.5 ? 'Solid — with gaps.'
    : 'Worth another pass.';

  clear($('#screen-summary')).append(
    el('div', { class: 'center', style: { paddingTop: 'var(--sp-5)' } },
      bigRing(pct, `${correct}/${total}`, 116),
      el('h2', { class: 'title2', style: { marginTop: 'var(--sp-4)' }, text: headline }),
      el('p', { class: 'subhead', text: `${plural(correct, 'correct')} out of ${total}` })
    ),

    missed.length
      ? el('div', { style: { marginTop: 'var(--sp-5)' } },
          el('p', { class: 'section-label', text: `Missed · ${missed.length}` }),
          el('div', { class: 'list' }, missed.map(r => missedRow(r)))
        )
      : el('div', { class: 'empty', style: { marginTop: 'var(--sp-4)' } },
          el('p', { class: 'empty__body', text: 'Nothing missed. These questions are on their way out of your review pile.' })
        ),

    el('div', { class: 'stack', style: { marginTop: 'var(--sp-5)' } },
      missed.length
        ? el('button', {
            class: 'btn btn--primary',
            type: 'button',
            text: `Redo these ${missed.length} now`,
            onclick: () => start('ids', missed.map(r => r.id).join(',')),
          })
        : null,
      el('button', { class: 'btn btn--secondary', type: 'button', text: 'Done', onclick: () => leaveSummary(home) })
    )
  );
}

function missedRow(result) {
  const q = bank.getQuestion(result.id);
  if (!q) return null;
  const row = el('button', { class: 'list__row', type: 'button', 'data-tappable': 'true' },
    statusDot(store.stateOf(q.id)),
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title', style: { whiteSpace: 'normal' }, html: mathtext(q.prompt) }),
      el('div', { class: 'list__sub', text: q.topic })
    )
  );
  let open = false;
  let detail = null;
  row.addEventListener('click', () => {
    open = !open;
    if (open) {
      detail = el('div', { style: { padding: '0 var(--sp-4) var(--sp-4)' } },
        el('p', { class: 'footnote', style: { color: 'var(--correct)' }, html: `Answer: ${mathtext(q.options[q.answer])}` }),
        el('p', { class: 'reveal__body', style: { fontSize: '15px' }, html: mathtext(q.explanation) }),
        el('button', {
          class: 'btn btn--quiet',
          type: 'button',
          text: 'Ask Claude about this',
          onclick: ev => { ev.stopPropagation(); copyAskClaude(q, result.picked); },
        })
      );
      row.after(detail);
    } else {
      detail?.remove();
      detail = null;
    }
  });
  return row;
}

function leaveSummary(home) {
  store.clearSession();
  state = null;
  router.go(home, { replace: true });
}

/* ---------- answer sound (optional, off by default) ---------- */

let audioCtx = null;

function tick(isCorrect) {
  if (!store.getMeta().sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = isCorrect ? 880 : 300;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.13);
  } catch { /* audio is a nicety, never a failure path */ }
}
