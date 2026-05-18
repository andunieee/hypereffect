import { Session } from './lib/index.js';
import { DomRenderer } from './renderer.js';
import { WasmServer, Delay } from './transport.js';

const SRC = 'https://github.com/andunieee/hypereffect/blob/master/rust/demos';
const DEMOS = {
  counter: 'Counter',
  todos: 'Tasks',
  timer: 'Timer',
};
const MAX_LOG = 400;

const $ = (id) => document.getElementById(id);
const surface = $('surface');
const log = $('log');
const signalsView = $('signals');
const picker = $('picker');
const latency = $('latency');
const connectBtn = $('connect');
const source = $('source');

const servers = new Map();
let current = null; // { name, server, up, down }
let selected = 'counter';
let redraw = 0;

const session = new Session({
  send: (line) => current?.up.push(line),
  onUpdate: (u) => {
    renderer.update(u);
    if (!redraw) redraw = requestAnimationFrame(showSignals);
    if (u.connection) connectBtn.textContent = session.connected ? 'Disconnect' : 'Reconnect';
  },
  onDiagnostic: (msg) => append('diag', '!', msg),
});
const renderer = new DomRenderer(session, surface);

function showSignals() {
  redraw = 0;
  signalsView.textContent = JSON.stringify(session.signals, null, 2);
}

function append(kind, arrow, text) {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const sp = line.indexOf(' ');
    const row = document.createElement('div');
    row.className = `entry ${kind}`;
    const a = document.createElement('span');
    a.className = 'arrow';
    a.textContent = arrow;
    a.title = { up: 'renderer → server', down: 'server → renderer', diag: 'diagnostic' }[kind];
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = kind === 'diag' ? '' : line.slice(0, sp);
    row.append(a, tag, kind === 'diag' ? line : line.slice(sp));
    log.append(row);
  }
  while (log.childElementCount > MAX_LOG) log.firstElementChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

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
  append('diag', '×', 'transport closed');
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
    renderer.banner.textContent = `Could not load the ${DEMOS[name]} server. Build the demos with scripts/build-demo.sh.`;
    append('diag', '!', `could not load wasm/${name}.wasm (${e.message}). Run scripts/build-demo.sh to build the demos.`);
    return;
  }
  renderer.banner.textContent = 'Disconnected';
  const up = new Delay((text) => { append('up', '→', text); server.write(text); });
  const down = new Delay((text) => { append('down', '←', text); session.receive(text); });
  up.ms = down.ms = Number(latency.value) / 2;
  server.onData = (text) => down.push(text);
  current = { name, server, up, down };
  // Local signals in hello are kept by the renderer and not sent.
  session.start({ host: 'browser', _theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' });
}

function select(name) {
  if (!DEMOS[name]) name = 'counter';
  selected = name;
  for (const b of picker.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.demo === name ? 'true' : 'false');
  source.href = `${SRC}/${name}/src/lib.rs`;
  log.replaceChildren();
  connect(name);
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

connectBtn.addEventListener('click', () => {
  if (current) disconnect();
  else connect(selected);
});

$('clear-log').addEventListener('click', () => log.replaceChildren());

select(location.hash.slice(1));
