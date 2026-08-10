import type {
  EnvironmentId,
  TerminalAttachStreamEvent,
  TerminalMetadataStreamEvent,
  TerminalSessionSnapshot,
  TerminalSummary,
  ThreadId,
} from "@t3tools/contracts";

export interface TerminalSessionState {
  readonly summary: TerminalSummary | null;
  readonly buffer: string;
  readonly status: TerminalSessionSnapshot["status"] | "closed";
  readonly error: string | null;
  readonly hasRunningSubprocess: boolean;
  readonly updatedAt: string | null;
  readonly version: number;
}

export interface TerminalBufferState {
  readonly buffer: string;
  readonly status: TerminalSessionSnapshot["status"] | "closed";
  readonly error: string | null;
  readonly updatedAt: string | null;
  readonly version: number;
}

export interface KnownTerminalSessionTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
}

export interface KnownTerminalSession {
  readonly target: KnownTerminalSessionTarget;
  readonly state: TerminalSessionState;
}

export function selectRunningSubprocessTerminalIds(
  sessions: ReadonlyArray<KnownTerminalSession>,
): ReadonlyArray<string> {
  return sessions
    .filter((session) => session.state.hasRunningSubprocess)
    .map((session) => session.target.terminalId);
}

export const EMPTY_TERMINAL_BUFFER_STATE = Object.freeze<TerminalBufferState>({
  buffer: "",
  status: "closed",
  error: null,
  updatedAt: null,
  version: 0,
});

export const EMPTY_TERMINAL_SESSION_STATE = Object.freeze<TerminalSessionState>({
  summary: null,
  buffer: "",
  status: "closed",
  error: null,
  hasRunningSubprocess: false,
  updatedAt: null,
  version: 0,
});

export const DEFAULT_MAX_TERMINAL_BUFFER_BYTES = 512 * 1024;
export const DEFAULT_MAX_INLINE_TERMINAL_OUTPUT_CHARS = 12_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function applyTerminalBackspaces(input: string): string {
  const output: string[] = [];
  for (const character of input) {
    if (character !== "\b") {
      output.push(character);
      continue;
    }
    if (output.at(-1) !== "\n") {
      output.pop();
    }
  }
  return output.join("");
}

function normalizeInlineTerminalText(buffer: string, historyOffset: number): string {
  const plain = buffer
    .slice(Math.max(0, historyOffset))
    // CSI and OSC sequences carry terminal presentation, not useful inline text.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)/gs, "");
  return (
    applyTerminalBackspaces(plain)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Preserve newlines and tabs while dropping remaining terminal controls.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .replace(/^\n+|\n+$/g, "")
  );
}

function boundInlineTerminalOutput(output: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (output.length <= maxChars) return output;
  return `[Earlier output truncated]\n${output.slice(-maxChars)}`;
}

