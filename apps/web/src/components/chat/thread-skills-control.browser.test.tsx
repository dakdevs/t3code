import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({ write: vi.fn(), draft: vi.fn() }));
vi.mock(import("@effect/atom-react"), () => ({ useAtomValue: (() => true) as never }));
vi.mock(import("../../hooks/useSettings"), () => ({
  useEnvironmentSettings: (() => ["pdf", "review"]) as never,
}));
vi.mock(import("../../state/server"), () => ({
  serverEnvironment: { configValueAtom: () => null } as never,
}));
vi.mock(import("../../state/threads"), () => ({ threadEnvironment: { setSkills: null } as never }));
vi.mock(import("../../state/use-orchestration-command"), () => ({
  useOrchestrationCommand: (() => state.write) as never,
}));
vi.mock(import("../../composerDraftStore"), async () => {
  const { Schema } = await import("effect");
  return {
    DraftId: Schema.String,
    useComposerDraftStore: { getState: () => ({ setDraftThreadContext: state.draft }) },
  } as never;
});

import { render } from "../../../test/render";
import type { DraftId } from "../../composerDraftStore";
import { ThreadSkillsControl } from "./thread-skills-control";

const environmentId = EnvironmentId.make("remote");
const instanceId = ProviderInstanceId.make("claude");
const thread = {
  id: ThreadId.make("thread"),
  projectId: ProjectId.make("project"),
  skillSelection: null,
};
function setup() {
  state.write.mockReset().mockResolvedValue({ _tag: "Success" });
  state.draft.mockReset();
}
const control = (
  draftId: DraftId | null,
  canOperate: boolean,
  isLocalDraftThread = draftId !== null,
) => (
  <ThreadSkillsControl
    environmentId={environmentId}
    thread={thread}
    draftId={draftId}
    isLocalDraftThread={isLocalDraftThread}
    canOperate={canOperate}
    instanceId={instanceId}
    catalog={[]}
    scanning
    catalogReady={false}
  />
);

it("disables persisted writes on read-only connections while allowing local draft choices", async () => {
  setup();
  await using screen = await render(control(null, false));
  await expect.element(screen.getByRole("combobox")).toBeDisabled();
  await screen.rerender(control("draft" as DraftId, false));
  await expect.element(screen.getByRole("combobox")).toBeEnabled();
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(screen.getByRole("option", { name: "pdf", exact: true }));
  expect(state.draft).toHaveBeenCalledWith("draft", {
    skillSelection: { instanceId, names: ["review"] },
  });
  expect(state.write).not.toHaveBeenCalled();
});

it("sends edits to the server after the active thread takes ownership of a draft route", async () => {
  setup();
  await using screen = await render(control("draft" as DraftId, true));
  await screen.rerender(control("draft" as DraftId, true, false));
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(screen.getByRole("option", { name: "pdf", exact: true }));
  expect(state.write).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: thread.id, skillSelection: { instanceId, names: ["review"] } },
  });
  expect(state.draft).not.toHaveBeenCalled();
});
