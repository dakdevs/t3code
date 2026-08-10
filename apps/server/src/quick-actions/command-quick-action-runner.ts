import {
  COMMAND_QUICK_ACTION_COMPLETION_MARKER,
  CommandQuickActionRunError,
  type CommandQuickActionRunInput,
  type CommandQuickActionRunResult,
  type ThreadId,
} from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TerminalManager } from "../terminal/Manager.ts";

const MAX_CONTEXT_CHARS = 20_000;
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1_000;

function formatTerminalContext(label: string, output: string): string {
  let lines = output.replace(/\r\n/g, "\n").split("\n");
  const wrapperEchoIndex = lines.findIndex(
    (line) =>
      line.includes(COMMAND_QUICK_ACTION_COMPLETION_MARKER) &&
      !line.trim().startsWith(COMMAND_QUICK_ACTION_COMPLETION_MARKER),
  );
  if (wrapperEchoIndex >= 0) lines = lines.slice(wrapperEchoIndex + 1);
  const normalized = lines
    .filter((line) => !line.includes(COMMAND_QUICK_ACTION_COMPLETION_MARKER))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
  const bounded =
    normalized.length <= MAX_CONTEXT_CHARS
      ? normalized
      : `[Earlier output truncated]\n${normalized.slice(-MAX_CONTEXT_CHARS)}`;
  const body = bounded
    .split("\n")
    .map((line, index) => `  ${index + 1} | ${line}`)
    .join("\n");
  return `- Quick action · ${label}:\n${body}`;
}

function hasQuickActionCompletionMarker(output: string): boolean {
  return output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => {
      const completion = line.trim();
      if (!completion.startsWith(COMMAND_QUICK_ACTION_COMPLETION_MARKER)) return false;
      const exitCode = completion.slice(COMMAND_QUICK_ACTION_COMPLETION_MARKER.length);
      return /^\d+$/.test(exitCode);
    });
}

export class CommandQuickActionRunner extends Context.Reference<{
  readonly run: (
    input: CommandQuickActionRunInput,
  ) => Effect.Effect<CommandQuickActionRunResult, CommandQuickActionRunError>;
  readonly takeAvailableOutputContext: (threadId: ThreadId) => Effect.Effect<string | undefined>;
}>("t3/quick-actions/command-quick-action-runner/CommandQuickActionRunner", {
  defaultValue: () => ({
    run: () =>
      Effect.fail(
        new CommandQuickActionRunError({
          reason: "unavailable",
          detail: "Command quick actions are unavailable.",
        }),
      ),
    takeAvailableOutputContext: () => Effect.sync(() => undefined),
  }),
}) {}

export const layer = Layer.effect(
  CommandQuickActionRunner,
  Effect.gen(function* () {
    const query = yield* ProjectionSnapshotQuery;
    const terminals = yield* TerminalManager;
    const pending = new Map<
      string,
      {
        readonly threadId: ThreadId;
        readonly terminalId: string;
        readonly label: string;
        readonly historyOffset: number;
        readonly startedAtMs: number;
      }
    >();

    const run = Effect.fn("CommandQuickActionRunner.run")(function* (
      input: CommandQuickActionRunInput,
    ): Effect.fn.Return<CommandQuickActionRunResult, CommandQuickActionRunError> {
      const threadOption = yield* query.getThreadDetailById(input.threadId).pipe(
        Effect.mapError(
          () =>
            new CommandQuickActionRunError({
              reason: "unavailable",
              detail: "The thread is unavailable.",
            }),
        ),
      );
      const thread = Option.getOrUndefined(threadOption);
      const message = thread?.messages.find((entry) => entry.id === input.messageId);
      const action = message?.quickActions?.find((entry) => entry.id === input.actionId);
      if (!thread || !message || !action) {
        return yield* new CommandQuickActionRunError({
          reason: "not-found",
          detail: "That command quick action is no longer available.",
        });
      }
      const projectOption = yield* query.getProjectShellById(thread.projectId).pipe(
        Effect.mapError(
          () =>
            new CommandQuickActionRunError({
              reason: "unavailable",
              detail: "The project is unavailable.",
            }),
        ),
      );
      const project = Option.getOrUndefined(projectOption);
      if (!project) {
        return yield* new CommandQuickActionRunError({
          reason: "unavailable",
          detail: "The project is unavailable.",
        });
      }

      const cwd = thread.worktreePath ?? project.workspaceRoot;
      const snapshot = yield* terminals
        .open({
          threadId: thread.id,
          terminalId: input.terminalId,
          cwd,
          ...(thread.worktreePath !== null ? { worktreePath: thread.worktreePath } : {}),
          env: projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath: thread.worktreePath,
          }),
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new CommandQuickActionRunError({ reason: "terminal", detail: error.message }),
          ),
        );
      const key = `${thread.id}:${input.terminalId}`;
      pending.set(key, {
        threadId: thread.id,
        terminalId: input.terminalId,
        label: action.label,
        historyOffset: snapshot.history.length,
        startedAtMs: yield* Clock.currentTimeMillis,
      });
      yield* terminals
        .write({
          threadId: thread.id,
          terminalId: input.terminalId,
          data: `{ ${action.command}\n}; __t3_code_quick_action_status=$?; printf '\\n${COMMAND_QUICK_ACTION_COMPLETION_MARKER}%s\\n' "$__t3_code_quick_action_status"\r`,
        })
        .pipe(
          Effect.tapError(() => Effect.sync(() => pending.delete(key))),
          Effect.mapError(
            (error) =>
              new CommandQuickActionRunError({ reason: "terminal", detail: error.message }),
          ),
        );
      return { terminalId: input.terminalId, historyOffset: snapshot.history.length };
    });

    const takeAvailableOutputContext = Effect.fn(
      "CommandQuickActionRunner.takeAvailableOutputContext",
    )(function* (threadId: ThreadId): Effect.fn.Return<string | undefined> {
      const now = yield* Clock.currentTimeMillis;
      const contexts: string[] = [];
      for (const [key, entry] of pending) {
        if (now - entry.startedAtMs > MAX_PENDING_AGE_MS) {
          pending.delete(key);
          continue;
        }
        if (entry.threadId !== threadId) continue;
        const inspected = yield* terminals.inspect({
          threadId: entry.threadId,
          terminalId: entry.terminalId,
        });
        if (Option.isNone(inspected)) continue;
        const output = inspected.value.snapshot.history.slice(entry.historyOffset);
        if (!hasQuickActionCompletionMarker(output)) continue;
        contexts.push(formatTerminalContext(entry.label, output));
        pending.delete(key);
      }
      if (contexts.length === 0) return undefined;
      return `<terminal_context>\n${contexts.join("\n\n")}\n</terminal_context>`;
    });

    return CommandQuickActionRunner.of({ run, takeAvailableOutputContext });
  }),
);
