/**
 * 工具名解析层：统一「注册表点号名」与「原生函数下划线名」两套命名。
 * 根因：skills/agent catalog 用 artifact.create / bible.read 等点号名，
 *       而发给模型的 function 名是 artifact_create / bible_read。
 *       弱模型照着 SKILL 文本直接发起原生调用（带点号），就会被判 unknown_tool。
 */

/** 归一化：去空白、点变下划线、转小写。 */
export function normalizeToolName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\./g, "_")
    .toLowerCase();
}

/** Levenshtein 编辑距离（小写、去点）。 */
export function editDistance(a, b) {
  const x = normalizeToolName(a);
  const y = normalizeToolName(b);
  if (x === y) return 0;
  const rows = x.length + 1;
  const cols = y.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[x.length][y.length];
}

/** 返回与 name 最接近的 k 个候选工具名。 */
export function closestToolNames(catalogNames, name, k = 3) {
  const target = normalizeToolName(name);
  if (!target) return [];
  const targetFamily = target.split("_")[0];
  return [...catalogNames]
    .map((candidate) => {
      const norm = normalizeToolName(candidate);
      const dist = editDistance(target, candidate);
      // 同一「家族」前缀（如 memory_*）优先，其次编辑距离。
      const score = dist - (norm.startsWith(`${targetFamily}_`) ? 1.5 : 0);
      return { name: candidate, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, k)
    .map((item) => item.name);
}

/**
 * 建「归一化名 → 工具」索引，支持两种写法：
 * artifact.create / artifact_create / Artifact.Create 全部命中同一个工具。
 */
export function buildToolIndex(tools) {
  const index = new Map();
  for (const tool of tools || []) {
    if (!tool || !tool.name) continue;
    index.set(tool.name, tool);
    index.set(normalizeToolName(tool.name), tool);
  }
  return index;
}

/** 按任意写法（点号/下划线/大小写）查工具。 */
export function lookupTool(index, name) {
  if (!index) return undefined;
  return index.get(normalizeToolName(name));
}

/** 未知工具的标准回喂文案（带 did-you-mean 与走发现链的指引）。 */
export function unknownToolMessage(name, catalogNames, visibleNames, hits = 0) {
  const close = closestToolNames(catalogNames, name, 3);
  const visible = visibleNames || [];
  const lines = [
    `工具「${name}」未注册，本次调用没有执行。`,
    close.length
      ? `最接近的可用工具：${close.join(" / ")}（点号名调用时请写成下划线：artifact.create → artifact_create）`
      : "没有任何名字接近的工具，请勿再试同名调用。",
    visible.length
      ? `当前已直接暴露的函数：${visible.slice(0, 14).join(", ")}${visible.length > 14 ? " …" : ""}`
      : "",
    "其他工具请走 tool_search（关键词）；命中后下一轮会自动加载，直接按函数名调用；禁止编造工具名。",
    hits > 0 ? `已连续 ${hits} 次调用未注册工具，第 4 次将熔断中止本次运行。` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
