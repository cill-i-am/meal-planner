# Active profile parameters and time-of-use activation

These commands use `prepare_command`, `approve_command` with `once` or `always`, then `execute_command`. Approval is bound to the saved review. Execution rereads the settings, refuses a conflict and records the attempt before making one provider request. An ambiguous outcome is reconciled by readback. Production dispatch for each new command requires live acceptance.

## Active profile parameters

`set_active_energy_profile_parameters` changes the backup reserve for the current Sigen AI profile. Supply target `{kind:"built_in",providerMode:1}` and a single `batterySoc` group with the requested `backupSocPercent` and the profile’s existing charge and discharge thresholds. The service still reads older saved review formats. The [inactive profile contract](profile-parameters.md) is separate.

The provider receives only the numeric station ID and backup reserve in a dedicated PUT to `/device/setting/backup/reserve`. The review includes the station's reserve and full active profile. The client verifies station identity and matching Sigen AI mode before and after reading. Verification requires the requested value at the dedicated read route, the same operating mode and exact equality of the remaining profile fields, including every solar-priority value and its order. The full profile’s reserve field can either reflect the dedicated value or retain its reviewed value. The approval scope remains bound to the operation, station and active Sigen AI target.

### Live acceptance on 8 November 2026

The user approved a temporary edit of the active Sigen AI profile’s backup reserve from 20% to 21%, followed by restoration to 20% and revocation of the test grant. The battery reported 100% before the test. Executor saved the temporary, mode-scoped always approval and made one dispatch attempt at **07:59:07 UTC**. The command returned `outcome_unknown` with `CommandOutcomeUnknown`.

The restoration review read 20% at **07:59:13 UTC**, and later independent reads confirmed 20% in both the active profile and the station’s backup-reserve setting. No restoration write was needed for the reserve. The complete comparison, excluding fetch timestamps, found one other difference. The excluded solar-priority entry with load type 3 and status 2 retained its position and exclusion status, but its stored priority changed from 4 to 2. The other profile fields, operating mode and battery settings matched the baseline. The existing typed priority command refuses edits to excluded entries, so the previous rank was not restored.

The uncertain write was never replayed. Executor confirmed zero grants and the original six enabled operations after the production allowlist was restored at **08:00:26 UTC**. The pinned app uses a dedicated route for backup reserve near lines 91323–91333 and 779370–779384, and sends null solar priorities when saving unrelated automation near 639958–639982.

The dedicated-route retest on `ef092932` verified **21% at 08:15:35.719 UTC** and **20% at 08:16:43.605 UTC**. Both Executor receipts matched the complete solar-priority list and order from the retest baseline. Independent final reads matched the complete active profile, battery settings and operating mode, excluding fetch timestamps. The temporary Sigen AI grant was revoked, leaving zero grants. Production and the protected deployment configuration now enable the reserve-only active-profile command alongside the six earlier operations.

## Active profile limits

`set_active_energy_profile_limits` uses the same Sigen AI target and accepts one `setting` per review.

| Setting kind | Input | Dedicated provider write |
| --- | --- | --- |
| `battery_power` | `charge` and `discharge` limits in watts or unlimited | PUT `/device/energy-profile/battery/limit` |
| `battery_soc` | `chargeSocPercent` and `dischargeSocPercent` | PUT `/device/energy-profile/battery/level` |
| `solar_power` | `limit` in watts or unlimited | PUT `/device/energy-profile/solar/limit` |
| `grid_power` | `direction` (`import` or `export`) and `watts` | PUT `/device/energy-profile/grid/limitation/{direction}` |

The charge and discharge thresholds must respect the reviewed backup settings and any enabled peak-shaving reserve. The request carries forward the current backup threshold and peak-shaving threshold. For a disabled peak-shaving schedule with an unset threshold, it sends null as the app’s current-settings serializer does. A grid edit enables the selected owner limit and requires a known installer ceiling. The other direction and installer settings must match on readback.

Preparation and execution bracket the full profile and dedicated settings reads with mode checks. Verification requires the requested dedicated value and compares the rest of the dedicated settings and full profile, including solar-priority order and values. Copies of the requested field inside the full profile may reflect either the reviewed or requested value. Each always grant binds the station, Sigen AI target and setting group, with import and export scoped separately. The reserve command has its own grant. Dispatch for the new command is gated separately pending live write acceptance.

## Time of use

`get_time_of_use_settings` reads the saved timetable, the station timezone and provider configuration. Limits retain provider values in kW and percent. mySigen displays null and omitted limits as equipment defaults. `activate_time_of_use_mode` requires the station to advertise mode 2 and have a nonempty, nonoverlapping manual timetable with known slot modes and valid limits. An empty timetable can be configured in mySigen. The write sends a mode switch with `profileId: -1` and `fromPlatform: 1`. The saved timetable is part of the immutable review and must still match after activation. A reusable activation grant applies only to this operation and station.

The adapter currently covers residential manual TOU activation. Timetable editing, tariff-generated TOU and Remote EMS are separate contracts.

## Protocol evidence

The pinned [EU mySigen app bundle](https://files-app-eu.sigencloud.com/flutter-app/releases/cdn-eu-b148-fee0b7a4adfa/main.dart.38d261ea.js) reads and saves the current profile at lines 83260–83326 and 209326–209338. The dedicated limit routes appear near lines 83214–83395. The battery threshold DTO at line 400602 serializes the nullable peak-shaving field assembled by the app near line 622555. The current-settings editor uses the full PUT serializer near lines 639955–639982. The mode UI calls `W9` with mode 2 and profile ID -1 near lines 819596 and 819903–819910. Its `bm3` helper sends `fromPlatform: 1` to the mode endpoint. The separate saved timetable and configuration reads appear near lines 91370–91390 and 91462–91495. Manual rows use `currType: 1`, with charge/discharge/self-consumption codes 0, 1 and 3. The adapter does not infer behavior from missing rules or unknown values.
