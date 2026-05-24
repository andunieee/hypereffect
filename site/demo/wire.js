// Pieces shared by the demo and the Components page: rows that show protocol
// lines the way the Wire pane does, and the outline that pairs a rendered
// component with the messages about it.

const ARROWS = { up: '→', down: '←', diag: '!' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function summary(tag, b) {
  if (!b) return ['', ''];
  switch (tag) {
    case 'element': return [`#${b.id}`, ` ${b.type}${b.parent ? ` in #${b.parent}` : ''}`];
    case 'remove': return [`#${b.id}`, ''];
    case 'action': return [b.name, Object.hasOwn(b, 'payload') ? ` payload ${JSON.stringify(b.payload)}` : ''];
    case 'signal': return ['', Object.keys(b).join(', ')];
    case 'hello': return ['', 'start session'];
    default: return ['', ''];
  }
}

// A row for one line. `kind` is 'up' (renderer to server), 'down' or 'diag'.
// Returns { row, tag, body }; body is null if the JSON does not parse.
export function wireRow(kind, line) {
  let tag = null;
  let body = null;
  if (kind !== 'diag') {
    const sp = line.indexOf(' ');
    tag = line.slice(0, sp);
    try { body = JSON.parse(line.slice(sp + 1)); } catch { body = null; }
  }
  const row = el('div', `entry ${kind}${tag ? ` t-${tag}` : ''}`);
  if (body && (tag === 'element' || tag === 'remove')) row.dataset.id = body.id;
  const arrow = el('span', 'arrow', ARROWS[kind]);
  arrow.title = { up: 'renderer → server', down: 'server → renderer', diag: 'diagnostic' }[kind];
  if (kind === 'diag') {
    row.append(arrow, el('span', 'raw', line));
  } else {
    const [main, rest] = summary(tag, body);
    row.append(arrow, el('span', 'tag', tag), el('span', 'what', main), el('span', 'rest', rest),
      el('span', 'raw', line.slice(tag.length + 1)));
  }
  return { row, tag, body };
}

// Outlines components inside `frame` (a positioned element around the
// renderer's surface) and marks the rows in `log` that are about them.
export class Pairing {
  constructor({ surface, frame, log, session }) {
    Object.assign(this, { surface, frame, log, session });
    this.outline = el('div', 'he-outline');
    this.outline.hidden = true;
    this.outline.append(el('span', 'he-outline-tag'));
    frame.append(this.outline);
    this.hovered = null;
  }

  // The component element under `node`, if it is in this surface.
  componentAt(node) {
    const t = node instanceof Element ? node.closest('[data-id]') : null;
    return t && this.surface.contains(t) ? t : null;
  }

  // Outlines component `id` and marks the rows about it. Returns the rows.
  pair(id) {
    this.unmark();
    const sel = CSS.escape(id ?? '');
    const target = id != null && this.surface.querySelector(`[data-id="${sel}"]`);
    if (!target || target.hidden || !target.getClientRects().length) {
      this.hovered = null;
      this.outline.hidden = true;
      return [];
    }
    this.hovered = target;
    this.place(target, `#${id} · ${this.session.get(id)?.type ?? '?'}`);
    const rows = [...this.log.querySelectorAll(`.entry[data-id="${sel}"], .entry[data-source="${sel}"]`)];
    for (const r of rows) r.classList.add('match');
    return rows;
  }

  place(target, label) {
    // A modal dialog is in the top layer, so the outline has to go inside it.
    const host = target.closest('dialog[open]:modal') ?? this.frame;
    if (this.outline.parentElement !== host) host.append(this.outline);
    const r = target.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    Object.assign(this.outline.style, {
      left: `${r.left - hr.left - host.clientLeft + host.scrollLeft - 3}px`,
      top: `${r.top - hr.top - host.clientTop + host.scrollTop - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
    });
    this.outline.firstElementChild.textContent = label;
    this.outline.hidden = false;
  }

  unmark() {
    for (const r of this.log.querySelectorAll('.entry.match')) r.classList.remove('match');
  }

  hide() {
    this.hovered = null;
    this.outline.hidden = true;
    if (this.outline.parentElement !== this.frame) this.frame.append(this.outline);
    this.unmark();
  }
}
