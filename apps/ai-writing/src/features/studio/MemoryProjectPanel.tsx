import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@xiezuomanju/ui";
import { api } from "../../api/client";
import { RlScorePanel } from "./RlScorePanel";

export function MemoryProjectPanel({ projectId }: { projectId?: string }) {
  const nav = useNavigate();
  const { data: memories = [] } = useQuery({
    queryKey: ["memory-tree"],
    queryFn: () => api.memoryTree(),
    enabled: Boolean(projectId),
  });
  const projectMemories = memories.filter((m) => m.projectId === projectId);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <RlScorePanel projectId={projectId} />
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        项目设定、人设与决策摘要保存在记忆中，随写作自动累计。
      </p>
      {projectMemories.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          暂无本项目的记忆文件。
        </p>
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {projectMemories.slice(0, 12).map((m) => (
            <div
              key={m.path}
              className="row"
              style={{ gap: 6, alignItems: "baseline", fontSize: 12 }}
            >
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={m.path}
              >
                {m.path.split("/").pop() || m.path}
              </span>
              {m.frozen ? <span className="badge">已冻结</span> : null}
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={() => void nav({ to: "/memory" })}>
        记忆管理
      </Button>
    </div>
  );
}
