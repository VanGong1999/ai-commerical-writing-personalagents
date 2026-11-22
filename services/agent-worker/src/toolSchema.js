/**
 * 工具 schema 转换、参数校验/矫正、JSON 修复、结构化错误。
 */
import { Value } from "@sinclair/typebox/value";

/** 尝试把模型吐出的脏 JSON 修成可 parse 的字符串 */
export function repairJsonString(raw) {
  let s = String(raw ?? "").trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[\[{]/);
  if (start < 0) return s;
  let quoted = false, escaped = false, depth = 0, end = -1;
  let clean = "";
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      clean += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    if (c === "{" || c === "[") depth += 1;
    if (c === "}" || c === "]") depth -= 1;
    // Only remove commas outside strings, with an explicit closing delimiter.
    if (!(c === "," && /^\s*[}\]]/.test(s.slice(i + 1)))) clean += c;
    if (depth === 0) { end = i + 1; break; }
  }
  // Never close partial strings/containers or choose between multiple objects.
  if (end < 0 || /[{}\[\]]/.test(s.slice(end))) return s;
  return clean;
}

export function parseToolArgs(raw) {
  if (raw == null) return { ok: true, args: {} };
  if (typeof raw === "object" && !Array.isArray(raw)) return { ok: true, args: raw };
  const text = repairJsonString(raw);
  try {
    const args = JSON.parse(text);
    if (args && typeof args === "object" && !Array.isArray(args)) {
      return { ok: true, args };
    }
    return {
      ok: false,
      error: structuredError({
        error: "invalid_args_json",
        field: "arguments",
        expected: "JSON object",
        example: '{"type":"outline","title":"...","bodyMarkdown":"..."}',
        retryable: true,
        next: "重发工具调用，arguments 必须是 JSON 对象。",
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: structuredError({
        error: "invalid_args_json",
        field: "arguments",
        expected: "合法 JSON 对象",
        example: "{}",
        retryable: true,
        next: `参数不是合法 JSON（${err.message}）。请去掉代码围栏与尾逗号后重发。`,
      }),
    };
  }
}

export function structuredError({
  error,
  field = null,
  expected = null,
  example = null,
  retryable = true,
  next = "",
  message = "",
}) {
  return {
    ok: false,
    isError: true,
    error,
    field,
    expected,
    example,
    retryable,
    next: next || message,
    message: message || next || error,
  };
}

/** TypeBox / 普通 JSON Schema → 发给 provider 的干净 schema */
export function toProviderSchema(parameters) {
  let schema = parameters || { type: "object", properties: {} };
  try {
    schema = JSON.parse(JSON.stringify(schema));
  } catch {
    schema = { type: "object", additionalProperties: true };
  }
  // TypeBox 可能带 $id / 符号字段，已 JSON 化
  if (!schema.type) schema.type = "object";
  if (schema.type === "object" && !schema.properties) {
    schema.properties = {};
  }
  // 把 Any / 空 schema 标成宽松 object
  if (schema.anyOf || schema.oneOf) {
    // 保留，但保证顶层 object 工具参数常见形态
  }
  stripUnsupportedKeywords(schema);
  return schema;
}

function stripUnsupportedKeywords(node) {
  if (!node || typeof node !== "object") return;
  // MiniMax / 部分兼容端对 $schema / $id 敏感时去掉
  delete node.$schema;
  delete node.$id;
  delete node.$defs;
  delete node.definitions;
  if (node.properties && typeof node.properties === "object") {
    for (const v of Object.values(node.properties)) stripUnsupportedKeywords(v);
  }
  if (node.items) stripUnsupportedKeywords(node.items);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach(stripUnsupportedKeywords);
  if (Array.isArray(node.oneOf)) node.oneOf.forEach(stripUnsupportedKeywords);
}

/**
 * 轻量矫正：字符串 JSON → 对象；单值 → 数组（当 schema 要求 array）
 */
export function coerceArgs(args, schema) {
  if (!args || typeof args !== "object") return args || {};
  const out = { ...args };
  const props = schema?.properties || {};
  for (const [key, propSchema] of Object.entries(props)) {
    if (!(key in out)) continue;
    let v = out[key];
    if (typeof v === "string" && (propSchema.type === "object" || propSchema.type === "array")) {
      try {
        const parsed = JSON.parse(v);
        out[key] = parsed;
        v = parsed;
      } catch {
        /* keep */
      }
    }
    if (propSchema.type === "array" && v != null && !Array.isArray(v)) {
      out[key] = [v];
    }
    if (propSchema.type === "number" && typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
      out[key] = Number(v);
    }
    if (propSchema.type === "boolean" && (v === "true" || v === "false")) {
      out[key] = v === "true";
    }
  }
  // 常见别名
  if (out.path === undefined && out.filePath) out.path = out.filePath;
  if (out.path === "." || out.path === "./") out.path = "/";
  return out;
}

/** Validate JSON Schema without silently accepting types after TypeBox rejects a plain schema. */
function schemaError(value, schema, path = "") {
  if (schema === true) return null;
  if (schema === false) return path || "/";
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) return path || "/"; // Unresolved references must fail closed.
  if (schema.anyOf && !schema.anyOf.some(s => !schemaError(value, s, path))) return path || "/";
  if (schema.oneOf && schema.oneOf.filter(s => !schemaError(value, s, path)).length !== 1) return path || "/";
  if (schema.allOf) for (const s of schema.allOf) { const e = schemaError(value, s, path); if (e) return e; }
  if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return path || "/";
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return path || "/";
  const types = schema.type ? [].concat(schema.type) : [];
  const matches = type => type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "array" ? Array.isArray(value) : type === "null" ? value === null
    : type === "integer" ? Number.isInteger(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === type;
  if (types.length && !types.some(matches)) return path || "/";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) return `${path}/${key}`;
    for (const [key, v] of Object.entries(value)) {
      const child = schema.properties?.[key] ?? schema.additionalProperties;
      const e = schemaError(v, child, `${path}/${key}`); if (e) return e;
    }
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return path || "/";
    for (let i = 0; i < value.length; i++) { const e = schemaError(value[i], schema.items, `${path}/${i}`); if (e) return e; }
  }
  if (typeof value === "number" && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) || value <= (schema.exclusiveMinimum ?? -Infinity) || value >= (schema.exclusiveMaximum ?? Infinity))) return path || "/";
  if (typeof value === "string" && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return path || "/";
  return null;
}

export function validateArgs(args, schema) {
  if (!schema || typeof schema !== "object") return { ok: true, args };
  const coerced = coerceArgs(args, toProviderSchema(schema));
  let field;
  try {
    if (schema[Symbol.for("TypeBox.Kind")]) {
      if (Value.Check(schema, coerced)) return { ok: true, args: coerced };
      field = [...Value.Errors(schema, coerced)][0]?.path || "/";
    } else field = schemaError(coerced, schema);
  } catch { field = "/"; }
  if (!field) return { ok: true, args: coerced };
  return { ok: false, args: coerced, error: structuredError({
    error: "invalid_args", field: field.replace(/^\//, "") || null,
    expected: "符合工具 parameters 的值", retryable: true,
    next: `参数 ${field} 不符合 schema，请按工具 parameters 修正后重发。`,
  }) };
}

/** 构建发给 LLM 的 tools 条目（完整 schema） */
export function buildProviderTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: toProviderSchema(tool.parameters),
    },
  };
}
