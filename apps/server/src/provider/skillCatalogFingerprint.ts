/**
 * Skill catalog fingerprint — a cheap directory signature used to decide
 * whether the `$` picker needs a fresh skill probe.
 *
 * Workspace snapshots cache skills after the first `snapshotForCwd` and
 * never look again, so a skill added while T3 is running stays invisible
 * until restart. Re-running discovery on a timer is too expensive (Grok
 * `inspect`, Codex `skills/list`, OpenCode server round-trips). This walk
 * only readdirs and stats `SKILL.md` files, with a small directory budget,
 * and the caller re-probes only when the signature changes.
 *
 * @module provider/skillCatalogFingerprint
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

export const SKILL_CATALOG_REFRESH_INTERVAL = Duration.seconds(1);

const MAX_DIRECTORY_VISITS = 256;
const SKIP_ENTRY_NAMES = new Set([".DS_Store", ".git", "node_modules", "Thumbs.db"]);

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
 * Stable signature of the skill roots a provider reads. Missing paths are
 * part of the signature so creating a previously absent `skills` directory
 * still invalidates. Directory listings catch add/remove; `SKILL.md` mtime
 * and size catch edits. Other files are listed by name only so a new script
 * is visible without reading it.
 */
export const fingerprintSkillCatalogRoots = Effect.fn("fingerprintSkillCatalogRoots")(function* (
  directories: ReadonlyArray<string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const parts: string[] = [];
  const queue = [...new Set(directories)].sort();
  let visited = 0;

  const readInfo = (target: string) =>
    fileSystem.stat(target).pipe(Effect.orElseSucceed(() => undefined));

  while (queue.length > 0) {
    const directory = queue.shift();
    if (directory === undefined) break;
    visited += 1;
    if (visited > MAX_DIRECTORY_VISITS) {
      parts.push("#truncated");
      break;
    }

    const info = yield* readInfo(directory);
    if (info === undefined) {
      parts.push(`${directory}:!`);
      continue;
    }
    if (info.type === "File") {
      parts.push(`${directory}:file:${entryMtimeMs(info.mtime)}:${String(info.size)}`);
      continue;
    }
    if (info.type !== "Directory") {
      parts.push(`${directory}:${info.type}`);
      continue;
    }

    const names = (yield* fileSystem
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => [])))
      .filter((name) => !SKIP_ENTRY_NAMES.has(name))
      .sort();
    parts.push(`${directory}:[${names.join(",")}]`);

    for (const name of names) {
      const child = path.join(directory, name);
      const childInfo = yield* readInfo(child);
      if (childInfo === undefined) continue;
      if (childInfo.type === "File") {
        if (name === "SKILL.md") {
          parts.push(`${child}:${entryMtimeMs(childInfo.mtime)}:${String(childInfo.size)}`);
        }
        continue;
      }
      if (childInfo.type === "Directory") {
        queue.push(child);
      }
    }
  }

  return parts.join("|");
});

export interface SkillCatalogRefreshTarget {
  readonly key: string;
  readonly roots: ReadonlyArray<string>;
  readonly refresh: Effect.Effect<void>;
}

/**
 * Compare each target's current fingerprint to the last one we stored.
 * The first observation only seeds the map so opening a thread does not
 * immediately re-run discovery. A later mismatch is the invalidation
 * signal; `refresh` then re-probes that workspace snapshot.
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
