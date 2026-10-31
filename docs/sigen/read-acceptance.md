# Sigen read acceptance

## Current scope

The registry exposes 47 HTTP/MCP operations and 21 typed control families. See the [current coverage matrix](coverage.md) for implemented contracts and explicit exclusions. The dated sections below are historical evidence, not current inventory counts. Three required real renewals are verified in [authentication acceptance](auth-acceptance.md); physical dispatch remains disabled after the separate authorized reserve test.

## Hosted evidence on 26 October 2026

The deployment updated only `SigenApi`; `SigenAccountObject` and the rate limiter
were unchanged. The existing encrypted connection survived with the same token
expiry and zero successful natural renewals. Authentication acceptance remains
open; see [renewal evidence](auth-acceptance.md).

An official MCP SDK replay called all 19 operations. Eighteen initially passed;
the historical forecast returned a valid empty chart with a blank unit. The
adapter now represents that response as `availability: no_data`; populated
charts with a blank unit still fail schema validation. After redeployment, all
19 MCP operations and four HTTP checks passed. A separate current-day forecast
read returned seven series and 2,016 samples with `availability: available`.

The successful replay verified four topology devices, one grid device, nine AIO
display parameters, and the first 10 of 29 historical alarms. HTTP also verified
battery settings, topology, monthly history and active alarms. No private station
identifiers, serials, usernames or credentials are included in this record.

The app and direct reads confirmed:

- Device dynamic reads need `sg-pkg: sigen_app`; language alone was insufficient.
- Battery/PV `4294967.295` kW means unlimited; empty limit strings mean unset.
- Grid connection values are amperes, not kilowatts.
- The selected station reports `Europe/London`; the service preserves it.
- Day charts use kW, week/month/year charts use kWh. Public values use W/Wh.
- Historical alarms have a separate endpoint and inclusive UTC-second filters.
- The 25 October history contains repeated local times and missing samples.
  The service keeps both possible UTC instants for ambiguous wall-clock minutes,
  without guessing an occurrence or inventing missing values.

## Verification

86 focused tests cover parsing, units, calendar bounds, Dublin daylight-saving
transitions, cross-midnight schedules, explicit unknown/no-data values, station
and equipment isolation, pagination, auth rotation and HTTP/MCP parity. The
native test bundles the actual Alchemy Worker and exercises SDK calls, encrypted
enrollment, real alarms against synthetic expiry values and persisted restart.

Two review passes found and fixed topology expansion bounds, sibling-AIO reading
misattribution, unknown history unit assumptions, absent schedule timezone and
subsecond alarm-range inversion. Regression tests exercise these failures.

This proof is separate from three natural provider renewals, provider revocation
and reconnection, and any live control acceptance.

## Actual Executor acceptance on 26 October 2026

After the user completed the secure personal-account connection, Executor
discovered and successfully called all 19 operations between 22:00 and 22:06 UTC.
This replay used Executor's account router and opaque credential handles; no
service credential or Sigen password was passed through tool arguments. The
calls were spaced into small batches within the existing service request limit.

Connection status was `connected`, with zero natural renewals and the original
03:18:02 UTC expiry on 27 October. The replay verified four topology devices,
battery/grid/PV settings, mode and schedule reads, device/gateway readings, four
history series, seven current-day forecast series and ten historical alarms.
All 19 returned successful MCP results through the actual target client. No
physical settings changed. Natural renewal and control acceptance remain separate.

## Tariffs and command approvals, 26 October 2026, 23:24–23:27 UTC

Deployed code through `4f137bba` to the same Worker and Durable Object. The
existing encrypted session, expiry and renewal count were preserved. Executor
was updated in place to deployment `dpl_eb9e0498-69ab-41d9-ba09-bd0a02b91c8a`;
the connected account remained usable without reconnecting or renaming it.

Both new reads passed through Executor. `get_tariffs` returned the tax/fee
configuration with fee units explicitly unverified. `get_prediction_plan`
returned 15 actual/plan/price series and 4,804 points. The registry now has 27
operations, including command preparation, approval, execution and inspection.

