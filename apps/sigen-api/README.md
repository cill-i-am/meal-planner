# Private mySigen API and MCP

This independent Cloudflare service exposes 47 HTTP/MCP operations and 21 typed setting-change families from the [coverage matrix](../../docs/sigen/coverage.md). It includes station/profile/template inspection, equipment and smart-load summaries, preheating, diagnostics, history and approval controls. Charger/V2X adapters, industrial/grouped profiles and further schedule/settings families remain incomplete; the matrix lists the evidence needed. `packages/sigen` contains the reusable Effect 4 EU private client; this app owns encrypted sessions and the account Durable Object. `sigen.alchemy.ts` deploys only this service, with independent credentials.

## Current surface

| Operation | Input | Result |
| --- | --- | --- |
| `connection_status` | `{}` | connection state, selected station, access expiry, successful renewal count |
| `list_stations` | `{stationId}` | owner station inventory; only the enrolled station remains authorized |
| `get_station_capabilities` | `{stationId}` | hardware/backup capability flags |
| `list_profile_templates` | `{stationId}` | provider templates and mode/profile identity |
| `get_energy_profile` | `{stationId,target}` | current, custom or template profile; target is `{kind:"current"}`, `{kind:"custom",profileId}`, or `{kind:"template",profileId,providerMode}` |
| `get_solar_priority` | `{stationId}` | ordered entries with bounded group paths and provider codes |
| `list_smart_loads` | `{stationId}` | configured load inventory |
| `get_smart_load` | `{stationId,loadPath}` | identity-checked switch/mode state summary, excluding schedules |
| `get_load_capabilities` | `{stationId}` | port support versus installed equipment |
| `get_system_cards`, `list_third_party_devices` | `{stationId}` | display cards, explicit placeholders and telemetry availability |
| `get_preheating_settings` | `{stationId}` | raw provider configuration; provider values preserved; residential slot units are minutes and weekdays 1–7 |
| `list_aio_devices`, `get_aio_power_status` | `{stationId}` / `{stationId,serialNumber}` | topology-verified AIO inventory and separate power observations |
| `get_automation_settings`, `get_station_income` | `{stationId}` / `{stationId,date}` | current automation groups / daily income |
| `get_station` | `{stationId}` | selected station metadata and explicit equipment capabilities |
| `get_energy_flow` | `{stationId}` | watts, SOC, provider/fetch timestamps and freshness |
| `get_operating_mode` | `{stationId}` | provider mode/profile IDs, preserving unfamiliar modes |
| `list_backup_events` | `{stationId,startDate,endDate,page}` | fixed ten-event pages; inclusive local dates spanning ≤31 days; diagnostic display values, provider codes and second-precision UTC candidates |
| `get_energy_capabilities` | `{stationId}` | app-reported profile feature flags, source options and EMS-upgrade support; does not authorize or perform upgrades |
| `get_battery_discharge_priority` | `{stationId}` | ordered provider source codes; no priority changes or power-flow inference |
| `get_backup_history` | `{stationId,page,pageSize}` | off-grid events, second-precision local timestamps with UTC candidates, durations and page duration in seconds, full-history event counts; page 1–1000, size 1–100 |
| `get_energy_saving_settings` | `{stationId}` | off-grid enable flag and uninterpreted provider mode/value codes |
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

This first private deployment binds one account and one explicitly selected station. A mismatched station is refused before provider access. A returned default station that differs from the requested station is also refused. Station enumeration is implemented; additional account/station authorization mappings remain unfinished.

History dates are calendar dates in the provider station timezone. Weeks begin Monday; month/year ranges use inclusive calendar boundaries. Day charts contain power, longer periods contain energy. Missing samples are not filled. Repeated DST minutes retain both UTC candidates; nonexistent local minutes retain none. Unknown series retain raw values with unknown units. Provider chart signs are preserved, and differ from live battery-flow signs. Empty forecasts return `availability: no_data`.

Display labels are not stable metric keys. Empty settings are unset; the provider power sentinel `4294967.295` kW is unlimited. An inactive override stays inactive even if it retains a historical mode/end time. Hardware and station membership are verified before requesting device details. The Durable Object persists a shared 30-provider-request rolling-minute budget with 400 ms minimum spacing across auth, reads and controls. Reservations survive restart/interruption; provider 429 responses honor Retry-After with at least a minute cooldown. The separate edge admission limit remains 30 calls/minute. No cache is implemented.

## Enrollment and renewal

The operator supplies a fresh username/password enrollment; the service performs the app-compatible password transformation and OAuth password grant. The password and its transformed value are never persisted. Enrollment is encrypted before native Worker-to-object RPC. Only AES-GCM encrypted access/refresh tokens survive in storage, under a dedicated stable secret. Existing browser refresh-token chains are not borrowed.

The account object serializes enrollment, disconnect, renewal and reads. It commits rotated credentials and the next alarm in one storage transaction. Renewal is scheduled from the provider's `expires_in`, one minute early. A durable refreshing marker is written before provider I/O. A locally rejected request that never reached transport restores the valid session and schedules another attempt. After an interrupted or rejected dispatched rotation, the watchdog clears the session and reports `reauthentication_required` rather than reusing a possibly consumed refresh token. Reconnect through fresh enrollment.

