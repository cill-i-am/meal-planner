# Simplify private interview state

Status: proposed
Owner: unassigned
Depends on: [working browser runtime](01-browser-runtime.md)
Delivery: remove duplicated client-state code while preserving private data and commands

## Outcome and context

Adults must still be able to start, resume, and complete discovery, review cards,
and recover interrupted commands. The browser should need less custom code to
track state and notify screens of changes. Keep private history, explicit profile
confirmation, and retries of the exact original command.

The original proposals included TanStack chat adoption. That already merged in
[#218](https://github.com/cill-i-am/meal-planner/pull/218) on September 19, 2026,
using base Agent sessions and published TanStack packages. This plan covers the
remaining client-state cleanup, not another chat migration. That merge did not
establish deployment or finish the wider discovery evaluation.

The [private-discovery reference](../../reference/private-discovery.md) describes
the current contracts.
[ADR-0004](../../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md)
records the data-ownership decision. Do not restore the old proposals' plain
session runtime or custom package patches.

## Scope

Inspect connection and session selection, pagination, cards, derived screen state,
profile refresh, and subscriptions. Keep one supported connection adapter and the
domain command/recovery interface where needed. Remove only code that still
exists and has actually been replaced.

Do not change models, providers, prompts, retries, discovery features, accounting,
storage, or LiveStore. Do not replicate transcripts or add another chat database.
Discovery still owns SDK retry behavior. This change adds no application retry or
automatic new turn.

## Approach and trade-offs

### Give each kind of data one owner

Use the following owners after the cleanup:

| Data | Owner |
| --- | --- |
| Local and derived screen controls | The compatible shared browser runtime/state setup |
| Chat display and messages arriving now | The existing published TanStack integration |
| Saved private history and message IDs | The authorized private session and its transactions |
| Confirmed profiles, versions, and saved command results | Household authority |
| Unresolved commands | Existing identity-bound storage, separate from disposable screen state |

Read the client and its consumers before extracting code. Replace listeners,
snapshots, and notification code only where the chosen library takes over. Do not
build a generic event bus or keep separate writable transcripts in atoms, Query,
and the SDK. Private or provisional cards are not confirmed Household facts.

Reuse the [browser runtime's](01-browser-runtime.md) working registry, lifetime
rules, and package choice. A Query fallback does not prove that atom bindings
work. Resolve package gaps in the shared setup, rather than adding another Effect
version or runtime. Tests using no real provider can proceed before the runtime
switch.

### Keep access checks, recovery, and saving behavior

Use supported SDK interfaces and the existing validated event mapping. Keep the
intended connection lifetime and match messages using saved server IDs. Browser
message arrays, optimistic IDs, and a completed SDK run are not proof of saved
history, access, or a Household write. Reconnection resumes or retries existing
work; it must not start another inference or give a command a new identity.

Every private payload, including buffered and replayed output, must pass the
access check immediately before the native socket sends it. No parent bridge,
transcript-returning HTTP/RPC call, or SDK sync shortcut may bypass that check.
Keep the existing schema/policy checks before saving model output. Rejected
tokens, tool arguments, and internal content must not appear on screen or in
saved history. Use current size, ordering, and cursor rules, not deleted parser
limits.

Recover saved requests only in their permitted matching context, never just
because a screen remounts under another identity. Show storage failures before
sending a command that requires saved recovery data. Disconnect, Stop, unmount,
and loss of access mean different things. Local cancellation does not prove
upstream cancellation or rollback.

Old frames and callbacks must not update a new context or clear its newer command.
Completion still waits for the Household's profile-confirmation result, including
current-version and explicit safety confirmation.

## Source and coordination

Read the client, panels, cards, and tests in
`apps/web/src/features/private-interviews/`, the contracts in
`packages/private-interview-api/`, and production code and tests in
`apps/api/src/features/private-output/`. Include saving, access, reconnection, and
confirmation. Trace the published adapter used after #218, rather than building
one from an old example.

Coordinate profile schemas, forms, shared registry, and lockfile edits with the
[browser runtime](01-browser-runtime.md) and [form work](03-forms-and-json.md).

## Acceptance

- [ ] The actual React/client integration supports start, rediscover, history
  pagination, resume, and completed read-only history. Preserve server ordering,
  cursor limits, and participant identity. Optimistic IDs do not replace saved IDs.
- [ ] Mount, unmount, remount, and two consumers create only the intended connections
  and submissions, with no leaked listeners, fibers, or second writable transcript.
- [ ] Lose a reply after a participant message is saved, an assistant reply is
  accepted, or a profile is confirmed. After restart/reconnect, the original
  payload, ID, and versions produce one result. Recovery must not trust re-sent
  browser history, regenerate a turn, duplicate a record, or add an application
  retry. Keep the installed SDK's retry and accounting behavior; do not falsely
  describe it as single-attempt.
- [ ] A delayed or unknown confirmation result is neither failure nor success.
  Completion waits for the Household's saved result. An SDK terminal event cannot
  settle Household state or clear a newer saved command.
- [ ] Correction, rejection, refreshed review, provisional facts, and reduced safety
  constraints require the existing explicit consent for the current version.
  Changing kind, target, or card revision cannot reuse old consent or turn a
  private proposal into a shared fact.
- [ ] The real access checks deny another participant, adult, or household access
  to the directory, session, history, output, and recovery. Keep private values out
  of shared caches, unintended server-rendered/hydrated output, and telemetry.
- [ ] Pause buffered output before physical send. Revoke access by sign-out, passive
  expiry, departure, or unlink, then release the output. Production native classes
  must send no private bytes after access closes. Repeat relevant restart and
  renewed-access cases; a mocked socket does not prove the check happens beside send.
- [ ] Account, household, or session changes hide old private UI. Late callbacks and
  queued events cannot fill the new context with old data, including after remount
  or while a newer command is pending.
- [ ] Malformed, oversized, unexpected, and interrupted events follow the current
  contract. Rejected output reaches neither display nor storage. Do not add repair,
  hidden success, another transcript route, or invented token streaming to fit a
  library helper.
- [ ] Report unavailable browser recovery storage before sending a command that
  needs it. Stop, disconnect, and unmount release their resources without dropping
  permitted recovery or claiming upstream cancellation/rollback. Late model results
  cannot commit after the application has reached its terminal state.
- [ ] Installed SDK/React types, production web/Worker bundles, and affected contract
  tests pass. List the generic code removed and the native access checks, domain
  commands, saved history, and saved command results retained.

### Evidence and limits

Use synthetic fixtures in a real browser and production classes on the pinned
workerd/Miniflare runtime. Check visible behavior and saved state, especially the
buffered-send race, lost replies, saved requests, and profile confirmation.
Component mocks can help but do not prove native access checks or durable recovery.

Find exact suites and commands in current manifests, CI, and the
[local development guide](../../how-to/local-development.md). Record tested commits,
fixtures, and results without customer transcripts, tokens, or private evidence.
#218 provides the starting point, not a passing result for this changed client.
Synthetic providers test integration, not model quality, final provider usage, or
the unfinished family/candidate evaluation.

## Delivery and open questions

Start with the post-#218 client, test its existing behavior, and identify remaining
custom state code that the working shared runtime can replace. Finish consumer
changes, deletions, and browser/native checks. A package mismatch blocks the switch
that depends on it, not independent tests. Record the exact failing interface or
fixture here.

Use synthetic providers with a real browser and the production classes on
workerd/Miniflare. Include access loss after buffering but before sending. Run
relevant contract and confirmation tests, builds, and required repository checks.
Record tested commits, removed and retained code, and unfinished acceptance here.
Update the private-discovery reference with reusable knowledge.

These checks do not finish the separate
[discovery evaluation and tone work](../private-discovery/03-adaptive-discovery-and-evaluation.md).
A rollback reverts this state change, not saved history or #218.

## Original proposals

This plan replaces the overlapping September 16 proposals, based on
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. Their assumptions that #218 was still
open, old migration steps, and permission links are historical. The
[review sequence](README.md) keeps the approach and detailed checks in this one
record. No remaining client cleanup or runtime verification is claimed here.

- [Original #221 proposal](https://github.com/cill-i-am/meal-planner/blob/5f2c027701de565d7763041e72c69396d3f2d082/docs/delivery/library-consolidation/02-private-interview-client-and-streaming.md).
- [Original #222 proposal](https://github.com/cill-i-am/meal-planner/blob/027c4b66c19e67a4512fd30334d8471fe063456f/docs/delivery/library-consolidation/02-private-interview-state-and-streaming.md).
