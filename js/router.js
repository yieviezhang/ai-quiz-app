/* Hash router.
 *
 * Hash routing is not a style choice here. GitHub Pages has no SPA fallback,
 * so path routes 404 on deep links; and in iOS standalone mode there is no
 * address bar and no back button, so the left-edge swipe-back gesture only
 * works if real same-document history entries exist.
 */

const routes = [];
const scrollPositions = new Map();
let currentPath = null;
let notFound = null;

function compile(pattern) {
  const keys = [];
  const source = pattern.replace(/:([A-Za-z]\w*)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { re: new RegExp(`^${source}$`), keys };
}

export function route(pattern, handler) {
  routes.push({ ...compile(pattern), handler, pattern });
}

export function fallback(handler) {
  notFound = handler;
}

export const path = () => {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
};

function main() {
  return document.getElementById('main');
}

export function go(to, { replace = false } = {}) {
  const hash = to.startsWith('#') ? to : `#${to}`;
  if (location.hash === hash) { resolve(); return; }
  if (replace) location.replace(hash);
  else location.hash = hash;
}

export function back() {
  if (history.length > 1) history.back();
  else go('/', { replace: true });
}

function resolve() {
  const p = path();

  // Remember where we were before swapping screens.
  if (currentPath != null) scrollPositions.set(currentPath, main()?.scrollTop || 0);
  currentPath = p;

  for (const r of routes) {
    const m = p.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    r.handler(params, p);
    restoreScroll(p);
    return;
  }
  notFound?.(p);
}

function restoreScroll(p) {
  const el = main();
  if (!el) return;
  // Drill screens always start at the top; lists remember their place.
  const y = p.startsWith('/drill') || p.startsWith('/summary') ? 0 : (scrollPositions.get(p) || 0);
  requestAnimationFrame(() => { el.scrollTop = y; });
}

export function resetScroll(p = currentPath) {
  scrollPositions.delete(p);
  const el = main();
  if (el) el.scrollTop = 0;
}

export function start() {
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.replace('#/');
  resolve();
}

export const currentRoute = () => currentPath;
