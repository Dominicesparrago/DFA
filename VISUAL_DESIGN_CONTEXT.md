
> **SUPERSEDED IN ITS FIGURE SECTIONS — read `SYSTEM_CONTEXT.md` first.**
> The DFA is now the **two-state** machine from the official brief:
> `Q = {q0, q1}`, start `q0`, accepting `q1`, no dead state, accepting every
> binary string that **ends in 1**.
>
> What is obsolete below, and the correct fact instead:
>
> | Obsolete here | Actual now |
> |---|---|
> | `q0…q3`, `qd`, a trap, "exactly 101" | two states, `q0` and `q1`, no dead state |
> | position markers `p1, p2, …` and the `#walk-row` strip inside the diagram | **no step markers exist in the SVG at all.** Execution steps live in their own **Container B** (`#steps-body`) panel |
> | `.walk-item`, `.walk-link`, `.walk-pop`, `.walk-curve`, `.late` | deleted from the markup, `script.js` and `styles.css` |
> | `.is-shown` on an `.edge-step` | arrow labels are **static** (`.edge-label`); nothing rewrites them |
> | `.node--active` | removed — the current state is shown by the token, the taken arrow, the Execution Steps rows and the transition-table row |
> | example buttons `101`, `1010`, `1101`, `1021` | `1`, `0`, `101`, `1021` |

> The oracle is 29 cases. The ID contracts, the accessibility floor, the
> theming rules in sections 8–10 and the motion rules in section 11 still hold
> (with one exception: reduced motion must now leave the Execution Steps rows in
> their finished state, not hidden).

# Visual Design Context — DFA Input String Acceptance Checker

**What this document is for.** You are being handed a working application and asked to change how it looks. You have freedom over layout, typography, colour, illustration, and the number and style of visual themes. You have **no** freedom over the automaton, the data contract, or the accessibility floor.

Read sections 1–6 before editing. Section 6 is the one most likely to be missed, because most of the class names you must style are created by JavaScript and do **not** appear in `index.html`.

---

## 1. The one rule

> **All DFA logic lives in `dfa.py`. `script.js` renders what Python returns and must never decide anything.**

There is no transition table, no `validate()`, and no `simulate()` in JavaScript. Two implementations can disagree; there is only one.

Corollary: **no `innerHTML`, no `insertAdjacentHTML`, no string-concatenated markup.** User input can contain anything. Every value is written with `textContent` through the `make()` helper.

---

## 2. Files

| File | Role | Who may edit |
|---|---|---|
| `dfa.py` | The automaton, validation, simulation, test oracle | **Nobody, for a visual task** |
| `app.py` | Opens the PyWebView window, exposes the `Api` object | Only window size/title |
| `index.html` | Structure, static SVG figure, Display menu | **Yes** |
| `styles.css` | All presentation | **Yes — your main workspace** |
| `script.js` | Rendering, the tape walk, event wiring | Only if the ID map changes |
| `document.html` | Separate report document | Independently |

No build step, no framework, no network requests, no storage.

---

## 3. Fixed: the automaton

```
States    Q = {q0, q1}
Alphabet  Σ = {0, 1}
Start     q0
Accepting F = {q1}
Dead      none

          input 0    input 1
→ q0       q0        q1
* q1       q0        q1
```

The language is **every binary string that ends in `1`**. Three consequences that
are easy to get wrong:

- `1`, `101`, `0101`, `11111` are accepted; `0`, `10`, `1010`, `00000` and the
  empty string are rejected.
- Acceptance is decided **only** by the final state. `101` and `1101` are both
  accepted, and `1010` is rejected even though it starts with `101`.
- There is **no dead state**, because both symbols are defined in both states.
  A trap here could only reject perfectly good strings.

`q0` means the input read so far is empty or ends in `0`; `q1` means it ends in
`1`. That reading belongs on screen — it is the whole explanation.

If the figure, the table and `dfa.py` disagree, `dfa.py` is right.

---

## 4. Fixed: the data contract

The page calls exactly two bridge methods, both after `pywebviewready`:

```js
window.pywebview.api.check(text)   // -> object
window.pywebview.api.run_tests()   // -> object
```

```js
// invalid input
{ status: "invalid",
  errors: [ { symbol: "a", index: 3 }, ... ] }   // 1-based; " " means a space

// valid input
{ status: "valid",
  input: "101", start: "q0",
  steps: [ { step: 1, from: "q0", symbol: "1", to: "q1" }, ... ],
  flow: [ "q0", "q1", ... ],          // length is steps.length + 1
  final: "q1", accepted: true,
  description: "..." }               // the rule, for the explanation line
```

There is **no `trapped` field and no `dead` state** — the old contract's fields
are gone because the trap is gone. Acceptance is decided from `final`, never from
inspecting the last character, and never from the flow array's length.

An invalid string returns `status: "invalid"` and nothing else: the machine never
saw it, so there is no `steps`, no `flow`, and no verdict to show. Do not render
an Execution Steps table for invalid input.

