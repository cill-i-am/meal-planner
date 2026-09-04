# Work Item 03 — Profile Authority, Versioning, And Audit

- Status: In progress
- Stage: [Stage 1 — Household people, profiles, and permissions](README.md)
- Owner: `codex/stage1-profile-authority-versioning-audit`
- Pull request: [#202](https://github.com/cill-i-am/meal-planner/pull/202) (draft)
- Completed by: Not completed
- Promotion condition: satisfied by Work Items 01 and 02, including merged
  PR #201 at `9a59f85170f379e065920eadaaf69593d90c2c40`.

## Implementation checkpoint

The first real Workerd tracer passes: an admitted adult records a provisional
preference for an existing person, reads it back, and replays the exact mutation
without another version. Historical-version and audit queries use the same
immutable SQLite version ledger. Each committed row is also its mutation
receipt; the current profile is the latest version, not a second mutable copy.
Audit records carry the changed fact before and after, actor, time, and prior
and next versions. Source is limited to `manual_ui` in this work item.

Focused runtime proof now covers safety confirmation, concurrent adult edits,
archival races, restored history, restart replay, and cross-household denial.
The separate profile UI retains an ambiguous command's exact payload and ID,
blocks other profile mutations until resolution, and requires explicit reload
and resubmission after a definitive stale-version result. Closed contract
property tests reject injected identity and transcript fields. A routed
dependant-confirmation case preserves fact identity and before/after audit
without a dependant account. Local repository tests, static checks, builds,
and twice/no-diff Household and D1 generation pass. Hosted CI and independent
exact-head review remain pending. This checkpoint is not completion or merge
evidence.

## Household Outcome

Adults can maintain a small, useful set of household-visible facts about each
person. Information entered for someone else is visibly provisional; confirmed
facts have stable identity and immutable versions; and every change has a
privacy-safe audit trail. Removing or weakening a hard dietary or safety
constraint requires a separate explicit confirmation.

## Accepted Direction

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0005 — MVP scope and deferrals](../../../decisions/product/0005-mvp-scope-and-deferrals.md)
- [PDR 0007 — Household agent conversations and visibility](../../../decisions/product/0007-household-agent-conversations-and-visibility.md)
- [ADR 0001 — Separate household people from auth members](../../../architecture/decisions/0001-separate-household-people-from-auth-members.md)
- [Stage 1 profile representation recommendation](README.md)

## User-Visible Vertical

Adult A records provisional preferences and a hard constraint for Adult B and a
dependant. After Adult B joins, B confirms or corrects their own facts. Both
adults can make admitted ordinary edits under the broad MVP policy. Every
household-visible change creates an immutable profile version and audit entry.
A hard constraint cannot be removed or weakened through the ordinary edit path.

## Scope

### In scope

- a closed typed initial profile-fact model;
- stable fact identities and immutable profile versions;
- provisional facts entered by another adult;
- self-confirmed and adult-confirmed facts;
- broad MVP adult editing of household profiles;
- actor, time, source, and before/after audit history;
- a separate explicit hard-constraint reduction/removal command;
- privacy-safe current profile and version/audit projections;
- optimistic concurrency, receipts, replay, restart, and cross-household proof;
  and
- the minimum profile UI required to add, confirm, correct, and safely reduce
  these facts.

### Out of scope

- a complete taxonomy of future preferences, routines, fallbacks, locations,
  exact products, portions, nutrition goals, or planning provenance;
- arbitrary unvalidated key/value facts;
- AI interviews, transcript storage, inference, model orchestration, or Agent
  Durable Objects;
- routines, plans, recipes, shopping, retailer, or pantry behaviour;
- granular per-fact guardianship/consensus permissions or dependant accounts;
- profile merge, history rewriting, or hard deletion; and
- shared household D1, compatibility, dual writes, or backfills.

## Initial Closed Profile Model

Use the smallest useful discriminated union:

- `NoKnownHardConstraints` — an explicit reviewed statement, not the absence of
  data;
- `HardConstraint` — bounded normalized label, category
  (`allergen`, `dietary_rule`, `ingredient_avoidance`, `other_safety`) and
  handling (`exclude`, `requires_adaptation`); and
- `FoodPreference` — bounded target label, target kind
  (`ingredient`, `dish`, `cuisine`) and sentiment
  (`like`, `dislike`, `strong_dislike`).

Every fact carries:

- stable `ProfileFactId` and subject `HouseholdPersonId`;
- standing `provisional` or `confirmed`;
- confirmation basis `self` or `household_adult` where confirmed;
- source `manual_ui` only; future proposal sources require their own admitted
  boundary and are not speculative handlers in this work item;
- created/updated actor and time; and
- the immutable profile version in which it became current.

Free-text labels are bounded data inside a typed fact, not arbitrary property
names. Expanding fact families or changing their safety/visibility semantics
requires a product decision rather than a silent schema extension.

## Product Commands And Queries

### Commands

- `AddProvisionalProfileFact(mutationId, personId, expectedProfileVersion,
  fact)` records information about another person without claiming self
  confirmation.
- `ConfirmProfileFact(mutationId, personId, factId,
  expectedProfileVersion)` confirms an existing fact under the allowed
  self/dependant policy.
- `AddConfirmedProfileFact(...)` permits an adult to add their own confirmed
  fact or an adult-confirmed dependant fact.
- `ReplaceOrdinaryProfileFact(mutationId, personId, factId,
  expectedProfileVersion, replacement)` versions an ordinary preference.
- `RemoveOrdinaryProfileFact(...)` versions removal of a non-safety fact.
- `ConfirmHardConstraintReduction(mutationId, personId, factId,
  expectedProfileVersion, replacementOrRemoval, confirmation)` is the only path
  that can remove or weaken a hard constraint or replace
  `NoKnownHardConstraints` in a safety-significant way.

Commands proposed by a later private interview use these same product
operations. A conversation cannot write profile rows directly.

### Queries

- `GetCurrentPersonProfile(personId)` returns the current privacy-safe profile,
  profile version, and fact standings.
- `ListPersonProfileVersions(personId, cursor)` returns immutable version
  summaries.
- `GetPersonProfileVersion(personId, version)` returns one before/after-safe
  historical projection.
- `ListPersonProfileAudit(personId, cursor)` returns household-visible audit
  events without private transcript or hidden system input.

## States, Transitions, And Invariants

```text
Fact: absent -> provisional -> confirmed
Fact: provisional|confirmed -> replaced -> current replacement
Ordinary fact: current -> removed
Hard constraint: current -> explicitly confirmed replacement|removal
Profile version: 0 -> 1 -> 2 -> ...
```

- Fact IDs do not change merely because standing changes from provisional to
  confirmed. Material semantic replacement creates an immutable historical
  version and a current successor as the chosen implementation model specifies.
- A self-confirmed fact takes precedence over a contradictory provisional fact;
  the conflict is resolved explicitly and remains in history.
- For an adult subject, only that linked adult may claim `self` confirmation.
  Other adults can enter provisional information or make a household-adult edit
  under the broad MVP policy, with honest provenance.
- Dependants have no self account in this stage; admitted adults may confirm
  facts for them as `household_adult`.
- Ordinary edit commands cannot remove, weaken, or recategorize a hard
  constraint. The explicit safety command and confirmation UI are mandatory.
- No audit or version history can contain raw transcript, email, session,
  invitation identity, or private prompt/model content.

## Versioning And Projections

Every successful semantic mutation creates exactly one immutable profile
version containing enough closed data to reconstruct the before-and-after fact
set. The current profile points to the latest version. Audit is append-only and
records actor, subject, command/source, time, prior version, next version, and
the privacy-safe before/after change.

The household-visible current projection includes fact identity, typed value,
standing, confirmation basis, source class, and version provenance. It excludes
private interview session IDs unless an opaque provenance reference is accepted
in Work Item 04, and always excludes transcript/message text.

## Authority, Transaction, And Privacy

- `HouseholdObject` is the only profile writer and the household SQLite database
  is the only profile, version, audit, and receipt store.
- One transaction validates person lifecycle and authorization, checks the
  expected profile version, creates the next immutable version, updates the
  current projection, appends audit, and commits the receipt.
- Better Auth proves membership and role before routing. Object-local person
  association determines whether a command may claim `self` confirmation.
- Broad MVP editing permits admitted adults to edit any household person, but
  the projection must distinguish self-confirmed, household-adult confirmed,
  and provisional provenance.
- Private conversations are outside this transaction and store. Only a closed,
  authorized product command may cause a visible profile change.

## Failure, Replay, And Concurrency

- Identical mutation replay returns the same profile version and result without
  duplicate facts, versions, or audit.
- Mutation-ID reuse with different fact, subject, expected version, standing,
  or safety confirmation returns `mutation_collision`.