HTTP and MCP cancellation joins local tool cleanup. Alchemy's current native Durable Object RPC cannot transport the caller's cancellation signal into the object: cancellation ends the Worker-side wait, while an already dispatched provider read may continue until its 15-second timeout. The account object owns the session operation until it finishes.

Read acceptance is recorded in [read verification](../../docs/sigen/read-acceptance.md).

The last five renewal results contain only timestamps and outcome categories. Three synthetic alarm renewals in workerd are separate from the required three natural renewal cycles in Cloudflare. Hosted enrollment and initial reads are verified; all three required natural renewal cycles are verified. See the [acceptance record](../../docs/sigen/auth-acceptance.md).

## Approve once and always approve

The owner service credential can prepare, approve and execute commands through HTTP or MCP. Executor asks for confirmation on `approve_command` with the immutable before/after values and once/always choice. The [control matrix](../../docs/sigen/coverage.md#approval-and-control-surface) lists all 21 change families and exact constraints.

Operating-mode changes support currently available 0/1/5 and enumerated custom mode 9. Custom-profile configuration is included in the review and conflict fingerprint; TOU/Remote EMS modes remain excluded. Solar priority writes require exact known flat membership and preserve excluded-source priorities. Battery priority writes require supported source permutations. Smart-load switching requires current identity and manual mode; its grant binds the load key and path.

SOC changes require all four current values. Peak-shaving edits validate new windows, weekday codes, overlap and station timezone. Legacy opaque windows may only be retained unchanged. Manual stop has authoritative enabled-state readback. Manual start accepts charge/discharge/hold/self-consumption and 30–120 minutes, but its read API omits requested duration/power: an accepted start remains `outcome_unknown`, never falsely verified or automatically replayed.

Profile reads cover current, enumerated custom and template configuration. Commands support inactive template creation, custom metadata/automation edits, inactive deletion and bounded schedule replacement; see the [profile contracts](../../docs/sigen/profile-schedules.md).

Daily income reads retain provider-reported totals, signed income and calculated income separately, in the station currency. These values are not independently verified bill settlements; missing samples and ambiguous local times remain explicit. AIO reads check serial membership and keep the two provider power-state observations separate.

Preparation saves the complete normalized settings and proposed values for five minutes. Copy `change`, `current` and `reviewFingerprint` exactly into approval. Once approves that command. Always permits future validated parameters for the same operation and station/device/profile, until revoked; it is not limited to today's values. Fresh preparation still rechecks state. Revoking a grant also invalidates queued commands that use it. Reenrollment creates a new connection identity, invalidating unused approvals and grants. Saved command IDs and attempt receipts survive so uncertain outcomes can be reconciled when the same station is connected again.

Execution rechecks current settings and validation under the session lock, then saves a dispatch marker before the single provider mutation. Duplicate command IDs return the saved record; altered inputs conflict. Interrupted, timed-out and ambiguous attempts are never resent. Repeated execution reconciles only through reads. `verified` means the desired settings were observed, not proof that this request caused them. Provider rejection, acceptance, verification and unknown outcome remain distinct.

`SIGEN_CONTROLS_ENABLED` defaults to `false`. Dispatch also requires the operation to appear in `SIGEN_ENABLED_OPERATIONS`, a comma-separated list of exact operation names that defaults to empty. Unknown or duplicate entries fail configuration validation. Connection status reports the effective `enabledOperations`; a false master switch produces an empty list. Preparation, approval, inspection and read-only reconciliation remain available for disabled operations. The same policy covers HTTP and MCP.

All 21 families are fixture-tested. Backup reserve passed the earlier authorized live 20% → 21% → 20% test through Executor. Current live acceptance and its exact limits are recorded in [the acceptance procedure](../../docs/sigen/live-control-acceptance.md). Enabling a family does not bypass once/always approval, five-minute review expiry, fresh conflict checks or single-dispatch receipts. Only tested families should be configured for production.

The durable command book refuses new preparations after 256 saved records; it never silently deletes replay protection. Operational archival is a future extension.

## Deployment

Create independent random 32-byte owner and operator bearer credentials. Keep the owner credential in a user-scoped client account, and keep the operator credential out of agent accounts. Supply these in a protected, gitignored `.dev.vars.sigen`:

- `SIGEN_OWNER_TOKEN_SHA256`: SHA-256 of the owner credential.
- `SIGEN_OPERATOR_TOKEN_SHA256`: SHA-256 of the separate operator credential.
- `SIGEN_SESSION_ENCRYPTION_KEY`: 32 random bytes as 64 lowercase hexadecimal digits.
- `SIGEN_CONTROLS_ENABLED`: master dispatch boolean, default `false`; changing it does not itself change equipment.
- `SIGEN_ENABLED_OPERATIONS`: exact comma-separated operation names permitted to dispatch when the master switch is true; default empty.

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
