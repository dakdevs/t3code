import {
  AuthProvidersManageScope,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProviderInstanceOverridePatch,
  buildProviderSkillsOverridePatch,
  resolveRemoteOperateAccess,
} from "./ProviderSettingsPanel.logic";

describe("buildProviderInstanceOverridePatch", () => {
  const projectId = ProjectId.make("project-a");
  const instanceId = ProviderInstanceId.make("codex_work");

  it("writes the same choice to every checkout of the project", () => {
    const siblingId = ProjectId.make("project-a-worktree");
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [siblingId]: { newWorktreesStartFromOrigin: true },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId, siblingId], instanceId, false),
    ).toEqual({
      [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      [siblingId]: {
        newWorktreesStartFromOrigin: true,
        providerInstances: { [instanceId]: { enabled: false } },
      },
    });
  });

  it("resets the only override by clearing the whole project entry", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, undefined),
    ).toEqual({ [projectId]: null });
  });

  it("sends providerInstances: {} explicitly when clearing the last instance override leaves other keys", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: true } },
        },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, undefined),
    ).toEqual({
      [projectId]: { newWorktreesStartFromOrigin: true, providerInstances: {} },
    });
  });
});

describe("buildProviderSkillsOverridePatch", () => {
  const projectId = ProjectId.make("project-a");
  const siblingId = ProjectId.make("project-a-worktree");
  const instanceId = ProviderInstanceId.make("claudeAgent");

  it("writes a list, including an empty one, to every checkout and keeps their other overrides", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [siblingId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    };

    expect(
      buildProviderSkillsOverridePatch(settings, [projectId, siblingId], instanceId, []),
    ).toEqual({
      [projectId]: { providerSkills: { [instanceId]: [] } },
      [siblingId]: {
        providerInstances: { [instanceId]: { enabled: true } },
        providerSkills: { [instanceId]: [] },
      },
    });
  });

  it("restores the provider default by dropping the instance, or the entry when nothing remains", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: { providerSkills: { [instanceId]: ["review"] } },
        [siblingId]: { defaultAutoPull: true, providerSkills: { [instanceId]: ["review"] } },
      },
    };

    expect(
      buildProviderSkillsOverridePatch(settings, [projectId, siblingId], instanceId, undefined),
    ).toEqual({
      [projectId]: null,
      [siblingId]: { defaultAutoPull: true, providerSkills: {} },
    });
  });
});

describe("remote operate access", () => {
  it("does not treat the old orchestration grant as provider management", () => {
    expect(
      resolveRemoteOperateAccess({
        session: {
          authenticated: true,
          scopes: ["orchestration:operate"],
          auth: { serverUpdateScope: "environment:maintain" },
        },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });

  it("accepts the orchestration grant from a server that predates providers:manage", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:operate"], auth: {} },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
  });
  it("derives access from the environment session's granted scopes", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: [AuthProvidersManageScope] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:read"] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: false },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });
});
