# AL102 DFA Input String Acceptance Checker — Part B: Visual Design and Developer Handoff

**Controlling source:** `AL102_Part_A_Research_and_Technical_Specification` (the uploaded Part A; the `.md` and `.docx` copies were compared and their content is identical).
**Scope of this document:** visual design, component layout, state diagram presentation, responsive behavior, accessibility, and an implementation handoff. It does **not** implement the application.
**Not found:** the "multi-model workflow documentation" referenced in the request was not among the uploads, the working directory, or the memory store. This document follows the handoff rules stated inside Part A (Claude for visual design, then the implementation model). If the workflow document defines additional output or review requirements, send it and this handoff will be revised.

---

## 1. Rules this design must not break

These come from Part A, sections 2–4 and 10. Visual decisions below never override them.

- Exactly two states, `q0` and `q1`. No dead state, no `q2`, no extra nodes in the diagram.
- Alphabet `{0, 1}`. Start state `q0`. Accepting state `q1` only.
- Transition function: `δ(q0,0)=q0`, `δ(q0,1)=q1`, `δ(q1,0)=q0`, `δ(q1,1)=q1`. The diagram shows exactly these four edges and no others.
- Input is read exactly as entered. No trimming, no case folding, no stripping of spaces.
- Every character is validated before simulation. Any invalid character produces the error and **no** ACCEPTED or REJECTED result, and no trace.
- Acceptance is decided from the computed final state (accept iff final state is `q1`), not by inspecting the last character.
- Empty input (`ε`) runs zero transitions, reports final state `q0`, and shows REJECTED. It is not an invalid-symbol error. (Part A assumption, disclosed in the UI copy below.)
- Required output for every valid input: input string, starting state, each transition, complete state flow, final state, acceptance result. Section 10 maps each item to a named UI element.

---

## 2. Design plan and self-review

### 2.1 First-pass plan

The subject is a finite automaton: a machine that reads a strip of symbols one at a time and changes state. The vernacular of the subject is textbook automata theory: typeset formal notation (`q0`, `δ`, `Σ`), a state diagram with a double circle for the accepting state, and a worked example laid out as Given, Process, Answer. The first-pass plan borrowed those conventions directly: a textbook-style page with a serif display face, a machine drawing beside a worked example, and a warm cream background with a terracotta accent.

### 2.2 Review against the brief and the generic defaults

Checked against the common AI-generated page patterns, the first-pass plan had three problems:

| First-pass choice | Problem | Revision |
|---|---|---|
| Warm cream paper with terracotta accent | Matches the most common generated palette. | Cool graphite paper with blue-black ink. Accent is a highlighter yellow tied to "the cell currently being read," which is what a marker does on a printed worked example. |
| Accept/reject as coloured pills with rounded shadows | SaaS-card kit. | Result is a plain bordered block with an icon, a word, and a rule. No shadow. |
| Section eyebrow labels and middle-dot metadata | Template chrome. | Removed. Headings are plain sentence case. Metadata is a sentence. |
| Button text with a trailing arrow | Template chrome. | Removed. Buttons say what they do: "Check string", "Clear". |
| Animated fade-in on every section | Generic motion. | Removed. The only motion is the tape walk (section 2.4), which shows the machine reading left to right. |

The revised plan keeps the textbook reference because it fits the subject, and it carries one specific idea: the input is a tape, and the tape is read with a highlighter.

### 2.3 Final design decisions

- **Subject-derived identity:** the page reads like a worked example from an automata textbook. The machine drawing is a figure. The input is a tape.
- **Typography:** two families, clearly distinct. A serif for the title, the figure caption, the tape symbols, and the formal notation. The system sans for interface text. Values in the trace table use tabular figures in the sans, not monospace.
- **Alignment:** left-aligned throughout. No centred hero, no justified text.
- **Structural devices carry information:** hairline rules separate the three parts of the worked example (input, result, process). Rules are decorative and never the only boundary of an interactive control. Form controls use a graphite border (contrast 5.38:1 on paper), not a rule colour.
- **Corners:** 2px on the figure and tape cells, 4px on controls. One radius per role. No mixed radii.
- **Shadows:** none.
- **Numbering:** none, because the content is not a numbered list. The steps in the trace are a real sequence, so the trace table's Step column is the only numbering, and it is data.
- **Motion:** one tape walk on check, described in 2.4. Reduced motion removes it.

### 2.4 The one memorable moment

When a valid string is checked, the highlighter moves cell by cell along the tape from left to right, one cell per step, and the state flow fills in beside it. Total duration is capped at 900 ms (step interval `min(150 ms, 900 ms ÷ n)`). It is visual only: the result, the trace table, and the state flow are fully rendered and announced immediately, so the walk never delays information or hides it. With `prefers-reduced-motion: reduce`, the walk is skipped and the highlighter is placed on the last cell.

