import type { Artifact, ProjectFormat } from "@xiezuomanju/domain";
import { Button, Panel, StreamPanel } from "@xiezuomanju/ui";
import type { DeliverableId } from "./deliverables";
import {
  CharacterBiblePanel,
  deliverableCompletion,
  ManuscriptStudio,
  OutlineDualView,
  PackagePanel,
  QcGatePanel,
  SynopsisPanel,
} from "./deliverables";
import {
  Beat20Workbench,
  CoolPointWorkbench,
  DialogueTripleWorkbench,
} from "./DeepMethodPanels";
import {
  ChaseWifeWorkbench,
  CommercialOutlineWorkbench,
  CoreHookDetailWorkbench,
  DissectParamsWorkbench,
  PromptComposeWorkbench,
  ShortNovelLesson2Workspace,
  UnitSevenStepWorkbench,
} from "./NinesLesson2Panels";
import {
  EmotionSlopeCompareWorkbench,
  QcPriorityWorkbench,
  ShortNovelLesson3Workspace,
  SwapSevenStepWorkbench,
} from "./NinesLesson3Panels";
import {
  ExpectationConflictWorkbench,
  ExpectationReviseChecklist,
  GenericArcHintPanel,
} from "./NinesLesson4Panels";
import {
  EditorRejectDiagnosePanel,
  EmotionRhythmWorkbench,
  EmotionWriteLiteWorkbench,
  RhythmFourDimDashboard,
} from "./NinesLesson5Panels";
import { CoolFaceSlapWorkbench } from "./NinesLesson6Panels";
import {
  AiReviseFlowPanel,
  ChapterTreePanel,
  InspirationToStoryWorkbench,
  SceneFourRenderWorkbench,
} from "./NinesLesson8Panels";
import {
  ExecutionQcLitePanel,
  TopicSelectionWorkbench,
} from "./NinesLesson9Panels";
import {
  CharacterDepthWorkbench,
  ShortFictionHandEdit12Panel,
} from "./NinesLesson10Panels";
import { IpAdaptWorkbench } from "./NinesLesson13Panels";
import {
  FemaleLongDepthWorkbench,
  FemaleLongWorkbench,
} from "./NinesLesson14Panels";
import { ManjuAdvancedWorkbench } from "./NinesLesson17Panels";
import { KaolaRollingWorkbench } from "./NinesLesson16Panels";
import { MaleLongEngineWorkbench } from "./KgmMaleLongPanels";
import { DuanjuUnitWorkbench } from "./DuanjuUnitPanels";
import { CourseExtraPanel } from "./CourseExtraPanels";
import {
  Bridge8OnePlusPanel,
  DuanjuCharlieOverview,
  GenderPathPanel,
  LapianLitePanel,
  ProductLockPanel,
  Revise20Workbench,
  SceneTriplePanel,
  WantHowShellPanel,
} from "./DuanjuCharliePanels";
import { BeatMapPanel } from "./BeatMapPanel";
import { type ReactNode, useEffect, useState } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { useAgentRun } from "./useAgentRun";

