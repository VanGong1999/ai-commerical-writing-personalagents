import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

type Task = { id: string; name?: string; enabled?: boolean; cron?: string; type?: string };

function asList<T>(data: T[] | { items?: T[] }): T[] {
  return Array.isArray(data) ? data : data.items || [];
}

export function registerSchedule(program: Command): void {
  const schedule = program.command("schedule").description("定时任务");

  schedule
    .command("list")
    .action(async () => {
      const items = asList(
        await api<Task[] | { items?: Task[] }>("GET", "/scheduled-tasks"),
      );
      if (getConfig().json) {
        out(items);
        return;
      }
      out(
        null,
        table(
          items.map((t) => ({
            id: t.id,
            name: t.name ?? t.type ?? "",
            enabled: t.enabled ?? "",
            cron: t.cron ?? "",
          })),
          ["id", "name", "enabled", "cron"],
        ),
      );
    });

  schedule
    .command("create")
    .requiredOption("--body <json>")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/scheduled-tasks", JSON.parse(opts.body)));
    });

  schedule
    .command("patch")
    .argument("<taskId>")
    .requiredOption("--body <json>")
    .action(async (taskId: string, opts: { body: string }) => {
      out(await api("PATCH", `/scheduled-tasks/${taskId}`, JSON.parse(opts.body)));
    });

  schedule
    .command("rm")
    .argument("<taskId>")
    .action(async (taskId: string) => {
      out(await api("DELETE", `/scheduled-tasks/${taskId}`), `deleted ${taskId}`);
    });
}

export function registerProposals(program: Command): void {
  const proposals = program.command("proposals").description("Task proposals（同事扫描）");

  proposals
    .command("list")
    .action(async () => {
      out(await api("GET", "/task-proposals"));
    });

  proposals
    .command("approve")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("POST", `/task-proposals/${id}/approve`, {}));
    });

  proposals
    .command("dismiss")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("POST", `/task-proposals/${id}/dismiss`, {}));
    });

  program
    .command("colleague-scan")
    .description("触发同事扫描")
    .option("--body <json>", "{}", "{}")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/colleague/scan", JSON.parse(opts.body)));
    });
}
