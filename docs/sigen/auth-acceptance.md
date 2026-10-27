# Sigen authentication acceptance

## Verified on 26 October 2026

The independent `SigenApi` prod stack is deployed to
`https://sigen-api.barroncillian.workers.dev`. Its `SigenAccountObject` namespace,
rate limiter and credentials are independent of Meal Planner and Tesco.

- Anonymous MCP requests return HTTP 401. Authenticated connection status returns HTTP 200.
- A fresh account login enrolled the explicitly selected station. Password input used a hidden local terminal prompt; the operator file contains only the service origin, operator credential and station ID. The service persists only encrypted access/refresh tokens.
- The same Effect client successfully authenticated and read station, energy flow and operating mode from the local Mac.
- Hosted enrollment initially failed with upstream HTTP 403. Adding the explicit `meal-planner-sigen/0.1.0` User-Agent was the only provider-request change before successful hosted enrollment. This establishes the observed compatibility fix; it does not establish a general hosting/IP prohibition or the provider's internal rejection rule.
- The real MCP SDK initialized against the deployed endpoint, discovered all four tools and successfully called each. All four HTTP routes also returned HTTP 200; station identity matched the enrolled selection. The later Executor replay verified the expanded 19-tool surface through the user-connected account; see [read acceptance](read-acceptance.md).
- The reloaded mySigen UI agreed on 20% SOC, Sigen AI mode and on-grid status. Household load changed between samples. Empty provider timestamps remain `null`, with freshness explicitly unknown.

No physical settings were changed during the initial authentication checks. The later authorized backup-reserve test is recorded in [read acceptance](read-acceptance.md). Once/always approval grants and eleven physical command variants are implemented
and fixture-tested; live dispatch remains disabled. Controls report `disabled_pending_acceptance`.

## Renewal evidence still required

The provider issued approximately 12-hour tokens (`expires_in` 43199 seconds).
The enrolled token expires at **27 October 2026, 03:18:02 UTC**; the first renewal
alarm is due about one minute earlier. Dublin is on UTC on this date. Three
natural cycles will take approximately 36 hours, with timing determined by each
returned expiry.

The service records its last five renewal outcomes and cumulative successful
renewal count. At initial acceptance the count is **0**. Synthetic workerd alarm
cycles do not establish real provider renewal. After each refresh, the service
automatically reads station metadata and energy flow with the newly persisted
access token. The operator report records the trigger, completion time and
sanitized failure reasons (null on success). Missing verification means unproven,
not success. Transient read failures retain the rotated credentials; rejected
credentials require reconnection. A pending verification has its own durable watchdog; restart resumes only the
reads with the saved access token. Check all three natural cycles in this report.

An unchanged-code forced redeployment preserved the same Durable Object namespace,
connection, access-token expiry and successful reads.

The user approved continuing read-endpoint implementation during the natural
renewal checks. The expanded surface and its evidence are tracked in [read acceptance](read-acceptance.md).

Outstanding: completion of three consecutive natural renewal cycles and
provider-revoked credentials/reconnection; progress is recorded below.

The 26 October 23:24 UTC control/tariff deployment preserved the existing session
and the 27 October 03:18:02 UTC expiry. Executor verified `connected`, zero renewals
and `disabled_pending_acceptance` after deployment. No forced rotation or fresh
enrollment was used; the scheduled natural-renewal checks remain unchanged.
Actual Executor account connection and all 19 read operations passed on 26 October
2026. Do not mark the authentication milestone complete until the remaining
checks have evidence.

### Natural renewal observations

The protected operator status was checked on **27 October 2026 at 03:25:45 UTC**
and again at **15:52:57 UTC**. The latest check reported `connected`, **2**
successful renewals and controls still `disabled_pending_acceptance`.
**Two of the three required consecutive natural cycles are verified.**

| Cycle | Trigger / result | Previous expiry (UTC) | Renewal started (UTC) | New expiry (UTC) | Read verification completed (UTC) | Station failure | Energy-flow failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `alarm` / `renewed` | 27 Oct 03:18:02.378 | 27 Oct 03:17:02.616 | 27 Oct 15:17:01.616 | 27 Oct 03:17:03.404 | `null` | `null` |
| 2 | `alarm` / `renewed` | 27 Oct 15:17:01.616 | 27 Oct 15:16:01.894 | 28 Oct 03:16:00.894 | 27 Oct 15:16:02.454 | `null` | `null` |

The first previous expiry matches the enrollment and post-deployment observations;
the second matches the first cycle's returned expiry exactly. The alarms started
59.762 and 59.722 seconds before their respective expiries, consistent with the
one-minute renewal margin. Both reads completed successfully after each renewal.
This is real hosted provider evidence, separate from the synthetic workerd tests;
the checks did not force expiry, re-enroll or change physical settings.

The next natural alarm is expected around **28 October 2026 at 03:15:00 UTC**,
based on the returned expiry. One further consecutive successful natural cycle
and the separate provider-revocation/reconnection checks remain pending. Endpoint
coverage and live control acceptance remain separate work.

## Local checks

152 focused client/service/Executor-policy tests pass, including HTTP/application failures,
shorter-lived refreshed tokens, interrupted rotation, authorization and MCP
cleanup. The native workerd test also passes: actual Alchemy bundle, real SDK,
sanitized HTTP rejection through native RPC, encrypted enrollment, three
synthetic scheduled renewals and persistence across local runtime restart.

## Scheduled follow-up

The user approved checks at 03:25 and 15:25 Europe/Dublin until three consecutive
natural renewals have successful station and energy-flow evidence. The thread
automation `verify-sigen-token-renewals` is active, with its first scheduled check
on 27 October 2026 at 03:25. It updates this record and reports only completion or
a problem requiring action, then pauses after the acceptance target is met. It
does not force expiry, re-enroll the account or change physical settings.
