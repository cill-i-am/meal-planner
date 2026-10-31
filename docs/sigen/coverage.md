# Sigen private API coverage

Current implementation: **47 HTTP/MCP operations**, comprising 41 provider/connection reads and six command/approval operations. Commands accept **21 typed setting-change families**. This is the current coverage record; dated acceptance history lives in [read acceptance](read-acceptance.md). Three real token renewals passed; see [authentication acceptance](auth-acceptance.md). The broader private API is not fully covered.

The independent EU private client uses the owner account and enrolled station. Station enumeration does not authorize reads or controls for other stations. Unknown codes remain read data; they never become write permissions. Provider messages and credentials are excluded from errors. No Northbound API is used.

## Implemented read surface

All rows have schema and fixture tests and share HTTP/MCP contracts. Hosted and actual Executor proof are recorded separately in [read acceptance](read-acceptance.md); an empty hardware list proves absence on this account, not populated-device acceptance.

| Operations | Provider route(s) | Contract and limits |
| --- | --- | --- |
| `connection_status` | Stored account state | Connection, expiry, renewals and dispatch state; no provider request. |
| `list_stations` | GET `/device/owner/station/list` | Bounded complete owner list, unique identities, enrolled membership; capacities W/Wh. Does not change enrolled station. |
| `get_station` | GET `/device/owner/station/home` | Requested/default identity must match. Metadata and explicit equipment flags. |
| `get_station_capabilities` | GET `/device/sigen/station/baseInfoByUser`, `/device/station/backup/{id}`, `/device/station/backup/power-shed/{id}` | Strict capability booleans; `providerHasEv` is not interpreted as a specific charger type. |
| `get_energy_flow` | GET `/device/sigen/station/energyflow` | W, SOC, nullable provider timestamp and unknown freshness. Battery sign observed; grid direction unverified. |
| `get_operating_mode`, `list_operating_modes` | GET `/device/energy-profile/mode/{current,all}/{id}` | Current and available provider modes plus custom profile IDs. |
| `list_profile_templates` | GET `/device/energy-profile/mode/all/template/{id}` | Template descriptions and provider mode/profile identity. No activation. |
| `get_energy_profile` | GET `/device/energy-profile/setting/{id}` or `/setting/info/{id}?profileId=…&mode=…` | Current or enumerated custom/template profile: automation groups, SOC, limits, priorities, peak shaving and preheating. Positive profile IDs must match; template sentinels cannot return unrelated positive IDs. Timezone comes from identity-checked station metadata. |
| `get_automation_settings` | GET `/device/energy-profile/setting/{id}` | Current battery/grid groups, including inactive/duplicate windows and unknown day/mode/source codes. |
| `get_energy_capabilities` | GET `/device/energy-profile/support/{id}`, `/support/upgradeEms/{id}` | Feature flags, source options, separate EMS support boolean. No upgrade action. |
| `get_battery_discharge_priority` | GET `/device/energy-profile/battery/discharge/priority/{id}` | Ordered provider source codes, preserving unfamiliar values/repeats. |
| `get_solar_priority` | GET `/device/energy-profile/setting/{id}` | Current profile priority tree flattened with bounded group paths; unknown codes preserved. Legacy dedicated GET returned `{}`. |
| `get_battery_settings` | GET battery level/limit/export limitation and backup reserve | SOC, W limits, installer/owner permissions, explicit unset/unlimited states. |
| `get_grid_settings` | GET grid import/export limitation and parallel/off/grid | W limits and connection current A; preserves installer ceiling. |
| `get_solar_settings` | GET `/device/energy-profile/solar/limit/{id}` | W, unlimited or unset. |
| `get_peak_shaving_schedule` | GET `/device/dischargesetting/peak/shaving/{id}` | Station-local windows, provider day codes, W and timezone. |
| `get_manual_override` | GET `/device/energy-profile/instant/manunal/{id}`, `/display/{id}` | Active state, provider mode and end time; inactive historical values do not imply activity. |
| `get_preheating_settings` | GET `/device/dischargesetting/packPreheating/new/{id}` | Bounded typed slots and nullable capability fields. Raw provider values are preserved. Residential start/duration use minutes and weekdays 1–7; unused power readback may be null or blank. Industrial variants remain uninterpreted. |
| `get_topology`, `get_station_status` | GET station topology and status | Bounded equipment hierarchy and communication codes. |
| `get_gateway`, `list_grid_devices`, `get_device_info`, `get_device_values` | GET gateway/grid/static/dynamic equipment routes | Topology membership is rechecked; AIO subtree cannot include siblings. Display labels are not stable metric IDs. |
| `list_aio_devices`, `get_aio_power_status` | GET `/device/aio/by/station`, `/device/sigenMate/getPowerOnOffStatus`, `/device/aio/on-off-state` | Serial membership and two separate boolean power observations, including disagreement. |
| `list_smart_loads`, `get_smart_load` | GET `/device/tp-device/smart-loads/list`, `/device/tp-device/smart-loads` | Station/path/key validation; identity, manual switch, run mode and controllability. Detail is a state summary, not schedule/history coverage. Missing configured load is `UnsupportedCapability`. |
| `get_load_capabilities` | GET `/device/system/device/condition/{id}` | Distinguishes supported load/generator ports from installed generator. |
| `get_system_cards` | GET `/device/system/device/home/card?stationId=…&showThirdPartyInv=false` | Bounded app display values and codes; no inferred metric units. |
| `list_third_party_devices` | GET `/device/tp-device/manage/card/static-info`, `/device/tp-device/manage/card/dynamic-info` | Identity-matched static/dynamic cards; duplicates/orphans rejected. Explicit placeholder and telemetry availability; generator placeholder does not imply installed equipment. |
| `list_alarms` | GET `/device/alarm/page`, `/alarm/history/page` | Active/history pagination; inclusive UTC-second provider filters, public milliseconds, maximum 31 days. Unsafe numeric IDs omitted. |
| `get_energy_history` | App v1 history charts | Day/week/month/year calendar ranges in station timezone; W/Wh conversion only for verified series. Missing values and DST ambiguity preserved. |
| `get_forecast` | App forecast chart | Day/week/month, explicit `no_data`; populated unknown units fail closed. |
| `get_prediction_plan` | GET `/prediction/predictData/get/predictData/{id}` | Distinct actual/plan/price series; W, percent and currency/kWh. |
| `get_tariffs` | GET `/electricity-price/api/tax-and-fee/{id}`, `/prediction/aipv/elecPrice/get/priceCost` | Tax/fee and coefficients; richer populated fee semantics and units remain unverified. |
| `get_station_income` | GET `/data-process/sigen/station/statistics/income` | Observed daily query only; signed/missing provider and calculated income, currency, local-time ambiguity. Not a bill settlement. |
| `get_backup_history` | GET `/data-process/station/backup-history` | Paginated off-grid durations, full-history counts, **page** duration seconds, local timestamps and UTC candidates. Not an outage-cause inference. |
| `list_backup_events` | GET `/data-process/station/backup-event` | Fixed page size 10, inclusive local date span ≤31 days, original display diagnostics. App 4.1.0 version headers preserve all four observed measurements. Populated multi-phase/extra-device details explicitly unsupported. |

