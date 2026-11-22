import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CollapsibleSection,
  DiffCompare,
  toast,
} from "@xiezuomanju/ui";
import { History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type ArtifactVersionItem } from "../../api/client";

function versionText(v: ArtifactVersionItem): string {
  if (v.bodyMarkdown?.trim()) return v.bodyMarkdown;
  if (v.bodyJson) return JSON.stringify(v.bodyJson, null, 2);
  return "（空）";
}

export function ArtifactVersionHistory({
  projectId,
  artifactId,
  currentBody,
  currentVersion,
  dirty = false,
  storageKey,
  format,
}: {
  projectId?: string;
  artifactId?: string;
  currentBody?: string;
  currentVersion?: number;
  dirty?: boolean;
  storageKey?: string;
  format?: string;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: versions = [] } = useQuery({
    queryKey: ["artifact-versions", projectId, artifactId],
    queryFn: () => api.listArtifactVersions(projectId!, artifactId!),
    enabled: Boolean(projectId && artifactId),
  });

  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId) ?? versions[0],
    [versions, selectedId],
  );

  const [pairBusy, setPairBusy] = useState(false);
  // A/B 偏好：用户在当前稿与历史稿之间选一个，写入 PreferencePair(ab_pick)
  const recordPair = async (pick: "current" | "history") => {
    if (!selected || !currentBody?.trim()) return;
    const historyText = versionText(selected);
    const chosen = pick === "current" ? currentBody : historyText;
    const rejected = pick === "current" ? historyText : currentBody;
    if (chosen.trim() === rejected.trim()) {
      toast.fail("两稿内容相同，无法记录偏好");
      return;
    }
    setPairBusy(true);
    try {
      await api.postPreference({
        chosenText: chosen,
        rejectedText: rejected,
        source: "ab_pick",
        prompt: `版本对比 v${selected.version} vs 当前`,
        projectId,
        artifactId,
        chosenArtifactId: pick === "current" ? artifactId : selected.id,
        rejectedArtifactId: pick === "current" ? selected.id : artifactId,
        format: format ?? "*",
        meta: { historyVersion: selected.version, pick },
      });
      toast.ok("已记录 A/B 偏好");
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "记录失败");
    } finally {
      setPairBusy(false);
    }
  };

  const rollback = async () => {
    if (!projectId || !artifactId || !selected) return;
    if (dirty) {
      toast.fail("当前编辑区有未保存修改，请先保存或处理草稿后再回滚");
      return;
    }
    if (!currentVersion) {
      toast.fail("当前版本尚未加载，请刷新稿件后再回滚");
      return;
    }
    try {
      await api.rollbackArtifact(projectId, artifactId, selected.id, currentVersion);
      qc.invalidateQueries({ queryKey: ["artifact-versions", projectId, artifactId] });
      qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      toast.ok(`已回滚到 v${selected.version}`);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "回滚失败");
    }
  };

  return (
    <CollapsibleSection
      title="版本历史 · git 式 diff"
      badge={versions.length ? `${new Set(versions.map(v => v.version)).size} 版` : "0"}
      summary={selected ? `v${selected.version} · ${selected.note ?? ""}` : "暂无版本"}
      defaultOpen={false}
      storageKey={storageKey}
      actions={
        <Button
          size="sm"
          disabled={!selected || !projectId}
          onClick={() => void rollback()}
        >
          <RotateCcw size={13} />
          回滚到此版
        </Button>
      }
    >
      {!versions.length ? (
        <div className="empty">
          <History size={16} />
          尚无历史版本。每次保存/采纳都会自动生成一个版本快照。
        </div>
      ) : (
        <div className="stack">
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                className="badge"
                style={{
                  cursor: "pointer",
                  borderColor: v.id === selected?.id ? "var(--accent)" : undefined,
                }}
                onClick={() => setSelectedId(v.id)}
              >
                v{v.version} · {v.note ?? v.actor}
              </button>
            ))}
          </div>
          {selected ? (
            <DiffCompare
              leftTitle={`v${selected.version}（历史）`}
              rightTitle="当前"
              left={<pre className="prose-block">{versionText(selected)}</pre>}
              right={<pre className="prose-block">{currentBody ?? ""}</pre>}
            />
          ) : null}
          <p className="muted" style={{ margin: 0 }}>
            左侧为选中历史版本，右侧为当前内容。回滚会把当前内容先存档为新的版本，历史不丢失。
          </p>
          {selected && currentBody?.trim() && selected.bodyMarkdown?.trim() && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>A/B 偏好：</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!projectId || !artifactId || pairBusy}
                onClick={() => void recordPair("current")}
              >
                保留当前稿（记为优选）
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!projectId || !artifactId || pairBusy}
                onClick={() => void recordPair("history")}
              >
                保留历史稿（记为优选）
              </Button>
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}
