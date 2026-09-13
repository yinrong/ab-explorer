/** A 区标签前缀压缩：纯函数，不依赖 DOM。 */

export interface LabeledEntry {
  name: string;
  label: string;
  /** 是否本组第一个（显示全名的那个） */
  isGroupStart: boolean;
}

const SEPARATORS = new Set(['-', '_', '.']);

function longestCommonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/** 在 [0, commonLen) 范围内找最靠右的分隔符，返回“紧跟其后”的下标；找不到返回 0。 */
function boundaryPrefixLen(base: string, commonLen: number): number {
  for (let i = commonLen - 1; i >= 0; i--) {
    if (SEPARATORS.has(base[i])) return i + 1;
  }
  return 0;
}

/**
 * 输入一组同级目录名，按名排序后分组：组内第一个显示全名，
 * 其余若与组基名有 ≥2 字符、且落在分隔符边界上的公共前缀，只显示 `-差异部分`。
 */
export function compressLabels(names: string[]): LabeledEntry[] {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const result: LabeledEntry[] = [];
  let groupBase: string | null = null;

  for (const name of sorted) {
    if (groupBase !== null) {
      const commonLen = longestCommonPrefixLen(groupBase, name);
      const prefixLen = boundaryPrefixLen(groupBase, commonLen);
      if (prefixLen >= 2 && prefixLen < name.length) {
        result.push({ name, label: '-' + name.slice(prefixLen), isGroupStart: false });
        continue;
      }
    }
    result.push({ name, label: name, isGroupStart: true });
    groupBase = name;
  }
  return result;
}
