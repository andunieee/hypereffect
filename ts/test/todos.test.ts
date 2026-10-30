import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Loopback } from '../src/client.ts';
import { Todos } from '../examples/todos.ts';

test('add, toggle, delete, clear', () => {
  const l = new Loopback(() => new Todos());
  const c = l.client;
  assert.deepEqual(c.children('items'), ['t1', 't2', 't3']);
  assert.equal(c.attr('left', 'text'), '2 of 3 left');
  assert.equal(c.attr('add', 'disabled'), true);

  l.write('new', '  Buy milk ');
  assert.equal(c.attr('add', 'disabled'), false);
  assert.ok(l.trigger('new', 'onSubmit'));
  assert.deepEqual(c.children('items'), ['t4', 't1', 't2', 't3']);
  assert.equal(c.attr('t4-check', 'label'), 'Buy milk');
  assert.equal(c.value('new'), '');
  assert.equal(c.value('_adding'), false);

  // Filters are local: no action, only visibility changes.
  l.write('_filter', 'done');
  assert.equal(c.attr('t1', 'visible'), true);
  assert.equal(c.attr('t4', 'visible'), false);
  l.write('_filter', 'all');

  l.write('done.t4', true);
  assert.ok(l.trigger('t4-check', 'onChange'));
  assert.equal(c.attr('left', 'text'), '2 of 4 left');

  assert.ok(l.trigger('t2-del', 'onPress'));
  assert.ok(!c.contains('t2'));
  assert.ok(!c.contains('t2-check'));
  assert.equal(c.value('done.t2'), undefined);

  assert.equal(c.attr('confirm', 'open'), false);
  assert.ok(!l.trigger('clear', 'onPress'));
  assert.equal(c.attr('confirm', 'open'), true);
  assert.equal(c.attr('confirm-text', 'text'), '2 tasks will be deleted.');
  assert.ok(l.trigger('confirm-yes', 'onPress'));
  assert.equal(c.attr('confirm', 'open'), false);
  assert.deepEqual(c.children('items'), ['t3']);
  assert.equal(c.attr('clear', 'disabled'), true);
  assert.deepEqual(c.takeDiagnostics(), []);
});
