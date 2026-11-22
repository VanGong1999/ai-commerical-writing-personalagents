/** Reconcile transport acknowledgements by request identity, never message text. */
type CorrelatableMessage = {
  id: string;
  conversationId: string;
  role: string;
  actions?: Array<Record<string, unknown>>;
  optimisticClientMessageId?: string;
};

export function acknowledgedClientIds(message: CorrelatableMessage): Set<string> {
  const correlated = new Set<string>();
  if (message.role === "user") {
    for (const action of message.actions || []) {
      if (action.type !== "inbox_event" || !Array.isArray(action.payloads)) continue;
      for (const payload of action.payloads) {
        if (payload && typeof payload.clientMessageId === "string" && payload.clientMessageId) {
          correlated.add(payload.clientMessageId);
        }
      }
    }
  }
  return correlated;
}

export function reconcileMessage<T extends CorrelatableMessage>(previous: T[], incoming: T): T[] {
  const correlated = acknowledgedClientIds(incoming);
  let inserted = false;
  const result: T[] = [];
  for (const message of previous) {
    const match = message.conversationId === incoming.conversationId && (
      message.id === incoming.id ||
      (message.role === "user" && message.optimisticClientMessageId && correlated.has(message.optimisticClientMessageId))
    );
    if (match) {
      if (!inserted) result.push(incoming);
      inserted = true;
    } else result.push(message);
  }
  if (!inserted) result.push(incoming);
  return result;
}
