import { Command } from "commander";
import { out } from "../format.js";
import { api } from "../http.js";

export function registerMemory(program: Command): void {
  const memory = program.command("memory").description("Memory 文件树 / 搜索");

  memory
    .command("tree")
    .action(async () => {
      out(await api("GET", "/memory/tree"));
    });

  memory
    .command("get")
    .requiredOption("--path <path>", "文件路径")
    .action(async (opts: { path: string }) => {
      out(await api("GET", `/memory/file?path=${encodeURIComponent(opts.path)}`));
    });

  memory
    .command("put")
    .requiredOption("--path <path>")
    .requiredOption("--body <json>", "写入体（含 content 等）")
    .action(async (opts: { path: string; body: string }) => {
      const body = { ...JSON.parse(opts.body), path: opts.path };
      out(await api("PUT", "/memory/file", body));
    });

  memory
    .command("rm")
    .requiredOption("--path <path>")
    .action(async (opts: { path: string }) => {
      out(
        await api("DELETE", `/memory/file?path=${encodeURIComponent(opts.path)}`),
        `deleted ${opts.path}`,
      );
    });

  memory
    .command("search")
    .argument("<q>")
    .option("--body <json>", "额外字段 JSON")
    .action(async (q: string, opts: { body?: string }) => {
      const body = { ...(opts.body ? JSON.parse(opts.body) : {}), query: q, q };
      out(await api("POST", "/memory/search", body));
    });

  memory
    .command("versions")
    .requiredOption("--path <path>")
    .action(async (opts: { path: string }) => {
      out(await api("GET", `/memory/versions?path=${encodeURIComponent(opts.path)}`));
    });
}
