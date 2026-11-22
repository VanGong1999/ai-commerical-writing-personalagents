/** 中文大数格式化：<1万原样，1万～1亿用「万」，≥1亿用「亿」，≥1万亿用「万亿」。 */
export function formatCnNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_0000_0000_0000) {
    return `${sign}${trimZero((abs / 1_0000_0000_0000).toFixed(digits))}万亿`;
  }
  if (abs >= 1_0000_0000) {
    return `${sign}${trimZero((abs / 1_0000_0000).toFixed(digits))}亿`;
  }
  if (abs >= 1_0000) {
    return `${sign}${trimZero((abs / 1_0000).toFixed(digits))}万`;
  }
  return `${sign}${trimZero(abs.toFixed(abs >= 100 ? 0 : digits))}`;
}

/** 人民币格式化：小金额保留 2 位，大金额按 万/亿 缩放。 */
export function formatCnYuan(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "未配置单价";
  const abs = Math.abs(n);
  if (abs >= 1_0000_0000) return `¥${formatCnNumber(n, 2)}`;
  if (abs >= 1_0000) return `¥${formatCnNumber(n, 2)}`;
  return `¥${n.toFixed(2)}`;
}

function trimZero(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}
