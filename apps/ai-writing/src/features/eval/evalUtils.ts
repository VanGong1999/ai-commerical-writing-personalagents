export function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

export const TIER_LABEL: Record<string, string> = {
  golden: "黄金集",
  regression: "回归必过",
  challenge: "挑战集",
  bad_case: "错题集",
  patrol: "巡检集",
};

export const VERDICT_TONE: Record<string, "ok" | "warn" | "fail" | "default"> = {
  pass: "ok",
  fail: "fail",
  unknown: "warn",
};
