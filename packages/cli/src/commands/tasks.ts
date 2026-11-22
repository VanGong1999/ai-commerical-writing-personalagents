import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

export function registerTasks(program: Command): void {
  const tasks = program.command("tasks").description("任务组 / 审批 / 实例");

  tasks
    .command("summary")
    .action(async () => {
      out(await api("GET", "/tasks/summary"));
    });

  tasks
    .command("groups")
    .argument("[groupId]", "可选 group id")
    .action(async (groupId?: string) => {
      if (groupId) {
        out(await api("GET", `/tasks/groups/${groupId}`));
        return;
      }
      out(await api("GET", "/tasks/groups"));
    });

  tasks
    .command("cancel-group")
    .argument("<groupId>")
    .action(async (groupId: string) => {
      out(await api("POST", `/tasks/groups/${groupId}/cancel`), `cancelled group ${groupId}`);
    });

  tasks
    .command("approve")
    .argument("<runId>")
    .option("--body <json>", "{}", "{}")
    .action(async (runId: string, opts: { body: string }) => {
      out(await api("POST", `/tasks/runs/${runId}/approve`, JSON.parse(opts.body)));
    });

  tasks
    .command("update")
    .argument("<runId>")
    .requiredOption("--body <json>")
    .action(async (runId: string, opts: { body: string }) => {
      out(await api("POST", `/tasks/runs/${runId}/update`, JSON.parse(opts.body)));
    });

  tasks
    .command("cancel")
    .argument("<runId>")
    .action(async (runId: string) => {
      out(await api("POST", `/tasks/runs/${runId}/cancel`), `cancelled ${runId}`);
    });

  tasks
    .command("pause")
    .argument("<runId>")
    .action(async (runId: string) => {
      out(await api("POST", `/tasks/runs/${runId}/pause`), `paused ${runId}`);
    });

  tasks
    .command("resume")
    .argument("<runId>")
    .action(async (runId: string) => {
      out(await api("POST", `/tasks/runs/${runId}/resume`), `resumed ${runId}`);
    });

  tasks
    .command("stop")
    .argument("<runId>")
    .action(async (runId: string) => {
      out(await api("POST", `/tasks/runs/${runId}/stop`), `stopped ${runId}`);
    });

  tasks
    .command("instances")
    .option("--finished", "includeFinished")
    .action(async (opts: { finished?: boolean }) => {
      const q = opts.finished ? "?includeFinished=true" : "";
      const data = await api<unknown>("GET", `/tasks/instances${q}`);
      if (getConfig().json) {
        out(data);
        return;
      }
      const items = Array.isArray(data)
        ? data
        : ((data as { items?: unknown[] })?.items ?? []);
      if (!Array.isArray(items) || !items.length) {
        out(data);
        return;
      }
      out(
        null,
        table(
          items.map((x) => {
            const o = x as Record<string, unknown>;
            return {
              id: String(o.id ?? o.runId ?? ""),
              status: String(o.status ?? ""),
              agentId: String(o.agentId ?? ""),
              projectId: String(o.projectId ?? ""),
            };
          }),
          ["id", "status", "agentId", "projectId"],
        ),
      );
    });

  tasks
    .command("metrics")
    .action(async () => {
      out(await api("GET", "/tasks/metrics"));
    });

  tasks
    .command("audit")
    .option("-n, --limit <n>", "条数", "50")
    .action(async (opts: { limit: string }) => {
      out(await api("GET", `/tasks/audit?limit=${opts.limit}`));
    });
}
