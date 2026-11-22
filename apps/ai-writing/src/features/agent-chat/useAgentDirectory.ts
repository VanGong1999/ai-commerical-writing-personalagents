import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type AgentCatalogItem, type BotAvatar } from "../../api/client";
import { ownerBotsQuery } from "../bots/ownerBotsQuery";

export const CHIEF = {
  id: "chief",
  name: "总编",
  persona: "总编",
  team: "编排",
} as const;

export type AgentInfo = {
  id: string;
  name: string;
  persona: string;
  team: string;
  summary?: string;
  avatar?: BotAvatar;
};

const TEAM_COLOR: Record<string, string> = {
  编排: "#6366f1",
  选题: "#f59e0b",
  结构: "#06b6d4",
  人设: "#ec4899",
  正文: "#22c55e",
  审校: "#ef4444",
  钩子: "#a855f7",
  拆书: "#14b8a6",
  知识: "#3b82f6",
  换元: "#eab308",
  男频: "#0ea5e9",
  女频: "#f472b6",
  IP: "#84cc16",
  交付: "#64748b",
  记忆: "#8b5cf6",
  场景: "#f97316",
  其他: "#94a3b8",
};

export function teamColor(team?: string): string {
  return TEAM_COLOR[team || "其他"] || TEAM_COLOR["其他"];
}

export function useAgentDirectory() {
  const [agents, setAgents] = useState<AgentCatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { data: bots } = useQuery(ownerBotsQuery);
  const botsById = useMemo(() => new Map(bots?.map((bot) => [bot.id, bot])), [bots]);

  useEffect(() => {
    void api
      .listAgentCatalog()
      .then((r) => setAgents(r.agents || []))
      .catch(() => setAgents([]))
      .finally(() => setLoaded(true));
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, AgentInfo>();
    map.set(CHIEF.id, { ...CHIEF });
    for (const a of agents) {
      map.set(a.id, {
        id: a.id,
        name: a.name,
        persona: a.persona || a.name,
        team: a.team || "其他",
        summary: a.summary,
      });
    }
    return map;
  }, [agents]);

  const resolve = (id?: string | null): AgentInfo => {
    if (!id) return { ...CHIEF };
    const clean = id.startsWith("agent:") ? id.slice(6) : id;
    if (clean === "chief" || clean === "assistant") return { ...CHIEF };
    const agent = byId.get(clean);
    if (agent) return agent;

    // Historical actors still need names after a Bot is archived.
    const bot = botsById.get(id) || botsById.get(clean);
    if (bot?.name) {
      return { id: bot.id, name: bot.name, persona: bot.name, team: "其他", avatar: bot.avatar };
    }
    return { id: clean, name: clean, persona: clean, team: "其他" };
  };

  return { agents, byId, resolve, loaded, teamColor };
}
