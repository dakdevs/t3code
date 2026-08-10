import type { OrchestrationQuickAction } from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

const SHELL_BUILTINS = new Set([
  ".",
  "[",
  "alias",
  "break",
  "cd",
  "continue",
  "echo",
  "eval",
  "exec",
  "exit",
  "export",
  "false",
  "printf",
  "pwd",
  "read",
  "return",
  "set",
  "shift",
  "source",
  "test",
  "true",
  "type",
  "ulimit",
  "umask",
  "unalias",
  "unset",
]);
const SHELL_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "time",
  "until",
  "while",
  "{",
  "}",
]);
const SHELL_FENCE_LANGUAGES = new Set([
  "",
  "bash",
  "cmd",
  "console",
  "fish",
  "powershell",
  "pwsh",
  "sh",
  "shell",
  "terminal",
  "zsh",
]);
const MAX_CODE_BLOCKS = 12;
const MAX_QUICK_ACTIONS = 4;
const MAX_COMMAND_CHARS = 16_000;
const PackageJsonScripts = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }),
);
const decodePackageJsonScripts = Schema.decodeUnknownOption(PackageJsonScripts);

export function extractCommandCodeBlocks(markdown: string): ReadonlyArray<{
  readonly index: number;
  readonly command: string;
}> {
  if (!markdown.includes("```") && !markdown.includes("~~~")) return [];

  const blocks: Array<{ readonly index: number; readonly command: string }> = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let fence: {
    readonly marker: "`" | "~";
    readonly length: number;
    readonly language: string;
  } | null = null;
  let body: string[] = [];

  for (const line of lines) {
    if (fence === null) {
      const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (!match?.[1]) continue;
      fence = {
        marker: match[1][0] as "`" | "~",
        length: match[1].length,
        language: (match[2] ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "",
      };
      body = [];
      continue;
    }

    const closing = new RegExp(`^\\s{0,3}${fence.marker}{${fence.length},}\\s*$`);
    if (!closing.test(line)) {
      body.push(line);
      continue;
    }

    const command = body.join("\n").trim();
    if (
      SHELL_FENCE_LANGUAGES.has(fence.language) &&
      command.length > 0 &&
      command.length <= MAX_COMMAND_CHARS &&
      !/^\s*[$#>]\s+/m.test(command) &&
      blocks.length < MAX_CODE_BLOCKS
    ) {
      blocks.push({ index: blocks.length, command });
    }
    fence = null;
    body = [];
  }

  return blocks;
}

function unquote(token: string): string {
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function quickActionLabel(command: string): string {
  const firstCommand = command
    .split(/(?:\r?\n|&&|\|\||;|\|)/, 1)[0]
    ?.trim()
    .replace(/^([A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*/, "")
    .replace(/^(?:sudo|env|command)\s+/, "");
  const tokens = firstCommand?.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g)?.map(unquote) ?? [];
  const count = /^(?:bun|npm|pnpm|yarn)$/.test(tokens[0] ?? "") && tokens[1] === "run" ? 3 : 2;
  const summary = tokens.slice(0, count).join(" ").slice(0, 40);
  return summary.length > 0 ? `Run ${summary}` : "Run command";
}

const runSyntaxCheck = Effect.fn("commandQuickActionValidator.runSyntaxCheck")(function* (
  command: string,
) {
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;
  // Windows shells do not expose a common parse-only mode. Never execute the
  // candidate just to validate it; executable and package-script checks still run.
  if (platform === "win32") return true;
  const shell = environment.SHELL ?? "/bin/sh";
  const args = ["-n", "-c", command];
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const result = yield* spawner
    .exitCode(ChildProcess.make(shell, args, { stdout: "ignore", stderr: "ignore" }))
    .pipe(
      Effect.timeoutOption(5_000),
      Effect.catchCause(() => Effect.succeed(Option.none())),
    );
  return Option.exists(result, (code) => code === ChildProcessSpawner.ExitCode(0));
});

function commandSegments(command: string): ReadonlyArray<ReadonlyArray<string>> {
  return command
    .split(/(?:\r?\n|&&|\|\||;|\|)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !segment.startsWith("#"))
    .map((segment) => segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g)?.map(unquote) ?? []);
}

const executableExists = Effect.fn("commandQuickActionValidator.executableExists")(function* (
  cwd: string,
  executable: string,
) {
  if (executable.includes("$") || executable.includes("`")) return false;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;
  const candidates: string[] = [];
  if (executable.includes("/") || executable.includes("\\")) {
    candidates.push(path.isAbsolute(executable) ? executable : path.resolve(cwd, executable));
  } else {
    const extensions =
      platform === "win32" ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
    for (const directory of (environment.PATH ?? "").split(platform === "win32" ? ";" : ":")) {
      if (!directory) continue;
      for (const extension of extensions)
        candidates.push(path.join(directory, `${executable}${extension}`));
    }
  }
  for (const candidate of candidates) {
    const info = yield* fileSystem.stat(candidate).pipe(Effect.option);
    if (
      Option.exists(
        info,
        (entry) => entry.type === "File" && (platform === "win32" || (entry.mode & 0o111) !== 0),
      )
    ) {
      return true;
    }
  }
  return false;
});

const nearestPackageScripts = Effect.fn("commandQuickActionValidator.nearestPackageScripts")(
  function* (cwd: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    let directory = cwd;
    while (true) {
      const contents = yield* fileSystem
        .readFileString(path.join(directory, "package.json"))
        .pipe(Effect.option);
      if (Option.isSome(contents)) {
        const decoded = decodePackageJsonScripts(contents.value);
        if (Option.isSome(decoded) && decoded.value.scripts !== undefined) {
          return decoded.value.scripts;
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  },
);

const segmentIsValid = Effect.fn("commandQuickActionValidator.segmentIsValid")(function* (
  cwd: string,
  rawTokens: ReadonlyArray<string>,
) {
  const tokens = [...rawTokens];
  while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  while (tokens[0] === "sudo" || tokens[0] === "env" || tokens[0] === "command") tokens.shift();
  const executable = tokens[0];
  if (!executable || SHELL_KEYWORDS.has(executable)) return true;
  if (executable === "cd") {
    const target = tokens[1];
    if (!target || target.includes("$") || target === "-" || target.startsWith("~")) return true;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const info = yield* fileSystem.stat(path.resolve(cwd, target)).pipe(Effect.option);
    return Option.exists(info, (entry) => entry.type === "Directory");
  }
  if (!SHELL_BUILTINS.has(executable) && !(yield* executableExists(cwd, executable))) return false;

  const packageManager = /^(?:bun|npm|pnpm|yarn)$/.test(executable);
  const script =
    tokens[1] === "run" ? tokens[2] : tokens[1] === "test" && executable !== "bun" ? "test" : null;
  if (packageManager && script) {
    const scripts = yield* nearestPackageScripts(cwd);
    return scripts !== null && typeof scripts[script] === "string";
  }
  return true;
});

export const validateCommandQuickActions = Effect.fn(
  "commandQuickActionValidator.validateCommandQuickActions",
)(function* (cwd: string, actions: ReadonlyArray<OrchestrationQuickAction>) {
  const valid: OrchestrationQuickAction[] = [];
  for (const action of actions) {
    if (!(yield* runSyntaxCheck(action.command))) continue;
    const segments = commandSegments(action.command);
    if (segments.length === 0) continue;
    const checks = yield* Effect.forEach(segments, (tokens) => segmentIsValid(cwd, tokens), {
      concurrency: "unbounded",
    });
    if (checks.every(Boolean)) valid.push(action);
  }
  return valid;
});

export const detectCommandQuickActions = Effect.fn(
  "commandQuickActionValidator.detectCommandQuickActions",
)(function* (cwd: string, finalResponse: string) {
  const candidates = extractCommandCodeBlocks(finalResponse).map((block) => ({
    id: `code-block-${block.index + 1}`,
    label: quickActionLabel(block.command),
    command: block.command,
  }));
  if (candidates.length === 0) return [];
  return (yield* validateCommandQuickActions(cwd, candidates)).slice(0, MAX_QUICK_ACTIONS);
});
