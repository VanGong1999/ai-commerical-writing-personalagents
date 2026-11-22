import { Command } from "commander";
import { getConfig } from "../config.js";
import { out, table } from "../format.js";
import { api } from "../http.js";

type Bot = { id: string; name?: string; kind?: string; pinned?: boolean };

function asList<T>(data: T[] | { items?: T[] }): T[] {
  return Array.isArray(data) ? data : data.items || [];
}

export function registerBots(program: Command): void {
  const bots = program.command("bots").description("Bot / Team / Roster");

  bots
    .command("list")
    .action(async () => {
      const items = asList(await api<Bot[] | { items?: Bot[] }>("GET", "/bots"));
      if (getConfig().json) {
        out(items);
        return;
      }
      out(
        null,
        table(
          items.map((b) => ({
            id: b.id,
            name: b.name ?? "",
            kind: b.kind ?? "",
            pinned: b.pinned ?? "",
          })),
          ["id", "name", "kind", "pinned"],
        ),
      );
    });

  bots
    .command("get")
    .argument("<botId>")
    .action(async (botId: string) => {
      out(await api("GET", `/bots/${botId}`));
    });

  bots
    .command("roster")
    .action(async () => {
      out(await api("GET", "/bots/roster"));
    });

  bots
    .command("templates")
    .action(async () => {
      out(await api("GET", "/bots/templates"));
    });

  bots
    .command("squads")
    .action(async () => {
      out(await api("GET", "/bots/squads"));
    });

  bots
    .command("teams")
    .action(async () => {
      out(await api("GET", "/bots/teams"));
    });

  bots
    .command("memories")
    .argument("<botId>")
    .action(async (botId: string) => {
      out(await api("GET", `/bots/${botId}/memories`));
    });

  bots
    .command("skills")
    .argument("<botId>")
    .action(async (botId: string) => {
      out(await api("GET", `/bots/${botId}/skills`));
    });

  bots
    .command("usage")
    .argument("<botId>")
    .action(async (botId: string) => {
      out(await api("GET", `/bots/${botId}/usage`));
    });

  bots
    .command("pin")
    .argument("<botId>")
    .action(async (botId: string) => {
      out(await api("POST", `/bots/${botId}/pin`, {}));
    });

  bots
    .command("export")
    .argument("<botId>")
    .action(async (botId: string) => {
      out(await api("GET", `/bots/${botId}/export`));
    });
}
