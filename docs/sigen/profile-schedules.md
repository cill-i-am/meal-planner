# Profile CRUD and schedule/settings writes

These operations use `prepare_command` → `approve_command` (`once` or `always`) → `execute_command`. They add six control families to the existing 47 HTTP/MCP operations. The authorized [live acceptance](live-control-acceptance.md) enabled profile create/update/delete, preheating and energy saving. Peak shaving failed populated readback and remains disabled; current-profile automation also remains disabled. The acceptance record distinguishes metadata CRUD, disabled schedule storage and unchanged settings from physical execution.

## Profile lifecycle

- **Create:** select a source returned by `list_profile_templates`, supply name and description, and review the complete template in `current.settings.source`. Creation makes an inactive profile. Activation remains a separate command. The request retains the template ID, as the app does.
- **Update:** select an existing custom profile and supply `edits.name`, `edits.description`, and/or `edits.automation`. The complete profile participates in the review and conflict fingerprint. Other settings are preserved; arbitrary JSON and endpoint paths are not accepted. Additional per-profile parameter editing remains outside this increment.
- **Delete:** select an existing custom profile. The current-mode response and the profile's active marker must both show that it is inactive. Always approval is bound to this profile ID and the delete operation.

Create approval is scoped to the station and create operation. Update/delete approval also binds the profile ID. An always-update grant does not authorize deleting that profile or editing another one. All grants remain revocable.

Creation verification requires a unique matching name, a new profile ID absent from the reviewed inventory, the complete expected configuration, inactive status and unchanged current operating mode. Updates compare complete configurations independent of JSON property order and sub-microwatt floating point noise. Residential profiles follow the app serializer: the industrial-only preheating selector is written as null; observed template value 1 and null are equivalent only for this inactive selector. Populated residential schedules may return blank unused powers after null was submitted; only null/blank are equivalent. Zero, whitespace and nonempty power values remain unsupported. Unknown selectors remain unsupported. Deletes require a successful inventory read showing absence. Read errors never mean absence. Missing or ambiguous evidence remains `outcome_unknown`; a second execute reconciles by reads instead of resending the mutation.

Full-profile writes support known residential settings and flat known priority entries. Unknown control codes, industrial profiles, grouped priorities and unsupported copied preheating slots are refused before approval. Read APIs continue to preserve unfamiliar codes.

## Schedules

All new windows use the station's returned timezone, local `HH:mm` times, and `providerDays` containing unique comma-separated weekdays: Monday `1` through Sunday `7`. End time `24:00` is allowed. Start must precede end; split an overnight period into separate day windows. No overlapping windows are accepted, including across automation groups. These are recurring wall-clock schedules; the provider applies local daylight-saving behavior, not a fixed UTC offset.

- `replace_automation_schedule` replaces battery and grid groups on the current profile. `update_energy_profile.edits.automation` replaces them on a custom profile. Other profile settings remain intact. Available feature flags and source options are required. Battery modes `0/1/3/6` and grid modes `0/1/2` use the app's neutral defaults for fields inactive in each mode. Unsupported codes fail validation.
- `set_peak_shaving_schedule` now accepts new and moved verified windows. It replaces the full schedule, enabled state, reserve and limits. For compatibility, an older opaque or overnight day/time configuration may be retained exactly while editing its existing power values; it cannot be rearranged under that exception.
- `set_preheating_schedule` replaces up to four residential heating windows. Provider start and duration are minutes. Residential requests send null charging/discharging power and industrial mode/switch fields. Unused powers may read back as null or blank. Industrial schedules remain excluded.

Power is supplied in watts and translated to the provider's kW representation. Unlimited power uses the provider's sentinel; it is never silently converted to zero.

## Energy saving

`set_energy_saving_settings` offers `performance`, `deep_saving`, and `unchanged` for on-grid and off-grid modes. `unchanged` preserves the reviewed provider code, including the observed off-grid `0` and on-grid `1`, without assigning them an invented label. It requires a reviewed snapshot for dispatch and reconciliation. The off-grid capability gate must permit a changed off-grid mode. Load threshold is either `{kind:"watts",watts:0..65534}` or `{kind:"system_default"}`. The latter encodes 65535; it is not a 65535 W threshold. Modes other than deep saving preserve the current threshold, matching the app. Readback must confirm the requested modes and threshold.

## Protocol evidence

The public EU app remained version 4.1.0, release `cdn-eu-b147-2a9ceaaa1ca0`, on 31 October 2026. Independently implemented protocol facts came from:

| App asset | Evidence |
| --- | --- |
| `main.dart_3.0d88172f.js` | `c7D`: profile create POST; `aq_`: profile PUT; `f5z`: profile DELETE; `eH2`: energy-saving PUT. |
| `main.dart_21.aba61e09.js` | `aLy.E`, `m2.E`, `li.E`: full profile and automation serializers; `k0.E`: flat priority DTO; HTTP method implementations. |
| `main.dart_33.cf2a1b17.js` | Create/update workflows, inactive profile creation, distinct activation request, `bkH` mode normalization, Monday=1 through Sunday=7 picker, profile name/description limits. |
| `main.dart_34.e08aa7c9.js`, `main.dart_22.f952e47b.js`, `main.dart_4.4b0376b5.js` | Residential heating limit four, minute start/duration, unique weekday selection, overlap prevention, PUT DTO with null industrial fields. |
| `main.dart_30.14f827aa.js`, `main.dart_48.4eb360ce.js`, `main.dart_55.74ed9052.js` | Energy-saving mode values, capability gating, threshold handling and app request `offGridEnable:false` (a capability field, not an exposed switch). |
| `main.dart.js_321.part.aa2e4e98.js` | English label `Load Threshold(W)` and numeric range 0–65535 establish the threshold unit. |

Live acceptance and its exclusions are recorded in [live control acceptance](live-control-acceptance.md). Synthetic tests cover exact requests, complete readback, conflicts, unknown codes, capability refusal, once/always scoping, revocation, restart and lost-response no-replay behavior. Hosted evidence is recorded in [read acceptance](read-acceptance.md).

## Peak-shaving disabled-state correction

Disabling peak shaving clears its windows and reserve, matching the app. New requests must use `enabled:false`, `slots:[]`, `reserveSocPercent:0`; disabled populated drafts are not supported. Enabled schedules check live battery SOC bounds and permit up to twelve new windows. The earlier disabled populated test remains unverified; a brief future-window enabled test requires separate approval. See [the source evidence and bounded test](peak-shaving.md).
