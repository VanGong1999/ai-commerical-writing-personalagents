/**
 * 课程缺口补全能力速查面板：把本轮新增的 Agent 以按钮暴露到对应创作台。
 * 复用 runAgentFeedback；不重复造轮子（能力本体在 Skill + Agent + domain）。
 */
import { Button, Panel } from "@xiezuomanju/ui";
import { runAgentFeedback } from "./runAgentFeedback";

type Capability = { agentId: string; label: string; hint: string };

const DUANJU_EXTRA: Capability[] = [
  { agentId: "scene.visualize", label: "视觉化场面", hint: "空间写空→可拍画面" },
  { agentId: "scene.expand_ladder", label: "扩写阶梯", hint: "梗概→纲→场" },
  { agentId: "hook.from_cool_reverse", label: "从爽点反推钩", hint: "先爽点后钩子" },
  { agentId: "dissect.pull_male", label: "男频拉片", hint: "六维升级" },
  { agentId: "dissect.pull_female", label: "女频拉片", hint: "画像×因果×信息差" },
  { agentId: "char.voice_profile", label: "声口档案", hint: "每角色建档" },
  { agentId: "char.antagonist_ladder", label: "对手阶梯", hint: "假对手→真对手" },
  { agentId: "char.love_8step", label: "感情线八步", hint: "相识→共谋" },
  { agentId: "char.naming", label: "命名规范", hint: "男接地气/女叠音" },
  { agentId: "world.setting_cap", label: "设定收敛", hint: "≤2 主设定" },
  { agentId: "struct.witness_amp", label: "两性见证", hint: "加见证放大" },
  { agentId: "topic.account_tier", label: "满级号/小号", hint: "下山目标/开挂三型" },
  { agentId: "topic.resonance_yy", label: "YY 困境映射", hint: "困境→幻想解法" },
  { agentId: "qc.logic_heuristic", label: "逻辑启发式", hint: "只警告不自动绿" },
  { agentId: "qc.ai_detect_hint", label: "AI 味提示", hint: "不承诺过检测" },
  { agentId: "deliver.spec8", label: "八类规格", hint: "制作备注" },
  { agentId: "topic.pitch_deck", label: "提案三件套", hint: "投前提案" },
  { agentId: "deliver.contract_notes", label: "接活备忘", hint: "报价/版权" },
  { agentId: "struct.female_omni", label: "女频信息差", hint: "开天眼+因果" },
  { agentId: "prose.enrich_ep", label: "单集补强", hint: "补细节钩子" },
];

const STRUCT_EXTRA: Capability[] = [
  { agentId: "struct.master_outline", label: "总纲", hint: "四弧节拍轨" },
  { agentId: "struct.chapter_outline", label: "章纲", hint: "逐章目标/冲突/钩" },
  { agentId: "struct.beat_sheet", label: "细纲情节点", hint: "控长" },
  { agentId: "struct.conflict", label: "矛盾六要素", hint: "升级+优先级" },
  { agentId: "dissect.emotion_curve", label: "情绪曲线", hint: "-10~+10 上下行" },
  { agentId: "dissect.style_extract", label: "文风抽取", hint: "仿风格不仿面" },
  { agentId: "dissect.trope_mine", label: "桥段挖掘", hint: "入库" },
  { agentId: "dissect.guess", label: "猜书对标", hint: "题材/金手指" },
  { agentId: "imitate.rhythm", label: "仿节奏", hint: "量化节奏" },
  { agentId: "swap.apply_outline", label: "换元改纲", hint: "分步替换" },
];

export function CourseExtraPanel({
  projectId,
  group,
}: {
  projectId?: string;
  group: "duanju" | "structure";
}) {
  const caps = group === "duanju" ? DUANJU_EXTRA : STRUCT_EXTRA;
  const title = group === "duanju" ? "查理进阶能力" : "九格结构 / 拆书能力";
  return (
    <Panel title={title}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        课程缺口补全：这些能力此前只建模未接线，现可一键真实入队。
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {caps.map((c) => (
          <Button
            key={c.agentId}
            size="sm"
            disabled={!projectId}
            title={c.hint}
            onClick={() =>
              projectId && void runAgentFeedback(projectId, c.agentId, { label: c.agentId })
            }
          >
            {c.label}
          </Button>
        ))}
      </div>
    </Panel>
  );
}
