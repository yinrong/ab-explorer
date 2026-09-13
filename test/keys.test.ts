import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toKey, parentKeyOf, baseNameOf, keyToSegments, childKey } from '../src/keys.ts';

test('toKey：将 . 与空串规整为根键 \'\'，反斜杠转正斜杠', () => {
  assert.equal(toKey('.'), '');
  assert.equal(toKey(''), '');
  assert.equal(toKey('src'), 'src');
  assert.equal(toKey('src\\core'), 'src/core');
});

test('parentKeyOf / baseNameOf', () => {
  assert.equal(parentKeyOf(''), '');
  assert.equal(parentKeyOf('a'), '');
  assert.equal(parentKeyOf('a/b'), 'a');
  assert.equal(parentKeyOf('a/b/c'), 'a/b');
  assert.equal(baseNameOf('a/b/c'), 'c');
  assert.equal(baseNameOf('a'), 'a');
});

test('keyToSegments / childKey', () => {
  assert.deepEqual(keyToSegments(''), []);
  assert.deepEqual(keyToSegments('a/b'), ['a', 'b']);
  assert.equal(childKey('', 'a'), 'a');
  assert.equal(childKey('a', 'b'), 'a/b');
});
