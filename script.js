
'use strict';

const WALK_BUDGET_MS = 900;
const WALK_STEP_MS = 150;
const WALK_MAX_STEPS = 12;
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

function stateNodes() {
  return Array.from(el.svg.querySelectorAll('.node'));
}
const TABLE_ROWS = Array.from(document.querySelectorAll('#transition-table tbody tr'));

let walkTimers = [];
let tokenFrame = 0;
let liveAnimations = new Set();
let tokenPos = null;
let markedCell = null;
let flowSpeed = 1;

let latest = 0;
let busy = false;
let ready = false;

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

function setCurrentState(state) {
  for (const row of TABLE_ROWS) {
    row.classList.toggle('is-active', Boolean(state) && row.id === `trow-${state}`);
  }
}

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
    try { anim.cancel(); } catch (error) {   }
  }
  liveAnimations.clear();
}

function edgeElement(edgeId) {
  return document.getElementById(edgeId) ||
         document.getElementById(edgeId.replace(/-\d+$/, ''));
}

function setTakenEdge(edgeId) {
  for (const edge of el.svg.querySelectorAll('.edge--taken')) {
    if (edge.classList.contains('edge--step')) continue;
    edge.classList.remove('edge--taken');
  }
  if (!edgeId) return;
  const target = edgeElement(edgeId);
  if (target) target.classList.add('edge--taken');
}

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

