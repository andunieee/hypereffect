import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cel } from '../src/index.js';

const signals = cel.fromJson({ n: 3, d: 1.5, s: 'Hello', l: [1, 2, 3], m: { a: 1, b: 2 }, t: true, z: null });
const run = (src) => cel.toJson(cel.compile(src).eval({ signals }));
const fails = (src) => assert.throws(() => cel.compile(src).eval({ signals }), cel.CelError, src);

test('literals', () => {
  assert.equal(run('1'), 1);
  assert.equal(run('0x1F'), 31);
  assert.equal(run('1.5e1'), 15);
  assert.equal(run('.5'), 0.5);
  assert.equal(run('7u'), 7);
  assert.equal(run('"a\\tb"'), 'a\tb');
  assert.equal(run("'\\u00e9\\x41\\101'"), 'éAA');
  assert.equal(run("r'\\n'"), '\\n');
  assert.equal(run("'''multi\nline'''"), 'multi\nline');
  assert.equal(run('null'), null);
  assert.deepEqual(run('[1, "a", true,]'), [1, 'a', true]);
  assert.deepEqual(run("{'k': [1], 'j': {}}"), { k: [1], j: {} });
  assert.equal(run('-9223372036854775808'), -9223372036854775808);
});

test('arithmetic and int/double separation', () => {
  assert.equal(run('signals.n * 2 + 1'), 7);
  assert.equal(run('7 / 2'), 3);
  assert.equal(run('-7 / 2'), -3);
  assert.equal(run('-7 % 3'), -1);
  assert.equal(run('7.0 / 2.0'), 3.5);
  assert.equal(run('double(signals.n) * signals.d'), 4.5);
  assert.equal(run("'a' + 'b'"), 'ab');
  assert.deepEqual(run('[1] + [2]'), [1, 2]);
  fails('signals.n * signals.d');
  fails('1 + 1u');
  fails('1 / 0');
  fails('9223372036854775807 + 1');
  fails('0u - 1u');
  assert.equal(run('1.0 / 0.0 > 1e308'), true);
});

test('comparison', () => {
  assert.equal(run('1 == 1.0'), true);
  assert.equal(run('1 == 1u'), true);
  assert.equal(run('2 < 2.5 && 3u > 2'), true);
  assert.equal(run("'a' < 'b'"), true);
  assert.equal(run("1 == 'a'"), false);
  assert.equal(run('[1, 2] == [1, 2.0]'), true);
  assert.equal(run("{'a': 1} == {'a': 1}"), true);
  assert.equal(run('null == null'), true);
  assert.equal(run('signals.z == null'), true);
  fails("1 < 'a'");
});

test('logic absorbs errors', () => {
  assert.equal(run('true || signals.missing'), true);
  assert.equal(run('signals.missing || true'), true);
  assert.equal(run('signals.missing && false'), false);
  fails('signals.missing || false');
  fails('1 ? 2 : 3');
  assert.equal(run('signals.t ? "y" : "n"'), 'y');
});

test('selection, indexing, has()', () => {
  assert.equal(run('signals.m.a'), 1);
  assert.equal(run("signals.m['b']"), 2);
  assert.equal(run('signals.l[2]'), 3);
  assert.equal(run('signals.l[1u]'), 2);
  assert.equal(run('has(signals.m.a)'), true);
  assert.equal(run('has(signals.m.c)'), false);
  assert.equal(run("'a' in signals.m"), true);
  assert.equal(run('2 in signals.l'), true);
  assert.equal(run('{1: "x"}[1]'), 'x');
  fails('signals.l[3]');
  fails('signals.m.c');
  fails('signals.n.x');
  fails('nope');
});

