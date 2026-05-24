// Explains one protocol message for the Message pane: what it does, its JSON
// with the interesting parts highlighted, and a breakdown of its members.
// Anything carrying `data-ref` is an element id the page pairs with the
// rendered component on hover.

import { COMPONENTS, isCel } from './lib/index.js';

const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return el;
};

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const STRUCTURAL = new Set(['id', 'type', 'parent', 'before']);

// --- JSON with highlights ---------------------------------------------------

// Renders `v` as indented JSON. `mark(path, value)` may return a class name
// (and optionally a data-ref) for the span wrapping the value at `path`.
export function json(v, mark = () => null) {
  const pre = h('pre', { class: 'json' });
  pre.append(node(v, [], 0, mark));
  return pre;
}

function node(v, path, depth, mark) {
  const m = mark(path, v);
  const out = h('span', m ? { class: m.cls, dataset: m.ref ? { ref: m.ref } : {} } : {});
  if (Array.isArray(v) || isObj(v)) {
    const arr = Array.isArray(v);
    const keys = arr ? v.map((_, i) => i) : Object.keys(v);
    if (!keys.length) { out.append(arr ? '[]' : '{}'); return out; }
    const inline = depth > 0 && JSON.stringify(v).length <= 48;
    const pad = (d) => (inline ? '' : '\n' + '  '.repeat(d));
    out.append(arr ? '[' : '{');
    keys.forEach((k, i) => {
      out.append(pad(depth + 1));
      if (!arr) out.append(h('span', { class: 'hl-key' }, JSON.stringify(k)), ': ');
      out.append(node(v[k], [...path, k], depth + 1, mark));
      if (i < keys.length - 1) out.append(inline ? ', ' : ',');
    });
    out.append(pad(depth), arr ? ']' : '}');
    return out;
  }
  out.append(h('span', { class: typeof v === 'string' ? 'hl-str' : 'hl-num' }, JSON.stringify(v)));
  return out;
}

const brief = (v) => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 60 ? s.slice(0, 57) + '…' : s;
};

// --- pieces -----------------------------------------------------------------

const ref = (id, cls = 'ref') => h('code', { class: `chip ${cls}`, dataset: { ref: id }, tabindex: '0' }, `#${id}`);
const section = (title, ...kids) => h('section', { class: 'd-section' }, h('h3', {}, title), ...kids);
const row = (k, ...v) => h('div', { class: 'd-row' }, h('div', { class: 'd-key' }, k), h('div', { class: 'd-val' }, ...v));

function describeHandler(hd) {
  const parts = [];
  if (hd.action) parts.push(h('div', {}, 'Sends action ', h('code', { class: 'chip action' }, hd.action)));
  if (Object.hasOwn(hd, 'payload')) parts.push(h('div', { class: 'd-payload-inline' }, 'with payload ', json(hd.payload)));
  if (hd.patch) parts.push(h('div', {}, 'Applies a local patch first ', json(hd.patch)));
  if (hd.indicator) parts.push(h('div', {}, 'Sets indicator ', h('code', {}, hd.indicator), ' to true until the server clears it'));
  return parts;
}

// --- per message ------------------------------------------------------------

// `e` is a wire entry: { kind, tag, body, line, existed, source, diags }.
// `session` is used to show current values of expressions and bindings.
export function inspect(e, session) {
  const root = h('div', { class: `d t-${e.tag ?? 'diag'}` });
  if (e.kind === 'diag') {
    root.append(h('div', { class: 'd-head' }, h('span', { class: 'chip tag' }, 'diagnostic')),
      h('p', { class: 'd-sentence' }, e.line),
      h('p', { class: 'meta' }, 'Reported by the renderer library, not sent over the wire.'));
    return root;
  }
  root.append(h('div', { class: 'd-head' },
    h('span', { class: 'chip tag' }, e.tag),
  ));

  const body = e.body;
  if (!body) {
    root.append(h('p', { class: 'd-sentence bad' }, 'This line could not be parsed.'), h('pre', { class: 'json' }, e.line));
    return root;
  }

  const build = { element, remove, signal, action, hello }[e.tag];
  if (build) build(root, body, e, session);

  if (e.diags.length) {
    root.append(section('Renderer diagnostics', ...e.diags.map((d) => h('p', { class: 'd-diag' }, d))));
  }
  return root;
}

