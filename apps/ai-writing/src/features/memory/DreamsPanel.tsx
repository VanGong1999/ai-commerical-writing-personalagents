import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DreamChange, DreamJob } from "@xiezuomanju/domain";
import { Badge, Button, DiffCompare, Panel, Select, toast } from "@xiezuomanju/ui";
import { Check, GitMerge, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../api/client";

export function DreamsPanel({
  projectId,
  storeId,
}: {
  projectId?: string;
  storeId?: string;
}) {
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});

  const { data: dreams = [], isLoading } = useQuery({
    queryKey: ["memory-dreams", projectId, storeId],
    queryFn: () => api.listDreams({ projectId, storeId }),
  });

  const { data: tree = [] } = useQuery({
    queryKey: ["memory", storeId, projectId],
    queryFn: () => api.memoryTree({ storeId, projectId }),
    enabled: !!projectId,
  });

  const archiveCandidates = useMemo(
    () =>
      tree.filter((m) => {
        if ((m.confidence ?? 0.5) >= 0.3 || m.frozen) return false;
        const anchor = m.lastAccessedAt ?? m.updatedAt;
        const idleDays = (Date.now() - new Date(anchor).getTime()) / 86_400_000;
        return idleDays > 30;
      }),
    [tree],
  );

  const selected = useMemo(
    () => dreams.find((d) => d.id === selectedId) || dreams[0],
    [dreams, selectedId],
  );

  const { data: dreamDetail } = useQuery({
    queryKey: ["memory-dream", selected?.id],
    queryFn: () => api.getDream(selected!.id),
    enabled: !!selected?.id,
  });

  const job: DreamJob | undefined = dreamDetail || selected;

  const create = useMutation({
    mutationFn: () =>
      api.createDream({
        projectId,
        storeId: storeId || (projectId ? `project.${projectId}.bible` : undefined),
        title: "Dreaming 巩固",
        windowHours: 168,
        sessionIds: (!storeId || storeId === `project.${projectId}.bible`) && sourceId.trim() ? [sourceId.trim()] : [],
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["memory-dreams"] });
      setSelectedId(row.id);
      toast.ok(`Dreaming 完成，共 ${row.changes?.length || 0} 条提案，请审查 Diff`);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const patch = useMutation({
    mutationFn: (args: { changeId: string; status?: string; editedContent?: string }) =>
      api.patchDreamChange(job!.id, args.changeId, {
        status: args.status,
        editedContent: args.editedContent,
      }),
    onError: (e: Error) => toast.fail(e.message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory-dream", job?.id] });
      qc.invalidateQueries({ queryKey: ["memory-dreams"] });
    },
  });

  const acceptAll = useMutation({
    mutationFn: () => api.acceptAllDreamChanges(job!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory-dream", job?.id] });
      toast.ok("已全部接受，可点合入");
    },
  });

  const merge = useMutation({
    mutationFn: () => api.mergeDream(job!.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["memory-dream", job?.id] });
      qc.invalidateQueries({ queryKey: ["memory-dreams"] });
      qc.invalidateQueries({ queryKey: ["memory"] });
      toast.ok(`合入完成：成功 ${r.merged}，冲突 ${r.conflicts}，拒绝 ${r.rejected}`);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const reject = useMutation({
    mutationFn: () => api.rejectDream(job!.id),
    onSuccess: (rejected) => {
      qc.setQueryData(["memory-dream", rejected.id], rejected);
      qc.invalidateQueries({ queryKey: ["memory-dreams"] });
      toast.info("已整单拒绝");
    },
  });

  const changes: DreamChange[] = job?.changes || [];

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Panel
        title="Dreaming（带外巩固）"
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Button
              variant="primary"
              disabled={!projectId || create.isPending}
              onClick={() => create.mutate()}
            >
              <Sparkles size={14} />
              发起 Dreaming
            </Button>
          </div>
        }
      >
        <p className="faint" style={{ margin: "0 0 8px", fontSize: 12 }}>
          项目共享库会扫描近七天已完成的总编私聊。会话中的明确项目事实和长期偏好需先接受，再合入，其他会话才能检索。
        </p>
        {projectId && (!storeId || storeId === `project.${projectId}.bible`) && (
          <label className="field">
            <span>限定来源会话（可选）</span>
            <input className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder="会话 ID" />
          </label>
        )}
        {!projectId && (
          <p className="muted" style={{ margin: 0 }}>
            请先在上方选择项目。
          </p>
        )}
        {isLoading && <p className="faint">加载中…</p>}
        {!!dreams.length && (
          <label className="field" style={{ maxWidth: 420 }}>
            <span>历史 Dream Job</span>
            <Select
              className="select"
              value={job?.id || ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {dreams.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} · {d.status} · {new Date(d.createdAt).toLocaleString()}
                </option>
              ))}
            </Select>
          </label>
        )}
      </Panel>

      {archiveCandidates.length > 0 && (
        <Panel title={`建议归档（${archiveCandidates.length}）`}>
          <p className="faint" style={{ margin: "0 0 8px", fontSize: 12 }}>
            这些记忆置信度低（&lt;30%）且久置未读，可能已过时。建议在「文件与归属」页手动归档；Dreaming 不会自动删除。
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {archiveCandidates.map((m) => (
              <li key={m.path} title={m.path}>
                {m.path.split("/").pop() || m.path} · 置信{" "}
                {((m.confidence ?? 0) * 100).toFixed(0)}%
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {job && (
        <Panel
          title={`提案 · ${job.status}`}
          actions={
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Badge>{changes.filter((c) => c.status === "pending").length} 待审 · {changes.filter((c) => c.status === "accepted").length} 已接受</Badge>
              <Button size="sm" disabled={acceptAll.isPending || !changes.some((c) => c.status === "pending")} onClick={() => acceptAll.mutate()}>
                全部接受
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={merge.isPending || !changes.some((c) => c.status === "accepted")}
                onClick={() => {
                  if (confirm("确认将已接受的变更 CAS 合入记忆库？")) merge.mutate();
                }}
              >
                <GitMerge size={13} />
                合入已接受项
              </Button>
              <Button size="sm" disabled={reject.isPending} onClick={() => reject.mutate()}>
                <X size={13} />
                整单拒绝
              </Button>
            </div>
          }
        >
          {job.reportMarkdown && (
            <pre
              className="faint"
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 12,
                margin: "0 0 12px",
                maxHeight: 160,
                overflow: "auto",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 8,
              }}
            >
              {job.reportMarkdown}
            </pre>
          )}
          {job.error && <p style={{ color: "var(--danger)" }}>{job.error}</p>}
          {!changes.length && <p className="faint">暂无变更提案。</p>}
          {changes.map((ch) => {
            const draft =
              editing[ch.id] ??
              (ch.editedContent != null ? ch.editedContent : ch.afterContent);
            return (
              <div
                key={ch.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 10,
                }}
              >
                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <Badge tone={ch.op === "delete" ? "warn" : "ok"}>{ch.op}</Badge>
                  <Badge>{ch.status}</Badge>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{ch.path.split("/").pop()}</span>
                  <span className="faint" style={{ fontSize: 11 }} title={ch.path}>
                    {ch.path}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                  {ch.rationale}
                </p>
                {ch.provenance && (
                  <details open>
                    <summary>{ch.provenance.category === "project_fact" ? "项目事实" : "长期偏好"}候选 · 来源原话</summary>
                    <blockquote>{ch.provenance.quote}</blockquote>
                    <small>会话 {ch.provenance.conversationId} · 消息 {ch.provenance.messageId} · 字符 [{ch.provenance.start}, {ch.provenance.end})</small>
                  </details>
                )}
                {ch.conflictDetail && (
                  <p style={{ color: "var(--danger)", fontSize: 12 }}>冲突：{ch.conflictDetail}</p>
                )}
                <DiffCompare
                  leftTitle="合入前"
                  rightTitle="提案（可编辑）"
                  left={
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: 0, maxHeight: 220, overflow: "auto" }}>
                      {ch.beforeContent || "（空 / 新建）"}
                    </pre>
                  }
                  right={
                    <textarea
                      className="textarea"
                      style={{ minHeight: 200, fontSize: 12, fontFamily: "var(--font-mono, monospace)" }}
                      value={draft}
                      disabled={!(["pending", "accepted"].includes(ch.status))}
                      onChange={(e) =>
                        setEditing((m) => ({ ...m, [ch.id]: e.target.value }))
                      }
                    />
                  }
                />
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <Button
                    size="sm" disabled={patch.isPending || !["pending", "accepted"].includes(ch.status) || draft === (ch.editedContent ?? ch.afterContent)}
                    onClick={() => patch.mutate({ changeId: ch.id, editedContent: draft })}
                  >
                    保存为待审
                  </Button>
                  <Button
                    size="sm"
                    disabled={patch.isPending || !["pending", "accepted"].includes(ch.status)}
                    onClick={() =>
                      patch.mutate({
                        changeId: ch.id,
                        status: "accepted",
                        editedContent: draft,
                      })
                    }
                  >
                    <Check size={13} />
                    接受（含修改）
                  </Button>
                  <Button
                    size="sm"
                    disabled={patch.isPending || !["pending", "accepted"].includes(ch.status)}
                    onClick={() => patch.mutate({ changeId: ch.id, status: "rejected" })}
                  >
                    拒绝此条
                  </Button>
                </div>
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
