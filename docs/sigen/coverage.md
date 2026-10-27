# Private mySigen coverage

This is an incomplete discovery baseline, not a comprehensive-coverage claim.
Hosted enrollment and initial reads have passed. The remaining acceptance
gates, including three natural renewals, are tracked in the [authentication record](auth-acceptance.md). No live control was tested or enabled.

## Verified during browser exploration on 26 October 2026

The signed-in EU owner app was version 4.1.0 (release `cdn-eu-b147-2a9ceaaa1ca0`).
Observed station timezone was `Europe/London`; it must be preserved, not replaced
with the caller's timezone. The station reports no AC or DC charger. That is an
account capability observation, not proof that charger APIs are implemented.

| Operation | Method/path | Schema | Permission/hardware | Side effects | Evidence | Implementation / verification |
| --- | --- | --- | --- | --- | --- | --- |
| `connection_status` | local | `ConnectionStatus` | dedicated owner | none | implementation | implemented; fixture and hosted SDK tested |
| `get_station` | GET `/device/owner/station/home?stationId=…` | `StationResponse` → `Station` | enrolled owner station | none | app requests with and without stationId | implemented; browser observed; fixture, local client and hosted HTTP/MCP reads verified |
| `get_energy_flow` | GET `/device/sigen/station/energyflow?id=…` | `FlowResponse` → `EnergyFlow` | enrolled owner station | none | authenticated browser read, compared to UI | implemented; browser read verified; fixture, local client and hosted MCP read verified |
| `get_operating_mode` | GET `/device/energy-profile/mode/current/{stationId}` | `ModeResponse` → `OperatingMode` | enrolled owner station | none | app request | implemented; browser observed; fixture, local client and hosted HTTP/MCP reads verified |
| async energy flow | GET `/device/sigen/station/energyflow/async` | unknown | owner station | request may request refresh | authenticated browser probe | excluded from initial adapter: HTTP 200 with application code 1000 |
| live energy flow | WebSocket `/websocket/ws/ef` | abbreviated fields | owner station | subscription | app frames | discovered; polling HTTP alternative works |
| notifications | WebSocket `/websocket/ws/info` | JSON-RPC subscriptions | owner account/station | subscription | app frames | discovered; schema/permission verification pending |
| `get_topology` | GET `/device/devicetreepanel/topology?stationId=…` | node tree, station status | owner station | none | app request/response | implemented; fixture and hosted MCP verified |
| `get_device_values` | GET `/device/devicetreepanel/liveValue` | serial/type/value/timestamp | station + AIO serial, refreshFlag | read/refresh | app request/response | implemented; fixture and hosted MCP verified |
| `get_device_info` | GET `/device/sigen/device/{static,dynamic}/info` | parameter groups | station + deviceType + serial | none | app request/response | implemented; fixture and hosted MCP verified |
| `get_gateway` | GET `/device/gateway/{stationId}` | voltage/current/frequency display groups | gateway in station topology | none | app request/response | implemented; fixture and hosted MCP verified |
| `get_station_status` | GET `/device/sigen/station/statusInfo?id=…` | station/device status lists | owner station | none | app request/response | implemented; fixture and hosted MCP verified |
| `list_alarms (active)` | GET `/device/alarm/page?current=1&size=10&stationId=…` | records,total,current,size,pages | owner station | none | app request/response | implemented; active and historical endpoints are distinct; fixture and hosted reads verified |
| `get_forecast` | GET `/data-process/sigen/station/ai/all/prediction/v1` | chartData series/points | station, dateFlag,startDate,endDate | none | app request/response | implemented; day/week/month dates verified; empty historical and populated current-day forecasts hosted verified |
| `list_grid_devices` | GET `/device/station/grid-connection-point/support-devices` | device list | owner station | none | app request | implemented; fixture and hosted MCP verified |
| system cards | GET `/device/system/device/home/card` | empty array observed | station, showThirdPartyInv | none | app request/response | discovered; schema/permission verification pending |
| third-party devices | GET `/device/tp-device/manage/card/{static,dynamic}-info` | pending | owner station | none | app requests | discovered; schema/permission verification pending |
| other devices | GET `/device/sigen/device/device/sigenOther` | pending | owner station | none | app request | discovered; schema/permission verification pending |
| system device condition | GET `/device/system/device/condition/{stationId}` | pending | owner station | none | app request | discovered; schema/permission verification pending |
| micro inverter summary | GET `/device/device-micro-pcs/energy/baseinfo` | pending | micro inverter | none | app request | discovered; schema/permission verification pending |
| inactive storage license | GET `/device/stor-license/inactive/stor` | pending | storage | none | app request | discovered; schema/permission verification pending |
| energy history / consumption | GET `/data-process/sigen/station/statistics/{energy,station-consumption}` | unverified | owner station | read per exploration | supplied reference notes | legacy paths excluded in favor of the app-observed v1 energy endpoint; no Northbound dependency |
| `list_alarms` (history) | GET `/alarm/history/page` | `Alarms` | owner station; page 1–1000, size 1–100, range ≤31 days | none | History tab; inclusive UTC epoch seconds | implemented; fixture and hosted MCP verified |
| `get_energy_history` | GET `/data-process/sigen/station/statistics/v1/energy` | `EnergyHistory` | owner station; one calendar period | none | Day/Week/Month/Year app screens | implemented; fixture and hosted day/month verified |
| `get_battery_settings` | GET `/device/energy-profile/battery/{level,limit,export/limitation}/{stationId}` and `/device/setting/backup/reserve/{stationId}` | `BatterySettings` | owner station | none | authenticated owner reads | implemented; fixture and hosted HTTP/MCP verified |
| `get_grid_settings` | GET `/device/energy-profile/grid/limitation/{export,import}/{stationId}` and `/device/energy-profile/parallel/off/grid/{stationId}` | `GridSettings` | owner station | none | authenticated owner reads | implemented; fixture and hosted MCP verified |
| `get_solar_settings` | GET `/device/energy-profile/solar/limit/{stationId}` | `SolarSettings` | owner station | none | authenticated owner read | implemented; fixture and hosted MCP verified |
| `list_operating_modes` | GET `/device/energy-profile/mode/all/{stationId}` | `OperatingModes` | owner station | none | authenticated owner read | implemented; custom list empty live, populated synthetic fixture; hosted MCP verified |
| `get_peak_shaving_schedule` | GET `/device/dischargesetting/peak/shaving/{stationId}` | `PeakShavingSchedule` | owner station | none | authenticated owner read | implemented; slots empty live, populated cross-midnight fixture; hosted MCP verified |
| `get_manual_override` | GET `/device/energy-profile/instant/manunal/{stationId}` and `/display/{stationId}` | `ManualOverride` | owner station | none | authenticated owner reads | implemented; inactive live, old end time retained; hosted MCP verified |

