import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Modal, toast } from "@xiezuomanju/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  formatLabel,
  type BotTeam,
  type Conversation,
  type CoverageReport,
  type RosterColleague,
  type SquadPreset,
} from "../../api/client";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { colleagueBotId, flattenRoster } from "./rosterBot";

const FORMATS: ProjectFormat[] = [
  "manju",
  "duanju",
  "short_novel",
  "male_long",
  "female_long",
  "ip_adapt",
];

const SPEAK_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "pipeline", label: "流水线", hint: "按阶段依次交接，总编牵头" },
  { value: "orchestrated", label: "编排", hint: "总编协调多轮发言（推荐讨论）" },
  { value: "mention_only", label: "仅 @", hint: "未被点名不说话" },
  { value: "free", label: "自由", hint: "成员可按群规自主接话" },
];

function TopologyPreview({
  preset,
  members,
  chiefName,
}: {
  preset: SquadPreset | null;
  members: RosterColleague[];
  chiefName: string;
}) {
  const stages = preset?.stages?.length
    ? preset.stages
    : [{ name: "成员", memberBotIds: members.map((m) => colleagueBotId(m)) }];
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    m.set("chief", chiefName);
    for (const c of members) m.set(colleagueBotId(c), c.displayName || c.name);
    return m;
  }, [members, chiefName]);

  return <UserTopology chiefName={chiefName} stages={stages} nameMap={nameMap} />;
}

