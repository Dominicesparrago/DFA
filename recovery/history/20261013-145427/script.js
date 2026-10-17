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
const NODES = Array.from(el.svg.querySelectorAll('.node'));
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
const WALK_SPACING = 130;                        // distance between the two states
const WALK_VIEW_WIDTH = 420;                     // the machine's own width
const WALK_VIEW_HEIGHT = 250;                    // margin, loops, row, back-arrow, margin
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
// Put a circle group at x, whatever x it was drawn at. Every circle in the group
// moves, because each one carries its own cx.
function moveNode(node, x) {
  for (const circle of node.querySelectorAll('circle')) circle.setAttribute('cx', x);
  const label = node.querySelector('text');
  if (label) label.setAttribute('x', x);
}


// The line that marks q0 as the start. It is a fixed short lead-in rather than a
// run from the left margin, so it stays beside q0 wherever the run puts q0.
function drawStartArrow() {
  const path = document.getElementById('edge-start');
  const label = document.getElementById('label-edge-start');
  if (!path) return;
  const q0 = nodeCircle('node-q0');
  // Off `outer`, so the start arrow never runs into an accepting ring if the
  // start state is ever the accepting one. It stays a fixed short lead-in below
  // the q0 self-loop, which rises from the top of the circle.
  const from = q0.x - q0.outer - START_LEAD;
  path.setAttribute('d', `M${round2(from)},${round2(q0.y)} L${round2(q0.x - q0.outer)},${round2(q0.y)}`);
  if (label) {
    label.setAttribute('x', round2(from + START_LEAD / 2));
    label.setAttribute('y', round2(q0.y - 10));
  }
}

