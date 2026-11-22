/**
 * Writing Ontology 完整类型目录（不可简化）。
 * sync-registry 会合并本目录 + 从 domain Schema 扫描的 Struct/ValueType。
 */

export type Kind =
  | "object_type"
  | "link_type"
  | "interface"
  | "value_type"
  | "struct"
  | "shared_property"
  | "action_type"
  | "function"
  | "view"
  | "backing_map";

export type CatalogEntry = {
  apiName: string;
  displayName: string;
  kind: Kind;
  schemaExport?: string;
  description?: string;
  implements?: string[];
  properties?: string[];
  fromType?: string;
  toType?: string;
  criteria?: string[];
  materializes?: string[];
  formats?: string[];
  parameters?: string[];
  sideEffects?: string[];
  artifactType?: string;
  memoryPath?: string;
  viewRenderer?: string;
};

/** Shared properties on all project-scoped objects */
export const SHARED_PROPERTIES: CatalogEntry[] = [
  { apiName: "projectId", displayName: "项目 ID", kind: "shared_property" },
  { apiName: "format", displayName: "格式", kind: "shared_property", schemaExport: "FormatSchema" },
  { apiName: "status", displayName: "状态", kind: "shared_property" },
  { apiName: "schemaVersion", displayName: "Schema 版本", kind: "shared_property" },
  { apiName: "contentHash", displayName: "内容哈希 CAS", kind: "shared_property" },
  { apiName: "adoptedAt", displayName: "采纳时间", kind: "shared_property" },
];

/** Interfaces（多态契约） */
export const INTERFACES: CatalogEntry[] = [
  {
    apiName: "HasPayoffStatus",
    displayName: "可兑现状态",
    kind: "interface",
    properties: ["status"],
    description: "ExpectationHook / ForeshadowEntry / StoryEdge(payoff)",
  },
  {
    apiName: "HasEpisodeSpan",
    displayName: "集跨度",
    kind: "interface",
    properties: ["episodeSpan", "episode", "episodeNo"],
  },
  {
    apiName: "AdoptedArtifactBacked",
    displayName: "Artifact 物化背书",
    kind: "interface",
    properties: ["backingArtifactId", "status"],
  },
  {
    apiName: "HumanAckable",
    displayName: "需人工确认",
    kind: "interface",
    properties: ["humanVerdict", "ackedAt", "ackedBy"],
  },
  {
    apiName: "GraphNodeLike",
    displayName: "图节点形态",
    kind: "interface",
    properties: ["id", "kind", "label"],
  },
  {
    apiName: "WorkflowStateful",
    displayName: "课内工作流态",
    kind: "interface",
    properties: ["currentStep", "completeness"],
  },
];

