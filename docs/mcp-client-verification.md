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

## Production continuation after PR #309

PR #309 deployed `9e23584e520cd6682971e12beca8933553f4ea47` through
[production CI](https://github.com/cill-i-am/meal-planner/actions/runs/40121969878).
All required checks passed; an existing recipe-evaluation test timeout passed on
a single job retry. The same isolated account and OAuth client were used.

Two fresh imports passed source resolution and media acquisition. One completed
speech transcription. This verifies the startup repair against production.
Neither reached a reviewable draft:

- The first visual response lacked the required tool call. The safe diagnostic
  was `forced_tool_missing`; settlement remained unknown. The accounting gate
  marked that invocation's budget uncertain. No replacement call was dispatched.
- The second import reported a speech `outcome_unknown`. Its diagnostic sequence
  did not include a provider-dispatch event. This is not evidence of a completed
  speech call or permission to retry an ambiguously settled invocation.

Both imports exposed a second defect: terminal persistence returned a decoded
checkpoint containing an Effect `DateTime`. Cloudflare rejected it with
`DataCloneError`, leaving public progress active. The repair returns only the
validated ownership ID needed by the next domain transition. A native Workflow
regression reproduces the exact serialization error before the repair and proves
successful checkpoint replay afterward, without repeating the persistence body.
The household responses in this regression are scripted wire data, not live AI.

Both initial create responses also returned `Import state is unavailable`; a
same-key replay recovered the existing Task. The HTTP regression reproduces this
when the workflow advances between the authorized intent and timeline reads.
The adapter now rereads those snapshots at most twice when history is newer.
It never repeats admission, provider calls or mutations. Exhausted inconsistency,
malformed data and authorization failures still fail closed. Domain history
validation remains unchanged.

Reproduce the additional regressions:

```sh
pnpm --filter @meal-planner/api exec vitest run --project node \
  src/features/product-api/product-mcp-interactions.test.ts \
  src/features/imports/import-provider-terminal-authority.integration.test.ts
pnpm --filter @meal-planner/api check
```

## Remaining live verification

The two follow-up repairs still require deployment and hosted verification.
Successful draft preparation, elicitation preview/accept/decline/dismiss,
stale-version rejection and publication replay remain unverified with this real
client. Provider settlement must remain authoritative; do not reset accounting
or invent a draft to make the protocol test pass. No recipes were published. All four test imports were cancelled; the restored
client grant was revoked again, verified absent, and its local credentials cleared.

This report distinguishes the deployed startup repair, locally reproduced
follow-up fixes, and unfinished live elicitation checks. It is not a claim that
the whole hosted journey works.
