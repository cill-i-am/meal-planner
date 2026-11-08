# Expanded profile and device contracts

The 4 November expansion adds nine reads and four control families: **56 HTTP/MCP operations and 26 typed control families** overall. The same operation registry drives HTTP, OpenAPI and MCP. Executor recognizes the new read names. All new writes remain disabled pending their own live acceptance; existing six accepted operations retain their authorization boundary.

## Protocol evidence

The public EU app release is `cdn-eu-b148-fee0b7a4adfa`. Its [main bundle](https://files-app-eu.sigencloud.com/flutter-app/releases/cdn-eu-b148-fee0b7a4adfa/main.dart.38d261ea.js) was inspected without using account payloads. SHA-256: `db78c535daf7d75a79d649ac3fea3fe1d86e85b12e714ee6ca05a38fc906d39c`. Line references refer to that immutable bundle, not the current mutable app.

| Protocol | Source evidence |
| --- | --- |
| Smart-load settings/history | `nKO`, `nKM`, `nKV`, `nLe`, `nLa`, `mqY`, `mzA` and serializers near lines 85460–85960 and 410077–410216. |
| Manual/automatic mode | `cOO` PATCH query; UI near line 530450 maps 1 to manual and 0 to automatic. |
| Off-grid control | `nL5` PUT strips backup/charge/legacy read-only fields and omits thresholds unless mode 1. Enum constants near line 1022293 define 0 keep-connected, 1 SOC-based and 2 disconnect. Thresholds serialize as strings. |
| Station consumption | `b2` query near line 93645; DTO near line 408091 contains station ID, base total, load-ID map and detail series. |
| Charger inventory/status/settings | Home serial lists near lines 76853/77433; charging mode near 79130; DC settings near 79200; AC current near 79525; plug status near 91125; AC electrical DTO near 396620. |
| Charger schedules | `nGZ` near line 212848 and `b1E.e4A` near 582665. Charging summary fields are exposed; unverified thermal region payloads are omitted explicitly. |
| Profile extras | Full-profile read/write serializers and residential schedule conversion documented in [profile parameters](profile-parameters.md) and [profile schedules](profile-schedules.md). |

## Profile controls

`set_energy_profile_priorities` accepts an optional complete battery-source permutation and/or complete flat solar-priority permutation. Membership and priority values must exactly match the saved profile; excluded rows keep their priority. Grouped or smart-load priority edits are refused. Metadata and omitted groups are retained.

`set_energy_profile_schedules` replaces the selected embedded peak-shaving and/or residential preheating schedule. Inputs use local `HH:mm`, weekday codes 1–7, integer W and SOC percent. Limits are 12 peak windows and four preheating windows, with no same-day overlap. Enabled peak reserve must be between the profile's discharge/backup floor and charge ceiling. The timezone must match station metadata. These edits do not activate the profile; its active marker and current mode must both show inactivity.

Each operation has a distinct profile-scoped approval and dispatch gate. The provider receives one full-profile PUT, with complete configuration readback. A changed unrelated field prevents verification. Standalone peak-shaving switch-off retention is not assumed to prove embedded-profile replacement behavior. No new embedded-profile write has been accepted live.

## Smart-load controls

`set_smart_load_mode` reviews the load identity, on-grid schedules/PV parameters, off-grid settings and timezone before changing only manual/automatic mode. Known mode and manual-switch values must agree between detail and control settings. Activating automatic mode requires complete known schedule settings, including SOC bounds for battery-only rows and nonnegative finite starting/rated power for solar-only rows; the raw read surface remains broader than writable controls. Verification requires both mode observations and unchanged saved settings.

`set_smart_load_off_grid_control` accepts keep-connected, disconnect, or SOC hysteresis with connect-above-disconnect integer thresholds. SOC control requires known backup/charge bounds and thresholds inside them. Read-only bounds are never written. Non-SOC modes omit inactive thresholds; their retention is not promised. Verification confirms the requested mode/thresholds, unchanged on-grid settings and unchanged battery bounds.

Both use separate operation/load-key/load-path approval scopes. Preparation and dispatch recheck capability and configuration. Unknown results are reconciled without replay. The older manual-switch adapter now uses the current app's `third-party-device` route; its request remains PATCH with query parameters and no body. All smart-load write families remain disabled pending hardware acceptance.

### On-grid schedule replacement

`set_smart_load_schedule` takes a load key and path plus `schedule` with `timezone`, `timed`, `readyBy` and `solar`. It replaces both saved lists in one POST. Add, edit or remove rows by supplying the full desired lists. Each row carries an `enabled` flag. Two empty lists clear the schedule in manual mode. Clearing or disabling every row in automatic mode first requires a separately approved switch to manual mode.

Timed rows use station-local `HH:mm` and weekday codes `1` through `7`. Choose `system` or `solar_only` with an explicit `batteryBoost` flag, or `battery_only` with ordered SOC bounds. Ready-by rows supply `endTime` and `durationMinutes`. The write contract accepts up to five timed rows and three ready-by rows. Overnight windows, overlapping timed rows and any shared weekday between ready-by and timed rows are excluded. Each weekday can have one ready-by rule. These limits avoid relying on unverified provider precedence, even for currently disabled rows.

Solar-only rows share `solar.startingPowerW` and `solar.ratedPowerW`. The adapter converts W to the app's kW fields and preserves the reviewed raw `minRunTime`, whose unit remains unverified. A replacement without solar-only rows uses `solar: null` and clears the saved schedule's solar parameters, as the app does. The save endpoint uses decimal strings for minute offsets and durations, and separate enable codes for the two row types. The pinned bundle's `nL3` near line 85463, `A.t0`/`A.ul`/`A.anB` near lines 410125–410187, and save UI near lines 535015–535158 and 535575–535620 show the request shape, mode separation, limits and ready-by fields.

Approve once binds the exact saved review. Always approve is revocable and binds the schedule operation, station, load key and load path. Each new command still checks identity, timezone and configuration drift. The adapter requires a positive provider acknowledgement before treating the POST as accepted. Verification reads back both lists and the solar settings and checks the previous mode, switch and off-grid settings. An ambiguous response is reconciled by readback without resending the POST. Production dispatch requires live acceptance on a configured smart load.

## Read boundaries

Charger calls enumerate the requested station's AC/DC serials before requesting device data. Null inventory means unknown, and an empty list means known absence. An absent kind returns `UnsupportedCapability`; a foreign serial returns `PermissionDenied`. AC-only/DC-only calls refuse the other kind before provider I/O. Null AC current is unknown; the app's -1 sentinel is unset; nonnegative values are amperes.

Smart-load settings/history verify list/detail station, path and key membership. Consumption obtains a safe numeric/string provider ID from detail. Requested day/week/month/year ranges use existing station-local calendar rules. Station identity is checked again on history responses.

Raw consumption and DC/schedule power explicitly report `provider_unit_unverified`. Provider time strings, unknown mode codes, signed values, zeros and nulls are preserved. An unavailable response is not manufactured into an empty history. Other-load map keys are validated rather than silently removed. Charger schedule summaries retain provider ordering and day codes, including overnight windows; they are not a write schema.

Fixture and transport tests establish protocol handling. They do not establish populated-device acceptance or physical dispatch. The [coverage matrix](coverage.md) records remaining exclusions; [read acceptance](read-acceptance.md) records actual hosted observations separately.
