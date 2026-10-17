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

function setTakenEdge(edgeId) {
  for (const edge of el.svg.querySelectorAll('.edge--taken')) edge.classList.remove('edge--taken');
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
  const label = node.querySelector('text.node-label');
  if (label) {
    label.setAttribute('x', x);
    label.setAttribute('y', Number(y) + NODE_LABEL_DROP);
  }
  // The trace label sits outside the circle so the step number inside it and the
  // state underneath never overlap. A node can ask for it above instead, which is
  // what the dead state does - its self-loop is below it.
  const trace = node.querySelector('text.node-trace');
  if (trace) {
    const above = node.dataset.smallAbove === 'true';
    trace.setAttribute('x', x);
    trace.setAttribute('y', Number(y) + (above ? -(NODE_RADIUS + 14) : NODE_RADIUS + 22));
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
  const originX = width / 2 - span / 2;

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
let diagramMode = 'simple';

// Captions that describe whichever view is on screen.
const CAPTIONS = {
  simple:
    'Figure 1. The machine. The arrow with no source marks the start state q0 and ' +
    'carries no symbol. q1 is the accepting state, drawn with a double ring: that ' +
    'ring is part of the machine\u2019s definition, not something a check adds. Every ' +
    'circle keeps its state name, and all four arrows carry their symbol, so the ' +
    'whole transition function is on the diagram as well as in Table 1. A string is ' +
    'accepted exactly when the machine finishes in q1, which is the same as saying ' +
    'the string ends in 1. Execution steps are listed in their own Execution Steps ' +
    'panel, one row per input symbol. They are never drawn inside this diagram: the ' +
    'automaton has exactly two states however long the input is.',
  longer:
    'Figure 1. The same machine, drawn as a trace of the run. Each node is a step: ' +
    'the large label counts the step and the small label underneath is the state the ' +
    'machine was actually in, so a large q3 is step three and the small label is ' +
    'where the machine really was. Every arrow carries the symbol that was read to ' +
    'get there, so the chain shows the whole run left to right. qd below is a dead ' +
    'state for reference, drawn the way one is usually drawn, with a 0, 1 self-loop ' +
    'and no arrow entering it: this machine has no dead state, because both symbols ' +
    'are defined in both states and no input can get stuck. The acceptance result is ' +
    'the same in both views, because both are the machine in Table 1.',
};

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

function traceSpec() {
  const steps = traceFlow.length;                 // one node per position reached
  const nodes = [];
  for (let i = 0; i < steps; i++) {
    nodes.push({
      key: 'p' + i,
      // The professor's naming: the large label counts the step and is written q0,
      // q1, q2 ... The small label carries the real state and is what matters.
      big: 'q' + i,
      small: traceFlow[i],
      // No double ring on a trace node. A ring marks an accepting STATE in the
      // machine diagram; in a trace most nodes sit in an accepting state part of
      // the time, so ringing them would suggest the string is accepted before the
      // run has finished. Acceptance is stated by the result line under the plate,
      // which is where the reference puts it too.
      accepting: false,
    });
  }
  nodes.push({ key: 'qd', big: 'qd', small: 'dead state', accepting: false, below: true, smallAbove: true });

  const edges = [];
  for (let i = 0; i < steps - 1; i++) {
    edges.push({ from: 'p' + i, to: 'p' + (i + 1), label: traceInput.charAt(i) });
  }
  // The reference's dead-state self-loop, drawn as the reference draws it. It is a
  // reference, not a transition this machine takes: nothing ever enters qd.
  edges.push({ from: 'qd', to: 'qd', label: '0, 1' });

  return { nodes: nodes, edges: edges, trace: true };
}

// The arrows for the longer view are all the same shape - a straight run between
// neighbouring steps - so they are drawn directly rather than through the shape
// solver, which exists for the machine's own definition.
function buildTraceEdges(layer, spec) {
  // The start arrow enters step 0. It carries no symbol, for the same reason it
  // carries none in the machine diagram: it marks where the run begins.
  const first = spec.nodes.filter((n) => !n.below)[0];
  if (first) {
    const at = circleOf(first.key);
    const from = at.x - at.outer - START_LEAD;
    const startPath = svgEl('path', {
      id: 'edge-start', class: 'edge edge--start', pathLength: 1,
      d: `M${round2(from)},${round2(at.y)} L${round2(at.x - at.outer)},${round2(at.y)}`,
      'marker-end': 'url(#arrow)',
    });
    layer.append(startPath);
    EDGE_ITEMS.push({ id: 'edge-start', from: null, to: first.key, path: startPath, label: null });
  }

  for (const edge of spec.edges) {
    const from = circleOf(edge.from);
    const to = circleOf(edge.to);
    const path = svgEl('path', {
      id: 'edge-' + edge.from + '-' + edge.to + '-' + edge.label.replace(/[^01]/g, ''),
      class: 'edge', pathLength: 1, 'marker-end': 'url(#arrow)',
    });
    layer.append(path);
    EDGE_RULES.set(path.id, { from: edge.from, to: edge.to, symbol: edge.label });
    EDGE_ITEMS.push({ id: path.id, from: edge.from, to: edge.to, path: path, label: null });

    const text = svgEl('text', {
      id: 'label-' + path.id, class: 'edge-label', 'text-anchor': 'middle',
    });
    text.textContent = edge.label;
    layer.append(text);
    EDGE_ITEMS[EDGE_ITEMS.length - 1].label = text;
    EDGE_ITEMS[EDGE_ITEMS.length - 1].from = edge.from;
    EDGE_ITEMS[EDGE_ITEMS.length - 1].to = edge.to;
    EDGE_RULES.set(path.id, { from: edge.from, to: edge.to, symbol: edge.label, labelAt: text });
    text.__from = edge.from;
    text.__to = edge.to;
  }
}

// Rebuild the whole figure for the active view. Nodes and arrows are recreated
// rather than re-shaped, because the two views have different node sets.
function renderDiagram() {
  const spec = diagramSpec();

  for (const node of stateNodes()) node.remove();
  for (const spec_node of spec.nodes) {
    const node = makeNode(spec_node.key, spec_node.big, spec_node.small, spec_node.accepting);
    if (spec_node.smallAbove) node.dataset.smallAbove = 'true';
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
    buildTraceEdges(layer, spec);
  } else {
    buildEdgesInto(layer);
  }

  layoutFigure();
  syncDiagramChrome(spec);
}

// Everything that belongs to the longer view and has nothing to do with the
// machine: the legend, and the result line under the plate.
function syncDiagramChrome(spec) {
  document.documentElement.dataset.diagram = diagramMode;
  const caption = document.getElementById('figure-caption');
  if (caption && CAPTIONS[diagramMode]) caption.textContent = CAPTIONS[diagramMode];
  const legend = document.getElementById('figure-legend');
  const result = document.getElementById('figure-result');
  if (legend) legend.hidden = !spec.trace;
  if (!result) return;
  if (!spec.trace) { result.hidden = true; result.textContent = ''; return; }

  const last = traceFlow[traceFlow.length - 1];
  const accepted = UNDERLYING.accepting.indexOf(last) !== -1;
  const noun = traceInput ? 'the input' : 'the empty input';
  result.hidden = false;
  result.textContent = accepted
    ? 'Accepted: final state ' + last + ' is accepting'
    : 'Rejected: final state ' + last + ' is not accepting';
  result.setAttribute('data-result', accepted ? 'accepted' : 'rejected');
  result.setAttribute('data-input', traceInput);
  void noun;
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
function setTrace(input, flow) {
  traceInput = input || '';
  traceFlow = (flow && flow.length) ? flow : [UNDERLYING.start];
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
      cancelWalk();
      renderDiagram();
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
  // Nothing has been run, so the longer view traces just the start state.
  setTrace('', [UNDERLYING.start]);
  if (diagramMode === 'longer') renderDiagram(); else syncDiagramChrome(diagramSpec());
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
  setTrace('', [UNDERLYING.start]);
  if (diagramMode === 'longer') renderDiagram(); else syncDiagramChrome(diagramSpec());
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
  setTrace(input, sim.flow);
  if (diagramMode === 'longer') renderDiagram(); else syncDiagramChrome(diagramSpec());
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
    EDGE_ITEMS.forEach(function (item) { item.path.style.opacity = '1'; });
    stateNodes().forEach(function (node) { node.style.opacity = '1'; });
    layoutFigure();
  }

  // Nothing to reveal and nothing to wait for: the machine is already on the
  // plate, so this returns 0 and the walk starts at once. The arrival
  // choreography is now used only where a circle genuinely joins the plate.
  function figureRevealAll() {
    EDGE_ITEMS.forEach(function (item) { item.path.style.opacity = '1'; });
    stateNodes().forEach(function (node) { node.style.opacity = '1'; });
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
renderIdle();
