# Private mySigen API and MCP

This independent Cloudflare service implements core and settings reads from the [coverage plan](../../docs/sigen/coverage.md). Tariff/AI-plan, daily income, AIO power-state and current-profile automation reads and eleven typed setting controls are implemented. Custom-profile details, smart loads, charger adapters and remaining control families are incomplete. The package in `packages/sigen` contains the reusable Effect 4 private EU client; this app owns encrypted sessions, HTTP/MCP and the account Durable Object. `sigen.alchemy.ts` deploys only this service. It does not share credentials or product authentication with Meal Planner or Tesco.

## Current surface

| Operation | Input | Result |
| --- | --- | --- |
| `connection_status` | `{}` | connection state, selected station, access expiry, successful renewal count |
| `get_station` | `{stationId}` | selected station metadata and explicit equipment capabilities |
| `get_energy_flow` | `{stationId}` | watts, SOC, provider/fetch timestamps and freshness |
| `get_operating_mode` | `{stationId}` | provider mode/profile IDs, preserving unfamiliar modes |
| `get_battery_settings` | `{stationId}` | reserve/SOC thresholds, power limits and export permission |
| `get_grid_settings` | `{stationId}` | import/export watts and connection-current amperes |
| `get_solar_settings` | `{stationId}` | solar power limit, including unlimited/unset |
| `list_operating_modes` | `{stationId}` | available modes and custom-profile identifiers |
| `get_peak_shaving_schedule` | `{stationId}` | local slots, provider day codes, watts and station timezone |
| `get_manual_override` | `{stationId}` | enabled state, provider mode/end time and battery display |
| `get_topology` | `{stationId}` | bounded inventory with parent serials and provider statuses |
| `get_station_status` | `{stationId}` | station and device communication statuses |
| `get_gateway` | `{stationId}` | gateway display parameters with units |
| `list_grid_devices` | `{stationId}` | grid connection point equipment |
| `get_device_info` | `{stationId,serialNumber}` | static and dynamic display parameters after topology membership checks |
| `get_device_values` | `{stationId,serialNumber}` | selected AIO descendants; inverter watts and battery percent |
| `list_alarms` | `{stationId,state,page,pageSize,startAt?,endAt?}` | one active/history page; history requires inclusive UTC milliseconds, maximum 31 days |
| `get_energy_history` | `{stationId,date,period}` | station-local day/week/month/year; power W or energy Wh, totals and flows |
| `get_forecast` | `{stationId,date,period}` | day/week/month forecast, with explicit no-data availability |
| `get_tariffs` | `{stationId}` | tax/fee configuration and price coefficients; provider fee units explicitly unverified |
| `get_prediction_plan` | `{stationId}` | distinct actual load, AI-plan and price series, UTC timestamps, W/percent/currency per kWh |
| `prepare_command` | `{stationId,commandId,change}` | immutable five-minute review and current approval state |
| `approve_command` | `{stationId,commandId,change,current,reviewFingerprint,mode}` | approve once or save an always-approve grant |
| `execute_command` | `{stationId,commandId}` | dispatch once or reconcile an existing attempt through reads |
| `get_command` | `{stationId,commandId}` | saved review and command receipt |
| `list_approval_grants` | `{stationId}` | remembered operation permissions |
| `revoke_approval_grant` | `{stationId,grantId}` | remaining grants |

The same registry and Effect schemas define `POST /v1/<operation>`, remote `POST /mcp`, and authenticated `GET /openapi.json`. HTTP request bodies reject unknown fields and are limited to 64 KiB. Provider bodies are limited to 512 KiB; requests time out after 15 seconds. Both HTTP status and application codes must succeed. Provider messages, bodies, credentials and parser errors are never included in public failures. HTTP failures may include the numeric upstream HTTP status for diagnosis. Browser origins are refused.

All operations require the dedicated owner bearer credential, whose SHA-256 verifier is deployed. Operator credentials are separate and cannot call agent tools. `/admin/session` supports POST enrollment, GET sanitized renewal reporting, and DELETE disconnect. Those routes require the operator credential. Neither credential is a Meal Planner OAuth token.

This first private deployment binds one account and one explicitly selected station. A mismatched station is refused before provider access. A returned default station that differs from the requested station is also refused. Station enumeration and additional account mappings remain unfinished.

History dates are calendar dates in the provider station timezone. Weeks begin Monday; month/year ranges use inclusive calendar boundaries. Day charts contain power, longer periods contain energy. Missing samples are not filled. Repeated DST minutes retain both UTC candidates; nonexistent local minutes retain none. Unknown series retain raw values with unknown units. Provider chart signs are preserved, and differ from live battery-flow signs. Empty forecasts return `availability: no_data`.

