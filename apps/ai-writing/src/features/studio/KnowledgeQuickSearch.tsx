import { useState } from "react";
import { Button } from "@xiezuomanju/ui";
import { api } from "../../api/client";

export function KnowledgeQuickSearch() {
  const [q, setQ] = useState("核心梗");
  const [hits, setHits] = useState<
    Array<{ title?: string; path?: string; score?: number; summary?: string }>
  >([]);
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
      <div className="row" style={{ gap: 6 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜蒸馏知识库"
          style={{
            flex: 1,
            minWidth: 0,
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "6px 8px",
            background: "var(--bg)",
            color: "inherit",
          }}
        />
        <Button
          disabled={busy || !q.trim()}
          onClick={() => {
            setBusy(true);
            void api
              .searchKnowledge(q.trim(), { limit: 5 })
              .then((r) => setHits(r.hits || []))
              .finally(() => setBusy(false));
          }}
        >
          搜
        </Button>
      </div>
      {hits.map((h) => (
        <div key={`${h.path}-${h.title}`} style={{ fontSize: 12 }}>
          <strong>{h.title}</strong>
          <div className="faint">{h.summary}</div>
        </div>
      ))}
    </div>
  );
}
