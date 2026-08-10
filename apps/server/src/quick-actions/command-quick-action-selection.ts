import type { OrchestrationMessage, TurnId } from "@t3tools/contracts";

export function selectFinalAssistantMessage(
  messages: ReadonlyArray<OrchestrationMessage>,
  turnId: TurnId,
): OrchestrationMessage | undefined {
  return messages
    .toReversed()
    .find(
      (message) => message.role === "assistant" && message.turnId === turnId && !message.streaming,
    );
}
