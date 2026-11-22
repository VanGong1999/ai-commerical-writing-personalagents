import { codepointCount, hasJsonContent, checkCoreHookAdoption as checkAdoption, checkPromptLock, RUNTIME_CORE_HOOK_PROFILE } from "../../domain/src/gateRules.ts";
import type { GateCheck } from "./types.js";
import {
  checkChunkPolicy,
  checkFormatSelected,
  checkGraphConsistency,
  checkHookPresence,
  checkLengthBand,
  checkLengthDecay,
  checkLogicAck,
  checkLogline100Ack,
  checkPitchFourPack,
  checkOutlineNoEvenActs,
  checkOocHeuristic,
} from "./gates.ts";

function check(
  id: string,
  name: string,
  result: GateCheck["result"],
  message: string,
): GateCheck {
  return { id, name, result, message };
}

/** 已知首字母缩写，保证 snake_case → CamelCase 后仍匹配 switch 的 case 名。 */
const GATE_ACRONYMS: Record<string, string> = {
  ai: "AI",
  deai: "DeAI",
  ooc: "OOC",
  ep1: "Ep1",
  ip: "IP",
  qc: "QC",
  yy: "YY",
};

/**
 * snake_case / kebab-case → CamelCase（如 `format_selected` → `FormatSelected`）。
 * 已是 CamelCase（含大写且无分隔符）时原样返回，避免二次变形破坏 `DeAI` 等词。
 */
