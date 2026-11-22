import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api, apiForm } from "../http.js";

type Doc = { id: string; title?: string; docType?: string; status?: string; tags?: string[] };

function asList<T>(data: T[] | { items?: T[] }): T[] {
  return Array.isArray(data) ? data : data.items || [];
}

export function registerKb(program: Command): void {
  const kb = program.command("kb").description("知识库检索 / 文档 / 桥段 / 热点");

  kb
    .command("search")
    .argument("<q>", "查询词")
    .option("--knowledge", "走 /kb/knowledge/search（hybrid）")
    .option("--web", "includeWeb=true（仅 /kb/search）")
    .action(async (q: string, opts: { knowledge?: boolean; web?: boolean }) => {
      const pathQs = opts.knowledge
        ? `/kb/knowledge/search?q=${encodeURIComponent(q)}`
        : `/kb/search?q=${encodeURIComponent(q)}${opts.web ? "&includeWeb=true" : ""}`;
      out(await api("GET", pathQs));
    });

  kb
    .command("reindex")
    .description("knowledge reindex")
    .option("--body <json>", "{}", "{}")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/kb/knowledge/reindex", JSON.parse(opts.body)));
    });

  const docs = kb.command("docs").description("KB 文档");

  docs
    .command("list")
    .action(async () => {
      const items = asList(await api<Doc[] | { items?: Doc[] }>("GET", "/kb/docs"));
      if (getConfig().json) {
        out(items);
        return;
      }
      out(
        null,
        table(
          items.map((d) => ({
            id: d.id,
            title: d.title ?? "",
            docType: d.docType ?? "",
            status: d.status ?? "",
          })),
          ["id", "title", "docType", "status"],
        ),
      );
    });

  docs
    .command("get")
    .argument("<docId>")
    .action(async (docId: string) => {
      out(await api("GET", `/kb/docs/${encodeURIComponent(docId)}`));
    });

  docs
    .command("text")
    .argument("<docId>")
    .action(async (docId: string) => {
      out(await api("GET", `/kb/docs/${encodeURIComponent(docId)}/text`));
    });

  docs
    .command("upload")
    .requiredOption("-t, --title <title>")
    .option("--type <docType>", "notes|book|…", "notes")
    .option("--tags <csv>")
    .option("--file <path>", "上传文件")
    .option("--content <text>", "内联文本")
    .option("--content-file <path>", "从文件读文本")
    .action(
      async (opts: {
        title: string;
        type: string;
        tags?: string;
        file?: string;
        content?: string;
        contentFile?: string;
      }) => {
        const qs = new URLSearchParams({
          title: opts.title,
          doc_type: opts.type,
        });
        if (opts.tags) qs.set("tags", opts.tags);
        const form = new FormData();
        if (opts.file) {
          const buf = fs.readFileSync(opts.file);
          const name = path.basename(opts.file);
          form.append("file", new File([buf], name));
        } else {
          const text =
            opts.contentFile != null
              ? fs.readFileSync(opts.contentFile, "utf8")
              : opts.content ?? "";
          form.append("content", text);
        }
        const doc = await apiForm(`/kb/docs?${qs.toString()}`, form);
        out(doc, `uploaded ${(doc as Doc).id}`);
      },
    );

  docs
    .command("rm")
    .argument("<docId>")
    .action(async (docId: string) => {
      out(await api("DELETE", `/kb/docs/${encodeURIComponent(docId)}`), `deleted ${docId}`);
    });

  docs
    .command("analyze")
    .argument("<docId>")
    .option("--body <json>", "{}", "{}")
    .action(async (docId: string, opts: { body: string }) => {
      out(
        await api("POST", `/kb/docs/${encodeURIComponent(docId)}/analyze`, JSON.parse(opts.body)),
      );
    });

  docs
    .command("reports")
    .argument("<docId>")
    .action(async (docId: string) => {
      out(await api("GET", `/kb/docs/${encodeURIComponent(docId)}/reports`));
    });

  docs
    .command("graph")
    .argument("<docId>")
    .action(async (docId: string) => {
      out(await api("GET", `/kb/graph/${encodeURIComponent(docId)}`));
    });

  docs
    .command("similar")
    .argument("<docId>")
    .action(async (docId: string) => {
      out(await api("GET", `/kb/similar/${encodeURIComponent(docId)}`));
    });

  docs
    .command("push")
    .argument("<docId>")
    .requiredOption("-p, --project <projectId>")
    .option("--body <json>", "{}", "{}")
    .action(async (docId: string, opts: { project: string; body: string }) => {
      const body = { ...JSON.parse(opts.body), projectId: opts.project };
      out(await api("POST", `/kb/docs/${encodeURIComponent(docId)}/push-to-project`, body));
    });

  docs
    .command("move")
    .argument("<docId>")
    .requiredOption("--folder <folderId>")
    .action(async (docId: string, opts: { folder: string }) => {
      out(
        await api("POST", `/kb/docs/${encodeURIComponent(docId)}/move`, {
          folderId: opts.folder,
        }),
      );
    });

  kb
    .command("folders")
    .description("列出文件夹")
    .action(async () => {
      out(await api("GET", "/kb/folders"));
    });

  kb
    .command("mkdir")
    .argument("<name>")
    .action(async (name: string) => {
      out(await api("POST", "/kb/folders", { name }), `folder ${name}`);
    });

  kb
    .command("tropes")
    .action(async () => {
      out(await api("GET", "/kb/tropes"));
    });

  kb
    .command("favorite-trope")
    .argument("<tropeId>")
    .option("-f, --favorited <bool>", "true=收藏 / false=取消收藏", "true")
    .action(async (tropeId: string, opts: { favorited: string }) => {
      const favorited = opts.favorited === "true" || opts.favorited === "1";
      out(
        await api(
          "PATCH",
          `/kb/tropes/${encodeURIComponent(tropeId)}/favorite?favorited=${favorited}`,
        ),
      );
    });

  const hot = kb.command("hotspots").description("热点");

  hot
    .command("list")
    .action(async () => {
      out(await api("GET", "/kb/hotspots"));
    });

  hot
    .command("create")
    .requiredOption("--body <json>")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/kb/hotspots", JSON.parse(opts.body)));
    });

  hot
    .command("rm")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("DELETE", `/kb/hotspots/${encodeURIComponent(id)}`));
    });

  hot
    .command("bind")
    .argument("<id>")
    .requiredOption("--body <json>")
    .action(async (id: string, opts: { body: string }) => {
      out(
        await api(
          "POST",
          `/kb/hotspots/${encodeURIComponent(id)}/bind`,
          JSON.parse(opts.body),
        ),
      );
    });
}
