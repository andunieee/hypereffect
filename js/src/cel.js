// A CEL interpreter: parser and evaluator for the subset of the Common
// Expression Language that hypereffect renderers need (the standard
// definitions, the standard macros and the cel-go strings extension).
// Timestamps, durations, protobuf messages and optional values are not
// supported.
//
// Value representation:
//   int     bigint                      uint    Uint
//   double  number                      string  string
//   bool    boolean                     null    null
//   bytes   Uint8Array                  list    Array
//   map     Map (keys: string, bigint, boolean)
//   type    CelType

export class CelError extends Error {}

export class Uint {
  constructor(v) { this.v = v; }
}

export class CelType {
  constructor(name) { this.name = name; }
  toString() { return this.name; }
}

const T = {};
for (const n of ['int', 'uint', 'double', 'bool', 'string', 'bytes', 'list', 'map', 'null_type', 'type']) {
  T[n] = new CelType(n);
}

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;
const UINT_MAX = 2n ** 64n - 1n;

function int(v) {
  if (v < INT_MIN || v > INT_MAX) throw new CelError('int overflow');
  return v;
}

function uint(v) {
  if (v < 0n || v > UINT_MAX) throw new CelError('uint overflow');
  return new Uint(v);
}

export function typeOf(v) {
  switch (typeof v) {
    case 'bigint': return T.int;
    case 'number': return T.double;
    case 'string': return T.string;
    case 'boolean': return T.bool;
  }
  if (v === null) return T.null_type;
  if (v instanceof Uint) return T.uint;
  if (Array.isArray(v)) return T.list;
  if (v instanceof Map) return T.map;
  if (v instanceof Uint8Array) return T.bytes;
  if (v instanceof CelType) return T.type;
  throw new CelError('unknown value');
}

// ---------------------------------------------------------------------------
// JSON conversion (spec section 9.2)

export function fromJson(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    return Number.isInteger(v) && Math.abs(v) < 2 ** 63 ? BigInt(v) : v;
  }
  if (Array.isArray(v)) return v.map(fromJson);
  if (typeof v === 'object') {
    const m = new Map();
    for (const k of Object.keys(v)) m.set(k, fromJson(v[k]));
    return m;
  }
  throw new CelError('not JSON');
}

export function toJson(v) {
  switch (typeof v) {
    case 'bigint': return Number(v);
    case 'number':
      if (!Number.isFinite(v)) throw new CelError('no JSON representation for ' + v);
      return v;
    case 'string':
    case 'boolean': return v;
  }
  if (v === null) return null;
  if (v instanceof Uint) return Number(v.v);
  if (Array.isArray(v)) return v.map(toJson);
  if (v instanceof Map) {
    const o = {};
    for (const [k, x] of v) {
      if (typeof k !== 'string') throw new CelError('map key is not a string');
      o[k] = toJson(x);
    }
    return o;
  }
  throw new CelError('no JSON representation for ' + typeOf(v));
}

// ---------------------------------------------------------------------------
// Lexer

const PUNCT = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!',
  '?', ':', '.', ',', '(', ')', '[', ']', '{', '}'];
const RESERVED = new Set(['as', 'break', 'const', 'continue', 'else', 'for', 'function', 'if',
  'import', 'let', 'loop', 'package', 'namespace', 'return', 'var', 'void', 'while']);

