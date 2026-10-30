import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cel from '../src/cel.ts';

const signals = cel.fromJson({ n: 3, d: 1.5, s: 'Hello', l: [1, 2, 3], m: { a: 1, b: 2 }, t: true, z: null });
const run = (src: string) => cel.toJson(cel.compile(src).eval(signals));
const fails = (src: string) => assert.throws(() => cel.compile(src).eval(signals), cel.CelError, src);

test('literals', () => {
  assert.equal(run('1'), 1);
  assert.equal(run('0x1F'), 31);
  assert.equal(run('1.5e1'), 15);
  assert.equal(run('0.5'), 0.5);
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
  assert.equal(run('s.n * 2 + 1'), 7);
  assert.equal(run('7 / 2'), 3);
  assert.equal(run('-7 / 2'), -3);
  assert.equal(run('-7 % 3'), -1);
  assert.equal(run('7.0 / 2.0'), 3.5);
  assert.equal(run('double(s.n) * s.d'), 4.5);
  assert.equal(run("'a' + 'b'"), 'ab');
  assert.deepEqual(run('[1] + [2]'), [1, 2]);
  fails('s.n * s.d');
  fails('1 + 1u');
  fails('1 / 0');
  fails('9223372036854775807 + 1');
  fails('0u - 1u');
  assert.equal(run('1.0 / 0.0 > 1e308'), true);
});

test('comparison', () => {
  // Literals of different numeric types do not type-check, as in cel-go;
  // dynamic values compare by value.
  fails('1 == 1.0');
  assert.equal(run('dyn(1) == 1.0 && s.n == 3u'), true);
  assert.equal(run('2 < 2.5 && 3u > 2'), true);
  assert.equal(run("'a' < 'b'"), true);
  assert.equal(run("dyn(1) == 'a'"), false);
  assert.equal(run('[1, 2] == [1, 2.0]'), true);
  assert.equal(run("{'a': 1} == {'a': 1}"), true);
  assert.equal(run('null == null'), true);
  assert.equal(run('s.z == null'), true);
  fails("1 < 'a'");
});

test('logic absorbs errors', () => {
  assert.equal(run('true || s.missing'), true);
  assert.equal(run('s.missing || true'), true);
  assert.equal(run('s.missing && false'), false);
  fails('s.missing || false');
  fails('1 ? 2 : 3');
  assert.equal(run('s.t ? "y" : "n"'), 'y');
});

test('selection, indexing, has()', () => {
  assert.equal(run('s.m.a'), 1);
  assert.equal(run("s.m['b']"), 2);
  assert.equal(run('s.l[2]'), 3);
  assert.equal(run('has(s.m.a)'), true);
  assert.equal(run('has(s.m.c)'), false);
  assert.equal(run("'a' in s.m"), true);
  assert.equal(run('2 in s.l'), true);
  assert.equal(run('{1: "x"}[1]'), 'x');
  fails('s.l[3]');
  fails('s.m.c');
  fails('s.n.x');
  fails('nope');
});

test('macros', () => {
  assert.deepEqual(run('s.l.map(x, x * x)'), [1, 4, 9]);
  assert.deepEqual(run('s.l.map(x, x > 1, x * 10)'), [20, 30]);
  assert.deepEqual(run('s.l.filter(x, x % 2 == 1)'), [1, 3]);
  assert.equal(run('s.l.all(x, x > 0)'), true);
  assert.equal(run('s.l.exists(x, x == 2)'), true);
  assert.equal(run('s.l.exists_one(x, x > 1)'), false);
  assert.deepEqual(run('s.m.filter(k, s.m[k] > 1)'), ['b']);
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
  assert.equal(run('type(s.m) == map && type(s.l) == list && type(null) == null_type'), true);
  assert.equal(run("size('héllo') + size(b'h\\xff') + size([1]) + size({'a': 1})"), 9);
  assert.equal(run("dyn(1) == 1"), true);
  fails("int('x')");
});

test('strings', () => {
  assert.equal(run("s.s.contains('ell') && s.s.startsWith('He') && s.s.endsWith('lo')"), true);
  assert.equal(run("s.s.matches('^h.*o$')"), false);
  assert.equal(run("s.s.lowerAscii() + s.s.upperAscii()"), 'helloHELLO');
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

test('math', () => {
  assert.equal(run('math.greatest(1, 2.5, 2u) + 0.5'), 3);
  assert.equal(run('math.least([3, 1, 2])'), 1);
  assert.equal(run('math.round(-2.5) + math.ceil(1.1) + math.floor(1.9) + math.trunc(-1.9)'), -1);
  assert.equal(run('math.abs(-3) + math.sign(-7)'), 2);
  assert.equal(run('math.sqrt(2.25)'), 1.5);
  assert.equal(run('math.isNaN(0.0 / 0.0) && math.isInf(1.0 / 0.0) && !math.isFinite(1.0 / 0.0)'), true);
  assert.equal(run('math.bitOr(4, 1) + math.bitXor(3, 1) + math.bitNot(0)'), 6);
  assert.equal(run('math.bitShiftRight(-1, 60)'), 15);
  fails('math.greatest("a", "b")');
  fails('math.abs(-9223372036854775807 - 1)');
});

test('lists', () => {
  assert.deepEqual(run('lists.range(3)'), [0, 1, 2]);
  assert.deepEqual(run('s.l.slice(1, 3)'), [2, 3]);
  assert.deepEqual(run('[1, [2, [3]]].flatten()'), [1, 2, [3]]);
  assert.deepEqual(run('[1, [2, [3]]].flatten(2)'), [1, 2, 3]);
  assert.deepEqual(run('[1, 2, 1, 2.0].distinct()'), [1, 2]);
  assert.deepEqual(run('s.l.reverse()'), [3, 2, 1]);
  assert.deepEqual(run("['b', 'c', 'a'].sort()"), ['a', 'b', 'c']);
  assert.deepEqual(run("[{'n': 2}, {'n': 1}].sortBy(x, x.n)"), [{ n: 1 }, { n: 2 }]);
  fails('s.l.slice(2, 1)');
  fails("[1, 'a'].sort()");
});

test('strings extension', () => {
  assert.equal(run('strings.quote(\'a"b\\n\')'), '"a\\"b\\n"');
  assert.equal(run("'%s %s'.format([[1, 'a'], {'k': true}])"), '[1, "a"] {"k": true}');
});

test('signal paths', () => {
  const paths = (s: string) => cel.compile(s).paths;
  assert.deepEqual(paths('s.a.b + s.c'), [['a', 'b'], ['c']]);
  assert.deepEqual(paths("has(s.a.b) && s['x'].y"), [['a', 'b'], ['x', 'y']]);
  assert.deepEqual(paths('s.l.map(x, x.y)'), [['l']]);
  assert.deepEqual(paths('s[s.k]'), [[], ['k']]);
  assert.deepEqual(paths('1 + 2'), []);
  assert.deepEqual(paths('[1].map(s, s)'), [[], []]);
});

test('parse errors', () => {
  for (const src of ['1 +', '(1', "'unterminated", 'a.', '1 2', 'if', '{1: 2']) {
    assert.throws(() => cel.compile(src), cel.CelError, src);
  }
});
