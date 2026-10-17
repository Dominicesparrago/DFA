# SYSTEM_CONTEXT — Decider

Authoritative context for this codebase: what the system is, how it flows, how it
looks, and what has repeatedly gone wrong.

This file supersedes `HANDOFF.md` and `VISUAL_DESIGN_CONTEXT.md`, which describe
older machines. This document follows the official AL102 brief
(`AL102_DFA_Midterm_Project_Instructions_and_Grading_Matrix.docx`), which is the
authority on what the DFA must be.

---

## 1. At a glance

A PyWebView desktop app, **Decider**, that decides whether a binary string is
accepted by a DFA and animates the decision so a person can see *why*.

- **Host:** Python 3 — `dfa.py` (the machine), `app.py` (window + bridge)
- **View:** a Chromium WebView rendering `index.html` + `styles.css` + `script.js`
- **Bridge:** `window.pywebview.api.check(text)` / `.run_tests()`
- **Rule:** all decision-making is Python's. JavaScript renders.

`app.py` serves the folder over `127.0.0.1` with `Cache-Control: no-store`
rather than loading `file://`, because WebView2 will otherwise cache
`script.js` and a relaunch can silently run the previous build.

---

## 2. The machine (authoritative — `dfa.py`)

The machine accepts **every binary string that ends in `1`**.

```
Alphabet  Σ = {0, 1}
States    Q = {q0, q1}
Start     q0
Accepting F = {q1}
Dead      none

          input 0    input 1
→ q0       q0        q1
* q1       q0        q1
```

| State | Means |
|---|---|
| `q0` | the input read so far is empty or ends in `0` |
| `q1` | the input read so far ends in `1` |

A string is accepted exactly when it finishes in `q1`.

**There is no dead state, and that is a property of the language.** Both symbols
are defined in both states, so no input can ever get stuck and a trap could only
reject perfectly good strings.

### A note on how this got here

Three different machines have lived in this folder, and two of them were wrong
for this assignment:

| Machine | States | Language | Verdict |
|---|---|---|---|
| original | q0 q1 q2 q3 qd | exactly `101` | wrong — needs a trap, rejects `0101` and `11111` |
| interim | q0 q1 q2 q3 | contains `101` | wrong — not the assigned language |
| **current** | **q0 q1** | **ends in `1`** | **matches the brief** |

The test oracle was rebuilt with the machine rather than being allowed to
dictate it: **29 cases**, each asserting acceptance **and** final state.

---

## 3. Files and responsibilities

| File | Owns | Must never contain |
|---|---|---|
| `dfa.py` | automaton, validation, simulation, `run_tests()` | any GUI import |
| `app.py` | window, local no-store server, `Api.check` / `Api.run_tests` | decision logic |
| `run_decider.py` | launch, integrity check, recovery, baseline approval | any decision logic |
| `index.html` | structure, every ID, the two state groups, the accepting ring, the transition table, the Execution Steps panel, the Display menu | any arrow path or arrow label (generated) |
| `styles.css` | tokens, components, motion; colour only via `var(--token)` | a hex colour outside `:root`/theme blocks |
| `script.js` | rendering, choreography, bridge plumbing | a transition table, validation, or simulation |
| `document.html` | separate report artefact | — |
| `SYSTEM_CONTEXT.md` | this file | — |
| `recovery/` | approved baseline: `manifest.json`, `backups/`, `history/`, `approved_updates/` | the running source itself |

`run_decider.py` is deliberately **outside** the five files it protects. If it were
inside the set, a damaged launcher would have to repair itself before it could
repair anything else.

---

## 4. System flow

```
┌──────────────────────── Python host ────────────────────────┐
│  app.py                                                      │
│    ├─ ThreadingHTTPServer on 127.0.0.1:<free port>, no-store │
│    └─ webview.create_window(url=…, js_api=Api())             │
│  Api.check(text) ──► dfa.check(text)                         │
│  Api.run_tests() ──► dfa.run_tests()                         │
└──────────────────────────────┬────────────────────────────────┘
                               │ window.pywebview.api (async)
┌──────────────────────────────▼────────────────────────────────┐
│  buildFigure()   reads Table 1 → generates every arrow+label │
│  runWalk()       every step travels edgeIdFor(step)          │
│  script.js       renders tape, state flow, trace, result     │
│                  No decisions. Numbers come from Python.     │
└────────────────────────────────────────────────────────────────┘
```

