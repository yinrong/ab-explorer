import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** 某个目录本身是不是一个 git 仓库根（含 .git）。gitstatus 和 activity 共用这条判断。 */
export async function isGitRepoRoot(dirPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}