/** Primary Object Types（升格为一等公民；其余 Schema 作为 Struct） */
export const OBJECT_TYPES: CatalogEntry[] = [
  { apiName: "Project", displayName: "项目", kind: "object_type", schemaExport: "ProjectSchema", artifactType: undefined },
  { apiName: "StageRun", displayName: "阶段运行", kind: "object_type", implements: ["HumanAckable"] },
  { apiName: "Inspiration", displayName: "灵感", kind: "object_type", schemaExport: "InspirationClassifyItemSchema", artifactType: "other" },
  { apiName: "MasterOutline", displayName: "总纲", kind: "object_type", schemaExport: "MasterOutlineBodySchema", artifactType: "master_outline", implements: ["AdoptedArtifactBacked"] },
  { apiName: "Framework", displayName: "框架", kind: "object_type", schemaExport: "FrameworkBodySchema", artifactType: "framework", implements: ["AdoptedArtifactBacked"] },
  { apiName: "VolumeOutline", displayName: "卷纲", kind: "object_type", artifactType: "volume_outline", implements: ["AdoptedArtifactBacked"] },
  { apiName: "ChapterOutline", displayName: "章纲", kind: "object_type", schemaExport: "ChapterOutlineItemSchema", artifactType: "chapter_outline", implements: ["AdoptedArtifactBacked"] },
  { apiName: "BeatSheet", displayName: "细纲", kind: "object_type", schemaExport: "BeatSheetItemSchema", artifactType: "beat_sheet", implements: ["AdoptedArtifactBacked"] },
  { apiName: "UnitStory", displayName: "单元故事", kind: "object_type", schemaExport: "UnitStoryBodySchema", implements: ["HasEpisodeSpan"] },
  { apiName: "CoreHook", displayName: "核心梗", kind: "object_type", schemaExport: "CoreHookFullBodySchema", artifactType: "core_hook", implements: ["AdoptedArtifactBacked", "HumanAckable"] },
  { apiName: "GoldFinger", displayName: "金手指", kind: "object_type", artifactType: "gold_finger_cap", implements: ["AdoptedArtifactBacked"] },
  { apiName: "WorldSetting", displayName: "世界观设定", kind: "object_type", artifactType: "world_setting", implements: ["AdoptedArtifactBacked"] },
  { apiName: "ExpectationHook", displayName: "期待钩子", kind: "object_type", schemaExport: "ExpectationHookUnitSchema", implements: ["HasPayoffStatus", "HasEpisodeSpan"] },
  { apiName: "ConflictDesign", displayName: "冲突设计", kind: "object_type", schemaExport: "ConflictDesignSchema" },
  { apiName: "CoolPoint", displayName: "爽点", kind: "object_type", schemaExport: "CoolPointFourStepSchema", implements: ["HasEpisodeSpan"] },
  { apiName: "EmotionAnchor", displayName: "情绪锚点", kind: "object_type", schemaExport: "EmotionAnchorSchema" },
  { apiName: "Character", displayName: "角色", kind: "object_type", schemaExport: "CharacterSheetSevenSchema", artifactType: "character", implements: ["AdoptedArtifactBacked"] },
  { apiName: "CharacterRelation", displayName: "人物关系边", kind: "object_type", artifactType: "character_graph" },
  { apiName: "EpisodeOutline", displayName: "分集大纲", kind: "object_type", artifactType: "episode_outline", implements: ["AdoptedArtifactBacked", "HumanAckable", "HasEpisodeSpan"] },
  { apiName: "Manuscript", displayName: "正文/剧本", kind: "object_type", artifactType: "manuscript", implements: ["AdoptedArtifactBacked", "HasEpisodeSpan"] },
  { apiName: "SceneShot", displayName: "场次镜头", kind: "object_type", artifactType: "scene", implements: ["HasEpisodeSpan"] },
  { apiName: "StoryAnchor", displayName: "剧情锚点", kind: "object_type", implements: ["HasEpisodeSpan"] },
  { apiName: "ForeshadowEntry", displayName: "伏笔条目", kind: "object_type", schemaExport: "ForeshadowEntrySchema", artifactType: "foreshadow_ledger", implements: ["HasPayoffStatus", "HasEpisodeSpan"] },
  { apiName: "StoryNode", displayName: "连续性图节点", kind: "object_type", schemaExport: "StoryNodeSchema", implements: ["GraphNodeLike", "HasEpisodeSpan"] },
  { apiName: "StoryEdge", displayName: "连续性图边", kind: "object_type", schemaExport: "StoryEdgeSchema", implements: ["HasPayoffStatus", "HasEpisodeSpan"] },
  { apiName: "CharacterState", displayName: "角色状态快照", kind: "object_type", schemaExport: "CharacterStateSnapshotSchema", implements: ["HasEpisodeSpan"] },
  { apiName: "StoryGraph", displayName: "全剧连续性图", kind: "object_type", schemaExport: "StoryGraphBodySchema", artifactType: "story_graph", implements: ["AdoptedArtifactBacked"], memoryPath: "bible/story_graph.md" },
  { apiName: "EpisodeGraph", displayName: "分集连续性图", kind: "object_type", schemaExport: "StoryGraphBodySchema", artifactType: "episode_graph", implements: ["AdoptedArtifactBacked", "HasEpisodeSpan"] },
  { apiName: "PitchPack", displayName: "投稿包", kind: "object_type", artifactType: "other", implements: ["AdoptedArtifactBacked", "HumanAckable"] },
  { apiName: "TopicCard", displayName: "选题卡", kind: "object_type", schemaExport: "TopicFormulaCardSchema", artifactType: "topic_card", implements: ["AdoptedArtifactBacked"] },
  { apiName: "IpAdaptPack", displayName: "IP改编包", kind: "object_type", artifactType: "select_score", implements: ["AdoptedArtifactBacked"] },
  { apiName: "GateCheck", displayName: "门禁结果", kind: "object_type" },
  { apiName: "GenerationPolicy", displayName: "生成控长策略", kind: "object_type", schemaExport: "GenerationPolicySchema" },
  { apiName: "PromptCompose", displayName: "提示词组装", kind: "object_type", schemaExport: "PromptComposeSchema" },
  { apiName: "DissectParams", displayName: "拆书参数", kind: "object_type", schemaExport: "DissectParamsBodySchema", artifactType: "dissect_params", implements: ["AdoptedArtifactBacked", "WorkflowStateful"] },
  { apiName: "SwapImitate", displayName: "换元仿写态", kind: "object_type", schemaExport: "SwapImitateWorkflowSchema", artifactType: "swap_plan", implements: ["AdoptedArtifactBacked", "WorkflowStateful"] },
  { apiName: "ExpectationConflict", displayName: "期待冲突工作流", kind: "object_type", schemaExport: "ExpectationConflictWorkflowSchema", artifactType: "expectation_conflict", implements: ["AdoptedArtifactBacked", "WorkflowStateful"] },
  { apiName: "ManjuPipeline", displayName: "漫剧管线态", kind: "object_type", schemaExport: "ManjuPipelineWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "CharacterDepth", displayName: "人物深度态", kind: "object_type", schemaExport: "CharacterDepthWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "FemaleLongDepth", displayName: "女频长篇深度态", kind: "object_type", schemaExport: "FemaleLongDepthWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "MaleLongEngine", displayName: "男频长篇引擎态", kind: "object_type", schemaExport: "MaleLongEngineWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "EmotionRhythm", displayName: "情绪节奏工作流", kind: "object_type", schemaExport: "EmotionRhythmWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "CoolFaceSlap", displayName: "爽点打脸工作流", kind: "object_type", schemaExport: "CoolFaceSlapWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "InspirationToStory", displayName: "灵感到故事", kind: "object_type", schemaExport: "InspirationToStoryWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "TopicSelection", displayName: "选题工作流", kind: "object_type", schemaExport: "TopicSelectionWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "ManjuGenreTrack", displayName: "漫剧题材轨", kind: "object_type", schemaExport: "ManjuGenreTrackWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "IpAdapt", displayName: "IP改编工作流", kind: "object_type", schemaExport: "IpAdaptWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "ManjuAdvanced", displayName: "漫剧进阶", kind: "object_type", schemaExport: "ManjuAdvancedWorkflowSchema", implements: ["WorkflowStateful"] },
  { apiName: "Logline", displayName: "一句话梗概", kind: "object_type", artifactType: "logline", implements: ["AdoptedArtifactBacked", "HumanAckable"] },
  { apiName: "BookPack", displayName: "开书包", kind: "object_type", artifactType: "book_pack", implements: ["AdoptedArtifactBacked"] },
  { apiName: "Beat20", displayName: "二十节拍", kind: "object_type", artifactType: "beat20", implements: ["AdoptedArtifactBacked"] },
  { apiName: "Scenario", displayName: "临时情景分支", kind: "object_type", description: "Palantir Scenario：试大纲/结局副本" },
  { apiName: "KbGraphSnapshot", displayName: "知识库图谱快照", kind: "object_type", description: "只读 Object Set，映射 GraphSnapshot" },
];

