import { DirectoryMountsPanel } from "./DirectoryMountsPanel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderConfig } from "@xiezuomanju/domain";
import { Badge, Button, HelpIcon, PageHeader, Panel, toast } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useState } from "react";
import { api } from "../../api/client";
import { formatCnNumber } from "../../lib/format";
import { FEATURE_TOGGLES } from "../studio/featureToggles";
import { LocalContentManager } from "./LocalContentManager";

const ROUTES = [
  { id: "creative", label: "创意生成", desc: "核心梗 / 大纲 / 人设" },
  { id: "logic", label: "逻辑校验", desc: "检查与挑错" },
  { id: "polish", label: "润色 / 去 AI 味", desc: "文风 / 改写" },
  { id: "cheap", label: "便宜批量", desc: "分集正文批量" },
];

const MODEL_PRESETS = [
  { id: "MiniMax-M3.1-Flash", label: "MiniMax 快速版", hint: "M Plan 订阅模型，写作与工具调用均可" },
  { id: "deepseek-flash", label: "DeepSeek 快速版", hint: "DeepSeek 服务商使用的快速模型" },
  { id: "deepseek-v4-pro", label: "DeepSeek 增强版", hint: "DeepSeek 服务商使用的增强模型" },
];

const PROVIDER_PRESETS = [
  {
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    models: "MiniMax-M3.1-Flash",
    hint: "支持联网搜索",
  },
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    models: "deepseek-flash, deepseek-v4-pro",
    hint: "支持联网搜索",
  },
  {
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: "glm-4.5",
    hint: "支持联网搜索",
  },
  {
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: "kimi-k3",
    hint: "支持联网搜索",
  },
];

const LEGACY_MODEL_IDS = new Set(["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash"]);

const friendlyModel = (id: string) =>
  MODEL_PRESETS.find((preset) => preset.id === id)?.label ?? id;

