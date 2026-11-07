# Saved profile parameters

`set_energy_profile_parameters` edits an enumerated, inactive residential custom profile through the existing `prepare_command` → `approve_command` → `execute_command` lifecycle. It adds one typed command family; HTTP/MCP still expose 47 operations. The six accepted production operations remain enabled. This new operation is excluded from production dispatch pending separate live acceptance.

## Inputs and behavior

Supply `profileId` and a nonempty `parameters` object. Each supplied group is complete; omitted groups retain their reviewed values.

| Parameter | Input | Validation |
| --- | --- | --- |
| `batterySoc` | `chargeSocPercent`, `dischargeSocPercent`, `backupSocPercent` | Integers 0–100; discharge and backup cannot exceed charge. Battery and backup setting capabilities required. An enabled peak-shaving reserve must remain between the new discharge/backup minimum and charge maximum. |
| `batteryPower` | `charge`, `discharge` power limits | Battery setting capability required. Each limit is `{kind:"limited",watts:0..4294967294}` or `{kind:"unlimited"}`. |
| `gridExport` | `enabled`, `limit` | Known installer export ceiling required, even for a disabled owner limit. Finite ceilings cannot be exceeded or replaced with unlimited. |
| `gridImport` | `enabled`, `limit` | Same rules against the installer import ceiling. |
| `solarLimit` | Power limit | Identity-checked station must report solar equipment. |

All changes require profile support and residential capabilities. Both the current operating-mode profile ID and the selected profile's active marker must prove inactivity. Neither profile activation nor current-station settings are changed. Power uses watts publicly and kW in the provider request; unlimited retains the observed sentinel. Unset values cannot be submitted as new parameters.

The complete profile is reviewed, checked for concurrent changes, serialized using the existing full-profile PUT and compared on readback. Name, description, automation, priorities, preheating, peak shaving and omitted parameters are preserved. Unexpected changes fail verification. Unsupported ancillary configuration still refuses the full write.

The operation has its own station/profile-scoped approval identity and dispatch gate. A grant for `update_energy_profile` does not authorize parameter edits, and parameter grants do not authorize metadata updates, deletion or another profile. Revocation invalidates queued commands. Already attempted requests reconcile by reads; an uncertain write is never resent. Capabilities and installer limits are checked again immediately before dispatch.

## Primary protocol evidence

The public EU app inspected on 4 November 2026 uses release `cdn-eu-b148-fee0b7a4adfa`. In `main.dart_21.1322af31.js`, `aRf.F()` writes the full profile using `chargeSOC`, `dischargeSOC`, `backupSOC`, `batteryMaxChargingPower`, `batteryMaxDischargingPower`, `exportLimitation`, `maxExportLimitation`, `importLimitation`, `maxImportLimitation` and `powerLimit`. These are the fields already preserved by the implemented full-profile serializer. The new adapter exposes selected typed replacements rather than caller-supplied payloads.

Source: [public profile DTO bundle](https://files-app-eu.sigencloud.com/flutter-app/releases/cdn-eu-b148-fee0b7a4adfa/main.dart_21.1322af31.js), SHA-256 `36d4d6ba754f3fd5e6f124ca6a0606efd7a061e54ca5c9cb58eef6ae146daa98`. Inactivity, separate approval scope and refusal of unknown ceilings are conservative client constraints; the serializer alone does not prove provider acceptance.

## Verification and remaining limits

Tests cover exact full-profile serialization, watts/kW conversion, unchanged-field preservation, complete readback mismatch detection, invalid inputs, both activation signals, capabilities, solar absence, installer ceilings and changed ceilings, peak-reserve consistency, once/always grant separation, restart, revocation, conflicts and ambiguous-outcome no-replay behavior.

Read-only Executor preflight on 4 November confirmed a healthy connection and the existing six-operation allowlist. The station reports residential profile, battery and backup-setting support. Both installer grid ceilings are unset, so grid parameter changes are intentionally refused on this account. No profile or physical setting was changed during this preflight.

Priority editing, embedded peak/preheating replacement, active-profile parameter editing, industrial/grouped profile writes and TOU/Remote EMS activation remain outside this increment. Existing dedicated current-setting commands retain their separate contracts. Live parameter write acceptance has not been performed.

Local verification passed **306 focused tests**, package/app type checks, package build, scoped lint/format, complexity and documentation checks. The native Worker/MCP test passed in **84.62 seconds**. Independent spec and standards reviews are clear after fixing an exact-installer-ceiling rounding issue: 1001 W is accepted at a 1.001 kW ceiling, while 1002 W is rejected. The ceiling comparison permits only sub-microwatt conversion noise.

The live inventory currently contains no custom profiles. Positive hosted parameter preparation and provider write acceptance therefore require a separately authorized disposable inactive profile; no profile was created merely to complete this implementation check.

## Hosted verification, 4 November 2026

Code `d0a0ee32` deployed at **11:44:40.037 UTC**, preserving the account Durable Object and connection. Authenticated MCP discovery returned 47 tools and advertised the new operation with all five parameter groups. Connection status confirmed exactly the existing six enabled operations; parameter dispatch remained excluded. HTTP preparation against a nonexistent custom profile returned `400 InvalidInput`, confirming membership refusal through the deployed boundary. This is negative preparation and discovery evidence, not positive provider write acceptance.

Executor initially retained the previous input catalogue. Its pinned SDK allows one day of stale metadata after five minutes of freshness; the integration now explicitly limits the stale window to five minutes. Deployment `dpl_cabf5909-69c4-438f-8c17-56bf695feb4b` at **11:56:35.306 UTC** retained the existing account and approval policy. A fresh Executor discovery then advertised the new operation and all five groups. Its connection read confirmed `connected` and exactly the six accepted operations. No parameter write was approved or executed.