function UserTopology({
  chiefName,
  stages,
  nameMap,
}: {
  chiefName: string;
  stages: SquadPreset["stages"];
  nameMap: Map<string, string>;
}) {
  return (
    <div className="topology-preview">
      <div className="topology-preview__chief">
        <span>总编</span>
        <strong>{chiefName}</strong>
      </div>
      <div className="topology-preview__arrow">↓</div>
      {stages.map((st, i) => {
        const ids = st.memberBotIds || st.agentIds || [];
        const labels = ids.map((id) => nameMap.get(String(id)) || id);
        return (
          <div key={st.id || i} className="topology-preview__stage">
            <div className="topology-preview__stage-head">
              <Badge>{st.name || st.id || `阶段 ${i + 1}`}</Badge>
              {st.requiresUserAck ? <small>需确认</small> : null}
            </div>
            <ul>
              {labels.length ? labels.map((l) => <li key={l}>{l}</li>) : <li className="faint">（成员）</li>}
            </ul>
            {i < stages.length - 1 ? <div className="topology-preview__arrow">↓</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  projectId,
  initialMemberIds,
  initialPreset,
  onCreated, getSelectionGeneration,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 从侧栏多选带入的同事 botId */
  projectId?:string;
  initialMemberIds?: string[];
  initialPreset?: SquadPreset;
  onCreated?: (team: BotTeam, conversation: Conversation, generation?: number) => void;
  getSelectionGeneration?: () => number;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<ProjectFormat | "">("");
  const [preset, setPreset] = useState<SquadPreset | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [rulesMd, setRulesMd] = useState("");
  const [speakPolicy, setSpeakPolicy] = useState("orchestrated");
  const [truthSourcePath, setTruthSourcePath] = useState("");

  const rosterQ = useQuery({
    queryKey: ["bot-roster", format || "all",projectId],
    queryFn: () => api.getBotRoster({format:format || undefined,projectId}),
    enabled: open,
  });
  const squadsQ = useQuery({
    queryKey: ["bot-squads"],
    queryFn: () => api.listSquads(),
    enabled: open,
  });

  const roster = rosterQ.data;
  const allColleagues = useMemo(
    () => (roster ? flattenRoster(roster) : []),
    [roster],
  );
  const colleagueById = useMemo(() => {
    const m = new Map<string, RosterColleague>();
    for (const c of allColleagues) m.set(colleagueBotId(c), c);
    return m;
  }, [allColleagues]);

  const squads = squadsQ.data?.squads || [];
  const filteredSquads = useMemo(
    () => squads.filter((s) => !format || !s.format || s.format === format),
    [squads, format],
  );

  const coverageQ = useQuery({
    queryKey: ["bot-coverage", memberIds.join(","), format],
    queryFn: () =>
      api.botCoverage({
        memberBotIds: memberIds,
        format: format || undefined,
      }),
    enabled: open && step >= 1 && memberIds.length > 0,
  });

  const applyPreset = useCallback((s: SquadPreset) => {
    setPreset(s);
    if (s.format) setFormat(s.format as ProjectFormat);
    setMemberIds([...new Set(s.memberBotIds)]);
    setSpeakPolicy(s.speakPolicy || "pipeline");
    setName((prev) => prev || s.name);
    setRulesMd((prev) => prev || s.description);
  }, []);

  useEffect(() => {
    if (!open) {
      setStep(0);
      setFormat("");
      setPreset(null);
      setMemberIds([]);
      setName("");
      setRulesMd("");
      setSpeakPolicy("orchestrated");
      setTruthSourcePath("");
    } else if (initialPreset) {
      applyPreset(initialPreset);
    } else if (initialMemberIds?.length) {
      setMemberIds(initialMemberIds);
    }
  }, [open, initialMemberIds, initialPreset, applyPreset]);

  const toggleMember = (botId: string) => {
    setMemberIds((prev) => (prev.includes(botId) ? prev.filter((x) => x !== botId) : [...prev, botId]));
  };

  const fillMissing = (report: CoverageReport) => {
    const add = report.missing.map((m) => m.botId).filter((id) => !memberIds.includes(id));
    if (!add.length) {
      toast.info("已覆盖全部必需职能");
      return;
    }
    setMemberIds((prev) => [...new Set([...prev, ...add])]);
    toast.ok(`已补全 ${add.length} 位同事`);
  };

  const create = useMutation({
    mutationFn: async () => {
      const generation = getSelectionGeneration?.();
      const leadBotId = preset?.leadBotId || "chief";
      const team = await api.createBotTeam({
        name: name.trim(),
        memberBotIds: memberIds,
        leadBotId,
        rulesMd,
        speakPolicy,
        templateId: preset?.id,
        truthSourcePath: truthSourcePath.trim() || null,
      });
      const conv = await api.createConversation({
        title: team.name,
        kind: "group", projectId: projectId || undefined,
        teamId: team.id,
        memberBotIds: team.memberBotIds,
        groupRules: {
          rulesMd,
          speak_policy: speakPolicy,
          speakPolicy,
          format: format || preset?.format || null,
          stages: preset?.stages || [],
          truth_source_path: truthSourcePath.trim() || null,
          truthSourcePath: truthSourcePath.trim() || null,
        },
      });
      return { team, conv, generation };
    },
    onSuccess: ({ team, conv, generation }) => {
      if (getSelectionGeneration?.() !== generation) {
        void qc.invalidateQueries({ queryKey: ["bot-teams"] });
        return;
      }
      toast.ok(`已创建编组「${team.name}」`);
      void qc.invalidateQueries({ queryKey: ["bot-teams"] });
      onCreated?.(team, conv, generation);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const coverage = coverageQ.data;
  const chiefName = roster?.chief.displayName || roster?.chief.name || "总编";

  const footer = (
    <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
      <span className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
        第 {step + 1} / 3 步
      </span>
      <div className="row" style={{ gap: 8 }}>
        <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>
          取消
        </Button>
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={create.isPending}>
            上一步
          </Button>
        ) : null}
        {step < 2 ? (
          <Button
            variant="primary"
            disabled={step === 1 && memberIds.length < 2}
            onClick={() => setStep((s) => s + 1)}
          >
            下一步
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={create.isPending || !name.trim() || memberIds.length < 2}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "创建中…" : "创建编组"}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="编组向导"
      description="选择体裁或编组预设 → 挑选同事 → 设定发言策略与拓扑。"
      width={560}
      footer={footer}
    >
      {step === 0 ? (
        <div className="stack" style={{ gap: 12 }}>
          <label className="field">
            <span>体裁（可选）</span>
            <select
              className="select"
              value={format}
              onChange={(e) => {
                setFormat((e.target.value || "") as ProjectFormat | "");
                setPreset(null);
              }}
            >
              <option value="">不限体裁</option>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {formatLabel(f)}
                </option>
              ))}
            </select>
          </label>
          <div>
            <strong style={{ fontSize: "var(--fs-sm)" }}>编组预设</strong>
            <div className="stack" style={{ gap: 8, marginTop: 8, maxHeight: 280, overflow: "auto" }}>
              {filteredSquads.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`squad-pick${preset?.id === s.id ? " squad-pick--active" : ""}`}
                  onClick={() => applyPreset(s)}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{s.name}</strong>
                    {s.format ? <Badge>{formatLabel(s.format as ProjectFormat)}</Badge> : null}
                  </div>
                  <p className="faint" style={{ margin: "4px 0 0", fontSize: "var(--fs-2xs)" }}>
                    {s.description}
                  </p>
                </button>
              ))}
              {!filteredSquads.length && !squadsQ.isLoading ? (
                <div className="empty">暂无预设，可直接选体裁进入下一步</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="stack" style={{ gap: 10 }}>
          <label className="field">
            <span>编组名称</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：漫剧首发小队" />
          </label>
          <div className="bots-roster-pick scroll-region" style={{ maxHeight: 240 }}>
            {roster?.teams.map((g) => (
              <details key={g.team} className="bots-roster-group" open>
                <summary>
                  <span className="bots-home__avatar" style={{ background: g.teamColor }}>
                    {g.emoji}
                  </span>
                  {g.team}
                </summary>
                <GroupMembers members={g.members} selected={memberIds} onToggle={toggleMember} />
              </details>
            ))}
          </div>
          {coverage ? (
            <div className="coverage-bar">
              <div className="coverage-bar__track">
                <div
                  className="coverage-bar__fill"
                  style={{ width: `${Math.round(coverage.coverageRatio * 100)}%` }}
                />
              </div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: "var(--fs-2xs)" }}>
                <span>
                  职能覆盖 {Math.round(coverage.coverageRatio * 100)}%（{coverage.selectedCount}/
                  {coverage.requiredCount}）
                </span>
                {coverage.missing.length ? (
                  <Button size="sm" variant="ghost" onClick={() => fillMissing(coverage)}>
                    补全缺失（{coverage.missing.length}）
                  </Button>
                ) : (
                  <Badge tone="ok">已齐备</Badge>
                )}
              </div>
              {coverage.missing.length ? (
                <p className="faint" style={{ fontSize: "var(--fs-2xs)", margin: 0 }}>
                  缺：{coverage.missing.map((m) => m.name).join("、")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="stack" style={{ gap: 10 }}>
          <label className="field">
            <span>发言策略</span>
            <div className="speak-policy-pick">
              {SPEAK_OPTIONS.map((o) => (
                <label key={o.value} className={speakPolicy === o.value ? "active" : ""}>
                  <input
                    type="radio"
                    name="speak"
                    value={o.value}
                    checked={speakPolicy === o.value}
                    onChange={() => setSpeakPolicy(o.value)}
                  />
                  <strong>{o.label}</strong>
                  <small>{o.hint}</small>
                </label>
              ))}
            </div>
          </label>
          <label className="field">
            <span>群规（Markdown）</span>
            <textarea
              className="input"
              rows={4}
              value={rulesMd}
              onChange={(e) => setRulesMd(e.target.value)}
              placeholder="讨论顺序、证据要求、收口方式…"
            />
          </label>
          <label className="field">
            <span>真相源记忆路径（可选）</span>
            <input
              className="input"
              value={truthSourcePath}
              onChange={(e) => setTruthSourcePath(e.target.value)}
              placeholder="/memories/user/truth.md"
            />
            <small className="faint">
              指定一个「真相」记忆文件：群成员动手前先读、改动后写回，作为唯一计划/任务状态源。
            </small>
          </label>
          <div>
            <strong style={{ fontSize: "var(--fs-sm)" }}>拓扑预览</strong>
            <TopologyPreview
              preset={preset}
              members={memberIds.map((id) => colleagueById.get(id)).filter(Boolean) as RosterColleague[]}
              chiefName={chiefName}
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function GroupMembers({
  members,
  selected,
  onToggle,
}: {
  members: RosterColleague[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="bots-picker">
      {members.map((c) => {
        const id = colleagueBotId(c);
        return (
          <label key={id} className="bots-picker__item">
            <input type="checkbox" checked={selected.includes(id)} onChange={() => onToggle(id)} />
            <span>
              {c.emoji} {c.displayName || c.name}
            </span>
          </label>
        );
      })}
    </div>
  );
}