The current app uses WebSockets for live flow. The synchronous HTTP response
returned an empty `dateCurrTimeStamp`. This is represented as `null` with unknown
freshness. Battery power was negative while the app displayed Discharging; kW is
converted to W. Grid sign direction remains explicitly unverified. Unknown mode
and status values remain numerical read data, not permitted control values.

## Read semantics verified in this expansion

See [read acceptance](read-acceptance.md) for the exact hosted proof. Dynamic equipment reads require `sg-pkg: sigen_app`; without it the provider returns application code 1000. `lang: en_US` stabilizes display labels without turning them into metric IDs. Topology membership is rechecked for device reads, including the requested AIO subtree. The tree is bounded before expansion.

The app's v1 history endpoint replaces the older reference paths. `dateFlag` 1/2/3/4 means day/week/month/year; calendar dates are inclusive and weeks start Monday. Day series use kW, longer periods kWh; the adapter returns W/Wh. Cards and Sankey links represent kWh. Only verified series IDs receive unit conversion. DST duplicates and missing samples remain explicit. Active alarms use `/device/alarm/page`; history uses `/alarm/history/page` with inclusive epoch seconds, converted to UTC milliseconds publicly. Unsafe numeric provider alarm IDs are omitted. No alarm cause or remediation text is treated as instructions.

