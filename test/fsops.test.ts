import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readDir, createFile, createFolder, renameEntry, pathExists, isExcluded } from '../src/fsops.ts';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-explorer-test-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('readDir：目录优先，其后按名排序，默认包含所有条目', async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, 'zeta'));
    await fs.mkdir(path.join(dir, 'alpha'));
    await fs.writeFile(path.join(dir, 'b.txt'), '');
    await fs.writeFile(path.join(dir, 'a.txt'), '');

    const entries = await readDir(dir);
    assert.deepEqual(
      entries.map((e) => [e.name, e.isDir]),
      [
        ['alpha', true],
        ['zeta', true],
        ['a.txt', false],
        ['b.txt', false],
      ],
    );
  });
});

test('readDir：excludeGlobs 命中的条目被过滤', async () => {
  await withTempDir(async (dir) => {
    await fs.mkdir(path.join(dir, 'node_modules'));
    await fs.mkdir(path.join(dir, 'src'));
    await fs.writeFile(path.join(dir, '.DS_Store'), '');

    const entries = await readDir(dir, ['**/node_modules', '**/.DS_Store']);
    assert.deepEqual(
      entries.map((e) => e.name),
      ['src'],
    );
  });
});

test('isExcluded：** 通配匹配 basename', () => {
  assert.equal(isExcluded('node_modules', ['**/node_modules']), true);
  assert.equal(isExcluded('src', ['**/node_modules']), false);
});

test('createFile / createFolder / renameEntry / pathExists 真实文件系统闭环', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, 'new.txt');
    await createFile(filePath);
    assert.equal(await pathExists(filePath), true);

    const folderPath = path.join(dir, 'newFolder');
    await createFolder(folderPath);
    assert.equal(await pathExists(folderPath), true);

    const renamedPath = path.join(dir, 'renamed.txt');
    await renameEntry(filePath, renamedPath);
    assert.equal(await pathExists(filePath), false);
    assert.equal(await pathExists(renamedPath), true);
  });
});

test('createFile 对已存在文件报错（不覆盖）', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, 'exists.txt');
    await createFile(filePath);
    await assert.rejects(() => createFile(filePath));
  });
});
