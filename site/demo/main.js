import { Session, LineReader } from './lib/index.js';
import { DomRenderer, openUrl } from './renderer.js';
import { WasmServer, Delay } from './transport.js';
import { inspect } from './inspect.js';
import { wireRow, Pairing } from './wire.js';

const SRC = 'https://github.com/hypereffect/hypereffect/blob/master/rust/demos';
const DEMOS = {
  todos: 'Tasks',
  qr: 'QR code',
  monitor: 'Temperature monitor',
  hotel: 'Hotel booking',
};
const MAX_LOG = 400;

const $ = (id) => document.getElementById(id);
const surface = $('surface');
const frame = $('frame');
const log = $('log');
const detail = $('detail');
const signalsView = $('signals');
const picker = $('picker');
const latency = $('latency');
const source = $('source');

const servers = new Map();
let current = null; // { name, server, up, down }
let redraw = 0;

// Wire entries by their row in the log.
const entries = new WeakMap();
let chosen = null; // the selected row
let receiving = null; // the entry being processed, to attach diagnostics to
let triggering = null; // the handler running now, to credit actions to

const session = new Session({
  send: (line) => current?.up.push({ line, source: triggering }),
  onUpdate: (u) => {
    renderer.update(u);
    if (!redraw) redraw = requestAnimationFrame(showSignals);
    if (pairing.hovered && !pairing.hovered.isConnected) pairing.hide();
  },
  onDiagnostic: (msg) => {
    receiving?.diags.push(msg);
    receiving?.row.classList.add('has-diag');
    append('diag', msg);
  },
  onOpen: (url) => {
    if (!openUrl(url)) append('diag', `refused to open ${url}`);
  },
});
const renderer = new DomRenderer(session, surface);
const pairing = new Pairing({ surface, frame, log, session });

// Remember which element and event caused an action.
const trigger = session.trigger.bind(session);
session.trigger = (id, event) => {
  triggering = { id, event };
  try { return trigger(id, event); } finally { triggering = null; }
};

function showSignals() {
  redraw = 0;
  signalsView.textContent = JSON.stringify(session.signals, null, 2);
}

// --- the wire log -----------------------------------------------------------

function append(kind, line, extra = {}) {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const { row, tag, body } = wireRow(kind, line);
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');
  row.tabIndex = -1;
  const e = { kind, tag, body, line, row, diags: [], source: null, existed: false, ...extra };
  if (e.source) row.dataset.source = e.source.id;
  entries.set(row, e);
  log.append(row);
  while (log.childElementCount > MAX_LOG) log.firstElementChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
  return e;
}

// Scrolls the log, but not the page, so that `row` is visible.
function scrollLog(row, center = false) {
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (top >= log.scrollTop && bottom <= log.scrollTop + log.clientHeight) return;
  log.scrollTop = center ? top - log.clientHeight / 2 : top < log.scrollTop ? top : bottom - log.clientHeight;
}

function choose(row, focus = false) {
  if (chosen) chosen.setAttribute('aria-selected', 'false');
  chosen = row;
  if (!row) return;
  row.setAttribute('aria-selected', 'true');
  if (focus) row.focus({ preventScroll: true });
  scrollLog(row);
  detail.replaceChildren(inspect(entries.get(row), session));
  detail.scrollTop = 0;
}

log.addEventListener('click', (ev) => {
  const row = ev.target.closest('.entry');
  if (row) choose(row, true);
});

log.addEventListener('keydown', (ev) => {
  const step = { ArrowDown: 1, ArrowUp: -1, j: 1, k: -1 }[ev.key];
  if (!step) return;
  ev.preventDefault();
  const next = chosen?.isConnected
    ? (step > 0 ? chosen.nextElementSibling : chosen.previousElementSibling)
    : log.lastElementChild;
  if (next) choose(next, true);
});

// --- pairing components with messages --------------------------------------

