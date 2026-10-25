import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { FolderIcon, GripVerticalIcon, ListFilterIcon, SettingsIcon } from "lucide-react";
import {
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import {
  filterSidebarProjectScopeItems,
  reduceSidebarProjectScopeMenuState,
} from "../Sidebar.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const DRAG_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };
const DRAG_MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];

/**
 * The sidebar's project filter. Picking a project shows only its threads, and
 * dragging a project by its icon, or Alt+Up/Down on the highlighted one,
 * reorders the projects. `null` is the all-projects scope.
 */
export function ProjectFilterMenu({
  groups,
  scopeKey,
  anchor,
  onScopeChange,
  onReorder,
  onOpenProjectSettings,
  renderBadge,
}: {
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  scopeKey: string | null;
  anchor: RefObject<HTMLElement | null>;
  onScopeChange: (key: string | null) => void;
  /** Moves `active` to the place `over` holds in the full project order. */
  onReorder: (active: SidebarProjectSnapshot, over: SidebarProjectSnapshot) => void;
  onOpenProjectSettings: (group: SidebarProjectSnapshot) => void;
  renderBadge: (group: SidebarProjectSnapshot) => ReactNode;
}) {
  const [menu, dispatchMenu] = useReducer(reduceSidebarProjectScopeMenuState, {
    open: false,
    query: "",
  });
  const filter = useComboboxFilter();
  const sensors = useSensors(useSensor(PointerSensor, DRAG_SENSOR_OPTIONS));
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const moveHintId = useId();
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  // Safari can send a click after Ctrl+click opens settings. Ignore that one
  // selection, then clear the guard when the picker opens again.
  const suppressNextScopeChangeRef = useRef(false);
  const highlightedKeyRef = useRef<string | null>(null);

  const groupByKey = new Map(groups.map((group) => [group.projectKey, group] as const));
  const items = [
    { value: "all", label: "All projects" },
    ...groups.map((group) => ({ value: group.projectKey, label: group.displayName })),
  ];
  const selectedItem = items.find((item) => item.value === (scopeKey ?? "all")) ?? items[0]!;
  const filteredItems = filterSidebarProjectScopeItems({
    items,
    query: menu.query,
    matches: (item, query) => filter.contains(item, query, (candidate) => candidate.label),
  });
  const visibleGroups = filteredItems.flatMap((item) => groupByKey.get(item.value) ?? []);
  const scopedGroup = scopeKey === null ? undefined : groupByKey.get(scopeKey);

  const openSettings = (
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLInputElement>,
    group: SidebarProjectSnapshot,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    suppressNextScopeChangeRef.current = true;
    dispatchMenu({ type: "project-settings-opened" });
    onOpenProjectSettings(group);
  };

  // A move lands on the place `over` held in the full project order, so
  // positions count every project, searched for or not; All is fixed.
  const nameOf = (id: UniqueIdentifier) => groupByKey.get(String(id))?.displayName ?? "Project";
  const placeOf = (id: UniqueIdentifier) => {
    const index = groups.findIndex((group) => group.projectKey === id);
    return index === -1 ? "its place" : `position ${index + 1} of ${groups.length}`;
  };
  // dnd-kit's default announcements read out the raw project key, a local path.
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over === null
        ? `${nameOf(active.id)} is not over a project.`
        : over.id === active.id
          ? `${nameOf(active.id)} is at ${placeOf(active.id)}.`
          : `${nameOf(active.id)} is over ${placeOf(over.id)}.`,
    onDragEnd: ({ active, over }) =>
      over === null || over.id === active.id
        ? `${nameOf(active.id)} stays at ${placeOf(active.id)}.`
        : `Moved ${nameOf(active.id)} to ${placeOf(over.id)}.`,
    onDragCancel: ({ active }) =>
      `Stopped moving ${nameOf(active.id)}. It stays at ${placeOf(active.id)}.`,
  };
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const activeGroup = groupByKey.get(String(active.id));
    const overGroup = over ? groupByKey.get(String(over.id)) : undefined;
    if (activeGroup && overGroup && activeGroup !== overGroup) onReorder(activeGroup, overGroup);
  };

  // Alt+Up/Down moves the highlighted project past its neighbour in the list on
  // screen. Base UI's list navigation also takes the key and moves the highlight
  // one row the same way, so the highlight stays on the moved project.
  const moveHighlighted = (
    event: ReactKeyboardEvent<HTMLInputElement> & { preventBaseUIHandler: () => void },
  ) => {
    const offset = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (offset === 0 || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return false;
    }
    const key = highlightedKeyRef.current;
    const group = key === null ? undefined : groupByKey.get(key);
    const neighbour = group && visibleGroups[visibleGroups.indexOf(group) + offset];
    if (!group || !neighbour) {
      // Nothing to move past: keep the highlight from wrapping or leaving it.
      event.preventDefault();
      event.preventBaseUIHandler();
      return true;
    }
    onReorder(group, neighbour);
    setMoveAnnouncement(`Moved ${group.displayName} to ${placeOf(neighbour.projectKey)}`);
    return true;
  };

  return (
    <Combobox
      items={items}
      filteredItems={filteredItems}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={menu.open}
      onOpenChange={(open) => {
        if (open) suppressNextScopeChangeRef.current = false;
        dispatchMenu({ type: "open-changed", open });
      }}
      onItemHighlighted={(item) => {
        highlightedKeyRef.current = item?.value ?? null;
      }}
      value={selectedItem}
      onValueChange={(item) => {
        if (suppressNextScopeChangeRef.current) {
          suppressNextScopeChangeRef.current = false;
          return;
        }
        if (!item) return;
        onScopeChange(item.value === "all" ? null : item.value);
      }}
    >
      <ComboboxTrigger
        render={
          <SidebarHeaderIconButton
            label={
              scopedGroup
                ? `Filter threads by project: ${scopedGroup.displayName}`
                : "Filter threads by project"
            }
          />
        }
      >
        {scopedGroup ? (
          <span className="flex shrink-0">
            <ProjectFavicon project={scopedGroup} className="size-4" />
          </span>
        ) : (
          <ListFilterIcon className="size-4" />
        )}
      </ComboboxTrigger>
      <ComboboxPopup
        align="start"
        anchor={anchor}
        className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
      >
        <ComboboxSearchInput
          aria-label="Search projects"
          aria-describedby={moveHintId}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          placeholder="Search projects..."
          value={menu.query}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.nativeEvent.isComposing) return;
            if (moveHighlighted(event)) return;
            if (
              event.ctrlKey ||
              event.altKey ||
              event.metaKey ||
              (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
            ) {
              return;
            }
            const key = highlightedKeyRef.current;
            const group = key === null ? undefined : groupByKey.get(key);
            if (group) openSettings(event, group);
          }}
          onChange={(event) => dispatchMenu({ type: "query-changed", query: event.target.value })}
        />
        <span id={moveHintId} hidden>
          Press Alt+Up Arrow or Alt+Down Arrow to move the highlighted project.
        </span>
        <span role="status" className="sr-only">
          {moveAnnouncement}
        </span>
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={DRAG_MODIFIERS}
          accessibility={{ announcements }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleGroups.map((group) => group.projectKey)}
            strategy={verticalListSortingStrategy}
          >
            <ComboboxList>
              {(item: (typeof items)[number]) => {
                const group = groupByKey.get(item.value);
                return group ? (
                  <ProjectFilterItem
                    key={item.value}
                    item={item}
                    group={group}
                    badge={renderBadge(group)}
                    reducedMotion={reducedMotion}
                    onOpenSettings={(event) => openSettings(event, group)}
                  />
                ) : (
                  <ComboboxItem key={item.value} hideIndicator value={item}>
                    <FolderIcon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                  </ComboboxItem>
                );
              }}
            </ComboboxList>
          </SortableContext>
        </DndContext>
      </ComboboxPopup>
    </Combobox>
  );
}

