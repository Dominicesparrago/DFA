// AL102 DFA Input String Acceptance Checker - interface layer (revision 27).
//
// This file renders what dfa.py returns. It contains no DFA logic: there is no
// transition table here, no validation, and no simulation. Every state name,
// transition and acceptance decision arrives over the Python bridge.

'use strict';

const WALK_BUDGET_MS = 900;
const WALK_STEP_MS = 150;
// Past this many symbols the walk is too fast to read, so the figure is drawn
// at once: the tape and the labels show the whole run, and the figure shows the
// final edge.
const WALK_MAX_STEPS = 12;
// A gap wider than this between the end of one arrow and the start of the next
// means the token would fly across the plate rather than travel an arrow, so it
// hops instead: fade out, set down, fade in.
const BRIDGE_MAX = 140;

const INVALID_HEAD = 'ERROR: Invalid input. The DFA only accepts the symbols 0 and 1.';
const EXAMPLE_VALUES = ['1', '0', '101', '1021'];

const el = {
  input: document.getElementById('dfa-input'),
  checkBtn: document.getElementById('check-btn'),
  clearBtn: document.getElementById('clear-btn'),
  examples: [
    document.getElementById('example-1'),
    document.getElementById('example-2'),
    document.getElementById('example-3'),
    document.getElementById('example-4'),
  ],
  error: document.getElementById('error'),
  errorHead: document.getElementById('error-head'),
  errorDetails: document.getElementById('error-details'),
  errorAction: document.getElementById('error-action'),
  result: document.getElementById('result'),
  tape: document.getElementById('tape'),
  flow: document.getElementById('flow'),
  stepsBody: document.getElementById('steps-body'),
  svg: document.getElementById('dfa-svg'),
  walkToken: document.getElementById('walk-token'),
  testsBtn: document.getElementById('tests-btn'),
  testsSummary: document.getElementById('tests-summary'),
  testsBody: document.getElementById('tests-body'),
  themeSelect: document.getElementById('theme-select'),
  fab: document.getElementById('fab'),
  fabBtn: document.getElementById('fab-btn'),
  fabMenu: document.getElementById('fab-menu'),
  timingSelect: document.getElementById('timing-select'),
};

// The figure is discovered from the markup so the number of states and edges
// is never hard-coded here. Edge ids follow edge-<from>-<to>-<symbol>.
// The state nodes are re-read on demand because the diagram switch rebuilds them.
function stateNodes() {
  return Array.from(el.svg.querySelectorAll('.node'));
}
const TABLE_ROWS = Array.from(document.querySelectorAll('#transition-table tbody tr'));

let walkTimers = [];
let tokenFrame = 0;
// Every Web Animation started by this file is held here, so one call can cancel
// the lot when a run is superseded.
let liveAnimations = new Set();
let tokenPos = null;       // where the walk token last was, in SVG units
let markedCell = null;
// Flow timing from the Display menu. 1 is the default pace; 2 is twice as fast;
// 0.2 is five times slower. It scales the step interval and nothing else. It is
// read when a walk starts, so a change applies to the next check.
let flowSpeed = 1;

// Request generation. Every check gets a number. Clear and typing move the
// number on, so a reply that arrives late is recognised and dropped instead of
// overwriting what the user is looking at now.
let latest = 0;
let busy = false;
let ready = false;

// ---------------------------------------------------------------------------
// Small DOM helpers. All text is written with textContent, so input containing
// markup cannot reach the page as markup.
// ---------------------------------------------------------------------------

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const span = make('span', 'icon', name);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function hidden(text) {
  return make('span', 'vh', text);
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------------

// Which state the machine is in is shown by the token, the arrow it is standing
// on, the trace and the highlighted row of the transition table. The circles are
// not painted a second time on top of that: a highlight on the states ran its own
// animation beside the circle arrival and nothing marked the positions past the
// third, so one run read as two different runs and the timing doubled up. One
// arrival animation, one timing, wherever a circle joins the plate.
function setCurrentState(state) {
  for (const row of TABLE_ROWS) {
    row.classList.toggle('is-active', Boolean(state) && row.id === `trow-${state}`);
  }
}

// Every animation this file starts goes through runAnimation. Starting a new one
// on an element cancels whatever was already on it: an animation with
// fill:'backwards' holds its FIRST keyframe for the whole of its delay, so a
// stale one can keep an element at opacity 0 long after a newer run asked for it.
// That is what left a replayed check sitting dark. The finished promise is
// always settled, so a cancelled animation cannot surface as an unhandled
// rejection.
function runAnimation(node, keyframes, options) {
  if (!node) return null;
  for (const old of node.getAnimations()) old.cancel();
  const anim = node.animate(keyframes, options);
  liveAnimations.add(anim);
  anim.finished.then(
    function () { liveAnimations.delete(anim); },
    function () { liveAnimations.delete(anim); }
  );
  return anim;
}

function cancelAnimations() {
  for (const anim of liveAnimations) {
    try { anim.cancel(); } catch (error) { /* already gone */ }
  }
  liveAnimations.clear();
}

// Every transition has its own arrow, including one self-loop per symbol where a
// state loops on both (edge-q1-q1-0 and edge-q1-q1-1), so the fallback below is
// only for ids that name a shape rather than a single transition.
function edgeElement(edgeId) {
  return document.getElementById(edgeId) ||
         document.getElementById(edgeId.replace(/-\d+$/, ''));
}

// Highlight the arrow the machine just took.
//
// This is the WALK's arrow, in the machine diagram. The trace view runs its own
// arrow system and owns its own state, so this must not reach into it: the walk
// settles after the trace does, and clearing the trace's highlight here used to
// wipe it at exactly the moment the reader was looking at it.
function setTakenEdge(edgeId) {
  for (const edge of el.svg.querySelectorAll('.edge--taken')) {
    if (edge.classList.contains('edge--step')) continue;
    edge.classList.remove('edge--taken');
  }
  if (!edgeId) return;
  const target = edgeElement(edgeId);
  if (target) target.classList.add('edge--taken');
}

// This is a lookup of markup ids, not a copy of the transition function.
function edgeIdFor(step) {
  return `edge-${step.from}-${step.to}-${step.symbol}`;
}

function figureIdle() {
  el.svg.classList.add('is-dim');
  setCurrentState(null);
  setTakenEdge(null);
}

function figureActive() {
  el.svg.classList.remove('is-dim');
}

// ---------------------------------------------------------------------------
// Tape
// ---------------------------------------------------------------------------

// Index numerals appear at position 1 and at every fifth position after it.
function showsIndex(position) {
  return position === 1 || position % 5 === 0;
}

function symbolName(symbol) {
  return symbol === ' ' ? 'space' : `“${symbol}”`;
}

function renderTape(input) {
  clearMark();
  clear(el.tape);

  if (input.length === 0) {
    el.tape.setAttribute('aria-label', 'Input tape, no symbols');
    const cell = make('li', 'cell');
    cell.append(make('span', 'sym', 'ε'), make('span', 'idx', ''), hidden('empty string'));
    el.tape.append(cell);
    return;
  }

  el.tape.setAttribute('aria-label', `Input tape, ${input.length} symbols`);

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < input.length; i++) {
    const position = i + 1;
    const symbol = input[i];

    const cell = make('li', 'cell');
    cell.append(make('span', 'sym', symbol));

    const index = make('span', 'idx', showsIndex(position) ? String(position) : '');
    index.setAttribute('aria-hidden', 'true');
    cell.append(index);

    cell.append(hidden(`symbol ${position} of ${input.length}: ${symbol}`));
    fragment.append(cell);
  }
  el.tape.append(fragment);
}

// The empty tape is different again from the tape for an empty input, which
// shows the symbol for no symbols. Invalid input is never drawn here.
function clearTape() {
  clearMark();
  clear(el.tape);
  el.tape.setAttribute('aria-label', 'Input tape, empty');
}

function markCell(index) {
  if (markedCell) markedCell.classList.remove('is-reading');
  const cell = el.tape.children[index];
  if (cell) cell.classList.add('is-reading');
  markedCell = cell || null;
}

function clearMark() {
  if (markedCell) markedCell.classList.remove('is-reading');
  markedCell = null;
}

// ---------------------------------------------------------------------------
// State flow
// ---------------------------------------------------------------------------

