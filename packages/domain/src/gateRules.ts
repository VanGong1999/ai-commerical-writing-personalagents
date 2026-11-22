/** Browser-safe gate rules shared by the UI and the canonical agent runtime. */
export interface GateCheck {
  id: string;
  name: string;
  result: "pass" | "fail" | "warn" | "inconclusive";
  message: string;
}

/** Count Unicode codepoints, matching Python len for decoded text. Callers own trimming. */
export function codepointCount(text: string): number {
  return Array.from(text).length;
}

/** Count the saved manuscript text used by the queue and the post-body lifecycle. */
export function manuscriptLength(artifact?: {
  bodyJson?: Record<string, unknown> | null;
  bodyMarkdown?: string | null;
  body_markdown?: string | null;
}): number {
  const script = artifact?.bodyJson?.script_body;
  if (typeof script === "string" && script.trim()) {
    return codepointCount(script.replace(/\s/g, ""));
  }
  return codepointCount(String(artifact?.bodyMarkdown || artifact?.body_markdown || "").trim());
}

/** 实测低于 minChars 时失败；相对上集跌破 ratio 仅提示复核。 */
export function checkLengthDecay(opts: {
  lengths?: number[];
  currentChars?: number;
  prevChars?: number;
  minChars?: number;
  ratio?: number;
}): GateCheck {
  const minChars = opts.minChars ?? 800;
  const ratio = opts.ratio ?? 0.7;
  const lengths = opts.lengths || [];
  let prev = opts.prevChars;
  let cur = opts.currentChars;
  if (lengths.length >= 2) {
    prev = lengths[lengths.length - 2];
    cur = lengths[lengths.length - 1];
  } else if (lengths.length === 1) {
    cur ??= lengths[0];
  }
  if (cur == null) {
    return {
      id: "length_decay",
      name: "字数衰减",
      result: "inconclusive",
      message: "未提供当前集字数",
    };
  }
  // Python historically truncates measured current counts before comparing thresholds.
  cur = Math.trunc(cur);
  if (cur < minChars) {
    return {
      id: "length_decay",
      name: "字数衰减",
      result: "fail",
      message: `当前 ${cur} 字 < ${minChars}，立刻停写并进校正`,
    };
  }
  if (prev != null && prev > 0 && cur < prev * ratio) {
    const threshold = ratio.toLocaleString("en", { style: "percent", maximumSignificantDigits: 15 });
    return {
      id: "length_decay",
      name: "字数衰减",
      result: "warn",
      message: `字数从 ${prev} 降至 ${cur}（低于上集的 ${threshold}），已达到最低 ${minChars} 字，可按剧情需要复核节奏`,
    };
  }
  return {
    id: "length_decay",
    name: "字数衰减",
    result: "pass",
    message: prev != null ? `字数 ${cur}（上集 ${prev}）合规` : `字数 ${cur} 合规`,
  };
}

