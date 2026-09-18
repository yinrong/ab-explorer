/** 访问频率 → 着色强度：纯函数，不依赖 DOM。 */

/**
 * 把访问次数换算成 [0, 1] 的着色强度，用于和某个固定色系混色。
 * 用平方根压缩（而非线性）：避免极少数被访问几十次的目录把其余
 * 目录全部拉到强度 0 附近，看不出彼此的差别。
 */
export function visitIntensity(count: number, maxCount: number): number {
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(maxCount) || maxCount <= 0) return 0;
  const capped = Math.min(count, maxCount);
  return Math.sqrt(capped / maxCount);
}
