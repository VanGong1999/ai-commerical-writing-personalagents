import { useEffect, useMemo, useRef, useState } from "react";

let renderSeq = 0;

/** 渲染 Mermaid 代码为 SVG；解析失败回退为代码文本。 */
export function MermaidDiagram({
  code,
  maxHeight = 480,
}: {
  code: string;
  maxHeight?: number;
}) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(() => `xmj-mermaid-${++renderSeq}`, [code]);

  useEffect(() => {
    let cancelled = false;
    const text = String(code || "").trim();
    if (!text) {
      setSvg("");
      setError("");
      return;
    }
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "var(--font-ui, system-ui, sans-serif)",
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },
      });
      try {
        const result = await mermaid.render(`${renderId}-svg`, text);
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setSvg("");
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  if (error) {
    return (
      <div className="stack" style={{ gap: 4 }}>
        <pre
          style={{
            maxHeight,
            overflow: "auto",
            fontSize: 11,
            padding: 10,
            background: "var(--bg-muted, #111)",
            color: "var(--fg, #eee)",
            borderRadius: 8,
            margin: 0,
            whiteSpace: "pre-wrap",
          }}
        >
          {code}
        </pre>
        <div className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
          图渲染失败（{error}）— 已回退为代码视图
        </div>
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="mermaid-host scroll-region"
      style={{ maxHeight, overflow: "auto", padding: 4 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