// The state flow is the list of states the machine visited, read from the flow
// Python returned. The arrows are the transitions between them.
function renderFlow(flow) {
  clear(el.flow);
  const fragment = document.createDocumentFragment();

  // The complete state flow, which is one of the outputs the assignment asks
  // for: the state before each symbol and the state after it. flow comes from
  // dfa.py, so nothing is decided here. With only two states this reads exactly
  // like the flow the brief prints, rather than a row of invented numbers.
  flow.forEach(function (state, i) {
    const label = state;
    const isFinal = i === flow.length - 1;
    const item = make('li', isFinal ? 'final' : '');

    if (isFinal) {
      item.append(hidden('final position '), make('span', null, label));
    } else {
      const arrow = make('span', 'arrow', ' \u2192 ');
      arrow.setAttribute('aria-hidden', 'true');
      item.append(make('span', null, label), arrow);
    }
    fragment.append(item);
  });

  el.flow.append(fragment);
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

// Container B: the generated execution steps, built only from the steps Python
// returned. There is no second simulation in this file. Every row exists as soon
// as a string is checked and starts hidden; the walk reveals them one at a time
// and leaves the finished ones on screen to be read back.
function renderSteps(steps, startState) {
  clear(el.stepsBody);
  const fragment = document.createDocumentFragment();

  const head = document.createElement('tr');
  head.className = 'step step--start';
  head.append(make('td', null, 'Start'), make('td', null, '-'),
              make('td', null, '-'), make('td', null, startState));
  fragment.append(head);

  steps.forEach((step, i) => {
    const row = document.createElement('tr');
    row.className = 'step step--pending';
    row.dataset.index = String(i);

    row.append(make('td', null, String(step.step)));
    row.append(make('td', 'step-symbol', step.symbol));

    const transition = make('td');
    const visual = make('span', null, step.from + ' \u2192 ' + step.to);
    visual.setAttribute('aria-hidden', 'true');
    transition.append(visual,
      hidden('Step ' + step.step + ': from ' + step.from + ', reading ' + step.symbol + ', go to ' + step.to + '.'));
    if (i === steps.length - 1) transition.append(make('span', 'tag', 'Final'));
    row.append(transition);
    row.append(make('td', 'step-state', step.to));
    fragment.append(row);
  });

  el.stepsBody.append(fragment);
}

// One shared entry animation for a step row: the same POP_MS, the same easing
// and the same runAnimation the figure's own arrivals use. Nothing in this file
// keeps a second timing model for the same kind of reveal.
function stepIn(row, at) {
  if (prefersReducedMotion()) return;
  runAnimation(row, [
    { opacity: 0, transform: 'translateY(7px)' },
    { opacity: 1, transform: 'none' },
  ], { duration: ms(POP_MS), delay: ms(at), easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' });
}

// Reveal the run so far and mark the step being processed. Revealed rows stay
// revealed, so the whole sequence can be read back once the walk has finished.
function showSteps(steps, upTo, finished) {
  const rows = el.stepsBody.querySelectorAll('.step[data-index]');
  rows.forEach((row, i) => {
    const reached = i < upTo;
    if (reached && row.classList.contains('step--pending')) {
      row.classList.remove('step--pending');
      stepIn(row, 0);
    }
    // Once the walk has finished there is no step in progress any more, so the
    // last row must settle to done too. Without `finished` the final row keeps
    // the in-progress highlight for ever and the run never looks complete.
    const isCurrent = reached && !finished && i === upTo - 1;
    row.classList.toggle('step--current', isCurrent);
    row.classList.toggle('step--done', reached && !isCurrent);
  });
}

function resetSteps() {
  for (const row of el.stepsBody.querySelectorAll('.step[data-index]')) {
    row.classList.remove('step--current', 'step--done');
    row.classList.add('step--pending');
    row.style.opacity = '';
  }
}

// ---------------------------------------------------------------------------
// Result block
// ---------------------------------------------------------------------------

function renderIdleResult() {
  el.result.className = 'result result--idle';
  clear(el.result);
  el.result.append(make('p', 'reason', 'Enter a string and check it.'));
}

function renderInvalidResult() {
  el.result.className = 'result result--idle';
  clear(el.result);
  el.result.append(make('p', 'verdict', 'No result.'));
  el.result.append(make('p', 'reason', 'Fix the input to see the transitions.'));
}

function renderResult(sim) {
  el.result.className = sim.accepted ? 'result' : 'result is-rejected';
  clear(el.result);

  const verdict = make('p', 'verdict');
  verdict.append(icon(sim.accepted ? '✓' : '✕'),
                 make('span', null, sim.accepted ? 'ACCEPTED' : 'REJECTED'));
  el.result.append(verdict);

  const facts = make('dl', 'facts');
  const rows = [
    ['Input', sim.input.length === 0 ? 'ε (empty string)' : sim.input],
    ['Start state', sim.start],
    ['Final state', sim.final],
  ];
  for (const [term, value] of rows) {
    facts.append(make('dt', null, term), make('dd', null, value));
  }
  el.result.append(facts);

  el.result.append(make('p', 'reason', reasonFor(sim)));
}

// Plain-language account of why the machine ended where it did. Every fact
// here comes from the trace Python returned.
function reasonFor(sim) {
  const rule = sim.description || '';
  const count = sim.steps.length;

  if (count === 0) {
    return `No symbols were read, so the machine is still in ${sim.final}, which is not the accepting state. ${rule}`;
  }

  const last = sim.steps[count - 1];
  if (sim.accepted) {
    return `The machine read all ${count} symbols and finished in ${sim.final}, because the last symbol read was ${last.symbol} and that leaves it in the accepting state. ${rule}`;
  }
  return `The machine read all ${count} symbols and finished in ${sim.final}, because the last symbol read was ${last.symbol} and that leaves it outside the accepting state. ${rule}`;
}


// ---------------------------------------------------------------------------

function clearError() {
  clear(el.errorDetails);
  el.error.hidden = true;
  el.input.setAttribute('aria-invalid', 'false');
  el.input.setAttribute('aria-describedby', 'dfa-help');
}

function renderError(head, lines) {
  clear(el.errorDetails);
  el.errorHead.textContent = head;
  el.errorAction.textContent = head === INVALID_HEAD
    ? 'Remove the highlighted symbol and check again.'
    : 'The input has not been checked.';
  for (const line of lines) el.errorDetails.append(make('p', null, line));
  el.error.hidden = false;
  el.input.setAttribute('aria-invalid', 'true');
  el.input.setAttribute('aria-describedby', 'dfa-help error');
}

function invalidLines(errors) {
  return errors.map((item) => `Found ${symbolName(item.symbol)} at position ${item.index}.`);
}

// ---------------------------------------------------------------------------
// Tape walk: the single motion moment. Visual only; the result, flow and trace
// are already rendered when the walk starts and are never hidden by it.
// ---------------------------------------------------------------------------

// Smoothstep: soft at both ends, peak speed 1.5 times the average, so the
// token settles at each state and never leaves in a burst.
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function hideToken() {
  el.walkToken.classList.remove('is-moving');
}

// The token is positioned with a transform (its cx and cy stay at 0).
function placeToken(point) {
  el.walkToken.style.transform = `translate(${point.x}px, ${point.y}px)`;
  tokenPos = point;
}

function stopWalkTimers() {
  for (const timer of walkTimers) clearTimeout(timer);
  walkTimers = [];
  cancelAnimationFrame(tokenFrame);
  tokenFrame = 0;
}

function cancelWalk() {
  stopWalkTimers();
  cancelAnimations();
  tokenPos = null;
  hideToken();
}

// The token rests where the machine ended, so figure, trace and verdict agree.
function parkToken(edgeId) {
  const path = edgeElement(edgeId);
  if (!path) return;
  placeToken(path.getPointAtLength(path.getTotalLength()));
  el.walkToken.classList.add('is-moving');
}

// Every step travels one arrow of the machine itself, whichever shape it is.
function moveToken(edgeId, duration) {
  if (prefersReducedMotion()) return;
  const path = edgeElement(edgeId);
  if (!path) return;

  const start = path.getPointAtLength(0);
  const from = tokenPos || start;
  const bridge = Math.hypot(start.x - from.x, start.y - from.y);

  if (bridge > BRIDGE_MAX) {
    el.walkToken.classList.add('is-hop');
    walkTimers.push(setTimeout(function () {
      placeToken(start);
      el.walkToken.classList.remove('is-hop');
      moveAlong(path, start, 0, duration);
    }, 130));
    return;
  }
  moveAlong(path, from, bridge, duration);
}

function moveAlong(path, from, bridge, duration) {
  const start = path.getPointAtLength(0);
  const total = bridge + path.getTotalLength();
  const startedAt = performance.now();

  cancelAnimationFrame(tokenFrame);
  if (!tokenPos) placeToken(start);
  el.walkToken.classList.add('is-moving');

  function frame(now) {
    const t = Math.min(1, (now - startedAt) / duration);
    const s = smoothstep(t) * total;
    let point;
    if (bridge > 0 && s <= bridge) {
      const k = s / bridge;
      point = { x: from.x + (start.x - from.x) * k, y: from.y + (start.y - from.y) * k };
    } else {
      point = path.getPointAtLength(Math.max(0, s - bridge));
    }
    placeToken(point);
    tokenFrame = t < 1 ? requestAnimationFrame(frame) : 0;
  }
  tokenFrame = requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Walk. Visual only: the result, flow and trace are already rendered
// when the walk starts and are never hidden by it.
// ---------------------------------------------------------------------------

// The base pace fits the walk into the budget and never exceeds the step time.
// The flow timing divides that pace: 2 halves each step, 0.2 makes each step five
// times longer. The result is never below 1 ms.
function stepInterval(count) {
  const base = Math.max(1, Math.min(WALK_STEP_MS, Math.floor(WALK_BUDGET_MS / Math.max(count, 1))));
  return Math.max(1, Math.round(base / flowSpeed));
}

// Transition labels are static: each arrow always carries the input symbol that
// causes it, and it carries it from the moment the figure is built. Nothing in a
// run rewrites a label, so there is nothing to clear here - only the Execution
// Steps rows need resetting between runs.
function clearLabels() {
  resetSteps();
}

// One timing and one geometry model for the whole figure. The step interval is
// the only clock: it paces the token, the highlight and the Execution Steps rows
// together, so no part of a run can drift ahead of another.
//
// The row height, the spacing and the radii are not constants here. They are read
// from the markup (WALK_SPACING still sets the gap between states), so moving a
// circle or changing the accepting ring cannot leave the arrows describing
// something the machine does not draw.
const NODE_RADIUS = 34;                           // a generated state circle
const RING_GAP = 8;                               // gap between a core and its accepting ring
const NODE_LABEL_DROP = 8;                        // how far a state name sits below centre
const WALK_SPACING = 130;                        // distance between states on a row
const WALK_VIEW_WIDTH = 420;                     // narrowest the plate ever is
const WALK_VIEW_HEIGHT = 250;                    // margin, loops, row, back-arrow, margin
const WALK_VIEW_HEIGHT_LONG = 430;               // the same, plus a lower row
const ROW_TOP = 120;                             // y of the top row of states
const ROW_BOTTOM = 300;                          // y of a lower row (the longer diagram's qd)
let plateView = { width: WALK_VIEW_WIDTH, height: WALK_VIEW_HEIGHT };
const LOOP_CLEAR = 5;                            // gap between a circle and its loop
const LOOP_SPAN = 60 * Math.PI / 180;            // half-angle of a self-loop, from the top
const LOOP_RISE = 44;                            // how far a self-loop stands above the centre
const LOOP_REACH = 1.25;                         // loop width as a multiple of its half-width
const BACK_ANGLE = 125 * Math.PI / 180;           // where the back-arrow leaves each circle
const BACK_DIP = 60;                              // control depth of the back-arrow

function svgEl(tag, attrs, className) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const name of Object.keys(attrs)) node.setAttribute(name, String(attrs[name]));
  if (className) node.setAttribute('class', className);
  return node;
}

// Centre and radius of a state's circle, read from the markup.
function nodeCircle(id) {
  const node = document.getElementById(id);
  const c = node.querySelector('circle.core');
  const ring = node.querySelector('circle.ring');
  const r = Number(c.getAttribute('r'));
  return {
    x: Number(c.getAttribute('cx')),
    y: Number(c.getAttribute('cy')),
    r: r,
    outer: ring ? Number(ring.getAttribute('r')) : r,
  };
}


// Two decimals are enough for the path text.
function round2(v) {
  return Math.round(v * 100) / 100;
}

// The machine's last state, read from the generated arrows rather than
// hard-coded, so the figure always ends at the right circle.
function lastStateName() {
  let last = null;
  EDGE_RULES.forEach(function (rule) {
    if (rule.from !== rule.to) last = rule.to;
  });
  return last || 'q0';
}


// The plate used to scroll sideways and follow the walk. It no longer scrolls:
// the machine is two states and always fits, so both helpers below have nothing
// to do. They are kept as no-ops rather than removed because the call sites read
// better as "make sure this is in view", and that stays true if the plate ever
// grows a third state and gets a scroll region again.
function showFigureStart() {}

function keepActiveInView() {}


// The figure is as wide as the row needs. The drawing keeps the scale it has at
// rest; the width is the stylesheet's clamped width times the extra width.
// Put a circle group at x,y, whatever it was drawn at. Every circle in the group
// moves, because each one carries its own cx/cy, and the name moves with them.
function moveNode(node, x, y) {
  for (const circle of node.querySelectorAll('circle')) {
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
  }
  node.style.transformOrigin = round2(Number(x)) + 'px ' + round2(Number(y)) + 'px';
  const label = node.querySelector('text.node-label');
  if (label) {
    label.setAttribute('x', x);
    label.setAttribute('y', Number(y) + NODE_LABEL_DROP);
  }
  // The trace label sits outside the circle so the step number inside it and the
  // state underneath never overlap. A node can ask for it above instead, or to one
  // side - the dead state's caption goes beside qd, because the dead-state arrows
  // all converge on the top of it and a caption there sits in the middle of them.
  const trace = node.querySelector('text.node-trace');
  if (trace) {
    const side = node.dataset.smallSide;
    if (side === 'left') {
      trace.setAttribute('x', x - NODE_RADIUS - 16);
      trace.setAttribute('y', Number(y) + 5);
      trace.setAttribute('text-anchor', 'end');
    } else if (node.dataset.smallAbove === 'true') {
      trace.setAttribute('x', x);
      trace.setAttribute('y', Number(y) - (NODE_RADIUS + 14));
    } else {
      trace.setAttribute('x', x);
      trace.setAttribute('y', Number(y) + NODE_RADIUS + 22);
    }
  }
}


// The line that marks q0 as the start. It is a fixed short lead-in rather than a
// run from the left margin, so it stays beside q0 wherever the run puts q0.
function drawStartArrow() {
  const path = document.getElementById('edge-start');
  const label = document.getElementById('label-edge-start');
  if (!path) return;
  // The start arrow enters the first state, whichever view is on screen: q0 in
  // the machine diagram, step 0 in a trace.
  const first = diagramSpec().nodes.filter((n) => !n.below)[0];
  if (!first) return;
  const start = nodeCircle('node-' + first.key);
  const from = start.x - start.outer - START_LEAD;
  path.setAttribute('d', `M${round2(from)},${round2(start.y)} L${round2(start.x - start.outer)},${round2(start.y)}`);
  if (label) {
    label.setAttribute('x', round2(from + START_LEAD / 2));
    label.setAttribute('y', round2(start.y - 10));
  }
}

// Numeric order, so q10 sorts after q9 and not between q1 and q2.
function stateOrder(id) {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

// Everything on the plate is laid out as centred runs: the states the active
// machine puts on the top row, and any the machine puts on a lower row (the
// longer diagram's qd). States are ordered by numeric suffix so q10 sorts after
// q9, and the dead state, which has no number, sorts to the end.
//
// The viewBox is sized to the run, so the drawing is the same size on screen
// however many states there are: adding states widens the drawing, it does not
// shrink the circles or their labels. A longer diagram is wider than the plate,
// and the plate scrolls sideways for it.
function layoutFigure() {
  const below = new Set(diagramSpec().nodes.filter((n) => n.below).map((n) => n.key));
  const all = stateNodes().filter((node) => node.style.opacity !== '0');
  const topRow = all.filter((node) => !below.has(node.id.replace(/^node-/, '')))
    .sort((a, b) => stateOrder(a.id) - stateOrder(b.id));
  const bottomRow = all.filter((node) => below.has(node.id.replace(/^node-/, '')))
    .sort((a, b) => stateOrder(a.id) - stateOrder(b.id));

  const columns = Math.max(topRow.length, bottomRow.length, 1);
  const span = (columns - 1) * WALK_SPACING;
  // The plate is sized from the run first, then the run is centred inside it. The
  // order matters: centring against the old width is what put the whole chain at
  // negative x before.
  const width = Math.max(WALK_VIEW_WIDTH, span + 2 * 90);
  const height = bottomRow.length ? WALK_VIEW_HEIGHT_LONG : WALK_VIEW_HEIGHT;
  // Centre the run together with the start arrow, which reaches START_LEAD to the
  // left of q0 and has nothing to match on the right. Without it the row sits left.
  const originX = (width - span + START_LEAD) / 2;

  topRow.forEach((node, i) => moveNode(node, originX + i * WALK_SPACING, ROW_TOP));
  bottomRow.forEach((node, i) => {
    // A lower row holds one state, and it goes to the bottom centre of the plate.
    const x = bottomRow.length === 1
      ? width / 2
      : originX + (i - (bottomRow.length - 1) / 2) * WALK_SPACING;
    moveNode(node, x, ROW_BOTTOM);
  });

  // The viewBox grows with the run, so the drawing is drawn at the same scale
  // however many states there are: a longer chain is a wider drawing, not smaller
  // circles. With a lower row the plate also gets taller, to hold it.
  plateView = { width: width, height: height };
  el.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  // The trace view is drawn one viewBox unit to one pixel, so a long run is wider
  // than the plate and the plate scrolls. Letting the stylesheet scale it down to
  // fit would shrink the step numbers and the state labels below them.
  el.svg.style.width = diagramMode === 'longer' ? width + 'px' : '';
  drawStartArrow();
  EDGE_RULES.forEach((rule, id) => drawEdge(id));
}

function runWalk(steps, onDone) {
  cancelWalk();
  const count = steps.length;
  const animate = count > 0 && count <= WALK_MAX_STEPS && !prefersReducedMotion();
  const interval = stepInterval(count);
  // The token follows the arrows of the machine dfa.py actually simulated. When a
  // different machine is on screen there is nothing correct for it to follow: the
  // longer diagram recognises the same language with different arrows, so a step
  // like q1 --0--> q0 has no path to ride. Rather than flicker on half the steps,
  // the token stays put and the Execution Steps rows carry the progress alone.
  const track = steps.every((step) => EDGE_RULES.has(edgeIdFor(step)));

  function settle() {
    stopWalkTimers();
    showSteps(steps, count, true);
    if (count === 0) {
      setTakenEdge(null);
      if (el.tape.children.length === 1) markCell(0);
    } else {
      const last = steps[count - 1];
      setCurrentState(last.to);
      if (track) {
        setTakenEdge(edgeIdFor(last));
        if (!tokenPos) parkToken(edgeIdFor(last));
      }
      markCell(count - 1);
    }
    onDone();
  }

  if (!animate) { settle(); return cancelWalk; }

  let next = 0;
  function tick() {
    if (next >= count) { settle(); return; }
    const step = steps[next];
    markCell(next);
    setCurrentState(step.from);
    showSteps(steps, next + 1);
    if (track) {
      setTakenEdge(edgeIdFor(step));
      moveToken(edgeIdFor(step), interval * 0.9);
    }
    walkTimers.push(setTimeout(function () {
      setCurrentState(step.to);
      if (track) keepActiveInView(step.to);
    }, Math.round(interval * 0.8)));
    next += 1;
    walkTimers.push(setTimeout(tick, interval));
  }
  tick();

  return cancelWalk;
}

// ---------------------------------------------------------------------------
// The diagram switch: the DFA itself, or a trace of a run through it
// ---------------------------------------------------------------------------
//
// There is ONE machine in this project, and it never changes: the two-state DFA
// in dfa.py that accepts every binary string ending in 1. Table 1 and the
// Definition list always describe that machine.
//
// What the switch changes is what the figure DRAWS:
//
//   Simple  the machine's own definition. Two states, four arrows, each arrow
//           carrying the input symbol that causes it. This is the diagram the
//           assignment asks for.
//
//   Longer  a trace of the run the user just did through that same machine. The
//           nodes are STEPS, not states: the large label counts the step, and the
//           small label underneath is the state the machine was actually in. This
//           is the professor's convention - "node = step number, small label =
//           DFA state" - and it is why the two are kept as two separate labels on
//           the same node. The chain grows with the input.
//
// Neither mode is used to decide anything. The verdict, the tape, the state flow
// and the Execution Steps all come from dfa.py; this only draws.
//
// ON THE DEAD STATE.
//
// The reference drawing shows qd with a self-loop on 0, 1. Taken as this
// machine's transition function that would be wrong: this machine has no dead
// state, because both symbols are defined in both states and no input can get
// stuck. A trap here would reject good strings - q1 --0--> qd would reject "10",
// which is correct only by accident and would reject nothing else usefully.
//
// So qd is drawn the way the reference draws it - centred below the sequence,
// with its 0, 1 self-loop, labelled "dead state" - and it is drawn as a
// REFERENCE for what a dead state looks like, with no arrow entering it. Nothing
// in a run ever reaches it, because this machine cannot get stuck. The caption
// says so, so the diagram cannot be misread as a trap machine.

// The one machine. Table 1 and the Definition list are written from this and are
// never changed by the switch.
const UNDERLYING = {
  rows: [
    { state: 'q0', inputs: { 0: 'q0', 1: 'q1' } },
    { state: 'q1', inputs: { 0: 'q0', 1: 'q1' } },
  ],
  start: 'q0',
  accepting: ['q1'],
  dead: null,
  language: 'w ends in 1',
};

// The run the figure is tracing, always Python's. flow[i] is the state the
// machine was in after reading i symbols, so flow has one more entry than the
// input has symbols.
let traceInput = '';
let traceFlow = ['q0'];
let traceStatus = 'idle';                      // 'idle' | 'invalid' | 'ok'
let diagramMode = 'simple';

// ---------------------------------------------------------------------------
// Rendering the selected view
// ---------------------------------------------------------------------------

// Build one <g class="node">.
//
// `big` is the label inside the circle. `small` is the optional second label
// underneath it, which the longer view uses to name the state the machine was
// really in. Having both on the same node is the whole point of the professor's
// convention: the large label is a step counter and must never be mistaken for a
// state, and the small label is what actually decides acceptance.
function makeNode(key, big, small, ring) {
  const node = svgEl('g', { id: 'node-' + key, class: 'node' }, null);
  node.append(svgEl('circle', { class: 'pulse', cx: 0, cy: 0, r: NODE_RADIUS, 'aria-hidden': 'true' }));
  if (ring) node.append(svgEl('circle', { class: 'ring', cx: 0, cy: 0, r: NODE_RADIUS + RING_GAP }));
  node.append(svgEl('circle', { class: 'core', cx: 0, cy: 0, r: NODE_RADIUS }));
  const label = svgEl('text', { id: 'node-text-' + key, class: 'node-label', x: 0, y: 0, 'text-anchor': 'middle' });
  label.textContent = big;
  node.append(label);
  if (small !== null && small !== undefined) {
    const state = svgEl('text', { id: 'node-state-' + key, class: 'node-trace', x: 0, y: 0, 'text-anchor': 'middle' });
    state.textContent = small;
    node.append(state);
  }
  return node;
}

// What the figure should contain right now.
//
// simple: the two states of the machine, plus every transition in Table 1.
// longer: one node per step of the run, each labelled with the step number and
//         the state it was in, joined by straight arrows carrying the symbol that
//         was read, plus qd below with its self-loop.
function diagramSpec() {
  if (diagramMode === 'longer') return traceSpec();
  return {
    nodes: UNDERLYING.rows.map((row) => ({
      key: row.state, big: row.state, small: null, accepting: UNDERLYING.accepting.indexOf(row.state) !== -1,
    })),
    edges: [],
    trace: false,
  };
}

// ---------------------------------------------------------------------------
// The longer view: a trace, its dead-state reference arrows, and its animation
// ---------------------------------------------------------------------------

// The run the trace shows, as two parallel lists: traceInput[i] is the symbol read
// to get from step i to step i+1, and traceFlow[i] is the state the machine was
// really in at step i. traceFlow always comes from dfa.py, never from here.
// ---------------------------------------------------------------------------
// The longer view: a trace, its dump paths, and its playback
// ---------------------------------------------------------------------------
//
// WHAT THIS DRAWS, AND WHAT IT DOES NOT.
//
// The chain is a TRACE of a run through the two-state DFA in dfa.py. The large
// label on each node is the step number; the small label underneath is the state
// the machine was really in. Nothing here decides anything: every state label and
// every verdict comes from dfa.py, and the dump paths are purely a way of drawing
// time passing.
//
// Two things flow into qd, and neither is a transition of the machine:
//
//   * the DUMP PATH of a step that has gone by, which bends down into qd as the
//     animation moves on. It is history being tidied away, not a state change.
//   * the FINAL DUMP, when the run ends in q0. That one is the rejection: the last
//     step really did finish outside the accepting state, and it is the only flow
//     that means anything about the answer.
//
// A run that ends in q1 gets NO flow into qd at all, and in particular the final
// node is never given a dump path. qd is drawn plainly, with no self-loop and no
// returning arrow: it is the place old steps go, and a machine that cannot get
// stuck does not send anything back out of it.

// The run the trace shows: traceInput[i] is the symbol read to get from step i to
// i+1, and traceFlow[i] is the state the machine was really in at step i.
function traceFinalState() {
  return traceFlow[traceFlow.length - 1] || UNDERLYING.start;
}

function traceAccepted() {
  return UNDERLYING.accepting.indexOf(traceFinalState()) !== -1;
}

// ---------------------------------------------------------------------------
// The longer view: a trace, its arrows, and its playback
// ---------------------------------------------------------------------------
//
// WHAT IS DRAWN, AND WHAT IS NOT DECIDED HERE.
//
// The chain is a TRACE of a run through the two-state DFA in dfa.py. The large
// label on a node is the step number; the small label underneath is the state the
// machine was really in. Nothing in this file decides anything: every state label
// and every verdict comes from dfa.py, and the arrows below are a way of drawing
// time passing.
//
// Two kinds of arrow travel into qd, and neither is a transition of the machine:
//
//   * the DUMP arrow of a step that has gone by - history being tidied away;
//   * the FINAL DUMP, when the run ends in q0, which is the rejection.
//
// A run that ends in q1 gets no flow into qd at all.

// ---------------------------------------------------------------------------
// The arrow system
// ---------------------------------------------------------------------------
//
// Every arrow in the trace view is the same two elements: a SHAFT that is revealed
// along its own path, and a HEAD that is carried along that same path.
//
// The head is a separate element rather than an SVG marker because a marker is
// painted at the END of the path from the first frame. That is the thing this
// design exists to avoid - the arrowhead arriving before the shaft has been drawn.
// Carrying the head means it is at the tip of the shaft at every single frame, and
// its rotation is taken from the tangent of the path at that exact point, so it is
// always pointing where the arrow is going.
//
// One head shape is authored once and used by every arrow, so no two arrowheads in
// the diagram can differ in size, shape or proportion.

const HEAD_LEN = 11;                              // tip back to tail
const HEAD_HALF = 4.6;                            // half width at the tail
const HEAD_PATH = 'M' + (-HEAD_LEN) + ',' + (-HEAD_HALF) +
                  ' L0,0 L' + (-HEAD_LEN) + ',' + HEAD_HALF + ' z';

const SHAFT_MS = 420;                             // a transition being traversed
const TRACE_POP_AT_MS = 300;                            // a new step pops as its arrow lands
const TRACE_POP_MS = 260;                               // the step's popup
const DUMP_MS = 620;                              // a past step flowing to qd
const DUMP_DELAY_MS = 140;                        // ...starting while the next arrow is under way
const DUMP_FINAL_MS = 900;                        // the rejection, slower
const STEP_MS = 760;                              // one step from start to start: arrow, popup, rest

const arrows = new Map();     // id -> record

function createArrow(record) {
  const group = svgEl('g', { class: 'arrow arrow--' + record.kind });
  const shaft = svgEl('path', { class: 'arrow__shaft' });
  const head = svgEl('path', { class: 'arrow__head', d: HEAD_PATH });
  group.append(shaft, head);
  record.group = group;
  record.shaft = shaft;
  record.head = head;
  record.len = 0;
  record.raf = 0;
  record.timer = 0;
  record.t = 0;
  record.status = 'inactive';
  return record;
}

// Geometry only. Called when the layout changes - never during playback. The shape
// carries the curve the path was drawn from; the head is read from that same curve.
function setArrowPath(arrow, shape) {
  arrow.d = shape.d;
  arrow.curve = shape.curve;
  arrow.arc = arcTable(shape.curve);
  arrow.shaft.setAttribute('d', shape.d);
  arrow.len = arrow.shaft.getTotalLength();
  arrow.shaft.style.strokeDasharray = String(arrow.len);
}

// Length along a curve, sampled from the curve's own formula. Each row pairs a length
// with the parameter that reaches it, so a distance along the path can be turned into
// a point and a tangent on the curve.
const ARC_SAMPLES = 400;
function arcTable(curve) {
  const table = [{ s: 0, u: 0 }];
  let prev = curve[0];
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const u = i / ARC_SAMPLES;
    const p = cubicAt(curve[0], curve[1], curve[2], curve[3], u);
    table.push({ s: table[i - 1].s + Math.hypot(p.x - prev.x, p.y - prev.y), u: u });
    prev = p;
  }
  return table;
}

// The curve parameter at a progress fraction of the path. The fraction is taken of
// the table's own total, so the browser's measured length and ours never disagree.
function curveParam(arrow, fraction) {
  const table = arrow.arc;
  const target = fraction * table[table.length - 1].s;
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid].s < target) lo = mid; else hi = mid;
  }
  const a = table[lo], b = table[hi];
  const f = b.s > a.s ? (target - a.s) / (b.s - a.s) : 0;
  return a.u + (b.u - a.u) * f;
}

