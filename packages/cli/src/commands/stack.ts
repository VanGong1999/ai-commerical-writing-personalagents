import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Command } from "commander";
import { ensureXzmDir, findRepoRoot, getConfig, xzmDir } from "../config.js";
import { err, out } from "../format.js";
import { api, rootHealth, sleep } from "../http.js";

type ServiceName = "api" | "worker" | "agent-worker" | "web" | "feishu" | "scheduler";

const CORE: ServiceName[] = ["api", "worker", "agent-worker"];

const SCRIPT: Record<ServiceName, string> = {
  api: "dev:api",
  worker: "dev:worker",
  "agent-worker": "dev:agent-worker",
  web: "dev:web",
  feishu: "dev:feishu",
  scheduler: "dev:scheduler",
};

function pidFile(root: string, name: ServiceName): string {
  return path.join(xzmDir(root), `${name}.pid`);
}

function logFile(root: string, name: ServiceName): string {
  return path.join(xzmDir(root), `${name}.log`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(root: string, name: ServiceName): number | null {
  const p = pidFile(root, name);
  if (!fs.existsSync(p)) return null;
  const n = Number(fs.readFileSync(p, "utf8").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function writePid(root: string, name: ServiceName, pid: number): void {
  fs.writeFileSync(pidFile(root, name), String(pid) + "\n", "utf8");
}

function clearPid(root: string, name: ServiceName): void {
  try {
    fs.unlinkSync(pidFile(root, name));
  } catch {
    /* ignore */
  }
}

function startService(root: string, name: ServiceName): { pid: number; already: boolean } {
  const existing = readPid(root, name);
  if (existing && isAlive(existing)) {
    return { pid: existing, already: true };
  }

  ensureXzmDir(root);
  const logPath = logFile(root, name);
  const outFd = fs.openSync(logPath, "a");
  const child = spawn("pnpm", [SCRIPT[name]], {
    cwd: root,
    detached: true,
    stdio: ["ignore", outFd, outFd],
    env: process.env,
  });
  fs.closeSync(outFd);
  if (!child.pid) throw new Error(`failed to start ${name}`);
  child.unref();
  writePid(root, name, child.pid);
  return { pid: child.pid, already: false };
}

function stopService(root: string, name: ServiceName): string {
  const pid = readPid(root, name);
  if (!pid) return `${name}: not tracked`;
  if (!isAlive(pid)) {
    clearPid(root, name);
    return `${name}: stale pid ${pid} cleared`;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      clearPid(root, name);
      return `${name}: already dead`;
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && isAlive(pid)) {
    try {
      execSync("sleep 0.2", { stdio: "ignore" });
    } catch {
      break;
    }
  }
  if (isAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  clearPid(root, name);
  return `${name}: stopped (was ${pid})`;
}

function tcpCheck(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false));
    sock.on("error", () => done(false));
  });
}

function runPnpm(root: string, args: string[]): void {
  execSync(`pnpm ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
    cwd: root,
    stdio: getConfig().quiet ? "ignore" : "inherit",
    env: process.env,
  });
}

export function registerStack(program: Command): void {
  const stack = program.command("stack").description("本地进程栈运维");

  stack
    .command("up")
    .description("启动 Redis + api/worker/agent-worker（可选 web/feishu/scheduler）")
    .option("--web", "同时启动 Web")
    .option("--feishu", "同时启动飞书长连接")
    .option("--scheduler", "同时启动 scheduler")
    .option("--heavy", "docker:up:heavy（Redis+MinIO+Milvus）")
    .option("--no-docker", "跳过 docker compose")
    .action(async (opts: { web?: boolean; feishu?: boolean; scheduler?: boolean; heavy?: boolean; docker?: boolean }) => {
      const root = findRepoRoot();
      ensureXzmDir(root);

      if (opts.docker !== false) {
        try {
          runPnpm(root, opts.heavy ? ["docker:up:heavy"] : ["docker:up"]);
        } catch (e) {
          err(`docker 启动失败（可加 --no-docker 跳过）: ${String((e as Error).message || e)}`);
          process.exitCode = 1;
          return;
        }
      }

      const services: ServiceName[] = [...CORE];
      if (opts.web) services.push("web");
      if (opts.feishu) services.push("feishu");
      if (opts.scheduler) services.push("scheduler");

      const results: Record<string, unknown>[] = [];
      for (const name of services) {
        const r = startService(root, name);
        results.push({ service: name, pid: r.pid, already: r.already });
        if (!getConfig().json) {
          out(null, `${name}: ${r.already ? "already running" : "started"} pid=${r.pid}`);
        }
      }

      // brief wait then health
      await sleep(1500);
      let health: unknown = null;
      try {
        health = await rootHealth();
      } catch {
        health = { status: "unreachable" };
      }
      out({ services: results, health }, undefined);
      if (!getConfig().json) {
        out(null, `API health: ${JSON.stringify(health)}`);
        out(null, `logs: ${xzmDir(root)}/*.log`);
      }
    });

  stack
    .command("down")
    .description("停止由 xzm 托管的进程")
    .option("--docker", "同时 docker compose down")
    .action((opts: { docker?: boolean }) => {
      const root = findRepoRoot();
      const all: ServiceName[] = ["api", "worker", "agent-worker", "web", "feishu", "scheduler"];
      const lines: string[] = [];
      for (const name of all) {
        lines.push(stopService(root, name));
      }
      if (opts.docker) {
        try {
          runPnpm(root, ["docker:down"]);
          lines.push("docker: down");
        } catch (e) {
          lines.push(`docker: failed ${String((e as Error).message || e)}`);
        }
      }
      out({ stopped: lines }, lines.join("\n"));
    });

  stack
    .command("status")
    .description("进程 PID + /health + LLM + Redis")
    .action(async () => {
      const root = findRepoRoot();
      const all: ServiceName[] = ["api", "worker", "agent-worker", "web", "feishu", "scheduler"];
      const procs = all.map((name) => {
        const pid = readPid(root, name);
        return {
          service: name,
          pid: pid ?? null,
          alive: pid ? isAlive(pid) : false,
        };
      });

      let health: unknown = null;
      let llm: unknown = null;
      try {
        health = await rootHealth();
      } catch (e) {
        health = { error: String((e as Error).message || e) };
      }
      try {
        llm = await api("GET", "/llm/health");
      } catch (e) {
        llm = { error: String((e as Error).message || e) };
      }
      const redis = await tcpCheck("127.0.0.1", 6379);

      const payload = { processes: procs, health, llm, redis };
      if (getConfig().json) {
        out(payload);
        return;
      }
      out(null, tableLike(procs));
      out(null, `redis:6379  ${redis ? "up" : "down"}`);
      out(null, `api /health ${JSON.stringify(health)}`);
      out(null, `llm health  ${JSON.stringify(llm)}`);
    });

  stack
    .command("logs")
    .description("查看 .xzm 下服务日志")
    .argument("[service]", "api|worker|agent-worker|web|feishu|scheduler")
    .option("-f, --follow", "持续跟踪")
    .option("-n, --lines <n>", "末尾行数", "80")
    .action((service: string | undefined, opts: { follow?: boolean; lines: string }) => {
      const root = findRepoRoot();
      const names: ServiceName[] = service
        ? [service as ServiceName]
        : ["api", "worker", "agent-worker"];
      for (const name of names) {
        if (!SCRIPT[name]) {
          err(`unknown service: ${name}`);
          process.exitCode = 1;
          return;
        }
        const lf = logFile(root, name);
        if (!fs.existsSync(lf)) {
          out(null, `${name}: no log yet (${lf})`);
          continue;
        }
        if (opts.follow) {
          out(null, `--- ${name} (${lf}) ---`);
          const child = spawn("tail", ["-n", opts.lines, "-f", lf], { stdio: "inherit" });
          child.on("exit", (code) => {
            process.exitCode = code ?? 0;
          });
          return;
        }
        const n = Number(opts.lines) || 80;
        const text = fs.readFileSync(lf, "utf8");
        const lines = text.split("\n");
        const slice = lines.slice(-n).join("\n");
        out(null, `--- ${name} ---`);
        out(null, slice);
      }
    });
}

function tableLike(procs: { service: string; pid: number | null; alive: boolean }[]): string {
  return procs
    .map((p) => `${p.service.padEnd(14)} pid=${String(p.pid ?? "-").padEnd(8)} ${p.alive ? "alive" : "down"}`)
    .join("\n");
}
