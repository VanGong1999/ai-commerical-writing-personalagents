import type { Conversation } from "../../api/client";

/** Automatic assistant routing must never inherit a specialist or group chat. */
export function findChiefConversation(conversations: Conversation[], chiefId = "chief"): Conversation | undefined {
  return conversations.find(c => c.source === "assistant" && c.kind === "dm" && (!c.botId || c.botId === chiefId));
}