function renderFlow(flow) {
  clear(el.flow);
  const fragment = document.createDocumentFragment();

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

function stepIn(row, at) {
  if (prefersReducedMotion()) return;
  runAnimation(row, [
    { opacity: 0, transform: 'translateY(7px)' },
    { opacity: 1, transform: 'none' },
  ], { duration: ms(POP_MS), delay: ms(at), easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' });
}

function showSteps(steps, upTo, finished) {
  const rows = el.stepsBody.querySelectorAll('.step[data-index]');
  rows.forEach((row, i) => {
    const reached = i < upTo;
    if (reached && row.classList.contains('step--pending')) {
      row.classList.remove('step--pending');
      stepIn(row, 0);
    }
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

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function hideToken() {
  el.walkToken.classList.remove('is-moving');
}

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

function parkToken(edgeId) {
  const path = edgeElement(edgeId);
  if (!path) return;
  placeToken(path.getPointAtLength(path.getTotalLength()));
  el.walkToken.classList.add('is-moving');
}

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

function stepInterval(count) {
  const base = Math.max(1, Math.min(WALK_STEP_MS, Math.floor(WALK_BUDGET_MS / Math.max(count, 1))));
  return Math.max(1, Math.round(base / flowSpeed));
}

function clearLabels() {
  resetSteps();
}

const NODE_RADIUS = 34;
const RING_GAP = 8;
const NODE_LABEL_DROP = 8;
const WALK_SPACING = 130;
const WALK_VIEW_WIDTH = 420;
const WALK_VIEW_HEIGHT = 250;
const WALK_VIEW_HEIGHT_LONG = 430;
const ROW_TOP = 120;
const ROW_BOTTOM = 300;
let plateView = { width: WALK_VIEW_WIDTH, height: WALK_VIEW_HEIGHT };
const LOOP_CLEAR = 5;
const LOOP_SPAN = 60 * Math.PI / 180;
const LOOP_RISE = 44;
const LOOP_REACH = 1.25;
const BACK_ANGLE = 125 * Math.PI / 180;
const BACK_DIP = 60;

function svgEl(tag, attrs, className) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const name of Object.keys(attrs)) node.setAttribute(name, String(attrs[name]));
  if (className) node.setAttribute('class', className);
  return node;
}

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

function round2(v) {
  return Math.round(v * 100) / 100;
}

function lastStateName() {
  let last = null;
  EDGE_RULES.forEach(function (rule) {
    if (rule.from !== rule.to) last = rule.to;
  });
  return last || 'q0';
}

function showFigureStart() {}

function keepActiveInView() {}

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

function drawStartArrow() {
  const path = document.getElementById('edge-start');
  const label = document.getElementById('label-edge-start');
  if (!path) return;
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

function stateOrder(id) {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function layoutFigure() {
  const below = new Set(diagramSpec().nodes.filter((n) => n.below).map((n) => n.key));
  const all = stateNodes().filter((node) => node.style.opacity !== '0');
  const topRow = all.filter((node) => !below.has(node.id.replace(/^node-/, '')))
    .sort((a, b) => stateOrder(a.id) - stateOrder(b.id));
  const bottomRow = all.filter((node) => below.has(node.id.replace(/^node-/, '')))
    .sort((a, b) => stateOrder(a.id) - stateOrder(b.id));

  const columns = Math.max(topRow.length, bottomRow.length, 1);
  const span = (columns - 1) * WALK_SPACING;
  const width = Math.max(WALK_VIEW_WIDTH, span + 2 * 90);
  const height = bottomRow.length ? WALK_VIEW_HEIGHT_LONG : WALK_VIEW_HEIGHT;
  const originX = (width - span + START_LEAD) / 2;

  topRow.forEach((node, i) => moveNode(node, originX + i * WALK_SPACING, ROW_TOP));
  bottomRow.forEach((node, i) => {
    const x = bottomRow.length === 1
      ? width / 2
      : originX + (i - (bottomRow.length - 1) / 2) * WALK_SPACING;
    moveNode(node, x, ROW_BOTTOM);
  });

  plateView = { width: width, height: height };
  el.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.svg.style.width = diagramMode === 'longer' ? width + 'px' : '';
  drawStartArrow();
  EDGE_RULES.forEach((rule, id) => drawEdge(id));
}

function runWalk(steps, onDone) {
  cancelWalk();
  const count = steps.length;
  const animate = count > 0 && count <= WALK_MAX_STEPS && !prefersReducedMotion();
  const interval = stepInterval(count);
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

let traceInput = '';
let traceFlow = ['q0'];
let traceStatus = 'idle';
let diagramMode = 'simple';

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

function traceFinalState() {
  return traceFlow[traceFlow.length - 1] || UNDERLYING.start;
}

function traceAccepted() {
  return UNDERLYING.accepting.indexOf(traceFinalState()) !== -1;
}

const HEAD_LEN = 11;
const HEAD_HALF = 4.6;
const HEAD_PATH = 'M' + (-HEAD_LEN) + ',' + (-HEAD_HALF) +
                  ' L0,0 L' + (-HEAD_LEN) + ',' + HEAD_HALF + ' z';

const SHAFT_MS = 420;
const TRACE_POP_AT_MS = 300;
const TRACE_POP_MS = 260;
const DUMP_MS = 620;
const DUMP_DELAY_MS = 140;
const DUMP_FINAL_MS = 900;
const STEP_MS = 760;

const arrows = new Map();

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

function setArrowPath(arrow, shape) {
  arrow.d = shape.d;
  arrow.curve = shape.curve;
  arrow.arc = arcTable(shape.curve);
  arrow.shaft.setAttribute('d', shape.d);
  arrow.len = arrow.shaft.getTotalLength();
  arrow.shaft.style.strokeDasharray = String(arrow.len);
}

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
  const steps = traceFlow.length;
  const final = steps - 1;
  const accepted = traceAccepted();

  const nodes = [];
  for (let i = 0; i < steps; i++) {
    nodes.push({
      key: 'p' + i,
      big: 'q' + i,
      small: traceFlow[i],
      accepting: false,
    });
  }
  nodes.push({ key: 'qd', big: 'qd', small: 'state sink', accepting: false, below: true, smallSide: 'left' });

  const stepEdges = [];
  for (let i = 0; i < steps - 1; i++) {
    stepEdges.push({ key: 'p' + i + '>p' + (i + 1), from: 'p' + i, to: 'p' + (i + 1),
                     symbol: traceInput.charAt(i), kind: 'step' });
  }

  const dumpEdges = [];
  const candidates = [];
  for (let i = 0; i < steps; i++) {
    candidates.push(i);
  }
  candidates.forEach((i, n) => {
    const settled = i === final;
    const symbol = settled ? (accepted ? '01' : traceInput.charAt(final - 1)) : traceInput.charAt(i);
    dumpEdges.push({ key: 'p' + i + '>qd', from: 'p' + i, to: 'qd', symbol: symbol,
                     kind: 'dump', final: settled, spread: n, of: candidates.length });
  });

  return { nodes: nodes, stepEdges: stepEdges, dumpEdges: dumpEdges, trace: true, accepted: accepted };
}

function straightBetween(from, to) {
  const x0 = from.x + from.outer;
  const x1 = to.x - to.outer;
  const a = { x: x0, y: from.y };
  const b = { x: x1, y: to.y };
  const third = { x: (2 * a.x + b.x) / 3, y: (2 * a.y + b.y) / 3 };
  const twoThirds = { x: (a.x + 2 * b.x) / 3, y: (a.y + 2 * b.y) / 3 };
  return { d: 'M' + round2(x0) + ',' + round2(from.y) + ' L' + round2(x1) + ',' + round2(to.y),
           curve: [a, third, twoThirds, b],
           label: { x: (x0 + x1) / 2, y: from.y - 13 } };
}

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

function dumpCurve(from, to, spread, of) {
  const k = of === 1 ? 0.5 : spread / (of - 1);
  const theta = ((195 + 150 * k) * Math.PI) / 180;
  const end = { x: to.x + to.outer * Math.cos(theta), y: to.y + to.outer * Math.sin(theta) };
  const start = { x: from.x, y: from.y + from.outer };

  const dx = end.x - start.x;
  const dy = end.y - start.y;

  const BOW = 34;
  const OUTWARD = 0.5;
  const c1 = { x: start.x + dx * 0.26, y: start.y + dy * 0.26 + BOW };
  const c2 = { x: end.x + (end.x - to.x) * OUTWARD, y: end.y + (end.y - to.y) * OUTWARD };

  const mid = cubicAt(start, c1, c2, end, 0.5);
  const tan = cubicTangent(start, c1, c2, end, 0.5);
  const tl = Math.hypot(tan.x, tan.y) || 1;
  const LABEL_GAP = 15;
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

function buildTraceArrows(layer, spec) {
  arrows.clear();
  layer.append(svgEl('path', { id: 'edge-start', class: 'edge edge--start', pathLength: 1, 'marker-end': 'url(#arrow)' }));
  if (traceStatus !== 'ok') return;
  const group = svgEl('g', { id: 'arrow-layer' }, 'arrows');
  const labels = svgEl('g', { id: 'arrow-labels' }, 'labels');

  function add(edge, shape) {
    const arrow = createArrow({
      id: edge.key, kind: edge.kind, from: edge.from, to: edge.to, symbol: edge.symbol,
      duration: edge.kind === 'dump' ? DUMP_MS : SHAFT_MS, delay: 0, step: edge.step,
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

let traceIndex = 0;
let tracePlaying = false;
let traceTimer = 0;
let acceptAnimations = [];
let endingPending = false;

function cancelEnding() {
  if (traceTimer) { clearTimeout(traceTimer); traceTimer = 0; }
  for (const anim of acceptAnimations) {
    try { anim.cancel(); } catch (error) {   }
  }
  acceptAnimations = [];
  endingPending = false;
}

function clearTraceEffects() {
  cancelAllArrows();
  cancelEnding();
  for (const node of el.svg.querySelectorAll('.node')) {
    for (const anim of node.getAnimations()) anim.cancel();
  }
  for (const ring of el.svg.querySelectorAll('.ring--accept')) ring.remove();
  el.svg.querySelectorAll('.node.is-accepted').forEach((n) => n.classList.remove('is-accepted'));
}

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

function syncTraceResult() {
  const line = document.getElementById('figure-result');
  if (!line || diagramMode !== 'longer') return;
  if (traceStatus !== 'ok') { showVerdict(); return; }
  if (traceIndex >= traceMax()) {
    if (!endingPending) showVerdict();
    return;
  }
  line.hidden = false;
  line.removeAttribute('data-result');
  line.textContent = 'Processing: at step ' + traceIndex + ', state ' + (traceFlow[traceIndex] || UNDERLYING.start);
}

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

function runEnding() {
  endingPending = true;
  const reveal = () => { endingPending = false; showVerdict(); };
  if (traceAccepted()) {
    animateAcceptance();
    const sinkArrow = arrows.get('p' + traceMax() + '>qd');
    if (!sinkArrow) { reveal(); return; }
    if (prefersReducedMotion()) { finishArrow(sinkArrow, 'complete'); reveal(); return; }
    playArrow(sinkArrow, { duration: DUMP_FINAL_MS, status: 'complete', then: reveal });
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

function advanceTo(next) {
  const target = Math.max(0, Math.min(next, traceMax()));
  const forward = target > traceIndex;
  traceIndex = target;
  if (traceStatus === 'ok' && target >= traceMax()) endingPending = true;
  paintTrace();

  if (forward && target > 0) {
    const previous = target - 1;
    const stepArrow = arrows.get('p' + previous + '>p' + target);
    if (stepArrow) playArrow(stepArrow, { duration: SHAFT_MS, status: 'complete' });
    popStep(target);
    followStep(target);
    const dump = arrows.get('p' + previous + '>qd');
    if (dump) playArrow(dump, { duration: DUMP_MS, delay: DUMP_DELAY_MS, status: 'historical' });
  }
  if (traceIndex >= traceMax()) {
    if (forward) traceTimer = setTimeout(runEnding, TRACE_POP_AT_MS + TRACE_POP_MS);
    else runEnding();
  }
}

function showFinishedTrace() {
  for (let i = 0; i < traceMax(); i++) {
    const stepArrow = arrows.get('p' + i + '>p' + (i + 1));
    if (stepArrow) finishArrow(stepArrow, 'complete');
    const dump = arrows.get('p' + i + '>qd');
    if (dump) finishArrow(dump, 'historical');
  }
  traceIndex = traceMax();
  paintTrace();
  if (traceAccepted()) {
    animateAcceptance();
    const sinkArrow = arrows.get('p' + traceMax() + '>qd');
    if (sinkArrow) finishArrow(sinkArrow, 'complete');
    showVerdict();
  } else {
    const final = arrows.get('p' + traceMax() + '>qd');
    if (final) finishArrow(final, 'complete');
    showVerdict();
  }
}

function playTrace() {
  clearTraceEffects();
  traceIndex = 0;
  paintTrace();
  keepStepInView();

  if (prefersReducedMotion()) {
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

function popStep(index) {
  const node = document.getElementById('node-p' + index);
  if (!node || prefersReducedMotion() || typeof node.animate !== 'function') return;
  node.animate(
    [{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'scale(1)' }],
    { delay: TRACE_POP_AT_MS, duration: TRACE_POP_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' }
  );
}

function followStep(index) {
  const box = el.svg.closest('.svg-box');
  const node = document.getElementById('node-p' + index);
  if (!box || !node || box.scrollWidth <= box.clientWidth) return;
  const b = box.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  const pad = 64;
  let left = box.scrollLeft;
  if (r.right > b.right - pad) left += r.right - (b.right - pad);
  else if (r.left < b.left + pad) left -= (b.left + pad) - r.left;
  else return;
  box.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

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

function setTrace(input, flow, status) {
  traceInput = input || '';
  traceFlow = (flow && flow.length) ? flow : [UNDERLYING.start];
  traceStatus = status || 'ok';
  traceIndex = 0;
}

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
        traceIndex = traceMax();
        if (traceStatus === 'ok') showFinishedTrace();
        else paintTrace();
      }
      figureIdle();
    });
  });
}

function renderIdle() {
  cancelWalk();
  clearError();
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
    runWalk(sim.steps, function () {   });
  }, buildMs));
}

  const START_LEAD = 46;

  const RUN_MARGIN = 90;

  let rows_cache = [];

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
    const apex = (2 * start.y + 6 * top) / 8;
    return {
      d: `M${round2(start.x)},${round2(start.y)} C${round2(c.x - reach)},${round2(top)} ` +
         `${round2(c.x + reach)},${round2(top)} ${round2(end.x)},${round2(end.y)}`,
      label: { x: c.x, y: round2(apex - dir * 17) },
    };
  }

  function isBelowRow(id) {
    return id === 'qd';
  }

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

  function straight(from, to) {
    const y = to.y;
    const x0 = from.x + from.outer;
    const x1 = to.x - to.outer;
    return {
      d: `M${round2(x0)},${round2(y)} L${round2(x1)},${round2(y)}`,
      label: { x: (x0 + x1) / 2, y: y - 13 },
    };
  }

  function curve(from, to) {
    const a = Math.atan2(from.y - to.y, from.x - to.x);
    const start = { x: from.x + from.outer * Math.cos(Math.PI / 2), y: from.y + from.outer * Math.sin(Math.PI / 2) };
    const end = { x: to.x + to.outer * Math.cos(a), y: to.y + to.outer * Math.sin(a) };
    const drop = end.y - start.y;
    const bulge = Math.min(0.45 * (start.x - end.x), 110);
    const c1 = { x: start.x, y: start.y + 0.5 * drop };
    const c2 = { x: end.x + bulge, y: end.y - 0.1 * drop };
    const mid = {
      x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
      y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
    };
    const away = mid.y <= (from.y + to.y) / 2 ? -1 : 1;
    return {
      d: `M${round2(start.x)},${round2(start.y)} C${round2(c1.x)},${round2(c1.y)} ` +
         `${round2(c2.x)},${round2(c2.y)} ${round2(end.x)},${round2(end.y)}`,
      label: { x: mid.x, y: round2(mid.y + away * 13) },
    };
  }

  const EDGE_RULES = new Map();

  const EDGE_ITEMS = [];

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

  const POP_MS = 340;
  const DRAW_MS = 420;
  const POP_LEAD = 170;
  const ARRIVAL_STEP = 300;
  const REVEAL_STEP = 90;

  function ms(value) {
    return Math.max(1, Math.round(value / flowSpeed));
  }

  function popIn(node, at, duration) {
    return runAnimation(node, [
      { opacity: 0, transform: 'scale(0)' },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: ms(duration || POP_MS), delay: ms(at),
          easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' });
  }

  function drawIn(path, at, duration) {
    if (!path) return;
    path.style.strokeDasharray = '1';
    const anim = runAnimation(path, [
      { opacity: 0, strokeDashoffset: 1, offset: 0, easing: 'ease-out' },
      { opacity: 1, strokeDashoffset: 1, offset: 0.28 },
      { opacity: 1, strokeDashoffset: 0, offset: 1, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
    ], { duration: ms(duration || DRAW_MS), delay: ms(at), fill: 'backwards' });
    if (anim) {
      anim.finished.then(
        function () { if (path.style.strokeDasharray === '1') path.style.strokeDasharray = ''; },
        function () {   }
      );
    }
  }

  function fadeIn(node, at, duration) {
    return runAnimation(node, [{ opacity: 0 }, { opacity: 1 }],
      { duration: ms(duration || 200), delay: ms(at), easing: 'ease-out', fill: 'backwards' });
  }

  function bumpIn(node, at) {
    if (!node) return;
    return runAnimation(node, [
      { transform: 'scale(1)' },
      { transform: 'scale(1.14)' },
      { transform: 'scale(1)' },
    ], { duration: ms(420), delay: ms(at), easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' });
  }

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

  function figurePreview() {
    EDGE_ITEMS.forEach(function (item) {
      item.path.style.opacity = '1';
    });
    if (diagramMode !== 'longer') stateNodes().forEach(function (node) { node.style.opacity = '1'; });
    layoutFigure();
  }

  function figureRevealAll() {
    EDGE_ITEMS.forEach(function (item) {
      item.path.style.opacity = '1';
    });
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

  function buildEdgesInto(layer) {
    const rows = readTable();
    if (!rows.length) return;
    rows_cache = rows;
    const first = rows[0].state;
    const geometry = {};
    rows.forEach((row) => { geometry[row.state] = circleOf(row.state); });

    const startNode = geometry[first];
    const startPath = svgEl('path', {
      id: 'edge-start', class: 'edge edge--start', pathLength: 1,
      d: `M${round2(startNode.x - startNode.outer - START_LEAD)},${round2(startNode.y)} L${round2(startNode.x - startNode.outer)},${round2(startNode.y)}`,
      'marker-end': 'url(#arrow)',
    });
    layer.append(startPath);
    EDGE_ITEMS.push({ id: 'edge-start', from: null, to: first, path: startPath, label: null });

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

el.input.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  if (el.checkBtn.disabled) return;
  handleCheck();
});

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

function applyTheme(name) {
  if (name === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = name;
}
el.themeSelect.addEventListener('change', function () {
  applyTheme(el.themeSelect.value);
});

el.timingSelect.addEventListener('change', function () {
  flowSpeed = Number(el.timingSelect.value) || 1;
});

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

const INTRO_MS = 12000;
const INTRO_HANDOVER_MS = 800;
const INTRO_IGNORED_KEYS = ['Tab', 'Shift', 'Control', 'Alt', 'Meta'];

function startIntro() {
  const intro = document.getElementById('intro');
  if (!intro || prefersReducedMotion()) {
    if (intro) intro.remove();
    document.documentElement.classList.remove('is-intro-locked');
    return;
  }

  let leaving = false;
  let timer = 0;

  document.documentElement.classList.add('is-intro-locked');
  window.scrollTo(0, 0);

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
      from.style.viewTransitionName = 'decider-title';
      document.documentElement.classList.add('is-handing-over');
      document.body.classList.add('is-handing-over');
      const transition = document.startViewTransition(() => {
        from.style.viewTransitionName = '';
        intro.remove();
        to.style.viewTransitionName = 'decider-title';
        showPage();
      });
      transition.finished.then(() => {
        to.style.viewTransitionName = '';
        document.documentElement.classList.remove('is-handing-over');
        document.body.classList.remove('is-handing-over');
        unlockWhenRevealed();
      });
    } else {
      document.documentElement.classList.add('is-handing-over');
      document.body.classList.add('is-handing-over');
      intro.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-in-out', fill: 'forwards' })
        .finished.then(() => {
          intro.remove();
          showPage();
          document.documentElement.classList.remove('is-handing-over');
        document.body.classList.remove('is-handing-over');
          unlockWhenRevealed();
        });
    }
  }

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
