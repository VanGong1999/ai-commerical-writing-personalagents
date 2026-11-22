/**
 * 查理短剧课中间态：产品锁 / 选题壳 / GenderPath / bridge8·一加一 / 场三件套 / 修改20 / 拉片。
 * 挂 DuanjuStage；≠ 漫剧手册 SOP；bridge8 ≠ L17 TropeDrill。
 */
import {
  CHARLIE_BRIDGE8,
  CHARLIE_COOL5,
  CHARLIE_LAPIAN_DIMS,
  CHARLIE_OPENING7,
  CHARLIE_STORY_SHELLS,
  DuanjuCharlieOpsSchema,
  duanjuCharlieOpsCompleteness,
  summarizeDuanjuCharlieToMaster,
  validateBridge8Coverage,
  validateProductLock,
  validateRevise20,
  validateSceneTripleRow,
  validateTopicFormula,
  type DuanjuCharlieOps,
  type MasterOutlineBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function useDuanjuCharlieOps(projectId?: string) {
  const [ops, setOps] = usePersistedState(
    projectId,
    "duanju-charlie-ops",
    DuanjuCharlieOpsSchema.parse({}),
  );
  useEffect(() => {
    setOps((s) => DuanjuCharlieOpsSchema.parse(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  return [ops, setOps] as const;
}

function syncCharlieThin(projectId: string | undefined, ops: DuanjuCharlieOps) {
  if (!projectId) return;
  try {
    const thin = summarizeDuanjuCharlieToMaster(ops);
    const key = `deep:${projectId}:master-outline`;
    const prev = localStorage.getItem(key);
    const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
    localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
  } catch {
    /* ignore */
  }
}

export function DuanjuCharlieOverview({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const score = useMemo(() => duanjuCharlieOpsCompleteness(ops), [ops]);
  return (
    <Panel
      title="查理短剧 Ops 总览"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={() => syncCharlieThin(projectId, ops)}>
            回写摘要
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        解压&gt;审美&gt;故事；对齐 DuanjuStage。缺：{score.missing.join("、") || "无"}
      </p>
      <label className="field">
        <span>备注</span>
        <textarea
          className="textarea"
          rows={2}
          value={ops.notes}
          onChange={(e) => setOps((s) => ({ ...s, notes: e.target.value }))}
        />
      </label>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={ops.comedyDoseAck}
          onChange={(e) => setOps((s) => ({ ...s, comedyDoseAck: e.target.checked }))}
        />
        <span style={{ fontSize: 12 }}>喜剧剂量已注意（6.5）</span>
      </label>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={ops.unitArcNoted}
          onChange={(e) => setOps((s) => ({ ...s, unitArcNoted: e.target.checked }))}
        />
        <span style={{ fontSize: 12 }}>章回体/单元弧已记（6.6）</span>
      </label>
    </Panel>
  );
}

export function ProductLockPanel({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const p = ops.productLock;
  const g = validateProductLock(p);
  return (
    <Panel title="产品锁（查理 1.x）" actions={<Badge tone={g.ok ? "ok" : "warn"}>{g.message}</Badge>}>
      <p className="muted" style={{ fontSize: 12 }}>
        需求序：解压 &gt; 审美 &gt; 故事。三原则：解压 · 强代入 · 强粘度。
      </p>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={p.demandOrderAck}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              productLock: { ...s.productLock, demandOrderAck: e.target.checked },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>已确认需求序</span>
      </label>
      {(
        [
          ["decompress", "解压"],
          ["immersion", "强代入"],
          ["viscosity", "强粘度"],
        ] as const
      ).map(([k, l]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={p[k]}
            onChange={(e) =>
              setOps((s) => ({
                ...s,
                productLock: { ...s.productLock, [k]: e.target.checked },
              }))
            }
          />
          <span style={{ fontSize: 12 }}>{l}</span>
        </label>
      ))}
      <label className="field">
        <span>付费心理一句</span>
        <input
          className="input"
          value={p.payPsychology}
          placeholder="充值=To C 预期管理…"
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              productLock: { ...s.productLock, payPsychology: e.target.value },
            }))
          }
        />
      </label>
      <Button
        size="sm"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "biz.product_align", {
            label: "biz.product_align",
            inputJson: { productLock: p },
          })
        }
      >
        产品对齐 Agent
      </Button>
    </Panel>
  );
}

export function WantHowShellPanel({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const t = ops.topicFormula;
  const g = validateTopicFormula(t);
  return (
    <Panel title="选题公式（想怎样+通过啥+壳）" actions={<Badge tone={g.ok ? "ok" : "warn"}>{g.message}</Badge>}>
      <label className="field">
        <span>想怎样</span>
        <input
          className="input"
          value={t.wantHow}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              topicFormula: { ...s.topicFormula, wantHow: e.target.value },
            }))
          }
        />
      </label>
      <label className="field">
        <span>通过啥（金手指极简）</span>
        <input
          className="input"
          value={t.viaWhat}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              topicFormula: { ...s.topicFormula, viaWhat: e.target.value },
            }))
          }
        />
      </label>
      <strong style={{ fontSize: 12 }}>五爽点</strong>
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {CHARLIE_COOL5.map((c) => {
          const on = t.cool5Ids.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className="badge"
              title={c.tip}
              style={on ? { borderColor: "var(--accent)" } : undefined}
              onClick={() =>
                setOps((s) => ({
                  ...s,
                  topicFormula: {
                    ...s.topicFormula,
                    cool5Ids: on
                      ? s.topicFormula.cool5Ids.filter((x) => x !== c.id)
                      : [...s.topicFormula.cool5Ids, c.id],
                  },
                }))
              }
            >
              {c.id}
            </button>
          );
        })}
      </div>
      <label className="field">
        <span>故事壳</span>
        <Select
          className="select"
          value={t.shell}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              topicFormula: { ...s.topicFormula, shell: e.target.value },
            }))
          }
        >
          <option value="">未选</option>
          {CHARLIE_STORY_SHELLS.map((sh) => (
            <option key={sh.id} value={sh.id} disabled={!sh.allowed}>
              {sh.id}
              {!sh.allowed ? "（禁主壳）" : ""} — {sh.tip}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>账号档</span>
        <Select
          className="select"
          value={t.accountTier}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              topicFormula: {
                ...s.topicFormula,
                accountTier: e.target.value as typeof t.accountTier,
              },
            }))
          }
        >
          <option value="unknown">未定</option>
          <option value="full">满级号（创意目标）</option>
          <option value="small">小号（开挂三型优先）</option>
        </Select>
      </label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button
          size="sm"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "topic.want_how", {
              label: "topic.want_how",
              inputJson: { ...t },
            })
          }
        >
          want_how
        </Button>
        <Button
          size="sm"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "topic.story_shell", {
              label: "topic.story_shell",
              inputJson: { shell: t.shell },
            })
          }
        >
          story_shell
        </Button>
        <Button
          size="sm"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "topic.cool_point_5", {
              label: "topic.cool_point_5",
              inputJson: { cool5Ids: t.cool5Ids },
            })
          }
        >
          五爽点卡
        </Button>
      </div>
    </Panel>
  );
}

