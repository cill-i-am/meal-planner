# Work Item 04 — Private Interview-Session Boundary

- Status: Done — boundary evidence accepted; implementation deferred to Stage 2
- Stage: [Stage 1 — Household people, profiles, and permissions](README.md)
- Owner: `codex/stage1-private-interview-boundary`
- Pull request: [#204](https://github.com/cill-i-am/meal-planner/pull/204) (merged 2026-09-05)
- Completed by: `5d629f0f3e1e9e7c2006d2b7a0c14fd235015013`
- Promotion condition: accept cumulative Stage 1 exit proof, then promote one bounded Stage 2
  integration work item; no Stage 1 grant prerequisite was identified

## Household outcome

Define who may begin a private self-interview, who may access it, what remains
private, and how a confirmed fact crosses into household authority. Do not add
conversation state to HouseholdObject merely to prepare for Stage 2.

## Accepted direction

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0005 — MVP scope and deferrals](../../../decisions/product/0005-mvp-scope-and-deferrals.md)
- [PDR 0007 — Household agent conversations and visibility](../../../decisions/product/0007-household-agent-conversations-and-visibility.md)
- [ADR 0004 — Household agent coordinator and isolated chat agents](../../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md)

Work Item 03 merged in PR #202 as
`b509ba53ce1ac1326e86a9e826bdf58cbb0e7856` on 2026-09-05.
The [exact-version SDK evidence](04-agents-boundary-evidence.md) exercises
`agents@0.22.0` with the repository-pinned Miniflare/workerd runtime.

## Boundary disposition

Accepted: **no Stage 1 Household grant, session table, API, or UI**. The SDK
supports isolated Agent-owned participant/lifecycle metadata and restart without
Household persistence. Fresh membership and person linkage come from existing
authorities, not a grant. The earlier conditional Household grant was a planning
hypothesis; it is not a Ready implementation assignment.

This is a runtime-backed recommendation, not proof that product chat is ready.
The probe uses synthetic authority data. Real Better Auth/Household admission,
Alchemy bundle composition, and passive/in-flight connection revocation remain
explicit [Stage 2 gates](04-agents-boundary-evidence.md#smallest-stage-2-handoff).
No blocker found in this probe justifies introducing a second grant lifecycle.

## Future user-visible vertical

An admitted active adult begins a private interview about their own linked
person. They receive an opaque session identity, return to that same session,
and later read completed history privately. Another adult—even in the same
household—cannot discover or access it.

A proposal is private, unconfirmed data. Only a separately admitted profile
command after participant review creates household-visible product state.
Actual interview behaviour, messages, transcripts, streaming, and models belong
to later Stage 2 slices, not this docs/evidence PR.

## Identity, privacy, and authority

- Better Auth supplies immutable user identity and current organization
  membership. The household-scoped linkage subject is distinct from audit actor.
- HouseholdObject owns the active adult/person link and confirmed profile state.
  It remains the sole writer of profile versions, audit, and mutation receipts.
- The isolated Agent owns immutable household/participant/person binding,
  session identity, and conversation lifecycle. A copied opaque reference is not
  a bearer credential. Never derive authority from email, session ID, audit
  correlation, or whichever member first opens an Agent.
- Reauthorize current membership and the exact active link on access and before
  private output. A saved participant snapshot is only a comparison target.
  Person-link repair cannot silently retarget an old session.
- Other adults receive no session list, activity projection, transcript API, or
  parent operation that reads a private child's history.
- Private messages, transcript excerpts, prompts, model output, and unconfirmed
  proposal text never enter Household SQLite, profile audit, or household-visible
  projections. Support access and deletion have separate accepted policies.

## Lifecycle and consistency contract

The future Agent lifecycle distinguishes these meanings:

```text
absent -> open -> completed (retained, private, read-only)
           \-> revoked (access denied; not deletion)
```

Completion ends interview mutation but preserves read-only access for the
currently authorized participant. Revocation denies access without silently
deleting history. Neither permits reopening. Departure, unlink, or person
archival denies access regardless of stored session state.

Agent creation and lifecycle operations need stable mutation IDs, payload
collision checks, monotonic versions, exact replay, and restart persistence.
Concurrent completion/revocation must not reopen a session. A lost creation
response must resolve the same session, not allocate another. These are Stage 2
requirements; the metadata probe is not a complete implementation of them.

There is no cross-database transaction. Auth/member reads, Household admission,
Agent state, and profile confirmation remain distinct boundaries. No Agent,
network, or provider call enters a Household SQLite transaction. Stage 2 must
define the race between authority changes and in-flight private output; an
initial connect check or unbounded revocation delay does not satisfy it.

## Profile proposal boundary

Use current ordinary profile commands, expected versions, and replay semantics.
Self-confirmation must use the linked person's identity; hard-constraint removal
or weakening still requires the separate explicit confirmation operation.
Concurrent edits return the normal stale-version result instead of silently
rebasing a proposal.

Work Item 03 supports only `manual_ui` provenance. A future confirmation slice
must add and test a narrowly typed interview-proposal provenance value; do not
mislabel an Agent proposal or add that unused variant now. Only the confirmed
closed fact and privacy-safe provenance cross into product authority.

## Scope and minimum surfaces

This assignment contains evidence, delivery-state corrections, and a bounded
handoff only. It changes no application, schema, dependency, infrastructure,
provider, deployment, or cloud state. It adds no public/Household API or UI.

The next proposed integration slice is participant-only Agent admission and
lifecycle metadata using real product authority. Keep conversation content,
chat UI, streaming, model/provider selection, tools, Agents orchestration,
evals, shared chat, dependant interviews, support grants, household deletion,
routines, planning, recipes, shopping, and compatibility machinery out of that
first slice.

## Evidence and remaining review gates

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

## Review risk and assignment

Privacy/authority implementation is high risk and requires independent
exact-head review. This docs-only investigation still requires review of source
fidelity, evidence limits, and the handoff. Green SDK tests do not override
unproven product integration.

Use the exact bounded
[Stage 2 handoff](04-agents-boundary-evidence.md#smallest-stage-2-handoff)
after accepting the cumulative Stage 1 exit proof. Do not assign the whole AI roadmap.

## Delivery log

- 2026-08-27 — Proposed a conditional Stage 1 prerequisite, dependent on Work
  Item 03 and the exact-version SDK spike.
- 2026-09-05 — Work Item 03 merged. The provider-free SDK spike supports moving
  interview implementation intact to Stage 2 without a Household grant.
  Boundary disposition is in review; no production conversation code landed.
- 2026-09-05 — PR #204 merged as
  `5d629f0f3e1e9e7c2006d2b7a0c14fd235015013`. Independent content and exact-head
  review accepted `2d607a77a509fec64047678add31fdab02053eea`; both hosted checks
  passed in [run 33974785385](https://github.com/cill-i-am/meal-planner/actions/runs/33974785385).
  Boundary evidence is Done. Synthetic SDK metadata/restart proof does not
  establish production auth, Alchemy composition, or continuing revocation;
  those remain Stage 2 gates. Cumulative exit proof is Work Item 05.
