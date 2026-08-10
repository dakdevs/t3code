import { describe, expect, it } from "vite-plus/test";

import {
  COMMAND_QUICK_ACTION_COMPLETION_MARKER,
  COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER,
  EnvironmentId,
  TerminalSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";

import {
  applyTerminalAttachStreamEvent,
  applyTerminalMetadataStreamEvent,
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  formatInlineQuickActionOutput,
  formatInlineTerminalOutput,
  readInlineQuickActionCompletion,
  readInlineQuickActionInputRequired,
  resolveInlineQuickActionExecution,
  selectRunningSubprocessTerminalIds,
} from "./terminalSession.ts";

const TARGET = {
  environmentId: EnvironmentId.make("env-local"),
  threadId: ThreadId.make("thread-1"),
  terminalId: "term-1",
} as const;

const BASE_SNAPSHOT: TerminalSessionSnapshot = {
  threadId: TARGET.threadId,
  terminalId: TARGET.terminalId,
  cwd: "/repo",
  worktreePath: null,
  status: "running",
  pid: 123,
  history: "hello",
  exitCode: null,
  exitSignal: null,
  label: "Terminal 1",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

describe("terminal session reducers", () => {
  it("formats only bounded quick-action output as inline text", () => {
    const prompt = "prompt> ";
    const buffer = `${prompt}\u001b[32mgit pull --ff-only\u001b[0m\r\nAlready up to date.\r\n`;

    expect(formatInlineTerminalOutput(buffer, prompt.length)).toBe(
      "git pull --ff-only\nAlready up to date.",
    );
    expect(formatInlineTerminalOutput(buffer, prompt.length, 8)).toBe(
      "[Earlier output truncated]\nto date.",
    );
  });

  it("applies shell line-editor backspaces instead of displaying duplicated characters", () => {
    const raw = "\u001b[?2004hg\bgit pull\u001b[?2004l\r\nAlready up to date.\r\n";

    expect(formatInlineTerminalOutput(raw, 0)).toBe("git pull\nAlready up to date.");
  });

  it("keeps quick-action output while removing command echoes and the next shell prompt", () => {
    const raw = [
      "git pull\r\n",
      "\r\u001b[1;33mcloud branch repo\u001b[0m\r\n",
      "\u001b[1;32m$\u001b[0m \u001b[?2004hg\bgit pull\u001b[?2004l\r\r\n",
      "Already up to date.\r\n",
      "\r\u001b[1;33mcloud branch repo\u001b[0m\r\n",
      "\u001b[1;32m$\u001b[0m \u001b[?2004h",
    ].join("");

    expect(formatInlineQuickActionOutput(raw, 0, { command: "git pull", terminalIdle: true })).toBe(
      "Already up to date.",
    );
  });

  it("does not trim a trailing prompt-looking line while the command is still running", () => {
    const raw = "git pull\r\nDownloading 100 %\r\n";

    expect(
      formatInlineQuickActionOutput(raw, 0, { command: "git pull", terminalIdle: false }),
    ).toBe("Downloading 100 %");
  });

  it("removes an entered command at the next shell prompt after completion", () => {
    const raw = "git pull\r\nAlready up to date.\r\n$ ggit pull\r\n";

    expect(formatInlineQuickActionOutput(raw, 0, { command: "git pull", terminalIdle: true })).toBe(
      "Already up to date.",
    );
  });

  it("observes exact quick-action completion and hides its shell marker", () => {
    const raw = [
      "{ git pull\r\n",
      `}; status=$?; printf '${COMMAND_QUICK_ACTION_COMPLETION_MARKER}%s' "$status"\r\n`,
      '"\r\n',
      "Already up to date.\r\n",
      `${COMMAND_QUICK_ACTION_COMPLETION_MARKER}0\r\n`,
      "$ ",
    ].join("");

    expect(readInlineQuickActionCompletion(raw, 0)).toEqual({ exitCode: 0 });
    expect(formatInlineQuickActionOutput(raw, 0, { command: "git pull", terminalIdle: true })).toBe(
      "Already up to date.",
    );
  });

  it("removes every shell redraw fragment before quick-action output starts", () => {
    const raw = [
      `if command -v bash;then printf '\\n__T3_CODE_QUICK_ACTION_COMPLETE__:%s\\n' "$s"\r\n`,
      "n\r\n",
      "n';fi\r\n",
      "__T3_CODE_QUICK_ACTION_START__\r\n",
      "chore/upgrade-all-dependencies\r\n",
      `${COMMAND_QUICK_ACTION_COMPLETION_MARKER}0\r\n`,
      "$ ",
    ].join("");

    expect(
      formatInlineQuickActionOutput(raw, 0, {
        command: "git branch --show-current",
        terminalIdle: true,
      }),
    ).toBe("chore/upgrade-all-dependencies");
  });

  it("does not report quick-action completion before the marker arrives", () => {
    expect(readInlineQuickActionCompletion("git pull\r\nDownloading...", 0)).toBeNull();
  });

  it("does not treat marker text inside the echoed shell wrapper as lifecycle state", () => {
    const echoed =
      `printf '${COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER}%s' "$signal";` +
      `printf '${COMMAND_QUICK_ACTION_COMPLETION_MARKER}%s' "$status"\r\n`;

    expect(readInlineQuickActionInputRequired(echoed, 0)).toBeNull();
    expect(readInlineQuickActionCompletion(echoed, 0)).toBeNull();
  });

  it("preserves a failed quick action's exit code", () => {
    expect(
      readInlineQuickActionCompletion(`${COMMAND_QUICK_ACTION_COMPLETION_MARKER}7\r\n`, 0),
    ).toEqual({ exitCode: 7 });
  });

  it("detects terminal input requests and hides their shell marker", () => {
    const raw = ["Name: \r\n", `${COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER}TTIN\r\n`].join("");

    expect(readInlineQuickActionInputRequired(raw, 0)).toEqual({ signal: "TTIN" });
    expect(
      formatInlineQuickActionOutput(raw, 0, { command: "read name", terminalIdle: false }),
    ).toBe("Name: ");
  });

  it("lets exact completion supersede an earlier terminal input request", () => {
    const raw = [
      `${COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER}TTIN\r\n`,
      "Dak\r\n",
      `${COMMAND_QUICK_ACTION_COMPLETION_MARKER}0\r\n`,
    ].join("");

    expect(readInlineQuickActionInputRequired(raw, 0)).toEqual({ signal: "TTIN" });
    expect(readInlineQuickActionCompletion(raw, 0)).toEqual({ exitCode: 0 });
    expect(
      resolveInlineQuickActionExecution(
        { buffer: raw, error: null, status: "running", version: 1 },
        0,
      ),
    ).toEqual({ completion: { exitCode: 0 }, inputRequired: null, status: "finished" });
  });

  it("resolves input, failure, and missing-marker terminal states consistently", () => {
    expect(
      resolveInlineQuickActionExecution(
        {
          buffer: `${COMMAND_QUICK_ACTION_INPUT_REQUIRED_MARKER}TTIN\r\n`,
          error: null,
          status: "running",
          version: 1,
        },
        0,
      ),
    ).toEqual({ completion: null, inputRequired: { signal: "TTIN" }, status: "input-required" });
    expect(
      resolveInlineQuickActionExecution(
        {
          buffer: `${COMMAND_QUICK_ACTION_COMPLETION_MARKER}7\r\n`,
          error: null,
          status: "running",
          version: 1,
        },
        0,
      ),
    ).toEqual({ completion: { exitCode: 7 }, inputRequired: null, status: "failed" });
    expect(
      resolveInlineQuickActionExecution(
        { buffer: "partial", error: null, status: "closed", version: 1 },
        0,
      ).status,
    ).toBe("error");
  });

  it("prefers live attach status over stale metadata after the attach stream starts", () => {
    const summary = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          threadId: BASE_SNAPSHOT.threadId,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: "running",
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    })[0]!;
    const attached = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
      type: "error",
      threadId: TARGET.threadId,
      terminalId: TARGET.terminalId,
      message: "Terminal disconnected.",
    });

    expect(combineTerminalSessionState(summary, attached)).toMatchObject({
      status: "error",
      error: "Terminal disconnected.",
      version: 1,
    });
  });

  it("uses metadata status before an attach stream has emitted", () => {
    const summary = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          threadId: BASE_SNAPSHOT.threadId,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: "running",
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    })[0]!;

    expect(combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE).status).toBe(
      "running",
    );
  });

  it("does not treat an idle running shell as a running subprocess", () => {
    const idleSession = {
      target: TARGET,
      state: {
        ...combineTerminalSessionState(null, EMPTY_TERMINAL_BUFFER_STATE),
        status: "running" as const,
        hasRunningSubprocess: false,
      },
    };
    const activeSession = {
      target: { ...TARGET, terminalId: "term-2" },
      state: {
        ...idleSession.state,
        hasRunningSubprocess: true,
      },
    };

    expect(selectRunningSubprocessTerminalIds([idleSession, activeSession])).toEqual(["term-2"]);
  });

  it("reduces attach snapshots and output without an imperative session manager", () => {
    const snapshot = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
      type: "snapshot",
      snapshot: BASE_SNAPSHOT,
    });
    const output = applyTerminalAttachStreamEvent(
      snapshot,
      {
        type: "output",
        threadId: TARGET.threadId,
        terminalId: TARGET.terminalId,
        data: " world",
      },
      8,
    );

    expect(output).toMatchObject({
      buffer: "lo world",
      status: "running",
      error: null,
      version: 2,
    });
  });

  it("reduces terminal metadata snapshots, upserts, and removals", () => {
    const initial = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          threadId: BASE_SNAPSHOT.threadId,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: BASE_SNAPSHOT.status,
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    });
    const updated = applyTerminalMetadataStreamEvent(initial, {
      type: "upsert",
      terminal: {
        ...initial[0]!,
        hasRunningSubprocess: true,
      },
    });
    const removed = applyTerminalMetadataStreamEvent(updated, {
      type: "remove",
      threadId: TARGET.threadId,
      terminalId: TARGET.terminalId,
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.hasRunningSubprocess).toBe(true);
    expect(removed).toEqual([]);
  });

  it("caps retained output by UTF-8 byte length", () => {
    const state = applyTerminalAttachStreamEvent(
      EMPTY_TERMINAL_BUFFER_STATE,
      {
        type: "output",
        threadId: TARGET.threadId,
        terminalId: TARGET.terminalId,
        data: "🙂🙂",
      },
      4,
    );

    expect(state.buffer).toBe("🙂");
  });
});