// Numeric order, so q10 sorts after q9 and not between q1 and q2.
function stateOrder(id) {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

// Everything on the plate is laid out as one centred run: the states that are
// showing, evenly spaced. The plate is as wide as the run needs, and it never
// scrolls - the drawing is clamped to the stylesheet's max-width instead.
function layoutFigure() {
  // Every state node goes on the one row. This used to filter on the row's y
  // coordinate to separate the real states from a second row of generated
  // position markers; those markers are gone, and the filter silently emptied the
  // list instead if the two ever disagreed - which is exactly what happened when
  // the row moved. The states are now simply whatever the markup contains.
  const states = NODES
    .filter((node) => node.style.opacity !== '0')
    .sort((a, b) => stateOrder(a.id) - stateOrder(b.id));

  // The figure is the machine's definition, so it is a fixed size: two states,
  // the start line and four transitions, whatever the input length. Execution
  // steps live in their own panel and never widen this one.
  const span = Math.max(0, states.length - 1) * WALK_SPACING;
  states.forEach((node, i) => {
    moveNode(node, WALK_VIEW_WIDTH / 2 - span / 2 + i * WALK_SPACING);
  });

  el.svg.setAttribute('viewBox', `0 0 ${WALK_VIEW_WIDTH} ${WALK_VIEW_HEIGHT}`);
  drawStartArrow();
  EDGE_RULES.forEach((rule, id) => drawEdge(id));
}

function runWalk(steps, onDone) {
  cancelWalk();
  const count = steps.length;
  const animate = count > 0 && count <= WALK_MAX_STEPS && !prefersReducedMotion();
  const interval = stepInterval(count);

  function settle() {
    stopWalkTimers();
    showSteps(steps, count, true);
    if (count === 0) {
      setTakenEdge(null);
      if (el.tape.children.length === 1) markCell(0);
    } else {
      const last = steps[count - 1];
      setCurrentState(last.to);
      setTakenEdge(edgeIdFor(last));
      markCell(count - 1);
      if (!tokenPos) parkToken(edgeIdFor(last));
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
    setTakenEdge(edgeIdFor(step));
    moveToken(edgeIdFor(step), interval * 0.9);
    walkTimers.push(setTimeout(function () {
      setCurrentState(step.to);
      keepActiveInView(step.to);
    }, Math.round(interval * 0.8)));
    next += 1;
    walkTimers.push(setTimeout(tick, interval));
  }
  tick();

  return cancelWalk;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function renderIdle() {
  cancelWalk();
  clearError();
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

  // One self-loop per state, above the circle, carrying its symbol above the loop.
  //
  // Both ends anchor on `outer + LOOP_CLEAR`, so the loop grows out of the circle
  // instead of crossing it: on the accepting state that means it starts just
  // outside the double ring rather than dropping through it with its arrowhead.
  // The loop stands LOOP_RISE above the centre and LOOP_REACH wider than it is
  // tall, which is what makes it read as one deliberate loop rather than as a
  // second, smaller circle overlapping the first.
  //
  // It is visibly larger on q1 than on q0, which is correct: q1 draws two circles.
  function selfLoop(c) {
    const anchor = c.outer + LOOP_CLEAR;
    const dx = anchor * Math.sin(LOOP_SPAN);
    const dy = anchor * Math.cos(LOOP_SPAN);
    const top = c.y - (anchor + LOOP_RISE);
    const reach = dx * LOOP_REACH;
    const start = { x: c.x - dx, y: c.y - dy };
    const end = { x: c.x + dx, y: c.y - dy };
    // Highest point of the cubic, so the label clears the loop by a fixed amount.
    const apex = (2 * start.y + 6 * top) / 8;
    return {
      d: `M${round2(start.x)},${round2(start.y)} C${round2(c.x - reach)},${round2(top)} ` +
         `${round2(c.x + reach)},${round2(top)} ${round2(end.x)},${round2(end.y)}`,
      label: { x: c.x, y: round2(apex - 17) },
    };
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
  // edge of the target that faces it. Not used by the two-state machine, whose
  // states share a row, but kept correct for the same reason as the rest: an
  // accepting state's real edge is its ring.
  function curve(from, to) {
    const a = Math.atan2(from.y - to.y, from.x - to.x);
    const start = { x: from.x + from.outer * Math.cos(Math.PI / 2), y: from.y + from.outer * Math.sin(Math.PI / 2) };
    const end = { x: to.x + to.outer * Math.cos(a), y: to.y + to.outer * Math.sin(a) };
    const drop = end.y - start.y;
    const bulge = Math.min(0.45 * (start.x - end.x), 110);
    return {
      d: `M${round2(start.x)},${round2(start.y)} C${round2(start.x)},${round2(start.y + 0.5 * drop)} ` +
         `${round2(end.x + bulge)},${round2(end.y - 0.1 * drop)} ${round2(end.x)},${round2(end.y)}`,
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
    NODES.forEach(function (node) { node.style.opacity = '1'; });
    layoutFigure();
  }

  // Nothing to reveal and nothing to wait for: the machine is already on the
  // plate, so this returns 0 and the walk starts at once. The arrival
  // choreography is now used only where a circle genuinely joins the plate.
  function figureRevealAll() {
    EDGE_ITEMS.forEach(function (item) { item.path.style.opacity = '1'; });
    NODES.forEach(function (node) { node.style.opacity = '1'; });
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

  function buildFigure() {
    const svg = document.getElementById('dfa-svg');
    const rows = readTable();
    if (!rows.length) return;

    rows_cache = rows;
    const first = rows[0].state;
    const geometry = {};
    rows.forEach((row) => { geometry[row.state] = circleOf(row.state); });

    const layer = svgEl('g', { id: 'edge-layer' }, 'edges');

    // The start arrow has no source, so it is drawn from the left margin, and it
    // opens the sequence. The layer is not in the document yet, so the elements are
    // held on to here rather than looked up.
    const startNode = geometry[first];
    const startPath = svgEl('path', {
      id: 'edge-start', class: 'edge edge--start', pathLength: 1,
      d: `M${round2(startNode.x - startNode.r - START_LEAD)},${round2(startNode.y)} L${round2(startNode.x - startNode.r)},${round2(startNode.y)}`,
      'marker-end': 'url(#arrow)',
    });
    layer.append(startPath);

    // No label: the start arrow carries no symbol, by definition.
    EDGE_ITEMS.push({ id: 'edge-start', from: null, to: first, path: startPath, label: null });

    // Build every arrow first, then append them in the order they should arrive:
    // the run along the top row, then the back-arrows, then the self-loops. Table
    // order does the rest, because the table lists q0 then q1 in that order.
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

    // The walk token draws on top of the arrows; nothing else lives in the
    // diagram, because execution steps have their own panel.
    svg.insertBefore(layer, el.walkToken);

    // Visibility on the plate is driven from here by the input and by the check,
    // so the plate starts in its resting state: q0, the trap and the start line.
    figurePreview([]);

    return { layer: layer, geometry: geometry, rows: rows };
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
buildFigure();
renderIdle();
