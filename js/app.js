/* Boot, routing, and the non-drill screens. */

import * as bank from './bank.js';
import * as store from './store.js';
import * as router from './router.js';
import * as chrome from './chrome.js';
import * as quiz from './quiz.js';
import * as share from './share.js';
import * as sync from './sync.js';
import { mathtext } from './mathtext.js';
import {
  $, $$, el, clear, appendAll, chevron, ring, bigRing, statusDot,
  toast, plural, formatDateLong,
} from './ui.js';

const APP_VERSION = '1.1.1';

/* ══════════════════════ Today ══════════════════════ */

function renderToday() {
  chrome.showScreen('screen-today');
  chrome.setHeader(null);
  chrome.setTabbar(true, '#/');

  const s = store.stats(bank.allIds());
  $('#today-date').textContent = formatDateLong();
  clear($('#today-ring')).append(
    ring(s.total ? s.mastered / s.total : 0, 44, 4),
    el('span', { class: 'caption', style: { position: 'absolute' }, text: `${s.mastered}` })
  );

  renderDailyHero();

  const reviewCount = bank.reviewPool().length;
  const cw = bank.currentWeek();
  const cwStats = cw ? bank.weekStats(cw) : null;

  appendAll(clear($('#today-list')),
    el('button', { class: 'list__row', type: 'button', 'data-tappable': 'true', onclick: () => router.go('/review') },
      el('div', { class: 'list__thumb', style: { background: reviewCount ? 'linear-gradient(135deg,#FF8A8E,#E5484D)' : 'var(--bg-raised)', color: reviewCount ? '#fff' : 'var(--text-tertiary)' }, html: '&#8635;' }),
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title', text: 'Review' }),
        el('div', { class: 'list__sub', text: reviewCount ? `${plural(reviewCount, 'question')} to fix` : 'Nothing to review' })
      ),
      el('div', { class: 'list__trail' },
        reviewCount ? el('span', { class: 'badge', text: String(reviewCount) }) : null,
        chevron())
    ),
    el('button', { class: 'list__row', type: 'button', 'data-tappable': 'true', onclick: () => router.go('/weeks') },
      el('div', { class: 'list__thumb', text: cw ? String(cw) : '—' }),
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title', text: 'Weeks' }),
        el('div', {
          class: 'list__sub',
          text: cwStats ? `Week ${cw} · ${cwStats.mastered}/${cwStats.total} mastered` : 'Pick a week to drill',
        })
      ),
      el('div', { class: 'list__trail' }, chevron())
    )
  );

  clear($('#today-stats')).append(
    statCell(String(s.streakDays), 'day streak'),
    statCell(`${s.mastered}`, 'mastered'),
    statCell(s.answered ? `${Math.round(s.accuracy * 100)}%` : '—', 'accuracy')
  );

  renderExportNag();
}

function statCell(value, label) {
  return el('div', { class: 'stats__cell' },
    el('div', { class: 'stats__value', text: value }),
    el('div', { class: 'stats__label', text: label })
  );
}

function renderDailyHero() {
  const done = store.getDaily();
  const session = store.getSession();
  const live = session && session.mode === 'daily' && session.date === store.today() && !session.done
    ? session : null;

  const hero = $('#daily-hero');
  const bar = $('#daily-bar');

  if (live) {
    $('#daily-title').textContent = 'Pick up where you left off';
    $('#daily-sub').textContent = `${live.idx} of ${live.ids.length} answered`;
    bar.hidden = false;
    bar.firstElementChild.style.width = `${Math.round((live.idx / live.ids.length) * 100)}%`;
    $('#daily-cta').textContent = 'Continue →';
    hero.onclick = () => router.go('/drill/daily');
  } else if (done?.done) {
    $('#daily-title').textContent = `Done · ${done.score}/${done.total}`;
    $('#daily-sub').textContent = 'Come back tomorrow, or drill another set now.';
    bar.hidden = false;
    bar.firstElementChild.style.width = '100%';
    $('#daily-cta').textContent = 'Drill again →';
    hero.onclick = () => quiz.start('daily');
  } else {
    const n = Math.min(bank.DAILY_SIZE, bank.allIds().length);
    $('#daily-title').textContent = `${plural(n, 'question')}`;
    $('#daily-sub').textContent = 'Your weak spots, plus something new.';
    bar.hidden = true;
    $('#daily-cta').textContent = 'Start →';
    hero.onclick = () => quiz.start('daily');
  }
}

