# Private mySigen coverage

This is an incomplete discovery baseline, not a comprehensive-coverage claim.
Implementation expansion is held at the hosted-authentication milestone required
by the supplied plan. No live control was tested or enabled.

## Verified during browser exploration on 26 October 2026

The signed-in EU owner app was version 4.1.0 (release `cdn-eu-b147-2a9ceaaa1ca0`).
Observed station timezone was `Europe/London`; it must be preserved, not replaced
with the caller's timezone. The station reports no AC or DC charger. That is an
account capability observation, not proof that charger APIs are implemented.

| Operation | Method/path | Schema | Permission/hardware | Side effects | Evidence | Implementation / verification |
| --- | --- | --- | --- | --- | --- | --- |
| `connection_status` | local | `ConnectionStatus` | dedicated owner | none | implementation | implemented; fixture and SDK parity tested |
| `get_station` | GET `/device/owner/station/home?stationId=…` | `StationResponse` → `Station` | enrolled owner station | none | app requests with and without stationId | implemented; browser observed; fixture and SDK tested; hosted verification pending |
| `get_energy_flow` | GET `/device/sigen/station/energyflow?id=…` | `FlowResponse` → `EnergyFlow` | enrolled owner station | none | authenticated browser read, compared to UI | implemented; browser read verified; fixture and SDK tested; hosted verification pending |
| `get_operating_mode` | GET `/device/energy-profile/mode/current/{stationId}` | `ModeResponse` → `OperatingMode` | enrolled owner station | none | app request | implemented; browser observed; fixture and SDK tested; hosted verification pending |
| async energy flow | GET `/device/sigen/station/energyflow/async` | unknown | owner station | request may request refresh | authenticated browser probe | excluded from initial adapter: HTTP 200 with application code 1000 |
| live energy flow | WebSocket `/websocket/ws/ef` | abbreviated fields | owner station | subscription | app frames | discovered; polling HTTP alternative works |
| notifications | WebSocket `/websocket/ws/info` | JSON-RPC subscriptions | owner account/station | subscription | app frames | discovered; held for auth acceptance |
| device topology | GET `/device/devicetreepanel/topology?stationId=…` | node tree, station status | owner station | none | app request/response | discovered; held for auth acceptance |
| device values | GET `/device/devicetreepanel/liveValue` | serial/type/value/timestamp | station + AIO serial, refreshFlag | read/refresh | app request/response | discovered; held for auth acceptance |
| device static/dynamic info | GET `/device/sigen/device/{static,dynamic}/info` | parameter groups | station + deviceType + serial | none | app request/response | discovered; held for auth acceptance |
| gateway | GET `/device/gateway/{stationId}` | voltage/current/frequency display groups | gateway | none | app request/response | discovered; held for auth acceptance |
| current station status | GET `/device/sigen/station/statusInfo?id=…` | station/device status lists | owner station | none | app request/response | discovered; held for auth acceptance |
| alarms | GET `/device/alarm/page?current=1&size=10&stationId=…` | records,total,current,size,pages | owner station | none | app request/response | discovered; active vs historical filters unresolved |
| prediction chart | GET `/data-process/sigen/station/ai/all/prediction/v1` | chartData series/points | station, dateFlag,startDate,endDate | none | app request/response | discovered; date semantics unresolved |
| grid devices | GET `/device/station/grid-connection-point/support-devices` | device list | owner station | none | app request | discovered; held for auth acceptance |
| system cards | GET `/device/system/device/home/card` | empty array observed | station, showThirdPartyInv | none | app request/response | discovered; held for auth acceptance |
| third-party devices | GET `/device/tp-device/manage/card/{static,dynamic}-info` | pending | owner station | none | app requests | discovered; held for auth acceptance |
| other devices | GET `/device/sigen/device/device/sigenOther` | pending | owner station | none | app request | discovered; held for auth acceptance |
| system device condition | GET `/device/system/device/condition/{stationId}` | pending | owner station | none | app request | discovered; held for auth acceptance |
| micro inverter summary | GET `/device/device-micro-pcs/energy/baseinfo` | pending | micro inverter | none | app request | discovered; held for auth acceptance |
| inactive storage license | GET `/device/stor-license/inactive/stor` | pending | storage | none | app request | discovered; held for auth acceptance |
| energy history / consumption | GET `/data-process/sigen/station/statistics/{energy,station-consumption}` | unverified | owner station | read per exploration | supplied reference notes | discovery pending; no Northbound dependency |

The current app uses WebSockets for live flow. The synchronous HTTP response
returned an empty `dateCurrTimeStamp`. This is represented as `null` with unknown
freshness. Battery power was negative while the app displayed Discharging; kW is
converted to W. Grid sign direction remains explicitly unverified. Unknown mode
and status values remain numerical read data, not permitted control values.

## Pinned reference catalogue