### 2.5 Palette (named values)

Light theme (default):

| Token | Hex | Role | Contrast on paper `#F4F6F7` |
|---|---|---|---|
| `--paper` | `#F4F6F7` | page background | — |
| `--surface` | `#FFFFFF` | figure and result backgrounds | — |
| `--ink` | `#1B2430` | body text, machine drawing | 14.44:1 |
| `--graphite` | `#5C6673` | secondary text, control borders | 5.38:1 |
| `--highlight` | `#FFD84D` | active tape cell fill (ink text on it: 11.32:1) | — |
| `--accept` | `#13684F` | ACCEPTED text and icon | 6.21:1 |
| `--reject` | `#A3262B` | REJECTED and invalid-input text and icon | 6.75:1 |
| `--focus` | `#1F5FBF` | focus ring | 5.62:1 |
| `--rule` | `#C9D0D6` | decorative hairlines only (1.44:1, not for controls) | — |

Dark theme (`prefers-color-scheme: dark`):

| Token | Hex | Contrast on `#151B22` |
|---|---|---|
| `--paper` | `#151B22` | — |
| `--surface` | `#1C232C` | — |
| `--ink` | `#E6EAEE` | 14.33:1 |
| `--graphite` | `#9AA5B1` | 6.92:1 |
| `--highlight` | `#E8C23A` | text on it must be `--paper` (10.08:1). Ink text on it fails (1.42:1). |
| `--accept` | `#5FC9A3` | 8.56:1 |
| `--reject` | `#F08A84` | 7.16:1 |
| `--focus` | `#7FB2FF` | 8.02:1 |
| `--rule` | `#2C3742` | decorative only |

### 2.6 Type

- **Serif (display, figure, tape):** `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`.
  - Title 30px / 1.2, weight 600.
  - Tape symbols 28px, weight 400, tabular figures (`font-variant-numeric: tabular-nums`).
  - Figure caption 15px italic.
- **Sans (interface):** `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
  - Body 16px / 1.55. Maximum prose width 64ch.
  - Labels 14px, weight 600 (sentence case, not uppercase).
  - Trace and table values 15px, `font-variant-numeric: tabular-nums`.
- **Scale:** 14, 15, 16, 18, 22, 30. No other sizes. No type below 14px except tape index numerals at 12px (see 4.4).
- Fonts are system stacks, not web fonts. The page loads nothing from the network.

### 2.7 Spacing and sizing

- 4px base grid: 4, 8, 12, 16, 24, 32, 48.
- Page padding 24px desktop, 16px below 640px. Column gap 48px desktop, 32px tablet.
- Hairline rule 1px `--rule`. Control border 1px `--graphite`.
- Minimum touch target 44 × 44px for buttons and example entries.

### 2.8 Layout concept

Two columns on desktop. The left column is the worked example, read top to bottom. The right column is the reference: the machine drawing, the transition function, the formal definition, and the test runner.

```
Desktop, 1024px and wider

