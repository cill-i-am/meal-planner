# Private mySigen API and MCP

This independent Cloudflare service is the authentication milestone of the [coverage plan](../../docs/sigen/coverage.md). It is not yet the comprehensive client. The package in `packages/sigen` contains the reusable Effect 4 private EU client; this app owns encrypted sessions, HTTP/MCP and the account Durable Object. `sigen.alchemy.ts` deploys only this service. It does not share credentials or product authentication with Meal Planner or Tesco.

## Current surface

| Operation | Input | Result |
| --- | --- | --- |
| `connection_status` | `{}` | connection state, selected station, access expiry, successful renewal count |
| `get_station` | `{stationId}` | selected station metadata and explicit equipment capabilities |
| `get_energy_flow` | `{stationId}` | watts, SOC, provider/fetch timestamps and freshness |
| `get_operating_mode` | `{stationId}` | provider mode/profile IDs, preserving unfamiliar modes |

The same registry and Effect schemas define `POST /v1/<operation>`, remote `POST /mcp`, and authenticated `GET /openapi.json`. HTTP request bodies reject unknown fields and are limited to 64 KiB. Provider bodies are limited to 512 KiB; requests time out after 15 seconds. Both HTTP status and application codes must succeed. Provider messages, bodies, credentials and parser errors are never included in public failures. HTTP failures may include the numeric upstream HTTP status for diagnosis. Browser origins are refused.

All operations require the dedicated owner bearer credential, whose SHA-256 verifier is deployed. Operator credentials are separate and cannot call agent tools. `/admin/session` supports POST enrollment, GET sanitized renewal reporting, and DELETE disconnect. Those routes require the operator credential. Neither credential is a Meal Planner OAuth token.

This first private deployment binds one account and one explicitly selected station. A mismatched station is refused before provider access. A returned default station that differs from the requested station is also refused. Station enumeration and additional account mappings remain unfinished.

## Enrollment and renewal

The operator supplies a fresh username/password enrollment; the service performs the app-compatible password transformation and OAuth password grant. The password and its transformed value are never persisted. Enrollment is encrypted before native Worker-to-object RPC. Only AES-GCM encrypted access/refresh tokens survive in storage, under a dedicated stable secret. Existing browser refresh-token chains are not borrowed.

The account object serializes enrollment, disconnect, renewal and reads. It commits rotated credentials and the next alarm in one storage transaction. Renewal is scheduled from the provider's `expires_in`, one minute early. A durable refreshing marker is written before provider I/O. After an interrupted or rejected rotation, the watchdog clears the session and reports `reauthentication_required` rather than reusing a possibly consumed refresh token. Reconnect through fresh enrollment.

HTTP and MCP cancellation joins local tool cleanup. Alchemy's current native Durable Object RPC cannot transport the caller's cancellation signal into the object: cancellation ends the Worker-side wait, while an already dispatched provider read may continue until its 15-second timeout. The account object owns the session operation until it finishes.

The last five renewal results contain only timestamps and outcome categories. Three synthetic alarm renewals in workerd are separate from the required three natural renewal cycles in Cloudflare. Hosted enrollment and initial reads are verified; natural renewal is not yet verified. See the [acceptance record](../../docs/sigen/auth-acceptance.md).

## Approval policy for the control milestone

The user's correction supersedes the original plan's mandatory fresh approval for every physical change. Support **approve once** and **always approve**:

- Once authorizes the complete immutable command review, target and parameters.
- Always saves a revocable permission for the selected operation and station/device, so an agent can execute future matching commands without repeated prompts.
- Permissions still enforce supported parameters and hardware capabilities. Changed relevant state requires a fresh command preparation. No ambiguous mutation is automatically replayed, even under an always-approve permission.
- The eventual HTTP and MCP command surface must enforce the same policy, with explicit grant inspection/revocation and durable one-use command identities.

Approval grants, physical commands and their review UI are not implemented in this authentication milestone. `controls: disabled_pending_acceptance` is an explicit capability state, not an unsupported `approved: true` workaround.

## Deployment

Create independent random 32-byte owner and operator bearer credentials. Keep the owner credential in a user-scoped client account, and keep the operator credential out of agent accounts. Supply these in a protected, gitignored `.dev.vars.sigen`:

- `SIGEN_OWNER_TOKEN_SHA256`: SHA-256 of the owner credential.
- `SIGEN_OPERATOR_TOKEN_SHA256`: SHA-256 of the separate operator credential.
- `SIGEN_SESSION_ENCRYPTION_KEY`: 32 random bytes as 64 lowercase hexadecimal digits.

The encryption key must remain stable across restarts and redeployments. Back it up securely. Rotate owner/operator verifiers independently. Key replacement requires a disconnect and new enrollment; it cannot decrypt existing state.

```sh
pnpm exec alchemy plan --config sigen.alchemy.ts --stage prod --profile <profile> --env-file .dev.vars.sigen
pnpm exec alchemy deploy --config sigen.alchemy.ts --stage prod --profile <profile> --env-file .dev.vars.sigen
```

The stack is `SigenApi`, Worker `sigen-api`, SQLite object `SigenAccountObject`, account object `private-owner`, and limiter namespace 61804. Plan can bootstrap Cloudflare state infrastructure; use the authorized account/profile. The initial service is deployed at `https://sigen-api.barroncillian.workers.dev`; deployment and acceptance evidence is recorded separately from local checks.

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
5. Continue implementing read coverage while the natural renewal checks run, as requested by the user. Physical controls and grants remain a later stage with explicit acceptance.

There is no provider control route in this milestone. Disconnect disables cloud access; it does not alter physical settings. Software rollback likewise does not restore inverter/battery configuration.

## Local verification

```sh
pnpm --filter @meal-planner/sigen check
pnpm --filter @meal-planner/sigen-api check
pnpm exec vitest run packages/sigen/src apps/sigen-api/src scripts/sigen-worker-runtime.test.ts
```

The native test builds the actual Alchemy entry with the installed bundler, runs it in workerd, exercises real SDK discovery/calls and encrypted enrollment RPC, waits for three real alarms using synthetic provider expiries, then restarts the local runtime against the same SQLite storage. No cloud resources or real Sigen credentials are used by that test.

The installed SDK 1.32.1 stateless Web Standard transport matches the current Tesco/Executor compatibility boundary. Cloudflare's current [handler documentation](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/) recommends the SDK-v2 `createMcpHandler`; adopting it is deferred until tested with the actual target client. No `McpAgent` or Northbound integration is introduced.