## Approval and control surface

`prepare_command`, `approve_command`, `execute_command`, `get_command`, `list_approval_grants` and `revoke_approval_grant` share the durable command service. The owner/agent credential may approve **once** or **always**. Always grants permit future validated parameters for the same operation and station; smart-load grants also bind both load key and path; profile update/delete grants bind the profile ID. Revocation invalidates queued commands using the grant. Reenrollment invalidates old grants, while retaining attempt receipts.

Every command has an immutable five-minute review, a fresh current-state comparison, and a durable marker before one mutation. Changed inputs conflict. Ambiguous outcomes are reconciled by reads and never replayed. Production dispatch is enabled only for profile create/update/delete, preheating and energy saving after the [bounded live acceptance](live-control-acceptance.md). Peak-shaving populated readback did not pass and its dispatch remains disabled; all other operations are also disabled. The earlier authorized backup-reserve test and the new acceptance record describe the narrower live evidence; synthetic tests are separate.

| Change family | Provider write | Validation / verification limit |
| --- | --- | --- |
| `set_backup_reserve` | PUT `/device/setting/backup/reserve` | Battery reserve percent; live 20→21→20, once/always/revocation verified. |
| `set_battery_power_limits` | PUT `/device/energy-profile/battery/limit` | W converted to provider kW, limited/unlimited. |
| `set_battery_export` | PUT `/device/energy-profile/battery/export/limitation` | Respects installer permission. |
| `set_solar_power_limit` | PUT `/device/energy-profile/solar/limit` | Solar capability, finite W or unlimited. |
| `set_grid_export_limit`, `set_grid_import_limit` | PUT `/device/energy-profile/grid/limitation/{export,import}` | Finite owner limits within known installer ceiling. |
| `set_grid_connection_current` | PUT `/device/energy-profile/parallel/off/grid` | Amperes within known installer ceiling. |
| `set_operating_mode` | PUT `/device/energy-profile/mode` | Available modes 0/1/5; mode 9 only for an enumerated custom profile with its complete adapted configuration in review and conflict fingerprint. Modes 2/7 are excluded pending reviewed TOU/Remote EMS settings. |
| `set_battery_soc_thresholds` | PUT `/device/energy-profile/battery/level` | All four current thresholds known, validated integers under charge ceiling. Separate `ja12SOC` untouched. |
| `set_peak_shaving_schedule` | POST `/device/dischargesetting/peak/shaving` | Disabled means zero reserve and no slots. Enabled reserve is checked against live charge/discharge/backup SOC limits. Up to twelve new windows, unique weekdays 1–7, ordered local times and no overlaps. Station timezone must match. Previously reviewed opaque/overnight windows may only be retained unchanged. See [peak-shaving correction](peak-shaving.md). |
| `stop_manual_override` | PUT `/device/energy-profile/instant/manunal` | Disabled readback from authoritative state, independent of display telemetry. |
| `start_manual_override` | PUT `/device/energy-profile/instant/manunal` | Charge/discharge/hold/self-consumption; duration 30–120 minutes. Read API omits requested duration/power, so provider acceptance remains `outcome_unknown`, never falsely verified or resent. |
| `set_battery_discharge_priority` | PUT `/device/energy-profile/battery/discharge/priority` | Feature flag and supported source options; exact permutation of current known `pv`/`grid` sources. |
| `set_solar_priority` | PUT `/device/energy-profile/solar/priority` | Flat known source identities only, exact complete membership and priority multiset; grouped/smart-load/unknown codes refused. Excluded status-2 rows retain priority. |
| `set_smart_load_switch` | PATCH `/device/tp-device/smart-loads/control-mode/manual/switch` | Query parameters, null body. Current station/path/key membership, controllable flag, manual run mode 1 and known switch value required. |
| `create_energy_profile` | POST `/device/energy-profile/setting/new` | Creates from an enumerated template, retains template ID in the app request, forces inactive status, never activates. Unique name and complete known configuration required. Readback must find one new ID with the expected complete profile and unchanged current mode. |
| `update_energy_profile` | PUT `/device/energy-profile/setting` | Name, description and optional complete automation replacement for an enumerated custom profile. Full reviewed settings are preserved, unknown ancillary codes refused, concurrent edits conflict. |
| `delete_energy_profile` | DELETE `/device/energy-profile/setting/{station}/{profile}` | Exact profile-scoped approval; current mode and active marker must both prove inactivity. Successful absence readback, unchanged current mode and no retries after uncertainty. |
| `replace_automation_schedule` | PUT `/device/energy-profile/setting` | Full battery/grid replacement on current profile; feature flags, source options, mode-specific neutral values, weekdays, overlaps and station timezone checked. Other profile settings preserved. |
| `set_preheating_schedule` | PUT `/device/dischargesetting/packPreheat/set/new/{station}` | Residential only; up to four nonoverlapping windows, ISO weekdays, local minute start/duration; industrial mode/power fields remain null. |
| `set_energy_saving_settings` | PUT `/device/owner/station/save-energy-mode` | App performance/deep-saving codes or explicit preservation of reviewed modes, supported off-grid mode changes, threshold 0–65534 W or explicit system-default sentinel 65535; preserves threshold outside deep-saving mode. |

