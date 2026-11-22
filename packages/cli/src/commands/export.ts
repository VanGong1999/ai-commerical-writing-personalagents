import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { out } from "../format.js";
import { api, apiBinary } from "../http.js";

type Artifact = {
  id: string;
  type?: string;
  title?: string;
  content?: string;
  body?: string;
  text?: string;
};

export function registerExport(program: Command): void {
  program
    .command("export")
    .description("导出项目产物为 txt/md/docx/pdf")
    .argument("<projectId>")
    .option("-f, --format <format>", "txt|md|docx|pdf", "md")
    .option("-o, --out <path>", "输出路径")
    .option("-t, --title <title>", "导出标题")
    .action(
      async (projectId: string, opts: { format: string; out?: string; title?: string }) => {
        const format = opts.format as "txt" | "md" | "docx" | "pdf";
        const proj = await api<{ title?: string }>("GET", `/projects/${projectId}`);
        const arts = await api<Artifact[] | { items?: Artifact[] }>(
          "GET",
          `/projects/${projectId}/artifacts`,
        );
        const items = Array.isArray(arts) ? arts : arts.items || [];
        const sections = items
          .map((a) => ({
            heading: a.title || a.type || a.id,
            body: String(a.content ?? a.body ?? a.text ?? ""),
          }))
          .filter((s) => s.body.trim());

        if (!sections.length) {
          // still allow empty export with title only
          sections.push({ heading: "empty", body: "(no artifacts)" });
        }

        const body = {
          title: opts.title || proj.title || "未命名",
          format,
          sections,
        };

        const { buffer, filename } = await apiBinary("POST", `/projects/${projectId}/export`, body);
        const outPath =
          opts.out ||
          path.resolve(process.cwd(), filename || `export-${projectId}.${format}`);
        fs.writeFileSync(outPath, buffer);
        out({ path: outPath, bytes: buffer.length }, `wrote ${outPath} (${buffer.length} bytes)`);
      },
    );
}
