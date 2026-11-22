import { Command } from "commander";
import { getConfig } from "../config.js";
import { err, out } from "../format.js";
import { api, sleep } from "../http.js";
import { watchJobEvents } from "../sse.js";

type Run = {
  id: string;
  status?: string;
  jobId?: string;
  gateResults?: unknown[];
};

async function waitRun(runId: string, timeoutMs = 480_000): Promise<Run> {
  const deadline = Date.now() + timeoutMs;
  let last: Run | null = null;
  let failedStreak = 0;
  for (;;) {
    last = await api<Run>("GET", `/runs/${runId}`);
    const st = last?.status;
    if (["succeeded", "completed"].includes(st || "")) break;
    if (st === "dead" || st === "cancelled") break;
    if (st === "failed") {
      failedStreak += 1;
      if (failedStreak >= 3) break;
    } else {
      failedStreak = 0;
    }
    if (Date.now() > deadline) break;
    await sleep(5000);
  }
  if (!last || !["succeeded", "completed"].includes(last.status || "")) {
    throw new Error(`run 未成功（status=${last?.status ?? "?"}）`);
  }
  return last;
}

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("创建并等待 Agent run")
    .argument("<agentId>", "Agent ID，如 topic.core_hook_batch")
    .requiredOption("-p, --project <id>", "项目 ID")
    .option("-i, --input <json>", "inputJson", "{}")
    .option("--stream", "用 job SSE 跟踪进度")
    .option("--no-wait", "只创建不等待")
    .option("--timeout <ms>", "等待超时毫秒", "480000")
    .action(
      async (
        agentId: string,
        opts: { project: string; input: string; stream?: boolean; wait?: boolean; timeout: string },
      ) => {
        let inputJson: Record<string, unknown> = {};
        try {
          inputJson = JSON.parse(opts.input) as Record<string, unknown>;
        } catch {
          err("--input 必须是合法 JSON");
          process.exitCode = 1;
          return;
        }

        const run = await api<Run>("POST", "/runs", {
          projectId: opts.project,
          agentId,
          inputJson,
        });

        if (!getConfig().json) {
          out(null, `run=${run.id} job=${run.jobId ?? "-"} status=${run.status}`);
        }

        if (opts.wait === false) {
          out(run);
          return;
        }

        if (opts.stream && run.jobId) {
          await watchJobEvents(run.jobId, (ev) => {
            if (getConfig().json) return;
            const name = String(ev.event || ev.type || "");
            if (name === "token" && ev.token != null) {
              process.stdout.write(String(ev.token));
              return;
            }
            out(null, `[${name}] ${JSON.stringify(ev).slice(0, 200)}`);
          });
          if (!getConfig().json) process.stdout.write("\n");
        }

        const final = await waitRun(run.id, Number(opts.timeout) || 480_000);
        out(final, `done status=${final.status}`);
      },
    );
}
