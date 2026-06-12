// Turns each .sample on a page into a small live session: the messages in
// the sample are shown as wire rows and rendered next to them with the
// demo's renderer. Actions the user triggers appear as rows too; there is no
// server, so nothing answers them. A sample with data-signals also shows the
// current signals, updated as they change.

import { Session } from './demo/lib/index.js';
import { DomRenderer } from './demo/renderer.js';
import { wireRow, Pairing } from './demo/wire.js';

// Dialogs in samples are shown in place, not as page-wide modals.
const showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  if (this.closest('.sample')) this.show();
  else showModal.call(this);
};

const div = (cls) => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

function mount(sample, lines) {
  const surface = div('sample-surface');
  const frame = div('sample-app');
  frame.append(surface);
  const wire = div('sample-wire wire');
  const wirePane = div('sample-wire-pane');
  wirePane.append(wire);
  sample.replaceChildren(frame, wirePane);

  let triggering = null;
  let started = false;
  const add = (kind, line) => {
    const { row } = wireRow(kind, line);
    if (kind === 'up' && triggering) row.dataset.source = triggering;
    wire.append(row);
    if (kind !== 'down') wire.scrollTop = wire.scrollHeight;
    return row;
  };

  const session = new Session({
    send: (text) => {
      if (!started) return; // the hello that opens the session
      for (const l of text.split('\n')) if (l) add('up', l);
    },
    onUpdate: (u) => renderer.update(u),
    onDiagnostic: (msg) => add('diag', msg),
  });
  const renderer = new DomRenderer(session, surface);
  if (sample.hasAttribute('data-signals')) {
    const view = document.createElement('pre');
    view.className = 'sample-signals';
    const side = div('sample-side');
    frame.replaceWith(side);
    side.append(frame, view);
    let last = '';
    const flush = session.flush.bind(session);
    session.flush = () => {
      flush();
      const text = JSON.stringify(session.signals, null, 2);
      if (text === last) return;
      view.textContent = text;
      if (last) {
        view.classList.remove('changed');
        void view.offsetWidth; // restart the animation
        view.classList.add('changed');
      }
      last = text;
    };
  }
  const trigger = session.trigger.bind(session);
  session.trigger = (id, event) => {
    triggering = id;
    try { return trigger(id, event); } finally { triggering = null; }
  };

  session.start({});
  started = true;
  for (const l of lines) {
    add('down', l);
    session.receiveLine(l);
  }

  wire.addEventListener('click', (ev) => ev.target.closest('.entry')?.classList.toggle('open'));
  return new Pairing({ surface, frame, log: wire, session });
}

for (const sample of document.querySelectorAll('.sample')) {
  const src = sample.querySelector('.sample-src');
  const lines = src.textContent.split('\n').filter((l) => l.trim());
  const pairing = mount(sample, lines);
  sample.addEventListener('mouseover', (ev) => {
    const row = ev.target.closest('.entry');
    if (row) {
      pairing.pair(row.dataset.id ?? row.dataset.source ?? null);
      return;
    }
    const c = pairing.componentAt(ev.target);
    if (c) pairing.pair(c.dataset.id);
    else pairing.hide();
  });
  sample.addEventListener('mouseleave', () => pairing.hide());
}
