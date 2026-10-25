import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { getProjectOrderKey } from "../../logicalProject";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import type { Project } from "../../types";
import { parsePersistedState, reorderProjects } from "../../uiStateStore";
import { orderItemsByPreferredIds, projectGroupMove } from "../Sidebar.logic";
import { SidebarProvider } from "../ui/sidebar";
import { ProjectFilterMenu } from "./project-filter-menu";

const primary = EnvironmentId.make("env-primary");
const remote = EnvironmentId.make("env-remote");

const project = (
  title: string,
  environmentId = primary,
  workspaceRoot = `/work/${title}`,
): Project => ({
  id: ProjectId.make(`${environmentId}-${title}`),
  environmentId,
  title,
  workspaceRoot,
  repositoryIdentity:
    title === "shared"
      ? {
          canonicalKey: "github.com/example/shared",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/example/shared.git",
          },
        }
      : null,
  defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scripts: [],
});

// "shared" is one repository open on two environments, so it is one project
// in the filter with two saved order keys.
const projects = [
  project("alpha"),
  project("beta"),
  project("shared"),
  project("shared", remote, "/remote/shared"),
  project("gamma"),
];

/**
 * The filter over projects shown in a saved order, as the sidebar does, with
 * the sidebar's move. The order keeps a key for a project that is not loaded.
 */
const ignore = () => {};

function Menu({
  initialOrder,
  onScopeChange = ignore,
}: {
  initialOrder: ReadonlyArray<string>;
  onScopeChange?: (key: string | null) => void;
}) {
  const [order, setOrder] = useState(initialOrder);
  const anchor = useRef<HTMLDivElement>(null);
  const groups = buildSidebarProjectSnapshots({
    projects: orderItemsByPreferredIds({
      items: projects,
      preferredIds: order,
      getId: getProjectOrderKey,
    }),
    settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: primary,
    resolveEnvironmentLabel: () => null,
  });
  return (
    <SidebarProvider>
      <div ref={anchor} style={{ width: 280, alignSelf: "flex-start" }}>
        <ProjectFilterMenu
          groups={groups}
          scopeKey={null}
          anchor={anchor}
          onScopeChange={onScopeChange}
          onReorder={(active, over) =>
            setOrder(
              reorderProjects(
                parsePersistedState({}),
                ...projectGroupMove(groups, order, active, over),
              ).projectOrder,
            )
          }
          onOpenProjectSettings={() => {}}
          renderBadge={() => null}
        />
      </div>
      <output data-testid="saved-order">{order.join(" ")}</output>
    </SidebarProvider>
  );
}

const savedOrder = [
  "env-primary:/work/alpha",
  "env-gone:/work/unloaded",
  "env-primary:/work/beta",
  "env-primary:/work/shared",
  "env-remote:/remote/shared",
  "env-primary:/work/gamma",
];

// The label, without the monogram a project without a favicon shows.
const titleOf = (item: Element | null) =>
  item?.querySelector("[data-slot=combobox-item-content] > .truncate")?.textContent;
const optionTitles = () =>
  Array.from(document.querySelectorAll("[data-slot=combobox-item]"), titleOf);
// Grouped by repository, "shared" is keyed by its repository.
const sharedKey = "github.com/example/shared";
const handleOf = (key: string) => `[data-project-filter-handle="${key}"]`;
const searchInput = () => page.getByRole("combobox", { name: "Search projects" });
const listbox = () => page.getByRole("listbox");
const savedOrderText = () => page.getByTestId("saved-order");

// dnd-kit swallows clicks for 50ms after a drop, and Base UI's Enter commits
// through a click, so a test picks a project only before it drags one.
async function openMenu() {
  await page.getByLabelText("Filter threads by project").click();
  await expect.element(searchInput()).toHaveFocus();
}

const drag = (from: string, to: string) => commands.dragTo(handleOf(from), handleOf(to));

