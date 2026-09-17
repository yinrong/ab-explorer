import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressLabels } from '../webview/prefix.ts';

test('首个按字母序目录显示全名，其余同前缀目录压缩为 -差异部分', () => {
  const result = compressLabels(['typhur-app', 'typhur-web', 'typhur-api']);
  assert.deepEqual(
    result.map((r) => r.label),
    ['typhur-api', '-app', '-web'],
  );
  assert.deepEqual(
    result.map((r) => r.isGroupStart),
    [true, false, false],
  );
});

test('公共前缀不落在分隔符边界上时按边界截断', () => {
  // "release-1.0" / "release-1.1" 公共前缀 "release-1." 在分隔符 '.' 上，取 "release-1."
  const result = compressLabels(['release-1.1', 'release-1.0']);
  assert.deepEqual(
    result.map((r) => r.label),
    ['release-1.0', '-1'],
  );
});

test('公共前缀内没有任何分隔符时不压缩，各自显示全名', () => {
  const result = compressLabels(['abc123', 'abc456']);
  assert.deepEqual(
    result.map((r) => r.label),
    ['abc123', 'abc456'],
  );
  assert.deepEqual(
    result.map((r) => r.isGroupStart),
    [true, true],
  );
});

test('组基名本身以分隔符结尾时，后续目录仍按该边界压缩', () => {
  const result = compressLabels(['foo-', 'foo-bar']);
  assert.equal(result[0].label, 'foo-');
  assert.equal(result[1].isGroupStart, false);
  assert.equal(result[1].label, '-bar');
});

test('单个目录不压缩', () => {
  const result = compressLabels(['solo']);
  assert.deepEqual(result, [{ name: 'solo', label: 'solo', isGroupStart: true, groupSize: 1 }]);
});

test('空数组返回空数组', () => {
  assert.deepEqual(compressLabels([]), []);
});

test('完整前缀要一次性清除干净，不能只砍掉前缀内部的第一个分隔符', () => {
  // 实测踩过的坑：3d-man1 的完整前缀曾经只被砍掉 "3d-"，
  // 留下 "-man1-agent1" 这种还带着冗余前缀的标签。
  const result = compressLabels(['3d-man1', '3d-man1-agent1', '3d-man1-agent2']);
  assert.deepEqual(
    result.map((r) => r.label),
    ['3d-man1', '-agent1', '-agent2'],
  );
  assert.deepEqual(
    result.map((r) => r.groupSize),
    [3, 3, 3],
  );
});

test('旁支目录只是碰巧共享一小段通用前缀，不应被并进同一组', () => {
  // 3d-man2 和 3d-man1 系列只共享泛泛的 "3d-"，不能因为链上某个深层
  // 条目（3d-man1-agent4）跟它有更短的公共前缀就把它错误地并进那一组。
  const result = compressLabels(['3d-man1', '3d-man1-agent1', '3d-man1-agent2', '3d-man2']);
  assert.deepEqual(
    result.map((r) => r.label),
    ['3d-man1', '-agent1', '-agent2', '3d-man2'],
  );
  assert.deepEqual(
    result.map((r) => r.isGroupStart),
    [true, false, false, true],
  );
});

test('组前缀在链条中途变浅（回退到锚点自身的前缀）时仍要继续压缩', () => {
  // ai 系列：ai-growth-plan-1/2 比 ai-manage 更深地共享 "ai-growth-plan-"，
  // 但 ai-manage 应该回退用锚点 "ai" 自己的前缀 "ai-" 继续压缩，
  // 而不是因为链上最近一个是 "ai-growth-plan-2" 就整组断掉。
  const result = compressLabels(['ai', 'ai-growth-plan', 'ai-growth-plan-1', 'ai-growth-plan-2', 'ai-manage']);
  assert.deepEqual(
    result.map((r) => r.label),
    ['ai', '-growth-plan', '-1', '-2', '-manage'],
  );
  assert.deepEqual(
    result.map((r) => r.groupSize),
    [5, 5, 5, 5, 5],
  );
});

test('两个目录仅共享短通用前缀时仍可压缩成一个小组，但不会继续拉长', () => {
  const result = compressLabels(['3d-man3', '3d-man4']);
  assert.deepEqual(
    result.map((r) => r.label),
    ['3d-man3', '-man4'],
  );
});
