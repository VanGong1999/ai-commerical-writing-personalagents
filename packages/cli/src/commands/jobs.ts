import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";
import { watchJobEvents } from "../sse.js";

type Job = {
  id: string;
  type?: string;
  status?: string;
  projectId?: string;
  createdAt?: string;
};

export function registerJobs(program: Command): void {
  const jobs = program.command("jobs").description("任务队列");

  jobs
    .command("list")
    .option("-n, --limit <n>", "数量", "20")
    .action(async (opts: { limit: string }) => {
      const data = await api<Job[] | { items?: Job[] }>("GET", `/jobs?limit=${opts.limit}`);
      const items = Array.isArray(data) ? data : data.items || [];
      if (getConfig().json) {
        out(items);
        return;
      }
      out(
        null,
        table(
          items.map((j) => ({
            id: j.id,
            type: j.type ?? "",
            status: j.status ?? "",
            projectId: j.projectId ?? "",
          })),
          ["id", "type", "status", "projectId"],
        ),
      );
    });

  jobs
    .command("get")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("GET", `/jobs/${id}`));
    });

  jobs
    .command("cancel")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("POST", `/jobs/${id}/cancel`), `cancelled ${id}`);
    });

  jobs
    .command("retry")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("POST", `/jobs/${id}/retry`), `retried ${id}`);
    });

  jobs
    .command("watch")
    .argument("<id>")
    .description("SSE 跟踪 job 事件")
    .action(async (id: string) => {
      const last = await watchJobEvents(id, (ev) => {
        if (getConfig().json) {
          out(ev);
          return;
        }
        const name = String(ev.event || ev.type || "");
        if (name === "token" && ev.token != null) {
          process.stdout.write(String(ev.token));
          return;
        }
        out(null, `[${name}] ${JSON.stringify(ev).slice(0, 300)}`);
      });
      if (!getConfig().json) process.stdout.write("\n");
      if (getConfig().json && last) out(last);
    });
}
