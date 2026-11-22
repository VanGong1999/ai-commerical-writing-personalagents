import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Drawer,
  toast,
} from "@xiezuomanju/ui";
import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";

async function exportProjectJson(projectId: string) {
  const project = await api.getProject(projectId);
  const artifacts = await api.listArtifacts(projectId);
  const payload = { exportedAt: new Date().toISOString(), project, artifacts };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.title || "project"}-export.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ProjectSnapshotsDrawer({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("手动快照");
  const [includeFullText, setIncludeFullText] = useState(true);
  const { data = [] } = useQuery({
    queryKey: ["project-snapshots", projectId],
    queryFn: () => api.listProjectSnapshots(projectId!),
    enabled: Boolean(projectId),
  });

  const createSnap = useMutation({
    mutationFn: () => api.createProjectSnapshot(projectId!, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-snapshots", projectId] });
      toast.ok("快照已创建");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const restoreSnap = useMutation({
    mutationFn: (sid: string) => api.restoreProjectSnapshot(projectId!, sid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-snapshots", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.ok("已恢复到该快照");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const duplicate = useMutation({
    mutationFn: () => api.duplicateProject(projectId!, includeFullText),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.ok("已复制项目");
      onClose();
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  return (
    <Drawer open={!!projectId} onOpenChange={(o) => !o && onClose()} title="项目快照与版本" width={420}>
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="快照名称"
          />
          <Button variant="primary" onClick={() => createSnap.mutate()} disabled={!name.trim()}>
            <Save size={14} />
            快照
          </Button>
        </div>
        <label className="row" style={{ gap: 6, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={includeFullText}
            onChange={(e) => setIncludeFullText(e.target.checked)}
          />
          复制稿件全文（取消则只复制设定与进度）
        </label>
        <Button onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
          复制项目
        </Button>
        <Button
          variant="ghost"
          onClick={() => void exportProjectJson(projectId!)}
        >
          导出项目 JSON（备份 / 迁移）
        </Button>

        <div className="divider" />
        <strong style={{ fontSize: "var(--fs-sm)" }}>历史快照（{data.length}）</strong>
        {data.length === 0 ? (
          <div className="empty">还没有快照。先创建一个，之后可一键回滚整项目。</div>
        ) : (
          <div className="stack scroll-region compact-scroll-region">
            {data.map((s) => (
              <div key={s.id} className="agent-task-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>{s.name}</div>
                  <div className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
                    {s.stage} · {new Date(s.createdAt).toLocaleString("zh-CN")}
                    {s.note ? ` · ${s.note}` : ""}
                  </div>
                </div>
                <Badge>{s.artifacts.length} 份稿件</Badge>
                <Button size="sm" onClick={() => restoreSnap.mutate(s.id)}>
                  <RotateCcw size={13} />
                  恢复
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
