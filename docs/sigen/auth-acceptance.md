# Sigen authentication acceptance

## Verified on 26 October 2026

The independent `SigenApi` prod stack is deployed to
`https://sigen-api.barroncillian.workers.dev`. Its `SigenAccountObject` namespace,
rate limiter and credentials are independent of Meal Planner and Tesco.

- Anonymous MCP requests return HTTP 401. Authenticated connection status returns HTTP 200.
- A fresh account login enrolled the explicitly selected station. Password input used a hidden local terminal prompt; the operator file contains only the service origin, operator credential and station ID. The service persists only encrypted access/refresh tokens.
- The same Effect client successfully authenticated and read station, energy flow and operating mode from the local Mac.
- Hosted enrollment initially failed with upstream HTTP 403. Adding the explicit `meal-planner-sigen/0.1.0` User-Agent was the only provider-request change before successful hosted enrollment. This establishes the observed compatibility fix; it does not establish a general hosting/IP prohibition or the provider's internal rejection rule.
- The real MCP SDK initialized against the deployed endpoint, discovered all four tools and successfully called each. All four HTTP routes also returned HTTP 200; station identity matched the enrolled selection. Executor installation/acceptance is still pending.
- The reloaded mySigen UI agreed on 20% SOC, Sigen AI mode and on-grid status. Household load changed between samples. Empty provider timestamps remain `null`, with freshness explicitly unknown.

No physical settings were changed. Once/always approval grants and physical
commands remain unimplemented; controls report `disabled_pending_acceptance`.

## Renewal evidence still required

The provider issued approximately 12-hour tokens (`expires_in` 43199 seconds).
The enrolled token expires at **27 October 2026, 03:18:02 UTC**; the first renewal
alarm is due about one minute earlier. Dublin is on UTC on this date. Three
natural cycles will take approximately 36 hours, with timing determined by each
returned expiry.

The service records its last five renewal outcomes and cumulative successful
renewal count. At initial acceptance the count is **0**. Synthetic workerd alarm
cycles do not establish real provider renewal. After each natural renewal, check
sanitized operator status and a successful station/telemetry read.

An unchanged-code forced redeployment preserved the same Durable Object namespace,
connection, access-token expiry and successful reads.

The user approved continuing read-endpoint implementation during the natural
renewal checks. The expanded surface and its evidence are tracked in [read acceptance](read-acceptance.md).

Outstanding: three natural renewal cycles, provider-revoked
credentials/reconnection, and actual target-client
integration. Do not mark the authentication milestone complete until those
checks have evidence.

## Local checks

81 focused client/service tests pass, including HTTP/application failures,
shorter-lived refreshed tokens, interrupted rotation, authorization and MCP
cleanup. The native workerd test also passes: actual Alchemy bundle, real SDK,
sanitized HTTP rejection through native RPC, encrypted enrollment, three
synthetic scheduled renewals and persistence across local runtime restart.
