import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { recentCommitCount, invalidateActivity } from '../src/activity.ts';

const run = promisify(execFile);

async function withTempGitRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-explorer-activity-test-'));
  try {
    await run('git', ['init', '-q'], { cwd: dir });
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('非 git 仓库目录活跃度为 0', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ab-explorer-noactivity-test-'));
  try {
    assert.equal(await recentCommitCount(dir), 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('窗口内的提交数按次数累计，不管是谁（含非交互方式）提交的', async () => {
  await withTempGitRepo(async (dir) => {
    invalidateActivity(dir);
    assert.equal(await recentCommitCount(dir), 0);

    await run('git', ['commit', '-q', '--allow-empty', '-m', 'first'], { cwd: dir });
    invalidateActivity(dir);
    assert.equal(await recentCommitCount(dir), 1);

    await run('git', ['commit', '-q', '--allow-empty', '-m', 'second'], { cwd: dir });
    invalidateActivity(dir);
    assert.equal(await recentCommitCount(dir), 2);
  });
});

test('窗口外的旧提交不计入活跃度', async () => {
  await withTempGitRepo(async (dir) => {
    const oldDate = '2000-01-01T00:00:00';
    await run('git', ['commit', '-q', '--allow-empty', '-m', 'ancient', '--date', oldDate], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: oldDate, GIT_COMMITTER_DATE: oldDate },
    });
    invalidateActivity(dir);
    assert.equal(await recentCommitCount(dir), 0);
  });
});
