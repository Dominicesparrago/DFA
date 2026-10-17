# DECIDER_ONEFILE.html — single-file DFA checker

One document that carries everything: **HTML, CSS, JavaScript and `dfa.py`**.
Save it, open it in a browser, and it runs. No build step, no framework, no
server, no network, no dependencies.

```
DECIDER_ONEFILE.html        47,077 bytes   the whole application
DECIDER_ONEFILE.md          this file      what is inside it and how to use it
```

---

## 1. Quick start

1. Copy `DECIDER_ONEFILE.html` anywhere on disk.
2. Open it — double-click is fine. It runs straight from `file://`.
3. Type a binary string and press **Check string**.
4. Press **Run test cases** to execute all 29 oracle cases in the browser.

The page is genuinely self-contained. Verified by static scan:

| Check | Result |
|---|---|
| External `src` / `href` pointing at `http(s)` | 0 |
| `fetch()` calls | 0 |
| `XMLHttpRequest` | 0 |
| `<script type="module">` | 0 |
| `import` statements | 0 |
| `innerHTML` | 0 |
| `<script>` blocks / `<style>` blocks | 1 / 1, both inline |

`localStorage` is used only to remember the theme, and every call is wrapped in
`try/catch` — it throws in some `file://` contexts and the page carries on
without it.

---

## 2. The machine

The DFA required by the AL102 assignment. It accepts every binary string that
**ends in 1**.

```
Alphabet    Σ = {0, 1}
States      Q = {q0, q1}
Start       q0
Accepting   F = {q1}
Dead        none

             input 0    input 1
   → q0        q0        q1
   * q1        q0        q1
```

| Current state | Input `0` | Input `1` |
|---|---|---|
| `q0` | `q0` | `q1` |
| `q1` | `q0` | `q1` |

- `q0` — the input read so far is empty or ends in `0`
- `q1` — the input read so far ends in `1`

**There is no dead state, and that is a property of the language.** Both symbols
are defined in both states, so no input can get stuck and a trap could only
reject perfectly good strings. An earlier version of this project recognised the
single exact string `101` and needed a trap; that machine was wrong for this
assignment and is not what this file contains.

A string is accepted exactly when the machine finishes in `q1`. Acceptance is
read from the **final state**, never from the last character.

---

## 3. What is inside the file

| Part | Where | What it does |
|---|---|---|
| Interface | `<body>` | input, verdict, diagram, execution steps, transition table, test cases |
| Presentation | one `<style>` block | dark and light themes, driven entirely by CSS variables |
| Behaviour | one `<script>` block | validation, simulation, figure generation, playback, tests |
| Machine | `<pre id="dfa-py">` | `dfa.py`, embedded **verbatim**, with Copy and Download buttons |

The JavaScript is a faithful line-by-line port of `dfa.py`. It exists only so the
file can run on its own in a browser. Where the two could ever disagree,
**`dfa.py` is right**.

Both read the same transition table. Both validate *before* simulating. Both
decide acceptance from the final state.

---

## 4. Getting `dfa.py` out

Three ways, in order of convenience:

1. **Copy** — open the *dfa.py* panel at the bottom of the page and press
   **Copy**. It tries the async Clipboard API first and falls back to
   `document.execCommand('copy')`, which is the path that still works on a page
   opened from disk. If the browser blocks both, the source is selected for you
   so `Ctrl+C` (`Cmd+C`) works immediately.
2. **Download** — press **Download dfa.py**. Saves `dfa.py` next to your
   downloads.
3. **Manual** — expand the panel and select the text.

The embedded copy is **byte-for-byte identical** to the project's `dfa.py`
(8,673 bytes, 229 lines, verified by direct comparison after extraction).

To run it on its own:

```bash
python dfa.py
```

---

## 5. Features

**Input** — a text field, Check, Clear, and four one-click examples (`1`, `0`,
`101`, `1021`). Typing checks as you go; `Enter` checks.