function stageAgentFor(format: ProjectFormat, stage: string) {
  if (format === "duanju") {
    if (stage.includes("EP10") || stage === "S4_EP10_DRAFT" || stage === "S4_EP10") {
      return "struct.ep_outline_duanju";
    }
    if (stage.includes("BEAT") || stage.includes("STRUCTURE")) return "struct.beat20";
    if (stage.includes("DIALOGUE") || stage.includes("SCENE")) return "prose.dialogue_formula";
    if (stage.includes("CHAR") || stage.includes("BIO")) return "char.mini_bio";
    if (stage.includes("QC") || stage.includes("REVISE") || stage.includes("SUBMIT")) {
      return "qc.human_qc_duanju";
    }
    if (stage.includes("TOPIC") || stage.includes("PRODUCT")) return "topic.want_how";
    return "topic.want_how";
  }
  if (format === "male_long") {
    if (stage.includes("TOPIC") || stage.includes("SCAN")) return "male.opening";
    if (stage.includes("GOLD_FINGER")) return "male.gold_finger";
    if (stage.includes("CHARACTER")) return "char.bible_big5";
    if (stage.includes("VOLUME")) return "male.upgrade_loop";
    if (stage.includes("CHAPTER") || stage.includes("BEAT")) return "struct.chapter_cap";
    if (stage.includes("BODY")) return "prose.novel_body";
    if (stage.includes("COOL")) return "male.cool_density";
    if (stage.includes("RISK")) return "male.risk";
    return "male.upgrade_loop";
  }
  if (format === "female_long") {
    if (stage.includes("TOPIC")) return "struct.chase_wife";
    if (stage.includes("FOUR_SWAP")) return "swap.master";
    if (stage.includes("CHARACTER")) return "char.bible_big5";
    if (stage.includes("VOLUME") || stage.includes("CHAPTER") || stage.includes("RHYTHM")) {
      return "female.pace";
    }
    if (stage.includes("BODY")) return "prose.novel_body";
    if (stage.includes("TABOO") || stage.includes("RISK")) return "female.risk";
    if (stage.includes("PAYWALL")) return "struct.paywall";
    return "female.pace";
  }
  if (format === "short_novel") return "swap.master";
  if (format === "ip_adapt") {
    if (stage.includes("EVAL") || stage.includes("IP_EVAL")) return "ip.select_score";
    if (stage.includes("UNIT")) return "ip.unit_cut";
    if (stage.includes("EMOTION")) return "ip.emotion_quant";
    if (stage.includes("COMPRESS") || stage.includes("REBUILD")) return "ip.rebuild";
    if (stage.includes("SCRIPT") || stage.includes("BODY")) return "prose.episode_body";
    return "ip.unit_cut";
  }
  return "topic.core_hook_batch";
}

function StageFallbackStream({
  format,
  stage,
  stageLabel,
  projectId,
}: {
  format: ProjectFormat;
  stage: string;
  stageLabel: string;
  projectId?: string;
}) {
  const agentId = stageAgentFor(format, stage);
  const stream = useAgentRun(projectId, agentId);
  return (
    <div className="stack">
      <Panel title={stageLabel}>
        <p className="muted">
          生成后，可切到「交稿物」装订栏查看
          {formatHint(format)}。
        </p>
        <Button
          variant="primary"
          disabled={!projectId || stream.streaming}
          onClick={() => void stream.start()}
        >
          {stream.streaming ? "生成中…" : "生成本步候选稿"}
        </Button>
        {stream.error ? (
          <p className="muted" style={{ color: "var(--danger, #b4443c)" }}>
            {stream.error}
          </p>
        ) : null}
      </Panel>
      <StreamPanel
        text={stream.text}
        streaming={stream.streaming}
        onStart={() => void stream.start()}
        onAbort={stream.abort}
      />
    </div>
  );
}

/** 非漫剧格式：交稿物优先，流程模式保留通用壳 */
function OptionalMethod({ title, children }: { title: string; children: ReactNode }) {
  return <details className="studio-method"><summary>选填方法 · {title}</summary><div className="stack">{children}</div></details>;
}

