# Peak-shaving correction and acceptance

Peak shaving is **off**. Its API operation is **enabled behind once/always approval controls** after the user explicitly accepted the retained inactive preset. Enabled schedule storage and switch-off passed; exact empty-baseline restoration did not, because Sigen keeps its last reserve and windows when switched off. The accepted inactive preset is Monday 01:00–01:15, 2500 W, 20% reserve. All other baseline settings and grants match.

## Observed provider behavior

The 31 October initial disabled populated-schedule test remained `outcome_unknown`, with independent readback still empty. The app's `ir()` disabled branch sends `tP(stationId, 0, 0, [])`. That is a wire payload, not evidence that stored windows and reserve are cleared. The earlier interpretation that disabling clears them was disproved by the enabled live test.

The underlying app control path, `clN()`, writes only the switch register when control mode is zero. Its enabled branch separately writes the tasks, task count and reserve. This matches cloud readback: disabling retains the previously saved preset. No clear/delete operation was found in the inspected peak-shaving app paths. Do not invent a clearing request, replay an uncertain command, or reinterpret an old clear request as successful.

## Enforced contract

- `enabled:false` must include the current `slots` and `reserveSocPercent` unchanged. The immutable review therefore shows the preset that will remain. Dispatch sends the app's canonical mode 0, reserve 0, empty-list payload; verification requires mode 0 **and the reviewed retained preset**. Attempts to clear or edit a preset while disabling fail during preparation.
- Every enabled schedule requires one to twelve valid windows: unique weekday codes 1–7, ordered local times and no overlaps. Existing opaque, overnight or excessive presets remain readable and may be preserved when disabling; they cannot bypass enabled-write validation.
- Enabled reserve must be at least both current discharge cutoff and backup SOC, and at most current charge cutoff. Unknown required bounds refuse the write. These limits are read during preparation and again immediately before execution. Disabling does not depend on the SOC endpoint being available.
- Station timezone must match. Power is exposed in watts and serialized in kW.
- Historical reviews remain readable. An old request to clear the preset still fails readback against a retained preset. Attempted commands remain read-only reconciliation and are never resent.

The shared SOC reader uses only `/device/energy-profile/battery/level/{station}` for reserve checks. It also supplies the complete battery-settings read, preserving nullable values and percentage validation without fetching unrelated settings for peak-shaving validation.

## Primary app evidence

| Source | Evidence |
| --- | --- |
| `main.dart_43.baa9a2b9.js`, `ir()` | Disabled request carries control mode 0, reserve 0 and an empty task list. Enabled request uses form values. This does not establish erasure of stored fields. |
| Same file, `aId()` / `bIc()` | Reserve bounds use charge, backup and discharge SOC; adding a thirteenth window is refused. |
| `main.dart.d390de04.js`, `tP.E()` / `pU.E()` | DTO fields are `stationId`, `controlMode`, `shavingSOC`, `settingList`; tasks contain `whichDay`, `startTime`, `endTime`, `peakPower`. |
| Same file, `ldT()` | Maps charge, discharge and backup SOC. |
| Same file, `clN()` | Disabled local-control branch writes only switch register 11577. Enabled branch requires 1–12 valid tasks and separately writes task count 11579, reserve 2942 and the switch. |

SHA-256: `main.dart_43.baa9a2b9.js` = `4817629feaf5c23f09e9c1ed0cb87ab0742accbed138aa043d2f300ce54cfce5`; `main.dart.d390de04.js` = `12af3891429bf8448dc15c5cae36740131005e00160e05c442f5e28d11c83e10`.

## Authorized live test, 31 October 2026

The user approved briefly enabling one weekly Monday **01:00–01:15** window at **2500 W** with **20% peak-shaving reserve**, then immediately restoring disabled/empty/0%. The station returned `Europe/London`; the Saturday test was outside the window. Fresh SOC bounds were discharge 20%, backup 20%, charge 100%. Protected baseline snapshots at **15:41:18.337** and **15:46:51.810 UTC** matched across operating mode, profile inventory, full current profile, preheating, peak shaving, saving settings, battery settings and grants.

