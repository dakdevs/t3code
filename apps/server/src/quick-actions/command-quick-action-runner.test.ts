import { expect, it, vi } from "@effect/vitest";
import {
  COMMAND_QUICK_ACTION_COMPLETION_MARKER,
  COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER,
  COMMAND_QUICK_ACTION_START_MARKER,
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
import {
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import {
  buildCommandQuickActionShellInput,
  CommandQuickActionRunner,
  layer,
  withCommandQuickActionExecution,
} from "./command-quick-action-runner.ts";

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

it("records an execution on only the matching message action", () => {
  expect(
    withCommandQuickActionExecution(
      [
        { id: "code-block-1", label: "Run first", command: "first" },
        { id: "code-block-2", label: "Run second", command: "second" },
      ],
      "code-block-2",
      { terminalId: "term-3", historyOffset: 99 },
    ),
  ).toEqual([
    { id: "code-block-1", label: "Run first", command: "first" },
    {
      id: "code-block-2",
      label: "Run second",
      command: "second",
      execution: { terminalId: "term-3", historyOffset: 99 },
    },
  ]);
});

it("builds a POSIX job-control wrapper without changing the stored command", () => {
  const input = buildCommandQuickActionShellInput("printf '%s\\n' \"$USER\"");

  expect(input).toContain("set -m");
  expect(input).toContain('wait "$p"');
  expect(input).toContain("jobs -s -p");
  expect(input).toContain(COMMAND_QUICK_ACTION_START_MARKER);
  expect(input).toContain(COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER);
  expect(input).toContain(COMMAND_QUICK_ACTION_COMPLETION_MARKER);
  expect(input).toContain("T3_CODE_QUICK_ACTION='printf '\"'\"'%s\\n'\"'\"' \"$USER\"'");
  expect(input.endsWith("\r")).toBe(true);
});

it.effect("detects a real PTY read and continues the same job after terminal input", () =>
  Effect.gen(function* () {
    const platform = yield* HostProcessPlatform;
    if (platform === "win32") return;
    const cwd = yield* HostProcessWorkingDirectory;
    const env = yield* HostProcessEnvironment;
    const nodePty = yield* Effect.promise(() => import("node-pty"));
    let sentInput = false;
    const output = yield* Effect.callback<string>((resume) => {
      const shell = nodePty.spawn("/bin/bash", ["--noprofile", "--norc"], {
        cwd,
        cols: 120,
        rows: 24,
        env,
        name: "xterm-256color",
      });
      let transcript = "";
      let settled = false;
      const inputMarker = new RegExp(
        `(?:^|\\r?\\n)${COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER}(?:SIG)?TTIN(?:\\r?\\n|$)`,
      );
      const completionMarker = new RegExp(
        `(?:^|\\r?\\n)${COMMAND_QUICK_ACTION_COMPLETION_MARKER}0(?:\\r?\\n|$)`,
      );
      const dataDisposable = shell.onData((data) => {
        transcript += data;
        if (!sentInput && inputMarker.test(transcript)) {
          sentInput = true;
          shell.write("Dak\r");
        }
        if (!settled && completionMarker.test(transcript)) {
          settled = true;
          dataDisposable.dispose();
          exitDisposable.dispose();
          shell.kill();
          resume(Effect.succeed(transcript));
        }
      });
      const exitDisposable = shell.onExit(() => {
        if (settled) return;
        settled = true;
        dataDisposable.dispose();
        exitDisposable.dispose();
        resume(Effect.die("PTY exited before the quick action completed"));
      });
      shell.write(
        buildCommandQuickActionShellInput('read -r -p "Name: " name; printf "Hello %s\\n" "$name"'),
      );
      return Effect.sync(() => {
        if (settled) return;
        settled = true;
        dataDisposable.dispose();
        exitDisposable.dispose();
        shell.kill();
      });
    });

    expect(sentInput).toBe(true);
    expect(output).toContain("Name: ");
    expect(output).toContain("Hello Dak");
  }),
);

it.effect("rejects command quick actions on native Windows before opening a terminal", () => {
  const open = vi.fn(() => Effect.die("terminal should not open"));
  const terminalLayer = Layer.succeed(TerminalManager.TerminalManager, {
    open,
    inspect: () => Effect.die("unused"),
    write: () => Effect.die("unused"),
    attachStream: () => Effect.die("unused"),
    resize: () => Effect.die("unused"),
    clear: () => Effect.die("unused"),
    restart: () => Effect.die("unused"),
    close: () => Effect.die("unused"),
    subscribe: () => Effect.die("unused"),
    subscribeMetadata: () => Effect.die("unused"),
  });
  const testLayer = layer.pipe(Layer.provide(queryLayer), Layer.provide(terminalLayer));

  return Effect.gen(function* () {
    const runner = yield* CommandQuickActionRunner;
    const error = yield* runner
      .run({ threadId, messageId, actionId: "code-block-1", terminalId: "term-1" })
      .pipe(Effect.flip);

    expect(error.reason).toBe("unavailable");
    expect(error.message).toBe("Command quick actions are unavailable on Windows.");
    expect(open).not.toHaveBeenCalled();
  }).pipe(Effect.provide(testLayer), Effect.provideService(HostProcessPlatform, "win32"));
});

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
  let commandStarted = false;
  const write = vi.fn(({ data }: { readonly data: string }) => {
    history += `${data}${COMMAND_QUICK_ACTION_START_MARKER}\r\nok\r\n`;
    commandStarted = true;
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
    history:
      commandStarted && !hasRunningSubprocess
        ? `${history}${COMMAND_QUICK_ACTION_COMPLETION_MARKER}0\r\n`
        : history,
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
      data: buildCommandQuickActionShellInput("printf ok"),
    });
    expect(yield* runner.takeAvailableOutputContext(threadId)).toBeUndefined();

    hasRunningSubprocess = false;
    const context = yield* runner.takeAvailableOutputContext(threadId);
    expect(context).toContain("<terminal_context>");
    expect(context).toContain("printf ok");
    expect(context).toContain("ok");
    expect(context).not.toContain("{ printf ok");
    expect(context).not.toContain(COMMAND_QUICK_ACTION_COMPLETION_MARKER);
    expect(yield* runner.takeAvailableOutputContext(threadId)).toBeUndefined();
  }).pipe(Effect.provide(testLayer));
});