export function FormatDeliverableWorkspace({
  format,
  deliverable,
  stage,
  stageLabel,
  mode,
  artifacts,
  projectId,
  projectTitle,
  synopsisValue,
  onSynopsisChange,
}: {
  format: ProjectFormat;
  deliverable: DeliverableId;
  stage: string;
  stageLabel: string;
  mode: "deliverable" | "stage";
  artifacts: Artifact[];
  projectId?: string;
  projectTitle?: string;
  synopsisValue?: string;
  onSynopsisChange?: (value: string) => void;
}) {
  const [synopsis, setSynopsis] = useState(synopsisValue ?? "");

  useEffect(() => {
    setSynopsis(synopsisValue ?? "");
  }, [projectId, synopsisValue]);

  const updateSynopsis = (value: string) => {
    setSynopsis(value);
    onSynopsisChange?.(value);
  };

  if (mode === "stage") {
    if (format === "short_novel") {
      if (stage.includes("DISSECT")) {
        return <DissectParamsWorkbench projectId={projectId} artifacts={artifacts} />;
      }
      if (stage.includes("SWAP")) {
        return <SwapSevenStepWorkbench projectId={projectId} />;
      }
      if (stage.includes("SYNOPSIS")) {
        return (
          <div className="stack">
            <TopicSelectionWorkbench projectId={projectId} />
            <OptionalMethod title="完善人物与故事卖点">
            <CharacterDepthWorkbench projectId={projectId} />
            <InspirationToStoryWorkbench projectId={projectId} />
            <ExpectationConflictWorkbench projectId={projectId} />
            <CommercialOutlineWorkbench projectId={projectId} />
            <CoreHookDetailWorkbench projectId={projectId} artifacts={artifacts} />
            </OptionalMethod>
          </div>
        );
      }
      if (stage.includes("CHAPTER") || stage.includes("BEAT")) {
        return (
          <div className="stack">
            <GenericArcHintPanel projectId={projectId} />
            <ChapterTreePanel projectId={projectId} />
            <OptionalMethod title="调整场景、情绪和节奏">
            <SceneFourRenderWorkbench projectId={projectId} />
            <EmotionSlopeCompareWorkbench projectId={projectId} />
            <RhythmFourDimDashboard projectId={projectId} />
            <CoolFaceSlapWorkbench projectId={projectId} />
            <UnitSevenStepWorkbench projectId={projectId} />
            <CommercialOutlineWorkbench projectId={projectId} />
            </OptionalMethod>
          </div>
        );
      }
      if (stage.includes("BODY") || stage.includes("POLISH")) {
        return (
          <div className="stack">
            <AiReviseFlowPanel projectId={projectId} />
            <OptionalMethod title="修改清单与情绪描写">
            <ShortFictionHandEdit12Panel projectId={projectId} />
            <ExecutionQcLitePanel projectId={projectId} />
            <EmotionWriteLiteWorkbench projectId={projectId} />
            <CoolFaceSlapWorkbench projectId={projectId} />
            <PromptComposeWorkbench projectId={projectId} />
            </OptionalMethod>
            <StageFallbackStream
              format={format}
              stage={stage}
              stageLabel={stageLabel}
              projectId={projectId}
            />
          </div>
        );
      }
      if (stage.includes("QC") || stage.includes("DONE")) {
        return (
          <div className="stack">
            <QcPriorityWorkbench projectId={projectId} />
            <OptionalMethod title="细查退稿原因与读者期待">
            <AiReviseFlowPanel projectId={projectId} />
            <ShortFictionHandEdit12Panel projectId={projectId} />
            <ExecutionQcLitePanel projectId={projectId} />
            <EditorRejectDiagnosePanel projectId={projectId} />
            <EmotionRhythmWorkbench projectId={projectId} />
            <CoolFaceSlapWorkbench projectId={projectId} />
            <ExpectationReviseChecklist projectId={projectId} />
            </OptionalMethod>
          </div>
        );
      }
      return <ShortNovelLesson2Workspace projectId={projectId} artifacts={artifacts} />;
    }
    if (format === "duanju") {
      if (
        stage.includes("PRODUCT") ||
        stage.includes("SETUP") ||
        stage === "S0_PRODUCT"
      ) {
        return (
          <div className="stack">
            <ProductLockPanel projectId={projectId} />
            <DuanjuCharlieOverview projectId={projectId} />
          </div>
        );
      }
      if (stage.includes("TOPIC") || stage === "S1_TOPIC" || stage === "S1_TOPIC_ACK") {
        return (
          <div className="stack">
            <WantHowShellPanel projectId={projectId} />
            <CoolPointWorkbench projectId={projectId} />
          </div>
        );
      }
      if (stage.includes("CHAR") || stage.includes("BIO")) {
        return (
          <div className="stack">
            <CharacterBiblePanel {...{ projectId, artifacts, format }} />
            <OptionalMethod title="人物定位与深度设计">
              <GenderPathPanel projectId={projectId} />
              <CharacterDepthWorkbench projectId={projectId} />
            </OptionalMethod>
          </div>
        );
      }
      if (stage.includes("BEAT") || stage.includes("STRUCTURE")) {
        return (
          <div className="stack">
            <Beat20Workbench projectId={projectId} />
            <BeatMapPanel projectId={projectId} format={format} artifacts={artifacts} />
            <Bridge8OnePlusPanel projectId={projectId} />
          </div>
        );
      }
      if (
        stage === "S4_EP10_DRAFT" ||
        stage === "S4_EP10" ||
        stage.includes("EP10")
      ) {
        return (
          <div className="stack">
            <DuanjuEp10Workbench
              projectId={projectId}
              artifacts={artifacts}
              stage={stage}
              stageLabel={stageLabel}
            />
            <Bridge8OnePlusPanel projectId={projectId} />
          </div>
        );
      }
      if (stage.includes("SCENE") || stage.includes("DIALOGUE")) {
        return (
          <div className="stack">
            <SceneTriplePanel projectId={projectId} />
            <DialogueTripleWorkbench projectId={projectId} artifacts={artifacts} />
          </div>
        );
      }
      if (
        stage.includes("REVISE") ||
        stage.includes("QC") ||
        stage === "S6_REVISE20"
      ) {
        return (
          <div className="stack">
            <Revise20Workbench projectId={projectId} />
            <LapianLitePanel projectId={projectId} />
          </div>
        );
      }
      if (stage.includes("SUBMIT") || stage.includes("DONE") || stage === "S7_SUBMIT") {
        return (
          <div className="stack">
            <DuanjuCharlieOverview projectId={projectId} />
            <StageFallbackStream
              format={format}
              stage={stage}
              stageLabel={stageLabel}
              projectId={projectId}
            />
          </div>
        );
      }
      return (
        <div className="stack">
          <DuanjuCharlieOverview projectId={projectId} />
          <StageFallbackStream
            format={format}
            stage={stage}
            stageLabel={stageLabel}
            projectId={projectId}
          />
        </div>
      );
    }
    if (format === "male_long") {
      return (
        <div className="stack">
          <MaleLongEngineWorkbench projectId={projectId} />
          <CourseExtraPanel projectId={projectId} group="structure" />
          <StageFallbackStream
            format={format}
            stage={stage}
            stageLabel={stageLabel}
            projectId={projectId}
          />
        </div>
      );
    }
    if (format === "female_long") {
      return (
        <div className="stack">
          <FemaleLongDepthWorkbench projectId={projectId} />
          <FemaleLongWorkbench projectId={projectId} artifacts={artifacts} />
          <ChaseWifeWorkbench projectId={projectId} />
          <UnitSevenStepWorkbench projectId={projectId} />
          <StageFallbackStream
            format={format}
            stage={stage}
            stageLabel={stageLabel}
            projectId={projectId}
          />
        </div>
      );
    }
    if (format === "ip_adapt") {
      return (
        <div className="stack">
          <IpAdaptWorkbench projectId={projectId} />
          <StageFallbackStream
            format={format}
            stage={stage}
            stageLabel={stageLabel}
            projectId={projectId}
          />
        </div>
      );
    }
  }

  if (deliverable === "package") {
    const completion = deliverableCompletion(format, artifacts, synopsis);
    return (
      <div className="stack">

        <PackagePanel
          hasHook={completion.hasHook}
          hasBio={completion.hasCharacters}
          outlineCount={completion.outlineReadyCount}
          bodyCount={completion.bodyReadyCount}
          synopsis={synopsis}
          projectId={projectId}
          format={format}
          artifacts={artifacts}
          projectTitle={projectTitle}
        />
        {format === "duanju" && <OptionalMethod title="短剧投稿准备"><DuanjuCharlieOverview projectId={projectId} /></OptionalMethod>}
      </div>
    );
  }
  if (deliverable === "synopsis") {
    if (format === "short_novel") {
      return (
        <div className="stack">
          <SynopsisPanel key={projectId}
            value={synopsis}
            onChange={updateSynopsis}
            projectId={projectId}
            format={format}
          />
          <OptionalMethod title="扩写卖点与设计提示词">
          <CommercialOutlineWorkbench projectId={projectId} />
          <CoreHookDetailWorkbench projectId={projectId} artifacts={artifacts} />
          <PromptComposeWorkbench projectId={projectId} />
          </OptionalMethod>
        </div>
      );
    }
    return (
      <SynopsisPanel key={projectId}
        value={synopsis}
        onChange={updateSynopsis}
        projectId={projectId}
        format={format}
      />
    );
  }
  if (deliverable === "characters") {
    return (
      <CharacterBiblePanel artifacts={artifacts} projectId={projectId} format={format} />
    );
  }
  if (deliverable === "outline") {
    if (format === "female_long") {
      return (
        <div className="stack">
          <FemaleLongDepthWorkbench projectId={projectId} />
          <OptionalMethod title="情感线与单元结构">
          <FemaleLongWorkbench projectId={projectId} artifacts={artifacts} />
          <ChaseWifeWorkbench projectId={projectId} />
          <UnitSevenStepWorkbench projectId={projectId} />
          </OptionalMethod>
        </div>
      );
    }
    if (format === "short_novel") {
      return (
        <div className="stack">
          <ShortNovelLesson2Workspace projectId={projectId} artifacts={artifacts} />
          <OptionalMethod title="情节与节奏练习">
          <ShortNovelLesson3Workspace projectId={projectId} />
          </OptionalMethod>
        </div>
      );
    }
    if (format === "duanju") {
      return (
        <div className="stack">
          <BeatMapPanel projectId={projectId} format={format} artifacts={artifacts} />
          <DuanjuEp10Workbench
            projectId={projectId}
            artifacts={artifacts}
            stage="S4_EP10_DRAFT"
            stageLabel="十集大纲"
          />
          <OptionalMethod title="单元拆解与节拍练习">
          <DuanjuUnitWorkbench projectId={projectId} />
          <CourseExtraPanel projectId={projectId} group="duanju" />
          <Beat20Workbench projectId={projectId} />
          <UnitSevenStepWorkbench projectId={projectId} />
          </OptionalMethod>
        </div>
      );
    }
    if (format === "manju") {
      return (
        <div className="stack">
          <BeatMapPanel projectId={projectId} format={format} artifacts={artifacts} />
          {artifacts.some((a) => a.type === "episode_outline") ? (
            <OutlineDualView artifacts={artifacts} projectId={projectId} />
          ) : (
            <StructurePanel format={format} projectId={projectId} artifacts={artifacts} />
          )}
          <UnitSevenStepWorkbench projectId={projectId} />
          <KaolaRollingWorkbench projectId={projectId} />
          <ManjuAdvancedWorkbench projectId={projectId} />
        </div>
      );
    }
    return (
      <div className="stack">
        <BeatMapPanel projectId={projectId} format={format} artifacts={artifacts} />
        {artifacts.some((a) => a.type === "episode_outline") ? (
          <OutlineDualView artifacts={artifacts} projectId={projectId} />
        ) : (
          <StructurePanel format={format} projectId={projectId} artifacts={artifacts} />
        )}
      </div>
    );
  }
  if (deliverable === "manuscript") {
    return <ManuscriptStudio key={projectId} artifacts={artifacts} projectId={projectId} format={format} />;
  }
  if (deliverable === "qc") {
    if (format === "short_novel") {
      return <QcPriorityWorkbench projectId={projectId} />;
    }
    return <QcGatePanel projectId={projectId} format={format} />;
  }

  return (
    <Panel title={formatHint(format)}>
      <p className="muted">选择左侧交稿物继续。</p>
    </Panel>
  );
}

