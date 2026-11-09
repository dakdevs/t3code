import { act, createRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { useSkillSelectionSave } from "./use-skill-selection-save";

it("blocks stale replacements until both save and selection echo, and releases failed saves", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  const first = Promise.withResolvers<boolean>();
  const second = Promise.withResolvers<boolean>();
  const save = vi
    .fn<(names: string[]) => Promise<boolean>>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValue(true);
  const controller = createRef<ReturnType<typeof useSkillSelectionSave<string[]>>>();
  function Harness(props: { selection: string; owner?: string }) {
    const selectionSave = useSkillSelectionSave({
      owner: props.owner ?? "thread-a",
      selection: props.selection,
      save,
    });
    useImperativeHandle(controller, () => selectionSave);
    return null;
  }
  try {
    await act(async () => root.render(<Harness selection="a,b,c" />));
    let firstWrite!: Promise<void>;
    await act(async () => {
      firstWrite = controller.current!.write(["b", "c"], "b,c");
      void controller.current!.write(["a", "c"], "a,c");
    });
    expect(save.mock.calls).toEqual([[["b", "c"]]]);
    expect(controller.current!.saving).toBe(true);
    await act(async () => {
      first.resolve(true);
      await firstWrite;
    });
    expect(controller.current!.saving).toBe(true);
    await act(async () => controller.current!.write(["a", "c"], "a,c"));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Harness selection="b,c" />));
    expect(controller.current!.saving).toBe(false);
    let secondWrite!: Promise<void>;
    await act(async () => {
      secondWrite = controller.current!.write(["c"], "c");
    });
    expect(controller.current!.saving).toBe(true);
    await act(async () => {
      second.resolve(false);
      await secondWrite;
    });
    expect(controller.current!.saving).toBe(false);
    await act(async () => controller.current!.write([], ""));
    expect(controller.current!.saving).toBe(true);
    await act(async () => root.render(<Harness selection="default" owner="thread-b" />));
    expect(controller.current!.saving).toBe(false);
    await act(async () => controller.current!.write(["new"], "new"));
    expect(save.mock.calls).toEqual([[["b", "c"]], [["c"]], [[]], [["new"]]]);
    await act(async () => root.render(<Harness selection="new" owner="thread-b" />));
    expect(controller.current!.saving).toBe(false);
    await act(async () => root.render(<Harness selection="remote-edit" owner="thread-b" />));
    expect(controller.current!.saving).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
