import { Command } from "commander";
import { getConfig } from "../config.js";
import { out } from "../format.js";
import { api, rootHealth } from "../http.js";

export function registerHealth(program: Command): void {
  program
    .command("health")
    .description("检查 API /health 与 LLM")
    .action(async () => {
      const health = await rootHealth();
      let llm: unknown = null;
      try {
        llm = await api("GET", "/llm/health");
      } catch (e) {
        llm = { error: String((e as Error).message || e) };
      }
      const payload = { health, llm };
      if (getConfig().json) {
        out(payload);
        return;
      }
      out(null, `API  ${JSON.stringify(health)}`);
      out(null, `LLM  ${JSON.stringify(llm)}`);
    });
}
