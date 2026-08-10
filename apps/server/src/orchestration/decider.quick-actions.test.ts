import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-08-09T12:00:00.000Z";
const projectId = ProjectId.make("project-quick-actions");
const threadId = ThreadId.make("thread-quick-actions");
const messageId = MessageId.make("message-quick-actions");
const turnId = TurnId.make("turn-quick-actions");

const readModelWithAssistantMessage = Effect.gen(function* () {
  const withProject = yield* projectEvent(createEmptyReadModel(now), {
    sequence: 1,
    eventId: EventId.make("event-project-quick-actions"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("command-project-quick-actions"),
    causationEventId: null,
    correlationId: CommandId.make("command-project-quick-actions"),
    metadata: {},
    payload: {
      projectId,
      title: "Quick actions",
      workspaceRoot: "/tmp/quick-actions",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });
  const withThread = yield* projectEvent(withProject, {
    sequence: 2,
    eventId: EventId.make("event-thread-quick-actions"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.created",
    occurredAt: now,
    commandId: CommandId.make("command-thread-quick-actions"),
    causationEventId: null,
    correlationId: CommandId.make("command-thread-quick-actions"),
    metadata: {},
    payload: {
      threadId,
      projectId,
      title: "Quick actions",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "approval-required",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  return yield* projectEvent(withThread, {
    sequence: 3,
    eventId: EventId.make("event-message-quick-actions"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.message-sent",
    occurredAt: now,
    commandId: CommandId.make("command-message-quick-actions"),
    causationEventId: null,
    correlationId: CommandId.make("command-message-quick-actions"),
    metadata: {},
    payload: {
      threadId,
      messageId,
      role: "assistant",
      text: "```sh\nprintf ok\n```",
      turnId,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  });
});

it.layer(NodeServices.layer)("quick action decider commands", (it) => {
  it.effect("persists detected actions as an assistant message update", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: yield* readModelWithAssistantMessage,
        command: {
          type: "thread.message.quick-actions.set",
          commandId: CommandId.make("command-set-quick-actions"),
          threadId,
          messageId,
          quickActions: [{ id: "code-block-1", label: "Run printf ok", command: "printf ok" }],
          createdAt: now,
        },
      });
      const event = Array.isArray(result) ? result[0] : result;
      expect(event).toMatchObject({
        type: "thread.message-sent",
        payload: {
          messageId,
          text: "",
          quickActions: [{ id: "code-block-1", label: "Run printf ok", command: "printf ok" }],
        },
      });
    }),
  );

  it.effect("emits detection only after a completed turn requests it", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: yield* readModelWithAssistantMessage,
        command: {
          type: "thread.quick-actions.detection.request",
          commandId: CommandId.make("command-detect-quick-actions"),
          threadId,
          turnId,
          createdAt: now,
        },
      });
      const event = Array.isArray(result) ? result[0] : result;
      expect(event).toMatchObject({
        type: "thread.quick-actions-detection-requested",
        payload: { threadId, turnId, requestedAt: now },
      });
    }),
  );
});