export const LINK_TYPES: CatalogEntry[] = [
  { apiName: "owns", displayName: "拥有", kind: "link_type", fromType: "Project", toType: "*" },
  { apiName: "contains", displayName: "包含", kind: "link_type", fromType: "*", toType: "*" },
  { apiName: "appearsIn", displayName: "出场于", kind: "link_type", fromType: "Character", toType: "EpisodeOutline|Manuscript|StoryNode" },
  { apiName: "relatedTo", displayName: "人物关系", kind: "link_type", fromType: "Character", toType: "Character" },
  { apiName: "causes", displayName: "导致", kind: "link_type", fromType: "StoryNode", toType: "StoryNode" },
  { apiName: "enables", displayName: "促成", kind: "link_type", fromType: "StoryNode", toType: "StoryNode" },
  { apiName: "blocks", displayName: "阻碍", kind: "link_type", fromType: "StoryNode", toType: "StoryNode" },
  { apiName: "foreshadows", displayName: "伏笔", kind: "link_type", fromType: "StoryNode", toType: "StoryNode" },
  { apiName: "payoff", displayName: "兑现", kind: "link_type", fromType: "StoryNode|ExpectationHook|ForeshadowEntry", toType: "StoryNode|CoolPoint|StoryAnchor" },
  { apiName: "knows", displayName: "知晓", kind: "link_type", fromType: "Character|StoryNode", toType: "StoryNode" },
  { apiName: "objectOwns", displayName: "持有物", kind: "link_type", fromType: "Character|StoryNode", toType: "StoryNode" },
  { apiName: "located", displayName: "位于", kind: "link_type", fromType: "Character|StoryNode", toType: "StoryNode" },
  { apiName: "paidBy", displayName: "被兑现于", kind: "link_type", fromType: "ExpectationHook|ForeshadowEntry", toType: "CoolPoint|StoryAnchor|Manuscript" },
  { apiName: "plantedIn", displayName: "埋于", kind: "link_type", fromType: "ForeshadowEntry", toType: "EpisodeOutline" },
  { apiName: "derivedFrom", displayName: "换元派生", kind: "link_type", fromType: "*", toType: "*", description: "六元素原→新" },
  { apiName: "instantiates", displayName: "实例化", kind: "link_type", fromType: "CoreHook", toType: "*" },
  { apiName: "advancesTo", displayName: "推进至", kind: "link_type", fromType: "StageRun", toType: "StageRun" },
  { apiName: "aggregates", displayName: "汇入", kind: "link_type", fromType: "StoryGraph", toType: "EpisodeGraph" },
  { apiName: "pairsWith", displayName: "配对", kind: "link_type", fromType: "ExpectationHook", toType: "ConflictDesign" },
  { apiName: "scenarioForkOf", displayName: "情景分叉自", kind: "link_type", fromType: "Scenario", toType: "*" },
];