function cancelArrow(arrow) {
  if (arrow.raf) { cancelAnimationFrame(arrow.raf); arrow.raf = 0; }
  if (arrow.timer) { clearTimeout(arrow.timer); arrow.timer = 0; }
}

function cancelAllArrows() {
  for (const arrow of arrows.values()) cancelArrow(arrow);
}

function hideArrow(arrow) {
  cancelArrow(arrow);
  arrow.t = 0;
  arrow.status = 'inactive';
  arrow.group.classList.remove('is-active', 'is-complete', 'is-historical');
  arrow.shaft.style.strokeDashoffset = String(arrow.len);
  arrow.head.style.opacity = '0';
  if (arrow.label) arrow.label.style.opacity = '0';
}

// Put the head at the tip of the shaft for a progress value, rotated to the
// tangent there. Both come from the same parameter on the same curve, so the head can
// never be anywhere but the end of the shaft. The tangent is the curve's own
// derivative: a chord over the last pixels of a tight bend, such as a dump curve
// arriving at qd's rim, lags the true direction by a few degrees.
function placeArrowHead(arrow, t) {
  if (!arrow.len) return;
  const fraction = Math.max(0, Math.min(1, t));
  const u = curveParam(arrow, fraction);
  const c = arrow.curve;
  const tip = cubicAt(c[0], c[1], c[2], c[3], u);
  const dir = cubicTangent(c[0], c[1], c[2], c[3], u);
  const angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
  arrow.head.setAttribute('transform',
    'translate(' + round2(tip.x) + ',' + round2(tip.y) + ') rotate(' + round2(angle) + ')');
}

