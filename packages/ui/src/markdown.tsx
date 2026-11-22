import { useState, type ReactNode } from "react";

function safeHref(href: string): string | null {
  const h = href.trim();
  if (h.startsWith("#") || h.startsWith("/")) return h;
  try {
    const url = new URL(h);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode {
  const parts: ReactNode[] = [];
  const re =
    /(\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${idx++}`;
    if (m[2] != null && m[3] != null) {
      const href = safeHref(m[3]);
      parts.push(
        href ? (
          <a key={key} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            {m[2]}
          </a>
        ) : (
          m[2]
        ),
      );
    } else if (m[4] != null) {
      parts.push(<strong key={key}>{m[4]}</strong>);
    } else if (m[5] != null) {
      parts.push(<strong key={key}>{m[5]}</strong>);
    } else if (m[6] != null) {
      parts.push(<del key={key}>{m[6]}</del>);
    } else if (m[7] != null) {
      parts.push(<code key={key}>{m[7]}</code>);
    } else if (m[8] != null) {
      parts.push(<em key={key}>{m[8]}</em>);
    } else if (m[9] != null) {
      parts.push(<em key={key}>{m[9]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code__bar">
        <span>{lang || "text"}</span>
        <button
          type="button"
          onClick={() => {
            const copiedPromise = navigator.clipboard?.writeText(code);
            if (copiedPromise) {
              void copiedPromise.then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              });
            }
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line) && line.includes("-");
}

/** 完整 Markdown 阅读器：标题 / 表格 / 代码块 / 引用 / 列表 / 任务项 / 行内语法。 */
export function MarkdownDocument({ source }: { source: string }) {
  const lines = (source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^\s*```([\w#+.-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(<CodeBlock key={`code-${key++}`} code={code.join("\n")} lang={lang} />);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h-${key}`);
      if (level === 1) blocks.push(<h1 key={`h-${key++}`}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${key++}`}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={`h-${key++}`}>{content}</h3>);
      else blocks.push(<h4 key={`h-${key++}`}>{content}</h4>);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1/.test(line)) {
      blocks.push(<hr key={`hr-${key++}`} />);
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith("|") && isTableSeparator(lines[i + 1] ?? "")) {
      const header = tableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim()) {
        rows.push(tableCells(lines[i] ?? ""));
        i += 1;
      }
      blocks.push(
        <div className="md-table-wrap" key={`table-${key++}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <th key={idx}>{renderInline(cell, `th-${idx}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ridx) => (
                <tr key={ridx}>
                  {header.map((_, cidx) => (
                    <td key={cidx}>{renderInline(row[cidx] ?? "", `td-${ridx}-${cidx}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`quote-${key++}`}>
          {quote.map((q, idx) => (
            <p key={idx}>{renderInline(q, `q-${idx}`)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    const listItem = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (listItem) {
      const ordered = /^\d+\.$/.test(listItem[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const item = (lines[i] ?? "").match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (!item) break;
        items.push(item[2]);
        i += 1;
      }
      const rendered = items.map((item, idx) => {
        const task = item.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          return (
            <li className="md-task" key={idx}>
              <input type="checkbox" checked={task[1].toLowerCase() === "x"} readOnly />
              {renderInline(task[2], `li-${idx}`)}
            </li>
          );
        }
        return <li key={idx}>{renderInline(item, `li-${idx}`)}</li>;
      });
      blocks.push(
        ordered ? <ol key={`ol-${key++}`}>{rendered}</ol> : <ul key={`ul-${key++}`}>{rendered}</ul>,
      );
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^#{1,4}\s+/.test(lines[i] ?? "") &&
      !/^\s*```/.test(lines[i] ?? "") &&
      !/^\s*>\s?/.test(lines[i] ?? "") &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i] ?? "")
    ) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push(
      <p key={`p-${key++}`}>
        {para.map((text, idx) => (
          <span key={idx}>
            {idx > 0 ? <br /> : null}
            {renderInline(text, `p-${key}-${idx}`)}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="markdown-body report-md">{blocks}</div>;
}
