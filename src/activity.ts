import { execFile } from 'node:child_process';
import { isGitRepoRoot } from './gitrepo.ts';

const CACHE_TTL_MS = 30000;
const WINDOW_DAYS = 14;

interface CacheEntry {
  count: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function runCommitCount(repoRoot: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['log', `--since=${WINDOW_DAYS}.days`, '--oneline'],
      { cwd: repoRoot, timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(0);
          return;
        }
        const trimmed = stdout.trim();
        resolve(trimmed.length === 0 ? 0 : trimmed.split('\n').length);
      },
    );
  });
}

/** 清掉一个仓库根目录的活跃度缓存，外部文件变化时调用。 */
export function invalidateActivity(repoRoot: string): void {
  cache.delete(repoRoot);
}

/**
 * 最近 WINDOW_DAYS 天内的提交数——用来衡量"这个目录最近有没有人在忙"，
 * 不管这些提交是在 VS Code 里点出来的，还是 AI/CLI 在编辑器之外直接改代码、
 * 跑 git commit 产生的，只要落进了 git 历史就算数。这正是 A 区频率着色
 * 需要覆盖到的那部分"看不见的点击"。
 * 不是仓库根目录一律返回 0；缓存 30 秒（比 git status 的 3 秒长，
 * 提交历史的变化频率本来就低于工作区状态）。
 */
export async function recentCommitCount(dirPath: string): Promise<number> {
  const cached = cache.get(dirPath);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.count;

  if (!(await isGitRepoRoot(dirPath))) {
    cache.set(dirPath, { count: 0, expiresAt: now + CACHE_TTL_MS });
    return 0;
  }

  const count = await runCommitCount(dirPath);
  cache.set(dirPath, { count, expiresAt: now + CACHE_TTL_MS });
  return count;
}
