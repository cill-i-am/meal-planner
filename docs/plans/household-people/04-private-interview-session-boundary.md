# Private session boundary evidence

Status: done
Owner: historical delivery in PR #204

## Outcome

Define who may begin a private self-interview, who may access it, what remains
private, and how a confirmed fact crosses into household authority. Do not add
conversation state to HouseholdObject merely to prepare for Stage 2.

Completion is boundary evidence only, not conversation implementation. The native
selection subsequently changed; use the current private-discovery reference.

## Acceptance preserved

These are the checks recorded when this work was completed, not new workflow
steps. For a new assignment, read the current contracts.

- [x] Selected SDK release executes real Agent and isolated sub-agent APIs on the
      pinned local runtime. No runtime upgrade or private API shim was required.
- [x] Synthetic-authority probe covers same-household other-adult denial,
      cross-household denial, known-reference non-authority, client state-write
      rejection, active-message departure closure, reconnect denial, unlink denial,
      completion, and persisted metadata after a full local runtime restart.
- [x] Actual auth/link/profile code is mapped separately from SDK probe claims.
- [ ] Real Better Auth + Household + Agent composition proves the same admission
      and identity boundaries, including authority failure and concurrent changes.
- [ ] Every enabled protocol and passive/in-flight output path proves continuing
      revocation. The SDK intercepts state-sync/RPC before custom onMessage.
- [ ] Session creation/lifecycle replay, collision, stale version, concurrency,
      and lost-response behaviour are proven in the production composition.
- [ ] Actual proposal confirmation proves current authorization, versions,
      safety, and closed privacy-safe provenance without transcript injection.
- [x] This docs-only PR passes formatting/link/diff checks and hosted CI; its
      exact-head review records the boundary disposition.
- [x] The orchestrator accepted the cumulative Stage 1 exit evidence in
      [Work Item 05](05-cumulative-exit-proof.md), completed by merged PR #205.

Unchecked integration items belong to the proposed Stage 2 slices. They are not
permission to mark a grant implementation Ready, nor evidence that a Household
grant is needed.

## Delivery evidence

Delivered by [PR #204](https://github.com/cill-i-am/meal-planner/pull/204).
The [original complete record](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/01-household-people/04-private-interview-session-boundary.md) keeps the tested commits, checks, decisions, findings, and limits. The docs refactor
did not rerun those tests or change what they proved. This completed record does
not assign new work.

Use [current household contracts](../../reference/household.md) and
[private-discovery contracts](../../reference/private-discovery.md)
for new changes rather than following the old implementation diary.
