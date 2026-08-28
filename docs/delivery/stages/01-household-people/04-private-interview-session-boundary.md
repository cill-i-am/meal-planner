# Work Item 04 — Private Interview-Session Boundary

- Status: Proposed
- Stage: [Stage 1 — Household people, profiles, and permissions](README.md)
- Owner: Unassigned
- Pull request: Not opened
- Completed by: Not completed
- Promotion condition: Work Item 03 is merged and the accepted exact-version
  Cloudflare Agents SDK spike identifies a Stage 1 prerequisite

## Household Outcome

The product has a truthful contract for who may start a private profile
interview, whom it concerns, who may participate, what remains private, and how
confirmed profile commands cross into household authority. No conversation
runtime or transcript is incorrectly made household-visible merely to prepare
for Stage 2.

## Accepted Direction

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0005 — MVP scope and deferrals](../../../decisions/product/0005-mvp-scope-and-deferrals.md)
- [PDR 0007 — Household agent conversations and visibility](../../../decisions/product/0007-household-agent-conversations-and-visibility.md)
- [ADR 0004 — Household agent coordinator and isolated chat agents](../../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md)
- [Stage 1 interview ownership recommendation](README.md)

## User-Visible Vertical

An admitted adult can request a private interview concerning their own linked
person and receive an opaque session reference governed by an explicit access
and lifecycle contract. The session may later propose closed profile commands;
only commands confirmed and admitted through the ordinary profile API become
household-visible. Other household adults cannot read private transcript or
message content.

This vertical should be implemented in Stage 1 only if the exact-version spike
proves that a household-issued grant or reference must pre-exist the Agent
runtime. Otherwise this record defines the prerequisite and implementation
moves intact to Stage 2.

## Scope

### In scope

- the exact-version Cloudflare Agents SDK spike required by ADR 0004;
- admitted participant, subject-person, household, privacy, and lifecycle
  contracts for a private interview;
- a minimum opaque session/grant reference only if the spike proves it is a
  prerequisite for secure later Agent Durable Object creation;
- authorization rules for beginning, reading lifecycle state, closing, and
  revoking such a session;
- the typed boundary from private-session proposals to ordinary Work Item 03
  profile commands; and
- privacy, replay, restart, and cross-household tests for any Stage 1 state that
  is actually introduced.

### Out of scope

- model or provider selection, prompts, interview behaviour, orchestration,
  inference, evaluation, or quality scoring;
- Agent Durable Object implementation, message/transcript persistence,
  streaming, resumable chat, WebSocket/UI chat, or runtime scheduling;
- raw transcript, chat message, prompt, model response, or private proposal text
  in `HouseholdObject`, profile projections, or household audit;
- interviews about another adult under the MVP self-interview policy;
- dependant interview assistance, shared-agent conversation, routines,
  planning, recipes, or shopping; and
- compatibility storage, shared household D1, dual writes, or provider/cloud
  mutation in this planning assignment.

## Product Commands And Queries

If the spike proves a household-issued grant is required, the minimum product
surface is equivalent to:

- `CreatePrivateInterviewGrant(mutationId, subjectPersonId,
  expectedProfileVersion)` for the admitted adult's own linked person;
- `ClosePrivateInterviewGrant(mutationId, grantId, expectedGrantVersion)`;
- `RevokePrivateInterviewGrant(...)` for the participant or an authorized
  privacy/incident path; and
- `GetPrivateInterviewGrant(grantId)` returning participant-only lifecycle and
  opaque Agent reference, never messages or transcript.

A future Agent session submits a typed profile proposal to the participant. The
participant confirms it through Work Item 03's ordinary profile command with
the current expected profile version. The grant or Agent runtime cannot write
profile state directly.

If the spike shows that Agent authority can securely derive and validate all of
this without household persistence, do not create these commands or tables in
Stage 1. Record the verified contract and defer implementation to Stage 2.

## States, Transitions, And Invariants

For any minimal grant introduced:

```text
absent -> open -> closed
             \-> revoked
```

- Participant is the admitted adult and subject is that adult's linked person.
- Household, participant, and subject identities are immutable for the grant.
- An opaque session/grant reference is not a transcript locator visible to
  other household members.
- Closed/revoked grants cannot authorize new Agent access or proposals.
- A proposal is not product state. Only a newly authorized, validated profile
  command creates a profile version.
- Profile-command authorization is evaluated at confirmation time; an old
  session cannot bypass current membership, person link, lifecycle, profile
  version, or safety confirmation.
- `HouseholdObject` never imports Agent SDK runtime types and the Agent object
  never becomes canonical profile authority.

## Versioning And Projections

Any grant has a stable opaque ID and monotonic lifecycle version. Its private
projection contains only household/subject/participant binding, lifecycle,
created/closed time, and the minimum opaque Agent reference proven necessary by
the spike. The normal household roster/profile projections reveal neither grant
existence nor private session activity to other adults.

Profile versions and audit may record a closed source class such as
`private_interview_proposal` after the participant confirms a command. They must
not record session messages, transcript excerpts, hidden proposal content,
prompts, or model output.

## Authority, Transaction, And Privacy

- `HouseholdObject` owns confirmed household product state and, only if required,
  a minimal access grant. It does not own conversation content or runtime state.