export function normalizeGateName(name: string): string {
  if (!name) return name;
  const trimmed = name.trim();
  if (trimmed === "Format") return "FormatSelected";
  if (!/[_\s-]/.test(trimmed) && /[A-Z]/.test(trimmed)) return trimmed;
  const camel = trimmed
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((seg) => {
      const lower = seg.toLowerCase();
      if (GATE_ACRONYMS[lower]) return GATE_ACRONYMS[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
  // 短别名归一：模型常见只给单词（Chunk/Schema/Length…），映射到完整 Gate 名
  const ALIASES: Record<string, string> = {
    Chunk: "ChunkPolicy",
    Schema: "Schema",
    Length: "LengthBand",
    Decay: "LengthDecay",
    Scene: "SceneCount",
    Novelization: "Novelization",
    Deai: "DeAIChecklist",
    Format: "FormatSelected",
    PromptLock: "PromptLock",
  };
  return ALIASES[camel] ?? camel;
}

/** 场三件事：目标/冲突/转机 */
export function checkSceneTriple(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const goal = String(b.goal || b["目标"] || "").trim();
  const conflict = String(b.conflict || b["冲突"] || "").trim();
  const turn = String(b.turn || b["转机"] || b.turning || "").trim();
  const missing: string[] = [];
  if (!goal) missing.push("目标");
  if (!conflict) missing.push("冲突");
  if (!turn) missing.push("转机");
  if (missing.length) {
    return check("scene_triple", "场三件事", "fail", `缺少：${missing.join("、")}`);
  }
  return check("scene_triple", "场三件事", "pass", "目标/冲突/转机齐全");
}

export function checkBeatCompleteness(
  beats?: unknown[] | null,
  expect = 20,
): GateCheck {
  const list = beats || [];
  if (list.length < expect) {
    return check("beat_completeness", "二十节拍完整", "fail", `节拍数 ${list.length} < ${expect}`);
  }
  let empty = 0;
  for (const b of list) {
    if (typeof b === "object" && b) {
      const o = b as Record<string, unknown>;
      const text = String(o.summary || o.content || o.text || "").trim();
      if (!text) empty += 1;
    } else if (!String(b || "").trim()) {
      empty += 1;
    }
  }
  if (empty) return check("beat_completeness", "二十节拍完整", "fail", `空拍 ${empty} 个`);
  return check("beat_completeness", "二十节拍完整", "pass", `节拍 ${list.length} 齐全`);
}

export function checkPaywallCoverage(slots?: unknown[] | null, minSlots = 3): GateCheck {
  const filled = (slots || []).filter((s) => String(s || "").trim());
  if (filled.length < minSlots) {
    return check(
      "paywall_coverage",
      "付费点覆盖",
      "fail",
      `付费/卡点槽位 ${filled.length} < ${minSlots}`,
    );
  }
  return check("paywall_coverage", "付费点覆盖", "pass", `已标 ${filled.length} 个付费/卡点`);
}

export function checkShellGate(shell?: string | null): GateCheck {
  const raw = shell || "";
  for (const a of ["升级", "复仇", "情感", "身份"]) {
    if (raw.includes(a)) return check("shell", "故事壳", "pass", `壳类型：${a}`);
  }
  const s = raw.trim().toLowerCase();
  if (["upgrade", "revenge", "emotion", "identity"].includes(s)) {
    return check("shell", "故事壳", "pass", `壳类型：${shell}`);
  }
  return check("shell", "故事壳", "fail", "未选定合法故事壳（升级/复仇/情感/身份）");
}

export function checkPayMotive(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const want = String(b.want || b["想看"] || "").trim();
  const how = String(b.how || b["怎么看"] || "").trim();
  const via = String(b.via_what || b.via || b["靠什么"] || "").trim();
  if (!(want && how && via)) {
    return check("pay_motive", "付费动机三问", "fail", "想看/怎么看/靠什么未齐");
  }
  return check("pay_motive", "付费动机三问", "pass", "选题三问齐全");
}

export function checkRedlineHard(text = ""): GateCheck {
  const patterns = [
    /未成年.{0,8}(性爱|色情|裸体)/,
    /(详细|具体).{0,6}(制毒|炸弹制作)/,
    /美化.{0,4}(自杀|自残)/,
  ];
  for (const pat of patterns) {
    const match = pat.exec(text);
    if (match) {
      return check("redline_hard", "硬红线", "warn", `待结合语境判断：「${match[0]}」`);
    }
  }
  return check("redline_hard", "硬红线", "pass", "未命中硬红线模式");
}

export function checkOnePlusOne(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  let openHooks: unknown = b.open_hooks || b["悬念"] || b.hooks || [];
  if (typeof openHooks === "string") {
    openHooks = openHooks.split(/[,，;；\n]/).map((x) => x.trim()).filter(Boolean);
  }
  const list = Array.isArray(openHooks) ? openHooks : [];
  if (list.length < 2) {
    return check("one_plus_one", "悬念一加一", "fail", "未闭合悬念少于 2");
  }
  return check("one_plus_one", "悬念一加一", "pass", `未闭合悬念 ${list.length} 个`);
}

export function checkGenderPath(path?: string | null): GateCheck {
  const p = (path || "").trim().toLowerCase();
  if (["male", "female", "男频", "女频", "m", "f"].includes(p)) {
    return check("gender_path", "男女频路径", "pass", `路径：${path}`);
  }
  return check("gender_path", "男女频路径", "fail", "未锁定男频/女频路径");
}

export function checkHumanConfirm(acked: boolean): GateCheck {
  if (acked !== true) {
    return check("human_confirm", "人工确认", "fail", "关键节点需人工确认，不可自动绿");
  }
  return check("human_confirm", "人工确认", "pass", "人工已确认");
}

export function checkPitchCompleteness(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const alts: Record<string, string[]> = {
    logline: ["logline", "导语", "一句话简介"],
    synopsis: ["synopsis", "大纲", "故事大纲"],
    characters: ["characters", "人物", "小传"],
  };
  const missing: string[] = [];
  for (const [key, keys] of Object.entries(alts)) {
    if (!keys.some((k) => String(b[k] || "").trim())) missing.push(key);
  }
  if (missing.length) {
    return check("pitch_completeness", "投稿包完整", "fail", `缺：${missing.join("、")}`);
  }
  return check("pitch_completeness", "投稿包完整", "pass", "导语/大纲/人物齐全");
}

export function checkGenreTrim(genre?: string | null, blacklist?: string[]): GateCheck {
  if (genre != null && typeof genre !== "string") throw new TypeError("genre 应为题材原文字符串");
  if (blacklist != null && (!Array.isArray(blacklist) || !blacklist.every(item => typeof item === "string"))) {
    throw new TypeError("blacklist 应为参考词字符串数组");
  }
  if (!genre?.trim()) return check("genre_trim", "题材参考", "warn", "未评估：没有明确题材。可跳过此项；如作者已选定，请传 payload.genre 原文。");
  const matches = (blacklist ?? ["时政硬伤", "美化犯罪教程"]).filter(item => item.trim() && genre.includes(item));
  const observation = matches.length ? `参考词匹配：${matches.join("、")}` : "所查参考词无匹配";
  return check("genre_trim", "题材参考", matches.length ? "warn" : "pass",
    `题材原文「${genre}」。${observation}。行情与具体内容须另行核实。`);
}

export function checkCourseShell(body: Record<string, unknown>, reviewPairing = false): GateCheck {
  const turns = new Map([["人物","成长回自己"],["目标","假目标真目标"],["困境","错应对对应对"],["奇遇","红利代价"],["谜题","找答案→解谜面"]]);
  const valid = typeof body.story_shell === "string" && turns.has(body.story_shell)
    && typeof body.midpoint_type === "string" && [...turns.values()].includes(body.midpoint_type)
    && typeof body.shell_reason === "string" && codepointCount(body.shell_reason.trim()) > 0
    && (body.pay_model === "重付费" || body.pay_model === "轻付费");
  if (!valid) return check("course_shell", "故事壳字段", "fail", "检查 topic_card 的 story_shell、shell_reason、pay_model、midpoint_type");
  if (reviewPairing && (turns.get(String(body.story_shell)) !== body.midpoint_type ||
      (body.story_shell === "谜题" && body.pay_model === "重付费"))) {
    return check("course_shell", "故事壳选型", "warn", `${body.pay_model} / ${body.story_shell} / ${body.midpoint_type}：可核对揭示节奏与选型理由`);
  }
  return check("course_shell", "故事壳字段", "pass", "故事壳、理由、付费模式与中点字段齐全");
}

export function checkEightTropeCoverage(
  tropes?: unknown[] | null,
  minHit = 3,
): GateCheck {
  if (!tropes) return check("eight_trope_coverage", "八桥段覆盖", "warn", "未提供标签，覆盖未评估");
  const hits = [
    ...new Set(
      (tropes || [])
        .map((t) => String(t || "").trim())
        .filter(Boolean),
    ),
  ];
  if (hits.length >= minHit) {
    return check("eight_trope_coverage", "八桥段覆盖", "pass", `提供了 ${hits.length} 个不同标签`);
  }
  return check(
    "eight_trope_coverage",
    "八桥段覆盖",
    "warn",
    `提供了 ${hits.length} 个不同标签（参考值 ${minHit}），可说明本场无适用标签`,
  );
}

/** Numeric beat-position contract retained for Python callers. */
export function checkMidpointIndex(index?: number | null, total = 20): GateCheck {
  if (index == null) return check("midpoint_position", "中点位置", "fail", "未标注中点节拍序号");
  const lo = Math.max(1, Math.trunc(total * 0.4));
  const hi = Math.min(total, Math.trunc(total * 0.6) + 1);
  return Math.trunc(index) >= lo && Math.trunc(index) <= hi
    ? check("midpoint_position", "中点位置", "pass", `中点在第 ${index} 拍`)
    : check("midpoint_position", "中点位置", "warn", `中点第 ${index} 拍偏离建议区间 [${lo},${hi}]`);
}

export function checkMidpointPosition(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const mid = String(b.midpoint || b.type || b["中点"] || "").trim();
  const ok = /^[1-5]$/.test(mid) || ["身份反转", "目标升级", "盟友背叛", "真相半露", "代价结算"].some(
    (x) => mid.includes(x),
  );
  if (!ok) {
    return check("midpoint_position", "中点五型", "fail", "未定位中点五型之一");
  }
  return check("midpoint_position", "中点五型", "pass", `中点：${mid}`);
}

export function checkSimilarityRisk(score?: number | null, threshold = 0.72): GateCheck {
  if (score == null || Number.isNaN(Number(score))) {
    return check("similarity_risk", "相似度风险", "warn", "缺少对照样本或分数，重合未评估");
  }
  const s = Number(score);
  if (s >= threshold) {
    return check("similarity_risk", "相似度风险", "warn", `重合分 ${s.toFixed(2)} ≥ ${threshold}，可核查公用语句、引文和署名`);
  }
  if (s >= threshold - 0.12) {
    return check("similarity_risk", "相似度风险", "warn", `相似度 ${s.toFixed(2)} 接近参考线，可查看重合原句`);
  }
  return check("similarity_risk", "相似度风险", "pass", `相似度 ${s.toFixed(2)}，低于参考线`);
}

export function checkLocationBudget(uniqueCount?: number | null, maxLoc = 12): GateCheck {
  const n = Number(uniqueCount ?? 0);
  if (n > maxLoc) {
    return check("location_budget", "地点预算", "fail", `独立地点 ${n} > ${maxLoc}，请合并`);
  }
  return check("location_budget", "地点预算", "pass", `独立地点 ${n} ≤ ${maxLoc}`);
}

/** 单集独立能打：场头 + 三件套 + 可剪线索，起承转合以事件密度兜底。 */
export const SCENE_SCRIPT_MIN_CHARS = 120;

export function sceneScriptLength(body?: Record<string, unknown> | null): number {
  return codepointCount(String(body?.script_body || body?.scriptBody || "").trim());
}

export const sceneBodyContract = `请把以下字段作为 bodyJson 对象提交：{"scene_header":"场次|地点|内外|时间","triple":{"info":"新信息","progress":"推进","change":"变化"},"script_body":"实际剧本正文（至少${SCENE_SCRIPT_MIN_CHARS}字）","clip_candidate":"可剪线索"}，各字段值必须为非空字符串。`;

export function checkSavedScene(body?: Record<string, unknown> | null): GateCheck {
  const triple = body?.triple as Record<string, unknown> | undefined;
  const fields = [body?.scene_header, body?.script_body, body?.clip_candidate, triple?.info, triple?.progress, triple?.change];
  if (fields.every(value => typeof value === "string" && value.trim())) {
    const result = checkEpisodeStandalone(body);
    if (result.result === "pass") return result;
  }
  return check("episode_standalone", "单集独立能打", "fail", sceneBodyContract);
}

export function checkEpisodeStandalone(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const header = String(b.scene_header || b.sceneHeader || "").trim();
  const triple = (b.triple || {}) as Record<string, unknown>;
  const clip = String(b.clip_candidate || b.clipCandidate || "").trim();
  const tripleOk = ["info", "progress", "change"].every(
    (k) => codepointCount(String(triple[k] || "").trim()) > 0,
  );
  if (!header || !tripleOk || !clip || sceneScriptLength(b) < SCENE_SCRIPT_MIN_CHARS) {
    return check(
      "episode_standalone",
      "单集独立能打",
      "fail",
      `需场头 + 三件套齐全 + 可剪线索 + 剧本正文≥${SCENE_SCRIPT_MIN_CHARS}字`,
    );
  }
  return check("episode_standalone", "单集独立能打", "pass", "场级原子完整");
}

/** 台词三层：态度 / 信息 / 潜台词 */
export function checkDialogueFormula(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const attitude = String(b.attitude || b["态度"] || "").trim();
  const info = String(b.info || b["信息"] || "").trim();
  const subtext = String(b.subtext || b["潜台词"] || "").trim();
  const missing: string[] = [];
  if (!attitude) missing.push("态度");
  if (!info) missing.push("信息");
  if (!subtext) missing.push("潜台词");
  if (missing.length) {
    return check("dialogue_formula", "台词三层", "fail", `缺少：${missing.join("、")}`);
  }
  return check("dialogue_formula", "台词三层", "pass", "态度/信息/潜台词齐全");
}

/** 声口重合统计供作者复核 */
export function checkVoiceDiversity(score?: number | null, threshold = 0.45): GateCheck {
  if (score == null || Number.isNaN(Number(score))) {
    return check("voice_diversity", "声口多样性", "warn", "未提供重合分，声口未评估");
  }
  const s = Number(score);
  if (s >= threshold) {
    return check("voice_diversity", "声口多样性", "warn", `声口重合 ${s.toFixed(2)} ≥ ${threshold}，可对照证词、引述等重复语境`);
  }
  return check("voice_diversity", "声口多样性", "pass", `声口重合 ${s.toFixed(2)}`);
}

/** 女频全知叙事风险：是否误用上帝视角剧透关键反转 */
export function checkFemaleOmniscience(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const flagged = Boolean(b.omniscientLeak || b["全知剧透"]);
  const text = String(b.text || "");
  const leakHint = /读者都知道|其实真相是|她不知道的是/.test(text);
  if (flagged || leakHint) {
    return check(
      "female_omniscience",
      "女频全知风险",
      "fail",
      "疑似全知剧透关键反转，请改为限制视角或延后揭示",
    );
  }
  return check("female_omniscience", "女频全知风险", "pass", "未检出全知剧透模式");
}

/** 记录作者提供的剂量、语境和人数，供对照具体场面。 */
export function checkComedyDose(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const castCount = b.comedy_cast_count ?? b.comedyCastCount ?? b.喜剧人物数;
  const facts = [b.dose ?? b.剂量, b.pay_model ?? b.payModel ?? b.付费模式,
    b.yy_intensity ?? b.yyIntensity ?? b.YY强度,
    castCount == null ? undefined : `喜剧人物 ${castCount}`,
    b.wholeComedy === true ? "全剧喜剧" : undefined, b.strongYy === true ? "标记强 YY" : undefined]
    .filter(x => x != null && x !== "");
  const inserts = b.comedy_inserts ?? b.comedyInserts ?? b.inserts;
  if (Array.isArray(inserts)) facts.push(`插入点 ${inserts.length} 个`);
  return check("comedy_dose", "喜剧剂量", "warn", facts.length
    ? `已提供：${facts.join(" / ")}。可按作者的剂量要求核对具体场面。`
    : "未提供剂量或场面信息，未评估");
}

/** 关系驱动：双方动机 + 冲突升级点 */
export function checkRelationDriver(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const aMotive = String(
    b.a_motive || b.aMotive || b.motiveA || b["甲方动机"] || b["动机A"] || "",
  ).trim();
  const bMotive = String(
    b.b_motive || b.bMotive || b.motiveB || b["乙方动机"] || b["动机B"] || "",
  ).trim();
  const escalation = String(
    b.escalation || b.conflict_escalation || b.conflictEscalation || b["冲突升级"] || "",
  ).trim();
  const edges = (b.edges || b.relations || []) as unknown[];
  const missing: string[] = [];
  if (!aMotive && !edges.length) missing.push("甲方动机");
  if (!bMotive && !edges.length) missing.push("乙方动机");
  if (!escalation) {
    const edgeEsc = edges.some((e) => {
      const row = (e || {}) as Record<string, unknown>;
      return Boolean(
        String(row.escalation || row.conflict || row.relation || "").trim(),
      );
    });
    if (!edgeEsc) missing.push("冲突升级点");
  }
  if (missing.length) {
    return check("relation_driver", "关系驱动", "fail", `缺少：${missing.join("、")}`);
  }
  return check("relation_driver", "关系驱动", "pass", "双方动机与冲突升级齐全");
}

/** 短剧主壳=谜题时须有强理由，否则拦截改前四壳 */
export function checkPuzzleShell(body?: Record<string, unknown> | null): GateCheck {
  const shell = String(body?.shell || body?.主壳 || "").trim();
  const isPuzzle = /谜题|puzzle/i.test(shell);
  if (!isPuzzle) {
    return check("puzzle_shell", "谜题壳闸", "pass", "非谜题壳，跳过");
  }
  const reason = String(body?.puzzleReason || body?.谜题理由 || body?.reason || "").trim();
  if (codepointCount(reason) < 12) {
    return check(
      "puzzle_shell",
      "谜题壳闸",
      "fail",
      "选了谜题壳但缺少≥12字强理由；默认改用前四壳（升级/反套路/后悔/追妻）",
    );
  }
  return check("puzzle_shell", "谜题壳闸", "pass", "谜题壳理由充分");
}

/** 可选规则篇幅统计。 */
export function checkGoldFingerMinimal(body?: Record<string, unknown> | null): GateCheck {
  const rule = String(
    body?.goldFinger || body?.金手指 || body?.rule || body?.rules || "",
  ).trim();
  const fieldCount = body?.ruleFieldCount ?? body?.字段数;
  const fieldDetail = fieldCount == null ? "" : `，提供的字段数 ${fieldCount}`;
  if (!rule) {
    return check("gold_finger_minimal", "金手指极简", "warn", `缺少能力规则，篇幅未评估${fieldDetail}`);
  }
  const size = `规则字数 ${codepointCount(rule)}${fieldDetail}`;
  if (Number(fieldCount) > 5 || codepointCount(rule) > 280) {
    return check(
      "gold_finger_minimal",
      "金手指极简",
      "warn",
      `${size}，可区分核心机制与附录示例`,
    );
  }
  return check("gold_finger_minimal", "金手指极简", "pass", size);
}

/** 区分总项数与已标注的主次设定。 */
export function checkSettingCap(
  body?: Record<string, unknown> | null,
  maxSettings = 2,
): GateCheck {
  const settings = body?.settings ?? body?.settings_found ?? body?.设定;
  const count = Array.isArray(settings) ? settings.filter(Boolean).length : body?.settingCount ?? body?.设定数;
  if (count == null) return check("setting_cap", "设定数量", "warn", "缺少设定清单或数量，未评估");
  const labels = Array.isArray(settings) ? settings.filter(s => typeof s?.is_main === "boolean") : [];
  const main = labels.filter(s => s.is_main).length;
  const detail = labels.length ? `，其中已标主要 ${main}、次要 ${labels.length - main}` : "";
  return check("setting_cap", "设定数量", Number(count) > maxSettings ? "warn" : "pass",
    `共 ${count} 项${detail}；参考值 ${maxSettings}，可结合作者指定的主设定上限复核`);
}

/** 短剧经典叙事：一主角一视角 */
export function checkClassicNarrative(body?: Record<string, unknown> | null): GateCheck {
  const leads = (body?.leads as unknown[]) || (body?.主角 as unknown[]) || [];
  const leadCount =
    Array.isArray(leads) && leads.length
      ? leads.filter(Boolean).length
      : Number(body?.leadCount ?? body?.主角数 ?? 1);
  const multiPov = Boolean(body?.multiPov || body?.多视角);
  if (leadCount > 1 || multiPov) {
    return check(
      "classic_narrative",
      "经典叙事锁",
      "fail",
      "短剧须一主角一视角；多主角/多线请砍到唯一创作视角",
    );
  }
  return check("classic_narrative", "经典叙事锁", "pass", "一主角一视角");
}

/** 悲剧过载劝退（警告级） */
export function checkTragedyBudget(body?: Record<string, unknown> | null): GateCheck {
  const ratio = Number(body?.tragedyRatio ?? body?.悲剧占比 ?? body?.score ?? -1);
  if (ratio < 0) {
    return check("tragedy_budget", "悲剧预算", "inconclusive", "未提供悲剧占比");
  }
  if (ratio >= 0.7) {
    return check(
      "tragedy_budget",
      "悲剧预算",
      "warn",
      `悲剧占比 ${ratio} ≥ 0.7，易劝退；请插入爽点/喘息`,
    );
  }
  return check("tragedy_budget", "悲剧预算", "pass", `悲剧占比 ${ratio}`);
}

/** 无铺垫开挂（警告/失败可配） */
export function checkAntiDeus(body?: Record<string, unknown> | null): GateCheck {
  const text = String(body?.text || "").trim();
  const planted = Boolean(body?.planted || body?.已铺垫);
  const suddenPower = Boolean(body?.suddenPower || body?.无铺垫开挂);
  const patterns = /突然觉醒|毫无征兆地|凭空获得|系统直接给了/;
  if (suddenPower || (text && patterns.test(text) && !planted)) {
    return check(
      "anti_deus",
      "反机械降神",
      "fail",
      "疑似无铺垫开挂；须补装逼四前提或前置伏笔",
    );
  }
  return check("anti_deus", "反机械降神", "pass", "未检出无铺垫开挂");
}

/** Tell 不 Show：直述情绪密度 */
export function checkShowDontTell(text = "", threshold = 3): GateCheck {
  const tells = [
    /他很愤怒/g,
    /她很伤心/g,
    /他很高兴/g,
    /气氛很紧张/g,
    /心里很.*?/g,
    /感到非常/g,
    /十分难过/g,
    /终于明白了/g,
  ];
  let hits = 0;
  for (const re of tells) {
    const m = text.match(re);
    if (m) hits += m.length;
  }
  if (hits >= threshold) {
    return check(
      "show_dont_tell",
      "展示非告知",
      "warn",
      `检出 Tell 句 ${hits} 处（阈值 ${threshold}）；请外化动作/神态`,
    );
  }
  return check("show_dont_tell", "展示非告知", "pass", `Tell 句 ${hits} 处`);
}

/** 热点须绑定情绪冲突 */
export function checkHotTopicDepth(body?: Record<string, unknown> | null): GateCheck {
  const hotspot = String(body?.hotspot || body?.热点 || "").trim();
  const emotion = String(body?.emotion || body?.情绪核 || body?.conflict || "").trim();
  if (!hotspot) {
    return check("hot_topic_depth", "热点深度", "inconclusive", "未提供热点");
  }
  if (!emotion || codepointCount(emotion) < 4) {
    return check(
      "hot_topic_depth",
      "热点深度",
      "fail",
      "热点未绑定情绪冲突（空蹭）；须写清谁因何冲突",
    );
  }
  return check("hot_topic_depth", "热点深度", "pass", "热点已绑情绪核");
}

/** 漫剧格式合同：须像分镜/画面+台词，而非纯小说 */
export function checkFormatContract(
  text = "",
  format?: string | null,
): GateCheck {
  if (format && format !== "manju") {
    return check("format_contract", "格式合同", "pass", `格式 ${format} 跳过漫剧合同`);
  }
  const hasShot = /分镜|画面|【|镜头/.test(text);
  const novelish = (text.match(/心中暗想|不禁想到|宛如|涌上心头/g) || []).length;
  if (codepointCount(text.trim()) > 200 && !hasShot && novelish >= 2) {
    return check(
      "format_contract",
      "格式合同",
      "fail",
      "漫剧稿偏小说化且无分镜标记；请改画面+台词",
    );
  }
  return check("format_contract", "格式合同", "pass", "格式合同可接受");
}

/** 核心梗字段齐全 */
export function checkCoreHookComplete(body?: Record<string, unknown> | null): GateCheck {
  const need = ["世界观", "身份反差", "金手指", "追剧点"];
  const keys = [
    ["world", "世界观", "worldview"],
    ["identity", "身份反差", "identityGap"],
    ["goldFinger", "金手指", "power"],
    ["hook", "追剧点", "coreAction"],
  ];
  const missing: string[] = [];
  keys.forEach((alts, i) => {
    const ok = alts.some((k) => String(body?.[k] || "").trim());
    if (!ok) missing.push(need[i]);
  });
  if (missing.length) {
    return check(
      "core_hook_complete",
      "核心梗齐全",
      "fail",
      `缺字段：${missing.join("、")}`,
    );
  }
  return check("core_hook_complete", "核心梗齐全", "pass", "四步字段齐全");
}

/** 台词长度闸（漫剧常见 ≤500） */
export function checkDialogueLen(text = "", maxChars = 500): GateCheck {
  const n = codepointCount(text.trim());
  if (n > maxChars) {
    return check(
      "dialogue_len",
      "台词长度",
      "fail",
      `台词/旁白合计 ${n} > ${maxChars}`,
    );
  }
  return check("dialogue_len", "台词长度", "pass", `长度 ${n} ≤ ${maxChars}`);
}

/** 结构字段齐全（与 Python check_schema_fields 对齐） */
export function checkSchemaFields(
  body?: Record<string, unknown> | null,
  required: string[] = [],
): GateCheck {
  const b = body || {};
  const missing = (required || []).filter((k) => !String(b[k] || "").trim());
  if (missing.length) {
    return check("schema", "结构字段", "fail", `缺少字段：${missing.join("、")}`);
  }
  // 占位符防御：弱模型/本地模型常产出「[梗概内容]」模板空壳，必须在确定性层拦截
  const placeholderHit = findPlaceholder(b);
  if (placeholderHit) {
    return check(
      "schema",
      "结构字段",
      "fail",
      `检测到未填写的占位符（${placeholderHit.slice(0, 40)}），请填入真实内容后重试`,
    );
  }
  return check("schema", "结构字段", "pass", "必填字段齐全");
}

/** 递归查找占位符（[xx内容]、待填、TODO、TBD 等模板空壳）。 */
export function findPlaceholder(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const m = value.match(
      /\[[^\]]{0,24}(内容|待填|待补|占位|略过|此处|placeholder|TODO|TBD)[^\]]{0,24}\]|^\s*(待填|待补充|TODO|TBD)\s*$/i,
    );
    return m ? m[0] : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findPlaceholder(item);
      if (hit) return hit;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findPlaceholder(v);
      if (hit) return hit;
    }
  }
  return "";
}

