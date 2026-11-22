import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  ConfirmDialog,
  HelpIcon,
  Panel,
  ProgressBar,
  toast,
} from "@xiezuomanju/ui";
import {
  Archive,
  Database,
  Download,
  FolderKanban,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

type ContentGroup = "creative" | "preference" | "settings" | "other";

type StoredContent = {
  key: string;
  label: string;
  detail: string;
  group: ContentGroup;
  bytes: number;
  projectTitle?: string;
  keyHint: string;
};

type StorageUsage = {
  usage: number;
  quota: number;
};

const GROUPS: Array<{ id: "all" | ContentGroup; label: string; hint: string }> = [
  { id: "all", label: "全部内容", hint: "显示当前浏览器保存的所有写作台内容" },
  { id: "creative", label: "创作草稿", hint: "项目内尚未整理成正式稿的步骤、设定和资料" },
  { id: "preference", label: "写作偏好", hint: "自定义写作指令和创作模式" },
  { id: "settings", label: "界面设置", hint: "笔名、主题、侧边栏和面板状态" },
  { id: "other", label: "其他内容", hint: "今日目标及其他本地记录" },
];

const FIXED_LABELS: Record<string, { label: string; detail: string; group: ContentGroup }> = {
  "xmj-settings": {
    label: "个人资料与界面偏好",
    detail: "笔名、主攻频向和界面密度",
    group: "settings",
  },
  "xmj-theme": { label: "深浅主题", detail: "当前使用的界面主题", group: "settings" },
  "xmj-nav-compact-pref": {
    label: "侧边栏显示方式",
    detail: "记住侧边栏是展开还是收起",
    group: "settings",
  },
  "xmj-studio-onboarded-v1": {
    label: "创作台新手引导",
    detail: "是否已经看过创作台使用提示",
    group: "settings",
  },
  "today-goals": { label: "今日目标", detail: "首页今日要完成的事项", group: "other" },
};

const PREFIX_LABELS: Array<{
  prefix: string;
  label: string;
  detail: string;
  group: ContentGroup;
}> = [
  { prefix: "xmj-collapse:", label: "面板展开状态", detail: "记住各功能面板是否展开", group: "settings" },
  { prefix: "prompt-edit:", label: "自定义写作指令", detail: "你修改过的写作要求", group: "preference" },
  { prefix: "creation-mode:", label: "创作模式偏好", detail: "按题材记住的创作模式", group: "preference" },
  { prefix: "deep:", label: "创作步骤草稿", detail: "创作台中的方法步骤与编辑内容", group: "creative" },
  { prefix: "deep-", label: "深度方法草稿", detail: "创作台中的方法表单", group: "creative" },
  { prefix: "deliverable-", label: "交稿资料草稿", detail: "人物、分镜、正文等交稿资料", group: "creative" },
  { prefix: "nines2-", label: "九格拆书草稿", detail: "拆书、选题和钩子练习", group: "creative" },
  { prefix: "nines3-", label: "九格构思草稿", detail: "题材、节奏、人物和质检设计", group: "creative" },
  { prefix: "nines4-", label: "九格结构草稿", detail: "结构、人物弧和修订记录", group: "creative" },
  { prefix: "qc-", label: "质量检查草稿", detail: "去 AI 味、检查结果和修订记录", group: "creative" },
  { prefix: "setup:", label: "项目初始设定", detail: "项目建立时的核心设定", group: "creative" },
  { prefix: "synopsis-parts:", label: "故事梗概四要素", detail: "角色、目标、阻碍和转折", group: "creative" },
  { prefix: "synopsis:", label: "一句话梗概", detail: "项目的一句话故事介绍", group: "creative" },
  { prefix: "stage-completed:", label: "创作阶段记录", detail: "已经完成的创作步骤", group: "creative" },
  { prefix: "logline100:", label: "100 字故事测试", detail: "用于检查故事抓力的短梗概", group: "creative" },
  { prefix: "char-graph:", label: "人物关系图", detail: "人物关系草稿", group: "creative" },
  { prefix: "fmt:", label: "题材专项表单", detail: "长篇等题材的专项创作资料", group: "creative" },
  { prefix: "word-target:", label: "字数目标", detail: "项目准备写多少字", group: "creative" },
  { prefix: "er-plat-", label: "平台收稿提示", detail: "与平台偏好有关的记录", group: "creative" },
];

const MANAGED_KEY_PREFIXES = [
  "xmj-",
  "prompt-edit:",
  "creation-mode:",
  "deep:",
  "deep-",
  "deliverable-",
  "nines2-",
  "nines3-",
  "nines4-",
  "qc-",
  "setup:",
  "synopsis-parts:",
  "synopsis:",
  "stage-completed:",
  "logline100:",
  "char-graph:",
  "fmt:",
  "word-target:",
  "er-plat-",
] as const;

function isManagedKey(key: string) {
  return (
    key === "today-goals" ||
    MANAGED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

const DEEP_STEP_LABELS: Record<string, string> = {
  "master-outline": "主大纲与细纲",
  "manju-pipeline-wf": "漫剧创作流程",
  "ip-adapt-wf": "IP 改编流程",
  "chase-wife": "追妻故事设计",
  "pitch": "商业提案",
  "pitch-spec": "商业提案规格",
  "pitch-ip-rights": "IP 改编提案",
  "foresight": "伏笔设计",
  "foreshadow": "伏笔设计",
  "character-files": "人物档案",
  "character-depth-wf": "人物深度流程",
  "manuscript": "正文草稿",
  "beat-map": "节拍地图",
  "workflow-checkpoints": "流程检查点",
  "inspiration-to-story-wf": "从灵感到故事流程",
  "topic-selection-wf": "选题流程",
  "expect-conflict-l4": "预期冲突练习",
  "duanju-charlie-ops": "短剧查理工具表单",
  "core-hook-full": "完整核心梗",
  "framework": "故事框架",
  "char-seven": "人物七步",
  "dialogue-triple": "台词三层",
  "setting-opening": "开篇设定",
  "setting-gf": "金手指设定",
  "setting-world": "世界观设定",
  "setting-five": "设定五要素",
  "outline-level": "大纲层级",
  "cool12": "十二爽点卡",
  "cool18": "十八爽点卡",
  "qc-gates": "质量门禁",
  "qc-deai": "去 AI 味检查",
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function byteLength(value: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
  return value.length * 2;
}

function extractProjectId(key: string) {
  return key.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  )?.[0];
}

function contentMeta(key: string): { label: string; detail: string; group: ContentGroup } {
  const fixed = FIXED_LABELS[key];
  if (fixed) return fixed;

  const prefixed = PREFIX_LABELS.find((item) => key.startsWith(item.prefix));
  if (!prefixed) {
    return {
      label: "其他本地记录",
      detail: "写作台在当前浏览器中保存的记录",
      group: "other",
    };
  }

  if (prefixed.prefix === "deep:") {
    const tail = key.split(":").slice(2).join(":");
    const tailRoot = tail.split(":")[0];
    const friendlyTail =
      DEEP_STEP_LABELS[tail] ??
      DEEP_STEP_LABELS[tailRoot] ??
      "自定义创作步骤";
    return {
      label: `${prefixed.label} · ${friendlyTail}`,
      detail: prefixed.detail,
      group: prefixed.group,
    };
  }

  return { label: prefixed.label, detail: prefixed.detail, group: prefixed.group };
}

function summarizeValue(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return `包含 ${parsed.length.toLocaleString()} 条记录`;
    if (parsed && typeof parsed === "object") {
      return `包含 ${Object.keys(parsed).length.toLocaleString()} 个字段`;
    }
    if (typeof parsed === "number") return `数字 · ${parsed.toLocaleString()}`;
    if (typeof parsed === "boolean") return parsed ? "开关已开启" : "开关已关闭";
    if (typeof parsed === "string") {
      const chars = parsed.replace(/\s/g, "").length;
      return `文本 · ${chars.toLocaleString()} 字`;
    }
  } catch {
    const chars = value.replace(/\s/g, "").length;
    return `文本 · ${chars.toLocaleString()} 字`;
  }
  return "本地数据";
}

function readStoredContent(projectTitles: Map<string, string>): StoredContent[] {
  if (typeof window === "undefined") return [];
  const items: StoredContent[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !isManagedKey(key)) continue;
    const value = window.localStorage.getItem(key) ?? "";
    const meta = contentMeta(key);
    const projectId = extractProjectId(key);
    const projectTitle = projectId ? projectTitles.get(projectId) : undefined;
    items.push({
      key,
      label: projectTitle ? `${meta.label} ·《${projectTitle}》` : meta.label,
      detail: `${meta.detail} · ${summarizeValue(value)}`,
      group: meta.group,
      bytes: byteLength(key) + byteLength(value),
      projectTitle,
      keyHint: key,
    });
  }
  return items.sort((a, b) => {
    if (a.group !== b.group) {
      return GROUPS.findIndex((group) => group.id === a.group) -
        GROUPS.findIndex((group) => group.id === b.group);
    }
    return b.bytes - a.bytes;
  });
}

export function LocalContentManager() {
  const nav = useNavigate();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const projectTitles = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );
  const [items, setItems] = useState<StoredContent[]>(() =>
    readStoredContent(projectTitles),
  );
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [filter, setFilter] = useState<(typeof GROUPS)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<{
    keys: string[];
    title: string;
    description: string;
  } | null>(null);

  const refresh = () => {
    setItems(readStoredContent(projectTitles));
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      void navigator.storage
        .estimate()
        .then((estimate) => {
          setUsage({
            usage: estimate.usage ?? 0,
            quota: estimate.quota ?? 0,
          });
        })
        .catch(() => setUsage(null));
    }
  };

  useEffect(() => {
    refresh();
    const onStorage = () => refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // refresh only depends on the current project-title map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTitles]);

  const localBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const query = search.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (filter !== "all" && item.group !== filter) return false;
    if (!query) return true;
    return `${item.label} ${item.detail} ${item.keyHint}`.toLowerCase().includes(query);
  });
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((item) => selected.has(item.key));
  const selectedItems = items.filter((item) => selected.has(item.key));
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.bytes, 0);
  const usagePercent =
    usage?.quota && usage.quota > 0
      ? Math.min(100, Math.max(usage.usage > 0 ? 1 : 0, (usage.usage / usage.quota) * 100))
      : 0;

  const requestDelete = (keys: string[], title: string) => {
    if (!keys.length) return;
    const bytes = items
      .filter((item) => keys.includes(item.key))
      .reduce((sum, item) => sum + item.bytes, 0);
    setPendingDelete({
      keys,
      title,
      description: `将删除写作台的 ${keys.length} 项本地内容，释放约 ${formatBytes(bytes)}。删除后无法在这里恢复；正式项目正文不会受影响。`,
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    pendingDelete.keys.forEach((key) => window.localStorage.removeItem(key));
    setSelected((current) => {
      const next = new Set(current);
      pendingDelete.keys.forEach((key) => next.delete(key));
      return next;
    });
    toast.ok(`已删除 ${pendingDelete.keys.length} 项本地内容`);
    setPendingDelete(null);
    refresh();
  };

  const exportBackup = () => {
    const entries = Object.fromEntries(
      items.map((item) => [item.key, window.localStorage.getItem(item.key)]),
    );
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            note: "写作台浏览器本地内容备份",
            entries,
          },
          null,
          2,
        ),
      ],
      { type: "application/json;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `xiezuomanju-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.ok("本地内容备份已下载");
  };

  return (
    <>
      <Panel
        className="local-storage-panel"
        title={
          <span>
            本地内容与存储
            <HelpIcon text="这里显示写作台保存在当前浏览器里的全部内容。删除只影响这台设备，项目库里的正式项目请在项目管理中归档或删除。" />
          </span>
        }
        actions={
          <Button size="sm" variant="ghost" onClick={exportBackup} disabled={!items.length}>
            <Download size={14} />
            备份
          </Button>
        }
      >
        <div className="local-storage-overview">
          <div className="local-storage-overview__main">
            <span className="local-storage-overview__icon" aria-hidden>
              <Database size={18} />
            </span>
            <div>
              <div className="local-storage-overview__value">约 {formatBytes(localBytes)}</div>
              <div className="local-storage-overview__caption">
                {items.length} 项本地内容
                {usage ? ` · 浏览器已用 ${formatBytes(usage.usage)}` : ""}
              </div>
            </div>
          </div>
          <div className="local-storage-overview__projects">
            <FolderKanban size={15} />
            <span>
              项目库 <strong>{projects.length}</strong> 个正式项目
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void nav({ to: "/projects" })}
            >
              管理项目
            </Button>
          </div>
        </div>
        <div className="local-storage-meter">
          <ProgressBar value={usagePercent} />
          <div>
            <span>
              {usage?.quota
                ? `浏览器分配容量 ${formatBytes(usage.quota)}`
                : "浏览器未提供总容量"}
            </span>
            <span>本地内容只保存在这台设备</span>
          </div>
        </div>
        <div className="local-storage-note">
          <Archive size={15} />
          <span>
            清理后不会删除项目库正文。正式项目请到「项目管理」归档或删除；本地草稿可逐项管理。
          </span>
        </div>

        <div className="local-storage-toolbar">
          <div className="local-storage-filters" role="tablist" aria-label="本地内容分类">
            {GROUPS.map((group) => {
              const count =
                group.id === "all"
                  ? items.length
                  : items.filter((item) => item.group === group.id).length;
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  title={group.hint}
                  aria-selected={filter === group.id}
                  data-active={filter === group.id}
                  onClick={() => setFilter(group.id)}
                >
                  {group.label}
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="local-storage-tools">
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="查找本地内容"
              aria-label="查找本地内容"
            />
            <Button size="sm" variant="ghost" onClick={refresh} title="重新读取本地内容">
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!selectedItems.length}
              onClick={() =>
                requestDelete(
                  selectedItems.map((item) => item.key),
                  "删除所选本地内容",
                )
              }
            >
              <Trash2 size={14} />
              删除所选
            </Button>
          </div>
        </div>

        <div className="local-storage-list" aria-live="polite">
          <div className="local-storage-list__head">
            <label className="local-storage-check">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                disabled={!visibleItems.length}
                onChange={(event) => {
                  setSelected((current) => {
                    const next = new Set(current);
                    visibleItems.forEach((item) => {
                      if (event.target.checked) next.add(item.key);
                      else next.delete(item.key);
                    });
                    return next;
                  });
                }}
                aria-label="选择当前列表中的全部内容"
              />
              <span>内容名称</span>
            </label>
            <span>占用</span>
            <span>操作</span>
          </div>
          {visibleItems.length ? (
            visibleItems.map((item) => (
              <div className="local-storage-row" key={item.key}>
                <label className="local-storage-check">
                  <input
                    type="checkbox"
                    checked={selected.has(item.key)}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.key);
                        else next.delete(item.key);
                        return next;
                      });
                    }}
                    aria-label={`选择${item.label}`}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </label>
                <Badge>{formatBytes(item.bytes)}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  title={`技术标识：${item.keyHint}`}
                  onClick={() => requestDelete([item.key], `删除「${item.label}」`)}
                >
                  <Trash2 size={14} />
                  删除
                </Button>
              </div>
            ))
          ) : (
            <div className="local-storage-empty">
              <Database size={22} />
              <strong>{items.length ? "没有符合条件的内容" : "当前没有本地内容"}</strong>
              <span>
                {items.length
                  ? "换一个分类或搜索词看看。"
                  : "从现在开始产生的草稿和设置会显示在这里。"}
              </span>
            </div>
          )}
        </div>

        <div className="local-storage-footer">
          <span>
            {selectedItems.length
              ? `已选择 ${selectedItems.length} 项 · ${formatBytes(selectedBytes)}`
              : "勾选内容后可批量删除"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!items.length}
            onClick={() =>
              requestDelete(
                items.map((item) => item.key),
                "清空全部本地内容",
              )
            }
          >
            清空全部本地内容
          </Button>
        </div>
      </Panel>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.title ?? "删除本地内容"}
        description={pendingDelete?.description ?? ""}
        confirmLabel="确认删除"
        danger
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      />
    </>
  );
}