The tariff/fee and legacy prediction endpoints were read successfully. Tax settings were zero/default and fee/schedule arrays empty; richer populated schemas remain unverified and unadapted. The legacy prediction response mixes actuals and plans and includes price series; the exposed forecast uses the app's current chart endpoint instead.

## Pinned reference catalogue

Protocol reference: [solidfox/sigenergy-cloud at 99c744a](https://github.com/solidfox/sigenergy-cloud/tree/99c744aa4b07f53836e7b2d76c1165701e4d52c1), MIT.
Rows below are reference discoveries, not live API claims. Schema, permission and
hardware confirmation must precede exposure. The user approved expanding read
coverage while natural renewal checks run. Control implementation and live control
acceptance remain separate from these read-only discoveries.

| Name | Method/path | Schema | Permissions | Hardware | Side effects | Source | Status / exclusion reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `refresh_station` | GET `/device/owner/station/home` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_station`; fixture and hosted read verified |
| `energy_flow` | GET `/device/sigen/station/energyflow/async` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `energy_flow` | GET `/device/sigen/station/energyflow` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_energy_flow`; fixture and hosted read verified |
| `prediction_data` | GET `/prediction/predictData/get/predictData/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `electricity_tax_and_fee` | GET `/electricity-price/api/tax-and-fee/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `set_electricity_tax_and_fee` | POST `/electricity-price/api/tax-and-fee` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `electricity_price_cost` | GET `/prediction/aipv/elecPrice/get/priceCost` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `available_operational_modes` | GET `/device/energy-profile/mode/all/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `list_operating_modes`; fixture and hosted read verified |
| `current_operational_mode` | GET `/device/energy-profile/mode/current/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_operating_mode`; fixture and hosted read verified |
| `set_operational_mode` | PUT `/device/energy-profile/mode` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `battery_levels` | GET `/device/energy-profile/battery/level/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_battery_settings`; fixture and hosted read verified |
| `set_battery_levels` | PUT `/device/energy-profile/battery/level` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `grid_export_limit` | GET `/device/energy-profile/grid/limitation/export/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_grid_settings`; fixture and hosted read verified |
| `grid_import_limit` | GET `/device/energy-profile/grid/limitation/import/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_grid_settings`; fixture and hosted read verified |
| `grid_connection_limit` | GET `/device/energy-profile/parallel/off/grid/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_grid_settings`; fixture and hosted read verified |
| `set_grid_connection_limit` | PUT `/device/energy-profile/parallel/off/grid` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `battery_power_limit` | GET `/device/energy-profile/battery/limit/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_battery_settings`; fixture and hosted read verified |
| `set_battery_power_limit` | PUT `/device/energy-profile/battery/limit` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `solar_power_limit` | GET `/device/energy-profile/solar/limit/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_solar_settings`; fixture and hosted read verified |
| `set_solar_power_limit` | PUT `/device/energy-profile/solar/limit` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `backup_reserve` | GET `/device/setting/backup/reserve/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_battery_settings`; fixture and hosted read verified |
| `set_backup_reserve` | PUT `/device/setting/backup/reserve` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `gateway_info` | GET `/device/gateway/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_gateway`; fixture and hosted read verified |
| `grid_connection_point_devices` | GET `/device/station/grid-connection-point/support-devices` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `list_grid_devices`; fixture and hosted read verified |
| `battery_export_limitation` | GET `/device/energy-profile/battery/export/limitation/{stationId}` | normalized read schema | owner station | station / indicated device | read | pinned reference | implemented through `get_battery_settings`; fixture and hosted read verified |
| `set_battery_export_limitation` | PUT `/device/energy-profile/battery/export/limitation` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `peak_shaving_schedule` | GET `/device/dischargesetting/peak/shaving/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `set_peak_shaving_schedule` | POST `/device/dischargesetting/peak/shaving` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `instant_manual_control` | GET `/device/energy-profile/instant/manunal/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `instant_manual_display` | GET `/device/energy-profile/instant/manunal/display/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `set_instant_manual_control` | PUT `/device/energy-profile/instant/manunal` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `disable_instant_manual_control` | PUT `/device/energy-profile/instant/manunal` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `dc_charge_mode_soc_range` | GET `/device/charge/mode/soc/range` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_charge_mode` | GET `/device/charge/mode/dc` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `set_dc_charge_mode` | POST `/device/charge/mode/dc` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `dc_charge_setting` | GET `/device/dcevse/charge/setting` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `set_dc_charge_setting` | POST `/device/dcevse/charge/setting` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `set_dc_charge_enabled` | PUT `/device/dcevse/charge/start` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `station_is_charging` | POST `/device/charge/check/charge` | pending | owner permission unverified | station / indicated device | read (charging status) | pinned reference | discovered; schema/permission verification pending |
| `dc_status` | GET `/device/dcevse/status` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_plug_status` | GET `/device/dcevse/plug/status` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_charge_realtime` | GET `/device/dcevse/charge/realtime` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_discharge_realtime` | GET `/device/dcevse/discharge/realtime` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_energy_totals` | GET `/data-process/dcevse/energy` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_lifetime_totals` | GET `/data-process/dcevse/total/{stationId}/{serialNumber}` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_ocpp_status` | GET `/device/dcevse/ocpp/status` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `dc_session_records` | GET `/data-process/dcevse/record/page` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `v2x_discharge_info` | GET `/device/station-v2x/discharge/info` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `v2x_discharge_settings` | GET `/device/station-v2x/select` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; schema/permission verification pending |
| `set_v2x_discharge_enabled` | POST `/device/station-v2x/open-close` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `start_v2x_discharge` | POST `/device/station-v2x/start/discharge` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `stop_v2x_discharge` | POST `/device/station-v2x/stop/discharge` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `active_alarms` | GET `/device/alarm/page` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `aio_serials` | GET `/device/aio/by/station` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `device_topology` | GET `/device/devicetreepanel/topology` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `get_aio_power_on` | GET `/device/sigenMate/getPowerOnOffStatus` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `get_aio_on_off_state` | GET `/device/aio/on-off-state` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; schema/permission verification pending |
| `toggle_aio_power` | POST `/device/aio/on-off` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `set_aio_power` | POST `/device/aio/on-off` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |
| `restart_aio` | POST `/device/aio/on-off` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; schema/permission verification pending |

## Remaining discovery

Station enumeration must be distinguished from the selected/default station.
Historical alarm pagination and calendar history periods are now implemented.
Inspect station selection, custom profile details, schedule replacement semantics, tariffs/fees,
smart loads, AC charging, DC/V2X and device administration while natural renewal checks continue. Do not infer owner access from installer endpoint names. Hardware
missing from this account needs explicit unsupported/unknown states and synthetic
fixtures, not a live-verified label.

Other supplied leads remain unadapted: `@paulczar/sigen-api-mcp` 0.1.2, PyPI `sigen`
(license/version inspection required), and GerardBrowne/sig-data at
`618618a7e9a5f9b8f4dfde77f298a48446b34069` (discovery only; reuse permission not
established). Its Northbound history must not enter this private client.

The supplied plan's fresh-human-approval-for-every-command policy was superseded
by the user: support approve once and a revocable always-approve permission for
an operation and station/device. This does not remove parameter validation,
one-use command IDs, state conflict detection or ambiguous-outcome reconciliation.

## Control and tariff implementation update

The shared registry now contains 30 operations: 24 provider/connection reads and six command/approval operations. These additions have fixture and local runtime coverage; hosted verification is recorded separately.

| Operation | Method/path | Schema | Permissions/hardware | Side effects | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `get_tariffs` | GET `/electricity-price/api/tax-and-fee/{id}` and `/prediction/aipv/elecPrice/get/priceCost?stationId=…` | `Tariffs` | enrolled owner station | none | browser observations plus pinned MIT reference | implemented, fixture-tested; fee units remain unverified |
| `get_prediction_plan` | GET `/prediction/predictData/get/predictData/{id}` | `PredictionPlan` | enrolled owner station | none | browser observation plus pinned MIT reference | implemented, fixture-tested; actual, plan and price series distinguished |
| `set_backup_reserve` | PUT `/device/setting/backup/reserve` | `ControlChange` | battery | changes reserve percent | pinned MIT client/app-derived payload | implemented, fixture-tested; not live-control-verified |
| `set_battery_power_limits` | PUT `/device/energy-profile/battery/limit` | `ControlChange` | battery | changes charge/discharge limits | pinned MIT client/app-derived payload | implemented, fixture-tested; not live-control-verified |
| `set_solar_power_limit` | PUT `/device/energy-profile/solar/limit` | `ControlChange` | solar | changes PV limit | pinned MIT client/app-derived payload | implemented, fixture-tested; not live-control-verified |
| `set_battery_export` | PUT `/device/energy-profile/battery/export/limitation` | `ControlChange` | battery, installer permission | changes owner export permission | pinned MIT client | implemented, fixture-tested; not live-control-verified |
| `set_grid_export_limit`, `set_grid_import_limit` | PUT `/device/energy-profile/grid/limitation/{export,import}` | `ControlChange` | known installer ceiling | enables finite owner limit | pinned MIT client | implemented, fixture-tested; not live-control-verified |
| `set_grid_connection_current` | PUT `/device/energy-profile/parallel/off/grid` | `ControlChange` | known installer ceiling | enables current limit in amperes | pinned MIT client | implemented, fixture-tested; not live-control-verified |
| `set_operating_mode` | PUT `/device/energy-profile/mode` | `ControlChange` | currently available mode 0, 1 or 5 | changes operating strategy | pinned MIT client plus live mode list | implemented, fixture-tested; not live-control-verified |

The named setting changes are variants of `prepare_command`, not direct-write tools. HTTP and MCP use the same saved review, once/always approval, revocation, dispatch and readback service. All provider dispatch remains disabled by default. Setting writes do not use the read retry path. Reenrollment invalidates remembered permissions.

Still unfinished: station enumeration, profile details and schedule replacement, remaining tariff/fee semantics, starting manual overrides, smart loads, AC/DC/V2X adapters, device administration, caching and shared upstream budgets. Missing charger hardware remains an observed capability limitation, not an implementation claim. The discovery matrix above remains the broader backlog; this update supersedes its older implementation status for these specific operations.

## 27 October extension

The registry contains 30 operations and eleven typed control variants. The following additions have fixture coverage; hosted evidence is recorded separately in [read acceptance](read-acceptance.md).

| Operation | Provider route | Behavior and limits |
| --- | --- | --- |
| `list_aio_devices` | GET `/device/aio/by/station` | Every serial must belong to the enrolled station topology; duplicates fail. |
| `get_aio_power_status` | GET `/device/sigenMate/getPowerOnOffStatus`, `/device/aio/on-off-state` | Requires an AIO member; keeps both strict boolean observations, including disagreement. |
| `get_station_income` | GET `/data-process/sigen/station/statistics/income` | Browser-observed day query with `fulfill=false`; preserves provider totals, negative/missing income, calculated values, currency and local-time ambiguity. Other periods remain unverified. |
| `set_battery_soc_thresholds` | PUT `/device/energy-profile/battery/level` | Four reviewed integer percentages; refuses unset current thresholds and thresholds above the charge ceiling. The separate `ja12SOC` field is not written. |
| `set_peak_shaving_schedule` | POST `/device/dischargesetting/peak/shaving` | Complete reviewed list with watts converted to kW. Preserves timezone, provider day codes and every time window; permits enabled state, reserve and power edits only. |
| `stop_manual_override` | PUT `/device/energy-profile/instant/manunal` | Sends the pinned disable payload. Readback uses authoritative state and does not depend on optional display telemetry. |

The new controls use the existing once/always grants and revocation. All physical adapters remain unverified on live equipment and dispatch remains disabled. This account has an unset peak-shaving SOC threshold, so the four-threshold command correctly refuses it. Empty schedules do not prove populated schedule semantics.

Additional app-observed leads: station-consumption statistics, AI personalization rules and the EMS-upgrade support flag. Consumption samples were null and personalization rules empty; these observations are discovery evidence only, not normalized read contracts or write authority.
