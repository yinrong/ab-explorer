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
  assert.deepEqual(result, [{ name: 'solo', label: 'solo', isGroupStart: true }]);
});

test('空数组返回空数组', () => {
  assert.deepEqual(compressLabels([]), []);
});
