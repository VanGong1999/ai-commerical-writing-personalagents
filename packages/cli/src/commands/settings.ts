import { Command } from "commander";
import { out } from "../format.js";
import { api } from "../http.js";

export function registerSettings(program: Command): void {
  const settings = program.command("settings").description("应用设置 / LLM 流量闸");

  settings
    .command("get")
    .description("GET /settings/app")
    .action(async () => {
      out(await api("GET", "/settings/app"));
    });

  settings
    .command("set")
    .requiredOption("--body <json>", "PATCH body")
    .action(async (opts: { body: string }) => {
      out(await api("PATCH", "/settings/app", JSON.parse(opts.body)));
    });

  settings
    .command("llm-traffic")
    .description("查看 LLM 流量闸")
    .action(async () => {
      out(await api("GET", "/settings/llm-traffic"));
    });

  settings
    .command("set-llm-traffic")
    .requiredOption("--body <json>")
    .action(async (opts: { body: string }) => {
      out(await api("PATCH", "/settings/llm-traffic", JSON.parse(opts.body)));
    });

  settings
    .command("governor")
    .description("internal llm-governor 快照")
    .action(async () => {
      out(await api("GET", "/internal/llm-governor"));
    });
}
