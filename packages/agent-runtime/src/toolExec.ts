/**
 * 工具执行辅助（ executionMode + read 分页教学）。
 * 纯函数，worker 侧 import 使用。
 */

export type SliceResult = {
  text: string;
  nextOffset: number | null;
  truncated: boolean;
};

/** line-based 分页：offset=起始行(0-based)，limit=最大行数。返回续读游标。 */
export function sliceLines(content: string, offset: number, limit: number): SliceResult {
  const lines = String(content ?? "").split("\n");
  const start = Math.max(0, Math.floor(offset || 0));
  const cap = Math.max(1, Math.floor(limit || 1));
  if (start >= lines.length) {
    return { text: "", nextOffset: null, truncated: false };
  }
  const end = Math.min(lines.length, start + cap);
  const truncated = end < lines.length;
  return {
    text: lines.slice(start, end).join("\n"),
    nextOffset: truncated ? end : null,
    truncated,
  };
}

/**
 * 把工具名序列切成执行批：连续「并行安全」工具归为一批（内部并发），
 * 其余（写/加载/副作用）各自单独成批（串行）。
 */
export function planParallelBatches(
  names: string[],
  isParallelSafe: (name: string) => boolean,
): number[][] {
  const batches: number[][] = [];
  let i = 0;
  while (i < names.length) {
    if (isParallelSafe(names[i]!)) {
      const batch = [i];
      i += 1;
      while (i < names.length && isParallelSafe(names[i]!)) {
        batch.push(i);
        i += 1;
      }
      batches.push(batch);
    } else {
      batches.push([i]);
      i += 1;
    }
  }
  return batches;
}

/**
 * 取「第一个非读（写/加载/副作用）批之前」的可预取读批（size ≥ 2）。
 * 保证不跨越写屏障：写之后的读绝不提前预取，避免读到写之前的旧数据。
 */
export function prefetchableBatchIndices(
  batches: number[][],
  names: string[],
  isRead: (name: string) => boolean,
): number[][] {
  const out: number[][] = [];
  for (const batch of batches) {
    if (!isRead(names[batch[0]!] ?? "")) break;
    if (batch.length >= 2) out.push(batch);
  }
  return out;
}