`dfa.check()` returns either
`{"status": "invalid", "errors": [{"symbol", "index"}]}` (1-based index, and the
machine never saw the string), or
`{"status": "valid", "input", "start", "steps", "flow", "final", "accepted", "description"}`
with `steps[i] = {step, from, symbol, to}`.

**Check path:** `handleCheck` → bridge → `renderValid` → Input, Result, Tape,
State Flow, Execution Steps and Transition Function all render →
`figureRevealAll()` returns 0 (nothing to build) → `runWalk`. There is no build
delay in front of the walk, and the walk is the only thing that moves.

`runWalk` reveals one Execution Steps row per tick, marks that row
`step--current`, and the moment the walk settles `settle()` re-runs
`showSteps(steps, count, true)` so **every** row ends as `step--done`.

---

## 5. Visual system

One token set; themes **Textbook** (light), **Night** (dark), **High contrast**,
plus the OS preference. `--on-highlight` flips per theme on purpose: ink on the
highlight is 11.32:1 in light but 1.42:1 in dark.

**Motion doctrine**

- Only `opacity` and `transform` animate, plus the existing `stroke-dashoffset`
  arrow-drawing effect.
- One animated moment: the walk. Result, tape, state flow and trace render
  **before** it and are never gated by it.
- `prefers-reduced-motion: reduce` gives a fully static, fully informative figure.
- Flow timing scales the step pace and the choreography.

---

## 6. The figure

### 6.1 Generated, not written

`index.html` holds only the two `<g class="node">` groups (each a `.pulse`, a
`.core`, a `<text>` name), the `<marker>`, and `#walk-token`.
`buildFigure()` reads Table 1 and generates **5 arrows**:

```
edge-start                 no source — marks q0, carries no symbol
edge-q0-q0-0   self-loop, labelled 0
edge-q0-q1-1   top row,   labelled 1
edge-q1-q0-0   back-arrow, labelled 0
edge-q1-q1-1   self-loop, labelled 1
```

Change a cell in Table 1 and the diagram changes with it.

### 6.2 Geometry

| Quantity | Value |
|---|---|
| base viewBox | `0 0 420 250` |
| circle radius | 34, read from the markup (`accepting ring 42`) |
| horizontal spacing | 130 (`WALK_SPACING`) |
| state row `y` | 120, read from the markup |
| self-loop | anchors at `outer + 5`, spans ±60° from the top, rises 44, reach ×1.25 |
| back-arrow | leaves each circle at 125°, control depth 60, label 24 below the curve |
| width | the states as one centred run, ordered by numeric suffix (`stateOrder()`) |

**`outer` is the radius every arrow anchors on.** For the accepting state that is
the ring (42), not the core (34). Reading only the core was the single root cause
of the crowded figure: the `q1` self-loop, the `q1→q0` arrow and the `q0→q1`
arrowhead all sat *inside* the accepting ring, which is what made the upper loop
look doubled. Each arrow now starts and ends on `outer`, so its arrowhead stops
at the ring's boundary instead of crossing it.

The radii and the row height are deliberately **not** constants in `script.js`.
They are read from the markup, so moving a circle or resizing the ring cannot
leave the arrows describing something the machine does not actually draw.

`layoutFigure()` lays the state nodes out as one centred run. The plate does
**not** scroll: the drawing is sized to whatever width the plate has, clamped by
the stylesheet, and the page is the only thing that scrolls.

Measured clearances, current build:

| Arrow | Closest approach to the state it touches | State edge |
|---|---|---|
| `edge-q0-q0-0` | 39 | 34 |
| `edge-q1-q1-1` | 47 | 42 (ring) |
| `edge-q0-q1-1` (head) | 42 | 42 (ring) |
| `edge-q1-q0-0` (tail at q1) | 42 | 42 (ring) |
| `edge-q1-q0-0` (head at q0) | 34 | 34 |

### 6.3 Labels

| Where | Carries |
|---|---|
| All four transition arrows | the **input symbol** that causes that arrow — static, part of the definition |
| Start arrow | **nothing** |
| Circle labels | the **state name** |
| Container B rows | step number, symbol, transition, resulting state — **execution steps, not states** |

Transition labels are static: class `edge-label`, not `edge-step`, so
`clearLabels()` and the walk can never wipe them. Layout is the classic one for a
two-state machine — self-loops **above** with their symbol above the loop, the
back-arrow **below** with its symbol under the arc — so no two labels compete for
the same space.

The accepting state's double ring is **part of the machine's definition**, not an
effect of a check: a static `.ring` element with a static CSS rule.

