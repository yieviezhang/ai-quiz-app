/* DOM helpers, progress ring, toast, chevron. No framework. */

export const $ = sel => document.querySelector(sel);
export const $$ = sel => Array.from(document.querySelectorAll(sel));

/** el('div', {class:'x', onclick:fn, html:'<b>'}, child, child) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Append, skipping conditional children.
 *
 * Native Element.append(null) stringifies its argument, so a `cond ? row :
 * null` branch renders a literal "null" into the page. el() already filters
 * these out; this is the same filtering for a node that already exists.
 */
export function appendAll(node, ...children) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  }
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';

export function chevron() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'chevron');
  svg.setAttribute('viewBox', '0 0 8 13');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M1 1l6 5.5L1 12');
  svg.append(p);
  return svg;
}

export function checkmark(cls = 'option__mark') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 22 22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M4 11.5l4.5 4.5L18 6');
  svg.append(p);
  return svg;
}

export function crossmark(cls = 'option__mark') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 22 22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  const g = document.createElementNS(SVG, 'g');
  for (const d of ['M6 6l10 10', 'M16 6L6 16']) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    g.append(p);
  }
  svg.append(g);
  return svg;
}

/**
 * SVG progress ring.
 * @param {number} pct 0..1
 * @param {number} size outer px
 */
export function ring(pct, size = 28, stroke = 3) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  for (const isFill of [false, true]) {
    const circ = document.createElementNS(SVG, 'circle');
    circ.setAttribute('class', isFill ? 'ring__fill' : 'ring__track');
    circ.setAttribute('cx', size / 2);
    circ.setAttribute('cy', size / 2);
    circ.setAttribute('r', r);
    circ.setAttribute('stroke-width', stroke);
    if (isFill) {
      circ.setAttribute('stroke-dasharray', c.toFixed(2));
      circ.setAttribute('stroke-dashoffset', (c * (1 - Math.max(0, Math.min(1, pct)))).toFixed(2));
    }
    svg.append(circ);
  }
  return svg;
}

export function bigRing(pct, label, size = 96) {
  return el('div', { class: 'ring-wrap' },
    ring(pct, size, 7),
    el('div', { class: 'ring-wrap__label', text: label })
  );
}

export function statusDot(state) {
  const cls = { mastered: 'dot dot--full', learning: 'dot dot--half', wrong: 'dot dot--wrong' }[state] || 'dot';
  return el('span', { class: cls, 'aria-hidden': true });
}

/* ---------- Toast ---------- */

let toastTimer = null;

export function toast(message, ms = 2200) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), ms);
}

/* ---------- Misc ---------- */

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function formatDateLong(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
}

/** Deterministic shuffle so a day's quiz is stable across reloads. */
export function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
