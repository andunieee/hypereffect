// Runs the shared fixtures in ../../fixtures against Session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Session } from '../src/index.js';

const dir = path.join(import.meta.dirname, '..', '..', 'fixtures');

// Deep equality with numbers compared by value.
function same(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return a === b;
}

function run(file) {
  const sent = [];
  const s = new Session({ send: (l) => sent.push(l), onDiagnostic: () => {} });
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
  const where = (i) => `${file}:${i + 1}`;
  const drained = (i) => assert.equal(sent.length, 0, `${where(i)}: unexpected output ${sent[0]}`);
  lines.forEach((line, i) => {
    if (line === '' || line.startsWith('#')) return;
    if (line.startsWith('< ')) {
      assert.ok(sent.length, `${where(i)}: expected ${line.slice(2)}, nothing was sent`);
      const got = sent.shift();
      const [tag, json] = [line.slice(2, line.indexOf(' ', 2)), line.slice(line.indexOf(' ', 2) + 1)];
      assert.ok(got.startsWith(tag + ' '), `${where(i)}: got ${got}`);
      assert.ok(same(JSON.parse(got.slice(tag.length + 1)), JSON.parse(json)), `${where(i)}: got ${got}`);
      return;
    }
    if (line.startsWith('!')) {
      drained(i);
      const [cmd, a, ...rest] = line.slice(1).split(' ');
      switch (cmd) {
        case 'start': s.start(JSON.parse([a, ...rest].join(' '))); break;
        case 'write': s.write(a, JSON.parse(rest.join(' '))); break;
        case 'trigger': s.trigger(a, rest[0]); break;
        case 'close': s.close(); break;
        default: throw new Error(`${where(i)}: unknown command ${cmd}`);
      }
      s.flush();
      return;
    }
    if (line.startsWith('=')) {
      const [cmd, a, ...rest] = line.slice(1).split(' ');
      const want = () => JSON.parse(rest.join(' '));
      switch (cmd) {
        case 'attrs': {
          const r = s.get(a);
          assert.ok(r, `${where(i)}: no element ${a}`);
          for (const [k, v] of Object.entries(want())) {
            assert.ok(same(r.attrs[k], v), `${where(i)}: ${a}.${k} is ${JSON.stringify(r.attrs[k])}, want ${JSON.stringify(v)}`);
          }
          break;
        }
        case 'children':
          assert.deepEqual(s.children(a === '-' ? null : a), want(), where(i));
          break;
        case 'signals':
          assert.ok(same(s.signals, JSON.parse([a, ...rest].join(' '))), `${where(i)}: signals are ${JSON.stringify(s.signals)}`);
          break;
        case 'absent':
          assert.ok(!s.has(a), `${where(i)}: ${a} exists`);
          break;
        default: throw new Error(`${where(i)}: unknown check ${cmd}`);
      }
      return;
    }
    s.receive(line + '\n');
    s.flush();
  });
  drained(lines.length - 1);
}

for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  test(f, () => run(f));
}
