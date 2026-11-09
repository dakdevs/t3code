import { useAtomValue } from "@effect/atom-react";
import {
  hasCompleteProviderWorkspaceSnapshot,
  resolveProviderSkillChoices,
  resolveProviderSkillsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import type {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useProviderWorkspaceSnapshotRefresh } from "../chat/useProviderWorkspaceSnapshotRefresh";
import { describeSkillAllowlist, SkillAllowlistPicker } from "../skill-allowlist-picker";
import { useSkillSelectionSave } from "../use-skill-selection-save";
import { SelectButton } from "../ui/select";
import { buildProviderSkillsOverridePatch } from "./ProviderSettingsPanel.logic";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

/** The skills agents in a project get from one provider instance, read from the project's checkout. */
export function ProjectSkillsSetting(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider;
  readonly projectIds: readonly ProjectId[];
  readonly workspaceRoot: string;
  readonly canWrite: boolean;
}) {
  const supported = useAtomValue(
    serverEnvironment.configValueAtom(props.environmentId),
    (config) => config?.environment.capabilities.providerSkillSelection === true,
  );
  const settings = useEnvironmentSettings(props.environmentId);
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  const { scanning } = useProviderWorkspaceSnapshotRefresh({
    environmentId: props.environmentId,
    gitCwd: props.workspaceRoot,
    instanceId: props.instanceId,
  });
  const representativeProjectId = props.projectIds[0];
  const projectSkills =
    representativeProjectId === undefined
      ? undefined
      : settings.projectSettingsOverrides[representativeProjectId]?.providerSkills?.[
          props.instanceId
        ];
  const { saving, save } = useSkillSelectionSave({
    target: `${props.environmentId}:${props.projectIds.join(":")}:${props.instanceId}`,
    selection: projectSkills,
  });
  if (!supported || representativeProjectId === undefined) return null;
  const { choices, selected } = resolveProviderSkillChoices({
    catalog: resolveProviderSkillsForCwd(props.provider, props.workspaceRoot),
    offered: undefined,
    selected: projectSkills,
  });
  const label =
    projectSkills === undefined
      ? "Provider default"
      : describeSkillAllowlist({ selectedCount: selected.size, total: choices.length });
  const write = (names: ReadonlyArray<string> | undefined) => {
    if (!props.canWrite) return;
    void save(
      names,
      () =>
        new Promise<boolean>((resolve) =>
          updateSettings(
            {
              projectSettingsOverrides: buildProviderSkillsOverridePatch(
                settings,
                props.projectIds,
                props.instanceId,
                names,
              ),
            },
            { onSaved: () => resolve(true), onFailed: () => resolve(false) },
          ),
        ),
    );
  };

  return (
    <SettingsRow
      title="Available skills"
      description="Skills agents in this project can use. Threads can narrow this list. Changes apply to each thread's next message. You can still run any skill yourself by typing its command."
      resetAction={
        projectSkills === undefined ? null : (
          <SettingResetButton
            label="Available skills"
            tooltip="Reset to the provider default"
            disabled={!props.canWrite || saving}
            onClick={() => write(undefined)}
          />
        )
      }
      control={
        <SkillAllowlistPicker
          ariaLabel={`Available skills: ${label}`}
          choices={choices}
          selected={selected}
          scanning={scanning}
          catalogReady={hasCompleteProviderWorkspaceSnapshot(props.provider, props.workspaceRoot)}
          disabled={!props.canWrite || saving}
          onChange={write}
          trigger={<SelectButton size="sm" />}
        >
          {label}
        </SkillAllowlistPicker>
      }
    />
  );
}
