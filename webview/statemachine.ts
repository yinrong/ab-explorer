/**
 * A/B 路径状态机：纯函数，只管 `path`（相对 root 的目录链）的变换。
 * `path.length <= 1` = 模式1（标签导航），`>= 2` = 模式2（逐级下钻）。
 * B 区是否溢出由 webview/main.ts 用真实 DOM 测量决定，这里只提供状态变换。
 */

export type Mode = 'mode1' | 'mode2';

export function mode(path: string[]): Mode {
  return path.length <= 1 ? 'mode1' : 'mode2';
}

/** 点击 A 区第 rowIndex 行的某个标签：截断到该行，替换为所点目录。 */
export function truncateAndSet(path: string[], rowIndex: number, dirName: string): string[] {
  return [...path.slice(0, rowIndex), dirName];
}

/**
 * B 区展开了相对自身树根（即当前 path 对应的目录）路径为 relSegments 的子目录，
 * 且该次展开导致溢出：下钻到该目录，把它变成新的 path（连同它所在层级的祖先）。
 */
export function drillDownTo(path: string[], relSegmentsFromBRoot: string[]): string[] {
  return [...path, ...relSegmentsFromBRoot];
}

/** 尝试回退一级（去掉 path 末段），供 main.ts 在 B 区变矮后逐级试探是否能放得下。 */
export function backOffOne(path: string[]): string[] {
  return path.slice(0, -1);
}

/**
 * 编辑器切换活动文件时，判断当前 path（B 区树根）要不要收回到工作区根：
 * 目标文件已经在当前 B 区子树下就不动 path（不打断用户正在看的层级），
 * 不在的话收回根，让 B 区重新覆盖到这个文件。
 */
export function pathForReveal(path: string[], fileKey: string): string[] {
  const rootKey = path.join('/');
  const withinCurrent = fileKey === rootKey || fileKey.startsWith(rootKey ? rootKey + '/' : '');
  return withinCurrent ? path : [];
}
