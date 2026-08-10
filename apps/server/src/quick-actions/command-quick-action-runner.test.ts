import { expect, it, vi } from "@effect/vitest";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { CommandQuickActionRunner, layer } from "./command-quick-action-runner.ts";

const now = "2026-08-09T12:00:00.000Z";
const projectId = ProjectId.make("project-quick-action-runner");
const threadId = ThreadId.make("thread-quick-action-runner");
const messageId = MessageId.make("message-quick-action-runner");
const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Quick action runner",
  workspaceRoot: "/tmp/quick-action-runner",
  defaultModelSelection: null,
  scripts: [],
  createdAt: now,
  updatedAt: now,
};
const thread: OrchestrationThread = {
  id: threadId,
  projectId,
  title: "Quick action runner",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "approval-required",
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [
    {
      id: messageId,
      role: "assistant",
      text: "```sh\nprintf ok\n```",
      quickActions: [{ id: "code-block-1", label: "Run printf ok", command: "printf ok" }],
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const queryLayer = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
  getCommandReadModel: () => Effect.die("unused"),
  getSnapshot: () => Effect.die("unused"),
  getShellSnapshot: () => Effect.die("unused"),
  getArchivedShellSnapshot: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 1 }),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
  getProjectShellById: (id) =>
    Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
  getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
  getThreadCheckpointContext: () => Effect.die("unused"),
  getFullThreadDiffContext: () => Effect.die("unused"),
  getThreadShellById: () => Effect.die("unused"),
  getThreadDetailById: (id) =>
    Effect.succeed(id === threadId ? Option.some(thread) : Option.none()),
  getThreadDetailSnapshot: () => Effect.die("unused"),
  searchThreads: () => Effect.succeed({ matches: [] }),
});

it.effect("runs the stored command exactly and exposes output only to a later message", () => {
  let history = "prompt> ";
  let hasRunningSubprocess = false;
  const write = vi.fn(({ data }: { readonly data: string }) => {
    history += `${data}ok\r\n`;
    hasRunningSubprocess = true;
    return Effect.void;
  });
  const snapshot = () => ({
    threadId,
    terminalId: "term-1",
    cwd: project.workspaceRoot,
    worktreePath: null,
    status: "running" as const,
    pid: 123,
    history,
    exitCode: null,
    exitSignal: null,
    label: "term-1",
    updatedAt: now,
  });
  const terminalLayer = Layer.succeed(TerminalManager.TerminalManager, {
    open: () => Effect.succeed(snapshot()),
    inspect: () => Effect.succeed(Option.some({ snapshot: snapshot(), hasRunningSubprocess })),
    write,
    attachStream: () => Effect.die("unused"),
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () => Effect.die("unused"),
    close: () => Effect.void,
    subscribe: () => Effect.succeed(() => undefined),
    subscribeMetadata: () => Effect.succeed(() => undefined),
  });
  const testLayer = layer.pipe(Layer.provide(queryLayer), Layer.provide(terminalLayer));

  return Effect.gen(function* () {
    const runner = yield* CommandQuickActionRunner;
    expect(
      yield* runner.run({ threadId, messageId, actionId: "code-block-1", terminalId: "term-1" }),
    ).toEqual({ terminalId: "term-1", historyOffset: "prompt> ".length });
    expect(write).toHaveBeenCalledWith({
      threadId,
      terminalId: "term-1",
      data: "printf ok\r",
    });
    expect(yield* runner.takeAvailableOutputContext(threadId)).toBeUndefined();

    hasRunningSubprocess = false;
    expect(yield* runner.takeAvailableOutputContext(threadId)).toBeUndefined();
    yield* TestClock.adjust("2 seconds");
    const context = yield* runner.takeAvailableOutputContext(threadId);
    expect(context).toContain("<terminal_context>");
    expect(context).toContain("printf ok");
    expect(context).toContain("ok");
    expect(yield* runner.takeAvailableOutputContext(threadId)).toBeUndefined();
  }).pipe(Effect.provide(testLayer));
});
