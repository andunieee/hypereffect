// Ported from the hypereffect repository's js/src/cel.js; keep the two in step.
// CEL for hypereffect, on top of @marcbachmann/cel-js: the environment of
// spec section 9.1 (the variable `s`, the standard definitions and the
// strings, math and lists extensions), JSON conversion (9.2), and the signal
// paths an expression reads.
//
// cel-js provides the standard definitions and part of the strings extension.
// The rest of the strings extension and the math and lists extensions are
// registered here, following cel-go.
//
// Value representation (that of cel-js):
//   int     bigint                      uint    Uint (cel-js UnsignedInt)
//   double  number                      string  string
//   bool    boolean                     null    null
//   bytes   Uint8Array                  list    Array
//   map     plain object, or Map for non-string keys

import { Environment, EvaluationError, ParseError } from '@marcbachmann/cel-js';

export class CelError extends Error {}

// cel-js values, loosely typed.
type V = any;

const fail = (msg: string) => new EvaluationError(msg);

// ---------------------------------------------------------------------------
// The environment

const env = new Environment({ homogeneousAggregateLiterals: false })
  .registerVariable('s', 'dyn');

// cel-js does not export its uint class.
export const Uint: any = (env.evaluate('1u') as V).constructor;
const isUint = (x: V) => x instanceof Uint;

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;
const int = (v: bigint) => {
  if (v < INT_MIN || v > INT_MAX) throw fail('int overflow');
  return v;
};
const fn = (sig: string, handler: (...args: V[]) => V) => env.registerFunction(sig, handler);

function namespace(name: string) {
  const Ns = { [name]: class {} }[name]!;
  env.registerType(name, Ns as V);
  env.registerConstant(name.replace(/Namespace$/, '').toLowerCase(), name, new Ns());
}
namespace('StringsNamespace');
namespace('MathNamespace');
namespace('ListsNamespace');

// --- strings ---------------------------------------------------------------

const cp = (str: string) => [...str];

fn('string.charAt(int): string', (str, i) => {
  const c = cp(str);
  if (i < 0n || i > BigInt(c.length)) throw fail('charAt: index out of range');
  return c[Number(i)] ?? '';
});
fn('string.replace(string, string): string', (str, from, to) => str.split(from).join(to));
fn('string.replace(string, string, int): string', (str, from, to, n) => {
  if (n < 0n) return str.split(from).join(to);
  let out = '';
  let rest = str;
  for (let i = 0n; i < n; i++) {
    const j = rest.indexOf(from);
    if (j < 0) break;
    out += rest.slice(0, j) + to;
    rest = rest.slice(j + from.length);
    if (from === '') { out += rest.slice(0, 1); rest = rest.slice(1); }
  }
  return out + rest;
});
fn('string.reverse(): string', (str) => cp(str).reverse().join(''));
fn('string.format(list): string', (str, args) => format(str, args));
fn('StringsNamespace.quote(string): string', (_, str) => quote(str));

function formatDouble(d: number) {
  if (Number.isNaN(d)) return 'NaN';
  if (d === Infinity) return '+Inf';
  if (d === -Infinity) return '-Inf';
  return String(d);
}

function toStr(x: V): string {
  switch (typeof x) {
    case 'string': return x;
    case 'bigint': return x.toString();
    case 'number': return formatDouble(x);
    case 'boolean': return String(x);
  }
  if (x === null) return 'null';
  if (isUint(x)) return x.value.toString();
  if (Array.isArray(x)) return '[' + x.map(display).join(', ') + ']';
  if (x instanceof Map) return '{' + [...x].map(([k, v]) => display(k) + ': ' + display(v)).join(', ') + '}';
  if (typeof x === 'object' && !(x instanceof Uint8Array)) {
    return '{' + Object.entries(x).map(([k, v]) => display(k) + ': ' + display(v)).join(', ') + '}';
  }
  throw fail(`format: cannot format ${typeName(x)}`);
}

const display = (v: V): string => (typeof v === 'string' ? quote(v) : toStr(v));

function quote(str: string) {
  return '"' + str.replace(/[\\"\x00-\x1f\x7f]/g, (c) => {
    switch (c) {
      case '\\': return '\\\\';
      case '"': return '\\"';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      case '\b': return '\\b';
      case '\f': return '\\f';
      case '\v': return '\\v';
      case '\x07': return '\\a';
    }
    return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0');
  }) + '"';
}

const enc = new TextEncoder();

function integer(a: V, verb: string): bigint {
  if (typeof a === 'bigint') return a;
  if (isUint(a)) return a.value;
  throw fail(`format: %${verb} requires an integer`);
}

