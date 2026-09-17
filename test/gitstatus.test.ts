import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { hasUncommittedChanges, invalidateGitStatus } from '../src/gitstatus.ts';

const run = promisify(execFile);

async function withTempGitRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-explorer-git-test-'));
  try {
    await run('git', ['init', '-q'], { cwd: dir });
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('非 git 仓库目录一律判定为非脏', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-explorer-nogit-test-'));
  try {
    assert.equal(await hasUncommittedChanges(dir), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('干净的 git 仓库判定为非脏', async () => {
  await withTempGitRepo(async (dir) => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello');
    await run('git', ['add', '.'], { cwd: dir });
    await run('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    invalidateGitStatus(dir);
    assert.equal(await hasUncommittedChanges(dir), false);
  });
});

test('有未提交改动（含未跟踪新文件）的仓库判定为脏', async () => {
  await withTempGitRepo(async (dir) => {
    await run('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
    invalidateGitStatus(dir);
    assert.equal(await hasUncommittedChanges(dir), false);

    await fs.writeFile(path.join(dir, 'untracked.txt'), 'x');
    invalidateGitStatus(dir);
    assert.equal(await hasUncommittedChanges(dir), true);
  });
});

test('短 TTL 缓存：同一时间窗口内不重复判定文件系统的新变化', async () => {
  await withTempGitRepo(async (dir) => {
    await run('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
    invalidateGitStatus(dir);
    assert.equal(await hasUncommittedChanges(dir), false);

    await fs.writeFile(path.join(dir, 'untracked.txt'), 'x');
    // 未失效缓存，短时间内仍读到旧的“非脏”结果
    assert.equal(await hasUncommittedChanges(dir), false);

    invalidateGitStatus(dir);
    assert.equal(await hasUncommittedChanges(dir), true);
  });
});
