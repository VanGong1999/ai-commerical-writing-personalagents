import { findChiefConversation } from "../agent-chat/chiefConversation";
import { ReferenceComposer } from "../references/ReferenceComposer";
import { REFERENCE_EVENT, mergeReferences, type ContextRef, type ReferenceIntent } from "../references/selection";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import {
  ExternalLink,
  History,
  MessageSquarePlus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  api,
  type ActivityItem,
  type Conversation,
} from "../../api/client";
import { ChatThread } from "../agent-chat/ChatThread";
import { useAgentDirectory } from "../agent-chat/useAgentDirectory";
import { useAgentSession } from "../agent-chat/useAgentSession";

const SUGGESTIONS = [
  "搜索换元法",
  "生成核心梗",
  "帮我规划漫剧创作并开始选梗",
  "列出我的项目",
  "打开知识库",
];

const ACTION_LABEL: Record<string, string> = {
  chat: "对话",
  kb_search: "知识检索",
  run_agent: "开始 AI 写作",
  schedule_task: "定时任务",
  crawl: "爬虫",
  navigate: "导航",
  artifact_edit: "编辑稿件",
  artifact_create: "新建稿件",
  adopt: "采纳",
  rollback: "版本回滚",
  project_update: "项目更新",
  create_fleet: "多智能体编排",
  subagent_spawn: "子智能体",
};