function renderExportNag() {
  const box = clear($('#export-nag'));
  const days = store.daysSinceExport();
  const answered = store.stats(bank.allIds()).answered;
  if (answered < 5) return;
  if (days !== null && days < 7) return;

  box.append(el('button', {
    class: 'list__row',
    type: 'button',
    'data-tappable': 'true',
    style: { borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' },
    onclick: () => share.exportToClipboard(),
  },
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title', text: 'Back up your progress' }),
      el('div', {
        class: 'list__sub',
        text: days === null
          ? "You haven't backed up yet. One tap copies it."
          : `Last backup was ${plural(days, 'day')} ago.`,
      })
    ),
    el('div', { class: 'list__trail' }, el('span', { class: 'badge badge--soft', text: 'Copy' }))
  ));
}

/* ══════════════════════ Weeks ══════════════════════ */

function renderWeeks() {
  chrome.showScreen('screen-weeks');
  chrome.setHeader(null);
  chrome.setTabbar(true, '#/weeks');

  const list = clear($('#weeks-list'));
  for (const w of bank.allWeeks()) {
    list.append(bank.isAuthored(w) ? authoredWeekRow(w) : emptyWeekRow(w));
  }
}

function authoredWeekRow(w) {
  const s = bank.weekStats(w.week);
  return el('button', {
    class: 'list__row', type: 'button', 'data-tappable': 'true',
    onclick: () => router.go(`/week/${w.week}`),
  },
    el('div', { class: 'list__thumb', text: String(w.week) }),
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title', text: w.title }),
      el('div', { class: 'list__sub', text: `${plural(s.total, 'question')} · ${s.mastered} mastered` })
    ),
    el('div', { class: 'list__trail' }, ring(s.pct, 28, 3), chevron())
  );
}

function emptyWeekRow(w) {
  return el('div', {
    class: 'list__row is-dim',
    onclick: () => toast(`Week ${w.week} questions haven't been written yet.`),
  },
    el('div', { class: 'list__thumb list__thumb--empty', text: String(w.week) }),
    el('div', { class: 'list__body' },
      el('div', { class: 'list__title', text: w.title }),
      el('div', { class: 'list__sub', text: 'Coming soon' })
    )
  );
}

/* ══════════════════════ Week detail ══════════════════════ */

function renderWeekDetail({ n }) {
  const w = bank.getWeek(n);
  if (!w || !bank.isAuthored(w)) { router.go('/weeks', { replace: true }); return; }

  chrome.showScreen('screen-week');
  chrome.setTabbar(true, '#/weeks');
  chrome.setHeader({ title: `Week ${w.week}`, left: { text: '‹ Weeks', onClick: () => router.back() } });

  const s = bank.weekStats(w.week);

  appendAll(clear($('#screen-week')),
    el('div', {},
      el('h1', { class: 'large-title', text: w.title }),
      w.topics?.length
        ? el('div', { class: 'chips', style: { marginTop: 'var(--sp-3)' } },
            w.topics.map(t => el('span', { class: 'chip', text: t })))
        : null
    ),

    el('div', { class: 'stats', style: { marginTop: 'var(--sp-5)' } },
      statCell(String(s.mastered), 'mastered'),
      statCell(String(s.inReview), 'to fix'),
      statCell(String(s.unseen), 'new')
    ),

    el('div', { class: 'stack', style: { marginTop: 'var(--sp-5)' } },
      el('button', {
        class: 'btn btn--primary', type: 'button',
        text: `Drill all ${s.total} questions`,
        onclick: () => quiz.start('week', w.week),
      }),
      s.inReview
        ? el('button', {
            class: 'btn btn--secondary', type: 'button',
            text: `Drill ${plural(s.inReview, 'question')} to fix`,
            onclick: () => quiz.start('weekreview', w.week),
          })
        : null
    ),

    el('p', { class: 'section-label', style: { marginTop: 'var(--sp-5)' }, text: 'Questions' }),
    el('div', { class: 'list' }, w.questions.map((q, i) => el('div', { class: 'list__row' },
      statusDot(store.stateOf(q.id)),
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title', style: { whiteSpace: 'normal', fontSize: '15px' }, html: mathtext(q.prompt) }),
        el('div', { class: 'list__sub', text: `${i + 1} · ${q.topic}${q.kind === 'compute' ? ' · calculate' : ''}` })
      )
    )))
  );
}

