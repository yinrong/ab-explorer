import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mode, truncateAndSet, drillDownTo, backOffOne, pathForReveal } from '../webview/statemachine.ts';

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

test('pathForReveal：目标文件在当前 B 区子树下时 path 不动', () => {
  assert.deepEqual(pathForReveal(['src'], 'src/core/utils.ts'), ['src']);
  assert.deepEqual(pathForReveal([], 'src/core/utils.ts'), []);
  // 文件就是当前 path 本身对应的那个目录名——不构成"子树下"，走 else 分支也无妨
  assert.deepEqual(pathForReveal(['src'], 'src'), ['src']);
});

test('pathForReveal：目标文件不在当前 B 区子树下时收回根', () => {
  assert.deepEqual(pathForReveal(['other'], 'src/core/utils.ts'), []);
  assert.deepEqual(pathForReveal(['src'], 'src-legacy/utils.ts'), []); // 前缀碰巧相似但不是真子目录
});
