# Live control acceptance, 31 October 2026

The user requested live acceptance testing so the new writes can be enabled. This record distinguishes provider storage/readback from physical execution. The protected restoration snapshot is local and gitignored; credentials and station identifiers are not included here.

## Bounded procedure

1. Verify the connection, current operating mode, profile, automation, peak shaving, preheating, saving settings, reserve and grants. Save the complete baseline before any mutation.
2. Enable only the six operations under test through the master switch and explicit operation list. Keep every other operation disabled. Each mutation still requires its immutable once/always review.
3. Create a uniquely named inactive profile from an enumerated template. Confirm one new ID, complete settings, inactive status and unchanged current mode. Rename/edit that test profile and replace its disabled automation schedule. Verify once approval, a temporary profile-scoped always-update grant, repeated execution, remembered approval and revocation. Delete only the test profile and verify its absence.
4. Save one preheating window while preheating remains disabled, confirm populated readback, then restore the empty disabled baseline. Do the equivalent for peak shaving, preserving reserve and limits. Do not enable either schedule or activate the test profile.
5. Write back the unchanged energy-saving modes and threshold. Compare the complete before/after values, including the off-grid capability flag, independently of the command receipt. Do not claim that this tests transitions into deep saving or equipment dormancy.
6. Verify the active profile, operating mode, reserve, schedules, saving settings and grant inventory against the baseline. Remove test grants. Leave only successfully accepted operations enabled and report any narrower evidence or excluded family.

Every uncertain result is inspected through reads or the saved command's reconciliation path; a mutation is never blindly resent. Stop the sequence on unresolved drift and prioritize restoration. Expired reviews are replaced only when no attempt was dispatched.

`replace_automation_schedule` remains outside this live test: the active Sigen AI profile has a null profile ID and duplicate inactive battery windows. Its exact baseline cannot currently be represented by the replacement input. Custom-profile automation is tested on the disposable inactive profile instead.

## Results

Pending live execution. Preflight recorded Sigen AI mode, disabled battery/grid automation, disabled empty peak/preheating schedules, no saved grants, a healthy connection and nine successful natural renewals. The per-operation gate passed 256 focused tests, both package/app type checks and the native Worker test, including configured-operation reporting after restart. Both review axes are clear.


At **14:24:17 UTC**, the operation gate was deployed with `SIGEN_CONTROLS_ENABLED=false` and an empty operation list. Executor verified `connected`, `disabled_pending_acceptance`, `enabledOperations: []` and nine renewals. No provider mutation has been dispatched. Enabling the bounded procedure awaits the requested explicit production-write authorization.