Display labels are not stable metric keys. Empty settings are unset; the provider power sentinel `4294967.295` kW is unlimited. An inactive override stays inactive even if it retains a historical mode/end time. Hardware and station membership are verified before requesting device details. No cache or shared upstream request budget is implemented yet; the existing edge admission limit remains 30 requests per minute, and composite reads use at most two simultaneous provider calls.

## Enrollment and renewal

The operator supplies a fresh username/password enrollment; the service performs the app-compatible password transformation and OAuth password grant. The password and its transformed value are never persisted. Enrollment is encrypted before native Worker-to-object RPC. Only AES-GCM encrypted access/refresh tokens survive in storage, under a dedicated stable secret. Existing browser refresh-token chains are not borrowed.

The account object serializes enrollment, disconnect, renewal and reads. It commits rotated credentials and the next alarm in one storage transaction. Renewal is scheduled from the provider's `expires_in`, one minute early. A durable refreshing marker is written before provider I/O. After an interrupted or rejected rotation, the watchdog clears the session and reports `reauthentication_required` rather than reusing a possibly consumed refresh token. Reconnect through fresh enrollment.

HTTP and MCP cancellation joins local tool cleanup. Alchemy's current native Durable Object RPC cannot transport the caller's cancellation signal into the object: cancellation ends the Worker-side wait, while an already dispatched provider read may continue until its 15-second timeout. The account object owns the session operation until it finishes.

Read acceptance is recorded in [read verification](../../docs/sigen/read-acceptance.md).

The last five renewal results contain only timestamps and outcome categories. Three synthetic alarm renewals in workerd are separate from the required three natural renewal cycles in Cloudflare. Hosted enrollment and initial reads are verified; two natural renewal cycles are verified; the third is pending. See the [acceptance record](../../docs/sigen/auth-acceptance.md).

## Approve once and always approve

The owner service credential can prepare, approve and execute commands through HTTP or MCP. Executor requires confirmation on `approve_command`, whose input includes the exact current settings, proposed values and `once`/`always` choice. Preparation, execution of a saved approval, and revocation do not add a second Executor prompt. Unknown tools require confirmation even if remote metadata calls them read-only.

`prepare_command` accepts a fresh UUID and one typed change: backup reserve, battery charge/discharge power limits, solar power limit, battery export, grid import/export limits, connection current, operating mode, four SOC thresholds, an existing peak-shaving schedule, or stopping a manual override. Grid limit commands enable the specified finite owner limit and enforce known installer ceilings. Operating-mode writes currently support maximum self-powered (0), Sigen AI (1) and fully fed to grid (5), and must also be currently available to the account. TOU, custom profiles and Remote EMS remain read-only until their complete settings can be reviewed and conflict-checked. Missing hardware fails explicitly.

SOC-threshold changes require all four current values to be known. Peak-shaving edits preserve the current timezone, day codes and time windows; only enabled state, reserve and per-window power may change. Manual-stop confirmation reads the authoritative enabled state independently of live battery telemetry. Starting an override and creating or moving schedule windows remain unimplemented.

Current-profile automation reads preserve inactive groups, provider mode/status/source/day codes and duplicate time windows; they do not enumerate all custom profiles.

Daily income reads retain provider-reported totals, signed income and calculated income separately, in the station currency. These values are not independently verified bill settlements; missing samples and ambiguous local times remain explicit. AIO reads check serial membership and keep the two provider power-state observations separate.

Preparation saves the complete normalized settings and proposed values for five minutes. Copy `change`, `current` and `reviewFingerprint` exactly into approval. Once approves that command. Always permits future validated parameters for the same operation and station, until revoked; it is not limited to today's values. Fresh preparation still rechecks state. Revoking a grant also invalidates queued commands that use it. Reenrollment creates a new connection identity, invalidating unused approvals and grants. Saved command IDs and attempt receipts survive so uncertain outcomes can be reconciled when the same station is connected again.

Execution rechecks current settings and validation under the session lock, then saves a dispatch marker before the single provider mutation. Duplicate command IDs return the saved record; altered inputs conflict. Interrupted, timed-out and ambiguous attempts are never resent. Repeated execution reconciles only through reads. `verified` means the desired settings were observed, not proof that this request caused them. Provider rejection, acceptance, verification and unknown outcome remain distinct.

`SIGEN_CONTROLS_ENABLED` defaults to `false`. Preparation, approvals and inspection work while physical dispatch is disabled. The same switch covers HTTP and MCP. All eleven adapters are fixture-tested. Backup reserve additionally passed a user-authorized live 20% → 21% → 20% test through Executor, including once/always approval and revocation; the other ten variants are not live-control-verified. Enabling dispatch and any live test require a reviewed, explicit procedure including restoration. The durable command book refuses new preparations after 256 saved records; it never silently deletes replay protection. Operational archival is a future extension.