### 6.4 Container A and Container B

The screen is split into two containers with **different jobs**, and this split is
the fix for a long-running confusion: the diagram must not carry execution detail.

| | Container A — the machine | Container B — execution steps |
|---|---|---|
| Markup | `#dfa-svg` and nothing else | `#steps-body` table |
| Content | states, accepting ring, 4 transition arrows, start arrow, the travelling token | Start row + one row per input symbol: step, symbol, `from → to`, resulting state |
| Source | the states and the transition table | the `steps` array returned by `dfa.check()` |
| Lives for | the definition of the machine | one specific run |

Rules that keep the split honest:

- **No step row, marker, or index is ever drawn inside the SVG.** Execution steps
  exist only in Container B. The `#walk-row` strip that used to sit under the
  machine has been deleted from the markup, from `script.js`, and from
  `styles.css`.
- The only moving thing inside the SVG is `#walk-token`, the dot that rides one
  machine arrow per step. It is the machine's own motion, not a step track.
- Container B rows are generated from Python's `steps`, one row per symbol, in
  the order Python produced them. `renderSteps` builds the Start row plus
  `steps.length` rows; `showSteps(steps, upTo)` reveals them as the walk
  advances; the final row carries a `Final` tag.
- `renderSteps(steps, start)` renders the whole table up front, all rows
  `step--pending`, so the table never reflows mid-walk.
- An input with no valid symbols produces **no** rows at all: invalid input is a
  validation error, not a run with zero steps. The empty string produces the
  Start row only, and is rejected from `q0`.

### 6.5 Arrival choreography

One arrival, in this order, for every circle that joins the plate:

```
1. the circle   scale 0 → 1, opacity 0 → 1                        POP_MS 340
2. the arrow    fades in to 28%, then travels forward             DRAW_MS 420
3. the symbol   fades up once the line has nearly landed
```

`POP_LEAD = 170` — the circle is well on its way up before its arrow sets off.
During the walk the arrival is fitted to the step interval so the next symbol
never waits for the current circle to finish.

Driven through `runAnimation()`, which cancels anything already on the element
before starting. That matters: a WAAPI animation with `fill:'backwards'` holds
its **first** keyframe for the whole of its delay, so a stale animation can pin
an element at `opacity: 0` long after a newer run asked for it.

---

## 7. Figure problem history

Every entry below came from the same root cause: **hand-maintained geometry
drifting from generated geometry**, or **two systems animating the same thing**.

