import type { QueryClient } from "@tanstack/react-query";
import type { api, BotTeam, Conversation } from "../../api/client";

const conversationsKey = ["conversations"];

export async function resolveTeamConversation(
  cache: QueryClient,
  client: Pick<typeof api, "listConversations" | "createConversation" | "listSquads">,
  team: BotTeam,
  created?: Conversation,
  projectId?:string,
): Promise<Conversation> {
  if (!created) {
    const conversations = await cache.ensureQueryData({
      queryKey: conversationsKey,
      queryFn: () => client.listConversations(),
    });
    const candidates = conversations.filter((c) => c.kind === "group" && c.teamId === team.id && (c.projectId || "") === (projectId || ""));
    const withStages = team.templateId && candidates.find((c) => {
      const stages = c.groupRules?.stages;
      return Array.isArray(stages) && stages.length > 0;
    });
    const existing = withStages || candidates[0];
    if (existing) return existing;

    const template = team.templateId
      ? (await cache.ensureQueryData({
          queryKey: ["bot-squads"],
          queryFn: () => client.listSquads(),
        })).squads.find((s) => s.id === team.templateId)
      : undefined;
    created = await client.createConversation({
      title: team.name,
      kind: "group", projectId: projectId || undefined,
      teamId: team.id,
      memberBotIds: team.memberBotIds,
      groupRules: {
        rulesMd: team.rulesMd,
        speakPolicy: team.speakPolicy,
        truth_source_path: team.truthSourcePath,
        ...(template && { format: template.format ?? null, stages: template.stages }),
      },
    });
  }

  if ((created.projectId || "") !== (projectId || "") || created.teamId !== team.id || created.kind !== "group") {
    throw new Error("编组会话与所选项目不匹配");
  }
  const conversation = created;
  await cache.cancelQueries({ queryKey: conversationsKey, exact: true });
  cache.setQueryData<Conversation[]>(conversationsKey, (previous = []) => [
    conversation,
    ...previous.filter((item) => item.id !== conversation.id),
  ]);
  void cache.invalidateQueries({ queryKey: conversationsKey, exact: true });
  return conversation;
}

export async function selectTeamConversation(
  generation: { current: number },
  projectId: string,
  load: () => Promise<Conversation>,
  select: (conversation: Conversation) => void,
  generationAtCreation?: number,
) {
  if (generationAtCreation !== undefined && generationAtCreation !== generation.current) return;
  const request = ++generation.current;
  const conversation = await load();
  if (request === generation.current && (conversation.projectId || "") === projectId) select(conversation);
}
