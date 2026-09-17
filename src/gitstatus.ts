import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const CACHE_TTL_MS = 3000;

interface CacheEntry {
  dirty: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

async function isGitRepoRoot(dirPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

function runGitStatus(repoRoot: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain'], { cwd: repoRoot, timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(stdout.trim().length > 0);
    });
  });
}

/** 清掉一个仓库根目录的缓存，外部文件变化时调用，避免展示过期的脏/干净状态。 */
export function invalidateGitStatus(repoRoot: string): void {
  cache.delete(repoRoot);
}

/**
 * 判断某个目录本身是不是一个 git 仓库根（含 .git），是的话有没有未提交改动。
 * 不是仓库根（比如仓库内部的普通子目录）一律返回 false——本插件只标记
 * "这个目录本身是一个有改动的仓库"，不做跨目录的脏文件归属推算。
 * 结果按目录短时缓存，避免同一批 readDir 内对同一路径反复 spawn git 进程。
 */
export async function hasUncommittedChanges(dirPath: string): Promise<boolean> {
  const cached = cache.get(dirPath);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.dirty;

  if (!(await isGitRepoRoot(dirPath))) {
    cache.set(dirPath, { dirty: false, expiresAt: now + CACHE_TTL_MS });
    return false;
  }

  const dirty = await runGitStatus(dirPath);
  cache.set(dirPath, { dirty, expiresAt: now + CACHE_TTL_MS });
  return dirty;
}
