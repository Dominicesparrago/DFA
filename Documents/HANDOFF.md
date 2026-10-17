# Front-end handoff — Decider

> **The implementation has moved on. Read `SYSTEM_CONTEXT.md` first.**
> This file used to describe a five-state trapping machine (`q0…q3`, `qd`)
> that accepted exactly `101`. That machine is gone. Every statement below about
> dead states, `qd`, step-row circles `q4, q5, …`, nine transition paths or a
> five-row table is obsolete.
>
> `VISUAL_DESIGN_CONTEXT.md` keeps the parts that still hold — the accessibility
> floor, theming, tokens and responsive rules — with its own corrections at the
> top.

---

## The automaton

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

It accepts every binary string that **ends in `1`**. `1`, `101`, `0101` and
`11111` are accepted; `0`, `1010`, `00000` and the empty string are rejected.

There is no dead state: both symbols are defined in both states, so no input can
get stuck. Acceptance is read from `final`, never from the last character.

`dfa.py` is the only source of truth. The oracle is **29 cases**, each asserting
acceptance *and* the final state.

## Files

| File | Role |
|---|---|
| `dfa.py` | the automaton, validation, simulation, `run_tests()` |
| `app.py` | PyWebView window, local no-store server, `Api.check` / `Api.run_tests` |
| `run_decider.py` | launcher: integrity check, recovery, baseline approval |
| `index.html` | structure, every ID, the two state groups, the ring, the table |
| `styles.css` | tokens, components, motion |
| `script.js` | rendering, choreography, bridge plumbing — **no decisions** |
| `SYSTEM_CONTEXT.md` | **authoritative** for the implementation |

## Figure geometry

Two states on one row, 130 units apart, radius 34, accepting ring 42, at
`y = 120` in a `0 0 420 250` viewBox. `layoutFigure()` centres them.

Every arrow anchors on the state's **outer** radius — the ring for the accepting
state, the core otherwise. Reading only the core is what used to push the `q1`
self-loop and the `q0→q1` arrowhead *inside* the double circle. The radii and the
row height are read from the markup rather than hard-coded, so moving a circle or
resizing the ring cannot desynchronise the arrows from the machine.

**Nothing scrolls except the page.** The plate, the Execution Steps panel, the
test table and the rail all grow to fit their content, so there is no second
scroll position to reach for. Consequences worth knowing: table headers are not
sticky, and figure labels shrink below 14 px on viewports narrower than about
380 px.

**The rail is the one exception, and only from 1120px.** It is `position: sticky`
with `top: 16px`, so the input and the verdict stay beside the figure while the
reader scrolls the long stage. It stays in flow — `position: absolute` cannot do
this, because an absolutely positioned box is laid out once and then travels with
the document, which is exactly the "rail slides off the top when you scroll"
symptom. Sticking needs the workspace to be a two-column grid with
`align-items: start` again. It carries `max-height: calc(100dvh - 32px)` and
`overflow-y: auto` as a safety valve: a sticky box taller than the viewport would
hide its own bottom with no way to reach it. The rail measures about 713px with a
rejected verdict, so on a normal desktop viewport nothing overflows and **no
scrollbar appears**; only a viewport shorter than the rail produces one. Below
1120px the whole rule is out of scope and the rail is an ordinary block in flow.

Arrows are **generated** from Table 1 by `buildFigure()`: `edge-q0-q0-0`,
`edge-q0-q1-1`, `edge-q1-q0-0`, `edge-q1-q1-1`, plus the source-less `edge-start`.
Self-loops sit **above** with the symbol above the loop; the back-arrow sits
**below** with the symbol under the arc, so no two labels compete for space.

## Two containers

| | Container A — the machine | Container B — execution steps |
|---|---|---|
| Markup | `#dfa-svg` only | `#steps-body` |
| Holds | states, ring, 4 arrows, start arrow, the travelling token | Start row + one row per symbol |
| Built from | the transition table | the `steps` array from `dfa.check()` |

**No step marker, step row or input position is drawn inside the SVG.** The old
`#walk-row` strip and its `walk-link-<i>` lines have been deleted. The only moving
thing in the diagram is `#walk-token`, the dot that rides one machine arrow per
step.

## Labelling contract

| Where | Carries |
|---|---|
| All four transition arrows | the **input symbol**, **statically** — part of the definition |
| Start arrow | nothing |
| Circle labels | the **state name** |
| Container B rows | step number, symbol, transition, resulting state |

Labels are static (`.edge-label`). Nothing in a run rewrites them, which is why a
check can never scramble the transition function shown in the diagram.

## Bridge contract

```js
window.pywebview.api.check(text)   // -> { status: 'invalid', errors } | { status: 'valid', ... }
window.pywebview.api.run_tests()   // -> the oracle's results
```

An invalid string returns **only** `errors`. There is no `trapped` field and no
`dead` field any more — the trap is gone.

## Tokens

`--surface`, `--ink`, `--graphite`, `--accent`, `--focus`, `--on-highlight`,
and a per-theme block for each of **Textbook** (light), **Night** (dark) and
**High contrast**. Colour appears only as `var(--token)`; `script.js` contains no
hex colour.

`--on-highlight` follows the theme on purpose: ink on the highlight is 11.32:1 in
light but 1.42:1 in dark, and paper on the highlight is the reverse.

## Motion

Only `opacity`, `transform` and the existing `stroke-dashoffset` animate. One
animated moment: the walk — the token rides one machine arrow per step, the tape
cell, the Execution Steps row, the taken edge and the table row all advance on
the same clock (150 ms at five steps, 900 ms budget, skipped above 12 steps and
entirely under `prefers-reduced-motion`).

The result, flow and Execution Steps table render **before** the walk and are
never gated by it. `#result` is announced once per check, never per tick.

**A finished walk must leave every Execution Steps row `step--done`, including
the last.** This was a real bug: `showSteps()` left the final row on
`step--current` for ever, so a completed run looked unfinished.

## Verified

- `python dfa.py` — **29 of 29**, each case asserting accept/reject **and** the
  final state.
- `node --check script.js` — clean.
- `python run_decider.py --verify` — every essential file matches the baseline.
- **42 recovery checks** against throwaway copies, all passing: deleted function,
  invalid Python, invalid JavaScript, deleted file, truncated file, persistent
  modification (restored in 9.3 s), two-part save correctly ignored, missing
  backup, corrupt manifest, digest mismatch, loop prevention, maintenance mode,
  approval refused/accepted, staged-file validation.
- In-app through a stubbed bridge: `1`, `101`, `1010`, `10101`, `0101`, `11111`,
  `00000`, empty, and `1021` → invalid with no verdict shown.
- `10101` → flow `q0 → q1 → q0 → q1 → q0 → q1`, matching the brief's worked
  example symbol for symbol.
- Container A: 2 nodes, ring on `q1`, 5 arrows, labels static at `1,0,0,1` at
  rest and after every check, no markers.
- Container B: Start + one row per symbol; every row ends `step--done`.
- Invalid input produces **no** Execution Steps rows.
- Clear empties Container B and returns the input to idle.

## Not verified

- **PyWebView itself.** Every check ran against a stubbed bridge or in process
  against copies, with the restart step stubbed. A real GUI launch and a genuine
  restart-after-repair are still untested.
- Windows WebView2, Firefox and Safari untested. Only Chromium.
- Screen readers untested.
- Night and High contrast were checked by contrast figures, not reviewed visually.
- The reduced-motion Display note is a CSS media query a JS `matchMedia` override
  cannot trigger — it needs DevTools emulation.
