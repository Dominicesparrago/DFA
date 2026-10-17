# AL102 Midterm Project — Part A: Research & Technical Specification

**Project:** DFA Input String Acceptance Checker  
**Course:** AL102 – Automata Theory  
**Prepared for:** Handoff to Claude (visual design), then the implementation model  
**Controlling source:** *AL102 – Automata Theory Midterm Project: DFA Input String Acceptance Checker* (instructor-provided, 7-page brief)

> **Purpose of this document:** This is the actual Part A deliverable—not a prompt asking another model to write Part A. Use it as the technical source of truth for all later design and implementation work.

---

## 1. Executive summary

The application accepts or rejects an input string according to a deterministic finite automaton (DFA) that recognizes binary strings ending in `1`. The application must show how the machine moves through its states as it reads each symbol from left to right. A correct final answer without a visible transition trace is not enough for the assignment.

The instructor's brief controls the project. The DFA has exactly two states, `q0` and `q1`; its alphabet is `{0, 1}`; `q0` is the start state; and `q1` is the only accepting state. The transition table, state diagram, input validation, trace, test cases, documentation, and presentation must all agree with that definition.

**Recommended implementation direction (not an instructor-mandated language):** a small browser-based application using vanilla HTML, CSS, and JavaScript in `index.html`, `styles.css`, and `script.js`. JavaScript is explicitly among the permitted languages, and the handout encourages a graphical/web interface. A three-file implementation avoids unnecessary setup while still allowing Claude's visual design to be implemented.

## 2. Source-derived requirements

The following requirements come directly from the instructor's handout. “Required” items must not be dropped during design or implementation.

### 2.1 DFA rules — required

- Recognize binary strings that end in `1`.
- Alphabet: `Σ = {0, 1}`.
- States: `Q = {q0, q1}`—exactly these two DFA states.
- Start state: `q0`.
- Accepting state: `q1`.
- Process the input from left to right.
- Every valid input symbol must produce a transition.
- Detect invalid symbols; only `0` and `1` are permitted.
- Display the final state and `ACCEPTED` or `REJECTED`.

### 2.2 Required interface/output — required

For every valid input string, display:

1. The input string.
2. Starting state.
3. Each input symbol and transition.
4. Complete state flow.
5. Final state.
6. Acceptance result.

The transition trace should be explicit, for example: `Step 1: q0 + 1 → q1`.

### 2.3 State diagram — required

- Show `q0` and `q1`, and no extra DFA state.
- Show an incoming start arrow pointing to `q0`.
- Show `q1` as a double circle.
- Show all four transitions with the correct labels.
- Include the self-loop `q0 --0--> q0` and self-loop `q1 --1--> q1`.

### 2.4 Documentation/submission — required

- Cover page: school name, course, project title, group members, section, instructor, and date.
- Introduction.
- Problem statement.
- Objectives.
- DFA definition.
- Transition table.
- State diagram.
- Algorithm or flowchart.
- Complete source code.
- Test results with at least 10 test cases.
- Conclusion.
- Working program, source code, screenshots of output, and demonstration/presentation.

Do not invent unknown cover-page details or fabricate screenshots. Use placeholders until the student group supplies the details and captures the actual program output.

### 2.5 Grading matrix — source-derived priorities

| Criterion | Points |
|---|---:|
| DFA concept and correctness | 20 |
| Transition table and state diagram | 15 |
| Input string processing | 15 |
| Accepted/rejected logic | 10 |
| Program functionality | 15 |
| Input validation | 5 |
| UI/presentation | 5 |
| Documentation | 5 |
| Demonstration | 5 |
| Individual understanding | 5 |
| **Total** | **100** |

**Implication:** correctness, transitions, processing, and acceptance logic account for most of the score. Visual design matters, but cannot compensate for incorrect automaton behavior.

## 3. Formal DFA definition

A deterministic finite automaton can be represented by the five-tuple `M = (Q, Σ, δ, q0, F)`, where `Q` is the finite set of states, `Σ` is the input alphabet, `δ` is the transition function, `q0` is the start state, and `F` is the set of accepting states. This five-part definition and the interpretation of a transition function are described in university course materials from UC Davis, UC San Diego, and Columbia University (see References).

For this assignment:

- `Q = {q0, q1}`
- `Σ = {0, 1}`
- Start state: `q0`
- `F = {q1}`
- `δ` is defined by the transition table below.

| Current state | Input `0` | Input `1` |
|---|---|---|
| `q0` | `q0` | `q1` |
| `q1` | `q0` | `q1` |

Equivalent rules:

- `δ(q0, 0) = q0`
- `δ(q0, 1) = q1`
- `δ(q1, 0) = q0`
- `δ(q1, 1) = q1`

### Plain-language interpretation

`q0` means the most recently read symbol is `0`, or that the machine is at its initial state before any symbol has been read. `q1` means the most recently read symbol is `1`. Every time the machine reads `0`, it moves to `q0`; every time it reads `1`, it moves to `q1`, regardless of the prior state. Therefore, after a non-empty binary string has been processed, its final state records the last symbol. If the final state is `q1`, the string ends in `1` and is accepted. If the final state is `q0`, the string ends in `0` and is rejected.

**Mathematical target language:** `L = { w ∈ {0,1}* | w ends in 1 }`.

### State diagram description for handoff

Draw two nodes only: `q0` on the left and `q1` on the right. Draw a start arrow from outside the diagram into `q0`. Draw the `q1` node as a double circle. Add these directed, labeled edges:

- From `q0` to itself, label `0`.
- From `q0` to `q1`, label `1`.
- From `q1` to `q0`, label `0`.
- From `q1` to itself, label `1`.

The diagram must use arrows with clear directions and labels. A color change alone is not a substitute for the double circle or labels.

## 4. Algorithm and validation policy

### Recommended algorithm

1. Read the input exactly as entered.
2. Validate every character before running the DFA. If any character is not `0` or `1`, show an error and do not show a simulated acceptance result.
3. Set `currentState = q0` and initialize the state flow with `q0`.
4. For each symbol from left to right, look up the next state using the transition table.
5. Record the step number, prior/current state, symbol, and next state; append the next state to the flow.
6. After all symbols are processed, show the final state.
7. If the final state is `q1`, display `ACCEPTED`; otherwise, display `REJECTED`.

### Pseudocode

```text
INPUT inputString

FOR each character c in inputString
    IF c is neither '0' nor '1'
        DISPLAY "ERROR: Invalid input. The DFA only accepts the symbols 0 and 1."
        STOP without displaying ACCEPTED or REJECTED

currentState = q0
stateFlow = [q0]
DISPLAY starting state q0

FOR each symbol c in inputString from left to right
    nextState = transition[currentState][c]
    DISPLAY step number, currentState, c, nextState
    currentState = nextState
    APPEND currentState to stateFlow

DISPLAY complete stateFlow
DISPLAY final state currentState

IF currentState == q1
    DISPLAY ACCEPTED
ELSE
    DISPLAY REJECTED
```

### Input-validation decision

The instructor explicitly requires detection of symbols other than `0` and `1` and gives `1021` as an invalid-input example. Validating before simulation is a recommended implementation detail: it prevents a partially rendered trace from being mistaken for a completed valid run. Treat spaces and letters as invalid characters; do not silently strip characters to make invalid input appear valid.

### Empty input (`ε`) — assumption to disclose

The handout does not explicitly define how the interface should handle an empty input. Under the mathematical target language “strings that end in `1`,” the empty string is not accepted. If the UI allows empty input, the recommended behavior is: zero transitions, state flow `q0`, final state `q0`, result `REJECTED`. It is not an invalid-symbol error because no forbidden symbol exists. This is a documented implementation assumption, not a specific requirement stated in the handout. If the instructor later specifies that empty input must be disallowed, update the UI validation to match that instruction.

## 5. Required trace examples

### Input: `10101`

| Step | Current state | Read symbol | Next state |
|---:|---|---:|---|
| Start | — | — | `q0` |
| 1 | `q0` | `1` | `q1` |
| 2 | `q1` | `0` | `q0` |
| 3 | `q0` | `1` | `q1` |
| 4 | `q1` | `0` | `q0` |
| 5 | `q0` | `1` | `q1` |

**Complete state flow:** `q0 → q1 → q0 → q1 → q0 → q1`  
**Final state:** `q1`  
**Result:** `ACCEPTED`