+-------------------------------------------------------------------+
| DFA Input String Acceptance Checker                  (serif, 30) |
| This machine accepts binary strings that end in 1.               |
+-----------------------------------+-------------------------------+
| Input                             | [ Figure: state diagram ]     |
| Binary string                     |                               |
| [ 10101              ] [Check] [Clear]  Figure 1. The machine,     |
| Only 0 and 1 are allowed.         | start arrow into q0, double    |
| Examples: 10101  10100  1021      | circle on q1.                 |
| -------------------------------   | -----------------------------  |
| Result                            | Transition function           |
| ACCEPTED   Final state q1         | table: states x symbols       |
| The last symbol read was 1.       | -----------------------------  |
| -------------------------------   | Definition                    |
| Tape                              | Q = {q0, q1}  Sigma = {0, 1}  |
|  1  0  1  0  1                    | q0 start      F = {q1}        |
|  1  2  3  4  5                    | -----------------------------  |
| State flow                        | Test cases       [Run tests]  |
| q0 -> q1 -> q0 -> q1 -> q0 -> q1  | 18 rows, pass or fail         |
| -------------------------------   |                               |
| Trace (scrolls)                   |                               |
|  Step  Transition                 |                               |
|  Start q0                         |                               |
|  1     q0 + 1 -> q1               |                               |
+-----------------------------------+-------------------------------+
```

Reading order (DOM order and tab order) matches the left column first, then the right column. The result sits above the tape and trace so the answer is seen before the explanation.

### 2.9 Alignment

Everything is left-aligned, including the title, result, tape, and trace. The figure is left-aligned in its column. Table numbers are right-aligned within their own column only.

### 2.10 Principles (one line each)

1. The input is a tape, and the tape is what gets read.
2. The figure looks like a textbook figure, not a dashboard widget.
3. Every result says its own reason in a sentence.
4. One motion moment, skippable, and it shows reading.
5. Colour is never the only signal.

---

## 3. State diagram presentation

### 3.1 Requirements from Part A (section 3)

Two nodes only. Incoming start arrow into `q0`. `q1` drawn as a double circle. Four labelled edges: `q0 --0--> q0`, `q0 --1--> q1`, `q1 --0--> q0`, `q1 --1--> q1`. Arrows must show direction. A colour change alone is not a substitute for the double circle or the labels.

### 3.2 Geometry

The figure is an inline SVG with `viewBox="0 0 560 260"`. The geometry below is canonical. The reference file `AL102_Part_B_Design_Reference.html` contains the same SVG and is the copy-paste source.

| Element | Geometry | Notes |
|---|---|---|
| Node `q0` | circle centre (170,140), r=40 | non-accepting, single stroke |
| Node `q1` | circle centre (390,140), r=40 inner, r=48 outer | double circle = accepting |
| Start arrow | line (40,140) → (130,140) | arrowhead at the q0 edge |
| Edge `q0 --1--> q1` | line (210,140) → (340,140) | straight, label `1` above at (275,130) |
| Edge `q1 --0--> q0` | quadratic curve M356.1,173.9 Q277,225 198.3,168.3 | below the baseline, label `0` at (277,222) |
| Self-loop `q0 --0--> q0` | cubic M150,105.4 C120,30 220,30 190,105.4 | above q0, label `0` at (170,36) |
| Self-loop `q1 --1--> q1` | cubic M366,98.4 C336,22 444,22 414,98.4 | above q1, label `1` at (390,30) |
| Node labels | `q0` at (170,147), `q1` at (390,147), serif 22px | text centred on node |

Arrowhead: a `<marker id="arrow">` with a 10 × 10 triangle, `refX="10" refY="5"`, `orient="auto"`, filled with `currentColor`.

Stroke: 2px for edges and nodes, 1.5px for the outer ring of q1. Edge labels: serif 18px.

### 3.3 Classes the implementation uses

The SVG is static markup in `index.html`. JavaScript only toggles classes; it never rebuilds the diagram.

| Class | Applied to | Meaning |
|---|---|---|
| `.node--active` | the node for the current state | the machine is in this state now (during the tape walk) |
| `.edge--taken` | the edge used on the current step | highlights the transition just taken: stroke `--focus`, stroke width 4px (other edges are `--ink`, 2px) |
| `.is-dim` | all nodes and edges | used only when no string has been checked yet (idle figure at 60% opacity) |

Active node: fill `--highlight`, text `--paper` (light and dark themes both use the paper colour as text on the highlight). The node label stays visible in every state. The active state is also named in text in the tape walk status line, so colour is not the only signal.

Edge IDs (fixed): `edge-q0-q0-0`, `edge-q0-q1-1`, `edge-q1-q0-0`, `edge-q1-q1-1`. Node IDs: `node-q0`, `node-q1`.

### 3.4 Accessible text alternative

```html
<svg role="img" aria-labelledby="dfa-title dfa-desc">
  <title id="dfa-title">Two-state DFA</title>
  <desc id="dfa-desc">States q0 and q1. q0 is the start state, marked by an arrow with no source. q1 is the accepting state, drawn as a double circle. From q0, input 0 returns to q0 and input 1 goes to q1. From q1, input 0 goes to q0 and input 1 returns to q1.</desc>
  ...
</svg>
```

The transition table in section 4.7 is the full text equivalent. Screen-reader users can use either.

### 3.5 Presentation rules

- The figure is never cropped. On narrow screens it scrolls horizontally inside its own box (section 6.3); the page itself never scrolls sideways.
- The figure keeps its aspect ratio (`width: 100%; height: auto`) with `max-width: 520px` on desktop.
- The figure is captioned below in serif italic: "Figure 1. The machine. The arrow with no source marks the start state; the double circle marks the accepting state."
- For the report, the figure is exported from the running app as a screenshot or as the SVG. Do not redraw it by hand.

---

## 4. Components

Each component lists: purpose, DOM ID, states, copy, and accessibility. Copy strings are exact and must be used verbatim.

### 4.1 Page header

- `<header>` containing `<h1>` with text **DFA Input String Acceptance Checker**.
- One sentence below: **This machine accepts binary strings that end in 1.**
- No logo, no nav, no eyebrow label.

### 4.2 Input panel (`#input-panel`)

- `<label for="dfa-input">` text: **Binary string**
- `<input id="dfa-input" type="text" inputmode="text" autocomplete="off" spellcheck="false">`
  - No `maxlength`. Long input is accepted and the tape wraps.
  - Border `--graphite`, 2px on focus using `--focus` with 2px offset.
- Helper text, linked with `aria-describedby="dfa-help"`: **Only 0 and 1 are allowed.**
- Buttons:
  - `#check-btn` label **Check string**. Primary: `--ink` background, `--surface` text. Pressing Enter in the input also runs it.
  - `#clear-btn` label **Clear**. Secondary: transparent, `--ink` text, `--graphite` border.
