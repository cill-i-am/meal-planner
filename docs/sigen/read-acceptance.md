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
