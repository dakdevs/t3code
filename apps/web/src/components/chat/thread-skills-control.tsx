import { useAtomValue } from "@effect/atom-react";
import { resolveProviderSkillChoices } from "@t3tools/client-runtime/providerSkills";
import type { EnvironmentId, ProviderInstanceId, ServerProviderSkill } from "@t3tools/contracts";
import { ChevronUpIcon, SparklesIcon } from "lucide-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import type { Thread } from "../../types";
import { describeSkillAllowlist, SkillAllowlistPicker } from "../skill-allowlist-picker";
import { composerFloatingLayerProps } from "./composerEventScope";

/** Narrows the project's skills for one thread; the next message starts with the new list. */
export function ThreadSkillsControl(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: Pick<Thread, "id" | "projectId" | "skillSelection">;
  readonly instanceId: ProviderInstanceId;
  readonly catalog: ReadonlyArray<ServerProviderSkill>;
  readonly scanning: boolean;
}) {
  // Older servers ignore skill selections, so the control stays hidden there.
  const supported = useAtomValue(
    serverEnvironment.configValueAtom(props.environmentId),
    (config) => config?.environment.capabilities.providerSkillSelection === true,
  );
  const projectSkills = useEnvironmentSettings(
    props.environmentId,
    (settings) =>
      settings.projectSettingsOverrides[props.thread.projectId]?.providerSkills?.[props.instanceId],
  );
  const setThreadSkills = useOrchestrationCommand(
    threadEnvironment.setSkills,
    "Could not update this thread's skills",
  );
  const threadSelection =
    props.thread.skillSelection?.instanceId === props.instanceId
      ? props.thread.skillSelection
      : null;
  const { choices, selected } = resolveProviderSkillChoices({
    catalog: props.catalog,
    offered: projectSkills,
    selected: threadSelection?.names,
  });
  const label =
    choices.length === 0
      ? "Skills"
      : describeSkillAllowlist({ selectedCount: selected.size, total: choices.length });
  const setSelection = (names: ReadonlyArray<string> | null) =>
    void setThreadSkills({
      environmentId: props.environmentId,
      input: {
        threadId: props.thread.id,
        skillSelection: names === null ? null : { instanceId: props.instanceId, names },
      },
    });

  if (!supported) return null;
  return (
    <SkillAllowlistPicker
      ariaLabel={`Skills for this thread: ${label}`}
      choices={choices}
      selected={selected}
      scanning={props.scanning}
      popupSide="top"
      popupProps={composerFloatingLayerProps}
      onChange={setSelection}
      {...(threadSelection === null
        ? {}
        : { resetLabel: "Use project skills", onReset: () => setSelection(null) })}
      trigger={
        <button
          type="button"
          data-composer-skills-trigger
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs outline-none hover:bg-foreground/[0.09] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-popup-open:bg-foreground/[0.09] data-popup-open:text-foreground"
        />
      }
    >
      <SparklesIcon aria-hidden="true" className="size-3.5" />
      {label}
      <ChevronUpIcon aria-hidden="true" className="size-3" />
    </SkillAllowlistPicker>
  );
}
