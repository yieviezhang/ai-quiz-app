# AI Quiz

An offline iPhone drilling app for AI/ML interview prep — vectors through LLMs,
one multiple-choice question at a time. Built for fragmented time: subway,
queues, waiting rooms.

Vanilla HTML/CSS/ES modules. No build step, no npm, no framework, no CDN.

## Install on the phone

1. Open the deployed URL in **Safari** (not Chrome — only Safari can install).
2. Share button → **Add to Home Screen**.
3. Launch from the home screen. It runs full-screen with no address bar and
   works with no network.

## Local development

```sh
./serve.sh          # http://localhost:8080, prints the LAN URL too
```

Open the LAN URL on the phone to test layout on the real device. One caveat:
clipboard writes need a secure context, so **Copy progress** and **Ask Claude**
only work on `localhost` or the deployed HTTPS URL, not over a LAN IP.

While developing, keep the service worker out of the way: it caches your bugs.
In Safari DevTools → Storage → Service Workers → Unregister, or just use a
private window.

### Tests

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
  -m tools/selftest.mjs
```

Covers the content bank, the review rule, pool building, and export/import
round-trips. The UI itself is verified by hand on the phone.

### Icons

```sh
python3 tools/make-icons.py
```

## How it works

### The three drill modes

| Mode | Pool |
|---|---|
| **Daily Quiz** | 4 from your review pile (oldest first) + 4 unseen from the week you're furthest along in + 2 random. Seeded by the date, so reloading doesn't reshuffle it. |
| **Week** | That week's questions in authored order, or just the ones you keep missing. |
| **Review** | Everything you've missed and not yet recovered, outright-wrong first. |

### Mastery

A question is **mastered** when you have a perfect record on it, or you've
gotten it right twice in a row since your last miss. Anything attempted and not
mastered sits in **Review** until you recover it. No spaced-repetition
intervals — on a bank this size, due-date scheduling just produces an empty
queue.

### Where your progress lives

Progress is in **localStorage**. The question bank is in **Cache Storage**.
They're separate storage systems, so shipping new questions physically cannot
wipe your history. The load-bearing piece is that question IDs (`w01-q007`) are
stable and append-only — see [AUTHORING.md](AUTHORING.md).

What can still lose it: clearing Safari website data, deleting the home-screen
app, or iOS evicting storage from an app you haven't opened in weeks. So:

- **Settings → Copy progress** puts a small JSON blob on your clipboard. Paste
  it anywhere — Notes, a chat, a file.
- **Restore from a backup** pastes it back. *Merge* is the default and keeps
  whichever record has more attempts; *Replace* overwrites.
- Today nags you passively once a backup is more than 7 days old.

That same blob is readable by Claude, which is the point: paste it into a chat
and ask which topics you keep missing.

### Cloud sync (optional)

Manual export is a backup you have to remember. Sync is the same thing without
the remembering: **Settings → Cloud sync**, paste a Cloudflare Worker URL, and
progress reconciles on launch, on resume, and a second after each finished set.

Setup is ~10 minutes in a browser, free, no credit card —
see [SYNC.md](SYNC.md).

Notes on the design:

- localStorage stays the source of truth. Drilling works entirely offline; sync
  is a background pull → merge → push on top of it.
- Pulls **merge**, never replace, so a stale cloud record can't roll you back.
- Auth is a capability URL: the app generates a random 32-character token and
  keeps the full link only in device localStorage. Nothing about sync is in this
  repo, and `buildExport()` whitelists meta fields so the URL can never leak
  into an export blob you paste into a chat.
- Sync failures are shown in Settings and never block drilling.

### Ask Claude

There is no AI inside the app — it would mean shipping an API key in a public
repo. Instead, a wrong answer offers **Ask Claude about this**, which copies the
question, your pick, the correct answer, and your miss pattern to the clipboard.
Paste it into the Claude iOS app.

### Updating

`VERSION` in `sw.js` is the entire deploy ritual. Bump it, push, and the
installed app shows an "Update available" pill next time you open it. It never
swaps assets underneath a running page.

## Deploy to GitHub Pages

```sh
git add -A && git commit -m "…" && git push
```

Repo Settings → Pages → Source: `main` / root. The `.nojekyll` file stops Pages
from mangling paths. Every asset reference in this project is relative (`./x`),
which is required because Pages serves from a subpath. GitHub Pages is
case-sensitive and macOS is not, so `Week-01.json` would work locally and 404 in
production.

## Content status

| Weeks | Status |
|---|---|
| 1–3 | 49 questions — vectors, matrices, derivatives, chain rule, backprop |
| 4–12 | Titles shown as a roadmap, marked "Coming soon" |

Adding a week is a data change, not a code change. See
[AUTHORING.md](AUTHORING.md).
