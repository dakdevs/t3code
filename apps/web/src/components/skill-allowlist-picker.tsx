import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type { ProviderSkillChoice } from "@t3tools/client-runtime/providerSkills";
import { CheckIcon } from "lucide-react";
import { type ComponentProps, type ReactElement, useRef, useState } from "react";

import { useLegendListRef } from "~/hooks/useLegendListRef";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxListVirtualized,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "./ui/combobox";

const LIST_MAX_HEIGHT = 288;

export function describeSkillAllowlist(input: {
  readonly selectedCount: number;
  readonly total: number;
}): string {
  if (input.selectedCount === 0) return "No skills";
  if (input.selectedCount === input.total) return "All skills";
  return `${input.selectedCount} of ${input.total} skills`;
}

/** A searchable multi-select over skill names, virtualized for large catalogs. */
export function SkillAllowlistPicker(props: {
  readonly ariaLabel: string;
  readonly choices: ReadonlyArray<ProviderSkillChoice>;
  readonly selected: ReadonlySet<string>;
  readonly trigger: ReactElement;
  readonly children: ComponentProps<typeof ComboboxTrigger>["children"];
  readonly disabled?: boolean;
  readonly scanning?: boolean;
  readonly resetLabel?: string;
  readonly popupSide?: ComponentProps<typeof ComboboxPopup>["side"];
  readonly popupProps?: Record<`data-${string}`, string>;
  readonly onChange: (names: ReadonlyArray<string>) => void;
  readonly onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<LegendListRef | null>(null);
  const [listHeight, setListHeight] = useState(LIST_MAX_HEIGHT);
  const handleMetricsChange = () => {
    const metrics = listRef.current?.getState();
    if (metrics) setListHeight(Math.min(metrics.contentLength, LIST_MAX_HEIGHT));
  };
  const scrollRef = useLegendListRef(listRef, handleMetricsChange);

  const trimmedQuery = query.trim().toLowerCase();
  const items = props.choices
    .filter(
      (choice) =>
        trimmedQuery.length === 0 ||
        choice.name.toLowerCase().includes(trimmedQuery) ||
        choice.description?.toLowerCase().includes(trimmedQuery) === true,
    )
    .map((choice) => choice.name);
  const descriptions = new Map(props.choices.map((choice) => [choice.name, choice.description]));
  const value = props.choices
    .map((choice) => choice.name)
    .filter((name) => props.selected.has(name));

  const renderItem = (name: string, index: number) => {
    const description = descriptions.get(name);
    return (
      <ComboboxItem key={name} index={index} value={name} selectedFill={false}>
        <span className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{name}</span>
            {description ? (
              <span className="truncate text-muted-foreground text-xs">{description}</span>
            ) : null}
          </span>
          {props.selected.has(name) ? (
            <CheckIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          ) : null}
        </span>
      </ComboboxItem>
    );
  };

  return (
    <Combobox
      multiple
      items={items}
      filteredItems={items}
      autoHighlight
      virtualized
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setQuery("");
      }}
      value={value}
      onValueChange={(next) => props.onChange(next)}
      onItemHighlighted={(_value, eventDetails) => {
        if (!open || eventDetails.index < 0 || eventDetails.reason !== "keyboard") return;
        void listRef.current?.scrollIndexIntoView?.({ index: eventDetails.index, animated: false });
      }}
      disabled={props.disabled}
    >
      <ComboboxTrigger ref={triggerRef} aria-label={props.ariaLabel} render={props.trigger}>
        {props.children}
      </ComboboxTrigger>
      <ComboboxPopup
        align="end"
        side={props.popupSide ?? "bottom"}
        anchor={triggerRef}
        className="flex w-80 flex-col"
        {...props.popupProps}
      >
        <ComboboxSearchInput
          placeholder="Search skills…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex items-center gap-1 px-2 pt-1.5">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => props.onChange(props.choices.map((choice) => choice.name))}
          >
            All
          </Button>
          <Button size="xs" variant="ghost" onClick={() => props.onChange([])}>
            None
          </Button>
          {props.onReset && props.resetLabel ? (
            <Button size="xs" variant="ghost" className="ms-auto" onClick={props.onReset}>
              {props.resetLabel}
            </Button>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ComboboxEmpty>
            {props.scanning === true && props.choices.length === 0
              ? "Looking for skills…"
              : "No skills found."}
          </ComboboxEmpty>
          <div className="relative min-h-0 max-h-72 w-full flex-1 overflow-hidden">
            <ComboboxListVirtualized>
              <LegendList<string>
                ref={scrollRef}
                data={items}
                dataKey={query}
                initialScrollOffset={0}
                // Base UI selects virtualized rows by index; rerender surviving rows when filtering moves them.
                extraData={{ items, selected: props.selected }}
                keyExtractor={(item) => item}
                renderItem={({ item, index }) => renderItem(item, index)}
                estimatedItemSize={44}
                drawDistance={360}
                onScroll={handleMetricsChange}
                onLayout={handleMetricsChange}
                onReady={handleMetricsChange}
                style={{ height: listHeight }}
              />
            </ComboboxListVirtualized>
          </div>
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}