## Deployment

Create independent random 32-byte owner and operator bearer credentials. Keep the owner credential in a user-scoped client account, and keep the operator credential out of agent accounts. Supply these in a protected, gitignored `.dev.vars.sigen`:

- `SIGEN_OWNER_TOKEN_SHA256`: SHA-256 of the owner credential.
- `SIGEN_OPERATOR_TOKEN_SHA256`: SHA-256 of the separate operator credential.
- `SIGEN_SESSION_ENCRYPTION_KEY`: 32 random bytes as 64 lowercase hexadecimal digits.
- `SIGEN_CONTROLS_ENABLED`: optional boolean, default `false`; changing it does not change equipment.

The encryption key must remain stable across restarts and redeployments. Back it up securely. Rotate owner/operator verifiers independently. Key replacement requires a disconnect and new enrollment; it cannot decrypt existing state.

```sh
pnpm exec alchemy plan --config sigen.alchemy.ts --stage prod --profile <profile> --env-file .dev.vars.sigen
pnpm exec alchemy deploy --config sigen.alchemy.ts --stage prod --profile <profile> --env-file .dev.vars.sigen
```

The stack is `SigenApi`, Worker `sigen-api`, SQLite object `SigenAccountObject`, account object `private-owner`, and limiter namespace 61804. Plan can bootstrap Cloudflare state infrastructure; use the authorized account/profile. The initial service is deployed at `https://sigen-api.barroncillian.workers.dev`; deployment and acceptance evidence is recorded separately from local checks.

Device reads also send the observed `sg-pkg: sigen_app` header and `lang: en_US`. Without the package header, dynamic device reads returned application error 1000.

The client sends an explicit `meal-planner-sigen/0.1.0` User-Agent on provider requests. In live acceptance, adding this honest identifier changed hosted enrollment from an upstream HTTP 403 to success.

For enrollment, create a mode-0600 file containing `origin` (the exact HTTPS workers.dev origin returned by deployment), `operatorToken`, and `stationId`. The file contains no mySigen username or password. The operator helper asks for both interactively in the local terminal; password input is hidden. Credentials are held in process memory for the single HTTPS enrollment request and are never written to disk by the helper. Do not put credentials in command-line arguments, chat or tracked files. An uncertain enrollment must be checked with `status`; it must not be automatically retried.

```sh
node --import tsx scripts/sigen-session.ts /absolute/path/to/protected.json enroll
node --import tsx scripts/sigen-session.ts /absolute/path/to/protected.json status
node --import tsx scripts/sigen-session.ts /absolute/path/to/protected.json disconnect
```

Delete the temporary operator file after acceptance. The raw operator credential should have a separately secured recovery copy.

## Authentication acceptance alongside read coverage

1. Enroll a separate session on the deployed Worker. Read station and energy flow through the actual HTTP/MCP client and compare against mySigen.
2. Wait for three natural renewal cycles. Record each prior/new expiry, sanitized report and a successful station/telemetry read. Do not force refresh or reuse the browser chain during this check.
3. Redeploy unchanged code and verify credentials, next renewal and reads survive.
4. Verify revoked credentials produce `reauthentication_required`, then reconnect.
5. Continue implementing read coverage while the natural renewal checks run, as requested by the user. Control implementation and approval tests also proceed while renewal checks run; live physical tests still require explicit acceptance.

Physical dispatch is disabled in the deployed acceptance configuration. Disconnect disables cloud access; it does not alter physical settings. Software rollback likewise does not restore inverter/battery configuration.

## Local verification

```sh
pnpm --filter @meal-planner/sigen check
pnpm --filter @meal-planner/sigen-api check
pnpm exec vitest run packages/sigen/src apps/sigen-api/src scripts/sigen-worker-runtime.test.ts
```

The native test builds the actual Alchemy entry with the installed bundler, runs it in workerd, exercises real SDK discovery/calls and encrypted enrollment RPC, waits for three real alarms using synthetic provider expiries, then restarts the local runtime against the same SQLite storage. No cloud resources or real Sigen credentials are used by that test.

The installed SDK 1.32.1 stateless Web Standard transport matches the current Tesco/Executor compatibility boundary. Cloudflare's current [handler documentation](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/) recommends the SDK-v2 `createMcpHandler`; adopting it is deferred until tested with the actual target client. No `McpAgent` or Northbound integration is introduced.

## Executor connection

The [Executor app](../../integrations/executor/sigen/README.md) is deployed with a personal credential requirement. The user linked the account securely, and all 19 operations passed through Executor on 26 October 2026. Renewal reports now include automatic station and telemetry checks after rotation; absent checks are not evidence of success.
