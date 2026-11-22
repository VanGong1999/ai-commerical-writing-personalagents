import { z } from "zod";
import { ExpectationConflictWorkflowSchema } from "../../../packages/domain/src/nines-workflow.ts";

const item = z.object({
  id:z.enum(["两性","征服","优势","归属","秩序"]), primary:z.boolean(),
  yy_payoff:z.string().trim().min(1), tropes_hint:z.array(z.string().trim().min(1)),
}).strict();
const stack = z.object({
  cool_stack:z.array(item).min(1), focus_ok:z.boolean(),
  gender_path:z.enum(["male_self_act","female_borrow_power"]),
}).strict();
export const typedRole = id => ["struct.expectation","topic.cool_point_5"].includes(id);

// Use the same schema for the model-facing guide and raw-key checks.
function unwrap(schema) {
  while (schema instanceof z.ZodDefault || schema instanceof z.ZodNullable || schema instanceof z.ZodOptional)
    schema = schema._def.innerType;
  return schema;
}

function fieldGuide(schema) {
  const base = unwrap(schema);
  if (base instanceof z.ZodObject) return Object.fromEntries(Object.entries(base.shape).map(([key, field]) => [key, fieldGuide(field)]));
  if (base instanceof z.ZodArray) return [fieldGuide(base.element)];
  if (base instanceof z.ZodEnum) return base.options.join("|");
  return base._def.typeName.replace("Zod", "").toLowerCase();
}

export function roleOutputGuide(id) {
  if (!typedRole(id)) return "";
  const workflow = id === "struct.expectation";
  const usage = workflow ? "expectation_conflict 必填 design.core.content 和 conflicts[].oneLiner" : "汇总用 other；单项 trope 用 cool_stack 的单个元素";
  return usage + "。分析写入 bodyMarkdown。bodyJson 字段与枚举：" + JSON.stringify(fieldGuide(workflow ? ExpectationConflictWorkflowSchema : stack));
}

function unknownFields(schema, value, errors, path = []) {
  if (!value || typeof value !== "object" || errors.length >= 64) return;
  const base = unwrap(schema);
  for (const [key, child] of Object.entries(value)) {
    if (errors.length >= 64) break;
    const next = [...path, key];
    if (base instanceof z.ZodArray && Array.isArray(value)) unknownFields(base.element, child, errors, next);
    if (!(base instanceof z.ZodObject)) continue;
    if (Object.hasOwn(base.shape,key)) unknownFields(base.shape[key], child, errors, next);
    else errors.push(next.join(".") + ": unknown workflow field");
  }
}

export function roleOutputError(id, type, body, completion=false) {
  if (!typedRole(id)) return null;
  if (id === "struct.expectation" && type !== "expectation_conflict") return "type: expectation_conflict";
  const workflow = id === "struct.expectation";
  const part = !workflow && type === "trope" && !completion;
  const schema = workflow ? ExpectationConflictWorkflowSchema.strict() : part ? item : stack;
  if (workflow && completion && body && typeof body === "object") {
    // UpsertObject materializes transport metadata alongside workflow properties.
    const {title, status, bodyMarkdown, ...properties} = body;
    body = properties;
  }
  const result = schema.safeParse(body);
  const errors = [];
  if (workflow) unknownFields(schema, body, errors);
  if (!result.success) errors.push(...result.error.issues.filter(issue => !workflow || issue.code !== "unrecognized_keys")
    .slice(0, 64).map(issue => `${issue.path.join(".") || "bodyJson"}: ${issue.message}`));
  if (errors.length) return errors.join("; ").slice(0, 12000);
  if (workflow && (!body.design?.core?.content?.trim() || !body.conflicts?.some(c=>c.oneLiner?.trim())))
    return "design.core.content 和 conflicts[].oneLiner 必须填写";
  return null;
}