---

## 5. Fixed: the element ID map

```
header  input-panel  dfa-input  dfa-help  check-btn  clear-btn
example-1  example-2  example-3  example-4
error  error-head  error-details  error-action
result  tape  flow  trace  trace-body
dfa-figure  dfa-svg
node-q0  node-q1
dfa-reference  transition-table  trow-q0  trow-q1
steps-body
tests-btn  tests-summary  tests-table  tests-body
theme-select
```

The example buttons carry `1`, `0`, `101`, `1021` in `script.js` as
`EXAMPLE_VALUES`. Change both together.

### SVG edge ids

Each transition is `edge-<from>-<to>-<symbol>`, e.g. `edge-q0-q1-1`. There is no
trap, so every symbol has its own arrow and `setTakenEdge()` never needs a
symbol-less fallback. `edge-start` is the source-less line marking `q0` and
carries no label.

**There is no step row inside the diagram.** The old `#walk-row` strip, its
`walk-link-<i>` lines and its `p1, p2, …` position markers have all been deleted.
Execution steps are rendered in Container B (`#steps-body`), one row per input
symbol, as `step--pending` → `step--current` → `step--done`. The only moving thing
inside the SVG is `#walk-token`, the dot that rides one machine arrow per step.

---

## 6. Fixed: the class contract

**This is the part that bites.** `script.js` creates most of the visual structure at runtime. Grep the JavaScript, not just the HTML.

### Classes the JavaScript toggles

| Class | On | Meaning |
|---|---|---|
| `.edge--taken` | SVG `.edge` path | the transition just taken |
| `.is-dim` | `#dfa-svg` | idle figure; removed on the first check |
| `.is-reading` | a tape `<li>` | the cell the walk is highlighting |
| `.is-active` | a `#transition-table tbody tr` | current state row |
| `step--pending` | an Execution Steps `<tr>` | not read yet |
| `step--current` | an Execution Steps `<tr>` | the step being processed right now |
| `step--done` | an Execution Steps `<tr>` | finished — **including the last one** |
| `.final` | a `#flow li` | the last state in the flow |

### Classes the JavaScript creates that you must style

These exist only after the first interaction. A stylesheet that ignores them looks fine on load and breaks once someone presses Check.

- **Result block** — `#result` gets `result--idle` or `result` / `result is-rejected`. Children: `.verdict` (an `.icon` span plus the word), `.facts` (a `<dl>` of `dt`/`dd`), `.reason`.
- **Tape cells** — `.cell`, children `.sym` (the symbol), `.idx` (position numeral, shown at position 1 and every fifth), `.vh` (visually hidden text).
- **Execution Steps rows** — `.step` with `step--pending` / `step--current` / `step--done`; children `.step-symbol`, `.step-state`, and `.tag` marking the final row.
- **State flow** — `.arrow` between states.
- **Test table** — `.pass` / `.fail` on status cells.
- **Figure** — `.pulse` behind each circle, `.core`, `.ring` (the accepting double circle), `.edge`, `.edge-label`, `.walk-token`.
- **Definition list** — `.defn` / `dt` / `dd`.

`.vh` is the visually-hidden utility; keep it.

### Attributes the JavaScript sets

`aria-invalid` and `aria-describedby` on `#dfa-input`; the `hidden` property on `#error` (so `.error[hidden]{display:none}` is required); `aria-label` on `#tape`.

---

## 7. Free: what you may redesign

Layout and column structure (currently two-column at ≥1024 px, `7fr 5fr`). All colours, subject to section 8. Both font stacks, sizes, weights. The figure's *appearance* — node size, stroke weight, curve shape, label placement, arrowheads — but not its topology or labels. The table's appearance. The tape, flow, trace and result block. Motion: there is exactly one animated moment, the tape walk (section 11). Adding themes (section 9).

---

## 8. Theming

All colour lives in custom properties. **A theme is a block of token values and nothing else.** Component rules must never hard-code a hex value or the switcher will only work on half the page.

| Token | Role | Required contrast |
|---|---|---|
| `--paper` | page background | — |
| `--surface` | raised panels | — |
| `--ink` | primary text, SVG strokes | ≥ 4.5:1 on `--paper` and `--surface` |
| `--graphite` | secondary text, control borders, idle strokes | ≥ 4.5:1 as text, ≥ 3:1 as a border |
| `--highlight` | attention fill | — |
| `--on-highlight` | text on `--highlight` | ≥ 4.5:1 on `--highlight` |
| `--accept` / `--reject` | verdict text and icons | ≥ 4.5:1 on `--surface` |
| `--focus` | focus ring | ≥ 3:1 on both `--paper` and `--surface` |
| `--rule` / `--line` | decorative hairlines **only** | no floor — never the sole indicator of a boundary |
| `--shadow` | elevation | — |