export function SettingsPage() {
  const qc = useQueryClient();
  const [penName, setPenName] = useState(() => {
    try {
      return (JSON.parse(localStorage.getItem("xmj-settings") || "{}") as { penName?: string })
        .penName || "漫剧作者";
    } catch {
      return "漫剧作者";
    }
  });
  const [density, setDensity] = useState(() => {
    try {
      return (
        (JSON.parse(localStorage.getItem("xmj-settings") || "{}") as { density?: string })
          .density || "compact"
      );
    } catch {
      return "compact";
    }
  });
  const [audience, setAudience] = useState(() => {
    try {
      return (
        (JSON.parse(localStorage.getItem("xmj-settings") || "{}") as { audience?: string })
          .audience || "男频"
      );
    } catch {
      return "男频";
    }
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.listProviders(),
  });
  const { data: scheduled = [] } = useQuery({
    queryKey: ["scheduled"],
    queryFn: () => api.listScheduled(),
  });
  const { data: appSettings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => api.getAppSettings(),
  });
  const { data: llmTraffic } = useQuery({
    queryKey: ["llm-traffic"],
    queryFn: () => api.getLlmTraffic(),
    refetchInterval: 5000,
  });
  const [budgetText, setBudgetText] = useState("");
  const [capDraft, setCapDraft] = useState("");

  const supportsBuiltInSearch = (baseUrl: string) =>
    /deepseek|bigmodel|zhipu|chatglm|minimax|moonshot|kimi/i.test(baseUrl);
  const webSearchProvider =
    providers.find((p) => p.enabled && p.isDefault) ??
    providers.find((p) => p.enabled);
  const activeProvider = webSearchProvider;
  const activeModel =
    activeProvider?.selectedModel || activeProvider?.models[0] || "";
  const webSearchReady =
    !!webSearchProvider &&
    webSearchProvider.apiKeyMasked !== "未配置" &&
    supportsBuiltInSearch(webSearchProvider.baseUrl);

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patchScheduled(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled"] }),
  });

  const budgetValue = appSettings?.usageBudgetMonthly ?? null;
  const budgetDraft = budgetText || (budgetValue != null ? String(budgetValue) : "");
  const saveBudget = useMutation({
    mutationFn: (raw: string) => {
      const trimmed = raw.trim();
      const value = trimmed === "" ? null : Math.max(0, Number(trimmed) || 0);
      return api.patchAppSettings({ usageBudgetMonthly: value });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      qc.invalidateQueries({ queryKey: ["usage-summary"] });
      toast.ok("月度用量上限已保存");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const saveToggles = useMutation({
    mutationFn: (toggles: Record<string, boolean>) =>
      api.patchAppSettings({ featureToggles: toggles }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.ok("功能开关已保存");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const saveLlmTraffic = useMutation({
    mutationFn: (body: Parameters<typeof api.patchLlmTraffic>[0]) => api.patchLlmTraffic(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["llm-traffic"] });
      toast.ok("流量治理已保存");
    },
    onError: (e: Error) => toast.fail(e.message),
  });
  const capValue = llmTraffic?.cap ?? 4;
  const capShown = capDraft || String(capValue);

  const emptyForm = {
    id: undefined as string | undefined,
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "",
    models: "MiniMax-M3.1-Flash",
    selectedModel: "MiniMax-M3.1-Flash",
    enabled: true,
    isDefault: false,
    pricing: {} as Record<string, { input: string; cachedInput: string; output: string }>,
  };
  const [form, setForm] = useState(emptyForm);

  const toggleModel = (model: string) => {
    const models = form.models
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const next = models.includes(model)
      ? models.filter((item) => item !== model)
      : [...models, model];
    const selectedModel = next.includes(form.selectedModel)
      ? form.selectedModel
      : next[0] || "";
    setForm({ ...form, models: next.join(", "), selectedModel });
  };

  const startEdit = (p: ProviderConfig) =>
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: "",
      models: p.models.join(", "),
      selectedModel: p.selectedModel || p.models[0] || "",
      enabled: p.enabled,
      isDefault: p.isDefault,
      pricing: toPricingForm(p.pricing),
    });

  const toPricingForm = (pricing: unknown): Record<string, { input: string; cachedInput: string; output: string }> => {
    const out: Record<string, { input: string; cachedInput: string; output: string }> = {};
    if (pricing && typeof pricing === "object") {
      for (const [model, value] of Object.entries(pricing as Record<string, unknown>)) {
        if (!value || typeof value !== "object") continue;
        const item = value as Record<string, unknown>;
        out[model] = {
          input: item.input != null ? String(item.input) : "",
          cachedInput: item.cachedInput != null ? String(item.cachedInput) : "",
          output: item.output != null ? String(item.output) : "",
        };
      }
    }
    return out;
  };

  const pricingFromForm = () => {
    const out: Record<string, { input?: number; cachedInput?: number; output?: number }> = {};
    for (const [model, item] of Object.entries(form.pricing)) {
      const clean: { input?: number; cachedInput?: number; output?: number } = {};
      const num = (text: string) => {
        const value = Number(text);
        return Number.isFinite(value) && value >= 0 ? value : undefined;
      };
      const input = num(item.input);
      const cachedInput = num(item.cachedInput);
      const output = num(item.output);
      if (input != null) clean.input = input;
      if (cachedInput != null) clean.cachedInput = cachedInput;
      if (output != null) clean.output = output;
      if (Object.keys(clean).length) out[model] = clean;
    }
    return out;
  };

  const save = useMutation({
    mutationFn: () =>
      api.saveProvider({
        id: form.id,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim() || undefined,
        models: form.models.split(",").map((s) => s.trim()).filter(Boolean),
        selectedModel: form.selectedModel,
        enabled: form.enabled,
        isDefault: form.isDefault,
        pricing: pricingFromForm(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      setForm(emptyForm);
      toast.ok("AI 服务已保存");
    },
    onError: (e) => toast.fail(e.message),
  });

  const test = useMutation({
    mutationFn: () =>
      api.testProvider({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        model: form.selectedModel || form.models.split(",")[0]?.trim() || undefined,
      }),
    onSuccess: (r) =>
      r.ok ? toast.ok(`连接成功（${r.model ?? "ok"}）`) : toast.fail(r.error || "连接失败"),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteProvider(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      toast.ok("已删除");
    },
    onError: (e) => toast.fail(e.message),
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => api.setDefaultProvider(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      toast.ok("已设为默认");
    },
    onError: (e) => toast.fail(e.message),
  });

  const useModel = useMutation({
    mutationFn: async ({ provider, model }: { provider: ProviderConfig; model: string }) => {
      const saved = await api.saveProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: provider.models,
        selectedModel: model,
        enabled: provider.enabled,
        isDefault: provider.isDefault,
        pricing: provider.pricing as never,
      });
      return saved.isDefault ? saved : api.setDefaultProvider(saved.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      toast.ok("当前模型已切换，后续模型调用会立即生效");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const legacyProviders = providers.filter((provider) =>
    provider.models.some((model) => LEGACY_MODEL_IDS.has(model)),
  );
  const migrateModels = useMutation({
    mutationFn: () =>
      Promise.all(
        legacyProviders.map((provider) =>
          api.saveProvider({
            id: provider.id,
            name: provider.name,
            baseUrl: provider.baseUrl,
            models: ["deepseek-flash", "deepseek-v4-pro"],
            selectedModel: "deepseek-flash",
            enabled: provider.enabled,
            isDefault: provider.isDefault,
            pricing: provider.pricing as never,
          }),
        ),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      toast.ok("旧模型名称已更新");
    },
    onError: (e) => toast.fail(e.message),
  });

  return (
    <div className="page page--wide">
      <PageHeader
        title="设置"
        description="设置笔名、界面偏好、AI 服务和使用规则。看不懂的选项可以点旁边的问号。"
      />

      <LocalContentManager />
      <DirectoryMountsPanel />

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <Panel title="个人信息">
          <div className="stack">
            <label className="stack">
              <span className="muted">笔名</span>
              <input className="input" value={penName} onChange={(e) => setPenName(e.target.value)} />
            </label>
            <label className="stack">
              <span className="muted">主攻频向</span>
              <Select
                className="select"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              >
                <option value="男频">男频</option>
                <option value="女频">女频</option>
                <option value="不限">不限</option>
              </Select>
            </label>
            <label className="stack">
              <span className="muted">界面密度</span>
              <Select className="select" value={density} onChange={(e) => setDensity(e.target.value)}>
                <option value="compact">紧凑（默认）</option>
                <option value="comfortable">舒适</option>
              </Select>
            </label>
            <Button
              onClick={() => {
                localStorage.setItem(
                  "xmj-settings",
                  JSON.stringify({ penName, density, audience }),
                );
                document.documentElement.dataset.density = density;
                toast.ok("设置已保存到本机（密度已生效）");
              }}
            >
              保存
            </Button>
          </div>
        </Panel>

        <Panel
          title={
            <span>
              AI 服务分配
              <HelpIcon text="所有写作 Agent 都跟随当前默认服务商和当前模型；在下方点击模型即可切换，运行中的任务会在下一次模型调用时使用新选择。" />
            </span>
          }
        >
          <table className="table">
            <thead>
              <tr>
                <th>用途</th>
                <th>说明</th>
                <th>当前使用</th>
              </tr>
            </thead>
            <tbody>
              {ROUTES.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.label}</td>
                  <td className="muted">{r.desc}</td>
                  <td>
                    <Badge title={activeModel || "跟随系统配置"}>
                      {activeModel ? friendlyModel(activeModel) : "跟随系统配置"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel
        title={
          <span>
            AI 服务商（填写服务地址和密钥即可使用）
            <HelpIcon text="密钥相当于你的账号密码，只保存在本机。不会填时可以先跳过，使用系统已配置的服务。" />
          </span>
        }
        style={{ marginTop: 12 }}
      >
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <span className="muted">常用服务商：</span>
          {PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="badge"
              title={preset.hint}
              onClick={() =>
                setForm({
                  ...form,
                  name: preset.name,
                  baseUrl: preset.baseUrl,
                  models: preset.models,
                  selectedModel: preset.models.split(",")[0]?.trim() || "",
                })
              }
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="grid grid-2">
          <label className="stack">
            <span className="muted">服务商名称</span>
            <input
              className="input"
              value={form.name}
              placeholder="如 MiniMax / DeepSeek / OpenAI / 本地"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="stack">
            <span className="muted">
              服务地址
              <HelpIcon text="服务商提供的网址。选择上方常用服务商后会自动填好。" />
            </span>
            <input
              className="input"
              value={form.baseUrl}
              placeholder="https://api.minimaxi.com/v1"
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </label>
          <label className="stack">
            <span className="muted">
              密钥{form.id ? "（留空表示不修改）" : ""}
              <HelpIcon text="服务商给你的 sk- 开头的一串字符。只保存在本机，不会显示给其他人。" />
            </span>
            <input
              className="input"
              type="password"
              value={form.apiKey}
              placeholder="sk-…"
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </label>
          <label className="stack">
            <span className="muted">
              可用模型
              <HelpIcon text="可以填一个或多个。点下面的「快速版 / 增强版」会自动加入。" />
            </span>
            <input
              className="input"
              value={form.models}
              placeholder="MiniMax-M3.1-Flash"
              onChange={(e) => {
                const models = e.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);
                setForm({
                  ...form,
                  models: e.target.value,
                  selectedModel: models.includes(form.selectedModel)
                    ? form.selectedModel
                    : models[0] || "",
                });
              }}
            />
            <span className="row" style={{ gap: 5, marginTop: 4 }}>
              {MODEL_PRESETS.map((preset) => {
                const selected = form.models
                  .split(",")
                  .map((item) => item.trim())
                  .includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="badge"
                    data-active={selected}
                    title={preset.hint}
                    style={
                      selected
                        ? { borderColor: "var(--accent)", color: "var(--accent-ink)" }
                        : undefined
                    }
                    onClick={() => toggleModel(preset.id)}
                  >
                    {selected ? "✓ " : "+ "}
                    {preset.label}
                  </button>
                );
              })}
            </span>
            <span className="muted" style={{ marginTop: 6 }}>当前模型</span>
            <Select
              className="select"
              value={form.selectedModel}
              onChange={(e) => setForm({ ...form, selectedModel: e.target.value })}
            >
              {form.models
                .split(",")
                .map((model) => model.trim())
                .filter(Boolean)
                .map((model) => (
                  <option key={model} value={model}>
                    {friendlyModel(model)}
                  </option>
                ))}
            </Select>
          </label>
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted">
              单价（元 / 百万 tokens，留空用默认价）
              <HelpIcon text="输入 / 缓存输入 / 输出 三个单价。缓存命中按缓存价计，其余输入按全价计。未知模型会显示「未配置单价」，不计入成本估算。" />
            </span>
            {form.models
              .split(",")
              .map((model) => model.trim())
              .filter(Boolean)
              .map((model) => {
                const row = form.pricing[model] || { input: "", cachedInput: "", output: "" };
                return (
                  <div key={model} className="row" style={{ gap: 8, alignItems: "center" }}>
                    <span className="faint" style={{ minWidth: 140, fontSize: "var(--fs-sm)" }}>
                      {friendlyModel(model)}
                    </span>
                    <input
                      className="input"
                      style={{ width: 86 }}
                      type="number"
                      min={0}
                      step={0.1}
                      placeholder="输入"
                      value={row.input}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pricing: { ...form.pricing, [model]: { ...row, input: e.target.value } },
                        })
                      }
                    />
                    <input
                      className="input"
                      style={{ width: 86 }}
                      type="number"
                      min={0}
                      step={0.1}
                      placeholder="缓存"
                      value={row.cachedInput}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pricing: { ...form.pricing, [model]: { ...row, cachedInput: e.target.value } },
                        })
                      }
                    />
                    <input
                      className="input"
                      style={{ width: 86 }}
                      type="number"
                      min={0}
                      step={0.1}
                      placeholder="输出"
                      value={row.output}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          pricing: { ...form.pricing, [model]: { ...row, output: e.target.value } },
                        })
                      }
                    />
                  </div>
                );
              })}
          </div>
        </div>

        <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            启用
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            设为默认
          </label>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            保存
          </Button>
          <Button
            variant="ghost"
            loading={test.isPending}
            disabled={!form.apiKey.trim()}
            onClick={() => test.mutate()}
          >
            测试连接
          </Button>
          {form.id && (
            <Button variant="ghost" onClick={() => setForm(emptyForm)}>
              取消编辑
            </Button>
          )}
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
          保存后，写作用优先使用「默认」且已启用的服务商。没有配置时，会使用系统预先设置的服务。
          测试连接需要先填写完整密钥。
        </p>

        {legacyProviders.length > 0 && (
          <div className="settings-migrate">
            <div>
              <strong>检测到已停用的旧模型名</strong>
              <p>
                系统里还保留着两个已经停用的旧模型名字。继续使用可能会失败，点右侧按钮会自动更新。
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              loading={migrateModels.isPending}
              onClick={() => migrateModels.mutate()}
            >
              更新旧模型名称
            </Button>
          </div>
        )}

        <div className="settings-table-scroll scroll-region">
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>名称</th>
              <th>服务地址</th>
              <th>密钥</th>
              <th>模型</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>
                  {p.name}{" "}
                  {p.isDefault && <Badge tone="ok">默认</Badge>}
                </td>
                <td className="muted">{p.baseUrl}</td>
                <td>{p.apiKeyMasked}</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    {p.models.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className="badge"
                        data-active={p.selectedModel === model}
                        title={`使用 ${model}，并设为当前服务商`}
                        disabled={useModel.isPending}
                        onClick={() => useModel.mutate({ provider: p, model })}
                      >
                        {p.selectedModel === model ? "✓ " : ""}
                        {model}
                      </button>
                    ))}
                  </div>
                </td>
                <td>
                  <Badge tone={p.enabled ? "ok" : "default"}>{p.enabled ? "启用" : "停用"}</Badge>
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                      编辑
                    </Button>
                    {!p.isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDefault.mutate(p.id)}
                      >
                        设为默认
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => del.mutate(p.id)}
                    >
                      删除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>

      <Panel
        title={
          <span>
            流量治理
            <HelpIcon text="控制 Agent 并发与 MiniMax 等上游限流时的掉队/排队。429 时自动降并发并可选切换备用 Provider，避免任务直接失败。" />
          </span>
        }
        style={{ marginTop: 12 }}
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Badge tone={llmTraffic?.throttled ? "warn" : "ok"}>
              {llmTraffic?.throttled ? "节流中" : "畅通"}
            </Badge>
            <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              有效并发 {llmTraffic?.effective ?? "—"} / 上限 {llmTraffic?.cap ?? "—"}
              {" · "}在途 {llmTraffic?.inflight ?? 0}
            </span>
          </div>
          <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="stack" style={{ minWidth: 160 }}>
              <span className="muted">Worker 并发上限（1–16）</span>
              <input
                className="input"
                type="number"
                min={1}
                max={16}
                value={capShown}
                onChange={(e) => setCapDraft(e.target.value)}
              />
            </label>
            <Button
              onClick={() => {
                const n = Math.max(1, Math.min(16, Number(capDraft || capValue) || 4));
                saveLlmTraffic.mutate({ workerConcurrencyCap: n });
                setCapDraft("");
              }}
              disabled={saveLlmTraffic.isPending}
            >
              保存上限
            </Button>
          </div>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={llmTraffic?.adaptiveEnabled !== false}
              onChange={(e) => saveLlmTraffic.mutate({ adaptiveEnabled: e.target.checked })}
            />
            <span>自适应降并发（遇 429/529 掉队，恢复后爬升）</span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={llmTraffic?.failoverEnabled !== false}
              onChange={(e) => saveLlmTraffic.mutate({ failoverEnabled: e.target.checked })}
            />
            <span>多 Provider 故障转移（需已启用备用且填写密钥）</span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={llmTraffic?.paDeferWhenBusy !== false}
              onChange={(e) => saveLlmTraffic.mutate({ paDeferWhenBusy: e.target.checked })}
            />
            <span>高峰时错峰 PA 代建（元操作仍可立即执行）</span>
          </label>
        </div>
      </Panel>

      <Panel
        title={
          <span>
            用量预算
            <HelpIcon text="设置本月（自然月）用量上限：用量页会显示已用/剩余，并在超限时提醒。项目级预算仍会强控新任务入队。" />
          </span>
        }
        style={{ marginTop: 12 }}
      >
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <label className="stack" style={{ flex: 1 }}>
            <span className="muted">月度用量上限（tokens，留空 = 不设上限）</span>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="例如 1000000"
              value={budgetDraft}
              onChange={(e) => setBudgetText(e.target.value)}
            />
          </label>
          <Button
            style={{ alignSelf: "flex-end" }}
            onClick={() => saveBudget.mutate(budgetDraft)}
            disabled={saveBudget.isPending}
          >
            {saveBudget.isPending ? "保存中…" : "保存上限"}
          </Button>
          {budgetValue != null && (
            <Button
              variant="ghost"
              style={{ alignSelf: "flex-end" }}
              onClick={() => saveBudget.mutate("")}
              disabled={saveBudget.isPending}
            >
              清除
            </Button>
          )}
        </div>
        {budgetValue != null && (
          <div className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }}>
            当前上限：{formatCnNumber(budgetValue)} tokens（在「AI 用量」页生效）
          </div>
        )}
      </Panel>

      <Panel
        title={
          <span>
            联网搜索
            <HelpIcon text="开启后，AI 可以在你同意时上网找公开资料。涉及付费内容时不会抓取全文。" />
          </span>
        }
        style={{ marginTop: 12 }}
      >
        {webSearchReady && webSearchProvider ? (
          <p style={{ margin: 0 }}>
            <Badge tone="ok">已启用</Badge>{" "}
            使用「{webSearchProvider.name}」（{activeModel}）的内置联网能力。
            在知识库搜索时勾选「包含联网」，AI 就会去网上找公开资料。
          </p>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
            联网搜索还没有启用。在上方选择一个常用的 AI 服务并填写地址和密钥即可自动开启。
            如果服务本身不支持联网，这里会如实显示「未启用」，不会假装搜索。
          </p>
        )}
      </Panel>

      <Panel
        title={
          <span>
            功能开关
            <HelpIcon text="控制辅助功能是否自动执行。核心硬门禁（结构/字数/一致性等）不受影响。关闭后仍可在创作台手动「发起」。"
          /></span>
        }
        style={{ marginTop: 12 }}
      >
        <div className="stack" style={{ gap: 8 }}>
          {FEATURE_TOGGLES.map((item) => {
            const on = appSettings?.featureToggles?.[item.id] !== false;
            return (
              <label key={item.id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = { ...(appSettings?.featureToggles ?? {}) };
                    next[item.id] = e.target.checked;
                    saveToggles.mutate(next);
                  }}
                />
                <span className="stack" style={{ gap: 2 }}>
                  <span>{item.label}</span>
                  <span className="faint" style={{ fontSize: "var(--fs-2xs)" }}>{item.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Panel>

      <Panel title="定时任务" style={{ marginTop: 12 }}>
        <div className="settings-table-scroll scroll-region">
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>周期</th>
              <th>范围</th>
              <th>说明</th>
              <th>启用</th>
            </tr>
          </thead>
          <tbody>
            {scheduled.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                <td>{t.cronOrInterval}</td>
                <td>{t.ownerScope}</td>
                <td className="muted">{t.description}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => toggle.mutate({ id: t.id, enabled: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>

      <Panel title="合规" style={{ marginTop: 12 }}>
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          热点采集只读取公开榜单的摘要，不抓取付费正文；题材红线检查可以按需要调严格度。
          写作指令和记忆按用户、按项目分开保存，不会互相串用。
        </p>
      </Panel>
    </div>
  );
}
