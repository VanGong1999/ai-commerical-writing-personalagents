import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

export function registerProviders(program: Command): void {
  const providers = program.command("providers").description("LLM 服务商");

  providers
    .command("list")
    .action(async () => {
      const data = await api<unknown>("GET", "/settings/providers");
      if (getConfig().json) {
        out(data);
        return;
      }
      const items = normalize(data);
      out(
        null,
        table(
          items.map((p) => ({
            id: p.id,
            name: p.name ?? "",
            isDefault: p.isDefault ?? "",
            model: p.model ?? "",
          })),
          ["id", "name", "model", "isDefault"],
        ),
      );
    });

  providers
    .command("default")
    .argument("<providerId>")
    .description("设为默认服务商")
    .action(async (providerId: string) => {
      out(
        await api("PATCH", `/settings/providers/${providerId}/default`, {}),
        `default -> ${providerId}`,
      );
    });

  providers
    .command("test")
    .option("--body <json>", "测试请求体（含 provider 字段）")
    .option("--provider <id>", "简写：只测已有 provider id")
    .action(async (opts: { body?: string; provider?: string }) => {
      const body = opts.body
        ? JSON.parse(opts.body)
        : opts.provider
          ? { providerId: opts.provider }
          : {};
      out(await api("POST", "/settings/providers/test", body));
    });

  providers
    .command("rm")
    .argument("<providerId>")
    .action(async (providerId: string) => {
      out(await api("DELETE", `/settings/providers/${providerId}`), `deleted ${providerId}`);
    });

  providers
    .command("create")
    .requiredOption("--body <json>", "完整 Provider JSON（勿把密钥写进 shell history）")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/settings/providers", JSON.parse(opts.body)));
    });

  providers
    .command("llm-list")
    .description("GET /llm/providers")
    .action(async () => {
      out(await api("GET", "/llm/providers"));
    });
}

function normalize(data: unknown): {
  id: string;
  name?: string;
  model?: string;
  isDefault?: string | boolean;
}[] {
  if (Array.isArray(data)) {
    return data.map((x) => {
      const o = x as Record<string, unknown>;
      return {
        id: String(o.id ?? ""),
        name: o.name != null ? String(o.name) : o.label != null ? String(o.label) : undefined,
        model:
          o.model != null
            ? String(o.model)
            : o.defaultModel != null
              ? String(o.defaultModel)
              : undefined,
        isDefault: (o.isDefault ?? o.default) as string | boolean | undefined,
      };
    });
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.providers)) return normalize(o.providers);
    if (Array.isArray(o.items)) return normalize(o.items);
  }
  return [];
}