- An isolated Agent Durable Object owns future messages, transcripts, streaming,
  and conversation lifecycle under ADR 0004.
- Better Auth membership and the current account-person link are verified before
  grant routing. Only the participant may read or close the private grant.
- Grant mutation, version, audit-safe lifecycle event, and receipt commit in one
  local household transaction. Agent creation or calls occur post-commit and
  reconcile explicitly; no network/provider call enters SQLite transaction.
- Conversation-to-profile crossing uses the existing public/household profile
  command boundary and current authorization, not a privileged database path.

## Failure, Replay, And Concurrency

- Identical grant create/close/revoke replay returns the committed result;
  mutation-ID reuse with different subject/participant/lifecycle conflicts.
- Stale grant or profile versions make no change.
- Concurrent close/revoke has one winner and one stale/closed result.
- Membership removal, person unlink/archive, or privacy revocation invalidates
  access before a later proposal can become product state.
- Agent creation response loss reconciles by exact opaque identity; it must not
  create a second private conversation or grant.
- Profile confirmation racing with another edit follows Work Item 03's
  optimistic concurrency and safety rules.
- Restart preserves only the minimal grant if one exists. Conversation restart
  durability belongs to the future Agent Durable Object and Stage 2 tests.
- Cross-household requests cannot test grant/session existence or submit a
  proposal to another household's person.

## Minimum API Surface

Only if required by the spike:

- create, get, close, and revoke the participant's own private interview grant;
- exchange or resolve the opaque Agent reference through a participant-only
  boundary; and
- submit a proposed typed fact into the normal profile confirmation flow.

There is no household-wide session list, transcript endpoint, message endpoint,
stream, or model endpoint in Stage 1.

## Minimum UI Surface

Only if required by the spike:

- an own-profile “Begin private review” action explaining that transcript and
  messages are private while confirmed facts become household-visible;
- a participant-only open/closed/revoked session shell with no chat runtime;
- a proposal-review handoff into the existing typed profile confirmation UI;
  and
- explicit unavailable, stale profile, membership/person-link changed, closed,
  and revoked states.

Actual chat, streaming, resumability, model feedback, and transcript management
remain Stage 2.

## Vertical Tracer

If Stage 1 state is introduced:

1. Adult A creates an own-person private grant and loses the response; identical
   retry returns the same opaque identity.
2. Adult B in the same household cannot list, read, close, or infer A's grant.
3. A proposed `FoodPreference` remains private until A confirms it through the
   normal profile command; the resulting household-visible fact carries only
   safe provenance.
4. A stale proposal loses a profile-version race and cannot overwrite the new
   profile.
5. Membership removal or person unlink revokes access before another proposal
   can commit.
6. Another household cannot read or mutate the grant or profile command.

If no Stage 1 state is required, the tracer is a provider-free contract test
showing the future Agent boundary can preserve these identities and
authorization checks without adding a household table.

## Acceptance Evidence

### Spike and focused tests

- [ ] The exact repository-pinned Cloudflare Agents SDK is exercised in the
  supported local runtime, and the result records whether a Stage 1 grant is
  necessary.
- [ ] Closed schemas prove participant/subject binding, private projection, and
  proposal-to-profile command separation.
- [ ] Any grant implementation proves replay, collision, stale version,
  close/revoke race, and membership/person lifecycle invalidation.
- [ ] Tests prove raw transcript/message/prompt/model fields cannot decode into
  household state, audit, or public projections.

### Real runtime and persistence proof

- [ ] If a grant is implemented, real Workerd or Miniflare runs Better Auth,
  API, private routing, `HouseholdObject`, restart, and cross-household denial.
- [ ] Agent response-loss reconciliation uses one opaque identity and no network
  work inside the household transaction.
- [ ] A proposed fact becomes visible only through a separately admitted Work
  Item 03 command and respects current authorization/version/safety rules.
- [ ] Physical source/schema proof finds no transcript or conversation authority
  in household SQLite or shared D1.

### Repository and review gates

- [ ] Root format, lint, type checks, full tests, builds, applicable container,
  and hosted CI pass.
- [ ] ADR 0004, privacy docs, public contracts, stage, and current delivery
  records reflect the proven exact-version boundary.
- [ ] A completely fresh independent exact-head review disposes privacy,
  authorization, runtime ownership, replay, and test-integrity risks.

## Review Risk

Very high if code or storage is introduced; medium if the deliverable is only a
verified contract/spike record. Any code-bearing PR requires independent
exact-head review. Model/provider/cloud execution requires a separately approved
assignment and does not follow from this record.

## Implementation Notes

- Do not create a placeholder conversation table in household SQLite.
- Do not retain transcripts “temporarily” in audit, logs, Queue, R2, or profile
  metadata as a shortcut.
- Prefer no Stage 1 implementation if the exact-version spike proves no
  prerequisite. Deferring code is a valid outcome and keeps Stage 2 ownership
  truthful.
- A material departure from ADR 0004 or PDR 0007 requires a new ADR/product
  decision before implementation.

## Delivery Log

- 2026-08-27 — Created as `Proposed`; implementation is conditional on Work Item
  03 and the exact-version Agents SDK spike.
