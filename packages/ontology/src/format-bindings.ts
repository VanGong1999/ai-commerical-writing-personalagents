import { ACTION_TYPES, OBJECT_TYPES } from "./catalog.ts";

const ALL_FORMATS = [
  "manju",
  "duanju",
  "short_novel",
  "male_long",
  "female_long",
  "ip_adapt",
] as const;

export type WritingFormat = (typeof ALL_FORMATS)[number];

/** 六格式共用的核心 Object Types */
const SHARED_OT = [
  "Project",
  "StageRun",
  "Character",
  "StoryGraph",
  "ForeshadowEntry",
  "GateCheck",
  "GenerationPolicy",
  "PromptCompose",
  "Scenario",
];

/** 格式专用 Object Types */
const FORMAT_OT: Record<WritingFormat, string[]> = {
  manju: [
    "CoreHook",
    "Logline",
    "ExpectationHook",
    "ConflictDesign",
    "CoolPoint",
    "EpisodeOutline",
    "EpisodeGraph",
    "Manuscript",
    "ManjuPipeline",
    "ManjuGenreTrack",
    "ManjuAdvanced",
    "PitchPack",
    "EmotionAnchor",
  ],
  duanju: ["Beat20", "SceneShot", "EpisodeOutline", "Manuscript", "StoryAnchor"],
  short_novel: [
    "DissectParams",
    "SwapImitate",
    "InspirationToStory",
    "MasterOutline",
    "Framework",
    "ChapterOutline",
    "BeatSheet",
    "CharacterDepth",
    "Manuscript",
  ],
  male_long: [
    "MaleLongEngine",
    "BookPack",
    "GoldFinger",
    "WorldSetting",
    "VolumeOutline",
    "ChapterOutline",
    "Manuscript",
  ],
  female_long: [
    "FemaleLongDepth",
    "SwapImitate",
    "ExpectationConflict",
    "VolumeOutline",
    "ChapterOutline",
    "Manuscript",
    "CharacterDepth",
  ],
  ip_adapt: ["IpAdapt", "IpAdaptPack", "DissectParams", "TopicCard", "Manuscript"],
};

export function objectTypesForFormat(format: WritingFormat): string[] {
  return [...new Set([...SHARED_OT, ...(FORMAT_OT[format] || [])])];
}

export function actionTypesForFormat(format: WritingFormat) {
  return ACTION_TYPES.filter((a) => !a.formats?.length || a.formats.includes(format));
}

export function formatBindingsSummary() {
  return ALL_FORMATS.map((format) => ({
    format,
    objectTypes: objectTypesForFormat(format),
    actionTypes: actionTypesForFormat(format).map((a) => a.apiName),
    objectTypeCount: objectTypesForFormat(format).length,
    actionTypeCount: actionTypesForFormat(format).length,
  }));
}

export function assertObjectTypeKnown(apiName: string): boolean {
  return OBJECT_TYPES.some((o) => o.apiName === apiName);
}

export { ALL_FORMATS };
