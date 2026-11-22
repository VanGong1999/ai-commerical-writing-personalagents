import { useNavigate } from "@tanstack/react-router";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { Badge } from "@xiezuomanju/ui";
import { motion } from "framer-motion";
import { PulseDot, Stagger, StaggerItem } from "../../components/motion";

type Node = {
  label: string;
  to: string;
  search?: Record<string, string | undefined>;
  hint: string;
  phase: string;
  gate?: string;
};

const PHASES = [
  { id: "discover", label: "发现与选题" },
  { id: "design", label: "设定与人设（先于大纲）" },
  { id: "structure", label: "结构与爽点" },
  { id: "draft", label: "正文与质检" },
  { id: "deliver", label: "交稿复盘" },
] as const;

const NODES: Node[] = [
  { phase: "discover", label: "变现路径", to: "/inspiration", hint: "卖给谁 · 平台分层", gate: "认知" },
  { phase: "discover", label: "灵感采集层级", to: "/inspiration", hint: "一念→选题；结构判层见8课" },
  { phase: "discover", label: "短篇选题9课", to: "/inspiration", hint: "受众扒榜·导语·11–13情节" },
  {
    phase: "design",
    label: "人设深度10课",
    to: "/studio/$format",
    search: { format: "short_novel" },
    hint: "Big5·欲惧秘·灵魂三问·短篇手搓12",
  },
  { phase: "discover", label: "题材红黑榜", to: "/projects/new", search: { format: "manju" }, hint: "避饱和 · 推可写" },
  { phase: "discover", label: "核心梗批量", to: "/studio/$format", search: { format: "manju" }, hint: "四步组合 · ≥10 条" },
  { phase: "discover", label: "100 字测试", to: "/studio/$format", search: { format: "manju" }, hint: "人工闸 Logline100+社交确认", gate: "人工闸" },
  {
    phase: "discover",
    label: "漫剧题材轨12课",
    to: "/studio/$format",
    search: { format: "manju" },
    hint: "升级/反套路/后悔·收藏>5万",
  },
  {
    phase: "structure",
    label: "漫剧管线11课",
    to: "/studio/$format",
    search: { format: "manju" },
    hint: "粗纲·集纲节奏·拒稿三检·一稿一投·手册SOP",
  },
  {
    phase: "structure",
    label: "手册SOP爽卡表",
    to: "/studio/$format",
    search: { format: "manju" },
    hint: "十八模型·卡点三类·能不能用·规格闸",
  },
  {
    phase: "discover",
    label: "IP改编台13课",
    to: "/studio/$format",
    search: { format: "ip_adapt" },
    hint: "选书·锚定·单元情绪·AdaptPitchPack",
  },
  {
    phase: "design",
    label: "女频深度14课",
    to: "/studio/$format",
    search: { format: "female_long" },
    hint: "选题六雷·人设练习·主副线·八报告",
  },
  {
    phase: "structure",
    label: "女频节奏15课",
    to: "/studio/$format",
    search: { format: "female_long" },
    hint: "节奏曲线·情绪细节·变现·连载监控",
  },
  {
    phase: "structure",
    label: "考拉流水线16课",
    to: "/studio/$format",
    search: { format: "manju" },
    hint: "十二步·十集校正·滚动交稿·≠男频长篇",
  },
  {
    phase: "structure",
    label: "漫剧进阶17课",
    to: "/studio/$format",
    search: { format: "manju" },
    hint: "元素叠加·百集四幕·开场钩子·趋势",
  },
  { phase: "discover", label: "拆书对标", to: "/kb", hint: "七步/情绪/红线报告" },
  { phase: "discover", label: "换元仿写", to: "/kb", hint: "一度二度 · 相似度红线", gate: "相似度" },
  { phase: "design", label: "设定包", to: "/studio/$format", search: { format: "manju" }, hint: "五要素·金手指·世界观" },
  { phase: "design", label: "人设七步", to: "/studio/$format", search: { format: "manju" }, hint: "大纲前完成 · BioAck", gate: "人工闸" },
  { phase: "structure", label: "十集大纲", to: "/studio/$format", search: { format: "manju" }, hint: "爽点卡点 · OutlineAck", gate: "人工闸" },
  { phase: "structure", label: "爽点引擎", to: "/studio/$format", search: { format: "manju" }, hint: "十二套路 / 十八模型" },
  { phase: "structure", label: "100 集四幕", to: "/studio/$format", search: { format: "manju" }, hint: "17课任务表 · 扩展用 · 不挡前十投稿" },
  { phase: "draft", label: "分集正文", to: "/studio/$format", search: { format: "manju" }, hint: "自动带入人物设定 · 字数不足会暂停", gate: "会自动暂停" },
  { phase: "draft", label: "台词三层", to: "/studio/$format", search: { format: "manju" }, hint: "态度·信息·潜台词" },
  { phase: "draft", label: "去 AI 味", to: "/studio/$format", search: { format: "manju" }, hint: "V3.8 checklist" },
  { phase: "draft", label: "手搓十二检(漫剧)", to: "/studio/$format", search: { format: "manju" }, hint: "LogicAck 仅人工；短篇手搓见10课", gate: "人工闸" },
  { phase: "deliver", label: "投稿四件套", to: "/studio/$format", search: { format: "manju" }, hint: "信息表 + 导语" },
  { phase: "deliver", label: "数据复盘", to: "/projects", hint: "收藏率 · analytics.review" },
  {
    phase: "discover",
    label: "查理产品锁",
    to: "/studio/$format",
    search: { format: "duanju" },
    hint: "解压>审美>故事·三原则·付费心理",
  },
  {
    phase: "structure",
    label: "查理20拍对齐",
    to: "/studio/$format",
    search: { format: "duanju" },
    hint: "环境规则→回到原点·起承转合·≠STC",
  },
  {
    phase: "structure",
    label: "场三件套",
    to: "/studio/$format",
    search: { format: "duanju" },
    hint: "信息+推进+变化·三角·开场七型",
  },
  {
    phase: "draft",
    label: "修改20法则",
    to: "/studio/$format",
    search: { format: "duanju" },
    hint: "改稿体检·GenderPath·拉片轻勾",
  },
  { phase: "discover", label: "短剧 20 拍", to: "/studio/$format", search: { format: "duanju" }, hint: "查理拍名·中点五型·八桥段" },
  { phase: "discover", label: "扫榜热点", to: "/kb/crawler", hint: "题材波动可视化" },
];

