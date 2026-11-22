import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

type ObjRow = {
  rid: string;
  typeApiName: string;
  status: string;
  properties: Record<string, unknown>;
  contentHash: string;
  version: number;
};

type RunRow = {
  id: string;
  actionApiName: string;
  ok: boolean;
  actor: string;
  startedAt?: string;
  error?: string;
};

/**
 * Writing Ontology 的项目审计视图：对象计数 / 对象列表 / Action 审计 / 情景分支。
 * 连续性图（StoryContinuity）已由 StoryContinuityPanel 负责，这里不再重复展示。
 */
export function OntologyPanel({ projectId }: { projectId: string }) {
  const [objects, setObjects] = useState<ObjRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [scenarios, setScenarios] = useState<
    { rid: string; label: string; status: string; baseRids: string[] }[]
  >([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const reload = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const [objs, audit, sc] = await Promise.all([
        api.ontologyObjects(projectId),
        api.ontologyActionRuns(projectId),
        api.ontologyScenarios(projectId),
      ]);
      setObjects(objs || []);
      setRuns(audit || []);
      setScenarios(sc || []);
      const by: Record<string, number> = {};
      for (const o of objs || []) by[o.typeApiName] = (by[o.typeApiName] || 0) + 1;
      setCounts(by);
      setMsg("");
    } catch (e) {
      setMsg(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [projectId]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return objects;
    const q = filter.trim().toLowerCase();
    return objects.filter(
      (o) =>
        o.typeApiName.toLowerCase().includes(q) ||
        o.rid.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q),
    );
  }, [objects, filter]);

  const createScenario = async () => {
    const baseRids = objects.slice(0, 5).map((o) => o.rid);
    await api.ontologySubmit({
      actionApiName: "CreateScenario",
      projectId,
      parameters: { label: `试分支 ${new Date().toLocaleString()}`, baseRids },
    });
    await reload();
  };

  const linkExpectation = async () => {
    const exp = objects.find((o) => o.typeApiName === "ExpectationHook");
    const node = objects.find((o) => o.typeApiName === "StoryNode" || o.typeApiName === "CoolPoint");
    if (!exp || !node) {
      setMsg("需要 ExpectationHook 与 StoryNode/CoolPoint 才能挂 payoff 边");
      return;
    }
    await api.ontologySubmit({
      actionApiName: "LinkExpectationToGraph",
      projectId,
      parameters: { fromRid: exp.rid, toRid: node.rid, linkType: "payoff" },
    });
    await reload();
  };

  return (
    <div className="stack" style={{ padding: 12, gap: 16 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>项目审计</h2>
        <button type="button" disabled={busy || !projectId} onClick={() => void reload()}>
          刷新
        </button>
        <button type="button" disabled={busy || !projectId} onClick={() => void createScenario()}>
          创建 Scenario
        </button>
        <button type="button" disabled={busy || !projectId} onClick={() => void linkExpectation()}>
          期待挂图
        </button>
        <input
          placeholder="过滤类型 / rid"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ minWidth: 200 }}
        />
        {msg ? <span style={{ color: "crimson" }}>{msg}</span> : null}
      </header>

      <section>
        <h3>对象计数</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.entries(counts).map(([k, v]) => (
            <span key={k} style={{ border: "1px solid #ccc", padding: "2px 8px", borderRadius: 999 }}>
              {k}: {v}
            </span>
          ))}
          {!Object.keys(counts).length ? <span>暂无对象（经 Action 写入后出现）</span> : null}
        </div>
      </section>

      <section>
        <h3>Objects ({filtered.length})</h3>
        <div style={{ maxHeight: 320, overflow: "auto", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
          {filtered.map((o) => (
            <div key={o.rid} style={{ padding: "6px 0", borderBottom: "1px solid #eee" }}>
              <strong>{o.typeApiName}</strong> · {o.status} · v{o.version}
              <div>{o.rid}</div>
              <div style={{ opacity: 0.7 }}>{o.contentHash.slice(0, 12)}…</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Action 审计</h3>
        <div style={{ maxHeight: 240, overflow: "auto", fontSize: 13 }}>
          {runs.map((r) => (
            <div key={r.id} style={{ padding: "4px 0" }}>
              {r.ok ? "✓" : "✗"} {r.actionApiName} · {r.actor} · {r.startedAt || ""}
              {r.error ? <span style={{ color: "crimson" }}> — {r.error}</span> : null}
            </div>
          ))}
          {!runs.length ? <span>暂无 Action 记录</span> : null}
        </div>
      </section>

      <section>
        <h3>Scenarios</h3>
        <ul>
          {scenarios.map((s) => (
            <li key={s.rid}>
              {s.label} · {s.status} · bases={s.baseRids?.length || 0}
            </li>
          ))}
          {!scenarios.length ? <li>暂无情景分支</li> : null}
        </ul>
      </section>
    </div>
  );
}