function format(str: string, args: V[]) {
  let i = 0;
  return str.replace(/%(?:\.(\d+))?([sdfeExXobc%])/g, (all: string, prec: string | undefined, verb: string) => {
    if (verb === '%') return '%';
    if (i >= args.length) throw fail('format: not enough arguments');
    const a = args[i++];
    const p = prec === undefined ? 6 : Number(prec);
    switch (verb) {
      case 's': return toStr(a);
      case 'd': return integer(a, verb).toString();
      case 'f':
      case 'e':
      case 'E': {
        const d = typeof a === 'number' ? a : Number(integer(a, verb));
        if (!Number.isFinite(d)) return formatDouble(d);
        if (verb === 'f') return d.toFixed(p);
        const e = d.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
        return verb === 'E' ? e.toUpperCase() : e;
      }
      case 'x':
      case 'X': {
        let h;
        if (typeof a === 'string') h = [...enc.encode(a)].map((b) => b.toString(16).padStart(2, '0')).join('');
        else if (a instanceof Uint8Array) h = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
        else h = integer(a, verb).toString(16);
        return verb === 'X' ? h.toUpperCase() : h;
      }
      case 'o': return integer(a, verb).toString(8);
      case 'b': return typeof a === 'boolean' ? String(a) : integer(a, verb).toString(2);
      case 'c': return String.fromCodePoint(Number(integer(a, verb)));
    }
    return all;
  });
}

// --- math ------------------------------------------------------------------

const isNumber = (x: V) => typeof x === 'bigint' || typeof x === 'number' || isUint(x);
const numeric = (x: V) => (isUint(x) ? x.value : x);

// Orders two values of comparable types: numbers of any type by value,
// strings, bools, bytes.
function compare(a: V, b: V): number {
  if (isNumber(a) && isNumber(b)) {
    const x = numeric(a);
    const y = numeric(b);
    if (typeof x === 'number' || typeof y === 'number') {
      if (Number.isNaN(Number(x)) || Number.isNaN(Number(y))) throw fail('cannot compare NaN');
    }
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
  }
  throw fail(`cannot compare ${typeName(a)} and ${typeName(b)}`);
}

function extreme(name: string, args: V[], sign: number) {
  const items: V[] = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (!items.length) throw fail(`math.${name}: no arguments`);
  let best = items[0];
  for (const x of items) {
    if (!isNumber(x)) throw fail(`math.${name}: ${typeName(x)} is not a number`);
    if (compare(x, best) * sign > 0) best = x;
  }
  return best;
}

for (let n = 1; n <= 16; n++) {
  const params = Array(n).fill('dyn').join(', ');
  fn(`MathNamespace.greatest(${params}): dyn`, (_, ...a) => extreme('greatest', a, 1));
  fn(`MathNamespace.least(${params}): dyn`, (_, ...a) => extreme('least', a, -1));
}

fn('MathNamespace.ceil(double): double', (_, x) => Math.ceil(x));
fn('MathNamespace.floor(double): double', (_, x) => Math.floor(x));
fn('MathNamespace.round(double): double', (_, x) => (x < 0 ? -Math.round(-x) : Math.round(x)));
fn('MathNamespace.trunc(double): double', (_, x) => Math.trunc(x));
fn('MathNamespace.isInf(double): bool', (_, x) => x === Infinity || x === -Infinity);
fn('MathNamespace.isNaN(double): bool', (_, x) => Number.isNaN(x));
fn('MathNamespace.isFinite(double): bool', (_, x) => Number.isFinite(x));
fn('MathNamespace.abs(int): int', (_, x) => int(x < 0n ? -x : x));
fn('MathNamespace.abs(uint): uint', (_, x) => x);
fn('MathNamespace.abs(double): double', (_, x) => Math.abs(x));
fn('MathNamespace.sign(int): int', (_, x) => (x > 0n ? 1n : x < 0n ? -1n : 0n));
fn('MathNamespace.sign(uint): uint', (_, x) => new Uint(x.value > 0n ? 1n : 0n));
fn('MathNamespace.sign(double): double', (_, x) => (Number.isNaN(x) ? x : x > 0 ? 1 : x < 0 ? -1 : 0));
fn('MathNamespace.sqrt(int): double', (_, x) => Math.sqrt(Number(x)));
fn('MathNamespace.sqrt(uint): double', (_, x) => Math.sqrt(Number(x.value)));
fn('MathNamespace.sqrt(double): double', (_, x) => Math.sqrt(x));

