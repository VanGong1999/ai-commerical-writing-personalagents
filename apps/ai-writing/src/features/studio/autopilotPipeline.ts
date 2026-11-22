import type { ArtifactType, ProjectFormat } from "@xiezuomanju/domain";

/**
 * 一键生成统一流水线：每个格式一条「格式正确」的主链。
 * Agent 一律取自该格式 Stage 图（见 packages/agent-runtime/src/stages.ts），
 * 保证 format 匹配，避免把漫剧 Agent 套到网文/短剧上。
 */
export type AutopilotStep = {
  id: string;
  agentId: string;
  label: string;
  adoptType?: ArtifactType;
  adoptMode?: "strong" | "draft";
};

export function autopilotPipelineFor(format: ProjectFormat): AutopilotStep[] {
  switch (format) {
    case "manju":
      return [
        { id: "hook", agentId: "topic.core_hook_batch", label: "核心梗", adoptType: "core_hook", adoptMode: "strong" },
        { id: "char", agentId: "char.bio_manju", label: "人物小传", adoptType: "character", adoptMode: "strong" },
        { id: "outline", agentId: "struct.episode_outline", label: "前十集大纲", adoptType: "episode_outline", adoptMode: "strong" },
        { id: "body", agentId: "prose.episode_body", label: "分集正文", adoptType: "manuscript", adoptMode: "strong" },
        { id: "qc", agentId: "qc.de_ai", label: "去 AI 味质检", adoptType: "qc_report", adoptMode: "strong" },
        { id: "pitch", agentId: "deliver.pitch_pack", label: "投稿四件套", adoptType: "other", adoptMode: "strong" },
      ];
    case "duanju":
      return [
        { id: "topic", agentId: "topic.want_how", label: "选题三问", adoptType: "topic_card", adoptMode: "strong" },
        { id: "char", agentId: "char.mini_bio", label: "人物小传", adoptType: "character", adoptMode: "strong" },
        { id: "outline", agentId: "struct.ep_outline_duanju", label: "十集大纲", adoptType: "episode_outline", adoptMode: "strong" },
        { id: "body", agentId: "orch.batch_writer", label: "场级正文", adoptType: "scene", adoptMode: "strong" },
        { id: "qc", agentId: "qc.revise20", label: "修改20体检" },
        { id: "pitch", agentId: "deliver.submission_pack", label: "交稿包", adoptType: "other", adoptMode: "strong" },
      ];
    case "short_novel":
      return [
        { id: "dissect", agentId: "kb.report_pipeline", label: "拆书参数", adoptType: "analysis_report", adoptMode: "strong" },
        { id: "swap", agentId: "swap.master", label: "换元方案", adoptType: "swap_plan", adoptMode: "strong" },
        { id: "synopsis", agentId: "inspiration.expand", label: "总纲梗概" },
        { id: "outline", agentId: "struct.chapter_cap", label: "章纲细纲", adoptType: "chapter_outline", adoptMode: "strong" },
        { id: "body", agentId: "prose.novel_body", label: "正文初稿", adoptType: "manuscript", adoptMode: "strong" },
        { id: "qc", agentId: "qc.de_ai", label: "去 AI 味质检", adoptType: "qc_report", adoptMode: "strong" },
      ];
    case "male_long":
      return [
        { id: "topic", agentId: "male.opening", label: "刷榜选题+开篇钩", adoptType: "opening_hook", adoptMode: "strong" },
        { id: "gold", agentId: "male.gold_finger", label: "金手指设定", adoptType: "gold_finger_cap", adoptMode: "strong" },
        { id: "char", agentId: "char.bible_big5", label: "人设卡", adoptType: "character", adoptMode: "strong" },
        { id: "volume", agentId: "male.upgrade_loop", label: "卷纲升级循环", adoptType: "upgrade_loop", adoptMode: "strong" },
        { id: "outline", agentId: "struct.chapter_cap", label: "章纲细纲", adoptType: "chapter_outline", adoptMode: "strong" },
        { id: "body", agentId: "prose.novel_body", label: "样章正文", adoptType: "manuscript", adoptMode: "strong" },
        { id: "qc", agentId: "male.cool_density", label: "爽点密度质检" },
      ];
    case "female_long":
      return [
        { id: "topic", agentId: "struct.chase_wife", label: "追妻选题", adoptType: "chase_wife_pentalogy", adoptMode: "strong" },
        { id: "char", agentId: "char.bible_big5", label: "人设卡", adoptType: "character", adoptMode: "strong" },
        { id: "volume", agentId: "female.pace", label: "卷纲节奏", adoptType: "pace_plan", adoptMode: "strong" },
        { id: "outline", agentId: "struct.chapter_cap", label: "章纲细纲", adoptType: "chapter_outline", adoptMode: "strong" },
        { id: "body", agentId: "prose.novel_body", label: "样章正文", adoptType: "manuscript", adoptMode: "strong" },
        { id: "qc", agentId: "struct.paywall", label: "付费点+节奏体检" },
      ];
    case "ip_adapt":
      return [
        { id: "eval", agentId: "ip.select_score", label: "IP 选书评分", adoptType: "select_score", adoptMode: "strong" },
        { id: "unit", agentId: "ip.unit_cut", label: "单元拆解" },
        { id: "emotion", agentId: "ip.emotion_quant", label: "情绪量化" },
        { id: "rebuild", agentId: "ip.rebuild", label: "压缩重构" },
        { id: "outline", agentId: "struct.episode_outline", label: "单集节奏大纲", adoptType: "episode_outline", adoptMode: "strong" },
        { id: "body", agentId: "prose.episode_body", label: "压缩剧本", adoptType: "manuscript", adoptMode: "strong" },
        { id: "pitch", agentId: "deliver.pitch_pack", label: "改编交稿包", adoptType: "other", adoptMode: "strong" },
      ];
  }
}

/** 一键生成的正文步数（首批样章 / 试播集）。 */
export function autopilotBodyCountFor(format: ProjectFormat): number {
  if (format === "manju") return 3;
  if (format === "duanju") return 3;
  return 1;
}

/** 从一句话创作需求猜测格式；识别不准可手动改。 */
export function detectFormat(topic: string): ProjectFormat {
  const t = topic.trim();
  if (!t) return "short_novel";
  if (/漫剧/.test(t)) return "manju";
  if (/短剧|爽剧|付费剧|竖屏剧/.test(t)) return "duanju";
  if (/IP|改编|原著|小说改编|影视化/.test(t)) return "ip_adapt";
  if (/女频|大女主|追妻|虐恋|甜宠|霸总|宫斗|宅斗|萌宝|马甲/.test(t)) return "female_long";
  if (/男频|升级|打脸|玄幻|都市|系统|金手指|赘婿|战神/.test(t)) return "male_long";
  return "short_novel";
}
