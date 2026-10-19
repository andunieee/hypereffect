// The renderer side of a hypereffect session, without any drawing: it keeps
// the element tree and the signals, evaluates expressions, runs handlers and
// reports what changed so that a UI layer can redraw.

import { compile, fromJson, toJson, typeName, CelError, Uint } from './cel.js';
import { COMPONENTS, accepts } from './components.js';
import {
  LineReader, encodeLine, parseLine, isObject, isCel, mergePatch, stripLocal,
  parsePath, pathPatch, getPath, overlaps,
} from './protocol.js';

const ROOT = '';
const STRUCTURAL = new Set(['id', 'type', 'parent', 'before']);

export class Session {
  // options:
  //   send(line)        writes a line (with its line feed) to the transport
  //   onUpdate(update)  called after each batch of changes, see flush()
  //   onDiagnostic(msg) receives problems with messages and expressions
  constructor({ send, onUpdate = () => {}, onDiagnostic = (m) => console.warn('hypereffect:', m) } = {}) {
    this.send = send;
    this.onUpdate = onUpdate;
    this.diag = onDiagnostic;
    this.reader = new LineReader();
    this.nodes = new Map();
    this.root = [];
    this.signals = {};
    this.connected = false;
    this._cel = null;
    this._stale = false;
    this._resetPending = false;
    this._scheduled = false;
    this._clear();
  }

  // --- transport -----------------------------------------------------------

  // Begins a session: sends hello, which carries no signals.
  start() {
    this.reader = new LineReader();
    this.connected = true;
    this._resetPending = true;
    this.send(encodeLine('hello', {}));
    if (this.nodes.size === 0) this._reset();
    this._changed.connection = true;
    this._schedule();
  }

  // Feeds text received from the transport.
  receive(chunk) {
    for (const line of this.reader.push(chunk)) this.receiveLine(line);
  }

  receiveLine(line) {
    let msg;
    try { msg = parseLine(line); } catch (e) {
      this.diag(`ignored line: ${e.message}`);
      return;
    }
    this.receiveMessage(msg.tag, msg.body);
  }

  // Processes one message given as a tag and a parsed JSON object. This is
  // the in-process transport.
  receiveMessage(tag, body) {
    if (this._resetPending) this._reset();
    switch (tag) {
      case 'element': this._element(body); break;
      case 'remove': this._remove(body); break;
      case 'signal': this._patch(body); break;
      default: this.diag(`ignored message with unknown tag '${tag}'`);
    }
    this._schedule();
  }

  // Marks the transport closed. The tree is kept for display.
  close() {
    this.connected = false;
    this._changed.connection = true;
    this._schedule();
  }

  // --- reading the tree ----------------------------------------------------

  // Ids of the children of `id`, or of the root.
  children(id = null) {
    if (id === null || id === ROOT) return this.root;
    return this.nodes.get(id)?.children ?? [];
  }

  has(id) { return this.nodes.has(id); }

  // The element with all attributes resolved: expressions evaluated, values
  // checked against the attribute types, and defaults filled in.
  get(id) {
    const n = this.nodes.get(id);
    if (!n) return null;
    const attrs = {};
    for (const name of Object.keys(COMPONENTS[n.type])) attrs[name] = this.attr(id, name);
    return { id, type: n.type, parent: n.parent, children: [...n.children], attrs };
  }

  // One resolved attribute.
  attr(id, name) {
    const n = this.nodes.get(id);
    const spec = COMPONENTS[n.type][name];
    if (!spec) return undefined;
    if (spec.type === 'path' || spec.type === 'handler') return n.el[name] ?? null;
    const def = spec.def === undefined ? id : spec.def;
    if (!Object.hasOwn(n.el, name)) return def;
    const raw = n.el[name];
    let v;
    if (isCel(raw)) {
      const prog = n.progs.get(name);
      if (!prog) return def;
      try { v = prog.eval(this._celSignals()); } catch (e) {
        if (!(e instanceof CelError)) throw e;
        this.diag(`${id}.${name}: ${e.message}`);
        return def;
      }
    } else {
      if (raw === null) return def;
      v = fromJson(raw);
    }
    try {
      return check(spec.type, v, def);
    } catch (e) {
      if (!(e instanceof CelError)) throw e;
      this.diag(`${id}.${name}: ${e.message}`);
      return def;
    }
  }

  // The whole tree, resolved, as nested objects. Mostly useful for tests.
  tree(ids = this.root) {
    return ids.map((id) => {
      const r = this.get(id);
      return { id, type: r.type, attrs: r.attrs, children: this.tree(r.children) };
    });
  }

  // The value at a signal path (given as a string or an array of segments).
  value(path) {
    return getPath(this.signals, typeof path === 'string' ? parsePath(path) : path);
  }

  // --- user input ----------------------------------------------------------

  // Writes a value at a signal path, as a control with bind does.
  write(path, value) {
    const segs = typeof path === 'string' ? parsePath(path) : path;
    if (!segs) return;
    this._patch(pathPatch(segs, value));
    this._schedule();
  }