export function GenderPathPanel({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const g = ops.genderPath;
  return (
    <Panel title="GenderPath（男女办事路径）">
      <p className="muted" style={{ fontSize: 12 }}>
        男频偏自己动手；女频偏借势获爱。≠ 漫剧男女频题材池。
      </p>
      <label className="field">
        <span>频别</span>
        <Select
          className="select"
          value={g.band}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              genderPath: {
                ...s.genderPath,
                band: e.target.value as typeof g.band,
              },
            }))
          }
        >
          <option value="unset">未定</option>
          <option value="male">男频</option>
          <option value="female">女频</option>
        </Select>
      </label>
      <label className="field">
        <span>路径备注</span>
        <textarea
          className="textarea"
          rows={2}
          value={g.pathNote}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              genderPath: { ...s.genderPath, pathNote: e.target.value },
            }))
          }
        />
      </label>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={g.pathAck}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              genderPath: { ...s.genderPath, pathAck: e.target.checked },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>路径已自检</span>
      </label>
      <Button
        size="sm"
        disabled={!projectId || g.band === "unset"}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "qc.gender_path", {
            label: "qc.gender_path",
            inputJson: { gender_band: g.band, pathNote: g.pathNote },
          })
        }
      >
        GenderPath 审计
      </Button>
    </Panel>
  );
}

