import type { ProjectFormat } from "@xiezuomanju/domain";
import type { DeliverableCompletion } from "./deliverables";

export type StageAdvanceBlock = {
  ok: boolean;
  reason?: string;
  /** 建议用户去补的交付物 */
  need?: string;
};

/**
 * 「完成并前进」内容门槛：流程步可点，但必须有对应交稿内容，
 * 避免 stage/progress 标绿而创作台中间区空白。
 */
export function canAdvanceStage(
  format: ProjectFormat,
  stageId: string,
  completion: DeliverableCompletion,
  extras?: { synopsis?: string; logline100?: string },
): StageAdvanceBlock {
  const id = stageId.toUpperCase();

  // 纯设置 / 终态 / 人工确认步：不拦
  if (
    /(_ACK$|^S0_|_DONE$|SETUP|HUMAN_QC|QC_CHECKLIST)/.test(id) &&
    !/(HOOK|BIO|OUTLINE|BODY|SCENE|SCRIPT)/.test(id)
  ) {
    if (/_ACK$/.test(id)) return { ok: true };
  }
  if (/^S0_|_DONE$|SETUP/.test(id)) return { ok: true };

  if (/(HOOK|TOPIC|CORE_HOOK|WANT_HOW)/.test(id)) {
    if (format === "manju" || format === "duanju") {
      if (!completion.hasHook && !completion.hasSynopsis) {
        return { ok: false, reason: "请先生成并采纳核心梗/选题", need: "hook" };
      }
    } else if (!completion.hasSynopsis && !completion.hasHook) {
      return { ok: false, reason: "请先写好梗概或选题产物", need: "synopsis" };
    }
  }

  if (/LOGLINE/.test(id)) {
    const logline = (extras?.logline100 || extras?.synopsis || "").trim();
    if (logline.length < 20 && !completion.hasSynopsis) {
      return { ok: false, reason: "请先填写约 100 字测试文案或梗概", need: "synopsis" };
    }
  }

  if (/(BIO|CHAR|GOLD_FINGER|WANT)/.test(id) && !/OUTLINE|BODY|SCENE/.test(id)) {
    if (!completion.hasCharacters && !completion.hasSetting) {
      return { ok: false, reason: "请先生成人设/设定产物", need: "characters" };
    }
  }

  if (/(OUTLINE|BEAT|EP10|VOLUME|CHAPTER_OUT|UNIT)/.test(id) && !/(BODY|SCENE|SCRIPT|PROSE)/.test(id)) {
    if (completion.outlineReadyCount < 1) {
      return { ok: false, reason: "请先生成大纲/节拍产物", need: "outline" };
    }
  }

  if (/(BODY|SCENE|SCRIPT|PROSE|MANUSCRIPT|EP_BODY)/.test(id)) {
    if (completion.bodyReadyCount < 1 && completion.bodyCount < 1) {
      return { ok: false, reason: "请先生成至少一集/章正文或分场剧本", need: "manuscript" };
    }
  }

  if (/(REVISE|DE_AI|LOGIC|COOL_DENSITY|PACE|PAYWALL)/.test(id)) {
    if (completion.bodyReadyCount < 1 && !completion.hasQc) {
      return { ok: false, reason: "质检/节奏步需要先有正文", need: "manuscript" };
    }
  }

  return { ok: true };
}
