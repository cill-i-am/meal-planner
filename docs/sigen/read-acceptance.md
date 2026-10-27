# Sigen read acceptance

## Scope

The shared registry now exposes 19 read operations through HTTP and MCP. This
expansion covers station metadata, live flow, current/available modes, battery,
grid and PV settings, manual-override state, peak shaving, topology, device and
gateway measurements, grid equipment, alarms, energy history and forecasts.

Tariffs, complete custom-profile/schedule details, station enumeration, smart
loads, chargers/V2X, shared caching/request budgets and physical controls remain
unfinished. The [coverage matrix](coverage.md) tracks these separately. No
physical setting was changed during discovery or verification.

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

The registry now has 33 operations. All 152 focused tests and the native Worker/MCP test pass, including second-precision DST overlaps/gaps, zero durations, pagination bounds/mismatch, malformed provider data, and station isolation. The native test calls both new reads through real MCP, encrypted RPC and the account Durable Object. Hosted verification of these two additions is pending deployment.