// Reveal an arrow along its own path. The shaft is uncovered by sliding its dash
// backwards; the head rides the growing tip. Both are driven from the same
// progress value, so they are one motion.
function playArrow(arrow, opts) {
  if (!arrow || !arrow.len) return;
  const options = opts || {};
  const duration = options.duration || SHAFT_MS;
  const delay = options.delay || 0;
  cancelArrow(arrow);
  arrow.status = 'active';
  arrow.group.classList.remove('is-complete', 'is-historical');
  arrow.group.classList.add('is-active');
  arrow.shaft.style.strokeDashoffset = String(arrow.len);
  arrow.head.style.opacity = '0';

  // The label is shown as the shaft starts to move, not before.
  if (arrow.label) arrow.label.style.opacity = '0';
  const started = performance.now();
  const frame = (now) => {
    const elapsed = now - started - delay;
    if (elapsed < 0) { arrow.raf = requestAnimationFrame(frame); return; }
    if (arrow.label) arrow.label.style.opacity = '1';
    const t = Math.min(1, elapsed / duration);
    arrow.t = t;
    arrow.shaft.style.strokeDashoffset = String(arrow.len * (1 - t));
    placeArrowHead(arrow, t);
    arrow.head.style.opacity = t > 0.02 ? '1' : '0';
    if (t < 1) { arrow.raf = requestAnimationFrame(frame); return; }
    arrow.raf = 0;
    arrow.shaft.style.strokeDashoffset = '0';
    placeArrowHead(arrow, 1);
    arrow.head.style.opacity = '1';
    arrow.status = options.status || 'complete';
    arrow.group.classList.remove('is-active');
    arrow.group.classList.add(arrow.status === 'historical' ? 'is-historical' : 'is-complete');
    if (options.then) options.then();
  };
  arrow.raf = requestAnimationFrame(frame);
}

function finishArrow(arrow, status) {
  if (!arrow || !arrow.len) return;
  cancelArrow(arrow);
  arrow.t = 1;
  arrow.shaft.style.strokeDashoffset = '0';
  placeArrowHead(arrow, 1);
  arrow.head.style.opacity = '1';
  if (arrow.label) arrow.label.style.opacity = '1';
  arrow.status = status || 'complete';
  arrow.group.classList.remove('is-active');
  arrow.group.classList.add(arrow.status === 'historical' ? 'is-historical' : 'is-complete');
}

function arrowStatus(arrow, status) {
  if (!arrow) return;
  arrow.status = status;
  arrow.group.classList.toggle('is-active', status === 'active');
  arrow.group.classList.toggle('is-complete', status === 'complete');
  arrow.group.classList.toggle('is-historical', status === 'historical');
}

// ---------------------------------------------------------------------------
// The run being traced
// ---------------------------------------------------------------------------

function traceFinalState() {
  return traceFlow[traceFlow.length - 1] || UNDERLYING.start;
}

function traceAccepted() {
  return UNDERLYING.accepting.indexOf(traceFinalState()) !== -1;
}

function traceMax() {
  return Math.max(0, traceFlow.length - 1);
}