See [profile and schedule contracts](profile-schedules.md) for semantics, limits and protocol evidence.

## Request budget and renewal

The account Durable Object persists one 30-request rolling-minute budget across authentication, reads and controls, with 400 ms minimum spacing. Reservations are saved before waiting and survive interruption/restart. Provider 429 backoff honors valid `Retry-After` seconds/date with a minimum one-minute cooldown. Budget/storage rejection before transport preserves valid renewal credentials and schedules another attempt; ambiguous dispatched renewal still requires reconnection. The separate edge admission limit remains 30 calls/minute. Caching is not implemented; each provider-backed read is fresh.

## Explicit remaining exclusions and evidence needed

These are unfinished or unsupported families, not hidden aliases or successful empty implementations.

| Family | Discovery | Required before exposure |
| --- | --- | --- |
| Profile parameter editing beyond name/description/automation; TOU/Remote EMS activation | Full profile serializers observed | Other profile parameters are preserved, not editable through profile CRUD. Individual current-setting commands remain available. Activation modes 2/7 need complete reviewed TOU/Remote EMS settings. |
| Industrial/grouped/unknown-code profile and preheating writes | App residential and industrial DTOs differ | Residential known-code profiles only; industrial preheating mode/power capabilities and grouped priority editing remain unverified. |
| Smart-load schedules, mode changes and consumption history | App control-mode, schedule and load-consumption paths observed | A configured smart load plus populated schedule/history responses; review full mode-dependent settings. Manual switching adapter remains synthetic-only. |
| Station consumption breakdown | `/data-process/sigen/station/statistics/station-consumption` | Earlier null samples, current read HTTP 500, and no validated populated response. Do not claim normalized coverage. |
| AC charging | PyPI `sigen` 3.0.3 current/mode and more-setting protocol leads | No AC charger on account. Verify serial membership, populated schema, current/phase ceilings and settings before controls. |
| DC charging / V2X | Pinned reference and app route leads | No DC equipment; schema, membership, direction, limits and consent not verified. |
| Microinverters and inactive storage licensing | App `/device/microenergy/baseinfo`, `/device/stor-license/inactive/stor` returned empty arrays | Populated identity/unit schemas before typed adapters. No licensing mutation. |
| AIO power toggle/restart and administration | POST `/device/aio/on-off` reference | Conflicting boolean read observations and ambiguous toggle/restart semantics; idempotency and reliable reconciliation required. Installer/account administration is outside current owner controls. |
| Tariff/fee writes and richer fee rows | Pinned tax/fee POST and current default/empty reads | Populated units, currency/tax meaning and provider replacement behavior. |
| Legacy async flow, raw prediction aliases | Reference endpoints | Current synchronous flow and typed prediction/forecast APIs cover the verified use cases. No redundant untyped proxy. |
| Multiple enrolled stations/accounts, cache, command-book archival | Service architecture | Explicit authorization mapping, cache freshness/invalidation and replay-safe archival design. Current command book caps at 256 records. |
| Provider revocation/reconnection acceptance | Recovery implementation and synthetic tests | Separate intentional revocation procedure; never disturb the healthy natural-renewal chain merely to label the project complete. |

## Provenance

- Private EU mySigen app **4.1.0**, release `cdn-eu-b147-2a9ceaaa1ca0`; read-only navigation, observed requests and public client serializers. No private account payloads committed.
- [solidfox/sigenergy-cloud](https://github.com/solidfox/sigenergy-cloud/tree/99c744aa4b07f53836e7b2d76c1165701e4d52c1), pinned MIT reference, independently implemented TypeScript; see [notice](../../packages/sigen/THIRD_PARTY_NOTICES.md).
- `@paulczar/sigen-api-mcp` 0.1.2 (MIT declared) and [PyPI sigen 3.0.3](https://pypi.org/project/sigen/3.0.3/) (MIT file inspected) supplied additional protocol leads, not copied implementation or live acceptance.
- GerardBrowne/sig-data `618618a7e9a5f9b8f4dfde77f298a48446b34069` is discovery-only, with reuse permission unestablished. Its Northbound history does not enter this client.