| Step | Command | Evidence (UTC) |
| --- | --- | --- |
| Enable populated schedule, approve once | `b2aa058d-3659-46eb-a505-d948667fa0d4` | Attempted **15:49:41.434**; receipt verified **15:49:42.548**. Independent read at **15:50:03.561** confirmed mode 1, reserve 20%, Monday 01:00–01:15, 2500 W. |
| Disable and request empty/0% restoration, approve once | `cf428cac-0d7c-4ab6-be03-a3a79bd1c4c6` | Attempted **15:50:24.994**; receipt remains `outcome_unknown`. Independent read at **15:50:38.052** confirmed mode 0, but reserve 20% and the window remained. The command was not replayed. |
| Independent full comparison | Read only | Snapshot at **15:53:53.388** differs only at `profile.peakShaving.reserveSocPercent`, `profile.peakShaving.slots`, `peak.reserveSocPercent`, `peak.slots`. Everything else matches, including Sigen AI mode, battery reserve 20%, other schedules and zero grants. |

The saved window is inactive. This establishes enabled schedule storage and switch-off, not physical peak-shaving performance during a scheduled window. Exact empty/0% restoration was **not** achieved. The API operation was disabled again at **15:54:20.945 UTC**, leaving the existing five accepted operations enabled. The user subsequently explicitly accepted the inactive preset and authorized enabling API writes. That acceptance changes the restoration condition; it does not turn the original empty-restoration receipt into a success.

## Verification

The earlier correction `c17f694a` passed 276 focused tests and native Worker/MCP verification, but incorrectly inferred preset clearing from the wire payload. Its preflight rejected disabled populated requests and reserve below the live minimum; the preflight enabled command expired without execution. Those historical results do not prove the revised retained-preset contract.

The retained-preset correction adds positive disabled-preset verification, negative clearing/editing requests, historical-clear mismatch protection and enabled-write rejection for unsupported preserved windows. All **282 focused tests** pass, alongside package/app type checks, package build, scoped lint/format, complexity and documentation checks. Native Worker/MCP verification passed in **80.06 seconds**. Both independent review axes are clear; the spec review additionally required all enabled requests to validate preserved windows, which is covered by regressions. Code `a5f7cc19` was deployed at **16:04:50.220 UTC**, retaining the five accepted operations and excluding peak shaving. Actual Executor readback at **16:05:15.321 UTC** confirmed mode 0 with the retained Monday preset. Preparation of a disabled request preserving that preset (`3ce32c4a-28a3-4a55-9db7-825a74524e51`) succeeded; preparation of a disabled zero/empty request (`016aebfb-01e8-4a29-95ee-71459edf7780`) failed. Neither was approved or executed. The earlier restoration receipt remained `outcome_unknown`. No additional provider mutation was sent.

Full CI for the earlier preflight revision `d9b1f9cb` passed ([run 41216420110](https://github.com/cill-i-am/meal-planner/actions/runs/41216420110)). On the retained-preset revision `396eadcf`, Sigen, package, native Worker, API, browser and Quality jobs passed; full [CI run 41218058804](https://github.com/cill-i-am/meal-planner/actions/runs/41218058804) is still pending its media-container jobs. The later acceptance and deployment are recorded below.

## Accepted retained preset and production enablement

On 31 October the user answered **“Accept inactive preset and enable API writes”**, accepting the disclosed difference from the original empty-preset restoration requirement. The protected production operation list now includes `set_peak_shaving_schedule` alongside the five previously accepted operations. Approval controls, immutable reviews, fresh validation and read-only reconciliation remain unchanged. No always grant was created by this enablement.

Deployment completed at **16:20:18.396 UTC**, preserving the same account Durable Object, connection and credentials. Actual Executor `connection_status` confirmed all six operations and `connected`. Independent readback at **16:20:33.232 UTC** confirmed mode 0 with the accepted Monday 01:00–01:15, 2500 W, 20% preset. The grant inventory was empty, and the original empty-restoration receipt remained `outcome_unknown`. No provider write was sent during API enablement, and the preset was not reactivated.
