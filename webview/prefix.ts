/** A 区标签前缀压缩：纯函数，不依赖 DOM。 */

export interface LabeledEntry {
  name: string;
  label: string;
  /** 是否本组第一个（显示全名的那个） */
  isGroupStart: boolean;
  /** 本组条目总数（含首个），供上层判断是否需要加分组视觉包裹 */
  groupSize: number;
}

const SEPARATORS = new Set(['-', '_', '.']);

function longestCommonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * a 是 b 的严格前缀（commonLen === a.length 且 b 更长）时的边界前缀：
 * 优先在分隔符上截断——a 本身以分隔符收尾就直接用 a；
 * 否则看 b 紧跟着的下一个字符是不是分隔符，是则连它一起吃掉。
 * 都不是（比如 "foo"+"foobar"，中间没有分隔符）则不构成一组。
 */
function fullMatchPrefix(a: string, b: string): string | null {
  const commonLen = longestCommonPrefixLen(a, b);
  if (commonLen !== a.length || b.length <= commonLen) return null;
  if (SEPARATORS.has(a[commonLen - 1])) return a;
  if (SEPARATORS.has(b[commonLen])) return b.slice(0, commonLen + 1);
  return null;
}

/**
 * a、b 在公共前缀内部就分道扬镳（谁都不是谁的前缀）时，退而求其次：
 * 在公共前缀范围内找最靠右的分隔符，边界前的部分作为这一组的前缀。
 */
function partialMatchPrefix(a: string, b: string): string | null {
  const commonLen = longestCommonPrefixLen(a, b);
  for (let i = commonLen - 1; i >= 0; i--) {
    if (SEPARATORS.has(a[i])) {
      const boundary = i + 1;
      return boundary < b.length ? a.slice(0, boundary) : null;
    }
  }
  return null;
}

/**
 * 输入一组同级目录名，按名排序后分组。
 *
 * 每组第一个（anchor）显示全名。同组内后续条目按“已确立的组前缀”
 * （anchorPrefix，一旦定下就不再变浅）压缩；如果某个条目和链上最近一个
 * 全名之间还能匹配出更深的公共前缀（比如 a/a-b/a-b-1/a-b-2 这种层层嵌套的
 * 编号变体），优先用那个更深的前缀，让标签尽量短。
 *
 * anchorPrefix 一旦确立（组内第一次成功匹配时，不论是 fullMatch 还是
 * partialMatch）就是这一组能接受的最短前缀，之后每一步都不允许比它更浅：
 * partialMatch 可以在链条中途重新触发（比如 a-b-c-1 到 a-b-c-2 之间要退回
 * "a-b-c-" 这个比 anchorPrefix 更深的前缀），但算出来的前缀长度必须
 * ≥ anchorPrefix，否则就不用它、改用 anchorPrefix 本身兜底（reversion）；
 * 两条路都不通就说明真的分道扬镳了。这条“不许变浅”的约束正是防止
 * 3d-man1 的深层子目录被拿去跟 3d-man2 硬凑出一个只共享泛泛前缀 "3d-"
 * 的假分组。
 */
export function compressLabels(names: string[]): LabeledEntry[] {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const result: LabeledEntry[] = [];
  let i = 0;

  while (i < sorted.length) {
    const anchor = sorted[i];
    const startIdx = result.length;
    result.push({ name: anchor, label: anchor, isGroupStart: true, groupSize: 1 });

    let chainRef = anchor;
    let anchorPrefix: string | null = null;
    let j = i + 1;

    while (j < sorted.length) {
      const candidate = sorted[j];
      let prefix = fullMatchPrefix(chainRef, candidate);
      if (!prefix) {
        const partial = partialMatchPrefix(chainRef, candidate);
        if (partial && (anchorPrefix === null || partial.length >= anchorPrefix.length)) {
          prefix = partial;
        }
      }
      if (!prefix && anchorPrefix !== null && candidate.startsWith(anchorPrefix) && candidate.length > anchorPrefix.length) {
        prefix = anchorPrefix;
      }
      if (prefix && anchorPrefix === null) anchorPrefix = prefix;

      if (!prefix || prefix.length < 2) break;

      result.push({ name: candidate, label: '-' + candidate.slice(prefix.length), isGroupStart: false, groupSize: 1 });
      chainRef = candidate;
      j++;
    }

    const groupSize = j - i;
    for (let k = startIdx; k < result.length; k++) result[k].groupSize = groupSize;
    i = j;
  }

  return compactDigitRuns(result);
}

const TRAILING_DIGITS = /^(\D*)(\d+)$/;

/**
 * 组内已经砍掉外层公共前缀之后，剩下的差异部分还可能整体共享同一段字母
 * （比如 "agent1" "agent10" "agent11" ... 全部以 "agent" 开头、后面全是数字），
 * 而这段 "agent" 不落在任何分隔符边界上，主压缩逻辑够不到它。这里做第二遍、
 * 只认"连续同字母前缀 + 纯数字尾巴"这一种形状的收紧：同一分组内、字母前缀
 * 完全相同的连续一串（≥3 个）只留第一个显示完整文字，其余只显示数字。
 * 只处理连续的（不跨断档），断了就分别按各自的短串处理，不强凑。
 */
function compactDigitRuns(entries: LabeledEntry[]): LabeledEntry[] {
  const out: LabeledEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (entry.isGroupStart) {
      out.push(entry);
      i++;
      continue;
    }
    const match = TRAILING_DIGITS.exec(entry.label.slice(1));
    if (!match || match[1].length < 2) {
      out.push(entry);
      i++;
      continue;
    }
    const alpha = match[1];
    let j = i;
    while (j < entries.length && !entries[j].isGroupStart) {
      const m = TRAILING_DIGITS.exec(entries[j].label.slice(1));
      if (!m || m[1] !== alpha) break;
      j++;
    }
    const run = entries.slice(i, j);
    if (run.length >= 3) {
      out.push(run[0]);
      for (let k = 1; k < run.length; k++) {
        const digits = TRAILING_DIGITS.exec(run[k].label.slice(1))![2];
        out.push({ ...run[k], label: '-' + digits });
      }
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
}
