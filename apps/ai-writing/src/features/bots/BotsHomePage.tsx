import { ReferenceComposer } from "../references/ReferenceComposer";
import { mergeReferences, type ContextRef } from "../references/selection";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Badge, Button, HelpCallout, HelpIcon, HelpTip, toast } from "@xiezuomanju/ui";
import type { ProjectFormat } from "@xiezuomanju/domain";
import {
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Plus,
  Radio,
  Send,
  Timer,
  Users,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  formatLabel,
  type Bot,
  type BotSkill,
  type BotTeam,
  type Conversation,
  type RosterColleague,
  type RosterTeamGroup,
  type SquadPreset,
} from "../../api/client";
import { EmptyState } from "../../components/motion";
import { ChatThread } from "../agent-chat/ChatThread";
import { useAgentSession } from "../agent-chat/useAgentSession";
import { ColleaguePage } from "../colleague/ColleaguePage";
import { BotDetailPanel } from "./BotDetailPanel";
import { ColleagueCard } from "./ColleagueCard";
import { ColleagueTour } from "./ColleagueTour";
import { CreateBotDialog } from "./CreateBotDialog";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { TemplateMarketPanel } from "./TemplateMarketPanel";
import { RoutinesPage } from "./RoutinesPage";
import { colleagueBotId, flattenRoster, rosterColleagueToBot } from "./rosterBot";
import { resolveTeamConversation, selectTeamConversation } from "./teamConversation";

type HomeTab = "chat" | "squads" | "fleet" | "routines" | "advanced";
type Selection =
  | { type: "bot"; bot: Bot; colleague?: RosterColleague; conversation: Conversation | null }
  | { type: "team"; team: BotTeam; conversation: Conversation | null }
  | null;

const FORMATS: Array<ProjectFormat | ""> = [
  "",
  "manju",
  "duanju",
  "short_novel",
  "male_long",
  "female_long",
  "ip_adapt",
];

function parseMentions(text: string, bots: Bot[]): string[] {
  const ids: string[] = [];
  for (const b of bots) {
    const names = [b.name, ...(b.aliases || [])];
    for (const n of names) {
      if (!n) continue;
      if (text.includes(`@${n}`) || text.includes(`@${b.id}`)) {
        ids.push(b.id);
        break;
      }
    }
  }
  return [...new Set(ids)];
}

