import { Command } from "commander";
import { out } from "../format.js";
import { api } from "../http.js";

export function registerRuns(program: Command): void {
  const runs = program.command("runs").description("查看 / 转向 / 回放 AgentRun");

  runs
    .command("get")
    .argument("<runId>")
    .action(async (runId: string) => {
      out(await api("GET", `/runs/${runId}`));
    });

  runs
    .command("steer")
    .argument("<runId>")
    .argument("<message...>")
    .description("向运行中的 run 注入指令")
    .action(async (runId: string, messageParts: string[]) => {
      const message = messageParts.join(" ").trim();
      out(await api("POST", `/runs/${runId}/steer`, { message }), `steered ${runId}`);
    });

  runs
    .command("replay")
    .argument("<runId>")
    .action(async (runId: string) => {
      out(await api("GET", `/runs/${runId}/replay`));
    });
}
