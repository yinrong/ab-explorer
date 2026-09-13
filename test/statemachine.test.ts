import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mode, truncateAndSet, drillDownTo, backOffOne } from '../webview/statemachine.ts';

test('path 长度 <=1 是模式1，>=2 是模式2', () => {
  assert.equal(mode([]), 'mode1');
  assert.equal(mode(['src']), 'mode1');
  assert.equal(mode(['src', 'core']), 'mode2');
  assert.equal(mode(['src', 'core', 'utils']), 'mode2');
});

test('点击某一行标签：截断到该行并替换为所点目录', () => {
  assert.deepEqual(truncateAndSet(['src', 'core', 'utils'], 1, 'lib'), ['src', 'lib']);
  assert.deepEqual(truncateAndSet([], 0, 'src'), ['src']);
});

test('溢出下钻：把触发溢出的目录（相对 B 树根的路径）拼进当前 path', () => {
  assert.deepEqual(drillDownTo(['src'], ['core', 'utils']), ['src', 'core', 'utils']);
  assert.deepEqual(drillDownTo([], ['src']), ['src']);
});

test('回退一级：去掉 path 末段', () => {
  assert.deepEqual(backOffOne(['src', 'core', 'utils']), ['src', 'core']);
  assert.deepEqual(backOffOne(['src']), []);
  assert.deepEqual(backOffOne([]), []);
});