Prepared an unchanged solar-limit proposal and verified that `approve_command`
paused at Executor's real confirmation boundary, displaying current and proposed
values and the `once` choice. Cancelled that exact pending request. Subsequent
inspection confirmed the command was still `prepared` and the grant list was
empty. No approval was granted and no physical command was executed. Both once
and always modes, revocation and the disable switch are covered by local tests;
the native Worker test persists an always grant across restart and proves that
physical dispatch remains blocked when disabled.

102 focused tests, the native Worker integration test, both package type checks,
Executor adapter type checking, scoped lint/format and documentation checks pass.
The two-axis review caught and fixed expiry during provider validation,
effective-versus-owner limit verification and loss of command receipts during
reenrollment. Regression tests verify each fix, including read-only reconciliation
after timeout and reconnection. Both review axes are clear after corrections.

The remaining discovery/implementation backlog is explicit in
[coverage](coverage.md). Natural provider renewals, revoked-token reconnection and
live physical control acceptance remain outstanding. Controls are still disabled.

## 27 October local extension checks

The registry now exposes 30 operations and eleven typed setting controls. New reads cover AIO inventory, two distinct AIO power-status observations, and browser-observed daily income. New commands cover four SOC thresholds, preserved-window peak-shaving changes and stopping a manual override.

113 focused tests pass. The native Worker test additionally proves that a saved always-approve grant survives runtime restart, repeated execution sends only one synthetic provider write, revocation blocks a queued command, and a fresh once approval permits that command. These are synthetic controls, not live equipment acceptance.

The spec review found that manual-stop confirmation unnecessarily required display telemetry. Its state-only reader now succeeds when display telemetry is unavailable or malformed; regression tests cover both failures. Station income tests preserve signed/calculated/missing values, provider totals and DST ambiguity, and reject another station, wrong dates, malformed values and invalid timezones.

## Hosted extension acceptance, 27 October 2026, 17:47–17:52 UTC

Worker code through `a8d5fb4b` and Executor source `61523f0a4aafcfaa149e8e381a3f2962aa4368f6` were deployed. Executor deployment `dpl_bd5a2a52-26c4-465f-9439-c5ce213691ca` retained the same personal account/provider. Connection status remained connected with two natural renewals, expiry 28 October 03:16:00.894 UTC and physical dispatch disabled.

- AIO inventory returned one topology-verified AIO. Its two power-status observations disagreed (`powerOn: true`, `onOffState: false`); the service preserved both instead of claiming a single physical on/off state.
- Daily income returned 35 samples, nine negative income samples, provider total €0.12 and provider timezone `Europe/London`. The earlier browser observation was €0.07; these were different live observation times, not simultaneous equality evidence.
- Preparing a manual-stop command returned a saved `prepared` review with `enabled: false`. No approval or execution followed. Preparing SOC thresholds returned `UnsupportedCapability` because the current peak-shaving threshold is unset.
- A peak-shaving preparation hit the edge HTTP 429 limit. After the cooldown, `get_command` returned `InvalidInput` for that ID; no saved command was observed. The preparation was not replayed and is not counted as hosted acceptance. Executor initialization/discovery also consumes edge requests, so verification calls need spacing beyond the visible tool count.

The subsequent current-profile automation read brings the registry to 31 operations. Its fixture tests preserve inactive groups, unknown provider codes and cross-midnight windows and unset/zero/unlimited limits, and reject malformed or oversized data. 119 focused tests, both package type checks and the native Worker integration test pass; both review axes are clear. At that point, live physical control acceptance awaited the user's bounded-test decision; the completed reserve test is recorded below.

At **17:57 UTC**, code through `1aad74f2` and Executor deployment `dpl_85d4cfb2-2333-4af1-a901-7839723083fa` (source `18b2b7f8991925d6dddb8f64d4786849952a7780`) passed the actual `get_automation_settings` call. It matched the browser-observed Sigen AI profile: battery and grid automation disabled, one battery group with two windows, one grid group with one window, and station timezone `Europe/London`. The existing account remained connected with two renewals and the same 28 October 03:16:00.894 UTC expiry. Controls remained disabled.

The user explicitly approved the bounded backup-reserve test: 20% → 21% → 20%, exercising once and always approval, then revoking the test grant. The current reserve was re-read as 20% before temporary dispatch was enabled. Any unexpected state or uncertain result would require read-only reconciliation rather than replaying a write.