/** 通用字段在场校验（新增业务 Gate 的确定性底座） */
export function checkRequiredFields(
  body: Record<string, unknown> | null | undefined,
  fields: string[],
  id: string,
  name: string,
): GateCheck {
  const b = body || {};
  const missing = fields.filter((k) => !hasJsonContent(b[k]));
  if (missing.length) {
    return check(id, name, "fail", `缺少：${missing.join("、")}`);
  }
  return check(id, name, "pass", "字段齐全");
}

/** 片名直白清晰（查理法则：关键词检索向，忌文艺晦涩） */
export function checkTitleClarity(title?: string | null): GateCheck {
  const t = String(title || "").trim();
  if (codepointCount(t) < 2 || codepointCount(t) > 24) {
    return check("title_clarity", "片名清晰", "fail", `片名长度 ${codepointCount(t)} 不在 [2,24]`);
  }
  return check("title_clarity", "片名清晰", "pass", "片名可检索");
}

/** 产品锁：开工前必须显式锁定产品三要素 */
export function checkStageLock(body?: Record<string, unknown> | null): GateCheck {
  return checkRequiredFields(
    body,
    ["product", "audience", "budget"],
    "stage_lock",
    "产品锁",
  );
}

/** 人设五要素完整（查理 bio-5） */
export function checkBioComplete(body?: Record<string, unknown> | null): GateCheck {
  return checkRequiredFields(
    body,
    ["name", "role", "want", "fear", "flaw"],
    "bio_complete",
    "人设完整",
  );
}