- Example entries: three plain text buttons (not pills), labelled **10101**, **10100**, and **1021**. Each fills the input and runs the check. Entry **1021** is the assignment's invalid example. Hit area 44px high.

### 4.3 Validation error (`#error`)

- Container `role="alert"`, hidden when there is no error.
- Border-left 4px `--reject`. Icon (cross, `aria-hidden`) and text in `--reject`.
- Line 1 (exact, from Part A pseudocode): **ERROR: Invalid input. The DFA only accepts the symbols 0 and 1.**
- Line 2, one per invalid character, in order: **Found “2” at position 3.** Whitespace is named: **Found space at position 3.** Positions are 1-based.
- Line 3: **Remove the highlighted symbol and check again.**
- Input gets `aria-invalid="true"` and `aria-describedby` pointing at `#error`.
- The error never apologises and never says "Oops" or "Sorry".

### 4.4 Input tape (`#tape`)

- The worked-example tape: an ordered list (`<ol aria-label="Input tape, 5 symbols">`). Each symbol is an `<li>` with the symbol and a visually hidden index like "symbol 1 of 5".
- Cell: 40px wide and 48px tall desktop, 36 × 44px below 640px. Border 1px `--graphite`, radius 2px, background `--surface`, symbol in the serif 28px.
- Index numerals under each cell at 12px `--graphite`, shown for position 1 and every fifth position only (1, 5, 10, 15 …). This keeps the row readable and avoids 12px clutter.
- Invalid symbol cell: border 2px `--reject`, a small cross glyph beside it, `aria-label` includes "invalid".
- Empty input: one cell showing **ε**, with the index row showing nothing.
- The tape is not interactive and not focusable.
- Walk: the cell receiving the highlighter gets background `--highlight` and text `--paper` (light and dark). It moves per section 2.4. The final cell keeps the highlight until the next check or input change.

### 4.5 Result block (`#result`)

Live region: `role="status"` `aria-live="polite"`. Updated once per check, never per walk frame.

Idle copy (before any check): **Enter a string and check it.**

Valid, accepted: a bordered block (1px `--rule`, 4px `--accept` left border), contents in this order:
1. Icon (tick, `aria-hidden`) and the word **ACCEPTED** in 30px serif, colour `--accept`.
2. A line: **Input** followed by the string in serif, for example `10101`.
3. A line: **Start state** `q0`.
4. A line: **Final state** `q1`.
5. A sentence: **The last symbol read was 1, so the machine ends in q1, which is accepting.**

Valid, rejected: same structure, word **REJECTED**, colour `--reject`, icon cross. Sentence: **The last symbol read was 0, so the machine ends in q0, which is not accepting.**

Empty input: word **REJECTED**. Input line shows **ε (empty string)**. Sentence: **No symbols were read, so the machine stays in q0, which is not accepting.**

Invalid input: the result block shows **No result.** and the sentence **Fix the input to see the transitions.** It contains no ACCEPTED or REJECTED text, no final state, and no start state.

The "last symbol" sentences restate the DFA rule in plain language for the recitation (Part A section 8). They are computed from the last transition in the trace, and the rule still comes from the final state.

### 4.6 State flow (`#flow`)

- Ordered list `<ol aria-label="State flow">`, horizontal, wrapping on narrow screens.
- Items are the state names in serif: `q0`, `q1`, and so on, separated by a visible arrow `→` marked `aria-hidden`.
- Visually hidden text per item: "state q0", etc.
- Final item: a 1px ring around the text in `--ink`, and a visually hidden "final state". No colour alone.
- For empty input: one item, `q0`, no arrows.

### 4.7 Transition table and definition (`#dfa-reference`)

Transition table, `<table>` with caption **Table 1. Transition function.**

| State | Input 0 | Input 1 |
|---|---|---|
| q0 (start) | q0 | q1 |
| q1 (accepting) | q0 | q1 |

Row headers carry the start and accepting markers in text. The active row/cell during the walk gets a 2px `--highlight` outline (not a fill) so it does not compete with the tape.

Definition block (plain definition list): `Q = {q0, q1}`, `Σ = {0, 1}`, `start state = q0`, `F = {q1}`. Serif for the symbols.

### 4.8 Trace (`#trace`)

- Scrollable region: `tabindex="0"` with `aria-label="Trace"`, maximum height 360px desktop, 50vh on mobile. Table header is sticky inside the scroll region.
- Table with two columns, **Step** and **Transition**.
- Start row: Step **Start**, Transition **q0**.
- Each step row: Step **1**, **2**, … and Transition in the form `q0 + 1 → q1` (values in sans with tabular figures).
- Visually hidden text per transition row, for example "Step 1: from q0, reading 1, go to q1." The arrow `→` is `aria-hidden`.
- Final row: a small text tag **Final** after the state name. Not colour alone.
- Empty input: only the Start row.
- The trace is not rendered for invalid input.