| Defect | Root cause | Fix |
|---|---|---|
| Steps past the third rode `walk-link-<i>`, not the machine's arrows | a lookup switched target by *index* | deleted; every step uses `edgeIdFor(step)` |
| Checking `101` printed `1·1·0·1` | the start arrow carried the first symbol too | `showStartLabel` deleted; start arrow carries nothing |
| The whole position track flashed in at tick 1 | items created up front, nothing hidden | items created hidden, revealed on reach |
| The check path had no entrance choreography | `figureRevealAll` flipped opacities | now returns 0 immediately; the machine is simply always on the plate |
| **The early circles were emphasised; later ones were delayed** | **not a CSS problem — two animation systems.** `popIn()` animated every circle, *and* CSS `.node--active` scale + `pulse-ring` animated the states only, on a different clock. The position track also started at the fourth symbol, so positions 1–3 and 4+ were different objects | one arrival function and one timing for every circle; the state highlight is gone (the token, the taken arrow, the trace and the transition-table row show the current state); `WALK_AFTER = 0` so every position is the same kind of object |
| A ~1.6 s build stood in front of every walk | the whole machine was faded in arrow by arrow first | nothing to build; the diagram is the definition |
| Replays sat dark or skipped | stale WAAPI animations with `fill:'backwards'` were never cancelled | `runAnimation()` + `cancelAnimations()`, called from `cancelWalk()` |
| Arrows could sit part-drawn | `strokeDasharray` written to the length at draw time and never cleared | `pathLength="1"` normalisation, dash cleared on finish |
| Controls could stay disabled | `handleCheck` had no `finally` | `try/finally` restores `busy` and the controls on every path |
| Curves tore after `qd` moved | dash baked from the old length | `pathLength="1"` on every path |
| The plate stuttered | a smooth `scrollTo` restarted every tick | instant scrolls, only when something is off-plate |
| The machine scrolled off the left edge at the end | completion scrolled to `x = 0` | `showFigureEnd(state)` centres on the ending state, pulling in the final marker only when it fits |
| **Four nested scroll regions: the plate, both tables, and the rail** | each capped itself with `max-height` + `overflow` | all four now grow with their content; the page is the only scroll position. Consequences: `thead th` lost `position: sticky` (with no inner scroller it pinned to the page and floated over other panels), the rail lost `position: sticky` (a sticky box taller than the viewport cannot be scrolled to reach its bottom), `.svg-box` lost its `min-width: 430px` (a floor now pushes the *page* sideways rather than scrolling the plate), and the three `role="region"` wrappers lost `tabindex="0"` and the word "scrollable" in their labels |
| **The `q1` self-loop looked doubled and crowded into the accepting ring** | `circleOf()` returned only the **core** radius (34) and ignored the **ring** (42). Every arrow therefore anchored 8 units *inside* the accepting circle, so the loop crossed the double ring at both ends and its arrowhead landed on it | `circleOf()` now returns `outer` — the ring when the state has one, the core otherwise — and every shape anchors on it. The loop is also rebuilt as a single wider, taller curve anchored at `outer + 5`, rising clear of the circle, with its symbol a fixed distance above the loop's apex |
| **The whole figure stopped laying out when the row moved** | `layoutFigure()` filtered nodes on `cy === WALK_TOP`; moving the row without updating that constant left the list empty, so nothing was positioned and the labels kept their build-time coordinates | the filter is gone. With the generated position markers removed there is only ever one row, so every state node is laid out |
| `edge-q0-q1-1` head sat inside the accepting ring | same core-versus-ring cause as the loop | the straight arrow runs from one state's `outer` to the other's, so it terminates at the ring's boundary |
| Figure labels drop under 14 px below a 380 px viewport | the 14 px text floor was held by a `min-width` that required a scrollbar to be useful | the floor was removed, so the drawing scales with the viewport. 20 units in a 420-unit viewBox needs 294 px of width to render at 14 px, and the plate is 86 px narrower than the viewport |
| Execution steps were drawn inside the diagram, under the machine | one panel doing two jobs — the SVG carried both the definition and the per-run trace | split into Container A (machine) and Container B (Execution Steps panel); `#walk-row` deleted from markup, script and styles |
| **A finished walk still looked unfinished** | `showSteps(steps, upTo)` marked the last revealed row `step--current`, and nothing ever cleared it — `settle()` called it again with the same `upTo` | `showSteps(steps, upTo, finished)`; `settle()` passes `finished = true`, so the final row becomes `step--done` |
| A broken edit was restored instantly, then again on the next launch | restoration fired on the first mismatch, with no way to tell a save in progress from damage | `CONFIRM_WINDOW_S` (7 s) before restoring, `--maintenance` to suspend, `--approve-current` to adopt a change |
| `inspect()` silently checked the wrong folder | `root: Path = ROOT` captured `ROOT` at import time, so redirecting the module did nothing | every entry point resolves `root = root or ROOT` at call time |
| **Every dump shaft drew as a thick grey wedge, and narrowing `stroke-width` changed nothing** | the combined state selectors set `fill: var(--graphite)` on `.arrow__shaft` as well as `.arrow__head`, and a *higher-specificity, later* rule than the base `fill: none`. A fill on an **open** centreline curve implicitly closes it, so the browser flooded the lens between the curve and its own chord — a solid tapered band. `stroke-width` was never involved, and `elementsFromPoint` confirmed the shaft's real geometry was ~20 px across | shaft and head selectors split apart: `.arrow__shaft` is `fill: none` in every state, only `.arrow__head` is ever filled |
| **Dump arrowheads were invisible — buried under the `qd` circle** | `dumpCurve()` pulled the **second** control point *towards* qd's centre, so the cubic's end tangent (`end - c2`) pointed outward, away from the node. The head is drawn backwards from the tip, so it was laid inside the circle, and `#edge-layer` paints beneath the node groups | `c2` is pushed **outward** along the arrival radius, and the path stops 3 units clear of the rim, so the head sits in open space pointing into the node |
| **The rejection was revealed about a second before its arrow landed** | `paintTrace()` calls `syncTraceResult()`, which called `showVerdict()` as soon as `traceIndex >= traceMax()` — and `advanceTo()` paints *before* it calls `runEnding()`, so the deferred `then: showVerdict` had not been armed yet | `endingPending` is set in `advanceTo()` **before** painting; `syncTraceResult()` keeps saying "Processing" while it is set, and only `runEnding()` reveals |
| Invalid input left one stray arrow running into `qd` | an invalid or idle trace collapses to the lone starting state, which still described one step, so `buildTraceArrows()` emitted its dump | `buildTraceArrows()` returns early unless `traceStatus === 'ok'` |

