import { useState } from "react";
import { SelectionActions } from "../references/SelectionActions";
import { CollapsibleSection, HelpIcon, MarkdownDocument } from "@xiezuomanju/ui";
import type { ReactNode } from "react";
import { fieldLabel, getReportMeta } from "./reportMeta";

type Props = {
  reportId?: string;
  reportType: string;
  title?: string;
  bodyMarkdown?: string;
  bodyJson?: Record<string, unknown> | null;
};

const HIGHLIGHT_RULES: Array<[RegExp, string]> = [
  [/爽点|虐点|打脸|爽|虐/, "#30a46c"],
  [/情绪|情感/, "#3b82f6"],
  [/钩子|期待|悬念|卡点/, "#8b5cf6"],
  [/付费/, "#e5484d"],
  [/情节|节拍|节奏|单元|起承转合|反转/, "#8a8f98"],
];

function labelColor(label: string): string | undefined {
  for (const [re, color] of HIGHLIGHT_RULES) {
    if (re.test(label)) return color;
  }
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function renderValue(value: unknown): ReactNode {
  if (value == null || value === "") return <span className="faint">（暂无）</span>;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return <MarkdownDocument source={value} />;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="faint">（空）</span>;
    if (value.every((x) => typeof x === "string" || typeof x === "number")) {
      return (
        <ul className="report-list">
          {value.map((item, i) => (
            <li key={i}>{String(item)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="stack" style={{ gap: 8 }}>
        {value.map((item, i) => (
          <div key={i} className="report-block" style={{ background: "var(--surface-2)" }}>
            {isPlainObject(item) ? (
              Object.entries(item).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}>
                  <div
                    className="report-block__label"
                    style={
                      labelColor(fieldLabel(k))
                        ? { color: labelColor(fieldLabel(k)), fontWeight: 700 }
                        : undefined
                    }
                  >
                    {fieldLabel(k)}
                  </div>
                  {renderValue(v)}
                </div>
              ))
            ) : (
              <div className="report-block__value">{JSON.stringify(item)}</div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (isPlainObject(value)) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        {Object.entries(value).map(([k, v]) => {
          if (k === "markdown" || k === "raw") return null;
          return (
            <div key={k}>
              <div
                className="report-block__label"
                style={
                  labelColor(fieldLabel(k))
                    ? { color: labelColor(fieldLabel(k)), fontWeight: 700 }
                    : undefined
                }
              >
                {fieldLabel(k)}
              </div>
              {renderValue(v)}
            </div>
          );
        })}
      </div>
    );
  }
  return <div className="report-block__value">{String(value)}</div>;
}

function summarizeValue(value: unknown): string {
  if (value == null || value === "") return "暂无";
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > 64 ? `${text.slice(0, 64)}…` : text;
  }
  if (Array.isArray(value)) return `${value.length} 条`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length ? `${keys.length} 个字段` : "空";
  }
  return String(value);
}

export function ReportReader({ reportId, reportType, title, bodyMarkdown, bodyJson }: Props) {
  const [range,setRange] = useState<{start:number;end:number} | null>(null);
  const meta = getReportMeta(reportType, title);
  const json = bodyJson && Object.keys(bodyJson).length ? bodyJson : null;
  const mdFromJson = typeof json?.markdown === "string" ? json.markdown : "";
  const prose = (bodyMarkdown || "").trim() || mdFromJson;
  const skipKeys = new Set(["markdown", "raw", "pending", "jobId", "error"]);

  const structuredEntries = json
    ? Object.entries(json).filter(([k, v]) => !skipKeys.has(k) && v != null && v !== "")
    : [];

  return (
    <div className="report-reader">
      <div className="report-block" style={{ background: "var(--accent-soft)", borderColor: "var(--brand-200)" }}>
        <div className="report-block__label">
          这份报告是做什么的
          <HelpIcon text={meta.howTo} />
        </div>
        <div className="report-block__value" style={{ fontFamily: "var(--font-ui)", fontSize: 14 }}>
          {meta.purpose}
        </div>
        <div className="faint" style={{ marginTop: 8, fontSize: "var(--fs-xs)" }}>
          怎么用：{meta.howTo}
        </div>
      </div>

      {reportId && bodyMarkdown && <CollapsibleSection title="引用报告片段给助手" defaultOpen={false}>
        <textarea className="textarea" rows={8} readOnly value={bodyMarkdown} aria-label="报告原文，选中后引用"
          onSelect={e => setRange({start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd})} />
        <SelectionActions source={{kind:"report",sourceId:reportId,title}} text={bodyMarkdown} range={range} />
      </CollapsibleSection>}

      {structuredEntries.map(([key, value], index) => (
        <CollapsibleSection
          key={key}
          className="report-section"
          title={fieldLabel(key)}
          summary={summarizeValue(value)}
          defaultOpen={index < 2}
          storageKey={`kb-report-${reportType}-${key}`}
        >
          {renderValue(value)}
        </CollapsibleSection>
      ))}

      {prose && (
        <CollapsibleSection
          className="report-section"
          title="详细阅读"
          summary={`${prose.length.toLocaleString()} 字`}
          badge="整理稿"
          defaultOpen={structuredEntries.length === 0}
          storageKey={`kb-report-${reportType}-prose`}
        >
          <MarkdownDocument source={prose} />
        </CollapsibleSection>
      )}

      {!structuredEntries.length && !prose && (
        <div className="empty">还没有分析内容。点上方「重新分析文档」，稍等片刻即可阅读。</div>
      )}
    </div>
  );
}
