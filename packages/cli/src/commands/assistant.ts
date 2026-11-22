import { Command } from "commander";
import { out } from "../format.js";
import { api } from "../http.js";

export function registerAssistant(program: Command): void {
  const assistant = program
    .command("assistant")
    .description("旧版同步助手（非 PA SSE）");

  assistant
    .command("chat")
    .argument("<message...>")
    .option("-p, --project <id>")
    .option("--format <format>")
    .option("--path <path>")
    .action(
      async (
        messageParts: string[],
        opts: { project?: string; format?: string; path?: string },
      ) => {
        out(
          await api("POST", "/assistant/chat", {
            message: messageParts.join(" "),
            projectId: opts.project,
            format: opts.format,
            path: opts.path,
          }),
        );
      },
    );

  assistant
    .command("llm-chat")
    .argument("<message...>")
    .option("-p, --project <id>")
    .option("--format <format>")
    .action(async (messageParts: string[], opts: { project?: string; format?: string }) => {
      out(
        await api("POST", "/assistant/llm-chat", {
          message: messageParts.join(" "),
          projectId: opts.project,
          format: opts.format,
        }),
      );
    });

  assistant
    .command("context")
    .option("-p, --project <id>")
    .action(async (opts: { project?: string }) => {
      const q = opts.project ? `?projectId=${encodeURIComponent(opts.project)}` : "";
      out(await api("GET", `/assistant/context${q}`));
    });

  assistant
    .command("cowrite")
    .requiredOption("--body <json>")
    .action(async (opts: { body: string }) => {
      out(await api("POST", "/assistant/cowrite", JSON.parse(opts.body)));
    });
}
