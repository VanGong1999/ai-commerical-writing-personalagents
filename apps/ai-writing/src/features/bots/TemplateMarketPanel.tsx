import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Panel, toast } from "@xiezuomanju/ui";
import {
  api,
  formatLabel,
  type Bot,
  type BotTeam,
  type SquadPreset,
} from "../../api/client";
import type { ProjectFormat } from "@xiezuomanju/domain";

export function TemplateMarketPanel({
  variant = "squads",
  onImported,
  onApplySquad,
}: {
  /** squads：编组预设；templates：高级区自定义模板导入 */
  variant?: "squads" | "templates";
  onImported?: (result: { kind: "bot"; bot: Bot } | { kind: "team"; team: BotTeam }) => void;
  onApplySquad?: (squad: SquadPreset) => void;
}) {
  const qc = useQueryClient();
  const squadsQ = useQuery({
    queryKey: ["bot-squads"],
    queryFn: () => api.listSquads(),
    enabled: variant === "squads",
  });
  const templatesQ = useQuery({
    queryKey: ["bot-templates"],
    queryFn: () => api.listBotTemplates(),
    enabled: variant === "templates",
  });

  const importMut = useMutation({
    mutationFn: (templateId: string) => api.importBotTemplate({ templateId }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["bots"] });
      void qc.invalidateQueries({ queryKey: ["bot-teams"] });
      if (res.kind === "team") {
        toast.ok(`已导入团队「${res.team.name}」`);
      } else {
        toast.ok(`已导入同事「${res.bot.name}」`);
      }
      onImported?.(res);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  if (variant === "templates") {
    const templates = templatesQ.data || [];
    const filtered = templates.filter(
      (t) => t.id.includes("chief") || t.id.includes("eggbot") || t.name.includes("蛋") || t.name.includes("总编"),
    );
    const list = filtered.length ? filtered : templates.slice(0, 6);
    return (
      <Panel title="自定义同事模板" actions={<Badge>{list.length}</Badge>}>
        <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
          仅展示总编 / 蛋博士相关模板；专职同事来自花名册，无需再导入。
        </p>
        <div className="stack scroll-region panel-scroll-region" style={{ gap: 10 }}>
          {templatesQ.isLoading && <div className="faint">加载模板…</div>}
          {list.map((t) => (
            <div key={t.id} className="pkg-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{t.name}</strong>
                <Badge>{t.kind === "team" ? "团队" : "同事"}</Badge>
              </div>
              <p className="faint" style={{ fontSize: "var(--fs-sm)", margin: "6px 0 10px" }}>
                {t.description || "无描述"}
              </p>
              <Button
                size="sm"
                variant="primary"
                disabled={importMut.isPending}
                onClick={() => importMut.mutate(t.id)}
              >
                导入
              </Button>
            </div>
          ))}
          {!list.length && !templatesQ.isLoading && <div className="empty">暂无模板</div>}
        </div>
      </Panel>
    );
  }

  const squads = squadsQ.data?.squads || [];

  return (
    <Panel title="编组预设" actions={<Badge>{squads.length}</Badge>}>
      <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
        每个预设包含推荐成员、发言策略与阶段拓扑。点「套用」打开编组向导并预填。
      </p>
      <div className="stack scroll-region panel-scroll-region" style={{ gap: 10 }}>
        {squadsQ.isLoading && <div className="faint">加载预设…</div>}
        {squads.map((s) => (
          <div key={s.id} className="pkg-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{s.name}</strong>
              {s.format ? (
                <Badge>{formatLabel(s.format as ProjectFormat)}</Badge>
              ) : (
                <Badge tone="default">通用</Badge>
              )}
            </div>
            <p className="faint" style={{ fontSize: "var(--fs-sm)", margin: "6px 0 10px" }}>
              {s.description}
            </p>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Badge tone="default">{s.memberBotIds.length} 人</Badge>
              <Badge tone="default">策略 {s.speakPolicy}</Badge>
              {s.coverageTeams.slice(0, 4).map((t) => (
                <Badge key={t} tone="default">
                  {t}
                </Badge>
              ))}
            </div>
            {onApplySquad ? (
              <Button
                size="sm"
                variant="primary"
                style={{ marginTop: 10 }}
                onClick={() => onApplySquad(s)}
              >
                套用
              </Button>
            ) : null}
          </div>
        ))}
        {!squads.length && !squadsQ.isLoading && <div className="empty">暂无编组预设</div>}
      </div>
    </Panel>
  );
}