## Live reserve and approval acceptance, 27 October 2026, 18:57–19:01 UTC

The same deployed code (`1aad74f2`) was used throughout. Only the dispatch configuration was temporarily enabled, then returned to disabled. No credentials, enrollment, renewal timing or physical settings outside backup reserve were changed. The user's explicit test approval covered both Executor approval continuations.

| Step | Live evidence |
| --- | --- |
| Initial state | Connected, reserve 20%, Sigen AI mode, no saved grants; dispatch initially disabled. |
| Approve once | The exact saved 20% → 21% review reached Executor confirmation and was accepted under the user's test authorization. One execution at 18:58:28.057 returned `verified`; readback confirmed 21% at 18:58:28.764. |
| Always approve and restore | A fresh 21% → 20% review was approved with `always`. Execution at 18:59:55.650 returned `verified`; readback confirmed 20% at 18:59:56.300. |
| Remembered permission | A fresh unchanged 20% review was automatically `approved` using the saved operation/station grant, without another approval call. It was not dispatched while authorized. |
| Revoke | Revocation returned zero remaining grants. Attempting the queued review while dispatch was still enabled returned `ApprovalRequired`, demonstrating that the revoked grant could no longer authorize execution. |
| Final state after redeployment | At 19:01 UTC, Executor confirmed reserve 20%, Sigen AI mode, zero grants, dispatch `disabled_pending_acceptance`, and both original `verified` receipts still readable. The connection retained two natural renewals and expiry 28 October 03:16:00.894 UTC. |

The reserve was observed at 21% for about 88 seconds before restoration. The test confirms live backup-reserve writes/readback, once approval, reusable approval and revocation through Executor. It does not establish live acceptance of the other ten control variants, full endpoint coverage, revoked-provider-token reconnection, or the third natural renewal.

Full required CI passed at `bbc3ba5c` before this evidence-only documentation update. The 119 focused tests and native Worker tests remain the code verification baseline; this test required no implementation changes.


## Backup history and energy-saving reads (27 October 2026)

The owner app's Backup History showed nine events totaling 8 minutes 1 second. Its response reports `totalTime: 481`, `backupDetailNum: 9`, and a paginated list of local timestamps with seconds and durations. The energy-saving read returned on-grid code `1`, off-grid code `0`, value `65535`, and `offGridEnable: true`; code meanings are not inferred. Navigation only was used; no physical setting changed.

The registry now has 33 operations. All 153 focused tests and the native Worker/MCP test pass, including second-precision DST overlaps/gaps, zero durations, pagination bounds/mismatch, malformed provider data, and station isolation. The native test calls both new reads through real MCP, encrypted RPC and the account Durable Object. At **20:17 UTC**, Worker code `9551e572` and Executor deployment `dpl_8788ddc6-6a4c-49fc-b1c7-2d92f5f03103` (source `1e649e21861a2fb998ac09184af8f659901cfffb`) passed both real reads through the existing account. Backup history returned all nine events, their zero-duration event, station timezone `Europe/London` and 481 seconds. Energy-saving values matched the app. The connection remained healthy with two renewals and unchanged expiry (28 October 03:16:00.894 UTC); dispatch remained disabled.

Live pagination revealed that `totalTime` is a **page duration**, while both event-count fields span the full history. Page 2 with size 3 returned three events lasting 29, 39 and 39 seconds and a summary of 107 seconds; page 3 returned 119, 0 and 89 seconds and a summary of 208 seconds. Both retained total event count 9. The public field was corrected to `pageDurationSeconds`, with a regression test and explicit descriptions. At **20:20 UTC**, corrected Worker code `97713511` and refreshed Executor deployment `dpl_83abd9d1-b518-4bbb-8f14-a25cf2412541` (same source `1e649e21861a2fb998ac09184af8f659901cfffb`) passed the final reads. Executor discovery exposes `pageDurationSeconds`; page 2/size 3 returned `pageDurationSeconds: 107`, three records, three pages and both full-history counts 9. Energy-saving settings matched again. Renewal state/expiry and disabled dispatch were unchanged. Both review axes are clear after the pagination correction. Latest-branch CI is separate from these local and hosted checks.

