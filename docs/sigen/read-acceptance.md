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
and reconnection, actual Executor integration, and any live control acceptance.
