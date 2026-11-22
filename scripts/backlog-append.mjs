#!/usr/bin/env node
/**
 * 单文件 backlog 追加器：只向 BACKLOG.md 末尾追加一个 phase 块，绝不重写历史。
 * 用法：
 *   node scripts/backlog-append.mjs -- "标题" --status done|doing|todo --body "正文"
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKLOG = join(ROOT, "BACKLOG.md");

const args = process.argv.slice(2);
const titleIdx = args.indexOf("--");
const title = titleIdx >= 0 ? args[titleIdx + 1] : "";
const statusIdx = args.indexOf("--status");
const status = statusIdx >= 0 ? args[statusIdx + 1] : "todo";
const bodyIdx = args.indexOf("--body");
const body = bodyIdx >= 0 ? args[bodyIdx + 1] : "";

if (!title) {
  console.error('用法: backlog-append -- "标题" [--status done|doing|todo] [--body "正文"]');
  process.exit(2);
}

if (!["done", "doing", "todo"].includes(status)) {
  console.error("--status 必须是 done|doing|todo");
  process.exit(2);
}

const raw = readFileSync(BACKLOG, "utf8");
const matches = [...raw.matchAll(/## phase (\d{3}) /g)];
const next = String((matches.length ? Number(matches[matches.length - 1][1]) : 0) + 1).padStart(3, "0");
const date = new Date().toISOString().slice(0, 10);
const block = [
  "",
  `## phase ${next} · ${date} · ${status}`,
  "",
  body || `- ${title}`,
  "",
].join("\n");

appendFileSync(BACKLOG, block, "utf8");
console.log(`appended phase ${next} · ${status} · ${title}`);