export function WorkflowMap() {
  const nav = useNavigate();

  const go = (n: Node) => {
    if (n.to === "/studio/$format") {
      const fmt = (n.search?.format || "manju") as ProjectFormat;
      void nav({
        to: "/studio/$format",
        params: { format: fmt },
        search: { projectId: undefined },
      });
    } else if (n.to === "/projects/new") {
      void nav({
        to: "/projects/new",
        search: { format: n.search?.format as ProjectFormat | undefined },
      });
    } else if (n.to === "/kb/crawler") {
      void nav({ to: "/kb/crawler" });
    } else if (n.to === "/projects") {
      void nav({ to: "/projects" });
    } else {
      void nav({ to: n.to as "/inspiration" | "/kb" });
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        九格创作路径全景：先定人物，再写大纲；需要你确认或会自动暂停的步骤不能跳过。点击进入对应工作台。
      </p>
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        style={{
          height: 2,
          transformOrigin: "left",
          background: "linear-gradient(90deg, var(--accent, #6366f1), transparent)",
          borderRadius: 2,
        }}
        aria-hidden
      />
      {PHASES.map((phase) => {
        const nodes = NODES.filter((n) => n.phase === phase.id);
        if (!nodes.length) return null;
        return (
          <div key={phase.id} className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{phase.label}</strong>
              <motion.span
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.45, delay: 0.08, ease: "easeOut" }}
                style={{
                  flex: 1,
                  height: 1,
                  transformOrigin: "left",
                  background: "var(--border, #334155)",
                }}
                aria-hidden
              />
            </div>
            <Stagger className="map">
              {nodes.map((n, i) => (
                <StaggerItem key={`${phase.id}-${n.label}`}>
                  <button
                    type="button"
                    className="map__node"
                    onClick={() => go(n)}
                  >
                    <strong className="row" style={{ gap: 6, alignItems: "center" }}>
                      <PulseDot
                        active={!!n.gate}
                        tone={n.gate === "会自动暂停" ? "warn" : n.gate ? "accent" : "ok"}
                        size={8}
                      />
                      {i + 1}. {n.label}
                    </strong>
                    <span className="faint">{n.hint}</span>
                    {n.gate && (
                      <span style={{ marginTop: 4, display: "inline-block" }}>
                        <Badge tone={n.gate === "会自动暂停" ? "fail" : "warn"}>{n.gate}</Badge>
                      </span>
                    )}
                  </button>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        );
      })}
    </div>
  );
}
