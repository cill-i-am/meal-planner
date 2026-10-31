import { Clock, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import type { ProviderWrite } from "./controls-client.js";
import { makeEnergyProfileClient } from "./energy-profile-client.js";
import { failure } from "./model.js";
import type { StationId } from "./model.js";
import { writableResidentialPreheating } from "./preheating.js";
import { makeProfileClient } from "./profile-client.js";
import {
  ProfileControlSnapshot,
  proposedProfile,
  profileBody,
  profileSettingsEqual,
} from "./profile-controls.js";
import type {
  ProfileChange,
  ProfileConfiguration,
} from "./profile-controls.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { ScheduleWindow, nonOverlappingWindows } from "./schedules.js";
import { makeSettingsClient } from "./settings-client.js";

const withoutTime = ({
  fetchedAt: _fetchedAt,
  ...profile
}: ProfileConfiguration & { fetchedAt: number }): ProfileConfiguration =>
  profile;
const serializableProfile = (profile: ProfileConfiguration): boolean =>
  !profile.industrial &&
  [0, 1].includes(profile.providerActiveStatus) &&
  [0, 1].includes(profile.peakShaving.providerControlMode) &&
  profile.peakShaving.slots.every(Schema.is(ScheduleWindow)) &&
  nonOverlappingWindows(profile.peakShaving.slots) &&
  writableResidentialPreheating(profile.preheating) &&
  profile.solarPriority.every(
    (entry) =>
      !entry.group &&
      entry.groupPath.length === 1 &&
      [0, 1, 2].includes(entry.providerStatus) &&
      [1, 3, 4].includes(entry.providerLoadType) &&
      [null, 4].includes(entry.providerDeviceType) &&
      entry.smartLoadPath === null
  ) &&
  profile.batteryDischargeSources.every(
    (source) => source === "pv" || source === "grid"
  ) &&
  profile.batteryGroups.every(
    (group) =>
      [0, 1, 3, 6].includes(group.providerMode) &&
      [0, 1].includes(group.providerActiveStatus) &&
      group.sourcePriority.every((source) => ["pv", "grid"].includes(source)) &&
      group.windows.every(Schema.is(ScheduleWindow))
  ) &&
  profile.gridGroups.every(
    (group) =>
      [0, 1, 2].includes(group.providerMode) &&
      [0, 1].includes(group.providerActiveStatus) &&
      group.sourcePriority.every((source) =>
        ["pv", "battery"].includes(source)
      ) &&
      group.windows.every(Schema.is(ScheduleWindow))
  );

export const makeProfileControlsClient = (
  read: ProviderRead,
  write: ProviderWrite
) => {
  const energy = makeEnergyProfileClient(read);
  const settings = makeSettingsClient(read);
  const inspect = (
    stationId: StationId,
    change: ProfileChange,
    token: Redacted.Redacted<string>
  ) =>
    Effect.gen(function* inspectProfileCommand() {
      const inventory = yield* settings.operatingModes(stationId, token);
      const currentMode = yield* read(
        `/device/energy-profile/mode/current/${stationId}`,
        token
      ).pipe(
        Effect.flatMap(
          decodeProvider(
            Schema.Struct({
              currentMode: Schema.Number,
              currentProfileId: Schema.Number,
            })
          )
        )
      );
      const readProfile = (
        target: Parameters<typeof energy.energyProfile>[0]["target"]
      ) =>
        energy
          .energyProfile({ stationId, target }, token)
          .pipe(Effect.map(withoutTime));
      let source: ProfileConfiguration | null = null;
      let selected: ProfileConfiguration | null = null;
      if (change.operation === "create_energy_profile") {
        source = yield* readProfile(change.source);
        const matches = inventory.customProfiles.filter(
          (profile) => profile.name === change.name
        );
        if (matches.length === 1 && matches[0] !== undefined) {
          selected = yield* readProfile({
            kind: "custom",
            profileId: matches[0].profileId,
          });
        }
      } else if (change.operation === "replace_automation_schedule") {
        selected = yield* readProfile({ kind: "current" });
      } else if (
        inventory.customProfiles.some(
          (profile) => profile.profileId === change.profileId
        )
      ) {
        selected = yield* readProfile({
          kind: "custom",
          profileId: change.profileId,
        });
      }
      return yield* decodeProvider(ProfileControlSnapshot)({
        kind: "profile",
        settings: {
          currentMode: {
            profileId: currentMode.currentProfileId,
            providerMode: currentMode.currentMode,
          },
          fetchedAt: yield* Clock.currentTimeMillis,
          profiles: inventory.customProfiles,
          selected,
          source,
          stationId,
        },
      });
    });
  const validate = (
    stationId: StationId,
    change: ProfileChange,
    snapshot: ProfileControlSnapshot,
    token: Redacted.Redacted<string>
  ) =>
    Effect.gen(function* validateProfileCommand() {
      const state = snapshot.settings;
      if (change.operation === "delete_energy_profile") {
        if (state.selected === null) {
          return yield* failure("InvalidInput");
        }
        if (
          state.currentMode.profileId === change.profileId ||
          state.selected.providerActiveStatus !== 0
        ) {
          return yield* failure("Conflict");
        }
        return;
      }
      const base =
        change.operation === "create_energy_profile"
          ? state.source
          : state.selected;
      if (base === null) {
        return yield* failure("InvalidInput");
      }
      if (!serializableProfile(base)) {
        return yield* failure("UnsupportedCapability");
      }
      const proposed = proposedProfile(change, base);
      if (
        state.profiles.some(
          (profile) =>
            profile.name === proposed.profileName &&
            (change.operation === "create_energy_profile" ||
              profile.profileId !== base.providerProfileId)
        )
      ) {
        return yield* failure("Conflict");
      }
      if (proposed.timezone !== base.timezone) {
        return yield* failure("InvalidInput");
      }
      const replacement =
        change.operation === "replace_automation_schedule"
          ? change.replacement
          : undefined;
      const automation =
        change.operation === "update_energy_profile"
          ? change.edits.automation
          : replacement;
      if (automation === undefined) {
        return;
      }
      const capabilities = yield* makeProfileClient(read).energyCapabilities(
        stationId,
        token
      );
      const features = capabilities.providerFeatures;
      if (
        !features.support ||
        (!features.hasBatteryAutomation &&
          !profileSettingsEqual(
            [automation.batteryEnabled, automation.batteryGroups],
            [base.batteryEnabled, base.batteryGroups]
          )) ||
        (!features.hasGridAutomation &&
          !profileSettingsEqual(
            [automation.gridEnabled, automation.gridGroups],
            [base.gridEnabled, base.gridGroups]
          ))
      ) {
        return yield* failure("UnsupportedCapability");
      }
      if (
        automation.batteryGroups.some((group) =>
          group.sourcePriority.some(
            (source) => !capabilities.batterySourceOptions.includes(source)
          )
        ) ||
        automation.gridGroups.some((group) =>
          group.sourcePriority.some(
            (source) => !capabilities.gridSourceOptions.includes(source)
          )
        )
      ) {
        return yield* failure("UnsupportedCapability");
      }
    });
  const dispatch = (
    stationId: StationId,
    change: ProfileChange,
    snapshot: ProfileControlSnapshot,
    token: Redacted.Redacted<string>
  ) => {
    if (change.operation === "delete_energy_profile") {
      return write(
        "DELETE",
        `/device/energy-profile/setting/${stationId}/${change.profileId}`,
        null,
        token
      );
    }
    const base =
      change.operation === "create_energy_profile"
        ? snapshot.settings.source
        : snapshot.settings.selected;
    if (base === null) {
      return failure("SchemaMismatch");
    }
    return write(
      change.operation === "create_energy_profile" ? "POST" : "PUT",
      change.operation === "create_energy_profile"
        ? "/device/energy-profile/setting/new"
        : "/device/energy-profile/setting",
      profileBody(proposedProfile(change, base)),
      token
    );
  };
  return { dispatch, inspect, validate };
};
