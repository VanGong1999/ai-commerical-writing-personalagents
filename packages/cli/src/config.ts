import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type XzmConfig = {
  apiBase: string;
  json: boolean;
  quiet: boolean;
};

const DEFAULT_API_BASE = "http://127.0.0.1:8000";

let runtime: XzmConfig = {
  apiBase: DEFAULT_API_BASE,
  json: false,
  quiet: false,
};

/** Walk up from start until package.json name === "xiezuomanju" (monorepo root). */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "xiezuomanju") return dir;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: packages/cli → ../..
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

export function xzmDir(root = findRepoRoot()): string {
  return path.join(root, ".xzm");
}

export function ensureXzmDir(root = findRepoRoot()): string {
  const dir = xzmDir(root);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadRc(root: string): Partial<{ apiBase: string }> {
  const rcPath = path.join(root, ".xzmrc.json");
  if (!fs.existsSync(rcPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(rcPath, "utf8")) as { apiBase?: string };
  } catch {
    return {};
  }
}

export function initConfig(opts: { apiBase?: string; json?: boolean; quiet?: boolean } = {}): XzmConfig {
  const root = findRepoRoot();
  const rc = loadRc(root);
  runtime = {
    apiBase: (opts.apiBase || process.env.XZM_API_BASE || rc.apiBase || DEFAULT_API_BASE).replace(
      /\/$/,
      "",
    ),
    json: Boolean(opts.json),
    quiet: Boolean(opts.quiet),
  };
  return runtime;
}

export function getConfig(): XzmConfig {
  return runtime;
}

export function sessionPath(root = findRepoRoot()): string {
  return path.join(xzmDir(root), "session.json");
}

export type SessionState = {
  conversationId?: string;
  projectId?: string;
};

export function loadSession(root = findRepoRoot()): SessionState {
  const p = sessionPath(root);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SessionState;
  } catch {
    return {};
  }
}

export function saveSession(state: SessionState, root = findRepoRoot()): void {
  ensureXzmDir(root);
  fs.writeFileSync(sessionPath(root), JSON.stringify(state, null, 2) + "\n", "utf8");
}
