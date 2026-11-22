import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 功能开关定义（与后端 /settings/app 的 feature_toggles 对齐）。 */
export const FEATURE_TOGGLES: {
  id: string;
  label: string;
  desc: string;
}[] = [
  { id: "qcDeAi", label: "去 AI 味质检", desc: "正文后自动跑去 AI 味检查与改写建议" },
  { id: "logicScan", label: "逻辑扫描", desc: "对照剧情连续性图扫描前后逻辑冲突" },
  { id: "revise20", label: "修改20体检", desc: "短剧「修改20」体检（场景/钩子/台词）" },
  { id: "coolDensity", label: "爽点密度质检", desc: "男频爽点密度与节奏体检" },
  { id: "pacePaywall", label: "节奏/付费点体检", desc: "女频节奏与付费点卡点体检" },
  { id: "storyGraphAutoUpdate", label: "连续性图自动更新", desc: "每集写完后自动把本集节点并入全剧图" },
  { id: "foreshadowAutoUpdate", label: "伏笔台账自动更新", desc: "自动登记/回收伏笔与钩子" },
];

export function useFeatureToggles(): Record<string, boolean> {
  const { data } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => api.getAppSettings(),
    staleTime: 30_000,
  });
  return data?.featureToggles ?? {};
}

/** 默认开启；未出现在设置里视为开启。 */
export function isFeatureOn(toggles: Record<string, boolean>, id: string): boolean {
  return toggles[id] !== false;
}
