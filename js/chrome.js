/* App chrome: which screen is visible, the blurred header, the tab bar.
 * Its own module so quiz.js and app.js can both drive it without a cycle. */

import { $, $$, el, clear } from './ui.js';

export function showScreen(id) {
  for (const s of $$('.screen')) s.classList.toggle('is-active', s.id === id);
}

/**
 * @param {{title?:string, left?:{text:string,onClick:Function}, right?:object, progress?:number|null}} cfg
 * Pass null to hide the header entirely (screens with a large title).
 */
export function setHeader(cfg) {
  const header = $('#header');
  if (!cfg) {
    header.hidden = true;
    return;
  }
  header.hidden = false;
  $('#header-title').textContent = cfg.title || '';
  for (const [slot, spec] of [['#header-left', cfg.left], ['#header-right', cfg.right]]) {
    const box = clear($(slot));
    if (spec) box.append(el('button', { class: 'btn-text', type: 'button', onclick: spec.onClick, text: spec.text }));
  }
  const bar = $('#drill-progress');
  if (typeof cfg.progress === 'number') {
    bar.hidden = false;
    bar.firstElementChild.style.width = `${Math.round(Math.max(0, Math.min(1, cfg.progress)) * 100)}%`;
  } else {
    bar.hidden = true;
  }
}

export function setTabbar(visible, activeRoute = null) {
  const bar = $('#tabbar');
  bar.hidden = !visible;
  for (const btn of $$('.tabbar__item')) {
    btn.classList.toggle('is-active', btn.dataset.route === activeRoute);
  }
}

/** Header hairline appears only once content scrolls under it. */
export function watchScroll() {
  const main = $('#main');
  const header = $('#header');
  main.addEventListener('scroll', () => {
    header.classList.toggle('is-scrolled', main.scrollTop > 4);
  }, { passive: true });
}