### Input: `10100`

| Step | Current state | Read symbol | Next state |
|---:|---|---:|---|
| Start | — | — | `q0` |
| 1 | `q0` | `1` | `q1` |
| 2 | `q1` | `0` | `q0` |
| 3 | `q0` | `1` | `q1` |
| 4 | `q1` | `0` | `q0` |
| 5 | `q0` | `0` | `q0` |

**Complete state flow:** `q0 → q1 → q0 → q1 → q0 → q0`  
**Final state:** `q0`  
**Result:** `REJECTED`

## 6. Test matrix

These first ten binary inputs and expected outputs are copied from the instructor's assignment and must be included in the project tests.

### Required 10 valid test cases

| # | Input | Expected result | Reason |
|---:|---|---|---|
| 1 | `1` | ACCEPTED | Ends in `1` |
| 2 | `0` | REJECTED | Ends in `0` |
| 3 | `11` | ACCEPTED | Ends in `1` |
| 4 | `10` | REJECTED | Ends in `0` |
| 5 | `101` | ACCEPTED | Ends in `1` |
| 6 | `100` | REJECTED | Ends in `0` |
| 7 | `111` | ACCEPTED | Ends in `1` |
| 8 | `110` | REJECTED | Ends in `0` |
| 9 | `10101` | ACCEPTED | Ends in `1` |
| 10 | `10100` | REJECTED | Ends in `0` |

### Additional recommended tests (do not replace the required ten)

| Input | Expected behavior | Test purpose |
|---|---|---|
| `0000` | REJECTED | Multiple zeros; ends in `0` |
| `0001` | ACCEPTED | Leading zeros; ends in `1` |
| `1110` | REJECTED | Many ones but final symbol is `0` |
| `000000001` | ACCEPTED | Longer input ending in `1` |
| `1021` | Validation error; no acceptance result | Exact invalid example from assignment |
| `10a1` | Validation error; no acceptance result | Alphabetic character |
| `10 1` | Validation error; no acceptance result | Embedded space |
| empty input `ε` | REJECTED in `q0` under the stated assumption | Zero-symbol edge case |

**Test oracle:** for non-empty valid binary strings, expected acceptance is determined by whether the last character is `1`. This shortcut is appropriate for checking the test expectations, but the application should still generate the transition trace using the DFA's state transition function and decide acceptance from the computed final state.

## 7. Documentation outline for the final report

1. **Cover page** — use placeholders until provided: `[School Name]`, `AL102 – Automata Theory`, `DFA Input String Acceptance Checker`, `[Group Members]`, `[Section]`, `[Instructor]`, `[Submission Date]`.
2. **Introduction** — explain what a DFA is and what the application demonstrates, with a source for the general theory.
3. **Problem statement** — determine whether an entered binary string ends in `1` and show the processing trace.
4. **Objectives** — implement the given DFA, validate input, display the trace/final state/result, test the logic, and explain the theory.
5. **DFA definition** — state `Q`, `Σ`, `δ`, start state, accepting state, and recognized language.
6. **Transition table** — include the exact table from Section 3.
7. **State diagram** — include the complete diagram as required by Section 3.
8. **Algorithm/flowchart** — document validation, start at `q0`, process each symbol, update state, and decide acceptance.
9. **Implementation/source code** — present the actual final code files and explain the key function(s). Do not document code that was not delivered.
10. **Testing and results** — include the ten required test cases, additional validation cases, and screenshots captured from the running app.
11. **Conclusion** — describe what the group learned about states, transitions, final state, and language acceptance.
12. **References** — list the instructor's brief and any theory sources actually used.

## 8. Individual recitation preparation

Each group member should be able to answer in their own words:

- **What is the start state?** `q0`.
- **What is the accepting state?** `q1` only.
- **What is the alphabet?** `Σ = {0,1}`.
- **What does `δ(q0,1)=q1` mean?** If the machine is in `q0` and reads `1`, it transitions to `q1`.
- **Why is `101` accepted?** The trace is `q0 → q1 → q0 → q1`; the final state is `q1`, which is accepting.
- **Why is `100` rejected?** The trace is `q0 → q1 → q0 → q0`; the final state is `q0`, which is not accepting.
- **How are invalid characters handled?** Show a validation error and do not report an accepted/rejected result for the invalid input.
- **Why does this DFA recognize strings ending in `1`?** A `0` always sends the machine to `q0`, and a `1` always sends it to `q1`. After the last symbol, the state therefore reflects whether that last symbol was `0` or `1`.