/** 共情三困境：一个共情目标 + 三个困境 */
export function checkEmpathy(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const pains = Array.isArray(b.pains) ? b.pains : [];
  const target = String(b.target || b.empathy_target || "").trim();
  if (!target || pains.filter((p) => String(p).trim()).length < 3) {
    return check("empathy", "共情三困境", "fail", "需共情目标 + 三个困境");
  }
  return check("empathy", "共情三困境", "pass", "共情目标与三困境齐全");
}

/** 悬念四要素预算 */
export function checkSuspenseBudget(body?: Record<string, unknown> | null): GateCheck {
  return checkRequiredFields(
    body,
    ["suspend", "answer", "cost", "payoff"],
    "suspense_budget",
    "悬念预算",
  );
}

/** 产品优先级锁：确认过优先级才允许推进 */
export function checkPriorityLock(acked?: boolean | null): GateCheck {
  return checkLogicAck(acked === true);
}

/** Revise20：20 项检查完成度 */
export function checkRevise20Pass(checks?: unknown[], expect = 20): GateCheck {
  const done = (checks || []).filter(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      (hasJsonContent((c as Record<string, unknown>).pass) ||
        String((c as Record<string, unknown>).status || "").toLowerCase() === "pass"),
  ).length;
  if (done < expect) {
    return check("revise20", "修改20体检", "fail", `已完成 ${done}/${expect} 项`);
  }
  return check("revise20", "修改20体检", "pass", "20 项检查全部完成");
}

