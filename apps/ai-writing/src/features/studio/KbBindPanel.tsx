import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button, toast } from "@xiezuomanju/ui";
import { api } from "../../api/client";

export function KbBindPanel({
  projectId,
  benchmark,
}: {
  projectId?: string;
  benchmark?: string;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: docs = [] } = useQuery({
    queryKey: ["kb-docs"],
    queryFn: () => api.listDocs(),
  });
  const { data: hotspots = [] } = useQuery({
    queryKey: ["hotspots"],
    queryFn: () => api.listHotspots(),
  });

  const bind = async (title: string) => {
    if (!projectId) return;
    try {
      await api.patchProject(projectId, { coverMeta: { benchmark: title } });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.ok(`已把「${title}」设为对标书`);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "绑定失败");
    }
  };

  const bindHotspot = async (hotspotId: string, title: string) => {
    if (!projectId) return;
    try {
      await api.bindHotspot(hotspotId, projectId);
      qc.invalidateQueries({ queryKey: ["hotspots"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.ok(`已把热点「${title}」绑定为对标`);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "绑定失败");
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12 }}>
        对标作品：{benchmark || "未绑定"}。绑定后可回知识库拆书，拆解参数回流到本项目。
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <Button size="sm" variant="ghost" onClick={() => void nav({ to: "/kb/crawler" })}>
          扫榜热点
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void nav({ to: "/kb" })}>
          打开知识库
        </Button>
      </div>
      {docs.length > 0 && (
        <div className="stack" style={{ gap: 4, maxHeight: 220, overflowY: "auto" }}>
          {docs.slice(0, 20).map((d) => (
            <div key={d.id} className="row" style={{ gap: 8, alignItems: "center" }}>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={d.title}
              >
                {d.title}
              </span>
              <Button
                size="sm"
                variant={benchmark === d.title ? "primary" : "ghost"}
                onClick={() => void bind(d.title)}
              >
                {benchmark === d.title ? "已对标" : "设为对标"}
              </Button>
            </div>
          ))}
        </div>
      )}
      {hotspots.length > 0 && (
        <div className="stack" style={{ gap: 4, maxHeight: 180, overflowY: "auto" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            扫榜热点（可绑定为对标）
          </span>
          {hotspots.slice(0, 15).map((h) => (
            <div key={h.id} className="row" style={{ gap: 8, alignItems: "center" }}>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={`${h.title} · ${h.genre} · ${h.source}`}
              >
                {h.title}
              </span>
              <span className="badge">{h.source}</span>
              <Button
                size="sm"
                variant={h.projectId === projectId ? "primary" : "ghost"}
                onClick={() => void bindHotspot(h.id, h.title)}
              >
                {h.projectId === projectId ? "已绑定" : "绑定"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