test('macros', () => {
  assert.deepEqual(run('signals.l.map(x, x * x)'), [1, 4, 9]);
  assert.deepEqual(run('signals.l.map(x, x > 1, x * 10)'), [20, 30]);
  assert.deepEqual(run('signals.l.filter(x, x % 2 == 1)'), [1, 3]);
  assert.equal(run('signals.l.all(x, x > 0)'), true);
  assert.equal(run('signals.l.exists(x, x == 2)'), true);
  assert.equal(run('signals.l.exists_one(x, x > 1)'), false);
  assert.deepEqual(run('signals.m.filter(k, signals.m[k] > 1)'), ['b']);
  assert.equal(run('[1, 0].exists(x, 1 / x == 1)'), true);
  assert.deepEqual(run('[[1, 2], [3]].map(x, x.map(y, y + 1))'), [[2, 3], [4]]);
});

test('conversions and types', () => {
  assert.equal(run('string(1) + string(1.5) + string(true) + string(2u)'), '11.5true2');
  assert.equal(run("int('-42') + int(2.9)"), -40);
  assert.equal(run("double('2.5')"), 2.5);
  assert.equal(run("uint(3)"), 3);
  assert.equal(run("bool('true')"), true);
  assert.equal(run('type(1) == int && type(1.0) == double && type("") == string'), true);
  assert.equal(run('type(signals.m) == map && type(signals.l) == list && type(null) == null_type'), true);
  assert.equal(run("size('héllo') + size(b'h\\xff') + size([1]) + size({'a': 1})"), 9);
  assert.equal(run("dyn(1) == 1"), true);
  fails("int('x')");
  fails('int(1e300)');
});

test('strings', () => {
  assert.equal(run("signals.s.contains('ell') && signals.s.startsWith('He') && signals.s.endsWith('lo')"), true);
  assert.equal(run("signals.s.matches('^h.*o$')"), false);
  assert.equal(run("signals.s.matches('(?i)^h.*o$')"), true);
  assert.equal(run("signals.s.lowerAscii() + signals.s.upperAscii()"), 'helloHELLO');
  assert.equal(run("'  x '.trim()"), 'x');
  assert.equal(run("'a-b-c'.replace('-', '+')"), 'a+b+c');
  assert.equal(run("'a-b-c'.replace('-', '+', 1)"), 'a+b-c');
  assert.deepEqual(run("'a,b,c'.split(',')"), ['a', 'b', 'c']);
  assert.deepEqual(run("'a,b,c'.split(',', 2)"), ['a', 'b,c']);
  assert.equal(run("['a', 'b'].join() + ['a', 'b'].join('-')"), 'aba-b');
  assert.equal(run("'hello'.substring(1, 3) + 'hello'.substring(3)"), 'ello');
  assert.equal(run("'hello'.charAt(1) + string('hello'.indexOf('l')) + string('hello'.lastIndexOf('l'))"), 'e23');
  assert.equal(run("'%s has %d items costing %.2f'.format(['cart', 3, 9.5])"), 'cart has 3 items costing 9.50');
  assert.equal(run("'%x %o %b %%'.format([255, 8, 5])"), 'ff 10 101 %');
  assert.equal(run("'abc'.reverse()"), 'cba');
});

test('signal paths', () => {
  const paths = (s) => cel.compile(s).paths;
  assert.deepEqual(paths('signals.a.b + signals.c'), [['a', 'b'], ['c']]);
  assert.deepEqual(paths("has(signals.a.b) && signals['x'].y"), [['a', 'b'], ['x', 'y']]);
  assert.deepEqual(paths('signals.l.map(x, x.y)'), [['l']]);
  assert.deepEqual(paths('signals[signals.k]'), [[], ['k']]);
  assert.deepEqual(paths('1 + 2'), []);
  assert.deepEqual(paths('[1].map(signals, signals)'), []);
});

test('parse errors', () => {
  for (const src of ['1 +', '(1', "'unterminated", 'a.', '1 2', 'if', 'has(x)', '{1: 2', 'x.all(1, true)']) {
    assert.throws(() => cel.compile(src), cel.CelError, src);
  }
});
