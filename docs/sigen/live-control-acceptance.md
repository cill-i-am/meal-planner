# Live control acceptance, 31 October 2026

Five operations are now enabled: `create_energy_profile`, `update_energy_profile`, `delete_energy_profile`, `set_preheating_schedule` and `set_energy_saving_settings`. Every execution still needs approve-once or a matching revocable always-approve grant. `set_peak_shaving_schedule` did not pass populated readback and remains disabled. All other operations remain disabled by the explicit operation list.

The user explicitly approved creating/editing/deleting one inactive profile, saving and restoring disabled preheating/peak schedules, writing back unchanged saving settings, removing test grants and leaving accepted operations enabled. This record distinguishes provider storage/readback from physical execution. Protected baseline and restoration snapshots are local, gitignored and mode 0600; credentials and station identifiers are omitted here.

## Procedure and restoration

The complete preflight was captured before any mutation at **14:49:02.992 UTC**, following the original snapshot at 14:19:18.621. The two matched for operating mode, profile inventory, full current profile, preheating, peak shaving, energy saving, battery settings and grants, ignoring read timestamps. Both reported Sigen AI mode, disabled battery/grid automation, empty disabled peak/preheating schedules, no grants and a healthy connection. The six test operations were temporarily enabled at **14:48:29.307 UTC**; every mutation used the actual connected Executor account and the service's immutable review/approval/execution workflow.

The final deployment completed at **15:08:13.497 UTC** on code `fcf993d3`. It retained the same Durable Object and credentials, enabled the five accepted operations and excluded peak shaving. The protected deployment configuration records that list for subsequent deployments. Executor independently reported the same five operations and `connected` after deployment.

The final full snapshot began at **15:08:21.933 UTC**. Exact comparisons, excluding only `fetchedAt`, passed for all eight baseline sections: operating mode, profile inventory, current profile, preheating, peak shaving, saving settings, battery settings and grants. The temporary profile is absent; grants are empty; reserve remains 20%; both tested schedules are disabled and empty. No schedule or test profile was activated.

## Confirmed live outcomes

All times below are UTC on 31 October 2026. A verified receipt establishes observed provider state, not physical equipment execution.

| Check | Saved command | Evidence |
| --- | --- | --- |
| Create inactive profile, approve once | `796c5bf6-1e08-4283-836d-0b88a1f2ce62` | Verified **14:50:56.436**: one new profile, complete expected configuration, inactive status, unchanged current mode. |
| Update metadata, temporary always approval | `33af104b-5447-4f55-b69a-68862e15f6f0` | Verified **14:52:39.436**: renamed/edited the disposable profile, complete settings preserved. Repeated execute returned the same verified receipt and original attempt timestamp. |
| Remembered approval | `0c5b3ad0-0905-4105-b292-1d03d153f889` | A later edit prepared as approved using the profile-scoped grant; verified **14:54:37.177** without another approval call. |
| Revoke before queued execution | `967b9405-6d46-43c8-963b-46098288f2d4` | Prepared under the grant, then grant revoked. Execution returned `ApprovalRequired`; the queued description was not applied. Zero grants remained. |
| Delete disposable inactive profile, approve once | `cae37c1a-e1b9-4559-a2dc-1d92597216b9` | Verified **14:55:55.403**: inventory empty, target absent, current mode unchanged. |
| Save disabled preheating window, approve once | `d6a29a03-5446-4d87-9e93-0a42274f70e1` | Verified **15:04:41.558**: switch 0; Monday 01:00–01:15, start minute 60, duration 15, weekday `[1]`, unused powers returned as blank strings. |
| Restore empty disabled preheating, approve once | `85782a3f-76b0-45a0-95bb-eaa3f819648e` | Verified **15:05:08.868**: switch 0, slots empty. |
| Unchanged energy saving, approve once | `08cdbfbe-2c52-4530-89e9-ad13c742c01f` | Verified **15:07:15.966**: on-grid `1`, off-grid `0`, system-default value `65535`, off-grid capability still true. The full independent restoration comparison also passed. |

The disposable profile's reusable grant was scoped to update + station + that profile ID and was revoked before deletion. No broad approval or test grant remains.

## Preheating discrepancy and correction

The first preheating attempt (`338a16d0-6b03-4efe-aada-41fe96911c19`, **14:56:56.133**) returned `outcome_unknown`. Independent readback showed the exact requested disabled window, but Sigen converted the submitted unused power fields from null to `""`. The original matcher correctly refused to call the mismatched representation verified. It did not resend the write.

A separate restoration command (`a548bd02-2ef3-4fc4-bd0b-18f36646aef7`) verified the empty disabled baseline at **15:00:58.037**. The correction recognizes only null/blank unused residential powers, including preservation and comparison during full-profile updates. Numeric zero, string zero, whitespace, nonempty values and industrial variants remain unsupported. Serialization still sends null. Both independent review axes were clear; code `fcf993d3` was deployed at **15:04:01.352** before the fresh successful test and restoration above. The original uncertain receipt remains historical evidence and was not rewritten or replayed.

## Excluded or narrower acceptance

- **Peak shaving remains disabled.** Command `4540e207-e6ca-4363-878b-6aa0efb82b63` attempted a disabled Monday 01:00–01:15 window with 2500 W and unchanged reserve 0 at **15:05:45.949**. It returned `outcome_unknown`. Independent readback still showed mode 0, reserve 0 and no slots; the populated schedule was not proven. A separate restoration to the empty disabled baseline (`19dcf04b-1ec8-4be0-9ad2-23548e1593a1`) verified at **15:06:40.865**. That unchanged-state receipt is not acceptance of schedule creation. The uncertain write was not replayed, and enabling peak shaving is outside this bounded test.
- **Profile CRUD evidence covers metadata and preservation.** Live provider capabilities explicitly return `hasBatteryAutomation:false` and `hasGridAutomation:false`. The client refuses automation edits rather than bypassing those flags. Custom-profile automation was therefore not exercised. `replace_automation_schedule` also remains disabled: the active Sigen AI profile has a null profile ID and duplicate inactive windows, so exact restoration is not representable by that input.
- **Preheating acceptance covers disabled schedule storage and restoration.** Heating was never enabled; physical execution remains untested.
- **Energy-saving acceptance covers unchanged writeback.** It does not establish transitions to performance/deep saving or equipment dormancy. The live unchanged off-grid capability flag was independently checked, not inferred from a receipt that matches modes and threshold.
- Other control families, missing hardware adapters and intentional provider-revocation/reconnection acceptance remain separate work. This is not full API/MCP completion.

## Verification

**263 focused tests** pass, including null/blank readback and negative unexpected-power cases through the real client interfaces. Package/app type checks, package build, scoped lint/format, complexity and documentation checks pass. The final native Worker/MCP test passed in **80.46 seconds**, exercising the actual bundle, encrypted RPC, durable session/command state and synthetic renewals. Both targeted independent review axes were clear. CI and broader endpoint evidence are tracked in [read acceptance](read-acceptance.md).

A tenth natural renewal occurred during these tests: alarm **15:07:55.981**, previous expiry **15:08:55.980**, new expiry **1 November 03:07:54.981**, station/energy-flow verification completed **15:07:57.070** with both failures null. The last five retained records have successful reads and an intact expiry chain. No expiry was forced and no credentials were rotated manually.