export function BotsHomePage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<HomeTab>("chat");
  const [selection, setSelection] = useState<Selection>(null);
  const [input, setInput] = useState("");
  const [contextRefs, setContextRefs] = useState<ContextRef[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createBotOpen, setCreateBotOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupSeedIds, setGroupSeedIds] = useState<string[] | undefined>();
  const [groupSeedPreset, setGroupSeedPreset] = useState<SquadPreset | undefined>();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [forceContinue, setForceContinue] = useState(false);
  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState<ProjectFormat | "">("");
  const [multiSelect, setMultiSelect] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [collapsedTeams, setCollapsedTeams] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [projectId,setProjectId]=useState(new URLSearchParams(window.location.search).get("projectId") || "");
  const projectsQ=useQuery({queryKey:["projects"],queryFn:()=>api.listProjects()});
  const rosterQ = useQuery({
    queryKey: ["bot-roster", formatFilter || "all",projectId],
    queryFn: () => api.getBotRoster({format:formatFilter || undefined,projectId}),
  });
  const teamsQ = useQuery({
    queryKey: ["bot-teams"],
    queryFn: () => api.listBotTeams(),
  });
  const conversationsQ = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.listConversations(),
  });

  const roster = rosterQ.data;
  const teams = teamsQ.data || [];
  const conversations = conversationsQ.data || [];

  const allColleagues = useMemo(
    () => (roster ? flattenRoster(roster) : []),
    [roster],
  );
  const mentionBots = useMemo(() => allColleagues.map(rosterColleagueToBot), [allColleagues]);

  const activeBotId =
    selection?.type === "bot"
      ? selection.bot.id
      : selection?.type === "team"
        ? selection.team.leadBotId || selection.team.memberBotIds[0]
        : null;

  const skillsQ = useQuery({
    queryKey: ["bot-skills", activeBotId],
    queryFn: () => api.listBotSkills(activeBotId!),
    enabled: Boolean(activeBotId) && skillOpen && !allColleagues.some((c) => c.isVirtual && c.agentId === activeBotId),
  });

  const conversationId = selection?.conversation?.id ?? null;
  const session = useAgentSession(conversationId);

  const botDirectory = useMemo(() => {
    const map: Record<string, { name: string; emoji?: string; color?: string }> = {};
    for (const c of allColleagues) {
      const id = colleagueBotId(c);
      map[id] = {
        name: c.displayName || c.name,
        emoji: c.emoji,
        color: c.teamColor,
      };
    }
    return map;
  }, [allColleagues]);

  const findBotConversation = (botId: string,targetProject:string) =>
    conversations.find(
      (c) =>
        (c.kind === "dm" || c.kind === "bot_dm" || !c.kind) &&
        (c.projectId || "") === targetProject && c.source === "assistant" && c.botId === botId,
    ) || null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, session.runningJobs]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const chatRequest = useRef(0);
  const ensureBotChat = async (colleague: RosterColleague) => {
    const request = ++chatRequest.current;
    try {
      const bot = !colleague.isVirtual && colleague.agentId ? await api.getBot(colleague.agentId) : rosterColleagueToBot(colleague);
      const botId = bot.id;
      const target = projectId || colleague.projectId || "";
      if (request !== chatRequest.current) return;
      if (!target && bot.execution?.enabled) { toast.info("请先选择会话项目"); return; }
      if (target !== projectId) setProjectId(target);
      let conv = findBotConversation(botId,target);
      if (!conv) {
        conv = await api.createConversation({
          title: `与${bot.name}`,
          kind: "dm", projectId:target || undefined,
          botId,
        });
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      }
      if (request === chatRequest.current && (conv.projectId || "") === target) {
        setSelection({ type: "bot", bot, colleague, conversation: conv });
        setTab("chat");
      }
    } catch (error) {
      if (request === chatRequest.current) toast.fail(error instanceof Error ? error.message : String(error));
    }
  };

  const openedLink = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("botId") || params.get("bot");
    if (!requested || openedLink.current === requested) return;
    const colleague = allColleagues.find((item) =>
      colleagueBotId(item) === requested || (item.agentId && requested === `agent:${item.agentId}`),
    );
    if (colleague) {
      openedLink.current = requested;
      void ensureBotChat(colleague);
    }
  }, [allColleagues]);

  const ensureTeamChat = async (team: BotTeam, created?: Conversation, generationAtCreation?: number) => {
    try {
      await selectTeamConversation(chatRequest, projectId,
        () => resolveTeamConversation(qc, api, team, created, projectId),
        conversation => {
          setSelection({ type: "team", team, conversation });
          setTab("chat");
        }, generationAtCreation);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : String(e));
    }
  };

  const openEgg = async () => {
    if (!roster?.eggbot) {
      toast.fail("花名册未加载，请稍后重试");
      return;
    }
    await ensureBotChat(roster.eggbot);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !selection?.conversation || (selection.conversation.projectId || "") !== projectId) return;
    const mentionBotIds = parseMentions(text, mentionBots);
    setInput("");
    setMentionOpen(false);
    setSkillOpen(false);
    const sentRefs = contextRefs;
    setContextRefs([]);
    try {
      await session.send(text, selection.conversation.projectId || undefined, selection.conversation.id, {
        mentionBotIds,
        contextRefs:sentRefs,
        forceContinue,
        botId: selection.type === "bot" ? selection.bot.id : undefined,
      });
      setForceContinue(false);
      void conversationsQ.refetch();
    } catch {
      setInput(prev => prev || text);
      setContextRefs(prev => mergeReferences(prev,sentRefs));
      toast.fail("发送失败，引用已保留");
    }
  };

  const respond = async (approve: boolean, editedArgs?: Record<string, unknown>) => {
    try {
      await session.respond(approve, editedArgs);
      toast.info(approve ? "已批准" : "已拒绝");
    } catch (e) {
      toast.fail(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onInputChange = (value: string) => {
    setInput(value);
    const at = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (at) {
      setMentionOpen(true);
      setMentionQuery(at[1] || "");
      setSkillOpen(false);
      return;
    }
    const slash = value.match(/(?:^|\s)\/([^\s/]*)$/);
    if (slash) {
      setSkillOpen(true);
      setSkillQuery(slash[1] || "");
      setMentionOpen(false);
      return;
    }
    setMentionOpen(false);
    setSkillOpen(false);
  };

  const insertMention = (bot: Bot) => {
    setInput((prev) => prev.replace(/(?:^|\s)@[^\s@]*$/, (m) => `${m.startsWith(" ") ? " " : ""}@${bot.name} `));
    setMentionOpen(false);
  };

  const insertSkill = (skill: BotSkill) => {
    setInput((prev) =>
      prev.replace(/(?:^|\s)\/[^\s/]*$/, (m) => `${m.startsWith(" ") ? " " : ""}/${skill.slash} `),
    );
    setSkillOpen(false);
  };

  const filteredGroups = useMemo(() => {
    if (!roster) return [] as RosterTeamGroup[];
    const q = search.trim().toLowerCase();
    const match = (c: RosterColleague) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.displayName || "").toLowerCase().includes(q) ||
      c.team.toLowerCase().includes(q) ||
      (c.aliases || []).some((a) => a.toLowerCase().includes(q));
    return roster.teams
      .map((g) => ({
        ...g,
        members: g.members.filter(match),
      }))
      .filter((g) => g.members.length > 0);
  }, [roster, search]);

  const mentionCandidates = useMemo(() => {
    const mq = mentionQuery.trim().toLowerCase();
    return mentionBots.filter(
      (b) =>
        !mq ||
        b.name.toLowerCase().includes(mq) ||
        b.id.toLowerCase().includes(mq) ||
        (b.aliases || []).some((a) => a.toLowerCase().includes(mq)),
    );
  }, [mentionBots, mentionQuery]);

  const skillCandidates = useMemo(() => {
    const sq = skillQuery.trim().toLowerCase();
    return (skillsQ.data || []).filter(
      (s) => !sq || s.slash.toLowerCase().includes(sq) || s.name.toLowerCase().includes(sq),
    );
  }, [skillsQ.data, skillQuery]);

  const headerTitle =
    selection?.type === "bot"
      ? selection.bot.name
      : selection?.type === "team"
        ? selection.team.name
        : "AI 同事";

  const restateOn = selection?.type === "bot" ? selection.bot.restateBeforeAct : false;

  const togglePick = (id: string) => {
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openGroupWizard = (preset?: SquadPreset) => {
    chatRequest.current++;
    setGroupSeedIds(preset ? undefined : pickedIds);
    setGroupSeedPreset(preset);
    setCreateGroupOpen(true);
  };

  const onApplySquad = (preset: SquadPreset) => {
    setTab("chat");
    openGroupWizard(preset);
  };

  const renderColleagueRow = (c: RosterColleague, pinned = false) => {
    const id = colleagueBotId(c);
    const active = selection?.type === "bot" && selection.bot.id === id;
  const checked = pickedIds.includes(id);
    const btn = (
      <button
        type="button"
        className={`${active ? "active" : ""}${multiSelect && checked ? " bots-home__list-item--picked" : ""}`}
        onClick={() => {
          if (multiSelect) {
            togglePick(id);
            return;
          }
          void ensureBotChat(c);
        }}
      >
        {multiSelect ? (
          <input
            type="checkbox"
            readOnly
            checked={checked}
            style={{ pointerEvents: "none" }}
          />
        ) : null}
        <span className="bots-home__avatar" style={{ background: c.teamColor }}>
          {c.emoji}
        </span>
        <span>
          <span className="bots-home__conv-title">{c.displayName || c.name}</span>
          <small>{c.team}</small>
        </span>
      </button>
    );
    return (
      <li key={id} className={pinned ? "bots-home__list-item--pinned" : undefined}>
        <HelpTip label={<ColleagueCard colleague={c} />} side="right">
          {btn}
        </HelpTip>
      </li>
    );
  };

  return (
    <div className="bots-home" data-tab={tab}>
      <ColleagueTour />
      <div className="bots-home__views">
        <button type="button" className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
          <Users size={14} /> 同事聊天
        </button>
        <button
          type="button"
          className={tab === "squads" ? "active" : ""}
          onClick={() => setTab("squads")}
        >
          <Wand2 size={14} /> 编组预设
        </button>
        <button
          type="button"
          className={tab === "fleet" ? "active" : ""}
          onClick={() => setTab("fleet")}
        >
          <Radio size={14} /> 舰队/提议
        </button>
        <button
          type="button"
          className={tab === "routines" ? "active" : ""}
          onClick={() => setTab("routines")}
        >
          <Timer size={14} /> 例程
        </button>
        <button
          type="button"
          className={tab === "advanced" ? "active" : ""}
          onClick={() => setTab("advanced")}
        >
          <MessageSquarePlus size={14} /> 高级
        </button>
      </div>

      {tab === "squads" ? (
        <div className="bots-home__full">
          <TemplateMarketPanel variant="squads" onApplySquad={onApplySquad} />
        </div>
      ) : null}

      {tab === "fleet" ? (
        <div className="bots-home__full bots-home__full--scroll">
          <ColleaguePage embedded />
        </div>
      ) : null}

      {tab === "routines" ? (
        <div className="bots-home__full bots-home__full--scroll">
          <RoutinesPage embedded colleagues={allColleagues} />
        </div>
      ) : null}

      {tab === "advanced" ? (
        <div className="bots-home__full bots-home__full--scroll stack" style={{ gap: 16 }}>
          <PanelAdvanced
            onOpenEgg={() => void openEgg()}
            onCreateBot={() => setCreateBotOpen(true)}
            onImported={(res) => {
              if (res.kind === "bot") {
                const match = allColleagues.find((c) => colleagueBotId(c) === res.bot.id);
                if (match) void ensureBotChat(match);
              } else void ensureTeamChat(res.team);
            }}
          />
        </div>
      ) : null}

      {tab === "chat" ? (
        <>
          <aside className="bots-home__rail">
            <HelpCallout title="与同事协作" tone="info" collapsible defaultOpen={false}>
              左侧是专职同事花名册（共 {allColleagues.length} 位）：悬停可看职责卡，点击进入私聊；多选后可编成小组。群聊里用 @ 点名、/
              技能，流水线编组会按阶段生成交接卡片。
            </HelpCallout>
            <label>会话项目 <select value={projectId} onChange={e=>{chatRequest.current++;setCreateGroupOpen(false);setProjectId(e.target.value);setSelection(null);setContextRefs([]);setInput("");setPickedIds([]);}}>
              <option value="">通用会话</option>{projectsQ.data?.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
            </select></label>
            <div className="bots-home__rail-head">
              <strong>
                同事花名册
                {roster ? (
                  <span className="faint" style={{ fontWeight: 400, marginLeft: 6 }}>
                    {roster.stats.domainAgents}
                  </span>
                ) : null}
              </strong>
              <div className="row" style={{ gap: 2 }} ref={menuRef} data-tour="group-wizard">
                <Button
                  size="sm"
                  variant={multiSelect ? "primary" : "ghost"}
                  onClick={() => {
                    setMultiSelect((v) => !v);
                    if (multiSelect) setPickedIds([]);
                  }}
                >
                  多选
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="新建"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <Plus size={15} />
                </Button>
                {menuOpen ? (
                  <div className="bots-home__menu">
                    <button type="button" onClick={() => { setMenuOpen(false); openGroupWizard(); }}>
                      编成小组
                    </button>
                    <button type="button" onClick={() => { setMenuOpen(false); setTab("squads"); }}>
                      编组预设
                    </button>
                    <button type="button" onClick={() => { setMenuOpen(false); void openEgg(); }}>
                      打开蛋博士
                    </button>
                    <button type="button" onClick={() => { setMenuOpen(false); void nav({ to: "/routines" }); }}>
                      查看例程
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {multiSelect && pickedIds.length >= 2 ? (
              <div className="bots-home__multi-bar">
                <span>已选 {pickedIds.length} 人</span>
                <Button size="sm" variant="primary" onClick={() => openGroupWizard()}>
                  编成小组
                </Button>
              </div>
            ) : null}

            <div className="bots-home__filters">
              <input
                className="input"
                placeholder="搜索同事…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="select"
                value={formatFilter}
                onChange={(e) => setFormatFilter((e.target.value || "") as ProjectFormat | "")}
              >
                {FORMATS.map((f) => (
                  <option key={f || "all"} value={f}>
                    {f ? formatLabel(f) : "全部体裁"}
                  </option>
                ))}
              </select>
            </div>

            {roster?.chief ? (
              <>
                <div className="bots-home__section-label" data-tour="chief">
                  总编（置顶）
                </div>
                <ul className="bots-home__list">{renderColleagueRow(roster.chief, true)}</ul>
              </>
            ) : null}

            <div className="bots-home__section-label" data-tour="roster-groups">
              职能分组
            </div>
            <ul className="bots-home__list bots-home__list--groups">
              {filteredGroups.map((g) => {
                const collapsed = collapsedTeams[g.team] ?? false;
                return (
                  <li key={g.team} className="bots-home__group">
                    <button
                      type="button"
                      className="bots-home__group-head"
                      onClick={() =>
                        setCollapsedTeams((prev) => ({ ...prev, [g.team]: !collapsed }))
                      }
                    >
                      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      <span className="bots-home__avatar" style={{ background: g.teamColor }}>
                        {g.emoji}
                      </span>
                      <span>
                        {g.team}
                        <small>{g.count}</small>
                      </span>
                    </button>
                    {!collapsed ? (
                      <ul className="bots-home__list bots-home__list--nested">
                        {g.members.map((c) => renderColleagueRow(c))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
              {!filteredGroups.length && !rosterQ.isLoading && (
                <li className="empty">无匹配同事</li>
              )}
            </ul>

            <div className="bots-home__section-label">我的编组</div>
            <ul className="bots-home__list">
              {teams.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={
                      selection?.type === "team" && selection.team.id === t.id ? "active" : ""
                    }
                    onClick={() => void ensureTeamChat(t)}
                  >
                    <span className="bots-home__avatar">群</span>
                    <span>
                      <span className="bots-home__conv-title">{t.name}</span>
                      <small>{t.memberBotIds.length} 位成员</small>
                    </span>
                  </button>
                </li>
              ))}
              {!teams.length && <li className="empty">暂无编组</li>}
            </ul>
          </aside>

          <section className="bots-home__main">
            {selection?.conversation ? (
              <>
                <div className="bots-home__head">
                  <h2>{headerTitle}</h2>
                  <div className="row" style={{ gap: 6 }}>
                    {selection.type === "bot" ? (
                      <Badge>{selection.bot.roleKind}</Badge>
                    ) : (
                      <Badge>群组</Badge>
                    )}
                    {restateOn ? <Badge tone="warn">复述后再动手</Badge> : null}
                    {forceContinue ? (
                      <Badge tone="ok">
                        追问中
                        <HelpIcon text="开启后，任务进行中发送的消息会强制追加给当前同事，用于纠偏或补充约束。" />
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="bots-home__messages">
                  <ChatThread
                    messages={session.messages}
                    steps={session.steps}
                    plan={session.plan}
                    runningJobs={session.runningJobs}
                    pendingConfirm={session.pendingConfirm}
                    busy={session.busy}
                    botDirectory={botDirectory}
                    onRespond={(a, edited) => void respond(a, edited)}
                    onSteer={(runId, msg) =>
                      void session.steer(runId, msg).then(() => toast.info("已追加指令"))
                    }
                    onStop={(jobId) =>
                      void session.stopJob(jobId).then(() => toast.info("已请求停止"))
                    }
                    emptyHint={
                      <p>
                        与「{headerTitle}」对话。可用 @ 点名、/ 调用技能；任务进行中可点「追问」强制继续。
                      </p>
                    }
                  />
                  <div ref={bottomRef} />
                </div>
                <ReferenceComposer refs={contextRefs} onChange={setContextRefs} />
                <div className="bots-home__input" data-tour="composer">
                  {(mentionOpen || skillOpen) && (
                    <div className="bots-home__suggest">
                      {mentionOpen
                        ? mentionCandidates.slice(0, 8).map((b) => (
                            <button key={b.id} type="button" onClick={() => insertMention(b)}>
                              @{b.name}
                            </button>
                          ))
                        : skillCandidates.slice(0, 8).map((s) => (
                            <button key={s.id} type="button" onClick={() => insertSkill(s)}>
                              /{s.slash}
                              <small>{s.name}</small>
                            </button>
                          ))}
                      {mentionOpen && !mentionCandidates.length ? (
                        <div className="faint" style={{ padding: 8 }}>
                          无匹配同事
                        </div>
                      ) : null}
                      {skillOpen && !skillCandidates.length ? (
                        <div className="faint" style={{ padding: 8 }}>
                          无匹配技能
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div className="bots-home__input-toolbar">
                    <Button
                      size="sm"
                      variant={forceContinue ? "primary" : "ghost"}
                      onClick={() => setForceContinue((v) => !v)}
                      title="任务进行中强制追问 / 继续"
                    >
                      追问
                      <HelpIcon text="任务卡住或想改方向时开启；下一条消息会作为强制继续指令。" />
                    </Button>
                    {restateOn ? (
                      <Badge tone="warn">将先复述计划</Badge>
                    ) : (
                      <span className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
                        @ 点名 · / 技能
                      </span>
                    )}
                  </div>
                  <div className="bots-home__composer">
                    <textarea
                      rows={2}
                      value={input}
                      placeholder="给同事发消息… 用 @ 点名、/ 技能"
                      onChange={(e) => onInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <Button variant="primary" disabled={!input.trim()} onClick={() => void send()}>
                      <Send size={15} />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<Users size={26} />}
                title="选择一位同事开始聊天"
                description="左侧花名册点选同事或编组；总编默认牵头，也可多选后编成小组。"
                action={
                  roster?.chief.examplePrompts?.length ? (
                    <div className="bots-home__examples">
                      {roster.chief.examplePrompts.slice(0, 4).map((p) => (
                        <Button
                          key={p}
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void ensureBotChat(roster.chief).then(() => setInput(p));
                          }}
                        >
                          {p.length > 36 ? `${p.slice(0, 36)}…` : p}
                        </Button>
                      ))}
                    </div>
                  ) : undefined
                }
              />
            )}
          </section>

          <BotDetailPanel projectId={selection?.conversation?.projectId || undefined}
            bot={selection?.type === "bot" ? selection.bot : null}
            onUpdated={(b) => {
              if (selection?.type === "bot") {
                setSelection({ ...selection, bot: b });
              }
            }}
          />
        </>
      ) : null}

      <CreateBotDialog
        open={createBotOpen}
        onOpenChange={setCreateBotOpen}
        onCreated={(bot) => {
          void qc.invalidateQueries({queryKey:["bot-roster"]});
          void qc.invalidateQueries({ queryKey: ["bots"] });
          const c = allColleagues.find((x) => colleagueBotId(x) === bot.id);
          if (c) void ensureBotChat(c);
        }}
      />
      <CreateGroupDialog projectId={projectId} getSelectionGeneration={() => chatRequest.current}
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        initialMemberIds={groupSeedIds}
        initialPreset={groupSeedPreset}
        onCreated={ensureTeamChat}
      />
    </div>
  );
}

function PanelAdvanced({
  onOpenEgg,
  onCreateBot,
  onImported,
}: {
  onOpenEgg: () => void;
  onCreateBot: () => void;
  onImported: (res: { kind: "bot"; bot: Bot } | { kind: "team"; team: BotTeam }) => void;
}) {
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" onClick={onOpenEgg}>
          打开蛋博士
        </Button>
        <Button onClick={onCreateBot}>新建自定义同事</Button>
      </div>
      <TemplateMarketPanel variant="templates" onImported={onImported} />
    </>
  );
}