export function Bridge8OnePlusPanel({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const b8 = validateBridge8Coverage(ops.bridge8Coverage);
  return (
    <Panel
      title="八桥段 + 一加一 + 悬念预算"
      actions={<Badge tone={b8.ok ? "ok" : "warn"}>{b8.message}</Badge>}
    >
      <p className="muted" style={{ fontSize: 11 }}>
        bridge8 ≠ L17 TropeDrill；≠ 漫剧 Kartian。
      </p>
      {ops.bridge8Coverage.map((row, i) => (
        <div key={row.id} className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          <span style={{ fontSize: 12, width: 48 }} title={CHARLIE_BRIDGE8[i]?.tip}>
            {row.id}
          </span>
          <input
            className="input"
            style={{ flex: 1, minWidth: 120 }}
            placeholder="落脚 EP/场"
            value={row.usedInEpOrScene}
            onChange={(e) => {
              const bridge8Coverage = [...ops.bridge8Coverage];
              bridge8Coverage[i] = { ...row, usedInEpOrScene: e.target.value };
              setOps((s) => ({ ...s, bridge8Coverage }));
            }}
          />
        </div>
      ))}
      <Button
        size="sm"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "struct.bridge8", {
            label: "struct.bridge8",
            inputJson: { coverage: ops.bridge8Coverage },
          })
        }
      >
        struct.bridge8
      </Button>
      <strong style={{ fontSize: 13 }}>一加一</strong>
      <Button
        size="sm"
        onClick={() =>
          setOps((s) => ({
            ...s,
            onePlusOneRows: [
              ...s.onePlusOneRows,
              {
                id: `op-${Date.now()}`,
                ep: s.onePlusOneRows.length + 1,
                expected: "",
                payoff: "",
                plusOne: "",
              },
            ],
          }))
        }
      >
        加行
      </Button>
      {ops.onePlusOneRows.map((row, i) => (
        <div key={row.id} className="field-grid">
          <label className="field">
            <span>集</span>
            <input
              className="input"
              type="number"
              value={row.ep}
              onChange={(e) => {
                const onePlusOneRows = [...ops.onePlusOneRows];
                onePlusOneRows[i] = { ...row, ep: Number(e.target.value) || 1 };
                setOps((s) => ({ ...s, onePlusOneRows }));
              }}
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>预期</span>
            <input
              className="input"
              value={row.expected}
              onChange={(e) => {
                const onePlusOneRows = [...ops.onePlusOneRows];
                onePlusOneRows[i] = { ...row, expected: e.target.value };
                setOps((s) => ({ ...s, onePlusOneRows }));
              }}
            />
          </label>
          <label className="field">
            <span>兑现</span>
            <input
              className="input"
              value={row.payoff}
              onChange={(e) => {
                const onePlusOneRows = [...ops.onePlusOneRows];
                onePlusOneRows[i] = { ...row, payoff: e.target.value };
                setOps((s) => ({ ...s, onePlusOneRows }));
              }}
            />
          </label>
          <label className="field">
            <span>加一</span>
            <input
              className="input"
              value={row.plusOne}
              onChange={(e) => {
                const onePlusOneRows = [...ops.onePlusOneRows];
                onePlusOneRows[i] = { ...row, plusOne: e.target.value };
                setOps((s) => ({ ...s, onePlusOneRows }));
              }}
            />
          </label>
        </div>
      ))}
      <Button
        size="sm"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "hook.one_plus_one", {
            label: "hook.one_plus_one",
            inputJson: { rows: ops.onePlusOneRows },
          })
        }
      >
        one_plus_one
      </Button>
      <label className="row" style={{ gap: 6, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={ops.suspenseBudget.fourAttrAck}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              suspenseBudget: {
                ...s.suspenseBudget,
                fourAttrAck: e.target.checked,
              },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>悬念四属性已自检</span>
      </label>
      <label className="field">
        <span>长悬念数（贯穿期≤1）</span>
        <input
          className="input"
          type="number"
          min={0}
          value={ops.suspenseBudget.longSuspenseCount}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              suspenseBudget: {
                ...s.suspenseBudget,
                longSuspenseCount: Number(e.target.value) || 0,
              },
            }))
          }
        />
      </label>
      <Button
        size="sm"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "hook.suspense_design", {
            label: "hook.suspense_design",
            inputJson: ops.suspenseBudget,
          })
        }
      >
        suspense_design
      </Button>
    </Panel>
  );
}