/* ══════════════════════ Review ══════════════════════ */

function renderReview() {
  chrome.showScreen('screen-review');
  chrome.setHeader(null);
  chrome.setTabbar(true, '#/review');

  const ids = bank.reviewPool();
  const body = clear($('#review-body'));

  if (!ids.length) {
    body.append(el('div', { class: 'empty' },
      el('p', { class: 'empty__title', text: 'Nothing to review' }),
      el('p', { class: 'empty__body', text: 'Drill a week to find your weak spots. Anything you miss shows up here until you get it right twice in a row.' }),
      el('button', {
        class: 'btn btn--secondary', type: 'button', style: { marginTop: 'var(--sp-4)' },
        text: 'Browse weeks', onclick: () => router.go('/weeks'),
      })
    ));
    return;
  }

  const byWeek = new Map();
  for (const id of ids) {
    const q = bank.getQuestion(id);
    if (!byWeek.has(q.week)) byWeek.set(q.week, []);
    byWeek.get(q.week).push(q);
  }

  body.append(
    el('button', {
      class: 'btn btn--primary', type: 'button',
      text: `Drill all ${ids.length}`,
      onclick: () => quiz.start('review'),
    }),
    el('p', { class: 'footnote center', style: { marginTop: 'var(--sp-2)' } },
      'Get one right twice in a row and it leaves this list.'),
    ...[...byWeek.entries()].sort((a, b) => a[0] - b[0]).flatMap(([week, qs]) => [
      el('p', { class: 'section-label', style: { marginTop: 'var(--sp-5)' }, text: `Week ${week} · ${qs.length}` }),
      el('div', { class: 'list' }, qs.map(q => el('div', { class: 'list__row' },
        statusDot(store.stateOf(q.id)),
        el('div', { class: 'list__body' },
          el('div', { class: 'list__title', style: { whiteSpace: 'normal', fontSize: '15px' }, html: mathtext(q.prompt) }),
          el('div', { class: 'list__sub', text: reviewSubtitle(q.id) })
        )
      )))
    ])
  );
}

function reviewSubtitle(id) {
  const r = store.getRecord(id);
  if (!r) return '';
  const bits = [`${r.c}/${r.n} correct`];
  if (r.last === 0) bits.push('missed last time');
  else if (r.streak === 1) bits.push('one more to master');
  return bits.join(' · ');
}

/* ══════════════════════ Settings ══════════════════════ */

function renderSettings() {
  chrome.showScreen('screen-settings');
  chrome.setHeader(null);
  chrome.setTabbar(true, '#/settings');

  renderSyncSection();

  const s = store.stats(bank.allIds());
  const days = store.daysSinceExport();
  $('#import-hint').textContent = days === null
    ? 'Paste a previously copied blob below'
    : `Last backup: ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}`;

  $('#btn-share').hidden = !share.canShare();
  $('#sw-sound').setAttribute('aria-checked', String(Boolean(store.getMeta().sound)));

  const retired = store.retiredIds(bank.allSet());
  appendAll(clear($('#about-list')),
    infoRow('Questions', `${s.answered} answered of ${s.total}`),
    infoRow('App version', APP_VERSION),
    infoRow('Question bank', `v${bank.bankVersion() ?? '?'}`),
    retired.length
      ? el('button', { class: 'list__row', type: 'button', 'data-tappable': 'true',
          onclick: () => {
            const n = store.compact(bank.allSet());
            toast(`Removed ${plural(n, 'retired record')}.`);
            renderSettings();
          } },
          el('div', { class: 'list__body' },
            el('div', { class: 'list__title', text: 'Retired records' }),
            el('div', { class: 'list__sub', text: `${retired.length} kept from questions no longer in the bank` })
          ),
          el('div', { class: 'list__trail' }, el('span', { class: 'badge badge--neutral', text: 'Clear' }))
        )
      : null
  );
}

/* ---------- Cloud sync ---------- */

function relativeTime(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return 'never';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${plural(mins, 'minute')} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  return `${plural(Math.round(hours / 24), 'day')} ago`;
}