function formatHint(format: ProjectFormat) {
  switch (format) {
    case "duanju":
      return "短剧：选题冲突 · 单元结构 · 分场 · 钩子";
    case "short_novel":
      return "短篇：拆书 · 换元映射 · 章纲细纲 · 正文";
    case "male_long":
      return "男频中长篇：金手指 · 升级循环 · 打脸爽点 · 雷区";
    case "female_long":
      return "女频中长篇：卷纲 · 节奏报告 · 伏笔 · 付费点";
    case "ip_adapt":
      return "IP 改编：锚定表 · 单元故事 · 情绪量化 · 压缩";
    default:
      return "交稿物工作区";
  }
}

function StructurePanel({
  format,
  projectId,
  artifacts,
}: {
  format: ProjectFormat;
  projectId?: string;
  artifacts?: Artifact[];
}) {
  if (format === "short_novel") {
    return (
      <div className="stack">
        <ShortNovelLesson2Workspace projectId={projectId} artifacts={artifacts} />
        <ShortNovelLesson3Workspace projectId={projectId} />
        <Panel title="快捷 AI 助手">
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Button
              variant="primary"
              disabled={!projectId}
              onClick={() =>
                projectId && void runAgentFeedback(projectId, "swap.master", { label: "swap.master" })
              }
            >
              换元规划
            </Button>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "struct.chapter_cap", { label: "struct.chapter_cap" })
              }
            >
              章纲控长
            </Button>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "prose.short_opening", {
                  label: "prose.short_opening",
                })
              }
            >
              开篇吸引力
            </Button>
          </div>
        </Panel>
        <CourseExtraPanel projectId={projectId} group="structure" />
      </div>
    );
  }
  if (format === "male_long") {
    return (
      <div className="stack">
        <MaleLongEngineWorkbench projectId={projectId} />
        <CourseExtraPanel projectId={projectId} group="structure" />
      </div>
    );
  }
  if (format === "female_long") {
    return (
      <div className="stack">
        <FemaleLongDepthWorkbench projectId={projectId} />
        <FemaleLongWorkbench projectId={projectId} />
        <ChaseWifeWorkbench projectId={projectId} />
        <UnitSevenStepWorkbench projectId={projectId} />
        <CourseExtraPanel projectId={projectId} group="structure" />
        <Panel title="女频变现">
          <Button
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "female.monetize", { label: "female.monetize" })
            }
          >
            变现适配
          </Button>
        </Panel>
      </div>
    );
  }
  if (format === "ip_adapt") {
    return (
      <div className="stack">
        <IpAdaptWorkbench projectId={projectId} />
        <Panel title="单元故事表 · 改编减法助手">
          <p className="muted" style={{ fontSize: 12 }}>
            选书评分 → 单元切分 → 情绪量化 → 压缩重构；主线保留、支线合并。
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Button
              disabled={!projectId}
              onClick={() => projectId && void runAgentFeedback(projectId, "ip.select_score", { label: "ip.select_score" })}
            >
              IP 选书评分
            </Button>
            <Button
              variant="primary"
              disabled={!projectId}
              onClick={() => projectId && void runAgentFeedback(projectId, "ip.unit_cut", { label: "ip.unit_cut" })}
            >
              单元故事切分
            </Button>
            <Button
              disabled={!projectId}
              onClick={() => projectId && void runAgentFeedback(projectId, "ip.emotion_quant", { label: "ip.emotion_quant" })}
            >
              情绪量化
            </Button>
            <Button
              disabled={!projectId}
              onClick={() => projectId && void runAgentFeedback(projectId, "ip.rebuild", { label: "ip.rebuild" })}
            >
              压缩重构
            </Button>
          </div>
        </Panel>
        <StageFallbackStream
          format={format}
          stage="S2_UNIT_SPLIT"
          stageLabel="IP 单元生成流"
          projectId={projectId}
        />
      </div>
    );
  }
  return (
    <StageFallbackStream
      format={format}
      stage="S4_STRUCTURE"
      stageLabel="分场 / 分集结构"
      projectId={projectId}
    />
  );
}

