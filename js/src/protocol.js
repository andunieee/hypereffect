// Framing (spec section 3), merge patch (section 8) and signal paths (8.1).

export function encodeLine(tag, obj) {
  return tag + ' ' + JSON.stringify(obj) + '\n';
}

// Parses one line (without its line feed). Returns {tag, body} or throws.
export function parseLine(line) {
  const m = /^([a-z]+) (.*)$/s.exec(line);
  if (!m) throw new Error('line does not match the grammar');
  const body = JSON.parse(m[2]);
  if (!isObject(body)) throw new Error('message body is not a JSON object');
  return { tag: m[1], body };
}

// Splits a stream of text into lines. Empty lines are dropped and a carriage
// return before the line feed is ignored.
export class LineReader {
  constructor() { this.buf = ''; }

  push(chunk) {
    this.buf += chunk;
    const parts = this.buf.split('\n');
    this.buf = parts.pop();
    const lines = [];
    for (let l of parts) {
      if (l.endsWith('\r')) l = l.slice(0, -1);
      if (l !== '') lines.push(l);
    }
    return lines;
  }
}

export function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isCel(v) {
  return isObject(v) && Object.keys(v).length === 1 && typeof v.cel === 'string';
}

// Applies an RFC 7386 merge patch and returns the new value. Objects in
// `target` are modified in place. Every path whose value may have changed is
// pushed to `changes` (as an array of keys).
export function mergePatch(target, patch, changes = [], path = []) {
  if (!isObject(patch)) {
    changes.push(path);
    return structuredClone(patch);
  }
  if (!isObject(target)) {
    if (path.length) changes.push(path);
    target = {};
  }
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === null) {
      if (Object.hasOwn(target, k)) {
        delete target[k];
        changes.push([...path, k]);
      }
    } else {
      target[k] = mergePatch(target[k], v, changes, [...path, k]);
    }
  }
  return target;
}

// Copies a value without members whose keys begin with "_", at any depth.
export function stripLocal(v) {
  if (Array.isArray(v)) return v.map(stripLocal);
  if (!isObject(v)) return v;
  const out = {};
  for (const k of Object.keys(v)) if (!k.startsWith('_')) out[k] = stripLocal(v[k]);
  return out;
}

const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Parses a signal path such as "form.email" into ["form", "email"], or
// returns null if it is not valid.
export function parsePath(s) {
  if (typeof s !== 'string' || s === '') return null;
  const segs = s.split('.');
  return segs.every((x) => SEGMENT.test(x)) ? segs : null;
}

// The merge patch that writes `value` at `path`.
export function pathPatch(path, value) {
  let p = value;
  for (let i = path.length - 1; i >= 0; i--) p = { [path[i]]: p };
  return p;
}

export function getPath(obj, path) {
  let v = obj;
  for (const k of path) {
    if (!isObject(v) || !Object.hasOwn(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

// Whether a change at path `a` can affect a read of path `b`.
export function overlaps(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
