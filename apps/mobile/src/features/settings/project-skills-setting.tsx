import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import {
  createProviderWorkspaceSnapshotRefreshAtomFamily,
  isProviderWorkspaceSnapshotScanning,
  resolveProviderSkillChoices,
  resolveProviderSkillsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import type { ProjectId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { buildProviderSkillsOverridePatch } from "@t3tools/shared/projectSettings";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppBarSearch } from "../../components/ui/AppBar.types";
import { useSearchToolbarInset } from "../../components/ui/useBarInset";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SettingsTarget } from "./settings-environment-filter";

const workspaceSnapshotRefresh = createProviderWorkspaceSnapshotRefreshAtomFamily({
  providers: serverEnvironment.providersValueAtom,
  refreshProviders: serverEnvironment.refreshProviders,
});

export function ProjectSkillsSetting(props: {
  readonly environment: SettingsTarget;
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider;
  readonly workspaceRoot: string;
  readonly onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const refreshState = useAtomValue(
    workspaceSnapshotRefresh({
      environmentId: props.environment.environmentId,
      instanceId: props.instanceId,
      cwd: props.workspaceRoot,
    }),
  );
  const insets = useSafeAreaInsets();
  const canWrite = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(props.environment.environmentId),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "project skills update");
  const config = props.environment.serverConfig;
  const provider = props.provider;
  const selectedNames = props.projectIds[0]
    ? config.settings.projectSettingsOverrides[props.projectIds[0]]?.providerSkills?.[
        props.instanceId
      ]
    : undefined;
  const { choices, selected } = resolveProviderSkillChoices({
    catalog: resolveProviderSkillsForCwd(provider, props.workspaceRoot),
    offered: undefined,
    selected: selectedNames,
  });
  const write = (names: ReadonlyArray<string> | undefined) => {
    const projectSettingsOverrides = buildProviderSkillsOverridePatch(
      config.settings,
      props.projectIds,
      props.instanceId,
      names,
    );
    void updateSettings({
      environmentId: props.environment.environmentId,
      input: { patch: { projectSettingsOverrides } },
    });
  };
  const scanning = isProviderWorkspaceSnapshotScanning(refreshState);
  const search: AppBarSearch = {
    value: query,
    onChangeText: setQuery,
    placeholder: "Find a skill",
    clearAccessibilityLabel: "Clear skill search",
    mode: "inline",
    compactToolbar: true,
  };
  const searchToolbarInset = useSearchToolbarInset(search);
  const normalized = query.trim().toLowerCase();
  const rows = choices.filter(
    (choice) =>
      !normalized ||
      choice.name.toLowerCase().includes(normalized) ||
      choice.description?.toLowerCase().includes(normalized),
  );
  return (
    <View className="flex-1 bg-sheet">
      <AppBar title="Project skills" onBack={props.onBack} hideBottomBorder search={search} />
      <ScreenContent>
        {/* oxlint-disable-next-line t3code/require-registered-list-scroll -- Settings editor owns its list and header. */}
        <LegendList
          data={rows}
          keyExtractor={(choice) => choice.name}
          estimatedItemSize={56}
          recycleItems
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: insets.bottom + searchToolbarInset + 24 }}
          ListHeaderComponent={
            <View className="gap-3 px-5 py-4">
              <Text className="text-foreground-muted">
                {selectedNames === undefined
                  ? "Provider default"
                  : `${selected.size} of ${choices.length}`}{" "}
                · Changes apply to each thread's next message. Threads can narrow this list.
              </Text>
              <ListActionRow
                label="Turn all on"
                disabled={!canWrite || scanning}
                onPress={() => write(choices.map((choice) => choice.name))}
              />
              <ListActionRow
                label="Turn all off"
                disabled={!canWrite || scanning}
                onPress={() => write([])}
              />
              {selectedNames !== undefined ? (
                <ListActionRow
                  label="Use provider default"
                  disabled={!canWrite || scanning}
                  onPress={() => write(undefined)}
                />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <Text className="px-5 py-8 text-foreground-muted">
              {scanning
                ? "Scanning skills…"
                : choices.length
                  ? "No matching skills"
                  : "No skills found for this project"}
            </Text>
          }
          renderItem={({ item }) => (
            <View className="min-h-14 flex-row items-center gap-3 px-5 py-2">
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-foreground">{item.name}</Text>
                {item.description ? (
                  <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <ThemedSwitch
                accessibilityLabel={item.name}
                disabled={!canWrite || scanning}
                value={selected.has(item.name)}
                onValueChange={(on) =>
                  write(
                    choices
                      .filter((choice) =>
                        choice.name === item.name ? on : selected.has(choice.name),
                      )
                      .map((choice) => choice.name),
                  )
                }
              />
            </View>
          )}
        />
      </ScreenContent>
    </View>
  );
}