- A stale profile version makes no change and reports a closed stale result.
- Concurrent edits from two adults to one version have one winner. The loser
  reloads the new profile and explicitly reapplies or abandons their intent.
- Confirming a fact concurrently with replacement/removal produces one winner;
  confirmation cannot attach to a different semantic fact accidentally.
- Ordinary and safety-reduction commands racing on a hard constraint cannot
  bypass the special confirmation path.
- Archive racing with a profile mutation is fenced by current person version or
  lifecycle in the same transaction; archived people reject new profile writes
  until restored.
- Restart preserves current profile, immutable versions, audit order, receipts,
  and provenance exactly.

## Minimum API Surface

- Get current profile, list/get profile versions, and list audit for one person.
- Add provisional/confirmed facts, confirm a fact, replace/remove an ordinary
  fact, and explicitly confirm a hard-constraint reduction.
- Every mutation includes a stable mutation ID and expected profile version.
- Results distinguish not found, archived subject, unauthorized self claim,
  stale version, mutation collision, invalid transition, and safety
  confirmation required without cross-household disclosure.

## Minimum UI Surface

- A profile page reachable from the roster showing current facts, provisional
  versus confirmed standing, provenance class, and version.
- Add/edit/remove ordinary facts using the closed model.
- Confirm or correct a provisional fact, with `self` available only for the
  current linked adult.
- A deliberate hard-constraint reduction flow that shows the existing and
  proposed safety meaning and requires explicit confirmation.
- A compact version/audit history view sufficient to understand who changed
  what and when.
- Explicit pending, stale, collision, unauthorized, archived, retry, and
  unavailable states.

## Vertical Tracer

1. Adult A records provisional preferences and a hard constraint for unlinked
   adult B and one dependant.
2. Adult B later joins through Work Item 02, sees the same profile, confirms one
   fact, and corrects another without changing person or fact identity
   unnecessarily.
3. A and B race ordinary edits; one commits and one receives a stale result.
4. A attempts ordinary removal of B's hard constraint and is rejected. The
   explicit safety flow commits one reviewed change and audit entry.
5. A response is lost and retried across restart; the same version and receipt
   return with no duplicate history.
6. Another household cannot read the current profile, version count, audit,
   fact existence, or safety state.

## Acceptance Evidence

### Focused tests

- [ ] Closed-schema property tests cover every fact variant, standing, source,
  confirmation basis, bounded label, and excess-property rejection.
- [ ] Provisional, self-confirmed, dependant-confirmed, replace, ordinary
  remove, and hard-constraint reduction transitions satisfy the invariants.
- [ ] Immutable version reconstruction and privacy-safe before/after audit are
  proven.
- [ ] Replay, collision, stale version, edit/confirm/remove races, archive race,
  and safety-path bypass attempts are deterministic.
- [ ] API/generated client and UI tests prove the minimum surface and visible
  error distinctions.

### Real runtime and persistence proof

- [ ] A real authenticated Workerd or Miniflare tracer crosses public API,
  private Worker, `HouseholdObject`, and migrated SQLite for both adults.
- [ ] Restart proves byte-stable current profile, immutable versions, audit,
  receipts, and source/actor provenance.
- [ ] Wrong-purpose, non-member, false self-confirmation, and cross-household
  requests fail before disclosure or mutation.
- [ ] Physical migration proof shows no shared-D1 profile authority or fallback.

### Repository and review gates

- [ ] Root format, lint, type checks, full tests, builds, applicable container,
  and hosted CI pass.
- [ ] Public contracts, privacy docs, household-domain architecture, stage, and
  current delivery records are updated.
- [ ] A fresh independent exact-head review disposes safety, privacy, versioning,
  authorization, concurrency, and test-integrity findings.

## Review Risk

Very high. This work creates safety-significant product authority, immutable
history, provenance, and cross-person permissions. Independent exact-head
review is required.

## Implementation Notes

- The union above is accepted as the initial implementation recommendation, not
  permission to add every future blueprint fact.
- Exact version-storage normalization and event/projection table layout are
  local choices if one transaction and immutable reconstruction remain true.
- Do not add a generic metadata column that bypasses the closed union.
- Operator repair may use the same commands with an explicit source and reason;
  it does not receive a silent database-write path.

## Delivery Log

- 2026-08-27 — Created as `Proposed`; depends on stable person and account-link
  semantics from Work Items 01 and 02.