/** 单元计划：至少 1 个单元 */
export function checkUnitPlan(units?: unknown[] | null): GateCheck {
  const n = Array.isArray(units) ? units.length : 0;
  return n >= 1
    ? check("unit_plan", "单元计划", "pass", `单元数 ${n}`)
    : check("unit_plan", "单元计划", "fail", "单元数不足 1");
}

/** 爽点聚焦：单集一个主爽点 */
export function checkCoolFocus(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const has = ["cool_focus", "cool_point", "coolFocus", "coolPoint"].some(
    (k) => hasJsonContent(b[k]),
  );
  return has
    ? check("cool_focus", "爽点聚焦", "pass", "主爽点已标注")
    : check("cool_focus", "爽点聚焦", "fail", "缺少主爽点标注");
}

/** 爽点堆栈最小量 */
export function checkCoolStackMin(stack?: unknown[] | null, min = 3): GateCheck {
  const n = Array.isArray(stack) ? stack.length : 0;
  return n >= min
    ? check("cool_stack", "爽点堆栈", "pass", `堆栈 ${n} ≥ ${min}`)
    : check("cool_stack", "爽点堆栈", "fail", `堆栈 ${n} < ${min}`);
}

/** 规则复杂度上限：金手指规则要简单 */
export function checkRuleComplexity(rules?: unknown[] | null, max = 5): GateCheck {
  const n = Array.isArray(rules) ? rules.length : 0;
  return n <= max
    ? check("rule_complexity", "规则复杂度", "pass", `规则 ${n} ≤ ${max}`)
    : check("rule_complexity", "规则复杂度", "fail", `规则 ${n} > ${max}，请收敛`);
}