function renderSyncSection() {
  const box = clear($('#sync-list'));
  const st = sync.status();

  if (!st.enabled) {
    const input = el('input', {
      class: 'text-field', type: 'url', id: 'sync-url-input',
      placeholder: 'https://ai-quiz-sync.<you>.workers.dev',
      spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', inputmode: 'url',
    });
    box.append(el('div', { class: 'list__row', style: { flexDirection: 'column', alignItems: 'stretch', gap: 'var(--sp-3)' } },
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title', text: 'Not set up' }),
        el('div', { class: 'list__sub', style: { whiteSpace: 'normal' }, text: 'Paste your Cloudflare Worker URL to back up automatically. Setup steps are in SYNC.md.' })
      ),
      input,
      el('button', {
        class: 'btn btn--primary', type: 'button', style: { minHeight: '44px', fontSize: '15px' },
        text: 'Connect',
        onclick: async ev => {
          const res = sync.configure(input.value);
          if (!res.ok) { toast(res.message); return; }
          const btn = ev.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Testing…';
          const check = await sync.test();
          toast(check.message);
          if (!check.ok) sync.disable();
          renderSyncSection();
        },
      })
    ));
    return;
  }

  const dotClass = st.busy ? 'sync-dot sync-dot--busy'
    : st.error ? 'sync-dot sync-dot--err'
    : st.lastSyncAt ? 'sync-dot sync-dot--ok'
    : 'sync-dot';

  appendAll(box,
    // Deleting the app wipes localStorage, which holds the only copy of the
    // random sync token. The cloud record survives but becomes unreachable, so
    // this nags until the link has been saved somewhere outside the app.
    store.getMeta().syncLinkSaved ? null : el('div', { class: 'list__row' },
      el('span', { class: 'sync-dot sync-dot--err' }),
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title', text: 'Save your sync link' }),
        el('div', {
          class: 'list__sub', style: { whiteSpace: 'normal' },
          text: 'It is the only way back if you delete the app or change phones. Copy it below and keep it in Notes.',
        })
      )
    ),
    el('div', { class: 'list__row' },
      el('span', { class: dotClass }),
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title', text: st.error ? 'Sync problem' : 'Syncing automatically' }),
        el('div', {
          class: 'list__sub', style: { whiteSpace: 'normal' },
          text: st.error || `Last synced ${relativeTime(st.lastSyncAt)} · after every set and on every open`,
        })
      )
    ),
    el('button', {
      class: 'list__row', type: 'button', 'data-tappable': 'true',
      onclick: async ev => {
        const btn = ev.currentTarget;
        btn.querySelector('.list__title').textContent = 'Syncing…';
        await sync.syncNow();
        renderSyncSection();
        toast(sync.status().error || 'Synced.');
      },
    },
      el('div', { class: 'list__body' }, el('div', { class: 'list__title', text: 'Sync now' })),
      el('div', { class: 'list__trail' }, chevron())
    ),
    el('button', {
      class: 'list__row', type: 'button', 'data-tappable': 'true',
      // Sync URLs are capability URLs, so this is the only place one is exposed.
      onclick: () => {
        // copyText must be called synchronously in the handler — iOS silently
        // rejects a clipboard write that happens after an await.
        const ok = share.copyText(st.url);
        if (ok) {
          store.setMeta({ syncLinkSaved: store.today() });
          renderSyncSection();
        }
        toast(ok ? 'Sync link copied. Keep it in Notes — it restores everything.' : 'Copy failed.');
      },
    },
      el('div', { class: 'list__body' },
        el('div', { class: 'list__title', text: 'Copy sync link' }),
        el('div', { class: 'list__sub', style: { whiteSpace: 'normal' },
          text: 'Restores your progress on a new install. Anyone with the link can read it.' })
      ),
      el('div', { class: 'list__trail' }, el('span', { class: 'badge badge--soft', text: 'Copy' }))
    ),
    el('button', {
      class: 'list__row', type: 'button', 'data-tappable': 'true',
      onclick: () => {
        if (!confirm('Turn off sync? Your progress stays on this device, and the cloud copy is left untouched.')) return;
        sync.disable();
        renderSyncSection();
        toast('Sync turned off.');
      },
    },
      el('div', { class: 'list__body' }, el('div', { class: 'list__title', style: { color: 'var(--wrong)' }, text: 'Turn off sync' }))
    )
  );
}