  // Runs the handler in attribute `event` of element `id`, following section
  // 10 of the spec. Returns whether it ran.
  trigger(id, event) {
    const n = this.nodes.get(id);
    const h = n && COMPONENTS[n.type][event]?.type === 'handler' ? n.el[event] : null;
    if (!h) return false;
    for (let a = id; a !== null; a = this.nodes.get(a).parent) {
      if (!this.attr(a, 'visible')) return false;
      if (COMPONENTS[this.nodes.get(a).type].disabled && this.attr(a, 'disabled')) return false;
    }
    if (h.patch) {
      this._patch(this._evalPatch(h.patch, `${id}.${event}`));
    }
    if (h.action && this.connected) {
      if (h.indicator) this._patch(pathPatch(parsePath(h.indicator), true));
      const msg = { name: h.action };
      if (Object.hasOwn(h, 'payload')) msg.payload = h.payload;
      msg.signals = stripLocal(this.signals);
      this.send(encodeLine('action', msg));
    }
    this._schedule();
    return true;
  }

  // --- batching ------------------------------------------------------------

  // Delivers pending changes to onUpdate now. Normally this happens on a
  // microtask after each batch of input. The update has:
  //   reset       the tree was discarded (a new session began)
  //   created     ids whose widgets must be built anew (new, or type changed)
  //   updated     ids whose resolved attributes may have changed
  //   removed     ids no longer in the tree
  //   reordered   ids whose list of children changed ('' for the root)
  //   connection  the connected state changed
  flush() {
    this._scheduled = false;
    const c = this._changed;
    if (c.paths.length) {
      for (const [id, n] of this.nodes) {
        if (c.updated.has(id)) continue;
        if (n.deps.some((d) => c.paths.some((p) => overlaps(d, p)))) c.updated.add(id);
      }
    }
    // Tabs and lists present facts about their children (labels, visibility).
    for (const id of [...c.updated, ...c.reordered]) {
      const p = id === ROOT ? null : this.nodes.get(id)?.parent;
      const pt = p && this.nodes.get(p)?.type;
      if (pt === 'tabs' || pt === 'list') c.updated.add(p);
      const t = this.nodes.get(id)?.type;
      if (t === 'tabs' || t === 'list') c.updated.add(id);
    }
    for (const id of c.removed) { c.updated.delete(id); c.created.delete(id); }
    this._clear();
    const empty = !c.reset && !c.connection && !c.created.size && !c.updated.size && !c.removed.size && !c.reordered.size;
    if (!empty) {
      delete c.paths;
      this.onUpdate(c);
    }
  }

  // --- internals -----------------------------------------------------------

  _clear() {
    this._changed = {
      reset: false, connection: false, created: new Set(), updated: new Set(),
      removed: new Set(), reordered: new Set(), paths: [],
    };
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    queueMicrotask(() => { if (this._scheduled) this.flush(); });
  }

  _reset() {
    this._resetPending = false;
    for (const id of this.nodes.keys()) this._changed.removed.add(id);
    this.nodes.clear();
    this.root = [];
    this.signals = {};
    this._cel = null;
    this._changed.reset = true;
    this._changed.reordered.add(ROOT);
    this._changed.paths.push([]);
  }

  _celSignals() {
    if (!this._cel) this._cel = fromJson(this.signals);
    return this._cel;
  }

  _patch(patch) {
    if (!isObject(patch)) {
      this.diag('ignored signal message: not an object');
      return;
    }
    this.signals = mergePatch(this.signals, patch, this._changed.paths);
    this._cel = null;
  }