### Standing rules for the figure

1. **One source of geometry.** Never hand-place an arrow.
2. **One source of truth for transitions** — `EDGE_RULES`. Do not add lists.
3. **One arrival animation.** New circles reuse `popIn`/`drawIn`/`fadeIn`; do not
   add a second CSS animation for a subset of circles.
4. **Normalise any dash** you animate with `pathLength="1"`.
5. **Execution steps live in Container B, never inside the SVG.** If a step needs
   to be drawn on the diagram, that is a sign it belongs in the table.
6. **Layout stays stable during a walk.** Geometry changes mid-walk tear curves.
7. **If a label has nowhere honest to sit, fix the layout** — do not omit it.
8. **An open path is never filled.** `fill` on an unclosed curve implicitly closes
   it and floods the region between the curve and its chord. Only closed shapes
   (the arrowheads) get a fill.
9. **A head is drawn backwards from the tip, so the final tangent must point at
   the node.** Arrows live in `#edge-layer`, which paints *under* the node groups;
   a curve that arrives pointing the wrong way hides its own head.

---

## 8. Contracts

```
edge-<from>-<to>-<symbol>   one arrow per transition
label-<id>                  one label per transition (static); none on the start arrow
edge-start                  the source-less line marking q0
walk-token                  the dot that rides one machine arrow per step
.svg-box                    the figure's plate (Container A); it does not scroll
#steps-body                 the Execution Steps table (Container B)
#stepIn(row, at)            the row's own entrance; a no-op under reduced motion
class step--pending         a revealed-nothing row
class step--current         the step being processed right now
class step--done            a finished step — includes the last one
class is-final (row cell)   the Final tag on the last step row
class is-active (table row) the state the machine is in
class edge--taken           the arrow the machine is on
class is-dim                resting plate
```

**Constants:** `WALK_MAX_STEPS = 12`, `WALK_AFTER = 0`, `WALK_STEP_MS = 150`,
`WALK_BUDGET_MS = 900`, `BRIDGE_MAX = 140`, spacing `130`, radius `34`.

**Invariants:** no transition table, validation or simulation in `script.js`; all
dynamic text via `textContent` (zero `innerHTML`); no hex colour in
`script.js`; one `.animate()` call site (`runAnimation`).

---

### 6.6 Two views of one machine (the diagram switch)

The Figure panel carries a two-part switch, top-right: **Simple diagram** and
**Longer diagram**. There is only **one machine** in this project and it never
changes — the two-state DFA in `dfa.py`. Table 1 and the Definition list always
describe that machine. What the switch changes is what the figure *draws*.

| | Simple | Longer (a trace) |
|---|---|---|
| Nodes | `q0`, `q1` — the machine's states | one node per step of the run, plus `qd` |
| Large label | the state name | the **step number** (`q0`, `q1`, …) |
| Small label | none | the **state the machine was really in** |
| Arrows | the four transitions, each carrying its symbol | one arrow per step, carrying the symbol that was read |
| Ring | on `q1`, the accepting state | on the **final node only, and only when accepted** |
| Growth | fixed at two states | grows with the input |
| Result line | not shown | shown under the plate |

**The large label is a step counter and must never be read as a state.** That is
the whole point of the professor's convention, and it is why the two are separate
`<text>` elements on the same node. The small label is the one that decides
acceptance.

Trace nodes carry **no double ring**, with one exception: when a run is
**accepted**, a ring grows over its final node as the run completes. A ring marks
an accepting *state*, and in a trace most nodes sit in an accepting state part of
the time, so ringing them all would suggest the string is accepted before the run
finishes. Only the last node, only at the end, and only for an accepted run.
An accepted run sends **nothing** to `qd`; a rejected one ends with the full slow
dump of its last step into `qd`, and the verdict waits for that arrow to land.

**There are no playback controls.** The animation runs by itself whenever the
execution sequence starts or changes; the only control in the Figure panel is the
Simple/Longer switch. Under reduced motion there is no playback at all: the run is
shown complete, every arrow already finished.

**`qd` is drawn and reached only by reference arrows.** The reference shows a fan
of faint lines from the sequence into `qd`, and this draws the same thing: one
dashed, faded arrow labelled `0` from every step node, each anchored on both
circles' edges and bowed so the fan does not overlap itself. They are drawn so
`qd` is never an orphan circle.

