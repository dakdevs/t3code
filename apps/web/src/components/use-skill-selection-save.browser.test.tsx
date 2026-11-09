import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { SkillAllowlistPicker } from "./skill-allowlist-picker";
import { useSkillSelectionSave } from "./use-skill-selection-save";

function acknowledgement() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function Harness(props: {
  selection: ReadonlyArray<string> | null;
  target?: string;
  write: (names: ReadonlyArray<string> | null) => Promise<boolean>;
}) {
  const { saving, save } = useSkillSelectionSave({
    target: props.target ?? "thread",
    selection: props.selection,
  });
  return (
    <>
      <button
        type="button"
        disabled={saving}
        onClick={() => {
          void save(null, () => props.write(null));
        }}
      >
        External reset
      </button>
      <SkillAllowlistPicker
        ariaLabel="Skills"
        choices={[{ name: "a" }, { name: "b" }, { name: "c" }]}
        selected={new Set(props.selection ?? ["a", "b", "c"])}
        disabled={saving}
        trigger={<button type="button" />}
        onChange={(names) => {
          void save(names, () => props.write(names));
        }}
        onReset={() => {
          void save(null, () => props.write(null));
        }}
        resetLabel="Reset"
      >
        Skills
      </SkillAllowlistPicker>
    </>
  );
}

it("blocks every mutation until both the write acknowledgement and server selection arrive", async () => {
  const ack = acknowledgement();
  const write = vi.fn((_names: ReadonlyArray<string> | null) => ack.promise);
  await using screen = await render(<Harness selection={["a", "b", "c"]} write={write} />);
  await userEvent.click(screen.getByRole("combobox", { name: "Skills" }));
  await userEvent.click(screen.getByRole("option", { name: "a", exact: true }));
  expect(write).toHaveBeenLastCalledWith(["b", "c"]);
  for (const name of ["All", "None", "Reset", "External reset"]) {
    await expect.element(screen.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect
    .element(screen.getByRole("option", { name: "b", exact: true }))
    .toHaveAttribute("aria-disabled", "true");
  await act(async () => {
    ack.resolve(true);
    await ack.promise;
  });
  await expect.element(screen.getByRole("button", { name: "External reset" })).toBeDisabled();
  await screen.rerender(<Harness selection={["b", "c"]} write={write} />);
  await expect.element(screen.getByRole("button", { name: "External reset" })).toBeEnabled();
  await screen.rerender(<Harness selection={["b", "c", "a"]} write={write} />);
  await expect.element(screen.getByRole("button", { name: "External reset" })).toBeEnabled();
  await userEvent.click(screen.getByRole("option", { name: "b", exact: true }));
  expect(write).toHaveBeenLastCalledWith(["a", "c"]);
});

it("releases failed saves and ignores acknowledgements from a previous target", async () => {
  const oldAck = acknowledgement();
  const newAck = acknowledgement();
  const write = vi
    .fn()
    .mockReturnValueOnce(oldAck.promise)
    .mockReturnValueOnce(newAck.promise)
    .mockResolvedValue(false);
  await using screen = await render(<Harness selection={["a"]} target="old" write={write} />);
  await userEvent.click(screen.getByRole("button", { name: "External reset" }));
  await screen.rerender(<Harness selection={["b"]} target="new" write={write} />);
  await userEvent.click(screen.getByRole("button", { name: "External reset" }));
  await act(async () => {
    oldAck.resolve(true);
    await oldAck.promise;
  });
  await expect.element(screen.getByRole("button", { name: "External reset" })).toBeDisabled();
  await act(async () => {
    newAck.resolve(false);
    await newAck.promise;
  });
  await expect.element(screen.getByRole("button", { name: "External reset" })).toBeEnabled();
});
