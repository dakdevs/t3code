import { MessageId, TurnId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectFinalAssistantMessage } from "./command-quick-action-selection.ts";

const turnId = TurnId.make("turn-1");
const message = (
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  streaming = false,
): OrchestrationMessage => ({
  id: MessageId.make(id),
  role,
  text,
  turnId,
  streaming,
  createdAt: "2026-08-09T12:00:00.000Z",
  updatedAt: "2026-08-09T12:00:00.000Z",
});

describe("selectFinalAssistantMessage", () => {
  it("returns only the last completed assistant response for the turn", () => {
    const intermediate = message("assistant-intermediate", "assistant", "intermediate");
    const final = message("assistant-final", "assistant", "final");
    const messages = [
      message("user", "user", "request"),
      intermediate,
      message("assistant-streaming", "assistant", "partial", true),
      final,
    ];

    expect(selectFinalAssistantMessage(messages, turnId)).toBe(final);
  });

  it("does not select a message from another turn", () => {
    expect(
      selectFinalAssistantMessage(
        [{ ...message("assistant", "assistant", "response"), turnId: TurnId.make("turn-2") }],
        turnId,
      ),
    ).toBeUndefined();
  });
});
