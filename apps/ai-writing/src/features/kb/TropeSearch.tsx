import type { TropeClip } from "@xiezuomanju/domain";
import { BookOpen, Search, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, type TropeSearchBook, type TropeSearchResult } from "../../api/client";

export type TropeSearchPick =
  | { kind: "trope"; trope: TropeClip }
  | { kind: "book"; book: TropeSearchBook };

function ResultButton({
  children,
  onPick,
}: {
  children: ReactNode;
  onPick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      data-active={hover}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
    >
      {children}
    </button>
  );
}

const popStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  right: 0,
  zIndex: 30,
  background: "var(--surface)",
  border: "1px solid var(--line-strong)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-lg)",
  overflow: "hidden",
};

const groupLabelStyle: CSSProperties = {
  fontSize: "var(--fs-xs)",
  padding: "2px 10px",
  color: "var(--faint)",
};

/**
 * 共享的梗/情节搜索框：输入防抖 300ms 调 searchTropes，结果分「桥段」「书」两组展示。
 * 组件不含页面特有逻辑，点击结果通过 onSelect 交给宿主决定跳转（桥段跳桥段、书跳知识库文档）。
 */
export function TropeSearch({ onSelect }: { onSelect: (pick: TropeSearchPick) => void }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<TropeSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const query = q.trim();
    const seq = ++seqRef.current;
    if (!query) {
      setResult(null);
      setError(null);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchTropes(query)
        .then((r) => {
          if (seq !== seqRef.current) return;
          setResult(r);
          setError(null);
          setOpen(true);
        })
        .catch((e) => {
          if (seq !== seqRef.current) return;
          setResult(null);
          setError(e instanceof Error ? e.message : "搜索失败");
          setOpen(true);
        })
        .finally(() => {
          if (seq !== seqRef.current) return;
          setLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (p: TropeSearchPick) => {
    onSelect(p);
    setOpen(false);
    setQ("");
    setResult(null);
  };

  const tropes = result?.tropes ?? [];
  const books = result?.books ?? [];

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <Search
          size={15}
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--faint)",
          }}
        />
        <input
          className="input"
          style={{ paddingLeft: 30, width: "100%" }}
          placeholder="搜索梗 / 情节关键词（桥段 + 书）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if (result || error) setOpen(true);
          }}
        />
        {loading && (
          <span
            className="faint"
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: "var(--fs-xs)",
            }}
          >
            搜索中…
          </span>
        )}
      </div>

      {open && (
        <div style={popStyle}>
          <div className="command-palette__list" style={{ maxHeight: 360 }}>
            {error ? (
              <div className="command-palette__empty">{error}</div>
            ) : tropes.length === 0 && books.length === 0 ? (
              <div className="command-palette__empty">没有匹配的桥段或书</div>
            ) : null}

            {tropes.length > 0 && (
              <>
                <div style={groupLabelStyle}>桥段</div>
                {tropes.map((t) => (
                  <ResultButton key={t.id} onPick={() => pick({ kind: "trope", trope: t })}>
                    <span className="command-palette__icon">
                      <Sparkles size={15} />
                    </span>
                    <span className="command-palette__label">{t.name}</span>
                    <span className="command-palette__hint">{t.summary}</span>
                  </ResultButton>
                ))}
              </>
            )}

            {books.length > 0 && (
              <>
                <div style={groupLabelStyle}>书</div>
                {books.map((b) => (
                  <ResultButton key={b.docId} onPick={() => pick({ kind: "book", book: b })}>
                    <span className="command-palette__icon">
                      <BookOpen size={15} />
                    </span>
                    <span className="command-palette__label">{b.title}</span>
                    <span className="command-palette__hint">
                      {[b.genre, ...b.matchedTags].filter(Boolean).join(" · ")}
                    </span>
                  </ResultButton>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
