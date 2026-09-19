# Setting up cloud sync

One-time setup, ~10 minutes, all in a web browser. No command line, no Node, no
credit card. After this, your progress backs itself up after every set of
questions and reconciles every time you open the app.

You are creating a tiny private endpoint that stores one JSON blob. That's the
whole thing.

---

## 1. Make a Cloudflare account

Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). The
free plan is permanent and far more than enough — this app uses a handful of
reads and writes a day against a limit of 100,000.

You do **not** need a domain name.

## 2. Create the storage

In the sidebar: **Storage & Databases → KV → Create a namespace**

- Namespace name: `ai-quiz`

Create it. That's all — you never touch it again.

## 3. Create the Worker

In the sidebar: **Compute (Workers) → Create → Start with Hello World**

- Name: `ai-quiz-sync`

Click **Deploy**. It now exists but does nothing useful.

## 4. Paste in the code

Click **Edit code** (or the `</>` icon). Delete everything in the editor, then
paste the entire contents of [`worker/sync-worker.js`](worker/sync-worker.js).

Click **Deploy**.

## 5. Connect the storage to the Worker

This is the step that's easy to miss, and skipping it is the only way this
setup fails.

Go to the Worker's **Settings → Bindings → Add binding → KV namespace**

- Variable name: `AIQUIZ`  ← must be exactly this, capitals included
- KV namespace: `ai-quiz`

Save, then **Deploy** again so the binding takes effect.

## 6. Check it works

Your Worker has a URL like:

```
https://ai-quiz-sync.<your-subdomain>.workers.dev
```

Open it in a browser. You should see:

```json
{"ok":true,"service":"ai-quiz-sync"}
```

If you see that, you're done with Cloudflare.

## 7. Connect the app

In the app: **Settings → Cloud sync**, paste that URL, tap **Connect**.

The app generates a random 32-character token, appends it to the URL, and keeps
the result on your device. It immediately tests the round-trip and tells you
whether it worked.

## Adding a second device

Do **not** repeat the setup. On the device that already works:

**Settings → Cloud sync → Copy sync link**

Paste that full link (the one ending in `/s/<token>`) into the new device's
Cloud sync field. Both devices now share one record, merged.

---

## What to know about the security of this

Access is a **capability URL**: whoever has the full link can read and write
your quiz progress. There is no password because there is no account.

- The token is 32 random characters. Nobody guesses that.
- The app never puts the sync URL into an export blob, so pasting an export
  into a chat can't leak write access.
- The Cloudflare URL is not in the public GitHub repo — it lives only in your
  phone's localStorage.

What's actually at stake if it leaked: which quiz questions you got wrong.
That's the trade-off being made, and it's a reasonable one here. Don't reuse
this pattern for anything you'd mind losing.

If you ever want to rotate it: **Turn off sync**, then connect again with the
bare Worker URL. That generates a fresh token. The old record stays in KV
unreferenced; delete it from the Cloudflare KV dashboard if you care.

## What happens when

| Situation | Behaviour |
|---|---|
| You finish a set of questions | Pushes about a second later |
| You open the app | Pulls, merges, pushes back |
| You return to the app after a minute away | Same, throttled to once a minute |
| You're offline | Drilling works normally; syncs when you're back |
| Two devices both have new progress | Merged per question — higher attempt count wins, later date wins the outcome. Nothing is deleted. |
| Sync is broken or misconfigured | A red dot and the actual error in Settings. Drilling is never blocked. |

Manual **Copy progress** stays available and unchanged. Sync is a convenience
on top of it, not a replacement — if Cloudflare ever went away, a pasted blob
still restores everything.