function infoRow(title, value) {
  return el('div', { class: 'list__row' },
    el('div', { class: 'list__body' }, el('div', { class: 'list__title', text: title })),
    el('div', { class: 'list__trail' }, el('span', { class: 'footnote', text: value }))
  );
}

function wireSettings() {
  $('#btn-export').addEventListener('click', () => { share.exportToClipboard(); renderSettings(); });
  $('#btn-share').addEventListener('click', () => { share.shareExport().then(renderSettings); });

  for (const [id, mode] of [['#btn-import-merge', 'merge'], ['#btn-import-replace', 'replace']]) {
    $(id).addEventListener('click', () => {
      const box = $('#import-box');
      const text = box.value.trim();
      if (!text) { toast('Paste a backup blob first.'); return; }
      if (mode === 'replace' && !confirm('Replace all local progress with this backup? Your current progress will be lost.')) return;
      const res = store.importBlob(text, mode);
      toast(res.message);
      if (res.ok) { box.value = ''; renderSettings(); }
    });
  }

  $('#sw-sound').addEventListener('click', ev => {
    const on = ev.currentTarget.getAttribute('aria-checked') !== 'true';
    store.setMeta({ sound: on });
    ev.currentTarget.setAttribute('aria-checked', String(on));
  });

  let resetArmed = false;
  const resetBtn = $('#btn-reset');
  resetBtn.addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.textContent = 'Tap again to erase everything';
      setTimeout(() => {
        resetArmed = false;
        resetBtn.textContent = 'Reset all progress';
      }, 4000);
      return;
    }
    store.resetAll();
    resetArmed = false;
    resetBtn.textContent = 'Reset all progress';
    toast('All progress erased.');
    renderSettings();
  });
}

/* ══════════════════════ Service worker ══════════════════════ */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then(reg => {
      const offerUpdate = worker => {
        if (!worker || !navigator.serviceWorker.controller) return;
        showUpdatePill(() => worker.postMessage({ type: 'SKIP_WAITING' }));
      };
      if (reg.waiting) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed') offerUpdate(next);
        });
      });

      // A home-screen PWA gets resumed, not reloaded, for weeks. Without this
      // you would never see an update.
      let lastCheck = 0;
      const check = () => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - lastCheck < 3600000) return;
        lastCheck = Date.now();
        reg.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', check);
      check();
    })
    .catch(err => console.warn('SW registration failed', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdatePill(onTap) {
  if (document.getElementById('update-pill')) return;
  const pill = el('button', {
    class: 'update-pill', id: 'update-pill', type: 'button',
    text: 'Update available — tap to reload',
    onclick: () => { pill.disabled = true; pill.textContent = 'Updating…'; onTap(); },
  });
  document.body.append(pill);
}

/* ══════════════════════ Boot ══════════════════════ */

/** Re-render whatever screen is showing — a sync can change progress under it. */
function refreshCurrent() {
  const p = router.currentRoute();
  if (p === '/') renderToday();
  else if (p === '/weeks') renderWeeks();
  else if (p === '/review') renderReview();
  else if (p === '/settings') renderSettings();
  else if (p?.startsWith('/week/')) renderWeekDetail({ n: p.split('/')[2] });
}

async function boot() {
  store.init();
  chrome.watchScroll();
  wireSettings();

  for (const btn of $$('.tabbar__item')) {
    btn.addEventListener('click', () => router.go(btn.dataset.route));
  }

  try {
    await bank.load();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = '<div class="empty" style="padding:80px 24px"><p class="empty__title">Could not load the question bank</p><p class="empty__body">Check your connection and reopen the app.</p></div>';
    return;
  }

  router.route('/', renderToday);
  router.route('/weeks', renderWeeks);
  router.route('/week/:n', renderWeekDetail);
  router.route('/review', renderReview);
  router.route('/drill/:mode', quiz.renderDrill);
  router.route('/drill/:mode/:arg', quiz.renderDrill);
  router.route('/summary', quiz.renderSummary);
  router.route('/settings', renderSettings);
  router.fallback(() => router.go('/', { replace: true }));
  router.start();

  // A sync can merge in progress from another device, so redraw when it lands.
  sync.onChange(st => { if (!st.busy) refreshCurrent(); });
  sync.install();

  registerServiceWorker();
}

boot();