They are **never taken**, and the code enforces that rather than just not doing
it: as a real transition `qd --0--> qd` would make this a trap machine and reject
`101`. This machine sends `0` to the real state `q0`, so the dead arrows are
excluded from `setTakenEdge()` and from the trace's own highlight classes. The
legend says `fading paths = steps already passed` and the caption explains it.

**The trace animates.** One index, `traceIndex`, is the whole state of the
animation: it is the step the machine is standing on, so the arrow *into* it is
the one just traversed and the arrow *out* of it is the one about to be. Every
highlight and the result line read that one number, which is why nothing can
disagree with anything else.

**The result line never outruns the run.** Mid-animation it says where the
machine is; only once the ending has actually landed does it state a verdict. For
an invalid string it states none at all — `traceStatus` is `'invalid'`, and the
line says the machine never read it, because `dfa.py` returned errors and no
simulation. It must agree with the Result panel, which says "No result." for the
same input.

Reaching the last step is **not** the end of the run. `endingPending` is set in
`advanceTo()` *before* `paintTrace()`, because `paintTrace()` is what refreshes the
result line and `runEnding()` has not run yet at that point — set it later and the
verdict still outruns the dump by about a second.

**Two bugs worth remembering here**, both found by measuring rather than looking:

- The machine walk's `setTakenEdge()` cleared *every* `.edge--taken`, including
  the trace's own arrows. The walk settles after the trace does, so the trace lost
  its completed arrows exactly when the reader was looking at them.
- `figurePreview()` sets each edge's opacity inline, which outranks the
  stylesheet, so the dead arrows could not be faded from CSS at all.

The trace is never computed in the browser: `setTrace(input, sim.flow)` is
called from `renderValid`, so the figure cannot show a run that disagrees with
the verdict printed beside it.

**The trace view scrolls, the machine view does not.** `layoutFigure()` sets the
drawing's pixel width from its own viewBox, so one viewBox unit is one pixel in
the trace view and a long run is wider than the plate. Letting the stylesheet
scale it down would shrink the step numbers and the state labels below them. The
machine view is capped by `max-width` and fits.

Rebuild order matters: nodes are laid out **before** the arrows are generated.
Which shape an arrow gets depends on whether its two states share a row, and a
freshly created node is still at the origin — so generating first makes every
state look like it is on the same line.

**The dump curves bow DOWN.** `dumpCurve()` applies one constant `BOW` to the
first control point only, and the vector points down into the open half of the
plate beneath the chain. It has to be *one* vector for the whole fan: if its
direction flipped where the sources pass over `qd`, neighbouring curves would bow
opposite ways and cross. Reversing the sign of that single constant reverses
every curve at once, which is the only safe way to flip the fan. The label
placement constants (`BOW * 0.88`, `BOW * 0.82`) follow the same sign, so the
labels stay on the curve they belong to.

### 6.7 The intro, and the title handover

`#intro` is a 12-second motion-graphics overlay that covers the page once per
launch. Every beat is CSS or SMIL timed by that element's own `--at`; `script.js`
only decides **when it lets go**. All classes are prefixed `intro` so none of them
can meet the checker's own.

| Beat | Timing |
|---|---|
| Title letters rise one by one | 0.2–0.7 s |
| Yellow highlighter wipes under the title | 1.0 s |
| Tagline words rise; the accent `1` swipes | 0.9–2.2 s |
| Tape cells slide in | 2.0–2.3 s |
| States pop | 2.7, 3.0 s |
| Edges traced from start to end (`pathLength="1"`) | 2.9–5.3 s |
| The walk: edge lit, token rides it, ripple on arrival | 6–9 s |
| Verdict stamps down, note fades in | 9.4, 9.9 s |
| **Highlighter withdraws**, alone | 10.4–10.74 s |
| **Everything else clears**, title untouched | 10.6–11.02 s |
| Title travels into the page header | 11.2–12.0 s |
| The page's own contents ease in | after the title lands |

**The outro is spoken in order, and the title outlives all of it.** The
highlighter pulls back first, on its own, because it should read as undoing
itself. The tagline, tape, machine, verdict, note and Skip then clear together,
while `.intro__title` is deliberately excluded. At 11.2 s — the instant the view
transition begins — the plate holds nothing but the word, so the words travel
alone. Flipping this round would mean letting the title clear with the rest, and
the handover would animate nothing.

