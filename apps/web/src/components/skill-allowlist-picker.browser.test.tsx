import { useState } from "react";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { describeSkillAllowlist, SkillAllowlistPicker } from "./skill-allowlist-picker";

const choices = [
  { name: "deploy" },
  { name: "pdf" },
  { name: "review", description: "Review a PR" },
];

function Harness(props: {
  readonly onChange: (names: ReadonlyArray<string>) => void;
  readonly onReset: () => void;
}) {
  const [selected, setSelected] = useState<ReadonlyArray<string>>(["pdf", "review"]);
  return (
    <SkillAllowlistPicker
      ariaLabel="Skills"
      choices={choices}
      selected={new Set(selected)}
      trigger={<button type="button" />}
      resetLabel="Use project skills"
      onReset={props.onReset}
      onChange={(names) => {
        props.onChange(names);
        setSelected(names);
      }}
    >
      {describeSkillAllowlist({ selectedCount: selected.length, total: choices.length })}
    </SkillAllowlistPicker>
  );
}

it("toggles, searches, clears, and resets a skill allowlist", async () => {
  const onChange = vi.fn();
  const onReset = vi.fn();
  await using screen = await render(<Harness onChange={onChange} onReset={onReset} />, {
    router: false, // no routes involved
  });
  const trigger = screen.getByRole("combobox", { name: "Skills" });
  await expect.element(trigger).toHaveTextContent("2 of 3 skills");

  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("option", { name: /deploy/ }));
  expect([...onChange.mock.lastCall![0]].sort()).toEqual(["deploy", "pdf", "review"]);
  await expect.element(trigger).toHaveTextContent("All skills");

  await userEvent.type(screen.getByPlaceholder("Search skills…"), "a PR");
  await expect.element(screen.getByRole("option", { name: /review/ })).toBeVisible();
  await expect.element(screen.getByRole("option", { name: /deploy/ })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "None" }));
  expect(onChange).toHaveBeenLastCalledWith([]);
  await expect.element(trigger).toHaveTextContent("No skills");

  await userEvent.click(screen.getByRole("button", { name: "Use project skills" }));
  expect(onReset).toHaveBeenCalledOnce();
});
