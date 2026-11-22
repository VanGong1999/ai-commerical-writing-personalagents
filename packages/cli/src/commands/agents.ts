import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

export function registerAgents(program: Command): void {
  const agents = program.command("agents").description("Agent 目录 / Skills / Fleet");

  agents
    .command("list")
    .description("agents/catalog")
    .option("-f, --format <format>", "按格式过滤")
    .action(async (opts: { format?: string }) => {
      const q = opts.format ? `?format=${encodeURIComponent(opts.format)}` : "";
      const data = await api<unknown>("GET", `/agents/catalog${q}`);
      if (getConfig().json) {
        out(data);
        return;
      }
      const items = normalizeCatalog(data);
      out(
        null,
        table(
          items.map((a) => ({
            id: a.id,
            name: a.name ?? "",
            stage: a.stage ?? "",
          })),
          ["id", "name", "stage"],
        ),
      );
    });

  agents
    .command("overview")
    .action(async () => {
      out(await api("GET", "/agents/overview"));
    });

  agents
    .command("skills")
    .argument("[skillId]", "可选 skill id")
    .action(async (skillId?: string) => {
      if (skillId) {
        out(await api("GET", `/agents/skills/${encodeURIComponent(skillId)}`));
        return;
      }
      out(await api("GET", "/agents/skills"));
    });

  agents
    .command("stages")
    .argument("[format]", "格式，如 manju")
    .action(async (fmt?: string) => {
      out(await api("GET", fmt ? `/agents/stages/${encodeURIComponent(fmt)}` : "/agents/stages"));
    });

  agents
    .command("stage-lock")
    .requiredOption("-p, --project <id>")
    .requiredOption("--stage <stage>")
    .action(async (opts: { project: string; stage: string }) => {
      out(
        await api("POST", "/agents/stage-lock", {
          projectId: opts.project,
          stage: opts.stage,
        }),
      );
    });

  agents
    .command("done-check")
    .option("--body <json>", "请求体 JSON", "{}")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/agents/done-check", JSON.parse(opts.body)));
    });

  agents
    .command("policy-resume")
    .option("--body <json>", "请求体 JSON", "{}")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/agents/policy/resume", JSON.parse(opts.body)));
    });

  agents
    .command("handoff")
    .requiredOption("--body <json>", "请求体 JSON")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/agents/handoff", JSON.parse(opts.body)));
    });

  agents
    .command("capabilities")
    .description("harness capabilities")
    .action(async () => {
      out(await api("GET", "/agents/harness/capabilities"));
    });

  const fleet = agents.command("fleet").description("多 Agent fleet");

  fleet
    .command("list")
    .action(async () => {
      out(await api("GET", "/agents/fleets"));
    });

  fleet
    .command("get")
    .argument("<fleetId>")
    .action(async (fleetId: string) => {
      out(await api("GET", `/agents/fleet/${fleetId}`));
    });

  fleet
    .command("create")
    .requiredOption("--body <json>", "创建 fleet 的 JSON body")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/agents/fleet", JSON.parse(opts.body)));
    });

  fleet
    .command("confirm-merge")
    .argument("<fleetId>")
    .option("--body <json>", "{}", "{}")
    .action(async (fleetId: string, opts: { body: string }) => {
      out(await api("POST", `/agents/fleet/${fleetId}/confirm-merge`, JSON.parse(opts.body)));
    });
}

function normalizeCatalog(data: unknown): { id: string; name?: string; stage?: string }[] {
  if (Array.isArray(data)) {
    return data.map((x) => {
      const o = x as Record<string, unknown>;
      return {
        id: String(o.id ?? o.agentId ?? ""),
        name: o.name != null ? String(o.name) : undefined,
        stage: o.stage != null ? String(o.stage) : undefined,
      };
    });
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const arr = (o.agents || o.items || o.catalog) as unknown;
    if (Array.isArray(arr)) return normalizeCatalog(arr);
  }
  return [];
}