**The page is hidden while the title travels.** `leave()` adds
`is-handing-over`, which zeroes every `.page > *` except `#header`, and every
`#header > *` except the `h1`. The `h1` must stay visible: it is the element the
transition is morphing *into*. The class comes off on `transition.finished`, and
a 640 ms `opacity` transition on those same children brings the page in.

**Scroll is locked for the whole intro.** The plate is `position: fixed`, so a
page that scrolled behind it would slide the checker out from view. `startIntro()`
adds `is-intro-locked` to `<html>` and scrolls to the top, which also defeats the
browser's own scroll restoration — the one that put this page half-scrolled on
reload. `html.is-intro-locked { overflow: hidden }` stops the reader's wheel,
touch and keys; `html.is-intro-locked body { position: fixed }` stops the document
being scrolled *programmatically*, which `overflow: hidden` and even
`overflow: clip` both still allow on the root element. Both were measured: the
page reached `scrollY = 875` under each until the body was pinned.

**The title is handed over with a view transition, not cut.** `#intro-title` and
`#header h1` both take the name `decider-title`, and the browser morphs one into
the other. The name goes onto the page title *only after the intro has been
removed* — two elements may not share a view-transition name in the same capture.
The handover starts `INTRO_HANDOVER_MS` (800 ms) before `INTRO_MS`, so it finishes
as the intro does, and `::view-transition-group(decider-title)` is set to the same
800 ms. The name is cleared on `transition.finished` so it cannot leak.

Where `document.startViewTransition` does not exist, the overlay simply fades out
over 600 ms instead. Under `prefers-reduced-motion: reduce` there is no intro at
all: `.intro { display: none }` and `startIntro()` removes it immediately.

---

## 9. Recovery and integrity (`run_decider.py`)

The launcher runs the app, checks the five essential files against an approved
SHA-256 baseline, and repairs what does not match.

```bash
python run_decider.py                 # launch, checking and repairing on the way in
python run_decider.py --maintenance   # launch, but never restore anything
python run_decider.py --verify        # report integrity and exit, no launch
python run_decider.py --approve-current   # adopt the current files as the new baseline
```

### The app hands over to the launcher when it cannot start

`app.py` guards its own startup. If `dfa.py` will not import, `webview` is not
installed, the server will not bind or the window will not open, it prints a
`STARTUP FAILED:` line naming the cause, exits `1`, and starts `run_decider.py` to
repair and relaunch. Running `python app.py` directly therefore self-heals too,
not just launching through the launcher.

**Both project imports sit inside `main()`, not at module scope.** A top-level
`from dfa import check` raises while `app.py` is still being imported, so a damaged
`dfa.py` would stop the process before `main()` was ever reached and nothing could
report it or hand over — the guard would have been useless for the exact case it
exists to catch. `main()` declares `global check, run_tests` and imports them
inside the `try`, so the same fault becomes a reportable one.

Two guards stop the handoff looping:

- **`DECIDER_MANAGED`.** `spawn_app()` sets it on the app process, and it is
  inherited by whatever that app starts. When it is already set, `run_decider.py`
  is the parent and already owns the repair, so `app.py` reports the failure and
  stops rather than starting a second launcher against the same files. When it is
  *not* set, the handoff sets it on the launcher it starts, so if the fault
  survives the repair the relaunched app hands over exactly once more and no
  further. Two guards for different reasons: the first stops a *racing* second
  launcher, the second stops a *loop*.
- **The handoff never raises.** A launcher that throws while handling a crash
  tends to hide the crash, so `handoff()` reports and returns an exit code.

**What this cannot cover.** Damage to `app.py` itself. If it is truncated or will
not parse, Python cannot load it and no code inside it gets to run. That case is
still recovered the same way as always — start `run_decider.py`, which verifies
the baseline and restores `app.py` *before* trying to load it again. The split is
the reason recovery lives in a separate file at all.

### Rules it follows

- **Essential files** are `app.py`, `dfa.py`, `index.html`, `script.js`,
  `styles.css`. A non-essential file is never backed up and never restored.
- **A change must persist before it is called damage.** A file is only restored
  once it has differed from the approved digest for `CONFIRM_WINDOW_S` (7 s)
  continuously, so a file being saved in two writes is left alone.
- **Repairs are atomic.** Each copy is written to a temporary file in the same
  directory and moved into place with `os.replace`, then the digest is re-checked
  after the move.
- **A restore that does not verify is a failure, not a success.** If the digest
  still does not match afterwards, it is reported as a recovery failure.