function lex(src) {
  const toks = [];
  let i = 0;
  const err = (msg) => { throw new CelError(`${msg} at ${i}`); };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const start = i;
    // Numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let m;
      const rest = src.slice(i);
      if ((m = /^0[xX][0-9a-fA-F]+[uU]?/.exec(rest))) {
        i += m[0].length;
        const u = /[uU]$/.test(m[0]);
        const v = BigInt(u ? m[0].slice(0, -1) : m[0]);
        toks.push({ k: u ? 'uint' : 'int', v, pos: start });
      } else if ((m = /^(?:[0-9]+\.[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+|\.[0-9]+(?:[eE][+-]?[0-9]+)?)/.exec(rest))) {
        i += m[0].length;
        toks.push({ k: 'double', v: parseFloat(m[0]), pos: start });
      } else {
        m = /^[0-9]+[uU]?/.exec(rest);
        i += m[0].length;
        const u = /[uU]$/.test(m[0]);
        toks.push({ k: u ? 'uint' : 'int', v: BigInt(u ? m[0].slice(0, -1) : m[0]), pos: start });
      }
      if (/[A-Za-z_]/.test(src[i] || '')) err('bad number');
      continue;
    }
    // Strings and bytes, with optional r/b prefixes
    const pre = /^([rR][bB]?|[bB][rR]?)?(['"])/.exec(src.slice(i, i + 3));
    if (pre && (pre[1] || c === '"' || c === "'")) {
      const flags = (pre[1] || '').toLowerCase();
      const raw = flags.includes('r');
      const bytes = flags.includes('b');
      i += flags.length;
      const q = src[i];
      const triple = src.startsWith(q + q + q, i);
      const delim = triple ? q + q + q : q;
      i += delim.length;
      let out = '';
      for (;;) {
        if (i >= src.length) err('unterminated string');
        if (src.startsWith(delim, i)) { i += delim.length; break; }
        const ch = src[i];
        if (!triple && (ch === '\n' || ch === '\r')) err('newline in string');
        if (ch === '\\' && !raw) {
          const e = src[i + 1];
          i += 2;
          const simple = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
            '\\': '\\', '?': '?', '"': '"', "'": "'", '`': '`' };
          if (e in simple) out += simple[e];
          else if (e === 'x' || e === 'X') { out += hexEsc(2); }
          else if (e === 'u') { out += hexEsc(4); }
          else if (e === 'U') { out += hexEsc(8); }
          else if (/[0-3]/.test(e)) {
            const o = src.slice(i - 1, i + 2);
            if (!/^[0-7]{3}$/.test(o)) err('bad octal escape');
            out += String.fromCodePoint(parseInt(o, 8));
            i += 2;
          } else err('bad escape');
          continue;
        }
        out += ch;
        i++;
      }
      if (bytes) {
        // In bytes literals, \x and octal escapes denote bytes, not code points.
        const arr = [];
        for (const ch of out) {
          const cp = ch.codePointAt(0);
          if (cp < 256 && !raw) arr.push(cp);
          else arr.push(...new TextEncoder().encode(ch));
        }
        toks.push({ k: 'bytes', v: new Uint8Array(arr), pos: start });
      } else {
        toks.push({ k: 'string', v: out, pos: start });
      }
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      i += m[0].length;
      const w = m[0];
      if (w === 'true' || w === 'false') toks.push({ k: 'bool', v: w === 'true', pos: start });
      else if (w === 'null') toks.push({ k: 'null', v: null, pos: start });
      else if (w === 'in') toks.push({ k: 'in', pos: start });
      else if (RESERVED.has(w)) err(`reserved word ${w}`);
      else toks.push({ k: 'ident', v: w, pos: start });
      continue;
    }
    const p = PUNCT.find((p) => src.startsWith(p, i));
    if (!p) err(`unexpected ${JSON.stringify(c)}`);
    i += p.length;
    toks.push({ k: p, pos: start });
  }
  toks.push({ k: 'eof', pos: i });
  return toks;

  function hexEsc(n) {
    const h = src.slice(i, i + n);
    if (h.length !== n || !/^[0-9a-fA-F]+$/.test(h)) err('bad escape');
    i += n;
    return String.fromCodePoint(parseInt(h, 16));
  }
}

// ---------------------------------------------------------------------------
// Parser. Nodes:
//   {t:'lit', v}  {t:'id', n}  {t:'sel', x, f, test}  {t:'idx', x, i}
//   {t:'call', f, target?, args}  {t:'list', items}  {t:'map', entries}
//   {t:'and'|'or', l, r}  {t:'cond', c, a, b}  {t:'comp', ...} (macros)

const MAX_DEPTH = 100;