const toInt64 = (v: bigint) => BigInt.asIntN(64, v);
const toUint64 = (v: bigint) => new Uint(BigInt.asUintN(64, v));
for (const [name, op] of [['bitAnd', (a: bigint, b: bigint) => a & b], ['bitOr', (a: bigint, b: bigint) => a | b], ['bitXor', (a: bigint, b: bigint) => a ^ b]] as const) {
  fn(`MathNamespace.${name}(int, int): int`, (_, a, b) => toInt64(op(a, b)));
  fn(`MathNamespace.${name}(uint, uint): uint`, (_, a, b) => toUint64(op(a.value, b.value)));
}
fn('MathNamespace.bitNot(int): int', (_, a) => toInt64(~(a as bigint)));
fn('MathNamespace.bitNot(uint): uint', (_, a) => toUint64(~(a.value as bigint)));

function shiftBits(name: string, n: bigint) {
  if (n < 0n) throw fail(`math.${name}: negative offset`);
  return n;
}
fn('MathNamespace.bitShiftLeft(int, int): int', (_, a, n) => (shiftBits('bitShiftLeft', n) > 63n ? 0n : toInt64((a as bigint) << n)));
fn('MathNamespace.bitShiftLeft(uint, int): uint', (_, a, n) => toUint64(shiftBits('bitShiftLeft', n) > 63n ? 0n : (a.value as bigint) << n));
// The right shift is logical, also for int.
fn('MathNamespace.bitShiftRight(int, int): int', (_, a, n) => (shiftBits('bitShiftRight', n) > 63n ? 0n : toInt64(BigInt.asUintN(64, a) >> n)));
fn('MathNamespace.bitShiftRight(uint, int): uint', (_, a, n) => toUint64(shiftBits('bitShiftRight', n) > 63n ? 0n : (a.value as bigint) >> n));

// --- lists -----------------------------------------------------------------

fn('ListsNamespace.range(int): list<int>', (_, n) => {
  const out: bigint[] = [];
  for (let i = 0n; i < n; i++) out.push(i);
  return out;
});
fn('list.slice(int, int): list', (l, start, end) => {
  if (start < 0n || end < 0n) throw fail(`slice: negative index`);
  if (start > end) throw fail(`slice: start index ${start} is greater than end index ${end}`);
  if (end > BigInt(l.length)) throw fail(`slice: end index ${end} is out of range`);
  return l.slice(Number(start), Number(end));
});
fn('list.flatten(): list', (l) => flatten(l, 1n));
fn('list.flatten(int): list', (l, depth) => {
  if (depth < 0n) throw fail('flatten: level must be non-negative');
  return flatten(l, depth);
});
fn('list.distinct(): list', (l) => {
  const out: V[] = [];
  for (const x of l) if (!out.some((y) => equals(x, y))) out.push(x);
  return out;
});
fn('list.reverse(): list', (l) => [...l].reverse());
fn('list.sort(): list', (l) => sorted(l, (x) => x));

function flatten(l: V[], depth: bigint): V[] {
  const out: V[] = [];
  for (const x of l) {
    if (Array.isArray(x) && depth > 0n) out.push(...flatten(x, depth - 1n));
    else out.push(x);
  }
  return out;
}

function sorted(items: V[], key: (x: V) => V) {
  const keyed: [V, V][] = items.map((x) => [key(x), x]);
  for (let i = 1; i < keyed.length; i++) {
    if (typeName(keyed[i]![0]) !== typeName(keyed[0]![0]) && !(isNumber(keyed[i]![0]) && isNumber(keyed[0]![0]))) {
      throw fail('sort: items must be of the same type');
    }
  }
  return keyed.sort((a, b) => compare(a[0], b[0])).map((p) => p[1]);
}

// l.sortBy(x, key), a macro: key is evaluated for each item with x bound to it.
fn('list.sortBy(ast, ast): list<dyn>', ({ args, receiver }: V) => {
  if (args[0].op !== 'id') throw new ParseError('sortBy: the first argument must be an identifier');
  return {
    receiver,
    var: args[0].args,
    key: args[1],
    keyCtx: undefined,
    typeCheck(checker: V, m: V, ctx: V) {
      checker.check(m.receiver, ctx);
      m.keyCtx = ctx.forkWithVariable(m.var, checker.getType('dyn'));
      checker.check(m.key, m.keyCtx);
      return checker.getType('list');
    },
    evaluate(ev: V, m: V, ctx: V) {
      const items = ev.run(m.receiver, ctx);
      if (!Array.isArray(items)) throw fail('sortBy: receiver is not a list');
      return sorted(items, (x: V) => ev.run(m.key, m.keyCtx.reuse(ctx).setIterValue(x, ev)));
    },
  };
});