const pair = (id) => pairing.pair(id);
const hideOutline = () => pairing.hide();
const componentAt = (node) => pairing.componentAt(node);

// Hovering a component shows its id; hovering an id in the log or the
// message pane shows the component.
document.addEventListener('mouseover', (ev) => {
  const refEl = ev.target.closest?.('[data-ref], .entry[data-id], .entry[data-source]');
  if (refEl && !surface.contains(refEl)) {
    pair(refEl.dataset.ref ?? refEl.dataset.id ?? refEl.dataset.source);
    return;
  }
  const c = componentAt(ev.target);
  if (!c) return;
  pair(c.dataset.id);
  // Bring the latest message about it into view, without moving the page.
  const m = [...log.querySelectorAll('.entry.match')].at(-1);
  if (m) scrollLog(m, true);
});
document.addEventListener('mouseout', (ev) => {
  const to = ev.relatedTarget;
  if (to && (componentAt(to) || to.closest?.('[data-ref], .entry[data-id], .entry[data-source]'))) return;
  hideOutline();
});
document.addEventListener('focusin', (ev) => {
  if (ev.target.dataset?.ref) pair(ev.target.dataset.ref);
});
addEventListener('resize', hideOutline);
frame.addEventListener('scroll', hideOutline, true);

// Clicking an id in the message pane flashes the component.
detail.addEventListener('click', (ev) => {
  const r = ev.target.closest('[data-ref]');
  if (!r) return;
  pair(r.dataset.ref);
  if (pairing.hovered) {
    pairing.hovered.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const o = pairing.outline;
    o.classList.remove('flash');
    void o.offsetWidth;
    o.classList.add('flash');
  }
});

// --- connection -------------------------------------------------------------

async function serverFor(name) {
  if (!servers.has(name)) servers.set(name, WasmServer.load(`wasm/${name}.wasm`));
  return servers.get(name);
}

function disconnect() {
  if (!current) return;
  current.up.close();
  current.down.close();
  current.server.onData = () => {};
  current.server.close();
  session.close();
  current = null;
}

async function connect(name) {
  disconnect();
  let server;
  try {
    server = await serverFor(name);
  } catch (e) {
    servers.delete(name);
    renderer.banner.hidden = false;
    renderer.banner.textContent = `Could not load the ${DEMOS[name]} server. Build the demos with just build-demo.`;
    append('diag', `could not load wasm/${name}.wasm (${e.message}). Run just build-demo to build the demos.`);
    return;
  }
  renderer.banner.textContent = 'Disconnected';
  const reader = new LineReader();
  const up = new Delay(({ line, source: src }) => {
    for (const l of line.split('\n')) if (l) append('up', l, { source: src });
    server.write(line);
  });
  const down = new Delay((text) => {
    for (const l of reader.push(text)) {
      const e = append('down', l);
      // After a reconnect the session drops the old tree on the first message.
      if (e.body && (e.tag === 'element' || e.tag === 'remove')) e.existed = !session._resetPending && session.has(e.body.id);
      receiving = e;
      try { session.receiveLine(l); } finally { receiving = null; }
    }
  });
  up.ms = down.ms = Number(latency.value) / 2;
  server.onData = (text) => down.push(text);
  current = { name, server, up, down };
  session.start();
}

function select(name) {
  if (!DEMOS[name]) name = 'todos';
  for (const b of picker.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.demo === name ? 'true' : 'false');
  source.href = `${SRC}/${name}/src/lib.rs`;
  clearLog();
  connect(name);
}

function clearLog() {
  log.replaceChildren();
  chosen = null;
}

for (const [name, label] of Object.entries(DEMOS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.demo = name;
  b.textContent = label;
  b.addEventListener('click', () => {
    history.replaceState(null, '', `#${name}`);
    select(name);
  });
  picker.append(b);
}

latency.addEventListener('change', () => {
  if (current) current.up.ms = current.down.ms = Number(latency.value) / 2;
});


select(location.hash.slice(1));
