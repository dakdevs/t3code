/**
 * Skill catalog fingerprint — a cheap root signature used to decide
 * whether the `$` picker needs a fresh skill probe.
 *
 * Workspace snapshots cache skills after the first `snapshotForCwd` and
 * never look again, so a skill added while T3 is running stays invisible
 * until restart. Re-running discovery on a timer is too expensive (Grok
 * `inspect`, Codex `skills/list`, OpenCode server round-trips). This only
 * stats the roots a driver already listed. Missing paths stay in the
 * signature so creating a previously absent `skills` folder invalidates.
 * `fs.watch` cannot do that: it fails on a path that does not exist yet.
 *
 * @module provider/skillCatalogFingerprint
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

export const SKILL_CATALOG_REFRESH_INTERVAL = Duration.seconds(3);

export function skillCatalogTargetKey(instanceId: string, cwd: string): string {
  return `${instanceId}\0${cwd}`;
}

export function isSkillCatalogTargetForInstance(key: string, instanceId: string): boolean {
  return key.startsWith(`${instanceId}\0`);
}

function entryMtimeMs(mtime: Option.Option<Date>): string {
  const value = Option.getOrNull(mtime);
  return value === null ? "0" : String(value.getTime());
}

/**
 * Stable signature of the skill roots a provider reads. One `stat` per
 * unique path. Missing paths are `path:!` so mkdir on that root still
 * invalidates. Directory mtime catches a new child folder.
 */
export const fingerprintSkillCatalogRoots = Effect.fn("fingerprintSkillCatalogRoots")(function* (
  directories: ReadonlyArray<string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const parts: string[] = [];

  for (const directory of [...new Set(directories)].sort()) {
    const info = yield* fileSystem.stat(directory).pipe(Effect.orElseSucceed(() => undefined));
    if (info === undefined) {
      parts.push(`${directory}:!`);
      continue;
    }
    parts.push(`${directory}:${info.type}:${entryMtimeMs(info.mtime)}:${String(info.size)}`);
  }

  return parts.join("|");
});

export type SkillCatalogRefreshTarget = {
  readonly key: string;
  readonly roots: ReadonlyArray<string>;
  readonly refresh: Effect.Effect<void>;
};

/**
 * Compare each target's current fingerprint to the last one we stored.
 * The first observation only seeds the map so opening a thread does not
 * immediately re-run discovery. A later mismatch is the invalidation
 * signal; `refresh` then drops the cached snapshot and re-probes.
 */
export const refreshChangedSkillCatalogs = Effect.fn("refreshChangedSkillCatalogs")(
  function* (input: {
    readonly targets: ReadonlyArray<SkillCatalogRefreshTarget>;
    readonly fingerprints: Ref.Ref<ReadonlyMap<string, string>>;
  }) {
    const observed = yield* Effect.forEach(
      input.targets,
      (target) =>
        fingerprintSkillCatalogRoots(target.roots).pipe(
          Effect.map((fingerprint) => [target, fingerprint] as const),
        ),
      { concurrency: "unbounded" },
    );

    for (const [target, fingerprint] of observed) {
      const previous = (yield* Ref.get(input.fingerprints)).get(target.key);
      if (previous === undefined) {
        yield* Ref.update(input.fingerprints, (fingerprints) =>
          new Map(fingerprints).set(target.key, fingerprint),
        );
        continue;
      }
      if (previous === fingerprint) continue;
      yield* target.refresh;
      yield* Ref.update(input.fingerprints, (fingerprints) =>
        new Map(fingerprints).set(target.key, fingerprint),
      );
    }
  },
);