export function parse(src) {
  const toks = lex(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const accept = (k) => (toks[p].k === k ? toks[p++] : null);
  const expect = (k) => {
    if (toks[p].k !== k) throw new CelError(`expected ${k} at ${toks[p].pos}`);
    return toks[p++];
  };

  const ast = expr();
  if (peek().k !== 'eof') throw new CelError(`unexpected token at ${peek().pos}`);
  return ast;

  function nest(f) {
    if (++depth > MAX_DEPTH) throw new CelError('expression too deep');
    try { return f(); } finally { depth--; }
  }

  function expr() {
    return nest(() => {
      const c = or();
      if (!accept('?')) return c;
      const a = or();
      expect(':');
      const b = expr();
      return { t: 'cond', c, a, b };
    });
  }
  function or() {
    let l = and();
    while (accept('||')) l = { t: 'or', l, r: and() };
    return l;
  }
  function and() {
    let l = rel();
    while (accept('&&')) l = { t: 'and', l, r: rel() };
    return l;
  }
  function rel() {
    let l = add();
    for (;;) {
      const k = peek().k;
      if (!['<', '<=', '>', '>=', '==', '!=', 'in'].includes(k)) return l;
      next();
      l = { t: 'call', f: k === 'in' ? '@in' : '_' + k + '_', args: [l, add()] };
    }
  }
  function add() {
    let l = mul();
    for (;;) {
      const k = peek().k;
      if (k !== '+' && k !== '-') return l;
      next();
      l = { t: 'call', f: '_' + k + '_', args: [l, mul()] };
    }
  }
  function mul() {
    let l = unary();
    for (;;) {
      const k = peek().k;
      if (k !== '*' && k !== '/' && k !== '%') return l;
      next();
      l = { t: 'call', f: '_' + k + '_', args: [l, unary()] };
    }
  }
  function unary() {
    return nest(() => {
      if (accept('!')) return { t: 'call', f: '!_', args: [unary()] };
      if (peek().k === '-') {
        next();
        // Fold negative literals so that the minimum int64 can be written.
        const t = peek();
        if ((t.k === 'int' || t.k === 'double') && !['.', '['].includes(toks[p + 1].k)) {
          next();
          return { t: 'lit', v: t.k === 'int' ? int(-t.v) : -t.v };
        }
        return { t: 'call', f: '-_', args: [unary()] };
      }
      return member();
    });
  }
  function member() {
    let x = primary();
    for (;;) {
      if (accept('.')) {
        const f = expect('ident').v;
        if (accept('(')) {
          const args = exprList(')');
          x = macro(f, x, args) || { t: 'call', f, target: x, args };
        } else {
          x = { t: 'sel', x, f };
        }
      } else if (accept('[')) {
        const i = expr();
        expect(']');
        x = { t: 'idx', x, i };
      } else {
        return x;
      }
    }
  }
  function primary() {
    const t = next();
    switch (t.k) {
      case 'int': return { t: 'lit', v: int(t.v) };
      case 'uint': return { t: 'lit', v: uint(t.v) };
      case 'double': case 'string': case 'bytes': case 'bool': case 'null':
        return { t: 'lit', v: t.v };
      case '.': {
        const n = expect('ident').v;
        if (peek().k === '(') throw new CelError('qualified function names are not supported');
        return { t: 'id', n };
      }
      case 'ident': {
        if (accept('(')) {
          const args = exprList(')');
          if (t.v === 'has') {
            if (args.length !== 1 || args[0].t !== 'sel') throw new CelError('invalid argument to has()');
            return { t: 'sel', x: args[0].x, f: args[0].f, test: true };
          }
          return { t: 'call', f: t.v, args };
        }
        return { t: 'id', n: t.v };
      }
      case '(': {
        const e = expr();
        expect(')');
        return e;
      }
      case '[': return { t: 'list', items: exprList(']') };
      case '{': {
        const entries = [];
        while (!accept('}')) {
          const k = expr();
          expect(':');
          entries.push([k, expr()]);
          if (!accept(',')) { expect('}'); break; }
        }
        return { t: 'map', entries };
      }
    }
    throw new CelError(`unexpected token at ${t.pos}`);
  }
  function exprList(close) {
    const items = [];
    while (!accept(close)) {
      items.push(expr());
      if (!accept(',')) { expect(close); break; }
    }
    return items;
  }
  function macro(f, target, args) {
    const v = () => {
      if (args[0].t !== 'id') throw new CelError(`invalid variable in ${f}()`);
      return args[0].n;
    };
    if (['all', 'exists', 'exists_one', 'filter'].includes(f) && args.length === 2) {
      return { t: 'comp', kind: f, range: target, v: v(), pred: args[1] };
    }
    if (f === 'map' && (args.length === 2 || args.length === 3)) {
      return {
        t: 'comp', kind: 'map', range: target, v: v(),
        pred: args.length === 3 ? args[1] : null, fn: args[args.length - 1],
      };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Static analysis: the signal paths an expression reads. Used to re-evaluate
// only the expressions a signal patch can affect. A path of [] means the
// expression may read anything.

export function signalPaths(ast) {
  const out = [];
  walk(ast, new Set());
  return out;

  function chain(n) {
    // Returns the path of a chain of selects/literal indexes rooted at the
    // `signals` identifier, or null.
    if (n.t === 'id') return n.n === 'signals' ? [] : null;
    if (n.t === 'sel' && !n.test) {
      const p = chain(n.x);
      return p && [...p, n.f];
    }
    if (n.t === 'idx' && n.i.t === 'lit' && typeof n.i.v === 'string') {
      const p = chain(n.x);
      return p && [...p, n.i.v];
    }
    return null;
  }

  function walk(n, bound) {
    if (n.t === 'id') {
      if (n.n === 'signals' && !bound.has('signals')) out.push([]);
      return;
    }
    if (!bound.has('signals')) {
      const p = n.t === 'sel' && n.test ? chain(n.x) : chain(n);
      if (p) {
        out.push(n.t === 'sel' && n.test ? [...p, n.f] : p);
        return;
      }
    }
    switch (n.t) {
      case 'lit': return;
      case 'sel': return walk(n.x, bound);
      case 'idx': walk(n.x, bound); return walk(n.i, bound);
      case 'call': if (n.target) walk(n.target, bound); return n.args.forEach((a) => walk(a, bound));
      case 'list': return n.items.forEach((a) => walk(a, bound));
      case 'map': return n.entries.forEach(([k, v]) => { walk(k, bound); walk(v, bound); });
      case 'and': case 'or': walk(n.l, bound); return walk(n.r, bound);
      case 'cond': walk(n.c, bound); walk(n.a, bound); return walk(n.b, bound);
      case 'comp': {
        walk(n.range, bound);
        const inner = new Set(bound).add(n.v);
        if (n.pred) walk(n.pred, inner);
        if (n.fn) walk(n.fn, inner);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation

const MAX_COST = 1_000_000;

export function evaluate(ast, vars) {
  const state = { cost: 0 };
  return ev(ast, (n) => {
    if (Object.hasOwn(vars, n)) return vars[n];
    throw new CelError(`undeclared reference to '${n}'`);
  }, state);
}

function ev(n, lookup, st) {
  if (++st.cost > MAX_COST) throw new CelError('evaluation cost limit exceeded');
  switch (n.t) {
    case 'lit': return n.v;
    case 'id':
      try { return lookup(n.n); } catch (e) {
        // Type names such as int and string are identifiers too.
        if (Object.hasOwn(T, n.n)) return T[n.n];
        throw e;
      }
    case 'sel': {
      const x = ev(n.x, lookup, st);
      if (!(x instanceof Map)) throw new CelError(`type '${typeOf(x)}' does not support field selection`);
      if (n.test) return x.has(n.f);
      if (!x.has(n.f)) throw new CelError(`no such key: ${n.f}`);
      return x.get(n.f);
    }
    case 'idx': return index(ev(n.x, lookup, st), ev(n.i, lookup, st));
    case 'list': return n.items.map((i) => ev(i, lookup, st));
    case 'map': {
      const m = new Map();
      for (const [k, v] of n.entries) {
        const key = mapKey(ev(k, lookup, st));
        if (m.has(key)) throw new CelError('repeated map key');
        m.set(key, ev(v, lookup, st));
      }
      return m;
    }
    case 'cond': {
      const c = ev(n.c, lookup, st);
      if (typeof c !== 'boolean') throw new CelError('no matching overload for _?_:_');
      return ev(c ? n.a : n.b, lookup, st);
    }
    case 'and':
    case 'or': {
      // Commutative: an error on one side is absorbed if the other side
      // determines the result.
      const decisive = n.t === 'or';
      let lerr = null;
      let l;
      try { l = ev(n.l, lookup, st); } catch (e) { if (!(e instanceof CelError)) throw e; lerr = e; }
      if (l === decisive) return decisive;
      const r = ev(n.r, lookup, st);
      if (r === decisive) return decisive;
      if (lerr) throw lerr;
      if (typeof l !== 'boolean' || typeof r !== 'boolean') {
        throw new CelError(`no matching overload for ${n.t === 'or' ? '_||_' : '_&&_'}`);
      }
      return !decisive;
    }
    case 'comp': return comprehension(n, lookup, st);
    case 'call': {
      if (n.target) {
        const target = ev(n.target, lookup, st);
        const args = n.args.map((a) => ev(a, lookup, st));
        const f = METHODS[n.f];
        if (!f) throw new CelError(`unknown method '${n.f}'`);
        return f(target, ...args);
      }
      const args = n.args.map((a) => ev(a, lookup, st));
      const f = FUNCS[n.f];
      if (!f) throw new CelError(`unknown function '${n.f}'`);
      return f(...args);
    }
  }
  throw new CelError('bad node');
}

function comprehension(n, outer, st) {
  const range = ev(n.range, outer, st);
  let items;
  if (Array.isArray(range)) items = range;
  else if (range instanceof Map) items = [...range.keys()];
  else throw new CelError(`${n.kind}() requires a list or map`);
  const run = (node, item) => ev(node, (name) => (name === n.v ? item : outer(name)), st);
  const pred = (item) => {
    const r = run(n.pred, item);
    if (typeof r !== 'boolean') throw new CelError(`${n.kind}() predicate must be bool`);
    return r;
  };
  switch (n.kind) {
    case 'all':
    case 'exists': {
      const want = n.kind === 'exists';
      let err = null;
      for (const it of items) {
        try { if (pred(it) === want) return want; } catch (e) {
          if (!(e instanceof CelError)) throw e;
          err = err || e;
        }
      }
      if (err) throw err;
      return !want;
    }
    case 'exists_one': {
      let count = 0;
      for (const it of items) if (pred(it)) count++;
      return count === 1;
    }
    case 'filter': return items.filter(pred);
    case 'map': return items.filter((it) => !n.pred || pred(it)).map((it) => run(n.fn, it));
  }
}

function mapKey(k) {
  if (typeof k === 'string' || typeof k === 'bigint' || typeof k === 'boolean') return k;
  if (k instanceof Uint) return k.v;
  throw new CelError(`unsupported map key type '${typeOf(k)}'`);
}

function index(x, i) {
  if (Array.isArray(x)) {
    let n;
    if (typeof i === 'bigint') n = i;
    else if (i instanceof Uint) n = i.v;
    else if (typeof i === 'number' && Number.isInteger(i)) n = BigInt(i);
    else throw new CelError(`invalid list index type '${typeOf(i)}'`);
    if (n < 0n || n >= BigInt(x.length)) throw new CelError(`index out of range: ${n}`);
    return x[Number(n)];
  }
  if (x instanceof Map) {
    let k = i;
    if (typeof i === 'number' && Number.isInteger(i)) k = BigInt(i);
    k = mapKey(k);
    if (!x.has(k)) throw new CelError(`no such key: ${String(k)}`);
    return x.get(k);
  }
  throw new CelError(`type '${typeOf(x)}' does not support indexing`);
}

// Numbers of different CEL types compare by value.
function num(v) {
  if (typeof v === 'bigint' || typeof v === 'number') return v;
  if (v instanceof Uint) return v.v;
  return undefined;
}

function cmpNum(a, b) {
  if (typeof a === 'number' || typeof b === 'number') {
    if (Number.isNaN(Number(a)) || Number.isNaN(Number(b))) return NaN;
    if (typeof a === 'bigint' && typeof b === 'number') return -cmpNum(b, a);
    if (typeof a === 'number' && typeof b === 'bigint') {
      if (!Number.isFinite(a)) return a > 0 ? 1 : -1;
      const fa = Math.floor(a);
      const fb = BigInt(fa);
      if (fb !== b) return fb < b ? -1 : 1;
      return a === fa ? 0 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function equals(a, b) {
  const na = num(a);
  const nb = num(b);
  if (na !== undefined && nb !== undefined) return cmpNum(na, nb) === 0;
  const ta = typeOf(a);
  if (ta !== typeOf(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => equals(x, b[i]));
  if (a instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !equals(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Uint8Array) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (a instanceof CelType) return a.name === b.name;
  return a === b;
}

function compare(a, b, op) {
  const na = num(a);
  const nb = num(b);
  let c;
  if (na !== undefined && nb !== undefined) c = cmpNum(na, nb);
  else if (typeof a === 'string' && typeof b === 'string') c = a < b ? -1 : a > b ? 1 : 0;
  else if (typeof a === 'boolean' && typeof b === 'boolean') c = Number(a) - Number(b);
  else if (a instanceof Uint8Array && b instanceof Uint8Array) {
    c = 0;
    for (let i = 0; i < Math.min(a.length, b.length) && c === 0; i++) c = a[i] - b[i];
    if (c === 0) c = a.length - b.length;
  } else throw new CelError(`no matching overload for ${op} on '${typeOf(a)}', '${typeOf(b)}'`);
  if (Number.isNaN(c)) return false;
  switch (op) {
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '>=': return c >= 0;
  }
}

function overload(name, args) {
  return new CelError(`no matching overload for ${name}(${args.map((a) => typeOf(a)).join(', ')})`);
}

function arith(op, a, b) {
  const ta = typeOf(a);
  if (ta !== typeOf(b)) throw overload(op, [a, b]);
  if (ta === T.int) {
    switch (op) {
      case '+': return int(a + b);
      case '-': return int(a - b);
      case '*': return int(a * b);
      case '/': if (b === 0n) throw new CelError('division by zero'); return int(a / b);
      case '%': if (b === 0n) throw new CelError('modulus by zero'); return a % b;
    }
  }
  if (ta === T.uint) {
    switch (op) {
      case '+': return uint(a.v + b.v);
      case '-': return uint(a.v - b.v);
      case '*': return uint(a.v * b.v);
      case '/': if (b.v === 0n) throw new CelError('division by zero'); return uint(a.v / b.v);
      case '%': if (b.v === 0n) throw new CelError('modulus by zero'); return uint(a.v % b.v);
    }
  }
  if (ta === T.double) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
    }
  }
  if (op === '+') {
    if (ta === T.string) return a + b;
    if (ta === T.list) return [...a, ...b];
    if (ta === T.bytes) { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
  }
  throw overload(op, [a, b]);
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

function size(x) {
  if (typeof x === 'string') return BigInt([...x].length);
  if (Array.isArray(x) || x instanceof Uint8Array) return BigInt(x.length);
  if (x instanceof Map) return BigInt(x.size);
  throw overload('size', [x]);
}

function formatDouble(d) {
  if (Number.isNaN(d)) return 'NaN';
  if (d === Infinity) return '+Inf';
  if (d === -Infinity) return '-Inf';
  return String(d);
}

function toStr(x) {
  switch (typeof x) {
    case 'string': return x;
    case 'bigint': return x.toString();
    case 'number': return formatDouble(x);
    case 'boolean': return String(x);
  }
  if (x instanceof Uint) return x.v.toString();
  if (x instanceof Uint8Array) {
    try { return dec.decode(x); } catch { throw new CelError('invalid UTF-8 in bytes'); }
  }
  throw overload('string', [x]);
}

function toInt(x) {
  if (typeof x === 'bigint') return x;
  if (x instanceof Uint) return int(x.v);
  if (typeof x === 'number') {
    if (!Number.isFinite(x) || x <= -(2 ** 63) - 1025 || x >= 2 ** 63) throw new CelError('int range error');
    return int(BigInt(Math.trunc(x)));
  }
  if (typeof x === 'string') {
    if (!/^[+-]?[0-9]+$/.test(x)) throw new CelError(`cannot parse '${x}' as int`);
    return int(BigInt(x));
  }
  throw overload('int', [x]);
}

function toUint(x) {
  if (x instanceof Uint) return x;
  if (typeof x === 'bigint') return uint(x);
  if (typeof x === 'number') {
    if (!Number.isFinite(x) || x < 0 || x >= 2 ** 64) throw new CelError('uint range error');
    return uint(BigInt(Math.trunc(x)));
  }
  if (typeof x === 'string') {
    if (!/^\+?[0-9]+$/.test(x)) throw new CelError(`cannot parse '${x}' as uint`);
    return uint(BigInt(x));
  }
  throw overload('uint', [x]);
}

function toDouble(x) {
  if (typeof x === 'number') return x;
  if (typeof x === 'bigint') return Number(x);
  if (x instanceof Uint) return Number(x.v);
  if (typeof x === 'string') {
    const s = x.trim();
    if (/^[+-]?(inf(inity)?)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
    if (/^nan$/i.test(s)) return NaN;
    if (s === '' || isNaN(Number(s))) throw new CelError(`cannot parse '${x}' as double`);
    return Number(s);
  }
  throw overload('double', [x]);
}

function want(name, args, ...types) {
  if (args.length !== types.length || args.some((a, i) => typeOf(a) !== T[types[i]])) {
    throw overload(name, args);
  }
}

function regex(pattern) {
  // RE2 and JavaScript regular expressions agree on common syntax. Inline
  // flags such as (?i) at the start are translated.
  let flags = 'u';
  const m = /^\(\?([is]+)\)/.exec(pattern);
  if (m) { pattern = pattern.slice(m[0].length); flags += m[1]; }
  try { return new RegExp(pattern, flags); } catch { throw new CelError(`invalid regex '${pattern}'`); }
}

const cp = (s) => [...s];

function fmt(format, args) {
  if (!Array.isArray(args)) throw overload('format', [format, args]);
  let i = 0;
  return format.replace(/%(?:\.(\d+))?([sdfeExXobc%])/g, (all, prec, verb) => {
    if (verb === '%') return '%';
    if (i >= args.length) throw new CelError('format: not enough arguments');
    const a = args[i++];
    const p = prec === undefined ? 6 : Number(prec);
    switch (verb) {
      case 's': return Array.isArray(a) || a instanceof Map ? display(a) : a === null ? 'null' : toStr(a);
      case 'd':
        if (typeof a !== 'bigint' && !(a instanceof Uint)) throw new CelError('format: %d requires an integer');
        return toStr(a);
      case 'f':
      case 'e':
      case 'E': {
        const d = toDouble(a);
        if (!Number.isFinite(d)) return formatDouble(d);
        if (verb === 'f') return d.toFixed(p);
        const s = d.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
        return verb === 'E' ? s.toUpperCase() : s;
      }
      case 'x':
      case 'X': {
        let s;
        if (typeof a === 'string') s = [...enc.encode(a)].map((b) => b.toString(16).padStart(2, '0')).join('');
        else if (a instanceof Uint8Array) s = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
        else s = (a instanceof Uint ? a.v : toInt(a)).toString(16);
        return verb === 'X' ? s.toUpperCase() : s;
      }
      case 'o': return (a instanceof Uint ? a.v : toInt(a)).toString(8);
      case 'b':
        if (typeof a === 'boolean') return String(a);
        return (a instanceof Uint ? a.v : toInt(a)).toString(2);
      case 'c': return String.fromCodePoint(Number(toInt(a)));
    }
    return all;
  });
}

function display(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(display).join(', ') + ']';
  if (v instanceof Map) return '{' + [...v].map(([k, x]) => display(k) + ': ' + display(x)).join(', ') + '}';
  if (v === null) return 'null';
  if (v instanceof CelType) return v.name;
  return toStr(v);
}

const FUNCS = {
  '_==_': (a, b) => equals(a, b),
  '_!=_': (a, b) => !equals(a, b),
  '_<_': (a, b) => compare(a, b, '<'),
  '_<=_': (a, b) => compare(a, b, '<='),
  '_>_': (a, b) => compare(a, b, '>'),
  '_>=_': (a, b) => compare(a, b, '>='),
  '_+_': (a, b) => arith('+', a, b),
  '_-_': (a, b) => arith('-', a, b),
  '_*_': (a, b) => arith('*', a, b),
  '_/_': (a, b) => arith('/', a, b),
  '_%_': (a, b) => arith('%', a, b),
  '!_': (a) => { if (typeof a !== 'boolean') throw overload('!_', [a]); return !a; },
  '-_': (a) => {
    if (typeof a === 'bigint') return int(-a);
    if (typeof a === 'number') return -a;
    throw overload('-_', [a]);
  },
  '@in': (a, b) => {
    if (Array.isArray(b)) return b.some((x) => equals(a, x));
    if (b instanceof Map) {
      let k = a;
      if (typeof a === 'number' && Number.isInteger(a)) k = BigInt(a);
      if (k instanceof Uint) k = k.v;
      return b.has(k);
    }
    throw overload('@in', [a, b]);
  },
  size: (...a) => { if (a.length !== 1) throw overload('size', a); return size(a[0]); },
  int: (...a) => { if (a.length !== 1) throw overload('int', a); return toInt(a[0]); },
  uint: (...a) => { if (a.length !== 1) throw overload('uint', a); return toUint(a[0]); },
  double: (...a) => { if (a.length !== 1) throw overload('double', a); return toDouble(a[0]); },
  string: (...a) => { if (a.length !== 1) throw overload('string', a); return toStr(a[0]); },
  bool: (...a) => {
    if (a.length !== 1) throw overload('bool', a);
    const x = a[0];
    if (typeof x === 'boolean') return x;
    if (typeof x === 'string') {
      if (['1', 't', 'true', 'TRUE', 'True'].includes(x)) return true;
      if (['0', 'f', 'false', 'FALSE', 'False'].includes(x)) return false;
      throw new CelError(`cannot parse '${x}' as bool`);
    }
    throw overload('bool', a);
  },
  bytes: (...a) => {
    if (a.length !== 1) throw overload('bytes', a);
    if (a[0] instanceof Uint8Array) return a[0];
    if (typeof a[0] === 'string') return enc.encode(a[0]);
    throw overload('bytes', a);
  },
  type: (...a) => { if (a.length !== 1) throw overload('type', a); return typeOf(a[0]); },
  dyn: (...a) => { if (a.length !== 1) throw overload('dyn', a); return a[0]; },
  matches: (...a) => { want('matches', a, 'string', 'string'); return regex(a[1]).test(a[0]); },
};

const METHODS = {
  size: (x, ...a) => { if (a.length) throw overload('size', a); return size(x); },
  contains: (s, ...a) => { want('contains', [s, ...a], 'string', 'string'); return s.includes(a[0]); },
  startsWith: (s, ...a) => { want('startsWith', [s, ...a], 'string', 'string'); return s.startsWith(a[0]); },
  endsWith: (s, ...a) => { want('endsWith', [s, ...a], 'string', 'string'); return s.endsWith(a[0]); },
  matches: (s, ...a) => { want('matches', [s, ...a], 'string', 'string'); return regex(a[0]).test(s); },
  // strings extension
  charAt: (s, ...a) => {
    want('charAt', [s, ...a], 'string', 'int');
    const c = cp(s);
    const i = a[0];
    if (i < 0n || i > BigInt(c.length)) throw new CelError('index out of range');
    return c[Number(i)] ?? '';
  },
  indexOf: (s, ...a) => {
    const c = cp(s);
    const sub = cp(a[0] ?? '');
    let from = 0n;
    if (a.length === 2) { want('indexOf', [s, ...a], 'string', 'string', 'int'); from = a[1]; }
    else want('indexOf', [s, ...a], 'string', 'string');
    if (from < 0n || from > BigInt(c.length)) throw new CelError('index out of range');
    for (let i = Number(from); i + sub.length <= c.length; i++) {
      if (sub.every((ch, j) => c[i + j] === ch)) return BigInt(i);
    }
    return -1n;
  },
  lastIndexOf: (s, ...a) => {
    const c = cp(s);
    const sub = cp(a[0] ?? '');
    let from = BigInt(c.length);
    if (a.length === 2) { want('lastIndexOf', [s, ...a], 'string', 'string', 'int'); from = a[1]; }
    else want('lastIndexOf', [s, ...a], 'string', 'string');
    if (from < 0n || from > BigInt(c.length)) throw new CelError('index out of range');
    for (let i = Math.min(Number(from), c.length - sub.length); i >= 0; i--) {
      if (sub.every((ch, j) => c[i + j] === ch)) return BigInt(i);
    }
    return -1n;
  },
  lowerAscii: (s, ...a) => { want('lowerAscii', [s, ...a], 'string'); return s.replace(/[A-Z]+/g, (m) => m.toLowerCase()); },
  upperAscii: (s, ...a) => { want('upperAscii', [s, ...a], 'string'); return s.replace(/[a-z]+/g, (m) => m.toUpperCase()); },
  trim: (s, ...a) => { want('trim', [s, ...a], 'string'); return s.trim(); },
  reverse: (s, ...a) => { want('reverse', [s, ...a], 'string'); return cp(s).reverse().join(''); },
  replace: (s, ...a) => {
    let n = -1n;
    if (a.length === 3) { want('replace', [s, ...a], 'string', 'string', 'string', 'int'); n = a[2]; }
    else want('replace', [s, ...a], 'string', 'string', 'string');
    if (n < 0n) return s.split(a[0]).join(a[1]);
    let out = '';
    let rest = s;
    for (let i = 0n; i < n; i++) {
      const j = rest.indexOf(a[0]);
      if (j < 0) break;
      out += rest.slice(0, j) + a[1];
      rest = rest.slice(j + a[0].length);
      if (a[0] === '') { out += rest.slice(0, 1); rest = rest.slice(1); }
    }
    return out + rest;
  },
  split: (s, ...a) => {
    let n = -1n;
    if (a.length === 2) { want('split', [s, ...a], 'string', 'string', 'int'); n = a[1]; }
    else want('split', [s, ...a], 'string', 'string');
    if (n === 0n) return [];
    const parts = a[0] === '' ? cp(s) : s.split(a[0]);
    if (n < 0n || BigInt(parts.length) <= n) return parts;
    const k = Number(n);
    return [...parts.slice(0, k - 1), parts.slice(k - 1).join(a[0])];
  },
  substring: (s, ...a) => {
    const c = cp(s);
    const start = a[0];
    const end = a.length === 2 ? a[1] : BigInt(c.length);
    if (a.length === 2) want('substring', [s, ...a], 'string', 'int', 'int');
    else want('substring', [s, ...a], 'string', 'int');
    if (start < 0n || end > BigInt(c.length) || start > end) throw new CelError('index out of range');
    return c.slice(Number(start), Number(end)).join('');
  },
  join: (l, ...a) => {
    if (!Array.isArray(l) || a.length > 1 || (a.length && typeof a[0] !== 'string')) throw overload('join', [l, ...a]);
    if (!l.every((x) => typeof x === 'string')) throw new CelError('join: list must contain strings');
    return l.join(a[0] ?? '');
  },
  format: (s, ...a) => { if (typeof s !== 'string' || a.length !== 1) throw overload('format', [s, ...a]); return fmt(s, a[0]); },
};

// Compiles an expression once, for repeated evaluation.
export function compile(src) {
  const ast = parse(src);
  return { ast, paths: signalPaths(ast), eval: (vars) => evaluate(ast, vars) };
}