Protocol reference: [solidfox/sigenergy-cloud at 99c744a](https://github.com/solidfox/sigenergy-cloud/tree/99c744aa4b07f53836e7b2d76c1165701e4d52c1), MIT.
Rows below are reference discoveries, not live API claims. Schema, permission and
hardware confirmation must precede exposure. Every deferred row has the same
blocking dependency: hosted enrollment, renewal, restart and revocation acceptance.

| Name | Method/path | Schema | Permissions | Hardware | Side effects | Source | Status / exclusion reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `refresh_station` | GET `/device/owner/station/home` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `energy_flow` | GET `/device/sigen/station/energyflow/async` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `energy_flow` | GET `/device/sigen/station/energyflow` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `prediction_data` | GET `/prediction/predictData/get/predictData/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `electricity_tax_and_fee` | GET `/electricity-price/api/tax-and-fee/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_electricity_tax_and_fee` | POST `/electricity-price/api/tax-and-fee` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `electricity_price_cost` | GET `/prediction/aipv/elecPrice/get/priceCost` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `available_operational_modes` | GET `/device/energy-profile/mode/all/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `current_operational_mode` | GET `/device/energy-profile/mode/current/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_operational_mode` | PUT `/device/energy-profile/mode` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `battery_levels` | GET `/device/energy-profile/battery/level/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_battery_levels` | PUT `/device/energy-profile/battery/level` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `grid_export_limit` | GET `/device/energy-profile/grid/limitation/export/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `grid_import_limit` | GET `/device/energy-profile/grid/limitation/import/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `grid_connection_limit` | GET `/device/energy-profile/parallel/off/grid/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_grid_connection_limit` | PUT `/device/energy-profile/parallel/off/grid` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `battery_power_limit` | GET `/device/energy-profile/battery/limit/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_battery_power_limit` | PUT `/device/energy-profile/battery/limit` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `solar_power_limit` | GET `/device/energy-profile/solar/limit/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_solar_power_limit` | PUT `/device/energy-profile/solar/limit` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `backup_reserve` | GET `/device/setting/backup/reserve/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_backup_reserve` | PUT `/device/setting/backup/reserve` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `gateway_info` | GET `/device/gateway/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `grid_connection_point_devices` | GET `/device/station/grid-connection-point/support-devices` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `battery_export_limitation` | GET `/device/energy-profile/battery/export/limitation/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_battery_export_limitation` | PUT `/device/energy-profile/battery/export/limitation` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `peak_shaving_schedule` | GET `/device/dischargesetting/peak/shaving/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_peak_shaving_schedule` | POST `/device/dischargesetting/peak/shaving` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `instant_manual_control` | GET `/device/energy-profile/instant/manunal/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `instant_manual_display` | GET `/device/energy-profile/instant/manunal/display/{stationId}` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `set_instant_manual_control` | PUT `/device/energy-profile/instant/manunal` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `disable_instant_manual_control` | PUT `/device/energy-profile/instant/manunal` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `dc_charge_mode_soc_range` | GET `/device/charge/mode/soc/range` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_charge_mode` | GET `/device/charge/mode/dc` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `set_dc_charge_mode` | POST `/device/charge/mode/dc` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `dc_charge_setting` | GET `/device/dcevse/charge/setting` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `set_dc_charge_setting` | POST `/device/dcevse/charge/setting` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `set_dc_charge_enabled` | PUT `/device/dcevse/charge/start` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `station_is_charging` | POST `/device/charge/check/charge` | pending | owner permission unverified | station / indicated device | read (charging status) | pinned reference | discovered; held for auth acceptance |
| `dc_status` | GET `/device/dcevse/status` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_plug_status` | GET `/device/dcevse/plug/status` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_charge_realtime` | GET `/device/dcevse/charge/realtime` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_discharge_realtime` | GET `/device/dcevse/discharge/realtime` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_energy_totals` | GET `/data-process/dcevse/energy` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_lifetime_totals` | GET `/data-process/dcevse/total/{stationId}/{serialNumber}` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_ocpp_status` | GET `/device/dcevse/ocpp/status` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `dc_session_records` | GET `/data-process/dcevse/record/page` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `v2x_discharge_info` | GET `/device/station-v2x/discharge/info` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `v2x_discharge_settings` | GET `/device/station-v2x/select` | pending | owner permission unverified | DC charger | read | pinned reference | discovered; held for auth acceptance |
| `set_v2x_discharge_enabled` | POST `/device/station-v2x/open-close` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `start_v2x_discharge` | POST `/device/station-v2x/start/discharge` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `stop_v2x_discharge` | POST `/device/station-v2x/stop/discharge` | pending | owner permission unverified | DC charger | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `active_alarms` | GET `/device/alarm/page` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `aio_serials` | GET `/device/aio/by/station` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `device_topology` | GET `/device/devicetreepanel/topology` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `get_aio_power_on` | GET `/device/sigenMate/getPowerOnOffStatus` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `get_aio_on_off_state` | GET `/device/aio/on-off-state` | pending | owner permission unverified | station / indicated device | read | pinned reference | discovered; held for auth acceptance |
| `toggle_aio_power` | POST `/device/aio/on-off` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `set_aio_power` | POST `/device/aio/on-off` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |
| `restart_aio` | POST `/device/aio/on-off` | pending | owner permission unverified | station / indicated device | changes settings/device | pinned reference | discovered; held for auth acceptance |

## Remaining discovery

Station enumeration must be distinguished from the selected/default station.
Inspect station selection, historical alarms, energy-history periods/pagination,
custom profiles, schedule replacement/cross-midnight semantics, tariffs/fees,
smart loads, AC charging, DC/V2X and device administration after authentication
acceptance. Do not infer owner access from installer endpoint names. Hardware
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