function traceSpec() {
  const steps = traceFlow.length;                 // one node per position reached
  const final = steps - 1;
  const accepted = traceAccepted();

  const nodes = [];
  for (let i = 0; i < steps; i++) {
    nodes.push({
      key: 'p' + i,
      // The professor's naming: the large label counts the step and is written q0,
      // q1, q2 ... The small label carries the real state and is what matters.
      big: 'q' + i,
      small: traceFlow[i],
      // No double ring on a trace node. A ring marks an accepting STATE; in a
      // trace most nodes sit in an accepting state part of the time, so ringing
      // them would suggest the string is accepted before the run has finished.
      // The one ring that does appear is the animated acceptance ring at the end.
      accepting: false,
    });
  }
  nodes.push({ key: 'qd', big: 'qd', small: 'dead state', accepting: false, below: true, smallSide: 'left' });

  // Forward transitions, one per symbol read. Straight, because the states are on
  // one row and there is nothing to route around.
  const stepEdges = [];
  for (let i = 0; i < steps - 1; i++) {
    stepEdges.push({ key: 'p' + i + '>p' + (i + 1), from: 'p' + i, to: 'p' + (i + 1),
                     symbol: traceInput.charAt(i), kind: 'step' });
  }

  // One dump arrow per step, except the final node of an accepted run. That node
  // must not flow into qd - the run ended in the accepting state, so there is
  // nothing to dump, and drawing it would contradict the verdict beside it.
  const dumpEdges = [];
  const candidates = [];
  for (let i = 0; i < steps; i++) {
    if (i === final && accepted) continue;
    candidates.push(i);
  }
  candidates.forEach((i, n) => {
    dumpEdges.push({ key: 'p' + i + '>qd', from: 'p' + i, to: 'qd', symbol: '0',
                     kind: 'dump', final: i === final, spread: n, of: candidates.length });
  });

  return { nodes: nodes, stepEdges: stepEdges, dumpEdges: dumpEdges, trace: true, accepted: accepted };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// The straight run between two circles on the same row. It runs from one circle's
// outer edge to the other's, so the head stops on the boundary rather than inside
// the node, and the label sits centred above the middle of the line.
function straightBetween(from, to) {
  const x0 = from.x + from.outer;
  const x1 = to.x - to.outer;
  const a = { x: x0, y: from.y };
  const b = { x: x1, y: to.y };
  // A straight line is a cubic with its control points on the line, so every arrow
  // can be read through the same curve formula.
  const third = { x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 };
  const twoThirds = { x: (a.x + 2 * b.x) / 3, y: (a.y + 2 * b.y) / 3 };
  return { d: 'M' + round2(x0) + ',' + round2(from.y) + ' L' + round2(x1) + ',' + round2(to.y),
           curve: [a, third, twoThirds, b],
           label: { x: (x0 + x1) / 2, y: from.y - 13 } };
}

// A cubic Bezier's point and tangent at t. dumpCurve reads its label from these, so the
// label sits on the curve that is drawn, not on a guess at where it runs.
function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function cubicTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

// A dump curve: from the bottom edge of a step node to a point on qd's upper
// boundary. The curve is FIXED - it is computed once when the layout changes and
// is never reshaped during playback.
//
// Arrival points are spread across qd's upper arc rather than all aimed at the
// same spot, and the bow grows across the fan so neighbouring curves nest instead
// of lying on top of one another. Both control points are offset by the same
// perpendicular amount, which keeps every curve the same shape family.
function dumpCurve(from, to, spread, of) {
  const k = of === 1 ? 0.5 : spread / (of - 1);
  // 195deg to 345deg: an even spread over qd's upper boundary in screen
  // coordinates, where negative sin is above the centre.
  const theta = ((195 + 150 * k) * Math.PI) / 180;
  // The tip lands exactly on qd's rim. The head is drawn backwards from the tip, so
  // the whole head sits outside the circle, on the approach side.
  const end = { x: to.x + to.outer * Math.cos(theta), y: to.y + to.outer * Math.sin(theta) };
  const start = { x: from.x, y: from.y + from.outer };

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Two things keep the fan readable.
  //
  // One constant bow, applied to the FIRST control point only, and it points
  // DOWN into the open half of the plate below the chain. A per-arrow bow has to
  // be the same vector for the whole fan: if its direction flips where the
  // sources pass over qd, neighbouring curves bow opposite ways and cross. One
  // shared offset keeps them ordered.
  //
  // The SECOND control point is pushed OUTWARD along the arrival radius, which
  // is what makes the final tangent run inward and the head point into the node.
  // Drawing it back towards the centre reverses that tangent, so the head is
  // laid on the wrong side of the tip and disappears under the circle.
  const BOW = 34;
  const OUTWARD = 0.5;
  const c1 = { x: start.x + dx * 0.26, y: start.y + dy * 0.26 + BOW };
  const c2 = { x: end.x + (end.x - to.x) * OUTWARD, y: end.y + (end.y - to.y) * OUTWARD };

  // The label sits BESIDE the curve, at a fixed distance from its midpoint measured
  // along the normal there. The midpoint is read from the curve itself, so every
  // label is the same distance from its own arrow, whatever the curve's direction.
  const mid = cubicAt(start, c1, c2, end, 0.5);
  const tan = cubicTangent(start, c1, c2, end, 0.5);
  const tl = Math.hypot(tan.x, tan.y) || 1;
  const LABEL_GAP = 15;
  // The text's centre sits LABEL_GAP off the curve; the baseline is half a digit below it.
  const label = { x: mid.x - (tan.y / tl) * LABEL_GAP, y: mid.y + (tan.x / tl) * LABEL_GAP + 7 };

  return {
    d: 'M' + round2(start.x) + ',' + round2(start.y) +
       ' C' + round2(c1.x) + ',' + round2(c1.y) +
       ' ' + round2(c2.x) + ',' + round2(c2.y) +
       ' ' + round2(end.x) + ',' + round2(end.y),
    curve: [start, c1, c2, end],
    label: label,
  };
}

// ---------------------------------------------------------------------------
// Building the trace
// ---------------------------------------------------------------------------

function buildTraceArrows(layer, spec) {
  arrows.clear();
  // The start arrow, as in the machine diagram: no source, no label. drawStartArrow()
  // gives it its path on every layout, in every trace state.
  layer.append(svgEl('path', { id: 'edge-start', class: 'edge edge--start', pathLength: 1, 'marker-end': 'url(#arrow)' }));
  // An idle or invalid input has no run to draw. The trace collapses to the lone
  // starting state, which would otherwise still describe one step and leave a
  // stray arrow running into qd under an input that was never read.
  if (traceStatus !== 'ok') return;
  const group = svgEl('g', { id: 'arrow-layer' }, 'arrows');
  const labels = svgEl('g', { id: 'arrow-labels' }, 'labels');

  function add(edge, shape) {
    const arrow = createArrow({
      id: edge.key, kind: edge.kind, from: edge.from, to: edge.to, symbol: edge.symbol,
      duration: edge.kind === 'dump' ? DUMP_MS : SHAFT_MS, delay: 0, step: edge.step,
      // Kept on the record, not in the DOM: relayoutArrows() rebuilds these curves
      // from the record, and reading them off a dataset that was never written
      // collapsed the whole fan onto its first angle.
      spread: edge.spread || 0, of: edge.of || 1, final: Boolean(edge.final),
    });
    arrow.group.id = 'arrow-' + edge.key;
    group.append(arrow.group);
    const label = svgEl('text', {
      id: 'label-arrow-' + edge.key, class: 'arrow-label', 'text-anchor': 'middle',
      x: round2(shape.label.x), y: round2(shape.label.y),
    });
    label.textContent = edge.symbol;
    labels.append(label);
    arrow.label = label;
    setArrowPath(arrow, shape);
    hideArrow(arrow);
    arrows.set(edge.key, arrow);
    return arrow;
  }

  for (const edge of spec.stepEdges) {
    edge.step = Number(edge.from.slice(1));
    add(edge, straightBetween(circleOf(edge.from), circleOf(edge.to)));
  }
  for (const edge of spec.dumpEdges) {
    edge.step = Number(edge.from.slice(1));
    add(edge, dumpCurve(circleOf(edge.from), circleOf('qd'), edge.spread, edge.of));
  }

  layer.append(group, labels);
}

// After a relayout every path has to be rebuilt, because both of its end points
// moved. Geometry only - no playback state is touched, and anything already
// revealed stays revealed.
function relayoutArrows() {
  for (const arrow of arrows.values()) {
    const from = circleOf(arrow.from);
    const to = circleOf(arrow.to);
    if (!from.x && !to.x) continue;
    const shape = arrow.kind === 'dump'
      ? dumpCurve(from, to, arrow.spread, arrow.of)
      : straightBetween(from, to);
    const wasRevealed = arrow.t > 0;
    const status = arrow.status;
    setArrowPath(arrow, shape);
    arrow.label.setAttribute('x', round2(shape.label.x));
    arrow.label.setAttribute('y', round2(shape.label.y));
    if (wasRevealed) finishArrow(arrow, status === 'historical' ? 'historical' : 'complete');
    else hideArrow(arrow);
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

let traceIndex = 0;
let tracePlaying = false;
let traceTimer = 0;
let acceptAnimations = [];
let endingPending = false;

function cancelEnding() {
  if (traceTimer) { clearTimeout(traceTimer); traceTimer = 0; }
  for (const anim of acceptAnimations) {
    try { anim.cancel(); } catch (error) { /* gone */ }
  }
  acceptAnimations = [];
  endingPending = false;
}

// Everything this view owns, undone. A new check, a new input and a change of
// diagram all call this, so none of them can leave a half-drawn arrow behind.
function clearTraceEffects() {
  cancelAllArrows();
  cancelEnding();
  for (const node of el.svg.querySelectorAll('.node')) {
    for (const anim of node.getAnimations()) anim.cancel();
  }
  for (const ring of el.svg.querySelectorAll('.ring--accept')) ring.remove();
  el.svg.querySelectorAll('.node.is-accepted').forEach((n) => n.classList.remove('is-accepted'));
}

// The accepting ring: a second circle grown over the final node so the double
// circle forms as the run completes. It is the only ring the trace view draws, and
// an accepted run sends nothing to qd.
function animateAcceptance() {
  const node = document.getElementById('node-p' + traceMax());
  if (!node) return;
  const core = node.querySelector('circle.core');
  if (!core) return;
  node.classList.add('is-accepted');
  if (node.querySelector('.ring--accept')) return;

  const ring = svgEl('circle', {
    class: 'ring ring--accept',
    cx: core.getAttribute('cx'), cy: core.getAttribute('cy'),
    r: NODE_RADIUS + RING_GAP,
  });
  node.insertBefore(ring, node.querySelector('text.node-label'));
  if (prefersReducedMotion()) return;
  acceptAnimations.push(ring.animate(
    [
      { transform: 'scale(0.55)', opacity: 0 },
      { transform: 'scale(1.12)', opacity: 1, offset: 0.7 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 620, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)', fill: 'backwards' }
  ));
}

// The verdict line. Written only at the end of a run, and never for a string the
// machine did not read.
function showVerdict() {
  const line = document.getElementById('figure-result');
  if (!line || diagramMode !== 'longer') return;
  if (traceStatus === 'idle') { line.hidden = true; line.textContent = ''; line.removeAttribute('data-result'); return; }
  if (traceStatus === 'invalid') {
    line.hidden = false;
    line.setAttribute('data-result', 'invalid');
    line.textContent = 'Invalid input \u2014 the machine never read this string, so there is no run and no verdict.';
    return;
  }
  const here = traceFinalState();
  const accepted = traceAccepted();
  line.hidden = false;
  line.setAttribute('data-result', accepted ? 'accepted' : 'rejected');
  line.textContent = accepted
    ? 'Accepted \u2014 final state ' + here + ' is accepting.'
    : 'Rejected \u2014 final state ' + here + ' is not accepting.';
}

// The mid-run line, replaced by the verdict when the run ends.
function syncTraceResult() {
  const line = document.getElementById('figure-result');
  if (!line || diagramMode !== 'longer') return;
  if (traceStatus !== 'ok') { showVerdict(); return; }
  if (traceIndex >= traceMax()) {
    // Reaching the last step is not the end of the run. While the ending is
    // still in flight the line keeps saying so, and runEnding() reveals the
    // verdict once the final arrow has actually landed. Revealing it here would
    // spoil the slow dump roughly a second before it finishes.
    if (!endingPending) showVerdict();
    return;
  }
  line.hidden = false;
  line.removeAttribute('data-result');
  line.textContent = 'Processing: at step ' + traceIndex + ', state ' + (traceFlow[traceIndex] || UNDERLYING.start);
}

// Paint the static state from traceIndex alone: which step is current, which are
// behind it, which are still ahead. Nodes are never created or destroyed by
// playback, only classed.
function paintTrace() {
  const max = traceMax();
  const atEnd = traceIndex >= max;

  for (const node of el.svg.querySelectorAll('.node')) {
    const key = node.id.replace(/^node-/, '');
    if (!/^p\d+$/.test(key)) continue;
    const i = Number(key.slice(1));
    node.classList.toggle('is-current', i === traceIndex);
    node.classList.toggle('is-reached', i < traceIndex);
    node.classList.toggle('is-pending', i > traceIndex);
    node.classList.toggle('is-unseen', i > traceIndex);
    node.classList.toggle('is-final', atEnd && i === max);
  }
  for (const arrow of arrows.values()) {
    if (arrow.kind !== 'step') continue;
    if (arrow.t <= 0) continue;
    arrowStatus(arrow, arrow.step < traceIndex ? 'complete' : 'active');
  }
  const start = document.getElementById('edge-start');
  if (start) start.classList.add('edge--taken');

  syncTraceResult();
}

// The run has finished. Either it ends in the accepting state, in which case it is
// ringed and nothing is dumped, or it ends in q0, in which case the last step
// takes the full slow dump into qd and the verdict waits for that arrow to land.
function runEnding() {
  endingPending = true;
  const reveal = () => { endingPending = false; showVerdict(); };
  if (traceAccepted()) {
    animateAcceptance();
    reveal();
    return;
  }
  const final = traceMax();
  const arrow = arrows.get('p' + final + '>qd');
  if (!arrow) { reveal(); return; }
  if (prefersReducedMotion()) { finishArrow(arrow, 'complete'); reveal(); return; }
  playArrow(arrow, {
    duration: DUMP_FINAL_MS, status: 'complete',
    then: reveal,
  });
}

// Move to a step. Advancing plays the transition just taken and sends the step it
// left behind down into qd, both along their own fixed paths.
function advanceTo(next) {
  const target = Math.max(0, Math.min(next, traceMax()));
  const forward = target > traceIndex;
  traceIndex = target;
  // Landing on the last step means the run has entered its ending, not that it
  // has finished. This is flagged before painting, because paintTrace() is what
  // refreshes the result line and runEnding() has not run yet at that point.
  if (traceStatus === 'ok' && target >= traceMax()) endingPending = true;
  paintTrace();

  if (forward && target > 0) {
    const previous = target - 1;
    const stepArrow = arrows.get('p' + previous + '>p' + target);
    if (stepArrow) playArrow(stepArrow, { duration: SHAFT_MS, status: 'complete' });
    // The new step pops as its arrow lands, and the view moves with the arrow, so the
    // step is on screen by the time it appears.
    popStep(target);
    followStep(target);
    const dump = arrows.get('p' + previous + '>qd');
    if (dump) playArrow(dump, { duration: DUMP_MS, delay: DUMP_DELAY_MS, status: 'historical' });
  }
  // The ending waits for the last step to finish appearing, so the acceptance ring or
  // the final dump never starts over a step that is still popping in.
  if (traceIndex >= traceMax()) {
    if (forward) traceTimer = setTimeout(runEnding, TRACE_POP_AT_MS + TRACE_POP_MS);
    else runEnding();
  }
}

// The finished run, drawn at once: every arrow complete, every step in place, and the
// ending as it would read at the end of a run. Used under reduced motion, and when the
// longer view is switched back on after a run has already been made.
function showFinishedTrace() {
  for (let i = 0; i < traceMax(); i++) {
    const stepArrow = arrows.get('p' + i + '>p' + (i + 1));
    if (stepArrow) finishArrow(stepArrow, 'complete');
    const dump = arrows.get('p' + i + '>qd');
    if (dump) finishArrow(dump, 'historical');
  }
  traceIndex = traceMax();
  paintTrace();
  if (traceAccepted()) animateAcceptance();
  else {
    const final = arrows.get('p' + traceMax() + '>qd');
    if (final) finishArrow(final, 'complete');
    showVerdict();
  }
}

// Start the run from the beginning and play it through. There are no controls:
// the animation runs whenever the execution sequence starts or changes.
function playTrace() {
  clearTraceEffects();
  traceIndex = 0;
  paintTrace();
  keepStepInView();

  if (prefersReducedMotion()) {
    // No playback: the finished run, at once.
    showFinishedTrace();
    return;
  }

  tracePlaying = true;
  const tick = () => {
    if (!tracePlaying) return;
    if (traceIndex >= traceMax()) { tracePlaying = false; return; }
    advanceTo(traceIndex + 1);
    if (traceIndex >= traceMax()) { tracePlaying = false; return; }
    traceTimer = setTimeout(tick, STEP_MS);
  };
  traceTimer = setTimeout(tick, STEP_MS);
}

function stopTrace() {
  tracePlaying = false;
  cancelAllArrows();
  cancelEnding();
}

// Scroll the plate so the step being worked on stays on screen. The plate scrolls
// rather than scaling, so a long run needs this to stay readable.
function keepStepInView() {
  const box = el.svg.closest('.svg-box');
  const node = document.getElementById('node-p' + traceIndex);
  if (!box || !node) return;
  if (box.scrollWidth <= box.clientWidth) return;
  const b = box.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  const pad = 12;
  if (r.left >= b.left + pad && r.right <= b.right - pad) return;
  const target = box.scrollLeft + (r.left - b.left) - (b.width / 2) + (r.width / 2);
  box.scrollTo({ left: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// The new step pops in as its arrow lands: from a little smaller, fading up to full
// size, about its own centre (moveNode sets the origin). The fill is backwards, so the
// step stays hidden through the delay and cannot flash before its arrow arrives.
function popStep(index) {
  const node = document.getElementById('node-p' + index);
  if (!node || prefersReducedMotion() || typeof node.animate !== 'function') return;
  node.animate(
    [{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'scale(1)' }],
    { delay: TRACE_POP_AT_MS, duration: TRACE_POP_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' }
  );
}

// Bring the step being reached into view as its arrow starts. The plate moves only as
// far as it must, and it moves with the arrow rather than after it, so the new step is
// on screen when it appears. A step that is already in view does not move the plate.
function followStep(index) {
  const box = el.svg.closest('.svg-box');
  const node = document.getElementById('node-p' + index);
  if (!box || !node || box.scrollWidth <= box.clientWidth) return;
  const b = box.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  const pad = 64;                                   // clear space kept at the box's edges
  let left = box.scrollLeft;
  if (r.right > b.right - pad) left += r.right - (b.right - pad);
  else if (r.left < b.left + pad) left -= (b.left + pad) - r.left;
  else return;
  box.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// The plate is a fixed-size drawing inside a resizable box. When the box is
// resized the node positions have to be laid out again, or the arrows are left
// pointing at where the circles used to be.
function wireFigureResize() {
  const box = el.svg.closest('.svg-box');
  if (!box || typeof ResizeObserver === 'undefined') return;
  let first = true;
  new ResizeObserver(function () {
    if (first) { first = false; return; }
    layoutFigure();
    if (diagramMode === 'longer') {
      relayoutArrows();
      paintTrace();
    }
  }).observe(box);
}



// Rebuild the whole figure for the active view. Nodes and arrows are recreated
// rather than re-shaped, because the two views have different node sets.
function renderDiagram() {
  const spec = diagramSpec();

  for (const node of stateNodes()) node.remove();
  for (const spec_node of spec.nodes) {
    const node = makeNode(spec_node.key, spec_node.big, spec_node.small, spec_node.accepting);
    if (spec_node.smallAbove) node.dataset.smallAbove = 'true';
    if (spec_node.smallSide) node.dataset.smallSide = spec_node.smallSide;
    el.svg.append(node);
  }

  let layer = el.svg.querySelector('#edge-layer');
  if (!layer) {
    layer = svgEl('g', { id: 'edge-layer' }, 'edges');
    el.svg.insertBefore(layer, el.walkToken);
  }
  EDGE_RULES.clear();
  EDGE_ITEMS.length = 0;
  clear(layer);

  layoutFigure();

  if (spec.trace) {
    buildTraceArrows(layer, spec);
  } else {
    buildEdgesInto(layer);
  }

  layoutFigure();
  if (spec.trace) relayoutArrows();
  syncDiagramChrome(spec);
}

// Everything that belongs to the longer view and has nothing to do with the
// machine: the legend, and the result line under the plate.
function syncDiagramChrome(spec) {
  document.documentElement.dataset.diagram = diagramMode;
  const legend = document.getElementById('figure-legend');
  if (legend) legend.hidden = !spec.trace;
  if (spec.trace) paintTrace();
  else {
    const result = document.getElementById('figure-result');
    if (result) { result.hidden = true; result.textContent = ''; result.removeAttribute('data-result'); }
  }
}

// Table 1 and the Definition list describe the machine, not the view, so they are
// written once from UNDERLYING and never touched by the switch.
function syncReference() {
  const body = document.querySelector('#transition-table tbody');
  clear(body);
  const accepting = new Set(UNDERLYING.accepting);
  for (const row of UNDERLYING.rows) {
    const tr = document.createElement('tr');
    tr.id = 'trow-' + row.state;
    const th = document.createElement('th');
    th.setAttribute('scope', 'row');
    const mark = row.state === UNDERLYING.start ? '\u2192' : accepting.has(row.state) ? '*' : ' ';
    const tags = [];
    if (row.state === UNDERLYING.start) tags.push('start');
    if (accepting.has(row.state)) tags.push('accepting');
    th.textContent = mark + ' ' + row.state + (tags.length ? ' (' + tags.join(', ') + ')' : '');
    tr.append(th);
    for (const symbol of ['0', '1']) {
      const td = document.createElement('td');
      td.textContent = row.inputs[symbol];
      tr.append(td);
    }
    body.append(tr);
  }

  const put = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const ids = UNDERLYING.rows.map((r) => r.state);
  put('dd-states', 'Q = {' + ids.join(', ') + '}');
  put('dd-start', UNDERLYING.start);
  put('dd-accepting', 'F = {' + UNDERLYING.accepting.join(', ') + '}');
  put('dd-dead', UNDERLYING.dead || 'none');
  put('dd-language', UNDERLYING.language);
}

// Record the run the longer view traces. Called from the same places that render
// the verdict, so the figure can never show a trace of a different input than the
// one the result belongs to.
//
// status matters as much as the flow: 'idle' means nothing has been checked yet,
// 'invalid' means dfa.py refused the string and never simulated it, and only 'ok'
// carries a run that can be accepted or rejected.
function setTrace(input, flow, status) {
  traceInput = input || '';
  traceFlow = (flow && flow.length) ? flow : [UNDERLYING.start];
  traceStatus = status || 'ok';
  traceIndex = 0;
}

// The switch. Changing view redraws the figure and nothing else: the verdict, the
// tape, the state flow and the Execution Steps are left exactly as they were.
function wireDiagramSwitch() {
  const buttons = [...document.querySelectorAll('.seg__btn')];
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.machine;
      if (mode === diagramMode) return;
      buttons.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      diagramMode = mode;
      stopTrace();
      clearTraceEffects();
      cancelWalk();
      renderDiagram();
      if (mode === 'longer') {
        // The longer view shows the run as it stands, finished, with nothing playing.
        traceIndex = traceMax();
        if (traceStatus === 'ok') showFinishedTrace();
        else paintTrace();
      }
      figureIdle();
    });
  });
}


// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function renderIdle() {
  cancelWalk();
  clearError();
  // Nothing has been run, so the longer view traces just the start state and
  // waits at step 0 for the user to press Play.
  setTrace('', [UNDERLYING.start], 'idle');
  if (diagramMode === 'longer') { stopTrace(); renderDiagram(); }
  else syncDiagramChrome(diagramSpec());
  renderIdleResult();
  renderTape('');
  clear(el.flow);
  clear(el.stepsBody);
  clearLabels();
  figureIdle();
  showFigureStart();
}

function renderInvalid(input, errors) {
  cancelWalk();
  setTrace('', [UNDERLYING.start], 'invalid');
  if (diagramMode === 'longer') { stopTrace(); renderDiagram(); }
  else syncDiagramChrome(diagramSpec());
  renderError(INVALID_HEAD, invalidLines(errors));
  renderInvalidResult();
  clearTape();
  clear(el.flow);
  clear(el.stepsBody);
  clearLabels();
  figureIdle();
  figurePreview([]);
}

function renderValid(sim, input) {
  cancelWalk();
  // The trace comes from Python's own flow, so the figure cannot show a run that
  // disagrees with the verdict printed beside it.
  setTrace(input, sim.flow, 'ok');
  if (diagramMode === 'longer') { renderDiagram(); playTrace(); }
  else { stopTrace(); syncDiagramChrome(diagramSpec()); }
  clearError();
  renderResult(sim);
  renderTape(input);
  renderFlow(sim.flow);
  renderSteps(sim.steps, sim.start);
  figureActive();
  setCurrentState(sim.start);
  setTakenEdge(null);
  clearLabels();
  showFigureStart();
  const buildMs = figureRevealAll();
  walkTimers.push(setTimeout(function () {
    runWalk(sim.steps, function () { /* the machine is left where it finished */ });
  }, buildMs));
}

// ---------------------------------------------------------------------------
// Figure edges. index.html holds only the states, the marker and the step row;
// every arrow and every arrow label is generated here from the transition table
// already on the page. Change a cell in Table 1 and the figure changes with it.
// The DFA still lives only in dfa.py: this reads what is on the page, it does not
// decide anything.
// ---------------------------------------------------------------------------

  // svgEl, round2 and the SVG namespace are declared once, at the top level.
  const START_LEAD = 46;                        // length of the line into q0

  const RUN_MARGIN = 90;      // air either side of the centred run

  let rows_cache = [];

  // Centre and radii of a state, read from the markup.
  //
  // `outer` is the radius every arrow must anchor on: the accepting state draws
  // a double circle, so its real edge is the ring, not the core. Reading only the
  // core is what used to drop the q1 self-loop and the q1->q0 arrow *inside* the
  // accepting ring, with their arrowheads landing on it. An arrow attached to
  // `outer` always starts and ends clear of every circle the state draws.
  function circleOf(state) {
    const node = document.getElementById('node-' + state);
    const core = node.querySelector('circle.core');
    const ring = node.querySelector('circle.ring');
    const r = Number(core.getAttribute('r'));
    return {
      id: state,
      x: Number(core.getAttribute('cx')),
      y: Number(core.getAttribute('cy')),
      r: r,
      outer: ring ? Number(ring.getAttribute('r')) : r,
    };
  }

  // Read Table 1: [{ state, inputs: { symbol: destination } }] in document order.
  function readTable() {
    const head = [...document.querySelectorAll('#transition-table thead th')]
      .map((th, i) => (i === 0 ? null : th.textContent.replace(/^Input\s*/i, '').trim()))
      .filter(Boolean);
    return [...document.querySelectorAll('#transition-table tbody tr')].map((tr) => {
      const cells = [...tr.children];
      const state = (cells[0].textContent.match(/q[0-9d]/) || [])[0];
      const inputs = {};
      head.forEach((symbol, i) => {
        const dest = (cells[i + 1].textContent.match(/q[0-9d]/) || [])[0];
        if (symbol && dest) inputs[symbol] = dest;
      });
      return { state: state, inputs: inputs };
    });
  }

  // The start state and the accepting state are read from the table on the page,
  // the same place every arrow comes from, rather than being repeated here.
  function startState() {
    return rows_cache[0] ? rows_cache[0].state : 'q0';
  }

  function acceptingState() {
    const row = [...document.querySelectorAll('#transition-table tbody tr')]
      .find((tr) => /accepting/i.test(tr.children[0].textContent));
    if (!row) return null;
    const match = row.children[0].textContent.match(/q[0-9a-z]+/i);
    return match ? match[0] : null;
  }

  // One self-loop per state, above the circle on a top row and below it on a lower
  // row, carrying its symbol beyond the loop.
  //
  // Both ends anchor on `outer + LOOP_CLEAR`, so the loop grows out of the circle
  // instead of crossing it: on the accepting state that means it starts just
  // outside the double ring rather than dropping through it with its arrowhead.
  // The loop stands LOOP_RISE above the centre and LOOP_REACH wider than it is
  // tall, which is what makes it read as one deliberate loop rather than as a
  // second, smaller circle overlapping the first.
  //
  // A state on a lower row mirrors the whole thing about its centre, so qd's loop
  // hangs below qd instead of rising into the arrows that drop into it.
  function selfLoop(c) {
    const anchor = c.outer + LOOP_CLEAR;
    const dx = anchor * Math.sin(LOOP_SPAN);
    const dy = anchor * Math.cos(LOOP_SPAN);
    const below = isBelowRow(c.id);
    const dir = below ? -1 : 1;
    const top = c.y - dir * (anchor + LOOP_RISE);
    const reach = dx * LOOP_REACH;
    const start = { x: c.x - dx, y: c.y - dir * dy };
    const end = { x: c.x + dx, y: c.y - dir * dy };
    // Highest point of the cubic (highest above the circle, once mirrored).
    const apex = (2 * start.y + 6 * top) / 8;
    return {
      d: `M${round2(start.x)},${round2(start.y)} C${round2(c.x - reach)},${round2(top)} ` +
         `${round2(c.x + reach)},${round2(top)} ${round2(end.x)},${round2(end.y)}`,
      label: { x: c.x, y: round2(apex - dir * 17) },
    };
  }

  // Is this state on the active view's lower row? Only the dead state is.
  function isBelowRow(id) {
    return id === 'qd';
  }

  // The way back along the same row: one smooth arc below both circles, with its
  // symbol set below the curve. Loops above and the back-arrow below is the classic
  // two-state layout, so no two labels ever compete for the same space.
  //
  // Each end leaves `outer`, on the side of its circle that faces the other state,
  // and the control points drop by BACK_DIP. Because both ends start on the ring of
  // the accepting state, the tail never crosses the double circle. BACK_DIP is
  // chosen so the lowest point of the curve clears the circles by a clear margin
  // while staying a deliberate, shallow arc rather than a deep detour.
  function backCurve(from, to) {
    const leftward = to.x < from.x;
    const a = leftward ? BACK_ANGLE : Math.PI - BACK_ANGLE;
    const b = leftward ? Math.PI - BACK_ANGLE : BACK_ANGLE;
    const start = { x: from.x + from.outer * Math.cos(a), y: from.y + from.outer * Math.sin(a) };
    const end = { x: to.x + to.outer * Math.cos(b), y: to.y + to.outer * Math.sin(b) };
    const dip = BACK_DIP;
    const bottom = (start.y + 3 * (start.y + dip) + 3 * (end.y + dip) + end.y) / 8;
    return {
      d: `M${round2(start.x)},${round2(start.y)} C${round2(start.x)},${round2(start.y + dip)} ` +
         `${round2(end.x)},${round2(end.y + dip)} ${round2(end.x)},${round2(end.y)}`,
      label: { x: (start.x + end.x) / 2, y: round2(bottom + 24) },
    };
  }

  // A straight run between two circles on the same row, labelled above. It runs
  // from one state's outer edge to the other's, so the head stops just outside the
  // accepting ring instead of touching it, and the label sits centred above the
  // middle of the line rather than above the middle of the circles.
  function straight(from, to) {
    const y = to.y;
    const x0 = from.x + from.outer;
    const x1 = to.x - to.outer;
    return {
      d: `M${round2(x0)},${round2(y)} L${round2(x1)},${round2(y)}`,
      label: { x: (x0 + x1) / 2, y: y - 13 },
    };
  }

  // Anything that has to turn or drop: a curve from the edge of the source to the
  // edge of the target that faces it. This is the shape the longer diagram uses
  // for every arrow that drops into qd, and for the one that leaves it.
  //
  // The label goes at the curve's own midpoint, nudged to whichever side has more
  // room, so the symbols of several arrows converging on one state stay readable
  // instead of stacking on top of each other.
  function curve(from, to) {
    const a = Math.atan2(from.y - to.y, from.x - to.x);
    const start = { x: from.x + from.outer * Math.cos(Math.PI / 2), y: from.y + from.outer * Math.sin(Math.PI / 2) };
    const end = { x: to.x + to.outer * Math.cos(a), y: to.y + to.outer * Math.sin(a) };
    const drop = end.y - start.y;
    const bulge = Math.min(0.45 * (start.x - end.x), 110);
    const c1 = { x: start.x, y: start.y + 0.5 * drop };
    const c2 = { x: end.x + bulge, y: end.y - 0.1 * drop };
    // Midpoint of the cubic, which is where the arrow actually is halfway across.
    const mid = {
      x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
      y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
    };
    // Nudge away from the target, so the symbol never lands on top of the state it
    // points at. Arrows coming down are pushed up; arrows going up, pushed down.
    const away = mid.y <= (from.y + to.y) / 2 ? -1 : 1;
    return {
      d: `M${round2(start.x)},${round2(start.y)} C${round2(c1.x)},${round2(c1.y)} ` +
         `${round2(c2.x)},${round2(c2.y)} ${round2(end.x)},${round2(end.y)}`,
      label: { x: mid.x, y: round2(mid.y + away * 13) },
    };
  }

  // Each generated arrow remembers the two states and the symbol it came from, so
  // a state that has to move can have its arrows rebuilt rather than nudged.
  const EDGE_RULES = new Map();

  // Every generated arrow and its label, so the plate can show or hide one at a
  // time while the string is typed.
  const EDGE_ITEMS = [];

  // Geometry is read from the live circles, so this reflects where a state is now.
  // topRow marks the one case that gets a symbol label.
  function shapeFor(from, to) {
    const a = circleOf(from);
    const b = circleOf(to);
    if (from === to) return { shape: selfLoop(a), topRow: false };
    if (Math.abs(a.y - b.y) < 1) {
      return b.x > a.x
        ? { shape: straight(a, b), topRow: true }
        : { shape: backCurve(a, b), topRow: false };
    }
    return { shape: curve(a, b), topRow: false };
  }

  // At rest only q0 is on the plate. Each step in the run turns on the one arrow
  // that step takes and the state it reaches, so the machine appears to be built
  // as the string is typed rather than being complete from the start. The steps
  // come from dfa.py, so nothing here decides what a symbol does.
  // Arrival: the state swells into place, then the arrow that reaches it draws in
  // from its source, then the symbol on it fades up. Every circle that joins the
  // plate - states and positions alike - goes through these three steps with these
  // same timings.
  const POP_MS = 340;         // a circle growing from nothing to full size
  const DRAW_MS = 420;        // an arrow fading in, then travelling forward
  const POP_LEAD = 170;       // the circle is well on its way up before its arrow
  const ARRIVAL_STEP = 300;   // between one arrival and the next
  const REVEAL_STEP = 90;     // the same, condensed, when a check reveals the machine

  // O4: the Display timing scales the choreography as well as the walk pace, so
  // a slower setting reads as a slower drawing and not just a slower token.
  function ms(value) {
    return Math.max(1, Math.round(value / flowSpeed));
  }

  // 1. the circle, from nothing up to full size
  // duration is optional. The build has room for the full pop; an arrival during
  // the walk passes a shorter one so the circle finishes arriving before the next
  // step sets off, rather than trailing behind it.
  function popIn(node, at, duration) {
    return runAnimation(node, [
      { opacity: 0, transform: 'scale(0)' },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: ms(duration || POP_MS), delay: ms(at),
          easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' });
  }

  // 2 and 3. the arrow: it fades in first, and only once it can be seen does it
  // travel forward along its own path, so the marker arrives with the circle.
  // The dash is normalised against pathLength="1", not against the length at draw
  // time, so a curve moved afterwards is not left with a gap in it.
  function drawIn(path, at, duration) {
    if (!path) return;
    path.style.strokeDasharray = '1';
    const anim = runAnimation(path, [
      { opacity: 0, strokeDashoffset: 1, offset: 0, easing: 'ease-out' },
      { opacity: 1, strokeDashoffset: 1, offset: 0.28 },
      { opacity: 1, strokeDashoffset: 0, offset: 1, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
    ], { duration: ms(duration || DRAW_MS), delay: ms(at), fill: 'backwards' });
    // The dash is only there for the duration of the draw. Leaving it behind is
    // what made an arrow able to sit part-drawn with no animation left to finish.
    if (anim) {
      anim.finished.then(
        function () { if (path.style.strokeDasharray === '1') path.style.strokeDasharray = ''; },
        function () { /* superseded; a newer draw owns the dash now */ }
      );
    }
  }

  function fadeIn(node, at, duration) {
    return runAnimation(node, [{ opacity: 0 }, { opacity: 1 }],
      { duration: ms(duration || 200), delay: ms(at), easing: 'ease-out', fill: 'backwards' });
  }

  // The accepting state can already be on the plate when the run reaches it, so it
  // cannot always swell in from nothing. When it is already there the circle takes
  // a short catch instead, so the arrival still reads without the circle ever
  // being absent.
  function bumpIn(node, at) {
    if (!node) return;
    return runAnimation(node, [
      { transform: 'scale(1)' },
      { transform: 'scale(1.14)' },
      { transform: 'scale(1)' },
    ], { duration: ms(420), delay: ms(at), easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' });
  }

  // Play the arrivals in the order the plate gained them: a circle, the arrow into
  // it, then that arrow's symbol. Anything already on the plate is left alone.
  // Returns how long the build runs, so the caller can start the walk after it.
  function playArrivals(newStates, arrivals, stepMs) {
    const step = stepMs || ARRIVAL_STEP;
    if (prefersReducedMotion()) return 0;
    const accepting = acceptingState();
    const popped = new Set();
    const caught = new Set();
    let at = 0;

      for (const item of arrivals) {
      const arriving = newStates.get(item.to);
      if (arriving && !popped.has(item.to)) {
        popIn(arriving, at);
        popped.add(item.to);
      } else if (item.to === accepting && !caught.has(accepting) && !popped.has(accepting)) {
        bumpIn(document.getElementById('node-' + accepting), at + POP_LEAD);
        caught.add(accepting);
      }
      drawIn(item.path, at + POP_LEAD);
      if (item.label) fadeIn(item.label, at + POP_LEAD + DRAW_MS * 0.8);
      at += step;
    }

    for (const [state, node] of newStates) {
      if (!popped.has(state)) popIn(node, at);
    }
    return at > 0 ? ms(at + POP_LEAD + DRAW_MS) : 0;
  }

  // The diagram is the machine's definition, not a result of a check, so it is on
  // the plate in full at rest: both states, all four transitions and the start
  // line. There is nothing left to reveal while typing, which removes the dead
  // state special cases that only existed because the old machine had a trap.
  function figurePreview() {
    EDGE_ITEMS.forEach(function (item) {
      // The dead-state reference arrows stay faint. They are set inline like
      // every other edge, so the stylesheet cannot do this for us.
      item.path.style.opacity = '1';
    });
    // The longer view owns its steps: playTrace shows and hides them. An inline
    // opacity written here would override that, so only the machine's states get it.
    if (diagramMode !== 'longer') stateNodes().forEach(function (node) { node.style.opacity = '1'; });
    layoutFigure();
  }

  // Nothing to reveal and nothing to wait for: the machine is already on the
  // plate, so this returns 0 and the walk starts at once. The arrival
  // choreography is now used only where a circle genuinely joins the plate.
  function figureRevealAll() {
    EDGE_ITEMS.forEach(function (item) {
      // The dead-state reference arrows stay faint. They are set inline like
      // every other edge, so the stylesheet cannot do this for us.
      item.path.style.opacity = '1';
    });
    // As in figurePreview: the longer view's steps are its own to show and hide.
    if (diagramMode !== 'longer') stateNodes().forEach(function (node) { node.style.opacity = '1'; });
    layoutFigure();
    return 0;
  }

  function drawEdge(id) {
    const rule = EDGE_RULES.get(id);
    const path = document.getElementById(id);
    if (!rule || !path) return;
    const shape = shapeFor(rule.from, rule.to).shape;
    path.setAttribute('d', shape.d);
    const label = document.getElementById(`label-${id}`);
    if (label && shape.label) {
      label.setAttribute('x', round2(shape.label.x));
      label.setAttribute('y', round2(shape.label.y));
    }
  }

  // Generate the start arrow and one path plus one label per transition into an
  // edge layer, reading Table 1 so the drawing can never disagree with the machine.
  // The diagram switch calls this to redraw when the machine changes, because a
  // different machine has a different set of transitions.
  function buildEdgesInto(layer) {
    // Read Table 1 here rather than trusting a cache: this is the single source
    // the drawing is generated from, and reading it is what guarantees the figure
    // cannot disagree with the machine.
    const rows = readTable();
    if (!rows.length) return;
    rows_cache = rows;
    const first = rows[0].state;
    const geometry = {};
    rows.forEach((row) => { geometry[row.state] = circleOf(row.state); });

    // The start arrow has no source, so it is drawn from the left of the start
    // state and opens the sequence. It carries no label, by definition.
    const startNode = geometry[first];
    const startPath = svgEl('path', {
      id: 'edge-start', class: 'edge edge--start', pathLength: 1,
      d: `M${round2(startNode.x - startNode.outer - START_LEAD)},${round2(startNode.y)} L${round2(startNode.x - startNode.outer)},${round2(startNode.y)}`,
      'marker-end': 'url(#arrow)',
    });
    layer.append(startPath);
    EDGE_ITEMS.push({ id: 'edge-start', from: null, to: first, path: startPath, label: null });

    // Build every arrow first, then append them in the order they should arrive:
    // the run along the top row, then everything else, then the self-loops.
    const entries = [];
    rows.forEach(function (row) {
      Object.keys(row.inputs).forEach(function (symbol) {
        const dest = row.inputs[symbol];
        if (!geometry[dest]) return;
        const built = shapeFor(row.state, dest);
        entries.push({
          id: `edge-${row.state}-${dest}-${symbol}`,
          from: row.state, to: dest, symbol: symbol,
          d: built.shape.d, label: built.shape.label, topRow: built.topRow,
        });
      });
    });
    const arrival = (e) => (e.from === e.to ? 2 : e.topRow ? 0 : 1);
    entries.sort((a, b) => arrival(a) - arrival(b));

    entries.forEach(function (entry) {
      EDGE_RULES.set(entry.id, { from: entry.from, to: entry.to, symbol: entry.symbol });
      const path = svgEl('path', {
        id: entry.id, class: 'edge', d: entry.d, pathLength: 1, 'marker-end': 'url(#arrow)',
      });
      layer.append(path);
      let labelEl = null;

      // Every transition carries its symbol, as the assignment's diagram shows:
      // q0 --0--> q0, q0 --1--> q1, q1 --0--> q0 and q1 --1--> q1. These labels are
      // part of the machine's definition, so they are static: the class is
      // "edge-label" and not "edge-step", which keeps clearLabels() and the walk
      // from ever clearing them.
      if (entry.label) {
        const text = svgEl('text', {
          id: `label-${entry.id}`, class: 'edge-label',
          x: round2(entry.label.x), y: round2(entry.label.y), 'text-anchor': 'middle',
        });
        text.textContent = entry.symbol;
        layer.append(text);
        labelEl = text;
      }

      EDGE_ITEMS.push({ id: entry.id, from: entry.from, to: entry.to, path: path, label: labelEl });
    });
  }

function bridgeReady() {
  return ready;
}

function setControlsEnabled(enabled) {
  const on = enabled && bridgeReady();
  el.checkBtn.disabled = !on;
  el.testsBtn.disabled = !on;
  for (const button of el.examples) button.disabled = !on;
}

// Anything that changes what the user is looking at makes an in-flight check
// stale. It is dropped when it returns.
function supersede() {
  latest += 1;
  busy = false;
  setControlsEnabled(true);
}

async function handleCheck() {
  if (busy || !bridgeReady()) return;
  const value = el.input.value;
  const id = ++latest;
  busy = true;
  setControlsEnabled(false);

  try {
    const result = await window.pywebview.api.check(value);

    // Superseded by Clear, by typing, or by a newer check: drop the reply
    // untouched. The finally below still hands the controls back.
    if (id !== latest) return;

    if (!result) {
      cancelWalk();
      renderError('The checker did not respond.',
                  ['Close and reopen the application, then check again.']);
      renderInvalidResult();
      return;
    }
    if (result.status === 'invalid') {
      renderInvalid(value, result.errors);
      return;
    }
    renderValid(result, value);
  } catch (error) {
    console.error('check failed', error);
    if (id !== latest) return;
    cancelWalk();
    renderError('The checker did not respond.',
                ['Close and reopen the application, then check again.']);
    renderInvalidResult();
  } finally {
    // Whatever happened above - a result, an early return, a throw, or being
    // superseded - the interface is usable again. This is what stops a failed or
    // cancelled run from leaving the controls disabled for good.
    busy = false;
    setControlsEnabled(true);
  }
}

async function handleTests() {
  if (!bridgeReady()) return;
  el.testsBtn.disabled = true;
  let report = null;
  try {
    report = await window.pywebview.api.run_tests();
  } catch (error) {
    console.error('run_tests failed', error);
    el.testsSummary.textContent = 'The test run did not complete.';
  }
  el.testsBtn.disabled = !bridgeReady();
  if (report) renderTests(report);
}

// ---------------------------------------------------------------------------
// Test table
// ---------------------------------------------------------------------------

function renderTests(report) {
  clear(el.testsBody);

  const fragment = document.createDocumentFragment();
  const failing = [];

  report.results.forEach((row, i) => {
    if (!row.pass) failing.push(i + 1);

    const tr = document.createElement('tr');
    tr.append(make('td', null, String(i + 1)));
    tr.append(make('td', null, row.input === '' ? 'ε (empty)' : row.input));
    tr.append(make('td', null, row.expected));
    tr.append(make('td', null, row.actual));

    const status = make('td', row.pass ? 'pass' : 'fail');
    status.append(icon(row.pass ? '✓' : '✕'),
                  make('span', null, row.pass ? 'PASS' : 'FAIL'));
    tr.append(status);

    fragment.append(tr);
  });

  el.testsBody.append(fragment);

  let summary = `${report.passed} of ${report.total} passed.`;
  if (failing.length) summary += ` Failing rows: ${failing.join(', ')}.`;
  el.testsSummary.textContent = summary;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

el.checkBtn.addEventListener('click', handleCheck);

el.clearBtn.addEventListener('click', function () {
  supersede();
  previewId += 1;
  el.input.value = '';
  renderIdle();
  figurePreview([]);
  el.input.focus();
});

el.examples.forEach(function (button, i) {
  button.addEventListener('click', function () {
    if (busy || !bridgeReady()) return;
    supersede();
    el.input.value = EXAMPLE_VALUES[i];
    handleCheck();
  });
});

// Enter goes through the same gate as the button, so it cannot bypass a
// disabled control or a check that is still in flight.
el.input.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (el.checkBtn.disabled) return;
  handleCheck();
});

// While the string is being typed the plate is built from the run so far: q0
// alone to start with, then one arrow and one state per symbol. dfa.py decides
// which arrow each symbol takes, so a symbol that cannot be read simply adds
// nothing rather than inventing an edge. A debounce keeps this to one bridge call
// per pause instead of one per keystroke.
let previewTimer = 0;
let previewId = 0;

async function previewInput() {
  const value = el.input.value;
  const id = ++previewId;
  if (!value) {
    figurePreview([]);
    return;
  }
  if (!bridgeReady()) return;

  let sim = null;
  try {
    sim = await window.pywebview.api.check(value);
  } catch (error) {
    return;
  }
  if (id !== previewId || el.input.value !== value) return;

  if (sim && sim.errors && sim.errors.length) {
    // dfa.py says which symbol cannot be read, so the plate can fall back to the
    // part of the string that is still a run the machine can take.
    const prefix = value.slice(0, Math.max(0, sim.errors[0].index - 1));
    if (!prefix) {
      figurePreview([]);
      return;
    }
    try {
      sim = await window.pywebview.api.check(prefix);
    } catch (error) {
      return;
    }
    if (id !== previewId || el.input.value !== value) return;
  }

  if (sim && !sim.errors) figurePreview(sim.steps || []);
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(previewInput, 140);
}

el.input.addEventListener('input', function () {
  cancelWalk();
  supersede();
  renderIdle();
  schedulePreview();
});

el.testsBtn.addEventListener('click', handleTests);

// Appearance: "system" removes the attribute so the stylesheet follows the
// operating system. The choice is not stored; it resets on every launch.
function applyTheme(name) {
  if (name === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = name;
}
el.themeSelect.addEventListener('change', function () {
  applyTheme(el.themeSelect.value);
});

// Flow timing: applies to the next check. The choice is not stored, like the theme.
el.timingSelect.addEventListener('change', function () {
  flowSpeed = Number(el.timingSelect.value) || 1;
});

// Display menu. The button is a disclosure: it shows and hides the panel. Escape
// closes the panel and returns focus to the button; a press outside closes it.
function setMenu(open) {
  el.fabMenu.hidden = !open;
  el.fabBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

el.fabBtn.addEventListener('click', function () {
  setMenu(el.fabMenu.hidden);
});

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && !el.fabMenu.hidden) {
    setMenu(false);
    el.fabBtn.focus();
  }
});

document.addEventListener('pointerdown', function (event) {
  if (!el.fabMenu.hidden && !el.fab.contains(event.target)) setMenu(false);
});

// ---------------------------------------------------------------------------
// Intro: a 12-second motion-graphics opening that covers the page once per launch.
// The motion is CSS and SMIL, timed by --at on each element. This code decides when
// the intro lets go: when INTRO_MS has passed, or sooner on a click, a key or Skip.
// Letting go hands the title over to the page header, so the words travel rather
// than cut. Under reduced motion there is no intro at all.
// ---------------------------------------------------------------------------

const INTRO_MS = 12000;
// The handover starts this long before the end, so it finishes as the intro does.
// The CSS outro (highlighter withdraws at 10.4s, everything else clears at 10.6s)
// runs inside this window and is finished before the transition begins at 11.2s.
const INTRO_HANDOVER_MS = 800;
// Keys that only move focus or change the modifiers do not end the intro.
const INTRO_IGNORED_KEYS = ['Tab', 'Shift', 'Control', 'Alt', 'Meta'];

function startIntro() {
  const intro = document.getElementById('intro');
  // The page is locked from the first paint (the class is set on <html>), so no
  // scrollbar flashes before the intro starts. Without an intro, or under reduced
  // motion, nothing needs the lock, so the page is released here.
  if (!intro || prefersReducedMotion()) {
    if (intro) intro.remove();
    document.documentElement.classList.remove('is-intro-locked');
    return;
  }

  let leaving = false;
  let timer = 0;

  // The plate is fixed, so the page behind it must not scroll.
  document.documentElement.classList.add('is-intro-locked');
  window.scrollTo(0, 0);

  // The checker is what the reader came for, so the input takes focus as the page appears.
  function showPage() {
    el.input.focus({ preventScroll: true });
  }

  function leave() {
    if (leaving) return;
    leaving = true;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);

    const from = document.getElementById('intro-title');
    const to = document.querySelector('#header h1');
    if (typeof document.startViewTransition === 'function' && from && to) {
      // Both titles carry one name, so the browser morphs one into the other. The name
      // goes on the page title only after the intro has gone: two elements may not
      // share a name in the same capture.
      from.style.viewTransitionName = 'decider-title';
      // Everything on the page except the landing title is hidden while it travels,
      // so the words arrive first and the content eases in behind them.
      document.body.classList.add('is-handing-over');
      const transition = document.startViewTransition(() => {
        from.style.viewTransitionName = '';
        intro.remove();
        to.style.viewTransitionName = 'decider-title';
        showPage();
      });
      transition.finished.then(() => {
        to.style.viewTransitionName = '';
        document.body.classList.remove('is-handing-over');
        unlockWhenRevealed();
      });
    } else {
      // Without view transitions the intro simply fades into the page. The content is
      // held back for the fade, then reveals the same way as after the morph.
      document.body.classList.add('is-handing-over');
      intro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-in-out', fill: 'forwards' })
        .finished.then(() => {
          intro.remove();
          showPage();
          document.body.classList.remove('is-handing-over');
          unlockWhenRevealed();
        });
    }
  }

  // The page scrolls again only once the reveal has finished. Until then a scrollbar
  // would appear while the content is still arriving.
  function unlockWhenRevealed() {
    const parts = document.querySelectorAll('.page-head > p, .panel, .fab');
    Promise.all(Array.from(parts, (el) =>
      Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})))
    )).then(() => document.documentElement.classList.remove('is-intro-locked'));
  }

  function onKey(event) {
    if (INTRO_IGNORED_KEYS.includes(event.key)) return;
    leave();
  }

  intro.addEventListener('click', leave);
  document.addEventListener('keydown', onKey);
  timer = setTimeout(leave, INTRO_MS - INTRO_HANDOVER_MS);
}

function onBridgeReady() {
  ready = true;
  setControlsEnabled(true);
}

window.addEventListener('pywebviewready', onBridgeReady);
if (window.pywebview && window.pywebview.api) onBridgeReady();

setControlsEnabled(false);
syncReference();
renderDiagram();
wireDiagramSwitch();
wireFigureResize();
renderIdle();
startIntro();
