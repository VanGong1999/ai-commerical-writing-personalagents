import type { ProjectFormat } from "@xiezuomanju/domain";
import {
  DUANJU_STAGE_LABELS,
  FEMALE_LONG_STAGE_LABELS,
  FemaleLongStageSchema,
  IpAdaptStageSchema,
  MALE_LONG_STAGE_LABELS,
  MANJU_STAGE_LABELS,
  MaleLongStageSchema,
  ManjuStageSchema,
  DuanjuStageSchema,
  ShortNovelStageSchema,
  SHORT_NOVEL_STAGE_LABELS,
  STAGES_BY_FORMAT,
  normalizeStageId,
} from "@xiezuomanju/domain";

const IP_LABELS: Record<string, string> = {
  S0_SETUP: "设置",
  S1_IP_EVAL: "IP 评估",
  S2_UNIT_SPLIT: "单元拆解",
  S3_EMOTION: "情绪曲线",
  S4_COMPRESS: "压缩重构",
  S5_EPISODE_RHYTHM: "单集节奏",
  S6_BEATS: "卡点",
  S7_SCRIPT: "剧本输出",
  S8_DONE: "完成",
};

export function stagesFor(format: ProjectFormat): readonly string[] {
  return STAGES_BY_FORMAT[format] ?? ManjuStageSchema.options;
}

export function labelsFor(format: ProjectFormat): Record<string, string> {
  switch (format) {
    case "manju":
      return MANJU_STAGE_LABELS;
    case "duanju":
      return DUANJU_STAGE_LABELS;
    case "short_novel":
      return SHORT_NOVEL_STAGE_LABELS;
    case "male_long":
      return MALE_LONG_STAGE_LABELS;
    case "female_long":
      return FEMALE_LONG_STAGE_LABELS;
    case "ip_adapt":
      return IP_LABELS;
    default:
      return {};
  }
}

export function isValidFormat(v: string): v is ProjectFormat {
  return [
    "manju",
    "duanju",
    "short_novel",
    "male_long",
    "female_long",
    "ip_adapt",
  ].includes(v);
}

export function normalizeProjectStage(format: ProjectFormat, stage: string): string {
  return normalizeStageId(format, stage);
}

export type StageProgress = {
  stageId: string;
  label: string;
  index: number;
  total: number;
  pct: number;
  done: boolean;
};

/** 全站统一的阶段进度：显示中文 Stage 名，按「第几步 / 共几步」计算。 */
export function stageProgressFor(format: ProjectFormat, stage: string): StageProgress {
  const stages = stagesFor(format);
  const stageId = normalizeProjectStage(format, stage);
  const index = Math.max(0, stages.indexOf(stageId as never));
  const total = Math.max(stages.length, 1);
  return {
    stageId,
    label: labelsFor(format)[stageId] ?? stageId,
    index,
    total,
    pct: Math.min(100, Math.round(((index + 1) / total) * 100)),
    done: index === stages.length - 1,
  };
}

/** 流程位置文案：只描述阶段，不把 100% 误读成交稿完成。 */
export function stageProgressText(progress: StageProgress): string {
  if (progress.done) return `流程完成 · ${progress.total} 步`;
  return `流程 · 第 ${progress.index + 1}/${progress.total} 步`;
}

export const ALL_STAGE_SCHEMAS = {
  manju: ManjuStageSchema,
  duanju: DuanjuStageSchema,
  short_novel: ShortNovelStageSchema,
  male_long: MaleLongStageSchema,
  female_long: FemaleLongStageSchema,
  ip_adapt: IpAdaptStageSchema,
};