### 4.9 Built-in test cases (`#tests`)

- Button `#tests-btn` label **Run test cases**.
- Table with columns **#**, **Input**, **Expected**, **Actual**, **Status**. Rows:
  - The ten required cases from Part A section 6: `1` ACCEPTED, `0` REJECTED, `11` ACCEPTED, `10` REJECTED, `101` ACCEPTED, `100` REJECTED, `111` ACCEPTED, `110` REJECTED, `10101` ACCEPTED, `10100` REJECTED.
  - The eight recommended additional cases: `0000` REJECTED, `0001` ACCEPTED, `1110` REJECTED, `000000001` ACCEPTED, `1021` validation error, `10a1` validation error, `10 1` validation error, empty input REJECTED in q0.
- Status text: **PASS** with a tick, or **FAIL** with a cross. Colour is never the only signal.
- Summary line above the table (`aria-live="polite"`): **18 of 18 passed.** or **17 of 18 passed.** and the failing row numbers.
- Tests use the same simulation function as the main checker. The table of expected results is the oracle; the code does not derive expectations from the last character.
- The table is a focusable scroll region on narrow screens.

This panel is an addition beyond the minimum (it is not in Part A section 10's required output list). It supports the "Test results" deliverable and the demonstration. It may be removed if the group decides the report will show test results from screenshots instead, but no required feature depends on it.

### 4.10 Footer

None. The page ends after the test table.

---

## 5. Required output mapping (Part A section 2.2)

| Required output | Where it appears | Element |
|---|---|---|
| Input string | Result block, "Input" line; input field | `#result`, `#dfa-input` |
| Starting state | Result block, "Start state" line; trace Start row | `#result`, `#trace` |
| Each input symbol and transition | Trace rows, `q0 + 1 → q1` form; tape cells | `#trace`, `#tape` |
| Complete state flow | State flow line | `#flow` |
| Final state | Result block, "Final state" line; flow final item | `#result`, `#flow` |
| Acceptance result | Result block heading: ACCEPTED or REJECTED | `#result` |
| Invalid-symbol error, no completed result | Error block; result block shows "No result." | `#error`, `#result` |
| State diagram with required features | Figure | `#dfa-figure` |
| Transition table | Table 1 | `#dfa-reference` |

---

## 6. Responsive behavior

### 6.1 Breakpoints

| Name | Width | Layout |
|---|---|---|
| Narrow | below 640px | single column, 16px side padding |
| Medium | 640px to 1023px | single column, content maximum 720px, 24px side padding |
| Wide | 1024px and wider | two columns (7fr worked example, 5fr reference), content maximum 1200px |

### 6.2 Order by breakpoint

- **Wide:** left column is input, result, tape, flow, trace. Right column is figure, transition table, definition, tests.
- **Medium and narrow:** single column in DOM order: header, input, error, result, tape, flow, trace, figure, transition table, definition, tests.
- The DOM order is the same at every breakpoint. Only the grid placement changes. Keyboard and screen-reader order therefore match the visual order on every size.

### 6.3 The figure on narrow screens

- The figure sits in a box with `overflow-x: auto`.
- The SVG has `min-width: 460px` below 480px wide, so labels stay at 15px or larger on screen. The box then scrolls sideways. The page itself never does.
- A short hint is not needed. The transition table beside it is always visible and contains the same information.

### 6.4 Input row

- Wide and medium: input and buttons share one row. Input fills the remaining width. Buttons keep their natural width.
- Narrow (below 640px): input is full width. The two buttons sit side by side below it, each taking half the width. Example entries wrap onto the next line.

### 6.5 Tape and trace

- The tape wraps onto additional lines. Cells keep their size; the row never shrinks symbols below 36px.
- The trace table keeps its two columns. Values wrap inside the Transition column if needed.
- The trace scroll region is 360px maximum on wide and medium layouts and 50vh on narrow layouts.

### 6.6 Zoom and reflow

- The layout reflows at 320 CSS px wide with no horizontal scrolling of the page (WCAG 1.4.10). The only permitted scroll regions are the figure box and the trace and test-table regions.
- At 200% browser text zoom, nothing is clipped and all controls remain reachable.

### 6.7 Touch

- Buttons and example entries are at least 44 × 44px.
- No hover-only information. Anything shown on hover (none is required) is also available on focus or tap.

---

## 7. Accessibility requirements

Target: WCAG 2.2 Level AA.

### 7.1 Structure

- `<html lang="en">`, `<meta charset="utf-8">` (the page shows `Σ`, `δ`, `→`, `ε`, `“ ”`).
- One `<h1>`. Sections use `<h2>`: Input, Result, Tape, State flow, Trace, Figure, Transition function, Definition, Test cases. Keep all h2s visually present; none is hidden.
- Landmarks: `<header>`, `<main>` (wraps both columns), `<section>` for each h2 group with `aria-labelledby`.

### 7.2 Keyboard

Tab order follows the DOM order in section 6.2:
1. Input
2. Check string
3. Clear
4. Example 10101, Example 10100, Example 1021
5. Trace region (focusable because it scrolls)
6. Run test cases
7. Test table region (focusable because it scrolls)

- Enter in the input runs the check. No other keyboard shortcuts are defined.
- Non-interactive regions (tape, flow, result, figure) are not in the tab order.

### 7.3 Focus

- Focus ring: 2px solid `--focus`, offset 2px. Contrast 5.62:1 on paper and 8.02:1 on dark paper.
- Never `outline: none` without a replacement.
- After Check, focus stays in the input. After Clear, focus returns to the input.
- After Run test cases, focus stays on the button; the summary line is announced.

### 7.4 Live regions

| Region | Setting | Announces |
|---|---|---|
| `#error` | `role="alert"` | the error copy on invalid input |
| `#result` | `role="status"` `aria-live="polite"` | once per check: "ACCEPTED. Final state q1." or "REJECTED. Final state q0." or "No result." |
| Test summary | `aria-live="polite"` | "18 of 18 passed." |

The tape walk is not announced step by step. The result is announced once, after the walk finishes (if the walk runs), so screen-reader users are not interrupted by sixteen announcements. With reduced motion, the walk is skipped and the announcement happens immediately.

### 7.5 Colour is never the only signal

| Information | Colour | Also shown as |
|---|---|---|
| ACCEPTED / REJECTED | green / red | word and icon |
| Invalid symbol | red border | cross glyph, `aria-label` "invalid" |
| Final state | none | ring in flow and "final state" text |
| Active node in figure | highlight fill | the node label and the walk status text |
| PASS / FAIL | green / red | word and icon |
| Start arrow and accepting state | none | arrow with no source; double circle; caption |

### 7.6 Contrast

- All body text and small text meets 4.5:1 in both themes (values in section 2.5).
- Large text (30px title) meets 3:1.
- Non-text boundaries that identify interactive controls (input border, button border) meet 3:1 (`--graphite` is 5.38:1 on paper and 6.33:1 on dark surface).
- Decorative hairlines (`--rule`, about 1.44:1) must not be the only indicator of a control boundary or of an error.
- The highlight pair is checked by role: ink on highlight is 11.32:1 in light; paper on highlight is 10.08:1 in dark. Ink on highlight in dark (1.42:1) is forbidden.

### 7.7 Motion

- `@media (prefers-reduced-motion: reduce)` disables the tape walk and any transition on the figure and buttons.
- No flashing. The tape walk moves one highlight at a time, never flashes it.

### 7.8 Text alternatives

- Figure: `<title>` and `<desc>` (section 3.4), plus the transition table.
- Tape: each symbol carries a visually hidden index and value (`symbol 3 of 5: 1`).
- Trace: each row has a visually hidden sentence (section 4.8).
- Icons: `aria-hidden="true"` wherever a word already carries the meaning.

### 7.9 Forms and errors

- The input has a visible label (not placeholder-only).
- Helper text is linked with `aria-describedby`.
- On error: `aria-invalid="true"` on the input. Focus stays in the input. The `role="alert"` block announces the error.
- Error text is specific: it names the character and its 1-based position, and says what to do.

### 7.10 Language and copy

- Plain sentence case. No all-caps labels. (The words ACCEPTED and REJECTED are the required output and are the only uppercase words.)
- Notation in the copy is consistent: `q0`, `q1`, `Σ`, `δ`, `ε`. The reference file uses those exact strings.

---

## 8. Developer handoff for the implementation model

### 8.1 Files and constraints

- Three files in one folder: `index.html`, `styles.css`, `script.js` (Part A section 4 recommendation).
- Vanilla HTML, CSS, and JavaScript. No framework, no build step, no package install, no backend, no storage, no network requests.
- Fonts: system stacks only (section 2.6).
- `AL102_Part_B_Design_Reference.html` is the visual source for the markup and CSS. Copy its markup and CSS into `index.html` and `styles.css`. Remove the design-state previews (the reference shows idle, accepted, rejected, invalid, and empty side by side). The app must show one state at a time, driven by input.

### 8.2 Element ID map

| ID | Element |
|---|---|
| `header` | `<header>` with `h1` |
| `input-panel` | `<section>` for input |
| `dfa-input` | the text input |
| `dfa-help` | helper text |
| `check-btn` | Check string |
| `clear-btn` | Clear |
| `example-1`, `example-2`, `example-3` | example entries: 10101, 10100, 1021 |
| `error` | `role="alert"` block |
| `result` | `role="status"` block |
| `tape` | `<ol>` of input symbols |
| `flow` | `<ol>` of state flow |
| `trace` | scroll region containing the trace table |
| `dfa-figure` | `<figure>` wrapping the SVG and its caption |
| `dfa-svg` | the inline SVG |
| `node-q0`, `node-q1` | SVG node groups |
| `edge-q0-q0-0`, `edge-q0-q1-1`, `edge-q1-q0-0`, `edge-q1-q1-1` | SVG edge paths |
| `dfa-reference` | transition table and definition |
| `tests-btn` | Run test cases |
| `tests-summary` | `aria-live` summary line |
| `tests-table` | scroll region containing the test table |

### 8.3 Logic contract

Separate pure logic from rendering. The simulation has no DOM access.

Data (one definition, used everywhere):

```js
const DFA = {
  states: ['q0', 'q1'],
  alphabet: ['0', '1'],
  start: 'q0',
  accepting: ['q1'],
  delta: {
    q0: { '0': 'q0', '1': 'q1' },
    q1: { '0': 'q0', '1': 'q1' },
  },
};
```

Functions (names suggested; the implementer may rename but keep the contracts):

| Function | Input | Output | Notes |
|---|---|---|---|
| `validate(input)` | string, unmodified | `{ valid, invalid: [{ symbol, index }] }` | `index` is 1-based. A space is reported with `symbol: ' '` and rendered as "space". Every character that is not `0` or `1` is invalid. No trimming. |
| `simulate(input)` | valid string | `{ input, startState, steps, flow, finalState, accepted }` | `steps` is `[{ step, from, symbol, to }]`, with `step` starting at 1. `flow` is `['q0', ...]` with one more entry than `steps`. `accepted` is `finalState === 'q1'`, computed from the final state. Empty input: `steps []`, `flow ['q0']`, `finalState 'q0'`, `accepted false`. |
| `renderIdle()` | none | none | Clears error, result, tape, flow, trace, figure classes. Sets result to the idle copy. |
| `renderInvalid(errors)` | from `validate` | none | Shows error copy and per-symbol lines; tape marks invalid cells; result shows "No result."; flow and trace stay empty; figure stays idle. |
| `renderResult(sim)` | from `simulate` | none | Fills result block (section 4.5) and calls `renderFlow`, `renderTrace`. |
| `renderTape(input, errors)` | string, errors | none | One `<li>` per symbol, or one `ε` cell for empty input. |
| `renderFlow(flow, finalState)` | | none | Final item gets the ring class and "final state" text. |
| `renderTrace(steps, finalState)` | | none | Start row, then one row per step. |
| `setActiveNode(state)` | `'q0'` or `'q1'` | none | Toggles `.node--active`. |
| `setTakenEdge(edgeId)` | edge ID or `null` | none | Toggles `.edge--taken`. |
| `runWalk(steps, onDone)` | steps | cancel function | Advances the highlight one cell per step on a timer. Total duration capped at 900 ms. Calls `onDone` once. The cancel function stops pending timers and leaves the final state rendered. Skipped under reduced motion. |
| `runTests(cases)` | `[{ input, expected }]` | `[{ input, expected, actual, pass }]` | `expected` is `'ACCEPTED'`, `'REJECTED'`, or `'INVALID'`. `actual` comes from `validate` and `simulate`, never from the last character. |

### 8.4 Interaction rules

- **Check** (button or Enter):
  1. Cancel any running walk.
  2. `validate(input)`. If invalid, `renderInvalid`. Stop.
  3. Otherwise `simulate(input)`, `renderResult`, `renderTape`, `setActiveNode(startState)`.
  4. Run the walk (section 2.4). Each tick calls `setActiveNode` and `setTakenEdge`. When it finishes, the figure shows the last active node and taken edge, and the result announcement happens once.
- **Editing the input** (`input` event): cancel any walk, then `renderIdle()`. The page never shows results for a string other than the one in the field's last check.
- **Example entry**: sets the input value, then runs Check.
- **Clear**: sets the input to empty, runs `renderIdle()`, focuses the input.
- **Run test cases**: runs `runTests(TEST_CASES)` and renders the table and summary. Does not change the main input or the main result.
- The result block is announced once per check. Do not announce per tick.

### 8.5 Edge cases

| Input | Expected display |
|---|---|
| `1` | ACCEPTED. One step: `q0 + 1 → q1`. Flow: `q0 → q1`. |
| `0` | REJECTED. One step: `q0 + 0 → q0`. Flow: `q0 → q0`. |
| `10101` | ACCEPTED. Five steps. Flow: `q0 → q1 → q0 → q1 → q0 → q1`. |
| `10100` | REJECTED. Five steps. Flow: `q0 → q1 → q0 → q1 → q0 → q0`. |
| `1021` | Error: invalid symbol `2` at position 3. No result. No trace. |
| `10a1` | Error: invalid symbol `a` at position 3. |
| `10 1` | Error: invalid space at position 3. |
| `101 ` (trailing space) | Error: invalid space at position 4. Not trimmed. |
| empty | REJECTED in q0. No steps. Tape shows `ε`. Flow shows `q0`. |
| all zeros, long input | REJECTED. The trace scrolls. Do not truncate. |
| very long input (about 10,000 symbols) | Works. Build the tape and trace with a `DocumentFragment`. No pagination. |
| Unicode digits such as `١` | Invalid. Only ASCII `0` and `1` are valid. |

### 8.6 Safety and correctness

- User input is displayed with `textContent`, never `innerHTML`. Input can contain anything, including markup.
- Do not change the DFA rules, the state names, or the diagram's four edges.
- Do not add states, edges, or labels beyond those in Part A.
- Do not trim, lowercase, auto-correct, or strip characters from the input.
- Do not show ACCEPTED or REJECTED for invalid input.
- Do not add persistence (no `localStorage`).

### 8.7 CSS

- Define all colour and type values as custom properties on `:root`, with the dark values under `@media (prefers-color-scheme: dark)`. Set `color-scheme: light dark`.
- The reference file defines these tokens. Copy them; do not re-derive them from this document.
- Use one selector per component. Avoid combining generic class names with element selectors for spacing (for example `.section` plus `section`), because that produces conflicting margins and padding.

---

## 9. Implementer self-check (run before handing back)

- [ ] Diagram shows exactly `q0`, `q1`, and four labelled edges, and no other edges or nodes.
- [ ] Start arrow points into `q0` from outside the figure.
- [ ] `q1` is drawn as a double circle, and the caption says so.
- [ ] `1021` shows the error copy with `2` at position 3, and no ACCEPTED or REJECTED text anywhere on the page.
- [ ] `10101` shows ACCEPTED, final state `q1`, five steps, and the flow `q0 → q1 → q0 → q1 → q0 → q1`.
- [ ] `10100` shows REJECTED, final state `q0`, five steps, and the flow `q0 → q1 → q0 → q1 → q0 → q0`.
- [ ] Empty input shows REJECTED in `q0` with no steps, and does not show an invalid-symbol error.
- [ ] Trace rows read in the form `q0 + 1 → q1`, with a visually hidden sentence for screen readers.
- [ ] Run test cases shows 18 rows, all passing, using the same `validate` and `simulate` functions.
- [ ] Tab order matches section 7.2 at every breakpoint.
- [ ] Focus ring is visible in both themes.
- [ ] Error and result regions are announced once each, with the correct live-region settings.
- [ ] Colour is not the only signal for any state (section 7.5).
- [ ] The page is usable at 320 CSS px width, with no horizontal page scroll.
- [ ] At 200% text zoom, nothing is clipped.
- [ ] With reduced motion enabled, the tape walk is skipped and the result still appears.
- [ ] Dark theme uses the dark tokens, and the highlight uses paper-coloured text.
- [ ] No network requests, no external fonts, no frameworks.
- [ ] `textContent` is used for all user input.

---

## 10. Screenshot plan for the report

Capture only from the running application, never from a mockup. Use one browser and one OS for every capture, and record which one in the report.

| Capture | Input | Purpose |
|---|---|---|
| 1. Idle | none | Initial layout and figure |
| 2. Accepted | `10101` | ACCEPTED, full trace, flow |
| 3. Rejected | `10100` | REJECTED, final `q0` |
| 4. Invalid | `1021` | Error copy, no result |
| 5. Empty | none, checked | REJECTED in `q0` with ε |
| 6. Tests | Run test cases | 18 of 18 passed |
| 7. Figure | none | Close-up for the state diagram section |

Suggested capture width: 1280 × 800 (wide layout), light theme. Optional: 375 px wide (narrow layout) for the demonstration.

---

## 11. Assumptions and open items

1. **Workflow document not provided.** The "multi-model workflow documentation" was not in the uploads, the working directory, or memory. This handoff follows Part A's stated process. Send the document if it requires a specific output format or review step.
2. **Empty input.** Behavior comes from Part A section 4 (zero transitions, REJECTED in `q0`). The copy discloses it. If the instructor says empty input must be disallowed, change the validation step only; the figure and tape do not change.
3. **Test panel.** The built-in test table is a design addition, outside Part A's required list. It is useful for the test-results deliverable and the demonstration. It can be removed without affecting required behavior.
4. **Dark theme.** Follows the operating-system preference only. There is no toggle, which keeps the page minimal.
5. **System fonts.** Rendering differs between operating systems. The report screenshots must say which system they were taken on.
6. **Cover page.** Not designed here. Use the placeholders from Part A section 7.
7. **Screenshots and demonstration notes.** Must come from the real application (section 10).

