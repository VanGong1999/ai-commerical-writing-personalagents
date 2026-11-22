import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

type Project = {
  id: string;
  title?: string;
  format?: string;
  status?: string;
  stage?: string;
};

function asList<T>(data: T[] | { items?: T[] }): T[] {
  return Array.isArray(data) ? data : data.items || [];
}

export function registerProjects(program: Command): void {
  const projects = program.command("projects").description("项目 CRUD / 快照 / 回放");

  projects
    .command("list")
    .description("列出项目")
    .action(async () => {
      const items = asList(await api<Project[] | { items?: Project[] }>("GET", "/projects"));
      if (getConfig().json) {
        out(items);
        return;
      }
      out(
        null,
        table(
          items.map((p) => ({
            id: p.id,
            title: p.title ?? "",
            format: p.format ?? "",
            status: p.status ?? "",
            stage: p.stage ?? "",
          })),
          ["id", "title", "format", "status", "stage"],
        ),
      );
    });

  projects
    .command("get")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("GET", `/projects/${id}`));
    });

  projects
    .command("create")
    .requiredOption("-t, --title <title>", "标题")
    .requiredOption(
      "-f, --format <format>",
      "manju|duanju|short_novel|male_long|female_long|ip_adapt",
    )
    .option("--market <market>", "cn|overseas|both", "cn")
    .option("--start-from <mode>", "blank|kb_dissect|existing_hook|ip", "blank")
    .option("--source-doc <id>", "关联 KB 文档")
    .action(
      async (opts: {
        title: string;
        format: string;
        market: string;
        startFrom: string;
        sourceDoc?: string;
      }) => {
        const p = await api<Project>("POST", "/projects", {
          title: opts.title,
          format: opts.format,
          market: opts.market,
          startFrom: opts.startFrom,
          sourceDocId: opts.sourceDoc,
        });
        out(p, `created ${p.id}`);
      },
    );

  projects
    .command("patch")
    .argument("<id>")
    .option("-t, --title <title>")
    .option("--status <status>")
    .option("--stage <stage>")
    .option("--tags <csv>", "genre_tags 逗号分隔")
    .option("--budget <n>", "budgetTokens")
    .action(
      async (
        id: string,
        opts: { title?: string; status?: string; stage?: string; tags?: string; budget?: string },
      ) => {
        const body: Record<string, unknown> = {};
        if (opts.title) body.title = opts.title;
        if (opts.status) body.status = opts.status;
        if (opts.stage) body.stage = opts.stage;
        if (opts.tags) body.genreTags = opts.tags.split(",").map((s) => s.trim()).filter(Boolean);
        if (opts.budget) body.budgetTokens = Number(opts.budget);
        const p = await api("PATCH", `/projects/${id}`, body);
        out(p, `patched ${id}`);
      },
    );

  projects
    .command("rm")
    .argument("<id>")
    .action(async (id: string) => {
      await api("DELETE", `/projects/${id}`);
      out({ deleted: id }, `deleted ${id}`);
    });

  projects
    .command("duplicate")
    .argument("<id>")
    .action(async (id: string) => {
      const p = await api<Project>("POST", `/projects/${id}/duplicate`);
      out(p, `duplicated -> ${p.id}`);
    });

  projects
    .command("replay")
    .argument("<id>")
    .description("项目级 replay")
    .action(async (id: string) => {
      out(await api("GET", `/projects/${id}/replay`));
    });

  projects
    .command("analytics")
    .argument("<id>")
    .description("analytics-charts")
    .action(async (id: string) => {
      out(await api("GET", `/projects/${id}/analytics-charts`));
    });

  const snaps = projects.command("snapshots").description("项目快照");

  snaps
    .command("list")
    .argument("<projectId>")
    .action(async (projectId: string) => {
      out(await api("GET", `/projects/${projectId}/snapshots`));
    });

  snaps
    .command("create")
    .argument("<projectId>")
    .option("-l, --label <label>", "标签")
    .action(async (projectId: string, opts: { label?: string }) => {
      out(
        await api("POST", `/projects/${projectId}/snapshots`, { label: opts.label }),
        `snapshot created`,
      );
    });

  snaps
    .command("restore")
    .argument("<projectId>")
    .argument("<snapshotId>")
    .action(async (projectId: string, snapshotId: string) => {
      out(
        await api("POST", `/projects/${projectId}/snapshots/${snapshotId}/restore`),
        `restored ${snapshotId}`,
      );
    });

  projects
    .command("logic-ack")
    .argument("<id>")
    .description("确认逻辑大纲")
    .action(async (id: string) => {
      out(await api("POST", `/projects/${id}/logic-ack`, {}), `logic-ack ${id}`);
    });
}
