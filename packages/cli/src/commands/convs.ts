import { Command } from "commander";
import { getConfig, saveSession } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

type Conv = {
  id: string;
  title?: string;
  source?: string;
  projectId?: string;
  updatedAt?: string;
};

function asList<T>(data: T[] | { items?: T[] }): T[] {
  return Array.isArray(data) ? data : data.items || [];
}

export function registerConvs(program: Command): void {
  const convs = program.command("convs").description("会话管理");

  convs
    .command("list")
    .action(async () => {
      const items = asList(await api<Conv[] | { items?: Conv[] }>("GET", "/conversations"));
      if (getConfig().json) {
        out(items);
        return;
      }
      out(
        null,
        table(
          items.map((c) => ({
            id: c.id,
            title: c.title ?? "",
            source: c.source ?? "",
            projectId: c.projectId ?? "",
          })),
          ["id", "title", "source", "projectId"],
        ),
      );
    });

  convs
    .command("new")
    .option("-t, --title <title>", "标题", "xzm-cli")
    .option("-p, --project <id>")
    .option("--source <source>", "assistant|…", "assistant")
    .action(async (opts: { title: string; project?: string; source: string }) => {
      const conv = await api<Conv>("POST", "/conversations", {
        title: opts.title,
        projectId: opts.project,
        source: opts.source,
      });
      saveSession({ conversationId: conv.id, projectId: opts.project });
      out(conv, `created ${conv.id}`);
    });

  convs
    .command("get")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("GET", `/conversations/${id}`));
    });

  convs
    .command("msgs")
    .argument("<id>", "conversation id")
    .action(async (id: string) => {
      out(await api("GET", `/conversations/${id}/messages`));
    });

  convs
    .command("timeline")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("GET", `/conversations/${id}/timeline`));
    });

  convs
    .command("steps")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("GET", `/conversations/${id}/steps`));
    });

  convs
    .command("runtime")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("GET", `/conversations/${id}/runtime`));
    });

  convs
    .command("inbox")
    .argument("<id>")
    .action(async (id: string) => {
      out(await api("GET", `/conversations/${id}/inbox`));
    });

  convs
    .command("backend")
    .description("PA 后端 overview")
    .action(async () => {
      out(await api("GET", "/conversations/_backend/overview"));
    });

  convs
    .command("respond")
    .argument("<id>", "conversation id")
    .option("--approve", "批准工具调用")
    .option("--reject", "拒绝工具调用")
    .option("--message-id <id>", "messageId")
    .option("--edited-args <json>", "editedArgs JSON")
    .action(
      async (
        id: string,
        opts: { approve?: boolean; reject?: boolean; messageId?: string; editedArgs?: string },
      ) => {
        if (!opts.approve && !opts.reject) {
          throw new Error("需要 --approve 或 --reject");
        }
        let editedArgs: unknown = undefined;
        if (opts.editedArgs) editedArgs = JSON.parse(opts.editedArgs);
        const body = {
          approve: Boolean(opts.approve) && !opts.reject,
          messageId: opts.messageId,
          editedArgs,
        };
        const data = await api("POST", `/conversations/${id}/respond`, body);
        out(data, `responded approve=${body.approve}`);
      },
    );

  convs
    .command("subs")
    .argument("<id>")
    .description("列出 subscriptions")
    .action(async (id: string) => {
      out(await api("GET", `/conversations/${id}/subscriptions`));
    });
}