function trimQuickActionShellTranscript(
  output: string,
  command: string,
  terminalIdle: boolean,
): string {
  let lines = output.split("\n");
  const commandLead = command
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (commandLead !== undefined) {
    let lastEchoIndex = -1;
    for (let index = 0; index < Math.min(lines.length, 12); index += 1) {
      const line = lines[index]?.trim() ?? "";
      if (line === commandLead || line.endsWith(` ${commandLead}`)) {
        lastEchoIndex = index;
      }
    }
    if (lastEchoIndex >= 0) {
      lines = lines.slice(lastEchoIndex + 1);
    }
  }

  while (lines[0]?.trim().length === 0) lines.shift();
  while (lines.at(-1)?.trim().length === 0) lines.pop();

  if (terminalIdle) {
    const promptLine = lines.at(-1)?.trim() ?? "";
    const markerOnly = /^[$#>%❯➜]$/.test(promptLine);
    const looksLikePrompt = markerOnly || /(?:^|\s)[$#>%❯➜]$/.test(promptLine);
    if (looksLikePrompt) {
      lines.pop();
      if (markerOnly) {
        let decorationIndex = lines.length - 1;
        while (decorationIndex >= 0 && lines[decorationIndex]?.trim().length === 0) {
          decorationIndex -= 1;
        }
        if (decorationIndex > 0 && lines[decorationIndex - 1]?.trim().length === 0) {
          lines.length = decorationIndex - 1;
        }
      }
      while (lines.at(-1)?.trim().length === 0) lines.pop();
    }
  }

  return lines.join("\n");
}

export function formatInlineTerminalOutput(
  buffer: string,
  historyOffset: number,
  maxChars = DEFAULT_MAX_INLINE_TERMINAL_OUTPUT_CHARS,
): string {
  return boundInlineTerminalOutput(normalizeInlineTerminalText(buffer, historyOffset), maxChars);
}

export function formatInlineQuickActionOutput(
  buffer: string,
  historyOffset: number,
  options: {
    readonly command: string;
    readonly terminalIdle: boolean;
    readonly maxChars?: number;
  },
): string {
  const output = normalizeInlineTerminalText(buffer, historyOffset);
  return boundInlineTerminalOutput(
    trimQuickActionShellTranscript(output, options.command, options.terminalIdle),
    options.maxChars ?? DEFAULT_MAX_INLINE_TERMINAL_OUTPUT_CHARS,
  );
}

function trimBufferToBytes(buffer: string, maxBufferBytes: number): string {
  if (maxBufferBytes <= 0) {
    return "";
  }

  const encoded = textEncoder.encode(buffer);
  if (encoded.byteLength <= maxBufferBytes) {
    return buffer;
  }

  let start = encoded.byteLength - maxBufferBytes;
  while (start < encoded.length) {
    const byte = encoded[start];
    if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) {
      break;
    }
    start += 1;
  }

  return textDecoder.decode(encoded.subarray(start));
}

export function terminalBufferStateFromSnapshot(
  snapshot: TerminalSessionSnapshot,
  maxBufferBytes: number,
): TerminalBufferState {
  return {
    buffer: trimBufferToBytes(snapshot.history, maxBufferBytes),
    status: snapshot.status,
    error: null,
    updatedAt: snapshot.updatedAt,
    version: 1,
  };
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function combineTerminalSessionState(
  summary: TerminalSummary | null,
  buffer: TerminalBufferState,
): TerminalSessionState {
  return {
    summary,
    buffer: buffer.buffer,
    status: buffer.version > 0 ? buffer.status : (summary?.status ?? buffer.status),
    error: buffer.error,
    hasRunningSubprocess: summary?.hasRunningSubprocess ?? false,
    updatedAt: latestTimestamp(summary?.updatedAt ?? null, buffer.updatedAt),
    version: buffer.version,
  };
}

export function applyTerminalAttachStreamEvent(
  current: TerminalBufferState,
  event: TerminalAttachStreamEvent,
  maxBufferBytes = DEFAULT_MAX_TERMINAL_BUFFER_BYTES,
): TerminalBufferState {
  switch (event.type) {
    case "snapshot":
    case "restarted":
      return terminalBufferStateFromSnapshot(event.snapshot, maxBufferBytes);
    case "output":
      return {
        ...current,
        buffer: trimBufferToBytes(`${current.buffer}${event.data}`, maxBufferBytes),
        status: current.status === "closed" ? "running" : current.status,
        error: null,
        version: current.version + 1,
      };
    case "cleared":
      return {
        ...current,
        buffer: "",
        error: null,
        version: current.version + 1,
      };
    case "exited":
      return {
        ...current,
        status: "exited",
        error: null,
        version: current.version + 1,
      };
    case "closed":
      return {
        ...current,
        status: "closed",
        error: null,
        version: current.version + 1,
      };
    case "error":
      return {
        ...current,
        status: "error",
        error: event.message,
        version: current.version + 1,
      };
    case "activity":
      return current;
  }
}

export function applyTerminalMetadataStreamEvent(
  current: ReadonlyArray<TerminalSummary>,
  event: TerminalMetadataStreamEvent,
): ReadonlyArray<TerminalSummary> {
  if (event.type === "snapshot") {
    return event.terminals;
  }
  if (event.type === "remove") {
    return current.filter(
      (terminal) =>
        terminal.threadId !== event.threadId || terminal.terminalId !== event.terminalId,
    );
  }
  const next = current.filter(
    (terminal) =>
      terminal.threadId !== event.terminal.threadId ||
      terminal.terminalId !== event.terminal.terminalId,
  );
  return [...next, event.terminal];
}