function element(root, b, e, s) {
  const exists = s.has(b.id);
  const where = b.parent ? ['inside ', ref(b.parent)] : ['at the root'];
  const before = b.before ? [', before ', ref(b.before)] : [];
  root.append(h('p', { class: 'd-sentence' },
    e.existed ? 'Replaces the existing ' : 'Creates a new ',
    h('a', { class: 'type', href: `../components.html#${b.type}` }, h('strong', {}, b.type)), ' element ', ref(b.id, 'id'), ' ', ...where, ...before,
    exists ? null : h('span', { class: 'gone' }, ' It is no longer in the tree.'),
  ));

  const attrs = Object.keys(b).filter((k) => !STRUCTURAL.has(k));
  const spec = COMPONENTS[b.type] ?? {};
  if (attrs.length) {
    root.append(section('Attributes', ...attrs.map((k) => {
      const v = b[k];
      const t = spec[k]?.type;
      if (t === 'handler' && isObj(v)) return row(k, ...describeHandler(v));
      if (t === 'path') {
        return row(k, 'Two-way bound to ', h('code', { class: 'chip signal' }, `signals.${v}`),
          h('span', { class: 'now' }, `now ${brief(s.value(v))}`));
      }
      if (isCel(v)) {
        return row(k, h('code', { class: 'cel' }, v.cel),
          exists ? h('span', { class: 'now' }, `now ${brief(s.attr(b.id, k))}`) : null);
      }
      return row(k, h('code', {}, JSON.stringify(v)));
    })));
  }

  root.append(section('Message', json(b, (p, v) => {
    if (p.length === 1 && p[0] === 'id') return { cls: 'mk-id', ref: b.id };
    if (p.length === 1 && (p[0] === 'parent' || p[0] === 'before')) return { cls: 'mk-ref', ref: v };
    if (p.length === 1 && spec[p[0]]?.type === 'handler') return { cls: 'mk-handler' };
    if (isCel(v)) return { cls: 'mk-cel' };
    return null;
  })));
}

function remove(root, b, e, s) {
  root.append(h('div', { class: 'd-title' }, ref(b.id, 'id big')));
  root.append(h('p', { class: 'd-sentence' },
    e.existed ? 'Removes ' : 'Asks to remove ', ref(b.id, 'id'), ' and all its descendants',
    e.existed ? '.' : '; no element had that id, so nothing happened.'));
  root.append(section('Message', json(b, (p) => (p.length === 1 && p[0] === 'id' ? { cls: 'mk-id', ref: b.id } : null))));
}

// Leaf changes of a merge patch, as [path, value] with null meaning deleted.
function leaves(patch, path = []) {
  if (!isObj(patch) || !Object.keys(patch).length) return [[path, patch]];
  return Object.entries(patch).flatMap(([k, v]) => (isObj(v) ? leaves(v, [...path, k]) : [[[...path, k], v]]));
}

function changes(patch) {
  return h('div', { class: 'd-changes' }, ...leaves(patch).map(([p, v]) => {
    const local = p.some((k) => String(k).startsWith('_'));
    return h('div', { class: 'd-change' },
      h('code', { class: 'chip signal' }, p.join('.')),
      h('span', { class: 'arrow' }, '→'),
      v === null ? h('span', { class: 'deleted' }, 'deleted') : json(v),
      local ? h('span', { class: 'chip local' }, 'local') : null);
  }));
}

function signal(root, b) {
  const n = leaves(b).length;
  root.append(h('p', { class: 'd-sentence' }, `Changes ${n} signal${n === 1 ? '' : 's'}.`));
  root.append(section('Changes', changes(b)));
  root.append(section('Message', json(b, (p) => (String(p.at(-1) ?? '').startsWith('_') ? { cls: 'mk-local' } : null))));
}

function action(root, b, e) {
  root.append(h('div', { class: 'd-title' }, h('code', { class: 'chip action big' }, b.name)));
  root.append(h('p', { class: 'd-sentence' }, ...(e.source
    ? ['Triggered by ', ref(e.source.id), ' through its ', h('code', {}, e.source.event), ' handler.']
    : ['Sent by a handler.'])));
  root.append(section('Payload', Object.hasOwn(b, 'payload')
    ? h('div', { class: 'd-payload' }, json(b.payload))
    : h('p', { class: 'meta' }, 'None: the handler has no payload, so the server identifies what happened from the name and the signals.')));
  root.append(section('Signals sent', json(b.signals ?? {})));
  root.append(section('Message', json(b, (p) => {
    if (p.length === 1 && p[0] === 'payload') return { cls: 'mk-payload' };
    if (p.length === 1 && p[0] === 'name') return { cls: 'mk-name' };
    return null;
  })));
}

function hello(root, b) {
  root.append(h('p', { class: 'd-sentence' }, 'Opens the session. The server answers with the interface.'));
  root.append(section('Initial signals', json(b.signals ?? {})));
}