Themes are registered on `:root[data-theme="…"]`, with `:root:not([data-theme])` following `prefers-color-scheme`. Set `color-scheme` on every theme block. `#theme-select` keeps its ID and copy.

**`--on-highlight` must follow the theme.** Ink on the highlight is 11.32:1 in light but 1.42:1 in dark; paper on the highlight is 10.08:1 in dark and 1.28:1 in light. Re-check that pair whenever `--highlight` changes.

---

## 9. Non-negotiable accessibility

Target WCAG 2.2 AA.

- **Colour is never the only signal.** ACCEPTED/REJECTED carry a word *and* an icon. The final state carries a ring *and* "final state". PASS/FAIL carry a word *and* an icon.
- **Live regions.** `#result` is `role="status" aria-live="polite"`, updated **once per check**. `#error` is `role="alert"`. Never convert these to decorative elements; never announce per animation frame.
- **Never `outline: none`** without a replacement. The focus ring is 2 px solid `--focus` at 2 px offset via `:focus-visible`.
- **Touch targets** ≥ 44 × 44 px.
- One `<h1>`, an `<h2>` per section, all visually present. Landmarks: `<header>`, `<main>`, `<section aria-labelledby>`.
- The SVG keeps `role="img"` with `<title>` and `<desc>`; the transition table is the full text equivalent.
- The accepting state keeps a **double circle at all times**, not only after an accepted check. It is part of the machine's definition, not the outcome.

---

## 10. Responsive

No horizontal page scroll at 320 px, and **no nested scroll regions at all** — the page is the only scroll position. Nothing scrolls sideways: not the figure box, not the Execution Steps panel, not the test table, not the rail. Breakpoints currently 640 px and 1024 px; the 320 px floor is not negotiable.

**Rendered** SVG text ≥ 14 px is now guaranteed down to a **380 px** viewport, not at every width. The figure viewBox is `0 0 420 250`; the smallest label is 20 units, so it needs 294 px of drawing width to render at 14 px, and the plate is 86 px narrower than the viewport (page + panel padding and the border). Below 380 px the drawing scales down with the viewport and labels go under 14 px. This is a deliberate trade: the alternative was a `min-width` floor, which only pushes the overflow onto the page. At 200 % zoom nothing is clipped.

**Arrows anchor on the outer radius.** The accepting state draws two circles, so anything attaching to it must attach to the ring (42), never the core (34) — otherwise the arrowhead lands on the double circle and a self-loop reads as a second, overlapping ring. This is the one geometry rule that must hold if the figure is changed again.

---

## 11. Motion

One animated moment: after a valid check the token rides one machine arrow per
step while the tape cell, the Execution Steps row, the taken edge and the
transition-table row all advance on **the same clock** (`stepInterval(count)`,
150 ms at five steps, `WALK_BUDGET_MS` 900 ms, skipped above
`WALK_MAX_STEPS` 12 and entirely under `prefers-reduced-motion`). The result,
flow and Execution Steps table are rendered **before** the walk and never hidden
by it. Only `opacity`, `transform` and the existing `stroke-dashoffset` animate.

**Reduced motion must still be informative:** the walk is skipped, but every
Execution Steps row must end in its finished state (`step--done`), not hidden and
not left on `step--current`. A static run that looks half-finished is a bug.

---

## 12. Verify before you hand back

- [ ] `1`, `101`, `0101`, `11111` → ACCEPTED, final `q1`
- [ ] `0`, `1010`, `00000` → REJECTED, final `q0`; empty → REJECTED `q0`
- [ ] `1021` shows "Found “2” at position 3." and no ACCEPTED or REJECTED text appears anywhere
- [ ] Invalid input leaves the tape, flow and **Execution Steps** empty
- [ ] Arrows are labelled with the **input symbol**, statically, at rest and after every check
- [ ] Circles are labelled with the **state name**; `q1` is double-ringed, always
- [ ] **Container A** (the diagram) contains 2 nodes, 4 transition arrows, the source-less start arrow, and **no** step markers, step rows or input positions
- [ ] **Container B** (Execution Steps) has a Start row plus one row per symbol, and never appears inside the SVG
- [ ] A finished walk leaves **every** Execution Steps row `step--done`
- [ ] The transition table has 2 rows and 2 input columns (`0`, `1`)
- [ ] Every colour pair in section 8 meets its floor in every theme
- [ ] No horizontal page scroll at 320 px, and no element in the page scrolls in either direction except the document itself
- [ ] SVG text ≥ 14 px down to a 380 px viewport (it shrinks below that on purpose)
- [ ] `script.js` has no transition table, no `validate`, no `simulate`, no `innerHTML`
- [ ] Every class in section 6 is styled, including the JavaScript-created ones
- [ ] `python dfa.py` prints **29 of 29 passed**
- [ ] `node --check script.js` is clean
- [ ] `python run_decider.py --verify` reports every essential file matching the baseline

Report any check that fails rather than describing the work as complete.

---

## 13. Already decided — do not relitigate