**Validation** — only `0` and `1` are allowed. Anything else stops processing and
reports the offending symbol with its 1-based position
(`Found "2" at position 3.`). A space is reported as *space*. An invalid string
produces **no** verdict and **no** execution steps, because the machine never
read it.

**Verdict** — `ACCEPTED` or `REJECTED`, with the input, start state, final state,
complete state flow, and a plain-English explanation.

**State diagram** — generated from Table 1 at load, so the drawing cannot
disagree with the machine printed beside it. Two states, the double ring on `q1`,
the source-less start arrow, and four labelled transitions. Change a cell in
Table 1 and the figure changes with it.

**Execution steps** — a separate table, one row per input symbol, generated from
the steps the machine returned. These are execution steps, **not** extra states:
the machine always has exactly two.

**Playback** — a token rides one arrow per step while the traversed arrow is
highlighted and the rows complete in order.

**Test cases** — 29 cases in the browser, each asserting the acceptance result
**and** the expected final state.

**Theme** — dark and light, following the OS preference on first visit and
remembered after that.

---

## 6. Test cases

All 29 pass, both in the browser and standalone:

| # | Input | Expected | Actual | Final | Result |
|---|---|---|---|---|---|
| 1 | `1` | ACCEPTED | ACCEPTED | q1 | PASS |
| 2 | `0` | REJECTED | REJECTED | q0 | PASS |
| 3 | `11` | ACCEPTED | ACCEPTED | q1 | PASS |
| 4 | `10` | REJECTED | REJECTED | q0 | PASS |
| 5 | `101` | ACCEPTED | ACCEPTED | q1 | PASS |
| 6 | `100` | REJECTED | REJECTED | q0 | PASS |
| 7 | `111` | ACCEPTED | ACCEPTED | q1 | PASS |
| 8 | `110` | REJECTED | REJECTED | q0 | PASS |
| 9 | `10101` | ACCEPTED | ACCEPTED | q1 | PASS |
| 10 | `10100` | REJECTED | REJECTED | q0 | PASS |
| 11 | `0101` | ACCEPTED | ACCEPTED | q1 | PASS |
| 12 | `1010` | REJECTED | REJECTED | q0 | PASS |
| 13 | `0001` | ACCEPTED | ACCEPTED | q1 | PASS |
| 14 | `11000` | REJECTED | REJECTED | q0 | PASS |
| 15 | `11111` | ACCEPTED | ACCEPTED | q1 | PASS |
| 16 | `00000` | REJECTED | REJECTED | q0 | PASS |
| 17 | `0111111` | ACCEPTED | ACCEPTED | q1 | PASS |
| 18 | `0000000000000` | REJECTED | REJECTED | q0 | PASS |
| 19 | `101101` | ACCEPTED | ACCEPTED | q1 | PASS |
| 20 | `1101011` | ACCEPTED | ACCEPTED | q1 | PASS |
| 21 | *(empty)* | REJECTED | REJECTED | q0 | PASS |
| 22 | `1021` | INVALID | INVALID | – | PASS |
| 23 | `10a1` | INVALID | INVALID | – | PASS |
| 24 | `10 1` | INVALID | INVALID | – | PASS |
| 25 | `1 1` | INVALID | INVALID | – | PASS |
| 26 | `101 ` | INVALID | INVALID | – | PASS |
| 27 | `2` | INVALID | INVALID | – | PASS |
| 28 | `abc` | INVALID | INVALID | – | PASS |
| 29 | ` ` | INVALID | INVALID | – | PASS |

Cases 1–10 are the ten named in the assignment brief. Cases 11–20 exist to show
that *ends in 1* is not *is exactly 101* and not *contains 101*. Cases 21–29
cover the empty string and validation.

---

## 7. What was actually tested

