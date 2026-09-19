/**
 * Cloudflare Worker: progress sync for AI Quiz.
 *
 * Paste this whole file into the Cloudflare dashboard worker editor and bind a
 * KV namespace as `AIQUIZ`. See ../SYNC.md for the click-by-click steps.
 *
 * There is no account, no password, and no secret stored here. Access is a
 * capability URL: the app generates a 32-character random token and keeps it on
 * your device, and that token is the KV key. Anyone who has the full URL can
 * read and write that one record — which is why the app never puts the sync URL
 * into an export blob. For quiz progress this is the right trade-off; don't
 * reuse the pattern for anything you'd mind leaking.
 */

const MAX_BYTES = 512 * 1024;

const CORS = {
  // The app is served from github.io while this runs on workers.dev, so CORS
  // is mandatory. The token in the path is what actually gates access.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const { pathname } = new URL(request.url);
    if (pathname === '/' || pathname === '') {
      return json({ ok: true, service: 'ai-quiz-sync' });
    }

    const match = pathname.match(/^\/s\/([A-Za-z0-9_-]{24,64})$/);
    if (!match) return json({ error: 'not_found' }, 404);
    const key = `progress:${match[1]}`;

    if (!env.AIQUIZ) {
      return json({ error: 'kv_not_bound', hint: 'Bind a KV namespace named AIQUIZ' }, 500);
    }

    if (request.method === 'GET') {
      const stored = await env.AIQUIZ.get(key);
      if (!stored) return json({ empty: true });
      return new Response(stored, {
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'too_large' }, 413);
      let blob;
      try {
        blob = JSON.parse(text);
      } catch {
        return json({ error: 'bad_json' }, 400);
      }
      if (blob?.app !== 'ai-quiz-app') return json({ error: 'wrong_app' }, 400);
      await env.AIQUIZ.put(key, text);
      return json({ ok: true, savedAt: new Date().toISOString(), bytes: text.length });
    }

    if (request.method === 'DELETE') {
      await env.AIQUIZ.delete(key);
      return json({ ok: true, deleted: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  },
};
