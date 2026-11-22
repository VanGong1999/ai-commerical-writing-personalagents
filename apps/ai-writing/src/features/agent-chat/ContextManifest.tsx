import { useState } from "react";
import { api } from "../../api/client";
import type { ContextRef } from "../references/selection";

type Row = { id?: string; role?: string; source?: string; path?: string; version?: string | number; hash?: string;
  preview?: string; hidden?: string; clipped?: boolean; truncated?: boolean; status?: string; chars?: number; receipt?: string; callsHash?: string; callNames?: string[]; callIds?: string[] };
type ManifestReference = ContextRef & { preview?: string; clipped?: boolean; hidden?: string };
type Manifest = { schema?: number; mode?: string; count: number; originalChars: number; sentChars: number;
  rows: Row[]; slots?: Row[]; tools?: string[]; toolOrderHash?: string; toolSchemaHash?: string;
  excluded?: string; omitted?: number; references?: ManifestReference[];
  changes?: Row[]; receipts?: string[]; archived?: string[]; omittedChanges?: number; omittedReceipts?: number; omittedArchived?: number; omittedReferences?: number };
const labels: Record<string, string> = { normal: "常规请求", compaction: "压缩后", handoff: "交接后", discussion: "讨论交接",
  summary_request: "生成摘要", summary: "历史摘要", platform: "平台规则", identity: "岗位身份", role: "角色",
  facts: "会话事实", core_facts: "项目共享事实", contract: "执行约束", skill_meta: "当前技能", tool_index: "工具索引",
  lessons: "岗位私有经验", system: "系统指令", assistant: "助手", tool: "工具结果", user: "用户输入",
  included: "已发送", metadata_only: "仅发送来源信息", clipped: "已截短", summarized: "纳入摘要", removed: "已移出", archived: "已归档" };

function SourceRow({ row }: { row: Row }) {
  const name = row.source || row.role || "";
  return <details><summary>{labels[name] || name} · {labels[row.status || "included"]} {row.chars != null && ` · ${row.chars} 字符`}</summary>
    <div>{[row.path, row.version != null && `版本 ${row.version}`, row.id, row.receipt, row.hash, row.callsHash, ...(row.callNames || []), ...(row.callIds || [])].filter(Boolean).join(" · ")}</div>
    {row.preview && <pre style={{ whiteSpace: "pre-wrap" }}>{row.preview}</pre>}
    {row.hidden && <small>{row.hidden} · 已隐藏预览</small>}
    {row.clipped && <small>仅展示部分预览</small>}{row.truncated && <small> · 槽位已按预算截短</small>}
  </details>;
}

function Snapshot({ reference }: { reference: ContextRef }) {
  const [text, setText] = useState("");
  return <div><button type="button" onClick={async () => {
    try { const result = await api.resolveContextRefs([reference]); setText(result.refs[0]?.quote || "选区为空"); }
    catch { setText("此版本暂不可读"); }
  }}>查看引用快照 · {reference.sourceId} · {reference.start}–{reference.end}</button>
    {text && <pre style={{whiteSpace:"pre-wrap"}}>{text}</pre>}</div>;
}

function ReferencePreview({ reference }: { reference: ManifestReference }) {
  const { sourceId, version, start, end, contentHash, preview, clipped, hidden } = reference;
  return <details>
    <summary>资料引用（发送时）{sourceId && ` · ${sourceId}`}</summary>
    <div>{[
      version != null && `版本 ${version}`,
      start != null && end != null && `UTF-16 范围 ${start}–${end}`,
      contentHash && `内容哈希 ${contentHash}`,
    ].filter(Boolean).join(" · ")}</div>
    {hidden && <small>{hidden} · 已隐藏预览</small>}
    {!hidden && preview && <pre style={{ whiteSpace: "pre-wrap" }}>{preview}</pre>}
    {clipped && <small>仅展示部分预览</small>}
  </details>;
}

export function ContextManifest({ value }: { value: unknown }) {
  const m = value as Manifest;
  if (m?.schema !== 1 || !Array.isArray(m.rows)) return null;
  return <details className="step-item__detail">
    <summary>本次模型上下文 · {labels[m.mode || "normal"]} · {m.count} 条消息</summary>
    <p>正文与工具调用字符 · 整理前 {m.originalChars} → 发送 {m.sentChars}</p>
    {m.slots?.map((row, i) => <SourceRow key={i} row={row} />)}
    {m.rows.map((row, i) => <SourceRow key={i} row={row} />)}
    {(m.omitted || 0) > 0 && <small>另有 {m.omitted} 条消息未展示</small>}
    {m.changes?.length ? <details><summary>压缩前消息去向</summary>{m.changes.map((row, i) => <SourceRow key={i} row={row} />)}</details> : null}
    {m.receipts?.length ? <p>保留回执 · {m.receipts.join("、")}</p> : null}
    {m.archived?.length ? <p>已归档回执 · {m.archived.join("、")}</p> : null}
    {m.references?.map((r, i) => r.snapshotId ? <Snapshot key={i} reference={r} /> : <ReferencePreview key={i} reference={r} />)}
    {Boolean(m.omittedChanges || m.omittedReceipts || m.omittedArchived || m.omittedReferences) && <small>未展开的条目 · 消息去向 {m.omittedChanges || 0}，回执 {m.omittedReceipts || 0}，归档 {m.omittedArchived || 0}，引用 {m.omittedReferences || 0}</small>}
    <p>工具顺序 · {m.tools?.join(" → ") || "无工具"}</p>
    {(m.toolOrderHash || m.toolSchemaHash) && <details>
      <summary>工作进程请求诊断</summary>
      {m.toolOrderHash && <div>工具顺序哈希 · {m.toolOrderHash}</div>}
      {m.toolSchemaHash && <div>工具定义哈希 · {m.toolSchemaHash}</div>}
    </details>}
    <small>{m.excluded}</small>
  </details>;
}