function typeName(v: V): string {
  switch (typeof v) {
    case 'bigint': return 'int';
    case 'number': return 'double';
    case 'string': return 'string';
    case 'boolean': return 'bool';
  }
  if (v === null) return 'null_type';
  if (isUint(v)) return 'uint';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Uint8Array) return 'bytes';
  return 'map';
}

function entries(m: V): [V, V][] {
  return m instanceof Map ? [...m] : Object.entries(m);
}

// CEL equality: numbers by value across types, lists and maps by contents.
export function equals(a: V, b: V): boolean {
  if (isNumber(a) && isNumber(b)) {
    const x = numeric(a);
    const y = numeric(b);
    return x == y; // eslint-disable-line eqeqeq -- bigint == number compares by value; NaN is unequal
  }
  const t = typeName(a);
  if (t !== typeName(b)) return false;
  if (t === 'list') return a.length === b.length && a.every((x: V, i: number) => equals(x, b[i]));
  if (t === 'bytes') return a.length === b.length && a.every((x: V, i: number) => x === b[i]);
  if (t === 'map') {
    const ea = entries(a);
    const eb = new Map(entries(b));
    return ea.length === eb.size && ea.every(([k, v]) => eb.has(k) && equals(v, eb.get(k)));
  }
  return a === b;
}

// ---------------------------------------------------------------------------
// JSON conversion (spec section 9.2)

export function fromJson(v: unknown): V {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    return Number.isInteger(v) && Math.abs(v) < 2 ** 63 ? BigInt(v) : v;
  }
  if (Array.isArray(v)) return v.map(fromJson);
  if (typeof v === 'object') {
    const o: Record<string, V> = {};
    for (const [k, x] of Object.entries(v)) o[k] = fromJson(x);
    return o;
  }
  throw new CelError('not JSON');
}

export function toJson(v: V): unknown {
  switch (typeof v) {
    case 'bigint': return Number(v);
    case 'number':
      if (!Number.isFinite(v)) throw new CelError('no JSON representation for ' + v);
      return v;
    case 'string':
    case 'boolean': return v;
  }
  if (v === null) return null;
  if (isUint(v)) return Number(v.value);
  if (Array.isArray(v)) return v.map(toJson);
  if (v instanceof Uint8Array || typeof v !== 'object') throw new CelError('no JSON representation for ' + typeName(v));
  const o: Record<string, unknown> = {};
  for (const [k, x] of entries(v)) {
    if (typeof k !== 'string') throw new CelError('map key is not a string');
    o[k] = toJson(x);
  }
  return o;
}

// The name of a value's CEL type, for messages.
export { typeName };

// ---------------------------------------------------------------------------
// Static analysis: the signal paths an expression reads. Used to re-evaluate
// only the expressions a signal patch can affect. A path of [] means the
// expression may read anything.

export function signalPaths(ast: V): string[][] {
  const out: string[][] = [];
  walk(ast);
  return out;

  // The path of a chain of field selections and literal string indexes
  // rooted at `s`, or null.
  function chain(n: V): string[] | null {
    if (n.op === 'id') return n.args === 's' ? [] : null;
    if (n.op === '.' || n.op === '.?') {
      const p = chain(n.args[0]);
      return p && [...p, n.args[1]];
    }
    if ((n.op === '[]' || n.op === '[?]') && n.args[1].op === 'value' && typeof n.args[1].args === 'string') {
      const p = chain(n.args[0]);
      return p && [...p, n.args[1].args];
    }
    return null;
  }

  function walk(n: V): void {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object' || !n.op) return;
    if (n.op === 'value') return;
    // An `s` that is not the start of a chain (or is rebound by a macro)
    // could read anything.
    if (n.op === 'id') {
      if (n.args === 's') out.push([]);
      return;
    }
    const p = chain(n);
    if (p) { out.push(p); return; }
    walk(n.args);
  }
}

// ---------------------------------------------------------------------------

// Compiles an expression once, for repeated evaluation against signals in
// their CEL representation (see fromJson). Throws CelError.
export interface Compiled {
  // The signal paths the expression reads; [] means anything.
  paths: string[][];
  eval(signals: V): V;
}

export function compile(src: string): Compiled {
  let prog: V;
  try { prog = env.parse(src); } catch (e) {
    throw new CelError((e as Error).message);
  }
  return {
    paths: signalPaths(prog.ast),
    eval(signals) {
      try { return prog({ s: signals }); } catch (e) {
        throw new CelError((e as Error).message);
      }
    },
  };
}