function DuanjuEp10Workbench({
  projectId,
  artifacts,
  stage,
  stageLabel,
}: {
  projectId?: string;
  artifacts: Artifact[];
  stage: string;
  stageLabel: string;
}) {
  const stream = useAgentRun(projectId, "struct.ep_outline_duanju");
  const hasOutline = artifacts.some((a) => a.type === "episode_outline");
  const isAck = stage === "S4_EP10";

  return (
    <div className="stack">
      <Panel title={stageLabel || "十集大纲"}>
        <p className="muted">

          {isAck
            ? "人工确认爽点/卡点/集尾钩后进入场级正文"
            : "先生成表格大纲，再确认十集内容"}
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Button
            variant="primary"
            disabled={!projectId || stream.streaming}
            onClick={() => void stream.start()}
          >
            {stream.streaming ? "生成中…" : hasOutline ? "重跑十集大纲" : "生成十集大纲"}
          </Button>
          {projectId ? (
            <Button
              disabled={stream.streaming}
              onClick={() =>
                void runAgentFeedback(projectId, "qc.human_qc_duanju", { label: "qc.human_qc_duanju", inputJson: { stage: "ep10" },
                })
              }
            >
              人工质检清单
            </Button>
          ) : null}
        </div>
        {stream.error ? (
          <p className="muted" style={{ color: "var(--danger, #b4443c)" }}>
            {stream.error}
          </p>
        ) : null}
      </Panel>
      {hasOutline ? (
        <OutlineDualView artifacts={artifacts} projectId={projectId} />
      ) : (
        <StreamPanel
          text={stream.text}
          streaming={stream.streaming}
          onStart={() => void stream.start()}
          onAbort={stream.abort}
        />
      )}
    </div>
  );
}