Direct Node `fetch` POST requests to both `/v1/get_backup_history` and `/v1/get_energy_saving_settings` also returned HTTP 200 with the same corrected fields. An initial Python urllib request returned HTTP 403 and is not counted as successful HTTP acceptance; no credential or session change was needed for the Node client.


## Profile capabilities, discharge priority and backup diagnostics (27 October 2026)

Read-only app exploration confirmed `/device/energy-profile/support/{stationId}` with battery/backup/PV availability and unavailable AC/DC charging and automation flags, source options `[pv, grid]` / `[pv, battery]`, and EMS-upgrade support `true`. The separate discharge-priority read returned `[pv, grid]`, matching the app's Solar then GRID display.

The Backup Event Center used `current`, `stationId`, `startTime`, `endTime`, and an empty `filterItems` query, with fixed size 10. Its 27 September–27 October page returned seven records, retaining repeated timestamps/reason codes and four original measurement labels/values per record. Single-phase diagnostics are adapted; populated multi-phase and extra-device details are explicitly unsupported until their schemas are verified. No cause is inferred from provider reason codes or measurements, and no physical setting was changed.

The registry now has 36 operations: 30 provider/connection reads and six command/approval operations. 191 focused tests pass, covering strict feature booleans, unknown source codes/order, bounded diagnostic data, station isolation, inclusive date ranges, pagination consistency, DST overlap/gaps and duplicate retention. Native Worker/MCP tests, both package type checks, scoped lint/format, complexity and documentation checks pass. Both review axes are clear.

At **21:34 UTC**, Worker code `b95568f5` and Executor deployment `dpl_5ce11098-22fa-4c5b-9fad-93ceac745fd6` (source `4cfddacc06d88813cfacd746fac4b12078953b66`) passed all three reads through the existing account. Capability booleans and source options matched the app, as did discharge priority `[pv, grid]`. Backup diagnostics returned all seven records, but only voltage and frequency: the app returned active and reactive power too. This discrepancy was not treated as complete parity.

The app sends `sg-app-version: 4.1.0` and `sg-v: 4.1.0`. Applying both headers only to the backup-event request restored all four measurements. Corrected Worker code `ab29270e` was deployed at **21:39 UTC**; Executor then returned seven records with four original labels/values each, matching the browser's voltage, frequency, active power and reactive power. The implementation does not claim either header is individually necessary. The endpoint-specific headers are internal, not caller-configurable. Native tests assert their presence on this request and absence from the other exercised reads.

Direct authenticated HTTP calls also returned 200 for all three new operations. For backup diagnostics, page 2 returned zero records while retaining total 7 and pages 1. An inclusive single-day query for 11 October returned all seven snapshots with four measurements each; 12 October returned an empty page with total 0 and pages 0. Repeated timestamps/reasons remain separate records, not a claim of seven distinct outages.

The connection stayed healthy with two natural renewals and the same expiry, **28 October 03:16:00.894 UTC**. Physical dispatch remained disabled throughout. No enrollment, credential, grant or physical setting changed.

## Profile, load and control expansion, 28 October 2026

The registry now has **47 operations** (41 provider/connection reads plus six command/approval operations) and **15 typed control families**. The [coverage matrix](coverage.md) is consolidated into current implemented contracts and explicit exclusions; its older contradictory inventory appendices were removed. Three real natural renewals passed separately. This increment did not change equipment, enroll again, revoke credentials or grant approvals.

229 focused tests, both package type checks, package build, Executor type checking, scoped lint/format, complexity and documentation checks pass. The native Worker test exercises encrypted RPC, persisted credentials/grants, synthetic alarm renewal and once/always/revocation under the real production request budget; it waits for the rolling window instead of weakening that budget. Both review axes are clear after fixes for local-admission timeout classification, duplicate solar membership, Retry-After and custom-profile configuration verification.

A custom-mode review now includes the selected profile settings in its fingerprint. A changed profile with the same ID conflicts before dispatch; readback cannot mark it verified if configuration differs from the saved review. Only the top-level activation marker may change during activation. Missing review data fails verification. Smart-load grants bind both key and path, and automatic/unknown load modes refuse manual switching. Unsupported solar sources/groups are refused; excluded entries cannot change priority. Manual-start acknowledgements remain `outcome_unknown` because the read endpoint cannot confirm duration and power.

