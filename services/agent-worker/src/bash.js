/**
 * 沙箱 bash：白名单命令，cwd 固定 workspace，超时与输出截断。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "../../api/data/workspace");

const ALLOWED = [
  /^ls(\s|$)/,
  /^cat(\s|$)/,
  /^rg(\s|$)/,
  /^grep(\s|$)/,
  /^find(\s|$)/,
  /^wc(\s|$)/,
  /^head(\s|$)/,
  /^tail(\s|$)/,
  /^sed\s+-n(\s|$)/,
  /^pandoc(\s|$)/,
  /^python3(\s|$)/,
  /^git\s+status(\s|$)/,
  /^git\s+diff(\s|$)/,
];

const MAX_OUT = 20_000;

export function isBashAllowed(command) {
  const cmd = String(command || "").trim();
  if (!cmd) return false;
  // 拒绝链式危险符
  if (/[;&`]|\$\(|\|\||&&/.test(cmd) && !/^git\s/.test(cmd)) {
    // 允许简单管道：cmd | head
    if (!/^[a-z0-9_.\-\/ ]+(\|[a-z0-9_.\-\/ ]+)*$/i.test(cmd.replace(/\s+/g, " "))) {
      return false;
    }
  }
  const head = cmd.split("|")[0].trim();
  return ALLOWED.some((re) => re.test(head));
}

export async function runBash(command, { timeoutS = 30 } = {}) {
  const cmd = String(command || "").trim();
  if (!isBashAllowed(cmd)) {
    return {
      ok: false,
      error: "command_not_allowed",
      message: "命令不在白名单。允许：ls/cat/rg/grep/find/wc/head/tail/sed -n/pandoc/python3/git status|diff",
    };
  }
  fs.mkdirSync(WORKSPACE, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", cmd], {
      cwd: WORKSPACE,
      env: {
        PATH: process.env.PATH,
        HOME: WORKSPACE,
        LANG: "en_US.UTF-8",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        ok: false,
        error: "timeout",
        stdout: stdout.slice(0, MAX_OUT),
        stderr: (stderr + "\n[timeout]").slice(0, MAX_OUT),
      });
    }, Math.max(1, timeoutS) * 1000);
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUT) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUT) stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.slice(0, MAX_OUT),
        stderr: stderr.slice(0, MAX_OUT),
      });
    });
  });
}
