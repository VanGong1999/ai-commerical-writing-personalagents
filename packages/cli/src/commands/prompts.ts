import { Command } from "commander";
import { out } from "../format.js";
import { api } from "../http.js";

export function registerPrompts(program: Command): void {
  const prompts = program.command("prompts").description("Prompt 模板 / Pack");

  prompts
    .command("list")
    .action(async () => {
      out(await api("GET", "/prompts"));
    });

  prompts
    .command("packs")
    .action(async () => {
      out(await api("GET", "/prompts/packs"));
    });

  prompts
    .command("validate")
    .requiredOption("--body <json>")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/prompts/validate", JSON.parse(opts.body)));
    });
}
