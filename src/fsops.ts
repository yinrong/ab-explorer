import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface Entry {
  name: string;
  isDir: boolean;
}

const SPECIAL = new Set('.^$+()[]{}|\\'.split(''));

/** 极简 glob→RegExp：支持 `**`（含跨段任意数量目录）、`*`、`?`，用于 files.exclude 里的 basename/glob 项。 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') i++;
        re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (SPECIAL.has(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function isExcluded(name: string, excludeGlobs: string[]): boolean {
  return excludeGlobs.some((g) => globToRegExp(g).test(name));
}

async function isDirectory(fullPath: string): Promise<boolean> {
  try {
    const st = await fs.stat(fullPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** 读取一层目录：目录优先、其后按名称（不分大小写）排序，过滤 excludeGlobs 命中的条目名。 */
export async function readDir(dirPath: string, excludeGlobs: string[] = []): Promise<Entry[]> {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const entries: Entry[] = [];
  for (const d of dirents) {
    if (isExcluded(d.name, excludeGlobs)) continue;
    let isDir = d.isDirectory();
    if (!isDir && d.isSymbolicLink()) {
      isDir = await isDirectory(path.join(dirPath, d.name));
    }
    entries.push({ name: d.name, isDir });
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return entries;
}

export async function createFile(filePath: string): Promise<void> {
  await fs.writeFile(filePath, '', { flag: 'wx' });
}

export async function createFolder(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: false });
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  await fs.rename(oldPath, newPath);
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