describe("ProjectFilterMenu", () => {
  it("selects a project clicked on its icon, like the rest of the row", async () => {
    const onScopeChange = vi.fn();
    await using _screen = await render(
      <Menu initialOrder={savedOrder} onScopeChange={onScopeChange} />,
    );
    await openMenu();

    await userEvent.click(
      page.elementLocator(document.querySelector(handleOf("env-primary:/work/beta"))!),
    );

    expect(onScopeChange.mock.calls).toEqual([["env-primary:/work/beta"]]);
    await expect.element(listbox()).not.toBeInTheDocument();
  });

  it("reorders a project dragged by its icon without selecting it or closing", async () => {
    const onScopeChange = vi.fn();
    await using _screen = await render(
      <Menu initialOrder={savedOrder} onScopeChange={onScopeChange} />,
    );
    await openMenu();
    expect(optionTitles()).toEqual(["All projects", "alpha", "beta", "shared", "gamma"]);

    await drag("env-primary:/work/alpha", sharedKey);

    expect(optionTitles()).toEqual(["All projects", "beta", "shared", "alpha", "gamma"]);
    // Past both of "shared"'s keys. The unloaded project is kept, after the
    // projects on screen.
    await expect
      .element(savedOrderText())
      .toHaveTextContent(
        [
          "env-primary:/work/beta",
          "env-primary:/work/shared",
          "env-remote:/remote/shared",
          "env-primary:/work/alpha",
          "env-primary:/work/gamma",
          "env-gone:/work/unloaded",
        ].join(" "),
      );
    expect(onScopeChange).not.toHaveBeenCalled();
    await expect.element(listbox()).toBeVisible();
    await expect.element(searchInput()).toHaveFocus();
  });

  it("moves a grouped project whole, before the project it is dropped on", async () => {
    await using _screen = await render(<Menu initialOrder={savedOrder} />);
    await openMenu();
    await drag(sharedKey, "env-primary:/work/alpha");

    expect(optionTitles()).toEqual(["All projects", "shared", "alpha", "beta", "gamma"]);
    await expect
      .element(savedOrderText())
      .toHaveTextContent(
        [
          "env-primary:/work/shared",
          "env-remote:/remote/shared",
          "env-primary:/work/alpha",
          "env-primary:/work/beta",
          "env-primary:/work/gamma",
          "env-gone:/work/unloaded",
        ].join(" "),
      );
  });

  it("announces a dragged project by name and its place among all projects, never its path", async () => {
    await using _screen = await render(<Menu initialOrder={savedOrder} />);
    await openMenu();

    await drag("env-primary:/work/alpha", "env-primary:/work/gamma");

    const announced = document.querySelector('[id^="DndLiveRegion"]')?.textContent;
    expect(announced).toBe("Moved alpha to position 4 of 4.");
  });

  it("moves the highlighted project with Alt+Up and Down, keeping it highlighted", async () => {
    await using _screen = await render(<Menu initialOrder={savedOrder} />);
    await openMenu();
    const highlighted = () =>
      titleOf(document.querySelector("[data-slot=combobox-item][data-highlighted]"));
    const moved = () => page.getByRole("status").filter({ hasText: "Moved" });
    await expect
      .element(searchInput())
      .toHaveAccessibleDescription(
        "Press Alt+Up Arrow or Alt+Down Arrow to move the highlighted project.",
      );

    await userEvent.keyboard("{ArrowDown}");
    expect(highlighted()).toBe("alpha");

    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(optionTitles()).toEqual(["All projects", "beta", "alpha", "shared", "gamma"]);
    expect(highlighted()).toBe("alpha");
    await expect.element(moved()).toHaveTextContent("Moved alpha to position 2 of 4");

    // All stays first: the second press finds nothing to pass, and the
    // highlight stays on alpha.
    await userEvent.keyboard("{Alt>}{ArrowUp}{ArrowUp}{/Alt}");
    expect(optionTitles()).toEqual(["All projects", "alpha", "beta", "shared", "gamma"]);
    expect(highlighted()).toBe("alpha");
    await expect.element(moved()).toHaveTextContent("Moved alpha to position 1 of 4");
    await expect
      .element(savedOrderText())
      .toHaveTextContent(
        [
          "env-primary:/work/alpha",
          "env-primary:/work/beta",
          "env-primary:/work/shared",
          "env-remote:/remote/shared",
          "env-primary:/work/gamma",
          "env-gone:/work/unloaded",
        ].join(" "),
      );
  });

  it("moves a searched project past the next result only, leaving the projects between in place", async () => {
    await using _screen = await render(<Menu initialOrder={savedOrder} />);
    await openMenu();
    await userEvent.type(searchInput(), "ha");
    await vi.waitFor(() => expect(optionTitles()).toEqual(["alpha", "shared"]));
    expect(titleOf(document.querySelector("[data-slot=combobox-item][data-highlighted]"))).toBe(
      "alpha",
    );

    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(optionTitles()).toEqual(["shared", "alpha"]);
    await expect
      .element(savedOrderText())
      .toHaveTextContent(
        [
          "env-primary:/work/beta",
          "env-primary:/work/shared",
          "env-remote:/remote/shared",
          "env-primary:/work/alpha",
          "env-primary:/work/gamma",
          "env-gone:/work/unloaded",
        ].join(" "),
      );
    await userEvent.clear(searchInput());
    await vi.waitFor(() =>
      expect(optionTitles()).toEqual(["All projects", "beta", "shared", "alpha", "gamma"]),
    );
  });
});
