import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import {
  fingerprintSkillCatalogRoots,
  refreshChangedSkillCatalogs,
} from "./skillCatalogFingerprint.ts";

const writeSkill = Effect.fn(function* (skillsDir: string, name: string, body = "# skill") {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, name);
  yield* fileSystem.makeDirectory(skillDir, { recursive: true });
  yield* fileSystem.writeFileString(path.join(skillDir, "SKILL.md"), body);
});

it.layer(NodeServices.layer)("skillCatalogFingerprint", (it) => {
  it.effect("is stable for missing roots and changes when a skill folder appears", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-skill-fingerprint-",
      });
      const skillsDir = path.join(tempDir, "skills");
      const missingDir = path.join(tempDir, "absent");

      const emptyFingerprint = yield* fingerprintSkillCatalogRoots([skillsDir, missingDir]);
      const again = yield* fingerprintSkillCatalogRoots([skillsDir, missingDir]);
      assert.strictEqual(again, emptyFingerprint);
      assert.ok(emptyFingerprint.includes(`${missingDir}:!`));
      assert.ok(emptyFingerprint.includes(`${skillsDir}:!`));

      yield* writeSkill(skillsDir, "review");
      const withSkill = yield* fingerprintSkillCatalogRoots([skillsDir, missingDir]);
      assert.notStrictEqual(withSkill, emptyFingerprint);

      yield* writeSkill(skillsDir, "deploy");
      const withTwo = yield* fingerprintSkillCatalogRoots([skillsDir, missingDir]);
      assert.notStrictEqual(withTwo, withSkill);
    }),
  );

  it.effect("seeds on first observation and refreshes only after a catalog change", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-skill-fingerprint-refresh-",
      });
      const skillsDir = path.join(tempDir, "skills");
      yield* fileSystem.makeDirectory(skillsDir, { recursive: true });
      const refreshCalls = yield* Ref.make(0);
      const fingerprints = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
      const tick = refreshChangedSkillCatalogs({
        targets: [
          {
            key: "codex\0/workspace",
            roots: [skillsDir],
            refresh: Ref.update(refreshCalls, (count) => count + 1).pipe(Effect.asVoid),
          },
        ],
        fingerprints,
      });

      yield* tick;
      assert.strictEqual(yield* Ref.get(refreshCalls), 0);

      yield* tick;
      assert.strictEqual(yield* Ref.get(refreshCalls), 0);

      yield* writeSkill(skillsDir, "review");
      yield* tick;
      assert.strictEqual(yield* Ref.get(refreshCalls), 1);

      yield* tick;
      assert.strictEqual(yield* Ref.get(refreshCalls), 1);
    }),
  );
});