The account-wide persisted provider budget allows 30 requests per rolling minute with 400 ms spacing. Provider cooldown honors Retry-After. A pre-transport rejection or admission timeout preserves the valid session rather than discarding credentials. Synthetic regression tests distinguish zero transport calls from uncertain provider outcomes.

The independent Worker was updated at **14:55 UTC**, retaining its Durable Object and credentials. An initial capability read exposed a query mismatch: ordinary stations require `id` and `appVersion=4.1.0`; PPC uses `stationId`. The correction was fixture-tested and deployed at **14:58 UTC**. Corrected HTTP station enumeration/capabilities returned 200 at **15:00–15:01 UTC**. The HTTP verification script's initial empty station-list input was invalid; the supported input is `{stationId}` and the corrected call passed.

Executor was updated in place to deployment `dpl_a89812d7-4ebe-45a5-a4c3-ab9732d6db23`, source `23c3b9e29cf9123afeeebabf75da692ca19ffc24`, preserving all four source files and the existing personal account. It discovers all 47 tools. A rapid replay reached the existing **edge** request limit; only completed calls were counted. Small read-only batches after the limit reset were used for final acceptance.

Confirmed through HTTP and the actual Executor account:

- Station inventory contains one enrolled station. Backup is supported; AC charger and provider EV flags are false. Four profile templates are available.
- The current profile has one battery group, one grid group and three solar-priority entries. Template 200 has three battery groups, one grid group and three priorities. No profile was created or activated.
- Solar priority contains three flat entries, preserving provider order/status.
- No configured smart loads and no system cards. Load capabilities distinguish supported generator/load ports from `generatorInstalled: false`.

At **15:05 UTC**, the final Executor batch also confirmed preheating has no slots, switch 0 and null automatic-mode capability; third-party inventory contains one explicit generator placeholder. Both HTTP and Executor return `UnsupportedCapability` for a missing smart load before detail access. Populated smart loads, preheating schedules and real custom-profile activation remain synthetic-only; empty inventory is not hardware acceptance.

The connection remains `connected`, with **three** successful natural renewals, expiry **28 October 15:15:00.102 UTC**, and dispatch `disabled_pending_acceptance`. No credentials or private station identifiers are included here.


## Profile CRUD and schedule/settings writes, 31 October 2026

The service retains 47 HTTP/MCP operations and now accepts **21 typed command families**. This increment adds template-based inactive profile creation, custom-profile metadata/automation updates and inactive-profile deletion; complete battery/grid automation replacement; residential preheating schedules; and energy-saving settings. Peak-shaving now permits new validated windows. All commands use the existing once/always approval, revocation, conflict and single-dispatch lifecycle. Profile update/delete grants bind the profile ID. See [profile and schedule contracts](profile-schedules.md) for input semantics and remaining limits.

**254 focused tests** and the native Worker test pass, together with package/app type checks, package build, scoped lint/format, complexity and documentation checks. The native test was rerun after the final code changes and passed in 80.64 seconds. Both independent review axes are clear. Regression coverage includes full-profile preservation, populated automation readback, integer-W/kW round trips, key-order-independent comparisons, inactive-profile deletion, new-ID creation evidence, lost-response reconciliation without a second write, profile-scoped grants, revocation and disabled dispatch.

The final independent deployment completed at **12:59:27 UTC**, preserving the existing Durable Object, connection and credentials. HTTP preparation returned `prepared` with the expected review type for `create_energy_profile`, `set_preheating_schedule` and `set_energy_saving_settings`. The live template exposed residential preheating mode 1: the adapter now follows the app's null write serializer for this industrial-only selector and checks only the documented inactive equivalence on readback. Saving settings support explicit preservation of the observed on-grid 1/off-grid 0 codes. No profile was created, updated or deleted, and no setting was changed.

Executor discovered the expanded command union after its catalog cache refreshed; its existing account successfully prepared a preheating command and reported `connected`, **nine** successful natural renewals and `disabled_pending_acceptance`. No new account, credential, source deployment or approval was needed. Preparation evidence is not live write acceptance. These new writes remain synthetic-only while the global dispatch switch stays off.