  _evalPatch(patch, where) {
    const out = {};
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (isCel(v)) {
        try { out[k] = toJson(compile(v.cel).eval(this._celSignals())); } catch (e) {
          if (!(e instanceof CelError)) throw e;
          this.diag(`${where}.patch.${k}: ${e.message}`);
        }
      } else if (isObject(v)) {
        out[k] = this._evalPatch(v, `${where}.${k}`);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  _reject(el, why) {
    this.diag(`rejected element ${JSON.stringify(el.id ?? null)}: ${why}`);
  }

  _element(el) {
    const { id, type } = el;
    if (typeof id !== 'string' || id === '') return this._reject(el, 'id must be a non-empty string');
    if (!Object.hasOwn(COMPONENTS, type)) return this._reject(el, `unknown type ${JSON.stringify(type)}`);
    const schema = COMPONENTS[type];
    for (const k of Object.keys(el)) {
      const spec = schema[k];
      const structural = STRUCTURAL.has(k) || spec?.type === 'path' || spec?.type === 'handler';
      if (structural && isCel(el[k])) return this._reject(el, `${k} cannot be an expression`);
    }
    for (const k of ['parent', 'before']) {
      if (Object.hasOwn(el, k) && typeof el[k] !== 'string') return this._reject(el, `${k} must be a string`);
    }
    for (const [k, spec] of Object.entries(schema)) {
      if (!Object.hasOwn(el, k)) continue;
      if (spec.type === 'path' && !parsePath(el[k])) return this._reject(el, `${k} is not a signal path`);
      if (spec.type === 'handler' && !validHandler(el[k])) return this._reject(el, `${k} is not a valid handler`);
    }
    const parent = el.parent ?? null;
    if (parent !== null && !this.nodes.has(parent)) return this._reject(el, `parent ${JSON.stringify(parent)} does not exist`);
    if (!accepts(parent && this.nodes.get(parent).type, type)) {
      return this._reject(el, `${parent ? this.nodes.get(parent).type : 'the root'} cannot contain ${type}`);
    }
    if (parent !== null && this.nodes.has(id)) {
      for (let a = parent; a !== null; a = this.nodes.get(a).parent) {
        if (a === id) return this._reject(el, 'an element cannot be inside itself');
      }
    }

    const node = {
      id, type, parent, el,
      children: [], progs: new Map(), deps: [],
    };
    for (const [k, spec] of Object.entries(schema)) {
      if (spec.type === 'path' && Object.hasOwn(el, k)) node.deps.push(parsePath(el[k]));
      if (!isCel(el[k])) continue;
      try {
        const prog = compile(el[k].cel);
        node.progs.set(k, prog);
        node.deps.push(...prog.paths);
      } catch (e) {
        if (!(e instanceof CelError)) throw e;
        this.diag(`${id}.${k}: ${e.message}`);
      }
    }

    const c = this._changed;
    const old = this.nodes.get(id);
    if (!old) {
      this.nodes.set(id, node);
      this._insert(id, parent, el.before);
      c.created.add(id);
      c.removed.delete(id);
    } else {
      if (old.type === type) {
        node.children = old.children;
      } else {
        for (const ch of [...old.children]) this._removeTree(ch);
        node.children = [];
        c.created.add(id);
      }
      this.nodes.set(id, node);
      const siblings = this.children(old.parent);
      if (old.parent !== parent) {
        siblings.splice(siblings.indexOf(id), 1);
        c.reordered.add(old.parent ?? ROOT);
        this._insert(id, parent, el.before);
      } else if (typeof el.before === 'string' && el.before !== id && siblings.includes(el.before)) {
        siblings.splice(siblings.indexOf(id), 1);
        siblings.splice(siblings.indexOf(el.before), 0, id);
        c.reordered.add(parent ?? ROOT);
      }
    }
    c.updated.add(id);
  }

  _insert(id, parent, before) {
    const list = this.children(parent);
    const i = typeof before === 'string' ? list.indexOf(before) : -1;
    if (i >= 0) list.splice(i, 0, id); else list.push(id);
    this._changed.reordered.add(parent ?? ROOT);
  }

  _remove(body) {
    const n = this.nodes.get(body.id);
    if (!n) return;
    const list = this.children(n.parent);
    list.splice(list.indexOf(body.id), 1);
    this._changed.reordered.add(n.parent ?? ROOT);
    this._removeTree(body.id);
  }

  _removeTree(id) {
    const n = this.nodes.get(id);
    for (const ch of n.children) this._removeTree(ch);
    this.nodes.delete(id);
    const c = this._changed;
    c.removed.add(id);
    c.created.delete(id);
    c.updated.delete(id);
    c.reordered.delete(id);
  }
}

function validHandler(h) {
  if (!isObject(h)) return false;
  const hasPatch = Object.hasOwn(h, 'patch');
  const hasAction = Object.hasOwn(h, 'action');
  if (!hasPatch && !hasAction) return false;
  if (hasPatch && !isObject(h.patch)) return false;
  if (hasAction && (typeof h.action !== 'string' || h.action === '')) return false;
  if (Object.hasOwn(h, 'indicator')) {
    const p = parsePath(h.indicator);
    if (!hasAction || !p || !p[0].startsWith('_')) return false;
  }
  return true;
}

// Checks a CEL value against an attribute type (spec section 9.3) and
// returns it as a plain JavaScript value.
function check(type, v, def) {
  if (Array.isArray(type)) {
    if (typeof v !== 'string') throw new CelError(`expected a string, got ${typeName(v)}`);
    return type.includes(v, 1) ? v : def;
  }
  switch (type) {
    case 'string':
      if (typeof v !== 'string') throw new CelError(`expected a string, got ${typeName(v)}`);
      return v;
    case 'bool':
      if (typeof v !== 'boolean') throw new CelError(`expected a bool, got ${typeName(v)}`);
      return v;
    case 'number?':
      if (v === null) return null;
    // fall through
    case 'number':
      if (typeof v === 'number') return v;
      if (typeof v === 'bigint') return Number(v);
      if (v instanceof Uint) return Number(v.value);
      throw new CelError(`expected a number, got ${typeName(v)}`);
    case 'options': {
      if (!Array.isArray(v)) throw new CelError(`expected a list, got ${typeName(v)}`);
      return v.map((o) => {
        const ok = typeName(o) === 'map' && !(o instanceof Map) && typeof o.value === 'string' && typeof o.label === 'string';
        if (!ok) throw new CelError('options must be objects with string value and label');
        return { value: o.value, label: o.label };
      });
    }
  }
  throw new CelError(`unknown attribute type ${type}`);
}