/** 每集具名爽点 */
export function checkCoolPerEp(body?: Record<string, unknown> | null): GateCheck {
  const b = body || {};
  const has = ["cool_per_ep", "coolPerEp"].some((k) => hasJsonContent(b[k]));
  return has
    ? check("cool_per_ep", "每集爽点", "pass", "每集爽点已标注")
    : check("cool_per_ep", "每集爽点", "fail", "缺少每集爽点标注");
}

/** 场景数（与 Python check_scene_count 对齐） */
export function checkSceneCount(text = "", maxScenes = 3): GateCheck {
  // Scene headers mark location boundaries; actions and camera shots do not.
  const headers = [
    /^(?:第[0-9零〇一二三四五六七八九十百]+场|场(?:景)?(?:[0-9零〇一二三四五六七八九十百]+)?)(?:[：:\s、.．|｜]|$)/,
    /^(?:【|\[)(?:场景?|景)(?:[0-9零〇一二三四五六七八九十百]+)?(?:[：:\s][^】\]]*)?(?:】|\])/,
    /^[0-9]+\s*[-－]\s*[0-9]+(?:\s+.*)?\s(?:内外|内|外)(?:\s|[|｜/／：:]|$)/,
    /^[0-9]+\s*[|｜][^|｜]+[|｜]\s*(?:内外|内|外)\s*[|｜]\s*\S/,
  ];
  const markers = text.split(/\r?\n/).filter(line => {
    const header = line.trim().replace(/^#{1,6}\s+/, "");
    return headers.some(pattern => pattern.test(header));
  }).length;
  if (markers === 0) {
    return check("scene_count", "场景数", "warn", "未识别到明确场景标头，需人工复核场景数；不以动作、分镜或自然段推算");
  }
  if (markers > maxScenes) {
    return check("scene_count", "场景数", "fail", `明确场景标头 ${markers} 个，超过上限 ${maxScenes}`);
  }
  return check("scene_count", "场景数", "pass", `明确场景标头 ${markers} 个`);
}

/** 小说腔检测（与 Python check_novelization 对齐） */
export function checkNovelization(text = ""): GateCheck {
  const marks = ["他想", "她想", "内心独白", "心道", "只见那", "说道："];
  const hits = marks.filter((m) => text.includes(m));
  if (hits.length) {
    const pos = text.indexOf(hits[0]);
    const line = text.slice(0, pos).split("\n").length;
    return check("novelization", "小说腔", "warn", `第${line}行「${text.slice(Math.max(0, pos - 12), pos + 24)}」：请结合对白意图和画面判断可拍性，可保留原文。`);
  }
  return check("novelization", "小说腔", "pass", "未检出明显小说腔");
}

const AI_BANNED_PHRASES = [
  "综上所述",
  "总而言之",
  "值得注意的是",
  "不禁",
  "宛如",
  "犹如",
  "仿佛在诉说",
  "心中一凛",
  "嘴角微微上扬",
  "涌上心头",
];

/** 风格建议（与 Python check_deai_checklist 对齐）；词语命中不构成硬门禁。 */
export function checkDeAIChecklist(
  text = "",
  extraBanned: string[] = [],
): GateCheck {
  const banned = [...AI_BANNED_PHRASES, ...extraBanned];
  const prose = text.replace(/```[\s\S]*?```|“[^”]*”|「[^」]*」|"[^"\n]*"/g, "");
  const hits = banned.filter((p) => prose.includes(p));
  if (hits.length) {
    return check("deai_checklist", "去 AI 味风格建议", "warn", `叙述风格待复核：${hits.slice(0, 8).join("、")}；比喻、人物语气和节奏可保留，词语命中不判错`);
  }
  return check("deai_checklist", "去 AI 味风格建议", "pass", "未发现词语线索；不代表已证明文本质量或作者身份");
}

/** Runtime adoption keeps the canonical Python field requirements and aliases. */
export function checkCoreHookAdoption(
  body?: Record<string, unknown> | null,
  mode: "draft" | "strong" = "strong",
): GateCheck[] {
  return checkAdoption(body, mode, RUNTIME_CORE_HOOK_PROFILE);
}

