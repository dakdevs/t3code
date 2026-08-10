import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import {
  detectCommandQuickActions,
  extractCommandCodeBlocks,
} from "./command-quick-action-validator.ts";

it.layer(NodeServices.layer)("command quick action validation", (it) => {
  it("extracts only complete shell-like fenced blocks", () => {
    assert.deepEqual(
      extractCommandCodeBlocks(
        [
          "Run this:",
          "```bash",
          "printf 'hello\\n'",
          "```",
          "```ts",
          "console.log('not a command')",
          "```",
          "```shell",
          "$ bun test",
          "```",
          "```sh",
          "unterminated",
        ].join("\n"),
      ),
      [{ index: 0, command: "printf 'hello\\n'" }],
    );
  });

  it.effect("suggests only commands that pass syntax, executable, and package-script checks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-quick-actions-" });
        yield* fileSystem.writeFileString(
          `${cwd}/package.json`,
          '{"scripts":{"check":"printf checked"}}',
        );

        const actions = yield* detectCommandQuickActions(
          cwd,
          [
            "```sh",
            "printf 'hello\\n'",
            "```",
            "```bash",
            "bun run check",
            "```",
            "```sh",
            "bun run missing",
            "```",
            "```sh",
            "definitely-not-a-real-command --flag",
            "```",
            "```sh",
            "if then",
            "```",
          ].join("\n"),
        );

        assert.deepEqual(
          actions.map(({ label, command }) => ({ label, command })),
          [
            { label: "Run printf hello\\n", command: "printf 'hello\\n'" },
            { label: "Run bun run check", command: "bun run check" },
          ],
        );
      }),
    ),
  );

  it.effect("does no command validation when the final response has no fences", () =>
    detectCommandQuickActions(process.cwd(), "Run `bun test` when ready.").pipe(
      Effect.map((actions) => assert.deepEqual(actions, [])),
    ),
  );

  it.effect("does not suggest command quick actions on native Windows", () =>
    detectCommandQuickActions(process.cwd(), "```powershell\nWrite-Output ready\n```").pipe(
      Effect.provideService(HostProcessPlatform, "win32"),
      Effect.map((actions) => assert.deepEqual(actions, [])),
    ),
  );
});