- **One restart, then give up.** A successful repair restarts the app once so the
  fix takes effect. If the files are changed straight back after every repair,
  the session stops at `MAX_REPAIRS` (8) instead of looping forever.
- **A controlled launch retry.** If the app exits within `LAUNCH_GRACE_S` (10 s)
  of starting, the launcher tries once more before reporting failure.
- **Honesty about a missing baseline.** If the manifest or backups are missing or
  unreadable, the launcher says integrity cannot be checked or recovered from.
  It does **not** claim a guarantee it cannot make, and it does not approve a new
  baseline on its own.
- **Approval is a separate, deliberate act.** `--approve-current` validates
  every file, runs the `dfa.py` oracle, and only then rotates the old baseline
  into `recovery/history/<timestamp>/` and records new digests. If validation
  fails the approval is refused and the previous baseline stays trusted.
- **Staging is inert.** Files in `recovery/approved_updates/` do nothing on their
  own. `--approve-current` validates each one individually, copies only the valid
  essential ones into the project, then re-validates the whole project.
- **Maintenance mode suspends restoration entirely** — including the pre-launch
  check — so deliberate work is not undone while you are making it.

### Recovery verification

A suite of **42 checks** runs against throwaway copies of the project; the
working copy is never touched. All 42 pass. It covers: an intact project; a
function deleted from `dfa.py`; invalid Python syntax; invalid JavaScript syntax;
a deleted file; a truncated file; a persistent modification while running
(restored inside the window, measured at **9.3 s**); a two-part save (correctly
**not** treated as damage); launch after repair; a missing backup; a corrupt
manifest; a digest mismatch after restore; loop prevention; DFA correctness after
recovery; maintenance mode; approval refused for broken files; approval accepted
with baseline rotation; and staged-file validation.

**Not verified:** the real PyWebView window. Every recovery path is exercised in
process against copies, with the restart step stubbed, so a genuine GUI restart
is still untested.

---

## 10. Verification

```bash
python dfa.py          # 29 of 29, asserting acceptance AND final state
node --check script.js
python run_decider.py --verify
```

Browser behaviour verified through a stubbed bridge (`window.pywebview.api`
answered from `dfa.check()`), **not** by launching PyWebView:

- `101` ACCEPTED `q1`; `1010` REJECTED `q0`; `0101` ACCEPTED; `11111` ACCEPTED;
  `00000` REJECTED; `1` ACCEPTED; `0` REJECTED; empty REJECTED `q0`
- `1021` → invalid, "Found “2” at position 3.", no acceptance verdict shown
- `10101` → state flow `q0 → q1 → q0 → q1 → q0 → q1`, matching the brief's
  worked example symbol for symbol
- Container A: 2 nodes, ring on `q1`, 5 arrows, 4 static labels, no step row and
  no markers inside the SVG
- Container B: Start row + one row per symbol; for `10101`, 6 rows; the walk
  moves `step--current` forward one row at a time and **every** row is
  `step--done` once it settles
- Clear mid-walk stops immediately: no dangling animations, no stale dashes;
  Clear empties Container B and returns the input to idle
- invalid input produces no Execution Steps rows at all
- rapid consecutive checks leave only the current run in control

**Not verified:** PyWebView itself, Firefox/Safari, screen readers, and the
reduced-motion Display note (a CSS media query a JS `matchMedia` override cannot
trigger — needs DevTools emulation).

**Testing trap worth recording:** the browser harness originally did
`from dfa import check` at module load. After `dfa.py` was rewritten the harness
kept serving the *old* module, and the UI appeared to disagree with the file on
disk. The harness now reloads `dfa` per request. If the UI and `dfa.py` ever
disagree, suspect a stale server before suspecting the code.

---

## 11. Document map

| Document | Status |
|---|---|
| `AL102_DFA_Midterm_Project_Instructions_and_Grading_Matrix.docx` | **the assignment — the authority on the DFA** |
| `SYSTEM_CONTEXT.md` | this file — authoritative for the implementation |
| `recovery/approved_updates/README.md` | how to stage and approve an intentional change |
| `HANDOFF.md` | **stale** — describes older machines |
| `VISUAL_DESIGN_CONTEXT.md` | **stale** in its machine and figure sections |
| `AL102_Part_A_…Specification.md` | original brief write-up |
| `AL102_Part_B_…` | original design brief and reference |
| `document.html` | report artefact — **not yet updated** to the two-state machine |