/** Token 预算门禁（与 Python check_budget 对齐） */
export function checkBudget(
  used: number,
  budget?: number | null,
): GateCheck {
  if (budget == null) {
    return check("budget", "Token 预算", "pass", "未设置预算");
  }
  if (used >= budget) {
    return check("budget", "Token 预算", "fail", `已用 ${used} ≥ 预算 ${budget}`);
  }
  if (used >= budget * 0.9) {
    return check("budget", "Token 预算", "warn", `已用 ${used}/${budget}，接近上限`);
  }
  return check("budget", "Token 预算", "pass", `已用 ${used}/${budget}`);
}

/** 统一分发，与 Python run_gate_battery 对齐 */
export function runGateBattery(
  name: string,
  payload: Record<string, unknown> = {},
): GateCheck[] {
  switch (normalizeGateName(name)) {
    case "FormatSelected":
      return [checkFormatSelected((payload.format as string) || null)];
    case "ChunkPolicy":
      return [
        checkChunkPolicy({
          requestedChars: (payload.requested_chars ?? payload.requestedChars) as
            | number
            | undefined,
          maxChars: Number((payload.max_chars ?? payload.maxChars) || 3000),
          wholeBook: Boolean(payload.whole_book ?? payload.wholeBook),
        }),
      ];
    case "LogicAck":
      return [checkLogicAck(payload.acked === true)];
    case "PromptLock":
      return checkPromptLock(
        String(payload.editableInstruction ?? payload.editable_instruction ?? ""),
        (payload.requiredPhrases ?? payload.required_phrases ?? []) as string[],
        String(payload.lockedHash ?? payload.locked_hash ?? ""),
        String(payload.lockedSystem ?? payload.current_locked_system ?? ""),
      );
    case "CoreHookAdoption":
      return checkCoreHookAdoption(
        payload.body as Record<string, unknown>,
        (payload.mode as "draft" | "strong") || "strong",
      );
    case "Budget":
      return [checkBudget(Number(payload.used ?? 0), payload.budget as number | null)];
    case "Schema":
      return [
        checkSchemaFields(
          payload.body as Record<string, unknown>,
          payload.required as string[],
        ),
      ];
    case "LengthBand":
      return [
        checkLengthBand(
          String(payload.text || ""),
          Number(payload.min_chars ?? payload.minChars ?? 800),
          Number(payload.max_chars ?? payload.maxChars ?? 1200),
        ),
      ];
    case "SceneCount":
      return [
        checkSceneCount(
          String(payload.text || ""),
          Number((payload.max_scenes ?? payload.maxScenes) || 3),
        ),
      ];
    case "Ep1Hook":
      return [{ ...checkHookPresence(String(payload.text || ""), payload.hook_flag as boolean | undefined), id: "ep1_hook", name: "第一集钩子" }];
    case "HookPresence":
      return [
        checkHookPresence(
          String(payload.text || ""),
          payload.hook_flag as boolean | null | undefined,
        ),
      ];
    case "Novelization":
      return [checkNovelization(String(payload.text || ""))];
    case "DeAIChecklist":
      return [
        checkDeAIChecklist(
          String(payload.text || ""),
          payload.extra_banned as string[],
        ),
      ];
    case "SceneTriple":
    case "SceneTripleGate":
      return [checkSceneTriple(payload.body as Record<string, unknown>)];
    case "EpisodeStandaloneGate":
    case "EpisodeStandalone":
      return [checkEpisodeStandalone(payload.body as Record<string, unknown>)];
    case "BeatCompleteness":
      return [
        checkBeatCompleteness(
          payload.beats as unknown[],
          Number(payload.expect || 20),
        ),
      ];
    case "PaywallCoverage":
      return [
        checkPaywallCoverage(
          payload.slots as unknown[],
          Number(payload.min_slots || 3),
        ),
      ];
    case "ShellGate":
      return [checkCourseShell((payload.body || {}) as Record<string, unknown>, true)];
    case "Shell":
      return [checkShellGate(payload.shell as string)];
    case "PayMotive":
      return [checkPayMotive(payload.body as Record<string, unknown>)];
    case "RedlineHard":
      return [checkRedlineHard(String(payload.text || ""))];
    case "OnePlusOne":
      return [checkOnePlusOne(payload.body as Record<string, unknown>)];
    case "GenderPath":
      return [checkGenderPath(payload.path as string)];
    case "HumanConfirm":
      return [checkHumanConfirm(payload.acked === true)];
    case "PitchCompleteness":
      return [checkPitchCompleteness(payload.body as Record<string, unknown>)];
    case "GenreTrim":
      return [checkGenreTrim((payload.genre ?? (payload.body as Record<string, unknown>)?.genre) as string, payload.blacklist as string[])];
    case "EightTropeCoverage":
      return [
        checkEightTropeCoverage(
          payload.tropes as unknown[],
          Number(payload.min_hit ?? payload.minHit ?? 3),
        ),
      ];
    case "MidpointPosition":
      return ["index" in payload || "total" in payload
        ? checkMidpointIndex(payload.index as number | null | undefined, Number(payload.total || 20))
        : checkMidpointPosition(payload.body as Record<string, unknown>)];
    case "SimilarityRisk":
      return [
        checkSimilarityRisk(
          payload.score as number,
          Number(payload.threshold ?? 0.72),
        ),
      ];
    case "LocationBudget":
    case "LocationBudgetGate":
      return [
        checkLocationBudget(
          payload.unique_count as number,
          Number(payload.max ?? 12),
        ),
      ];
    case "DialogueFormula":
    case "DialogueFormulaGate":
      return [checkDialogueFormula(payload.body as Record<string, unknown>)];
    case "VoiceDiversity":
    case "VoiceDiversityGate":
      return [
        checkVoiceDiversity(
          payload.score as number,
          Number(payload.threshold ?? 0.45),
        ),
      ];
    case "FemaleOmniscience":
    case "FemaleOmniscienceGate":
      return [checkFemaleOmniscience(payload.body as Record<string, unknown>)];
    case "ComedyDose":
    case "ComedyDoseGate":
      return [checkComedyDose(payload.body as Record<string, unknown>)];
    case "RelationDriver":
    case "RelationDriverGate":
      return [checkRelationDriver(payload.body as Record<string, unknown>)];
    case "LengthDecay":
      return [
        checkLengthDecay({
          lengths: payload.lengths as number[],
          currentChars: (payload.current_chars ?? payload.currentChars) as number,
          prevChars: (payload.prev_chars ?? payload.prevChars) as number,
          minChars: Number(payload.min_chars ?? payload.minChars ?? 800),
          ratio: Number(payload.ratio ?? 0.7),
        }),
      ];
    case "Logline100Ack":
      return [
        checkLogline100Ack(
          payload.acked === true,
          (payload.logline as string) || null,
        ),
      ];
    case "PitchFourPack": {
      const c = (payload.counts || payload) as Record<string, unknown>;
      const format =
        (payload.format as string | undefined) ||
        (c.format as string | undefined) ||
        null;
      return [
        checkPitchFourPack({
          coreHook: Number(c.coreHook ?? c.core_hook ?? 0),
          character: Number(c.character ?? 0),
          episodeOutline: Number(c.episodeOutline ?? c.episode_outline ?? 0),
          manuscript: Number(c.manuscript ?? 0),
          format,
          adaptAnchorDone: Boolean(
            c.adaptAnchorDone ?? c.adapt_anchor_done ?? payload.adaptAnchorDone,
          ),
          adaptUnitCount: Number(
            c.adaptUnitCount ?? c.adapt_unit_count ?? payload.adaptUnitCount ?? 0,
          ),
          adaptEmotionPoints: Number(
            c.adaptEmotionPoints ??
              c.adapt_emotion_points ??
              payload.adaptEmotionPoints ??
              0,
          ),
          adaptScriptCount: Number(
            c.adaptScriptCount ??
              c.adapt_script_count ??
              payload.adaptScriptCount ??
              c.manuscript ??
              0,
          ),
        }),
      ];
    }
    case "OutlineNoEvenActs":
      return [
        checkOutlineNoEvenActs(
          String(payload.text || ""),
          payload.strict !== false,
        ),
      ];
    case "OOC":
      return [
        checkOocHeuristic({
          bibleSnippet: payload.bible as string,
          text: payload.text as string,
          flagged: payload.flagged === true,
        }),
      ];
    case "PuzzleShell":
    case "PuzzleShellGate":
      return [checkPuzzleShell(payload.body as Record<string, unknown>)];
    case "GoldFingerMinimal":
    case "GoldFingerMinimalGate":
      return [checkGoldFingerMinimal(payload.body as Record<string, unknown>)];
    case "SettingCap":
    case "SettingCapGate":
      return [
        checkSettingCap(
          payload.body as Record<string, unknown>,
          Number(payload.max ?? 2),
        ),
      ];
    case "ClassicNarrative":
    case "ClassicNarrativeGate":
      return [checkClassicNarrative(payload.body as Record<string, unknown>)];
    case "TragedyBudget":
    case "TragedyBudgetGate":
      return [checkTragedyBudget(payload.body as Record<string, unknown>)];
    case "AntiDeus":
    case "AntiDeusGate":
      return [checkAntiDeus(payload.body as Record<string, unknown>)];
    case "ShowDontTell":
    case "ShowDontTellGate":
      return [
        checkShowDontTell(
          String(payload.text || ""),
          Number(payload.threshold ?? 3),
        ),
      ];
    case "HotTopicDepth":
    case "HotTopicDepthGate":
      return [checkHotTopicDepth(payload.body as Record<string, unknown>)];
    case "FormatContract":
    case "FormatContractGate":
      return [
        checkFormatContract(
          String(payload.text || ""),
          (payload.format as string) || null,
        ),
      ];
    case "CoreHookComplete":
    case "CoreHookCompleteGate":
      return [checkCoreHookComplete(payload.body as Record<string, unknown>)];
    case "DialogueLen":
    case "DialogueLenGate":
      return [
        checkDialogueLen(
          String(payload.text || ""),
          Number(payload.max_chars ?? payload.maxChars ?? 500),
        ),
      ];
    case "GraphConsistency":
    case "GraphConsistencyGate":
      return [
        checkGraphConsistency({
          graph: (payload.graph || payload.body || null) as Record<string, unknown> | null,
          ledger: (payload.ledger || null) as Record<string, unknown> | null,
          currentEp: Number(payload.currentEp ?? payload.current_ep ?? payload.episodeNo ?? 0),
          worldText: String(payload.worldText ?? payload.world_text ?? ""),
          requireNonEmpty: Boolean(payload.requireNonEmpty ?? payload.require_non_empty),
        }),
      ];
    case "TitleClarity":
    case "TitleClarityGate":
      return [checkTitleClarity((payload.title ?? payload.text) as string)];
    case "StageLock":
    case "StageLockGate":
      return [checkStageLock(payload.body as Record<string, unknown>)];
    case "BioComplete":
    case "BioCompleteGate":
      return [checkBioComplete(payload.body as Record<string, unknown>)];
    case "Empathy":
    case "EmpathyGate":
      return [checkEmpathy(payload.body as Record<string, unknown>)];
    case "SuspenseBudget":
    case "SuspenseBudgetGate":
      return [checkSuspenseBudget(payload.body as Record<string, unknown>)];
    case "PriorityLock":
    case "PriorityLockGate":
      return [checkPriorityLock(payload.acked === true)];
    case "Revise20Pass":
    case "Revise20PassGate":
      return [checkRevise20Pass(payload.checks as unknown[], Number(payload.expect ?? 20))];
    case "UnitPlan":
    case "UnitPlanGate":
      return [checkUnitPlan(payload.units as unknown[])];
    case "CoolFocus":
    case "CoolFocusGate":
      return [checkCoolFocus(payload.body as Record<string, unknown>)];
    case "CoolStackMin":
    case "CoolStackMinGate":
      return [checkCoolStackMin(payload.stack as unknown[], Number(payload.min ?? 3))];
    case "RuleComplexity":
    case "RuleComplexityGate":
      return [checkRuleComplexity(payload.rules as unknown[], Number(payload.max ?? 5))];
    case "CoolPerEp":
      return [checkCoolPerEp(payload.body as Record<string, unknown>)];
    default:
      // 别名回退：GenderPathGate→GenderPath 等；base 未注册时仍走显式报错
      if (name.endsWith("Gate")) {
        const base = name.slice(0, -4);
        const retried = runGateBattery(base, payload);
        if (!retried.some((c) => String(c.message || "").includes("未知或未实现的 Gate"))) {
          return retried;
        }
      }
      return [
        check(
          name,
          name,
          "fail",
          `未知或未实现的 Gate：${name}（可能命名不匹配，须显式报错而非放行）`,
        ),
      ];
  }
}
