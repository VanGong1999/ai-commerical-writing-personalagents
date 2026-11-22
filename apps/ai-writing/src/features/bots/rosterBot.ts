import type { Bot, RosterColleague } from "../../api/client";
import { teamColor } from "../agent-chat/useAgentDirectory";

export function colleagueBotId(c: RosterColleague): string {
  return c.agentId || c.id;
}

export function rosterColleagueToBot(c: RosterColleague): Bot {
  const id = colleagueBotId(c);
  return {
    id,
    name: c.displayName || c.catalogName || c.name,
    aliases: c.aliases || [],
    avatar: { emoji: c.emoji, color: c.teamColor || teamColor(c.team) },
    persona: c.summary || c.name,
    tone: "",
    duties: [],
    neverDo: [],
    roleKind: c.roleKind || c.team,
    delegateOnly: false,
    allowedAgentIds: c.agentId ? [c.agentId] : [],
    toolAllowlist: (c.tools || []).map((t) => t.id),
    modelProfile: "",
    trustLevel: 2,
    vetoWindowMin: 0,
    restateBeforeAct: false,
    pinned: Boolean(c.pinned),
    isSystem: Boolean(c.isVirtual) || id === "chief" || id === "eggbot",
    status: "active",
    ownerUserId: "",
    createdAt: "",
    updatedAt: "",
  };
}

export function flattenRoster(roster: {
  chief: RosterColleague;
  eggbot: RosterColleague;
  teams: Array<{ members: RosterColleague[] }>;
}): RosterColleague[] {
  const all: RosterColleague[] = [roster.chief, roster.eggbot];
  for (const g of roster.teams) all.push(...g.members);
  return all;
}