/** Empty JSON values are missing content; strings additionally require non-whitespace text. */
export function hasJsonContent(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

interface CoreHookField {
  readonly keys: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly kind: "text" | "list";
  readonly missing: string;
  readonly present: string;
}

export interface CoreHookProfile {
  readonly fields: readonly CoreHookField[];
  readonly riskKeys: readonly string[];
}

const motivation: CoreHookField = {
  keys: ["motivation"], id: "motivation", name: "动机", kind: "text",
  missing: "缺少动机线，强采纳不可用", present: "动机已填写",
};
const opening: CoreHookField = {
  keys: ["openingStructure"], id: "opening", name: "开篇结构", kind: "text",
  missing: "缺少开篇结构", present: "开篇结构已填写",
};

/** UI adoption additionally requires tags and the protagonist's crisis. */
export const FRONTEND_CORE_HOOK_PROFILE: CoreHookProfile = {
  fields: [motivation, opening, {
    keys: ["tags"], id: "tags", name: "标签", kind: "list",
    missing: "缺少题材标签，强采纳不可用", present: "标签 {count} 个",
  }, {
    keys: ["crisis"], id: "crisis", name: "主角危机", kind: "text",
    missing: "缺少主角危机，强采纳不可用", present: "危机已填写",
  }],
  riskKeys: ["riskFlags"],
};

/** Python/runtime contract accepts snake_case aliases and requires two fields. */
export const RUNTIME_CORE_HOOK_PROFILE: CoreHookProfile = {
  fields: [motivation, { ...opening, keys: ["openingStructure", "opening_structure"] }],
  riskKeys: ["riskFlags", "risk_flags"],
};

function firstTruthy(body: Record<string, unknown>, keys: readonly string[]): unknown {
  return keys.map(key => body[key]).find(value => typeof value === "string" ? Boolean(value) : hasJsonContent(value));
}

export function checkCoreHookAdoption(
  body: Record<string, unknown> | null | undefined,
  mode: "draft" | "strong" = "strong",
  profile: CoreHookProfile = RUNTIME_CORE_HOOK_PROFILE,
): GateCheck[] {
  let b = body || {};
  if (b.candidate && typeof b.candidate === "object" && !Array.isArray(b.candidate)) {
    b = b.candidate as Record<string, unknown>;
  }
  const checks = profile.fields.map((field): GateCheck => {
    const value = firstTruthy(b, field.keys);
    const count = field.kind === "list"
      ? (Array.isArray(value) ? value.length : 0)
      : (typeof value === "string" ? codepointCount(value.trim()) : 0);
    return {
      id: field.id, name: field.name,
      result: count ? "pass" : mode === "strong" ? "fail" : "warn",
      message: count ? field.present.replace("{count}", String(count)) : field.missing,
    };
  });
  const risk = firstTruthy(b, profile.riskKeys);
  const riskText = Array.isArray(risk) ? risk.map(String).join("、") : typeof risk === "string" ? risk : "";
  if ((Array.isArray(risk) && risk.length) || riskText) {
    checks.push({ id: "risk", name: "红线题材", result: "warn", message: `风险标记：${riskText}` });
  }
  return checks;
}

/** Warnings may proceed; unknown conclusions and failures must block. Empty is legacy pass. */
export function allPassed(checks: readonly GateCheck[]): boolean {
  return !checks.some(c => c.result === "fail" || c.result === "inconclusive");
}

export const canStrongAdopt = allPassed;

export function checkPromptLockHash(lockedSystem: string, lockedHash: string): GateCheck {
  const passed = simpleHash(lockedSystem) === lockedHash;
  return {
    id: "prompt_lock_hash", name: "锁定区完整性", result: passed ? "pass" : "fail",
    message: passed ? "锁定区哈希一致" : "锁定 System Prompt 已被改动，禁止开跑",
  };
}

/** Prompt lock: editable instruction must still contain required phrases. */
export function checkPromptLock(
  editableInstruction: string,
  requiredPhrases: string[],
  lockedHash: string,
  currentLockedSystem: string,
): GateCheck[] {
  const checks: GateCheck[] = [checkPromptLockHash(currentLockedSystem, lockedHash)];

  for (const phrase of requiredPhrases) {
    if (!editableInstruction.includes(phrase)) {
      checks.push({
        id: `required_${phrase}`,
        name: `必含指令：${phrase}`,
        result: "fail",
        message: `可变指令缺少必含短语「${phrase}」`,
      });
    }
  }

  if (checks.every((c) => c.result === "pass") && requiredPhrases.length > 0) {
    checks.push({
      id: "required_phrases",
      name: "必含短语",
      result: "pass",
      message: "可变指令包含全部必含短语",
    });
  }

  return checks;
}

export function checkEpisodeHook(hookAtEnd: boolean): GateCheck {
  if (!hookAtEnd) {
    return {
      id: "episode_hook",
      name: "集尾钩子",
      result: "fail",
      message: "缺集尾钩子，不可标记完成",
    };
  }
  return {
    id: "episode_hook",
    name: "集尾钩子",
    result: "pass",
    message: "集尾钩子已具备",
  };
}

/** SHA-256 prefix, shared by the UI, runtime, and Python adapter. */
export function simpleHash(input: string): string {
  return `h${sha256Hex(input).slice(0, 12)}`;
}

function sha256Hex(message: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0);
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < withPad.length; i += 64) {
    for (let j = 0; j < 16; j += 1) w[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 64; j += 1) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let j = 0; j < 64; j += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, "0"))
    .join("");
}