function ProjectFilterItem({
  item,
  group,
  badge,
  reducedMotion,
  onOpenSettings,
}: {
  item: { value: string; label: string };
  group: SidebarProjectSnapshot;
  badge: ReactNode;
  reducedMotion: boolean;
  onOpenSettings: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.projectKey, ...(reducedMotion ? { transition: null } : {}) });
  return (
    <ComboboxItem
      ref={setNodeRef}
      hideIndicator
      value={item}
      className={isDragging ? "relative z-10" : undefined}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      // Base UI cancels every pointerdown on an item, which keeps focus in
      // search and stops a mouseup from selecting, but dnd-kit ignores a
      // cancelled pointerdown. On the handle, the handle cancels it instead,
      // once dnd-kit has seen it.
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-project-filter-handle]")) {
          event.preventBaseUIHandler();
        }
      }}
      onContextMenu={onOpenSettings}
    >
      {/* The icon is the drag handle; a plain click on it still selects, and
          dnd-kit swallows the click that ends a drag. */}
      <span
        ref={setActivatorNodeRef}
        onPointerDown={(event) => {
          listeners?.onPointerDown?.(event);
          event.preventDefault();
        }}
        data-project-filter-handle={group.projectKey}
        className="relative flex shrink-0 cursor-grab touch-none active:cursor-grabbing"
      >
        <ProjectFavicon project={group} className="size-4 shrink-0 in-data-highlighted:invisible" />
        <GripVerticalIcon
          aria-hidden
          className="invisible absolute inset-0 size-4 in-data-highlighted:visible"
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
      {badge}
      <Button
        size="icon-xs"
        variant="ghost-muted"
        tabIndex={-1}
        aria-hidden="true"
        title={`Project settings for ${group.displayName}`}
        className="ml-auto"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onOpenSettings}
      >
        <SettingsIcon className="size-3.5" />
      </Button>
    </ComboboxItem>
  );
}
