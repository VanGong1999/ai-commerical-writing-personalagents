import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { FORMAT_LABELS } from "@xiezuomanju/domain";
import { listPacksByFormat } from "@xiezuomanju/prompt-registry";
import { Button, PageHeader } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useState } from "react";
import { api } from "../../api/client";

const STEPS = ["格式", "频向题材", "起点", "写作指令", "确认"] as const;

const GENRE_RED = ["末世扎堆", "诡异跟风", "纯系统无创新", "慢治愈无抓马"];
const GENRE_PUSH_MALE = ["玄幻修仙微创新", "沙雕脑洞", "限制金手指逆袭", "高武/灵气复苏变体"];
const GENRE_PUSH_FEMALE = ["大女主", "重生复仇", "追妻火葬场", "马甲团宠"];

export function NewProjectPage() {
  const nav = useNavigate();
  const search = useSearch({ from: "/projects/new" });
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<ProjectFormat>((search.format as ProjectFormat) || "manju");
  const [gender, setGender] = useState("男频");
  const [genres, setGenres] = useState(search.tags || "都市,重生");
  const [startFrom, setStartFrom] = useState<"blank" | "kb_dissect" | "existing_hook" | "ip">(
    "blank",
  );
  const [sourceDocId, setSourceDocId] = useState("");
  const [title, setTitle] = useState(search.title || "");
  const [logline, setLogline] = useState(search.logline || "");
  const [deadline, setDeadline] = useState("");
  const [targetWords, setTargetWords] = useState("");
  const [platform, setPlatform] = useState("");
  const [budgetTokens, setBudgetTokens] = useState("");
  const packs = listPacksByFormat(format);
  const [packId, setPackId] = useState(packs[0]?.id ?? "");
  const { data: kbDocs = [] } = useQuery({
    queryKey: ["kb-docs"],
    queryFn: () => api.listDocs(),
  });
  const pushList = gender === "女频" ? GENRE_PUSH_FEMALE : GENRE_PUSH_MALE;
  const hitBlack = GENRE_RED.some((b) => genres.includes(b.slice(0, 2)));

  const create = useMutation({
    mutationFn: () =>
      api.createProject({
        title: title || `未命名${FORMAT_LABELS[format]}`,
        format,
        genreTags: [gender, ...genres.split(/[,，]/).map((s) => s.trim()).filter(Boolean)],
        market: "cn",
        promptPackId: packId,
        startFrom,
        sourceDocId: sourceDocId || undefined,
        coverMeta: {
          logline: logline.trim(),
          deadline: deadline || undefined,
          targetWords: targetWords ? Number(targetWords) : undefined,
          platform: platform.trim() || undefined,
        },
        budgetTokens: budgetTokens ? Number(budgetTokens) : undefined,
      }),
    onSuccess: (p) => {
      nav({
        to: "/studio/$format",
        params: { format: p.format },
        search: { projectId: p.id },
      });
    },
  });

  return (
    <div className="page">
      <PageHeader title="新建项目" description={`向导 ${step + 1}/${STEPS.length} · ${STEPS[step]}`} />
      <div className="row">
        {STEPS.map((s, i) => (
          <span key={s} className="badge" style={{ opacity: i === step ? 1 : 0.5 }}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <div className="panel">
        <div className="panel__body stack">
          {step === 0 && (
            <div className="cta-grid">
              {(Object.keys(FORMAT_LABELS) as ProjectFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="cta-tile"
                  data-active={format === f}
                  style={format === f ? { borderColor: "var(--accent)" } : undefined}
                  onClick={() => {
                    setFormat(f);
                    setPackId(listPacksByFormat(f)[0]?.id ?? "");
                  }}
                >
                  <strong>{FORMAT_LABELS[f]}</strong>
                  <span>{f}</span>
                </button>
              ))}
            </div>
          )}
          {step === 1 && (
            <>
              <label className="stack">
                <span className="muted">频向</span>
                <Select className="select" value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option>男频</option>
                  <option>女频</option>
                </Select>
              </label>
              <div className="stack" style={{ gap: 6 }}>
                <span className="muted">题材红黑榜（课内口径，须按行情刷新）</span>
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {GENRE_RED.map((g) => (
                    <button
                      key={g}
                      type="button"
                      className="badge"
                      style={{ opacity: 0.85, cursor: "default" }}
                      title="黑/避：饱和题材"
                    >
                      避 · {g}
                    </button>
                  ))}
                </div>
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {pushList.map((g) => (
                    <button
                      key={g}
                      type="button"
                      className="badge"
                      style={{ cursor: "pointer", borderColor: "var(--accent)" }}
                      onClick={() =>
                        setGenres((prev) =>
                          prev
                            .split(/[,，]/)
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .concat(g)
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .join(","),
                        )
                      }
                    >
                      推 · {g}
                    </button>
                  ))}
                </div>
                {hitBlack && (
                  <p className="muted" style={{ color: "var(--danger, #b4443c)" }}>
                    题材可能命中黑榜关键词，建议换元改赛道或叠加微创新后再立项。
                  </p>
                )}
              </div>
              <label className="stack">
                <span className="muted">题材标签（逗号分隔）</span>
                <input className="input" value={genres} onChange={(e) => setGenres(e.target.value)} />
              </label>
              <label className="stack">
                <span className="muted">项目标题</span>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="可稍后修改"
                />
              </label>
              <label className="stack">
                <span className="muted">一句话卖点 / 导语</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={logline}
                  onChange={(e) => setLogline(e.target.value)}
                  placeholder="从灵感候选带入，或手填身份+矛盾+转折+金手指"
                />
              </label>
              <div className="field-grid">
                <label className="field">
                  <span>目标字数</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={targetWords}
                    onChange={(e) => setTargetWords(e.target.value)}
                    placeholder="例：100000"
                  />
                </label>
                <label className="field">
                  <span>截止日期</span>
                  <input
                    className="input"
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>投稿平台</span>
                  <input
                    className="input"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    placeholder="番茄 / 晋江 / 海外…"
                  />
                </label>
                <label className="field">
                  <span>AI 用量上限（可留空）</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={budgetTokens}
                    onChange={(e) => setBudgetTokens(e.target.value)}
                    placeholder="达到即暂停入队"
                  />
                </label>
              </div>
            </>
          )}
          {step === 2 && (
            <div className="stack">
              {(
                [
                  ["blank", "空白开始"],
                  ["kb_dissect", "从知识库导入拆书"],
                  ["existing_hook", "从已有核心梗"],
                  ["ip", "从 IP 原文"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="row">
                  <input
                    type="radio"
                    checked={startFrom === k}
                    onChange={() => setStartFrom(k)}
                  />
                  {label}
                </label>
              ))}
              {startFrom === "kb_dissect" || startFrom === "ip" ? (
                <label className="field">
                  <span>选择对标文档（已拆书）</span>
                  <Select
                    className="select"
                    value={sourceDocId}
                    onChange={(e) => setSourceDocId(e.target.value)}
                  >
                    <option value="">不指定，仅创建空项目</option>
                    {kbDocs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
            </div>
          )}
          {step === 3 && (
            <div className="stack">
              {packs.map((p) => (
                <label key={p.id} className="row">
                  <input
                    type="radio"
                    checked={packId === p.id}
                    onChange={() => setPackId(p.id)}
                  />
                  <span>
                    {p.name}
                    <span className="muted"> · {p.description}</span>
                  </span>
                </label>
              ))}
              {!packs.length && <div className="muted">该格式暂无写作指令分组，将使用默认设置。</div>}
            </div>
          )}
          {step === 4 && (
            <div className="stack">
              <div>标题：{title || `未命名${FORMAT_LABELS[format]}`}</div>
              <div>格式：{FORMAT_LABELS[format]}</div>
              <div>题材：{[gender, ...genres.split(/[,，]/)].join(" / ")}</div>
              <div>卖点：{logline || "（空）"}</div>
              <div>
                交付：{targetWords ? `${targetWords} 字` : "未设字数"}
                {deadline ? ` · 截止 ${deadline}` : ""}
                {platform ? ` · ${platform}` : ""}
                {budgetTokens ? ` · 用量上限 ${budgetTokens}` : ""}
              </div>
              <div>起点：{startFrom}</div>
              <div>写作指令：{packId || "—"}</div>
            </div>
          )}
        </div>
      </div>
      <div className="row">
        <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          上一步
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
            下一步
          </Button>
        ) : (
          <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
            创建并进入创作台
          </Button>
        )}
      </div>
    </div>
  );
}
