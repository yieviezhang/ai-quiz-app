# Authoring the question bank

> **The one rule that protects the learner's history:** a cosmetic edit (typo,
> clearer wording, better explanation) bumps `rev` and keeps the same `id`.
> **If an edit changes which option is correct, retire the old `id` and
> allocate a new one.** Wrong-answer history is keyed on `id`; reusing an id
> after moving the correct answer turns that history into a lie.

## Where things live

| File | Purpose |
|---|---|
| `data/index.json` | The 12-week list, `bankVersion`, and the `nextId` counters |
| `data/week-NN.json` | One week's questions |

A week with `"file": null` in `index.json` renders as "Coming soon" — the real
title still shows, so the 12-week arc reads as a roadmap. Making an empty week
real is: write `data/week-NN.json`, set its `file` and `count`, add the file to
the `PRECACHE` list in `sw.js`, bump `VERSION` in `sw.js`, bump `bankVersion` in
both `index.json` and `version.json`.

## IDs

Format `wNN-qNNN` — e.g. `w02-q014`. Allocated once, **append-only**, never
reused, never renumbered.

To add questions to week 2: read `nextId.w02` from `index.json`, use that number
and count up, then write the new `nextId.w02` back. Display order is array
position, so a new question can be *appended in ID space* while being *inserted
anywhere in the array*.

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

1. **~60% `concept`, ~40% `compute` per week.** Enforced by `tools/selftest.mjs`.
2. **Spread the correct-answer indices.** Roughly even across 0–3 per week; the
   self-test flags a lopsided distribution. Otherwise the answer becomes
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
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
  -m tools/selftest.mjs
```

It checks JSON validity, id format and uniqueness, `answer` in range,
`count` matching `index.json`, `nextId` correctness, the concept/compute mix,
and answer-index spread — plus the whole progress/review/export engine.

## Deploy checklist

1. Edit or add `data/week-NN.json`.
2. Update `count` and `nextId` in `data/index.json`; bump `bankVersion`.
3. Add any new data file to `PRECACHE` in `sw.js`.
4. Bump `VERSION` in `sw.js` and `bankVersion` in `version.json`.
5. Run the self-test.
6. Commit and push. The installed app shows an update pill on next open.

Step 4 is the one that bites. Without it, phones keep serving the old bank from
Cache Storage forever and nothing appears to have changed.
