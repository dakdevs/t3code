import { describe, expect, it } from "vite-plus/test";

import {
  composerTriggerRefreshesSkillCatalog,
  detectComposerTrigger,
  serializeComposerFileLink,
} from "./composerTrigger.ts";

describe("detectComposerTrigger", () => {
  it.each(["$", "€", "£", "¥", "₹", "₩", "₿", "𑿝"])(
    "detects %s skill prefixes and their source range",
    (prefix) => {
      const text = `Use ${prefix}review`;
      expect(detectComposerTrigger(text, text.length)).toEqual({
        kind: "skill",
        query: "review",
        rangeStart: 4,
        rangeEnd: text.length,
      });
    },
  );
});

describe("composerTriggerRefreshesSkillCatalog", () => {
  it("re-probes when the skill or slash menu is open", () => {
    expect(composerTriggerRefreshesSkillCatalog("skill")).toBe(true);
    expect(composerTriggerRefreshesSkillCatalog("slash-command")).toBe(true);
  });

  it("leaves other composer triggers on the cached catalog", () => {
    expect(composerTriggerRefreshesSkillCatalog("path")).toBe(false);
    expect(composerTriggerRefreshesSkillCatalog("pull-request")).toBe(false);
    expect(composerTriggerRefreshesSkillCatalog("slash-model")).toBe(false);
    expect(composerTriggerRefreshesSkillCatalog(null)).toBe(false);
  });
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});