export const ACTION_TYPES: CatalogEntry[] = [
  { apiName: "CreateProject", displayName: "创建项目", kind: "action_type", parameters: ["title", "format", "startFrom?"], sideEffects: ["create Project"], criteria: [], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "GenerateCoreHookBatch", displayName: "批量生成核心梗", kind: "action_type", criteria: ["ChunkPolicy"], materializes: ["CoreHook"], formats: ["manju", "short_novel"] },
  { apiName: "CritiqueCoreHook", displayName: "评审核心梗", kind: "action_type", criteria: ["CoreHookComplete"], formats: ["manju"] },
  { apiName: "AdoptObject", displayName: "采纳对象", kind: "action_type", parameters: ["rid", "mode", "expectedHash?"], criteria: ["CoreHookAdoption"], sideEffects: ["materialize Artifact", "ActionLog"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "AckStage", displayName: "确认阶段", kind: "action_type", criteria: ["HumanConfirm", "StageLock"], sideEffects: ["StageRun"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "AdvanceStage", displayName: "推进阶段", kind: "action_type", criteria: ["StageLock"], sideEffects: ["StageRun", "ActionLog"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "ForceJump", displayName: "强制跳阶段", kind: "action_type", criteria: [], sideEffects: ["forceJumps audit"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "LogicAck", displayName: "逻辑人工终审", kind: "action_type", criteria: ["LogicAck"], sideEffects: ["ActionLog"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "RunGateBattery", displayName: "跑门禁组", kind: "action_type", criteria: [], sideEffects: ["GateCheck objects"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "DissectSource", displayName: "拆书", kind: "action_type", criteria: ["dissectParamsCompleteness"], materializes: ["DissectParams"], formats: ["short_novel", "ip_adapt"] },
  { apiName: "SwapImitate", displayName: "换元仿写", kind: "action_type", criteria: ["swapImitateCompleteness"], materializes: ["SwapImitate"], formats: ["short_novel", "female_long"] },
  { apiName: "FourSwapThree", displayName: "四换三", kind: "action_type", criteria: ["validateFemaleFourSwapThree"], formats: ["female_long"] },
  { apiName: "ComposeExpectationConflict", displayName: "期待冲突设计", kind: "action_type", criteria: ["expectationConflictWorkflowCompleteness"], materializes: ["ExpectationConflict", "ExpectationHook", "ConflictDesign"], formats: ["manju", "short_novel", "female_long"] },
  { apiName: "UpsertCharacterDepth", displayName: "人物深度写入", kind: "action_type", criteria: ["characterDepthWorkflowCompleteness"], materializes: ["Character"], formats: ["manju", "short_novel", "female_long", "male_long"] },
  { apiName: "SyncRelationNet", displayName: "同步关系网", kind: "action_type", materializes: ["CharacterRelation"], formats: ["manju", "female_long", "male_long"] },
  { apiName: "GenerateEpOutline", displayName: "生成分集大纲", kind: "action_type", criteria: ["validateEpisodeOutlineHandbookRow"], materializes: ["EpisodeOutline"], formats: ["manju", "duanju"] },
  { apiName: "AcceptEpisodeRow", displayName: "接受分集行", kind: "action_type", criteria: ["HumanConfirm"], formats: ["manju"] },
  { apiName: "UpsertStoryGraph", displayName: "写入全剧图", kind: "action_type", criteria: ["GraphConsistency"], materializes: ["StoryGraph", "mermaid", "bible"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long"] },
  { apiName: "MergeEpisodeGraph", displayName: "合并分集图", kind: "action_type", criteria: ["GraphConsistency"], materializes: ["StoryGraph", "EpisodeGraph"], formats: ["manju", "duanju"] },
  { apiName: "UpsertForeshadow", displayName: "更新伏笔台账", kind: "action_type", criteria: ["GraphConsistency"], materializes: ["ForeshadowEntry"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long"] },
  { apiName: "WriteEpisodeBodyBatch", displayName: "批量写正文", kind: "action_type", criteria: ["LengthBand", "LengthDecay", "ChunkPolicy"], materializes: ["Manuscript"], formats: ["manju", "duanju"] },
  { apiName: "Storyboard", displayName: "分镜", kind: "action_type", formats: ["manju"] },
  { apiName: "DialoguePressure", displayName: "台词加压", kind: "action_type", criteria: ["DialogueLen"], formats: ["manju", "duanju"] },
  { apiName: "DeAI", displayName: "去AI味", kind: "action_type", criteria: ["DeAIChecklist"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long"] },
  { apiName: "ExtendOutline", displayName: "扩展大纲", kind: "action_type", formats: ["manju"] },
  { apiName: "BuildPitchPack", displayName: "组投稿包", kind: "action_type", criteria: ["PitchFourPack", "PitchCompleteness"], materializes: ["PitchPack"], formats: ["manju"] },
  { apiName: "RollbackObjectVersion", displayName: "回滚对象版本", kind: "action_type", sideEffects: ["restore version"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "MemoryCASWrite", displayName: "记忆CAS写入", kind: "action_type", parameters: ["path", "expectedHash", "content"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "DreamMerge", displayName: "Dreaming合入", kind: "action_type", criteria: ["HumanConfirm"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "PushKbToProject", displayName: "知识库推入项目", kind: "action_type", materializes: ["DissectParams", "CoreHook"], formats: ["manju", "short_novel", "ip_adapt"] },
  { apiName: "MarkPayoffPaid", displayName: "标记兑现", kind: "action_type", criteria: ["HasPayoffStatus"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long"] },
  { apiName: "CreateScenario", displayName: "创建情景分支", kind: "action_type", materializes: ["Scenario"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "UpdateScenario", displayName: "修改情景分支", kind: "action_type", formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "MergeScenario", displayName: "合并情景分支", kind: "action_type", criteria: ["HumanConfirm", "GraphConsistency"], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "LinkExpectationToGraph", displayName: "期待/冲突/爽点挂图", kind: "action_type", criteria: ["GraphConsistency"], materializes: ["StoryEdge"], formats: ["manju"] },
  { apiName: "ProposeObjectEdits", displayName: "LLM提案对象编辑", kind: "action_type", description: "仅提案；须再经具体写 Action 执行", formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
  { apiName: "UpsertObject", displayName: "通用对象写入", kind: "action_type", parameters: ["typeApiName", "properties", "rid?"], sideEffects: ["materialize Artifact"], criteria: [], formats: ["manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt"] },
];

export const FUNCTIONS: CatalogEntry[] = [
  { apiName: "objectSet", displayName: "对象集合查询", kind: "function", parameters: ["typeApiName", "projectId", "filter?"] },
  { apiName: "searchAround", displayName: "邻域展开", kind: "function", parameters: ["rid", "linkTypes?", "depth?"] },
  { apiName: "sliceForBible", displayName: "圣经切片", kind: "function", parameters: ["projectId", "currentEp?", "recentEps?"] },
  { apiName: "openPayoffs", displayName: "开放兑现", kind: "function", parameters: ["projectId"] },
  { apiName: "overdueForeshadows", displayName: "逾期伏笔", kind: "function", parameters: ["projectId", "currentEp"] },
  { apiName: "mergeEpisodeIntoStory", displayName: "合并分集到全剧", kind: "function" },
  { apiName: "storyGraphToMermaid", displayName: "图转Mermaid", kind: "function" },
  { apiName: "validateStoryGraphConsistency", displayName: "图一致性", kind: "function" },
  { apiName: "contentHash", displayName: "内容哈希", kind: "function" },
  { apiName: "renderObjectView", displayName: "渲染对象视图", kind: "function", parameters: ["viewApiName", "rid|projectId"] },
  { apiName: "listMappedArtifactTypes", displayName: "已映射Artifact类型", kind: "function" },
  { apiName: "completenessFor", displayName: "完备度函数分发", kind: "function", parameters: ["workflowApiName", "body"] },
];

export const VIEWS: CatalogEntry[] = [
  { apiName: "StoryContinuity", displayName: "剧情连续性", kind: "view", viewRenderer: "mermaid", description: "JSON 真相 → Mermaid" },
  { apiName: "CharacterSheet", displayName: "人设卡", kind: "view" },
  { apiName: "EpisodeCard", displayName: "分集卡", kind: "view" },
  { apiName: "CoreHookCard", displayName: "核心梗卡", kind: "view" },
  { apiName: "ExpectationBoard", displayName: "期待看板", kind: "view" },
  { apiName: "ObjectExplorer", displayName: "对象浏览器", kind: "view" },
  { apiName: "ActionAudit", displayName: "Action审计", kind: "view" },
  { apiName: "ScenarioCompare", displayName: "情景对比", kind: "view" },
];

/** Artifact types that MUST go through Ontology Action after cutover */
export const ACTION_ONLY_ARTIFACT_TYPES = [
  "core_hook",
  "character",
  "episode_outline",
  "story_graph",
  "episode_graph",
  "foreshadow_ledger",
  "expectation_conflict",
  "manuscript",
  "master_outline",
  "framework",
  "character_graph",
] as const;
