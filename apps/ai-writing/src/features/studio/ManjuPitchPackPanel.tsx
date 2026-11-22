/**
 * 手册第五节：剧本信息 / 故事大纲 / 人物小传可编辑台。
 */
import {
  PitchPackBodySchema,
  summarizePitchPackToMaster,
  validatePitchPackBody,
  type MasterOutlineBody,
  type PitchPackBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel } from "@xiezuomanju/ui";
import { useMemo } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function PitchPackWorkbench({ projectId }: { projectId?: string }) {
  const [pack, setPack] = usePersistedState<PitchPackBody>(
    projectId,
    "manju-pitch-pack",
    PitchPackBodySchema.parse({}),
  );
  const gate = useMemo(() => validatePitchPackBody(pack), [pack]);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const thin = summarizePitchPackToMaster(pack);
      const key = `deep:${projectId}:master-outline`;
      const prev = localStorage.getItem(key);
      const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
      localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel
      title="投稿三块（手册第五节）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={gate.ok ? "ok" : "warn"}>{gate.message}</Badge>
          <Button size="sm" onClick={syncThin}>
            回写摘要
          </Button>
          <Button
            size="sm"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "deliver.pitch_pack", {
                label: "deliver.pitch_pack",
                inputJson: { pitchPack: pack },
              })
            }
          >
            生成四件套
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        （一）剧本信息 （二）故事大纲 （三）人物小传。与 artifact 四件套计数并存。
      </p>
      <div className="field-grid">
        <label className="field">
          <span>片名</span>
          <input
            className="input"
            value={pack.scriptInfo.title}
            onChange={(e) =>
              setPack((s) => ({
                ...s,
                scriptInfo: { ...s.scriptInfo, title: e.target.value },
              }))
            }
          />
        </label>
        <label className="field">
          <span>集数预估</span>
          <input
            className="input"
            type="number"
            value={pack.scriptInfo.episodeEstimate}
            onChange={(e) =>
              setPack((s) => ({
                ...s,
                scriptInfo: {
                  ...s.scriptInfo,
                  episodeEstimate: Number(e.target.value) || 100,
                },
              }))
            }
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>类型标签（顿号分隔）</span>
          <input
            className="input"
            value={pack.scriptInfo.genreTags.join("、")}
            onChange={(e) =>
              setPack((s) => ({
                ...s,
                scriptInfo: {
                  ...s.scriptInfo,
                  genreTags: e.target.value
                    .split(/[、,，]/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
              }))
            }
          />
        </label>
        <label className="field">
          <span>受众</span>
          <input
            className="input"
            value={pack.scriptInfo.audience}
            onChange={(e) =>
              setPack((s) => ({
                ...s,
                scriptInfo: { ...s.scriptInfo, audience: e.target.value },
              }))
            }
          />
        </label>
        <label className="field">
          <span>卖点一句</span>
          <input
            className="input"
            value={pack.scriptInfo.sellingPoint}
            onChange={(e) =>
              setPack((s) => ({
                ...s,
                scriptInfo: { ...s.scriptInfo, sellingPoint: e.target.value },
              }))
            }
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>改编对标</span>
          <input
            className="input"
            value={pack.scriptInfo.adaptBenchmark}
            placeholder="番茄男频 / 起点…"
            onChange={(e) =>
              setPack((s) => ({
                ...s,
                scriptInfo: { ...s.scriptInfo, adaptBenchmark: e.target.value },
              }))
            }
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>故事大纲（≥200）</span>
          <textarea
            className="textarea"
            rows={5}
            value={pack.storyOutline}
            onChange={(e) => setPack((s) => ({ ...s, storyOutline: e.target.value }))}
          />
        </label>
      </div>
      <div className="row" style={{ margin: "8px 0", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>人物小传</strong>
        <Button
          size="sm"
          onClick={() =>
            setPack((s) => ({
              ...s,
              characterBios: [
                ...s.characterBios,
                {
                  id: `bio-${Date.now()}`,
                  name: "",
                  identity: "",
                  personality: "",
                  motivation: "",
                  relationToProtagonist: "",
                },
              ],
            }))
          }
        >
          加角色
        </Button>
      </div>
      {pack.characterBios.map((bio, i) => (
        <div key={bio.id} className="field-grid" style={{ marginBottom: 8 }}>
          {(
            [
              ["name", "姓名"],
              ["identity", "身份"],
              ["personality", "性格"],
              ["motivation", "动机"],
              ["relationToProtagonist", "与主角关系"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field" style={{ gridColumn: k === "motivation" || k === "relationToProtagonist" ? "1 / -1" : undefined }}>
              <span>{l}</span>
              <input
                className="input"
                value={bio[k]}
                onChange={(e) => {
                  const characterBios = [...pack.characterBios];
                  characterBios[i] = { ...bio, [k]: e.target.value };
                  setPack((s) => ({ ...s, characterBios }));
                }}
              />
            </label>
          ))}
        </div>
      ))}
    </Panel>
  );
}
