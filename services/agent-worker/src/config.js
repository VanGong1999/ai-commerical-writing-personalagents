// 轻量加载根目录 .env（Node 不自动读 .env；与 FastAPI env_file 行为对齐）
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(__dirname, "../../../.env");
if (existsSync(rootEnv)) {
  const lines = readFileSync(rootEnv, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawVal = trimmed.slice(eq + 1).trim();
    const val =
      (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'"))
        ? rawVal.slice(1, -1)
        : rawVal;
    if (!(key in process.env)) process.env[key] = val;
  }
}

/** Agent 专用队列；禁止用 JOB_QUEUE_KEY（jobs:queue）覆盖，以免与 Python worker 抢错队。 */
const agentQueue =
  process.env.JOB_AGENT_QUEUE_KEY ||
  (process.env.JOB_QUEUE_KEY === "jobs:queue" ? "jobs:agent" : process.env.JOB_QUEUE_KEY) ||
  "jobs:agent";

export const config = {
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379/0",
  apiBase: process.env.API_BASE || process.env.AGENT_WORKER_API_BASE || "http://127.0.0.1:8000",
  jobQueueKey: agentQueue,
  eventsPrefix: process.env.JOB_EVENTS_CHANNEL_PREFIX || "job:events:",
  cancelPrefix: process.env.JOB_CANCEL_PREFIX || "job:cancel:",
  // OpenAI 兼容参数透传（MiniMax 不接受 reasoning_effort=none，会 400；仅透传显式非空合法值）
  reasoningEffort: (() => {
    const raw = String(process.env.AGENT_REASONING_EFFORT || "").trim().toLowerCase();
    if (!raw || raw === "none" || raw === "off" || raw === "false") return "";
    return raw;
  })(),
  concurrency: Number(process.env.AGENT_WORKER_CONCURRENCY || 4),
};
