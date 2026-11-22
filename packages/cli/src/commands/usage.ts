import { Command } from "commander";
import { out } from "../format.js";
import { api } from "../http.js";

export function registerUsage(program: Command): void {
  const usage = program.command("usage").description("用量与看板");

  usage
    .command("list")
    .description("GET /usage")
    .action(async () => {
      out(await api("GET", "/usage"));
    });

  usage
    .command("summary")
    .action(async () => {
      out(await api("GET", "/usage/summary"));
    });

  program
    .command("dashboard")
    .description("GET /dashboard/summary")
    .action(async () => {
      out(await api("GET", "/dashboard/summary"));
    });

  program
    .command("activity")
    .description("GET /activity")
    .option("-n, --limit <n>", "条数", "50")
    .action(async (opts: { limit: string }) => {
      out(await api("GET", `/activity?limit=${opts.limit}`));
    });
}
