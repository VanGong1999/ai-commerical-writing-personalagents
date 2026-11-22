import type { UsageEvent } from "@xiezuomanju/domain";
import type { Bot, UsageSummary } from "../../api/client";

type UsageActor = Pick<UsageEvent, "botId"> & { agentId?: string | null };
type Usage = UsageActor & Pick<UsageEvent, "promptTokens" | "completionTokens">;
type BotName = Pick<Bot, "id" | "name">;
type SummaryName = Pick<NonNullable<UsageSummary["byBot"]>[number], "botId" | "name">;

const UNATTRIBUTED = "unattributed";

export function usageActorNames(bots: readonly BotName[], byBot: readonly SummaryName[] = []) {
  const names = new Map(byBot.map(({ botId, name }) => [botId, name]));
  for (const { id, name } of bots) {
    if (name) names.set(id, name);
  }
  return (id: string) => names.get(id) || (id === UNATTRIBUTED ? "未归属" : id);
}

export function usageActorId({ botId, agentId }: UsageActor) {
  // /usage uses the server's canonical attribution, including legacy aliases.
  return botId || agentId || UNATTRIBUTED;
}

export function usageByAgent(usage: readonly Usage[], name: (id: string) => string) {
  const totals = new Map<string, number>();
  for (const u of usage) {
    const id = usageActorId(u);
    totals.set(id, (totals.get(id) ?? 0) + u.promptTokens + u.completionTokens);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => ({ format: id, label: name(id), value }));
}