export function SceneTriplePanel({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const [tab, setTab] = usePersistedState(projectId, "charlie-scene-tab", "triple");
  return (
    <Panel title="场三件套 · 三角 · 开场七型">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "triple", label: "场三件套" },
          { id: "triangle", label: "三角" },
          { id: "opening", label: "开场" },
        ]}
      />
      {tab === "triple" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11 }}>
            每场=信息+推进+变化
          </p>
          <Button
            size="sm"
            onClick={() =>
              setOps((s) => ({
                ...s,
                sceneTripleDraft: [
                  ...s.sceneTripleDraft,
                  {
                    sceneId: `sc-${Date.now()}`,
                    info: "",
                    advance: "",
                    change: "",
                    done: false,
                  },
                ],
              }))
            }
          >
            加场
          </Button>
          {ops.sceneTripleDraft.map((sc, i) => {
            const ok = validateSceneTripleRow(sc).ok;
            return (
              <div key={sc.sceneId} className="stack" style={{ gap: 4 }}>
                <Badge tone={ok ? "ok" : "warn"}>{ok ? "齐" : "缺"}</Badge>
                {(
                  [
                    ["info", "信息"],
                    ["advance", "推进"],
                    ["change", "变化"],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k} className="field">
                    <span>{l}</span>
                    <input
                      className="input"
                      value={sc[k]}
                      onChange={(e) => {
                        const sceneTripleDraft = [...ops.sceneTripleDraft];
                        sceneTripleDraft[i] = { ...sc, [k]: e.target.value };
                        setOps((s) => ({ ...s, sceneTripleDraft }));
                      }}
                    />
                  </label>
                ))}
              </div>
            );
          })}
          <Button
            size="sm"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "scene.triple", {
                label: "scene.triple",
                inputJson: { scenes: ops.sceneTripleDraft },
              })
            }
          >
            scene.triple
          </Button>
          <Button
            size="sm"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "scene.comedy", {
                label: "scene.comedy",
              })
            }
          >
            喜剧剂量
          </Button>
        </div>
      )}
      {tab === "triangle" && (
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ["goal", "目标"],
              ["reverseSetup", "反义铺垫"],
              ["logicFall", "逻辑回落"],
              ["arrive", "抵达目标"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={ops.triangleDrill[k]}
                onChange={(e) =>
                  setOps((s) => ({
                    ...s,
                    triangleDrill: { ...s.triangleDrill, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <Button
            size="sm"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "scene.triangle", {
                label: "scene.triangle",
                inputJson: ops.triangleDrill,
              })
            }
          >
            scene.triangle
          </Button>
        </div>
      )}
      {tab === "opening" && (
        <div className="stack" style={{ gap: 8 }}>
          <label className="field">
            <span>开场七型</span>
            <Select
              className="select"
              value={ops.openingPick.type}
              onChange={(e) =>
                setOps((s) => ({
                  ...s,
                  openingPick: { ...s.openingPick, type: e.target.value },
                }))
              }
            >
              <option value="">未选</option>
              {CHARLIE_OPENING7.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>备注</span>
            <input
              className="input"
              value={ops.openingPick.note}
              onChange={(e) =>
                setOps((s) => ({
                  ...s,
                  openingPick: { ...s.openingPick, note: e.target.value },
                }))
              }
            />
          </label>
          <Button
            size="sm"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "scene.opening7", {
                label: "scene.opening7",
                inputJson: ops.openingPick,
              })
            }
          >
            scene.opening7
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function Revise20Workbench({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const g = validateRevise20(ops.revise20);
  return (
    <Panel title="修改 20 法则" actions={<Badge tone={g.ok ? "ok" : "warn"}>{g.message}</Badge>}>
      <p className="muted" style={{ fontSize: 11 }}>
        先感性写完再改；交付前宜全勾。
      </p>
      {ops.revise20.map((item, i) => (
        <div key={item.id} className="stack" style={{ gap: 2, marginBottom: 6 }}>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={(e) => {
                const revise20 = [...ops.revise20];
                revise20[i] = { ...item, done: e.target.checked };
                setOps((s) => ({ ...s, revise20 }));
              }}
            />
            <span style={{ fontSize: 12 }}>
              {i + 1}. {item.label}
            </span>
          </label>
          <input
            className="input"
            placeholder="补丁备注"
            value={item.patch}
            onChange={(e) => {
              const revise20 = [...ops.revise20];
              revise20[i] = { ...item, patch: e.target.value };
              setOps((s) => ({ ...s, revise20 }));
            }}
          />
        </div>
      ))}
      <Button
        size="sm"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "qc.revise20", {
            label: "qc.revise20",
            inputJson: { revise20: ops.revise20 },
          })
        }
      >
        qc.revise20
      </Button>
    </Panel>
  );
}

export function LapianLitePanel({ projectId }: { projectId?: string }) {
  const [ops, setOps] = useDuanjuCharlieOps(projectId);
  const L = ops.lapianLite;
  return (
    <Panel title="拉片轻清单（5.3/5.4）">
      <p className="muted" style={{ fontSize: 11 }}>
        原则自检，不抄个案剧情。
      </p>
      <label className="field">
        <span>拉片频别</span>
        <Select
          className="select"
          value={L.band}
          onChange={(e) =>
            setOps((s) => ({
              ...s,
              lapianLite: {
                ...s.lapianLite,
                band: e.target.value as typeof L.band,
              },
            }))
          }
        >
          <option value="unset">未定</option>
          <option value="male">男频拉片</option>
          <option value="female">女频拉片</option>
        </Select>
      </label>
      {(L.dims.length ? L.dims : CHARLIE_LAPIAN_DIMS.map((id) => ({ id, done: false }))).map(
        (d, i) => (
          <label key={d.id} className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={d.done}
              onChange={(e) => {
                const dims = [...(ops.lapianLite.dims.length ? ops.lapianLite.dims : CHARLIE_LAPIAN_DIMS.map((id) => ({ id, done: false })))];
                dims[i] = { ...d, done: e.target.checked };
                setOps((s) => ({ ...s, lapianLite: { ...s.lapianLite, dims } }));
              }}
            />
            <span style={{ fontSize: 12 }}>{d.id}</span>
          </label>
        ),
      )}
      <Button
        size="sm"
        disabled={!projectId || L.band === "unset"}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "dissect.params", {
            label: "dissect.params",
            inputJson: { gender_path: L.band, lapian: L.dims },
          })
        }
      >
        拉片参数（dissect.params）
      </Button>
    </Panel>
  );
}