function currentProjectId(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  return params.get("projectId") || undefined;
}

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [tab, setTab] = useState("chat");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [contextRefs, setContextRefs] = useState<ContextRef[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [contextLine, setContextLine] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const session = useAgentSession(conversation?.id);
  const { resolve } = useAgentDirectory();

  useEffect(() => {
    const receive = (event: Event) => {
      const intent = (event as CustomEvent<ReferenceIntent>).detail;
      setContextRefs(prev => mergeReferences(prev,intent.refs));
      if (intent.prompt) setInput(intent.prompt);
      setTab("chat");
    };
    window.addEventListener(REFERENCE_EVENT,receive);
    return () => window.removeEventListener(REFERENCE_EVENT,receive);
  }, []);

  useEffect(() => {
    if (!open) return;
    void api
      .assistantContext()
      .then((ctx) => {
        const n = ctx.projects?.length ?? 0;
        setContextLine(
          n
            ? `${n} 个项目 · ${ctx.scheduledTasks?.length ?? 0} 个定时任务 · ${ctx.crawlerSources?.length ?? 0} 个数据源`
            : "连接后即可代操作应用",
        );
      })
      .catch(() => setContextLine("后端未连接，请检查服务状态"));
    void refreshActivity();
    void ensureConversation();
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, tab, session.runningJobs]);

  const refreshActivity = async () => {
    try {
      setActivity(await api.listActivity(undefined, 40));
    } catch {
      setActivity([]);
    }
  };

  const refreshHistory = async () => {
    try {
      setHistory(await api.listConversations());
    } catch {
      setHistory([]);
    }
  };

  const ensureConversation = async () => {
    if (conversation) return conversation;
    try {
      const list = await api.listConversations({ source: "assistant" });
      const conv = findChiefConversation(list) ?? (await api.createConversation({ title: "助手对话" }));
      setConversation(conv);
      return conv;
    } catch {
      return null;
    }
  };

  const newConversation = async () => {
    try {
      const conv = await api.createConversation({ title: "新对话" });
      setConversation(conv);
      setHistoryOpen(false);
      void refreshHistory();
    } catch (e) {
      toast.fail(`新建失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const selectConversation = (c: Conversation) => {
    setConversation(c);
    setHistoryOpen(false);
  };

  const openInNewWindow = () => {
    if (!conversation) return;
    window.open(`/agent?c=${encodeURIComponent(conversation.id)}`, "_blank", "noopener,noreferrer");
  };

  const send = async (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || session.busy) return;
    const conv = conversation ?? (await ensureConversation());
    if (!conv) {
      toast.fail("后端未连接");
      return;
    }
    setConversation(conv);
    setInput("");
    const sentRefs = contextRefs;
    setContextRefs([]);
    try {
      await session.send(value, sentRefs[0]?.projectId || currentProjectId(), conv.id, {contextRefs:sentRefs});
      void refreshActivity();
      void refreshHistory();
    } catch {
      setInput(prev => prev || value);
      setContextRefs(prev => mergeReferences(prev,sentRefs));
      toast.fail("AI 助手请求失败，引用已保留");
    }
  };

  const respond = async (approve: boolean) => {
    try {
      await session.respond(approve);
      void refreshActivity();
      toast.info(approve ? "已批准" : "已拒绝");
    } catch (e) {
      toast.fail(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      {open ? (
        <div className="assistant-overlay" onClick={onClose} aria-hidden />
      ) : null}
      <aside className="assistant" data-open={open} aria-hidden={!open}>
        <div className="assistant__head">
          <div className="assistant__title">
            <span className="assistant__logo">
              <Sparkles size={15} />
            </span>
            <div>
              <strong>{resolve(conversation?.botId).name}</strong>
              <span>{contextLine || "自然语言指挥：检索 / 写作 / 编排 / 定时 / 爬虫"}</span>
            </div>
          </div>
          <div className="assistant__history">
            <Button
              variant="ghost"
              size="sm"
              aria-label="历史会话"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              <History size={15} />
            </Button>
            {historyOpen ? (
              <div className="assistant__history-menu">
                {history.length === 0 ? (
                  <div className="empty" style={{ padding: 8 }}>
                    暂无历史
                  </div>
                ) : (
                  history.slice(0, 30).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={c.id === conversation?.id ? "active" : ""}
                      onClick={() => selectConversation(c)}
                    >
                      <span>{c.title}</span>
                      <small>
                        {c.source} · {new Date(c.updatedAt).toLocaleString("zh-CN")}
                      </small>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" aria-label="新窗口打开" onClick={openInNewWindow}>
            <ExternalLink size={15} />
          </Button>
          <Button variant="ghost" size="sm" aria-label="新建对话" onClick={() => void newConversation()}>
            <MessageSquarePlus size={15} />
          </Button>
          <Button variant="ghost" size="sm" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <div className="assistant__tabs">
          <Tabs
            tabs={[
              { id: "chat", label: "对话" },
              { id: "trace", label: "运行痕迹" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === "chat" ? (
          <>
            <div className="assistant__messages">
              <ChatThread
                messages={session.messages}
                steps={session.steps}
                plan={session.plan}
                runningJobs={session.runningJobs}
                pendingConfirm={session.pendingConfirm}
                busy={session.busy}
                onRespond={(a) => void respond(a)}
                emptyHint={
                  <p>
                    我是总编（Personal Agent）。你可以：查知识库、生成核心梗、按流程创作、
                    编排多个智能体、设置定时任务。写正文 / 采纳 / 批量生成前会先征求你的确认。
                    <a
                      href="/agent"
                      onClick={(e) => {
                        e.preventDefault();
                        void nav({ to: "/agent" });
                        onClose();
                      }}
                    >
                      打开全屏工作台
                    </a>
                  </p>
                }
              />
              <div ref={bottomRef} />
            </div>

            <div className="assistant__suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>

            <ReferenceComposer refs={contextRefs} onChange={setContextRefs} projectId={currentProjectId()} />
            <div className="assistant__input">
              <textarea
                rows={2}
                value={input}
                placeholder={
                  session.busy ? "任务进行中，可继续追加指令…" : "例如：帮我规划漫剧创作并开始选梗"
                }
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button
                variant="primary"
                disabled={!input.trim()}
                onClick={() => void send()}
                aria-label="发送"
              >
                <Send size={15} />
              </Button>
            </div>
          </>
        ) : (
          <div className="assistant__trace">
            <div className="assistant__trace-head">
              <span>最近的操作都记录在这里，可追溯谁做了什么。</span>
              <Button size="sm" variant="ghost" onClick={() => void refreshActivity()}>
                刷新
              </Button>
            </div>
            {activity.length === 0 ? (
              <div className="empty">暂无运行痕迹。发起一次对话或操作后，这里会出现记录。</div>
            ) : (
              <ol className="assistant__trace-list">
                {activity.map((a) => (
                  <li key={a.id}>
                    <Badge tone={a.action.includes("rollback") ? "warn" : "default"}>
                      {ACTION_LABEL[a.action] ?? a.action}
                    </Badge>
                    <div>
                      <span>{a.summary}</span>
                      <small>
                        {a.actor === "assistant" ? "总编" : a.actor} ·{" "}
                        {new Date(a.createdAt).toLocaleString("zh-CN")}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