Students must understand the code and be able to trace a new string manually. Do not rely on memorized sample outputs alone.

## 9. References

### Primary assignment source

AL102 – Automata Theory. (n.d.). *Midterm project: DFA input string acceptance checker* [Course project handout supplied for the assignment]. Instructor-provided document. The source specifies the project rules, examples, deliverables, and grading matrix.

### Academic theory sources consulted

Doty, D. (n.d.). *Deterministic finite automata (DFAs): Introduction*. ECS 120: Theory of Computation, University of California, Davis. https://web.cs.ucdavis.edu/~doty/ecs120slides/01c_DFAComputation-deck.html

Columbia University, Department of Computer Science. (n.d.). *Lecture 2: Finite automata and regular languages*. COMS W3261 CS Theory. https://www.cs.columbia.edu/~aho/cs3261/Lectures/L2-Finite_Automata.html

University of California, San Diego, CSE 105. (2015). *Deterministic finite automata (DFA)* [Course notes]. https://cseweb.ucsd.edu/classes/fa15/cse105-a/dfa.html

The university materials above support the general explanation of the DFA five-tuple, the transition function, reading an input one symbol at a time, and determining acceptance from the final state. The specific two-state machine, project test cases, output requirements, and grading points come from the instructor's handout—not from those external examples. Accessed October 10, 2026.

---

## 10. LOCKED SPECIFICATION — paste unchanged into later model prompts

```text
PROJECT: AL102 – DFA Input String Acceptance Checker
PURPOSE: Accept binary strings that end in 1 and reject valid binary strings that end in 0.

FORMAL DFA
- Q = {q0, q1}; exactly two DFA states are allowed.
- Σ = {0, 1}.
- Start state = q0.
- Accepting states F = {q1}.
- δ(q0, 0) = q0.
- δ(q0, 1) = q1.
- δ(q1, 0) = q0.
- δ(q1, 1) = q1.

INPUT PROCESSING
- Process valid input from left to right, one symbol per step.
- Only 0 and 1 are valid input symbols.
- If any invalid character occurs, display an error and do not display a completed ACCEPTED/REJECTED result.
- Recommended implementation behavior: validate the entire string before starting the simulation.
- For a valid input, show the input, starting state, each current-state/symbol/next-state transition, complete state flow, final state, and ACCEPTED/REJECTED result.
- Acceptance must be determined from the computed final state: accept iff final state is q1.
- Empty-string behavior is not specified in the course handout. Unless the instructor says otherwise, allow ε as zero transitions in q0 and report REJECTED; do not describe it as an invalid-symbol error.

STATE DIAGRAM
- Show q0 and q1 only.
- Incoming start arrow to q0.
- q1 drawn as a double circle.
- q0 --0--> q0.
- q0 --1--> q1.
- q1 --0--> q0.
- q1 --1--> q1.

REQUIRED TEST CASES
1 -> ACCEPTED
0 -> REJECTED
11 -> ACCEPTED
10 -> REJECTED
101 -> ACCEPTED
100 -> REJECTED
111 -> ACCEPTED
110 -> REJECTED
10101 -> ACCEPTED
10100 -> REJECTED
Also demonstrate invalid input 1021 with a clear validation error.

DOCUMENTATION/DELIVERABLES
Cover page; introduction; problem statement; objectives; DFA definition; transition table; state diagram; algorithm/flowchart; complete final source code; at least ten test cases and results; conclusion; working program; screenshots captured from the actual application; and presentation/demo notes.

IMPLEMENTATION RECOMMENDATION (NOT MANDATORY IN THE HANDOUT)
Use vanilla HTML, CSS, and JavaScript, with index.html, styles.css, and script.js. Avoid unrelated frameworks, backends, databases, authentication, or features that do not support the assignment.

PRIORITY RULE
The instructor's assignment and this locked specification control correctness. Visual design may improve presentation but must never change the DFA rules or omit required output.
```
