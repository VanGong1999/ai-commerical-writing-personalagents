import fs from "node:fs";
import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

type Artifact = {
  id: string;
  type?: string;
  title?: string;
  version?: number;
  status?: string;
  bodyMarkdown?: string;
  content?: string;
};

function asList<T>(data: T[] | { items?: T[] }): T[] {
  return Array.isArray(data) ? data : data.items || [];
}

export function registerArtifacts(program: Command): void {
  const artifacts = program.command("artifacts").description("项目产物");

  artifacts
    .command("list")
    .requiredOption("-p, --project <id>", "项目 ID")
    .action(async (opts: { project: string }) => {
      const items = asList(
        await api<Artifact[] | { items?: Artifact[] }>(
          "GET",
          `/projects/${opts.project}/artifacts`,
        ),
      );
      if (getConfig().json) {
        out(items);
        return;
      }
      out(
        null,
        table(
          items.map((a) => ({
            id: a.id,
            type: a.type ?? "",
            title: a.title ?? "",
            status: a.status ?? "",
            version: a.version ?? "",
          })),
          ["id", "type", "title", "status", "version"],
        ),
      );
    });

  artifacts
    .command("get")
    .requiredOption("-p, --project <id>", "项目 ID")
    .argument("<artifactId>")
    .action(async (artifactId: string, opts: { project: string }) => {
      out(await api("GET", `/projects/${opts.project}/artifacts/${artifactId}`));
    });

  artifacts
    .command("create")
    .requiredOption("-p, --project <id>")
    .requiredOption("--type <type>", "产物类型")
    .requiredOption("-t, --title <title>")
    .option("--body <markdown>", "正文 markdown")
    .option("--body-file <path>", "从文件读 markdown")
    .option("--status <status>", "candidate|adopted|…", "candidate")
    .option("--json-body <json>", "body_json")
    .action(
      async (opts: {
        project: string;
        type: string;
        title: string;
        body?: string;
        bodyFile?: string;
        status: string;
        jsonBody?: string;
      }) => {
        const bodyMarkdown =
          opts.bodyFile != null
            ? fs.readFileSync(opts.bodyFile, "utf8")
            : opts.body ?? "";
        const a = await api("POST", `/projects/${opts.project}/artifacts`, {
          type: opts.type,
          title: opts.title,
          bodyMarkdown,
          bodyJson: opts.jsonBody ? JSON.parse(opts.jsonBody) : undefined,
          status: opts.status,
        });
        out(a, `created ${(a as Artifact).id}`);
      },
    );

  artifacts
    .command("patch")
    .requiredOption("-p, --project <id>")
    .argument("<artifactId>")
    .option("-t, --title <title>")
    .option("--body <markdown>")
    .option("--body-file <path>")
    .option("--status <status>")
    .action(
      async (
        artifactId: string,
        opts: {
          project: string;
          title?: string;
          body?: string;
          bodyFile?: string;
          status?: string;
        },
      ) => {
        const body: Record<string, unknown> = {};
        if (opts.title) body.title = opts.title;
        if (opts.status) body.status = opts.status;
        if (opts.bodyFile) body.bodyMarkdown = fs.readFileSync(opts.bodyFile, "utf8");
        else if (opts.body != null) body.bodyMarkdown = opts.body;
        out(
          await api("PATCH", `/projects/${opts.project}/artifacts/${artifactId}`, body),
          `patched ${artifactId}`,
        );
      },
    );

  artifacts
    .command("rm")
    .requiredOption("-p, --project <id>")
    .argument("<artifactId>")
    .action(async (artifactId: string, opts: { project: string }) => {
      await api("DELETE", `/projects/${opts.project}/artifacts/${artifactId}`);
      out({ deleted: artifactId }, `deleted ${artifactId}`);
    });

  artifacts
    .command("adopt")
    .requiredOption("-p, --project <id>")
    .argument("<artifactId>")
    .option("--mode <mode>", "draft|strong", "strong")
    .action(async (artifactId: string, opts: { project: string; mode: string }) => {
      out(
        await api("POST", `/projects/${opts.project}/artifacts/${artifactId}/adopt`, {
          mode: opts.mode,
        }),
        `adopted ${artifactId}`,
      );
    });

  artifacts
    .command("versions")
    .requiredOption("-p, --project <id>")
    .argument("<artifactId>")
    .action(async (artifactId: string, opts: { project: string }) => {
      out(
        await api(
          "GET",
          `/projects/${opts.project}/artifacts/${artifactId}/versions`,
        ),
      );
    });

  artifacts
    .command("rollback")
    .requiredOption("-p, --project <id>")
    .argument("<artifactId>")
    .argument("<versionId>")
    .action(async (artifactId: string, versionId: string, opts: { project: string }) => {
      out(
        await api(
          "POST",
          `/projects/${opts.project}/artifacts/${artifactId}/versions/${versionId}/rollback`,
        ),
        `rolled back to ${versionId}`,
      );
    });
}