| Check | Result |
|---|---|
| Page loads and initialises | 2 states, 1 ring, 5 paths (4 transitions + start), 4 labels `0,0,1,1` |
| `1` | ACCEPTED, final q1, flow `q0 → q1` |
| `0` | REJECTED, final q0, flow `q0 → q0` |
| `101` | ACCEPTED, final q1, flow `q0 → q1 → q0 → q1` |
| `1010` | REJECTED, final q0, flow `q0 → q1 → q0 → q1 → q0` |
| `0101` | ACCEPTED, final q1, flow `q0 → q0 → q1 → q0 → q1` |
| `11111` | ACCEPTED, final q1, flow `q0 → q1 → q1 → q1 → q1 → q1` |
| `1021` | ERROR shown, no verdict, 0 execution steps |
| *(empty)* | REJECTED, final q0, 1 Start row |
| In-browser oracle | **29 of 29 passed**, 0 failures |
| Embedded Python vs `dfa.py` | **byte-for-byte identical** (8,673 bytes) |
| Extracted Python run standalone | **29 of 29 passed**, exit 0, no stderr |
| Theme toggle | dark → light → dark, colours follow |
| **Copy** button | reports "dfa.py copied to the clipboard." |
| **Download** button | writes 8,674 bytes (`source + "\n"`) |
| Static dependency scan | 0 external resources, 0 fetch, 0 modules, 0 `innerHTML` |

Two bugs were found and fixed while testing this file, both by measuring rather
than looking:

- `readTable()` reads `#trans-table thead th`, but the id had been put on the
  `<tbody>`. The table read as empty, so **no arrows were generated at all** and
  the diagram was blank.
- The clipboard fallback created a `readonly` textarea. `execCommand('copy')`
  refuses a readonly textarea in some engines, so Copy reported failure on every
  browser. Removing `readonly` fixed it; the page now also selects the source as a
  last resort.

---

## 8. Limitations

- **The JavaScript is a port, not the original.** It duplicates `dfa.py`. That is
  inherent to making one self-contained file — a browser cannot run Python. If
  you change the machine, change `dfa.py` and the `DFA` constant together, or the
  page and the embedded source will disagree.
- **`file://` behaviour was verified by static analysis, not by opening the file
  from disk.** The test harness only speaks `http`/`https`, so the page was
  exercised over `http://127.0.0.1`. Everything that differs between the two —
  `localStorage`, the Clipboard API — is wrapped in `try/catch` with a working
  fallback, and there are no network calls to fail.
- **Not tested:** Firefox, Safari, and screen readers. Chromium only.
- The execution steps panel scrolls internally when a test run is long. This is
  the one place a scrollbar appears, and it is deliberate: the panel would
  otherwise push everything below it off the page.

---

## 9. Relationship to the main project

`DECIDER_ONEFILE.html` is a **distilled, portable copy** of Decider. It is not the
PyWebView application, and it does not replace it.

| | One-file | Main project |
|---|---|---|
| Files | 1 | `app.py`, `dfa.py`, `index.html`, `script.js`, `styles.css`, `run_decider.py` |
| Host | browser, from disk | PyWebView desktop window |
| Language in charge | JavaScript (a port) | **Python**, via a bridge |
| Diagram views | one — the machine | two — the machine, and a step-by-step trace |
| Background recovery | none | `run_decider.py`: SHA-256 baseline, restore, maintenance mode |
| Transport | none | local `no-store` server |

What it keeps: the same two-state DFA, the same transition table, the same
generated figure, the same separate Execution Steps panel, the same static
transition labels, the same 29-case oracle, and the same rule that acceptance
comes from the final state.

What it drops: the trace view and its playback controls, the dead-state dump
effect, the acceptance ring, the background integrity monitor, and the themed
Display menu. Those all need either a host or more machinery than one file can
carry without becoming harder to read than the assignment it is for.

If you need the recovery system or the trace view, use the project. If you need
one file to hand in, open, or paste, use this.
