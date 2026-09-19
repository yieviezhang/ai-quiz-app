# Authoring the question bank

> **The one rule that protects the learner's history:** a cosmetic edit (typo,
> clearer wording, better explanation) bumps `rev` and keeps the same `id`.
> **If an edit changes which option is correct, retire the old `id` and
> allocate a new one.** Wrong-answer history is keyed on `id`; reusing an id
> after moving the correct answer turns that history into a lie.

## The whole workflow

Adding questions is a **data-only change**. Write JSON, run one command:

```sh
python3 tools/bank.py next 4 10     # what ids may I use?
#   ... write the questions into data/week-04.json ...
python3 tools/bank.py release       # validate, derive everything, run tests
git add -A && git commit -m "Add week 4 questions" && git push
```

That's it. Nothing else is hand-maintained.

| Command | Does |
|---|---|
| `bank.py check` | Validates ids, schema, LaTeX leaks, mix, answer spread. Exit 1 on errors. |
| `bank.py next <week> [n]` | Prints the next free ids — never guess these. |
| `bank.py new <week>` | Scaffolds `data/week-NN.json` from the index title. |
| `bank.py sync` | Rewrites every derived field. Idempotent. |
| `bank.py stats` | Per-week table: count, concept %, answer distribution. |
| `bank.py release` | `check` → `sync` → self-test. Use this one. |

### What `sync` derives, so you never touch it

- per-week `count` and `file` in `index.json`
- the `nextId` counters
- `bankVersion` in `index.json` **and** `version.json` — bumped only when the
  questions actually changed, tracked by `contentHash`
- `const BANK` in `sw.js`, which is what busts Cache Storage

**Why that last one matters:** `sw.js` is fetched with `updateViaCache:'none'`,
so the browser only notices a new worker when *those bytes* change. A bank
update that left `sw.js` alone would leave every installed phone serving the old
questions forever. This used to be a manual step and it was the step that bit.

Week filenames are no longer listed in `sw.js` either — the worker reads them
from `data/index.json` at install time.

## Where things live

| File | Purpose |
|---|---|
| `data/index.json` | The 12-week list, `bankVersion`, `nextId`, `contentHash`. Mostly machine-maintained — you only ever edit `title`. |
| `data/week-NN.json` | One week's questions. The only file you write by hand. |

A week with `"file": null` in `index.json` renders as "Coming soon" — the real
title still shows, so the 12-week arc reads as a roadmap. A week becomes real
the moment its file has questions in it and you run `sync`; delete the file and
`sync` puts it back to "Coming soon". Neither direction touches code.

## IDs

Format `wNN-qNNN` — e.g. `w02-q014`. Allocated once, **append-only**, never
reused, never renumbered.

Ask for them: `python3 tools/bank.py next 2 5` prints the next five free ids for
week 2, derived from the high-water mark in the week file itself. Display order
is array position, so a new question can be *appended in ID space* while being
*inserted anywhere in the array*.

Deleting a question does **not** delete the learner's record of it. Orphaned
records stay in localStorage and in exports (so they come back if the question
does) and surface only as a "Retired records" row in Settings with a manual
Clear button.

## Question schema

```json
{
  "id": "w02-q014",
  "rev": 1,
  "kind": "compute",
  "topic": "power rule",
  "prompt": "What is the derivative of 5x² + 3x with respect to x?",
  "options": ["10x", "5x + 3", "10x + 3", "10x² + 3x"],
  "answer": 2,
  "explanation": "Differentiate each term separately …",
  "hint": "Handle each term on its own, then add the results."
}
```

| Field | Notes |
|---|---|
| `kind` | `"concept"` or `"compute"`. Drives the Concept/Calculate badge and the mix target below. |
| `options` | 4 options, or exactly `["True", "False"]`. No free text — this app is thumb-only. |
| `answer` | Stable 0-based index. **Options are never shuffled at runtime**, so this index stays referenceable from explanations and clipboard payloads. |
| `explanation` | Required. The reason the app exists. See below. |
| `hint` | Optional; currently authored but not yet surfaced in the UI. |

## Rules for good questions here

1. **~60% `concept`, ~40% `compute` per week.** Enforced by `bank.py check` and
   the self-test.
2. **Spread the correct-answer indices.** Roughly even across 0–3 per week;
   `bank.py stats` shows the distribution. Otherwise the answer becomes
   guessable from position alone.
3. **Distractors must be diagnostic, not filler.** Each wrong option should be
   the result of a specific, real mistake. For `[1,-2,3] + [4,5,-1]`:
   `[5,3,2]` correct, `[-3,-7,4]` = subtracted, `[5,-7,2]` = sign slip,
   `[4,-10,-3]` = multiplied. The explanation can then name the mistake back.
4. **Explanations name the error and then generalise.** Say what the right
   reasoning is, call out which distractor corresponds to which slip, and where
   there is one, land a connection to real NLP/LLM practice (attention scores,
   vanishing gradients, GPU memory). No rote restatement of the answer.
5. **Never require notation the phone can't render.** See the Unicode table.
6. **Options stay short** — they render in a 56px-tall tappable row.

## Math: Unicode only, no KaTeX

There is no LaTeX renderer. `js/mathtext.js` handles exactly three things:

| Write | Renders as |
|---|---|
| `` `[1, 2, 3]` `` | monospace chip |
| `x^2`, `e^{-x}` | superscript |
| `d_k`, `W_{ij}` | subscript |

Everything else is typed directly as a Unicode character:

```
‖v‖   · ×   ∑ Σ   ∏   ∂   ∇   √   ≈ ≠ ≤ ≥   ±   ∞
θ λ μ σ α β γ ε η   ᵀ   ⊙   →  ⇒   ⌈ ⌉
⁰¹²³⁴⁵⁶⁷⁸⁹ ⁻   ₀₁₂₃₄₅₆₇₈₉
```

So: `softmax(QKᵀ/√d_k)·V`, `‖v‖₂`, `∂L/∂w`, `0.25¹⁰ ≈ 0.00000095`.

**No stacked fractions.** Write `dy/dx`, not a vertical fraction. This is a
constraint worth accepting — stacked notation is unreadable at phone size
anyway.

## Before committing

```sh
python3 tools/bank.py release
```

`check` validates ids, schema, LaTeX leaks, unbalanced backticks, duplicate
prompts, the concept/compute mix and answer spread. `sync` then derives all the
bookkeeping. The self-test covers the progress/review/export engine and the
cross-consistency of `index.json` against the week files — it derives its
expected totals from the index, so a growing bank never breaks it.

Errors block the sync; warnings don't. `--strict` makes warnings fail too.

Then:

```sh
git add -A && git commit -m "…" && git push
```

The installed app shows an update pill on next open.

**Bumping `VERSION` in `sw.js` by hand is only for app code changes** — CSS, JS,
HTML. Question changes are handled by `sync` via `const BANK`.
