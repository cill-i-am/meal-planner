# Authenticated MCP client verification

## Environment and scope

24 October 2026. Official MCP Inspector **2.12.0**, web UI and its `mcpdo`
CLI, using protocol **2026-07-28** against `https://ceird.app/mcp` at
`d8f00e04d027c1f2337a4c830130e7b6a8a2f959`. A newly registered account and
family isolated every mutation from existing families. Credentials, raw client
state and opaque task identifiers are private local artifacts, excluded here.

## Observed with the hosted server

- Browser OAuth dynamic registration, PKCE, consent denial and consent acceptance.
- Read/write access and refresh credentials issued; refresh exchange **not tested**.
- Discovery of 53 tools, the Tasks extension and form elicitation capability.
- Family creation, two asynchronous import Tasks, polling and reconnect using the
  same OAuth client.
- Cancellation and terminal replay: repeated cancellation preserved status and
  timestamp. Terminal `tasks/update` acknowledged an unused response.
- Server-side consent revocation, verified absent afterward. A subsequent client
  read required fresh consent, which was denied.

These observations establish this Inspector's behavior, not compatibility with
ChatGPT, Claude, Cursor or Durable Pi. Capability negotiation alone does not
establish successful elicitation.

## Failure found

Both imports remained at public intent version 1 (`resolving_source`). They were
cancelled after 194 and 210 seconds. Read-only Cloudflare diagnostics showed both
workflows errored within seconds, with **no durable steps recorded**. The only
household startup call was `readRecipeImportExecution`.

That query requires a resolved canonical source. Workflow startup called it to
obtain the submitted URL *before* resolving the source: a circular precondition.
The new native Worker/SQLite regression reproduced `HouseholdRecipeImportFailure`
with `reason: illegal_transition` before changing that read.

The repair introduces an internal, lifecycle-authorized submission query. It
requires the current execution generation and a processing intent, and exposes
only the submitted URL. Source preparation uses it before resolution. The
resolved execution query retains its stricter recovery invariants. Existing
workflow step names, mutation identities, evidence, provider accounting and
publication authority are preserved.

The same production preparation operation is exercised through native household
RPC in the regression, including replay, stale generation, cancellation, original
trace persistence and rejection of an unauthorized system purpose.

## Reproduce locally

Use the repository's pinned Node and pnpm versions, then:

```sh
pnpm --filter @meal-planner/api exec vitest run --project node \
  src/features/households/household-boundary.integration.test.ts \
  -t 'starts source resolution from an unresolved admitted import'
pnpm --filter @meal-planner/api check
```

This is a native runtime/database regression, **not a live provider evaluation**.
The canonical test source needs no network fetch and no provider call.

## Repeat the hosted-client checks

Install `@modelcontextprotocol/inspector@2.12.0`. Use a private catalog and
credential directory, the encrypted file secret store, localhost binding and
Inspector authentication. Configure the HTTP connection with `protocolEra:
modern`, `elicitCapability: form` and OAuth scopes `meal-planner:read
meal-planner:write offline_access`. Complete normal browser login and consent
with an isolated test account.

Create a family through `families_create`, then use its returned `familyId` in
`recipe_import_intents_create`, with a stable idempotency key and public TikTok
source. Record the returned Task ID privately. With the same client store:

```sh
mcpdo --stored-auth-only connect meal-planner-live
mcpdo @meal-planner-live tools/list
mcpdo @meal-planner-live tasks/get "$TASK_ID"
mcpdo disconnect meal-planner-live
mcpdo --stored-auth-only connect meal-planner-live
mcpdo @meal-planner-live tasks/get "$TASK_ID"
mcpdo @meal-planner-live tasks/cancel "$TASK_ID"
mcpdo @meal-planner-live tasks/get "$TASK_ID"
```

Inspect the import and its current review action before attempting confirmation.
Test decline, dismissal and acceptance separately, and check domain state after
each response. Check stale-version rejection and receipt replay explicitly.

Inspector 2.12.0 `disconnect --clear-auth` clears local credentials only. Revoke
the specific test client's consent through Meal Planner's native OAuth API and
verify absence before clearing local credentials. Do not publish secrets or
opaque continuation tokens with test evidence.

## Remaining live verification

The startup repair has not yet been exercised on a deployed revision. Successful
draft preparation, elicitation preview/accept/decline/dismiss, stale-version
rejection and publication replay remain unverified with this real client. No
recipes were published during the initial hosted run. The two test imports are
cancelled and the original client grant is revoked.
