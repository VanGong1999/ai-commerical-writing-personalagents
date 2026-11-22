import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { getConfig, loadSession, saveSession } from "../config.js";
import { err, out } from "../format.js";
import { api, sleep } from "../http.js";
import { chatOnce } from "../sse.js";

async function ensureConversation(opts: {
  conversationId?: string;
  projectId?: string;
  forceNew?: boolean;
}): Promise<{ conversationId: string; projectId?: string }> {
  const session = loadSession();
  if (!opts.forceNew && opts.conversationId) {
    return { conversationId: opts.conversationId, projectId: opts.projectId || session.projectId };
  }
  if (!opts.forceNew && !opts.conversationId && session.conversationId) {
    return {
      conversationId: session.conversationId,
      projectId: opts.projectId || session.projectId,
    };
  }

  const conv = await api<{ id: string }>("POST", "/conversations", {
    source: "assistant",
    title: "xzm-cli",
    projectId: opts.projectId,
  });
  const state = {
    conversationId: conv.id,
    projectId: opts.projectId || session.projectId,
  };
  saveSession(state);
  return state;
}

async function sendChat(
  conversationId: string,
  message: string,
  projectId?: string,
): Promise<Record<string, unknown> | null> {
  const json = getConfig().json;
  let lastErr: unknown = null;
  for (let i = 0; i < 4; i++) {
    try {
      const done = await chatOnce(conversationId, message, projectId, (ev) => {
        if (json) return;
        const name = String(ev.event || "");
        if (name === "token") {
          const t = ev.token ?? ev.text ?? ev.delta;
          if (t != null) process.stdout.write(String(t));
          return;
        }
        if (name === "confirm") {
          out(null, `\n[confirm] 需要确认：${JSON.stringify(ev).slice(0, 300)}`);
          out(null, `用: xzm convs respond ${conversationId} --approve|--reject`);
          return;
        }
        if (name === "tool_result") {
          out(null, `\n[tool] ${JSON.stringify(ev).slice(0, 200)}`);
        }
      });

      if (!done || typeof done !== "object") {
        lastErr = new Error("chat empty SSE");
      } else {
        const msg = String(done.message || done.reply || "");
        if (done.event === "error" || /529|502|503|overloaded|Server error/i.test(msg)) {
          lastErr = new Error(`chat upstream: ${done.message || done.event}`);
        } else if (done.queued) {
          lastErr = new Error(`chat queued: ${msg.slice(0, 120)}`);
        } else {
          if (json) {
            out(done);
          } else {
            process.stdout.write("\n");
          }
          return done;
        }
      }
    } catch (e) {
      lastErr = e;
      const m = String((e as Error)?.message || e);
      if (
        !/ECONNRESET|UND_ERR_SOCKET|UND_ERR_BODY_TIMEOUT|Body Timeout|terminated|fetch failed|ECONNREFUSED|other side closed|AbortError|SSE timeout|socket hang up/i.test(
          m,
        )
      ) {
        throw e;
      }
    }
    await sleep(3000 * (i + 1));
  }
  throw lastErr || new Error("chat failed");
}

async function repl(projectId?: string): Promise<void> {
  const { conversationId, projectId: pid } = await ensureConversation({ projectId });
  out(null, `会话 ${conversationId}${pid ? ` project=${pid}` : ""}（空行退出）`);
  const rl = readline.createInterface({ input, output });
  try {
    for (;;) {
      const line = (await rl.question("you> ")).trim();
      if (!line) break;
      try {
        process.stdout.write("bot> ");
        await sendChat(conversationId, line, pid);
      } catch (e) {
        err(String((e as Error).message || e));
      }
    }
  } finally {
    rl.close();
  }
}

export function registerChat(program: Command): void {
  program
    .command("chat")
    .description("Headless PA 对话（SSE）；无消息进入 REPL")
    .argument("[message...]", "单次消息")
    .option("-p, --project <id>", "项目 ID")
    .option("-c, --conversation <id>", "会话 ID")
    .option("--new", "强制新建会话")
    .action(
      async (
        messageParts: string[],
        opts: { project?: string; conversation?: string; new?: boolean },
      ) => {
        const message = (messageParts || []).join(" ").trim();
        if (!message) {
          await repl(opts.project);
          return;
        }
        const { conversationId, projectId } = await ensureConversation({
          conversationId: opts.conversation,
          projectId: opts.project,
          forceNew: Boolean(opts.new),
        });
        if (!getConfig().json) {
          out(null, `conv=${conversationId}`);
        }
        await sendChat(conversationId, message, projectId);
        saveSession({ conversationId, projectId });
      },
    );
}
