import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitIntensity } from '../webview/frequency.ts';

test('从未访问过强度为 0', () => {
  assert.equal(visitIntensity(0, 10), 0);
});

test('访问次数等于最大值时强度为 1', () => {
  assert.equal(visitIntensity(10, 10), 1);
});

test('全局没有任何访问记录（maxCount 为 0）时强度为 0，不除以 0', () => {
  assert.equal(visitIntensity(0, 0), 0);
});

test('强度随访问次数单调递增', () => {
  const a = visitIntensity(1, 20);
  const b = visitIntensity(5, 20);
  const c = visitIntensity(20, 20);
  assert.ok(a < b);
  assert.ok(b < c);
});

test('超过 maxCount 的次数不会超过强度上限 1', () => {
  assert.equal(visitIntensity(999, 10), 1);
});
