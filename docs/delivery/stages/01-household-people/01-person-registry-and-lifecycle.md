# Work Item 01 — Person Registry And Lifecycle

- Status: In review
- Stage: [Stage 1 — Household people, profiles, and permissions](README.md)
- Owner: `codex/stage1-person-registry-lifecycle`
- Pull request: [PR #198](https://github.com/cill-i-am/meal-planner/pull/198)
- Completed by: Not completed

## Household Outcome

An authenticated adult can establish a truthful household roster containing
themselves, other adults, and dependants. Every person keeps one stable identity
when archived and restored, and the roster survives object restart without
becoming readable or mutable from another household.

## Accepted Direction

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0005 — MVP scope and deferrals](../../../decisions/product/0005-mvp-scope-and-deferrals.md)
- [ADR 0001 — Separate household people from auth members](../../../architecture/decisions/0001-separate-household-people-from-auth-members.md)
- [Household domain](../../../architecture/household-domain.md)
- [Stage 1 authority and bootstrap decisions](README.md)

## User-Visible Vertical

After creating an organization, its Better Auth owner completes one explicit
setup action that creates and links their adult person. Other admitted adults
can use the roster but cannot win creator bootstrap merely by racing while it is
empty. The household can then list the roster, add another adult or dependant,
archive a person, include archived people in the roster, and restore the same
person. The UI keeps the same person identity and shows an actionable
stale/conflict error rather than silently overwriting concurrent changes.

## Scope

### In scope

- stable, opaque, household-local `HouseholdPersonId` values;
- durable kinds `adult` and `dependant`;
- lifecycle states `active` and `archived`;
- idempotent creator-person bootstrap after Better Auth organization creation;
- the minimum creator account association required to identify the current
  adult person without storing raw auth identifiers;
- create, list, archive, and restore behaviour;
- a monotonically increasing per-person version;
- immutable household audit entries and mutation receipts;
- authenticated public API operations and a minimal roster UI;
- a Drizzle-managed household SQLite migration and fixture updates; and
- restart durability, replay, collision, concurrency, authorization, and
  cross-household isolation proof.

### Out of scope

- invitation creation or acceptance, account-link repair, departure, or links
  for anyone except the creator bootstrap;
- detailed profile facts, provisional/confirmed standing, private interviews,
  routines, meal planning, recipes, or shopping;
- dependant accounts, visitors as people by default, granular permissions, or
  consensus/guardianship rules;
- person merge, hard deletion, compatibility storage, shared household D1,
  dual writes, backfills, or preserving experimental data; and
- provider, Workflow, Queue, R2, Agent SDK, deployment, or cloud changes.

## Product Commands And Queries

### Commands

- `BootstrapCreatorPerson(mutationId, displayName)` creates one adult person and
  one active association only for the admitted Better Auth organization owner.
  The association uses the separately derived linkage subject, not the audit
  actor or a raw Better Auth user/member/email value. The creator association is
  a household-singleton database fact, so a second owner cannot create another
  creator person.
- `CreateHouseholdPerson(mutationId, kind, displayName)` creates an unlinked
  adult or a dependant.
- `ArchiveHouseholdPerson(mutationId, personId, expectedVersion)` changes an
  active person to archived.
- `RestoreHouseholdPerson(mutationId, personId, expectedVersion)` changes an
  archived person to active without changing `personId`.

`displayName` is a bounded household-visible label. This slice does not infer a
kind, link, or identity from it.

### Queries

- `ListHouseholdPeople(includeArchived)` returns the household roster, the
  privacy-safe creator-slot state, and the current member's linked person, if
  any.
- `GetHouseholdPerson(personId)` returns one privacy-safe person projection or a
  typed not-found result.

Queries are read-only. An empty roster or missing creator link never triggers a
hidden bootstrap mutation.

## States, Transitions, And Invariants

```text
Person: absent -> active -> archived -> active
Creator link: absent -> active
```

- Person kind and identity are immutable.
- Archive and restore advance the same person's version and preserve history.
- An archived person remains queryable only when explicitly requested or by ID.
- Bootstrap creates exactly one creator link and one adult person. Once a
  creator link exists, a different bootstrap intent conflicts.
- Each household has one durable creator-association slot. Its linkage subject
  and person remain unique, so neither a second owner nor the original owner
  under another bootstrap intent can create another creator person. General
  account-link lifecycle is deferred to Work Item 02.
- There is no `invited-adult` person kind. Until Work Item 02, another adult is
  simply an unlinked adult person.
- Hard deletion and person merge do not exist.

## Versioning And Household Projection

Each person has `version >= 1`, created/updated timestamps, lifecycle state,
kind, and household-visible display name. Command results and queries expose
that version. Archive and restore require `expectedVersion` and return the new
version.

The minimum roster projection contains person ID, kind, lifecycle, display
name, version, and whether the person is the current authenticated adult. It
also carries an `available | occupied` creator-slot state derived from the
canonical creator association. Roster non-emptiness and a missing current link
do not imply that the creator slot is occupied. The projection must not expose
the associated creator identity, actor digests, mutation IDs, receipt digests,
raw Better Auth identifiers, sessions, roles, emails, or invitation data.

Whether the list also carries a roster-wide revision is a local implementation
choice; it may not replace per-person optimistic concurrency.

## Authority, Transaction, And Privacy

- **Canonical writer and store:** the routed `HouseholdObject`, using Drizzle
  against its local SQLite database.
- **Transaction boundary:** a person transition, version update, audit append,
  account-association update where applicable, and mutation receipt commit
  atomically in one local SQLite transaction.
- **Authorization:** Better Auth resolves the session and explicit organization
  membership before private Worker routing. Bootstrap additionally requires the
  active membership's actual `owner` role before gateway invocation. The
  private Worker admits the exact people-member or owner-only creator purpose
  before locating the object; the object repeats exact admission before
  mutation.
- **Privacy:** the roster is household-visible to admitted members. The object
  receives separate purpose-bound one-way audit and linkage identities and never
  imports Better Auth or stores raw user, member, session, invitation, role, or
  email values. `linkage-subject` is derived from immutable user plus household,
  remains byte-stable across auth-session, membership-row, and runtime changes,
  and differs across users or households.
- **External effects:** none occur inside or after these mutations.

## Failure, Replay, And Concurrency

- An identical `mutationId` with byte-identical admitted intent returns the
  committed privacy-safe result without another person, version, audit entry,
  or link.
- Reusing a `mutationId` with a different intent returns
  `mutation_collision` and makes no change.
- A wrong `expectedVersion` returns `stale_version` with no write. It must not
  disclose another household's current version.
- Concurrent identical bootstrap requests converge on one person and link.
  Conflicting requests from distinct admitted owners produce one winner and one
  explicit conflict. That conflict says the household creator slot is occupied
  and the requesting account remains unlinked without identifying the winner;
  it is durable rather than a retryable outage. Remaining an owner does not
  make the loser eligible later.
- Concurrent archive/restore or two different edits at one version produce one
  winner; the loser receives `stale_version` or an equivalent closed conflict.
- Repeating archive on already archived or restore on active is not silently
  accepted as a new transition. Exact receipt replay still succeeds.
- A missing person returns a privacy-safe not-found result indistinguishable
  from a person in another household.
- Object eviction or Worker restart cannot change replay, versions, audit order,
  creator association, or returned identities.

## Minimum API Surface

The public contract needs only equivalent operations to:

- `POST /v1/household/people/bootstrap-creator`;
- `GET /v1/household/people?includeArchived=true|false`;
- `GET /v1/household/people/:personId`;
- `POST /v1/household/people`;
- `POST /v1/household/people/:personId/archive`; and
- `POST /v1/household/people/:personId/restore`.

Mutating requests carry a client-stable mutation ID. Archive and restore carry
the expected person version. Exact paths and method names are local choices,
but the public contract must retain the closed semantic distinctions above.

## Minimum UI Surface

- Organization creation continues through Better Auth, followed immediately by
  the explicit creator bootstrap command.
- An existing admitted organization with an available creator slot shows a
  one-time “Set up this household” action backed by the same command, even when
  unlinked non-creator people already exist.
- A roster view lists active adults and dependants, can reveal archived people,
  and identifies the current adult.
- An adult can add an adult or dependant, archive a person with confirmation,
  and restore the same person.
- Pending, conflict, retry, stale-version, unauthorized, and unavailable states
  are explicit. The UI must not manufacture optimistic person IDs or hide a
  rejected transition. An unlinked account presented with an occupied creator
  slot stays on the shared roster without another creator-setup action; the UI
  does not automatically retry or describe that durable conflict as an outage.

No invitation, profile editor, or interview surface belongs in this PR.

## Vertical Tracer

Using the production auth/API/object composition:

1. Adult A creates or selects organization A and bootstraps one linked adult.
2. Adult A creates one unlinked adult and two dependants and sees all four
   active people in the roster.
3. The creator bootstrap response is lost and retried; the same creator person
   and receipt return with no duplicate.
4. A dependant is archived and restored across an object restart; its identity
   and audit history remain unchanged and its version advances.
5. A stale concurrent archive is rejected without mutation.
6. An admitted member of organization B cannot read, infer, archive, restore,
   or collide with any organization-A person or mutation receipt.
7. A non-owner racing the owner cannot route or win bootstrap. If that member
   becomes an owner and races another owner, exactly one household creator wins;
   the loser remains unlinked and conflicts on later bootstrap. Exact winner
   retries converge, and the winning user's linkage remains stable across
   session, membership-row, Worker, and object restart changes while differing
   in a second household.

## Acceptance Evidence

### Focused domain and contract tests

- [x] Closed schemas reject excess keys, malformed IDs, invalid versions,
  unsupported kinds/lifecycles, and unbounded display names.
- [x] Bootstrap, create, list, archive, and restore transitions satisfy every
  invariant above.
- [x] Audit entries record actor, command, person, before/after lifecycle,
  versions, and time without raw auth or request secrets.
- [x] Identical replay, mutation collision, stale version, wrong lifecycle,
  and concurrent bootstrap/archive/restore races are deterministic.
- [x] Public API and generated client contracts preserve closed error and result
  types.
- [x] The audit actor and person linkage subject are separately branded,
  purpose/domain-separated digests of immutable Better Auth user plus household;
  stability and cross-user/cross-household separation are executable.
- [x] UI tests cover empty-household bootstrap, roster operations, pending,
  durable non-retryable bootstrap conflict, retryable failures, stale,
  unauthorized, unavailable, an unlinked account with an occupied creator slot,
  and an unlinked owner with non-creator people but an available creator slot.

### Real runtime and persistence proof

- [x] A real Workerd or Miniflare test runs Better Auth session/membership,
  public API, private Worker routing, `HouseholdObject`, and actual SQLite
  migrations.
- [x] The cumulative tracer for this work item survives object/runtime restart
  and reads the committed SQLite state rather than a fixture-only cache.
- [x] Real runtime projection derives creator-slot state independently from
  roster membership, survives restart, and remains isolated across households.
- [x] Wrong-purpose and unauthenticated commands do not locate or invoke a
  household object.
- [x] A real Better Auth owner-versus-member race proves non-owner bootstrap is
  denied before private invocation and the object independently rejects a
  people-member bootstrap admission. After role transfer, a real two-owner race
  proves one winner, one durable creator association and person, exact winner
  replay, and closed conflict for the still-owner loser.
- [x] A non-member is rejected before routing; a member of another household
  cannot read or mutate state and cannot infer whether a person or receipt
  exists.
- [x] Fresh migration composition and regeneration prove one household-local
  people authority, a physical creator-slot primary key that rejects a second
  distinct linkage/person association, and no shared household D1 fallback.

### Repository and review gates

- [x] Root formatting, lint with warnings denied, type checks, full tests, and
  all production builds pass.
- [x] The full local container/runtime gate passes on the replacement tree.
- [ ] Hosted CI passes on the replacement frozen head.
- [x] Public API documentation, household-domain architecture,
  [`current.md`](../../current.md), and this delivery record reflect the shipped
  composition.
- [ ] A completely fresh independent exact-head review proves authority,
  privacy, authorization ordering, replay, restart, isolation, and test
  integrity. Green CI alone is not merge authority.

## Review Risk

High. This creates durable identity, authorization-sensitive household state,
optimistic concurrency, and a bootstrap transition at the Better
Auth/HouseholdObject boundary. Independent exact-head review is required.

## Implementation Notes

- Generate opaque person IDs inside household authority. Do not derive them from
  a user, member, email, display name, or invitation.
- Reuse the existing Effect service/layer, closed Schema, private routing,
  Drizzle transaction, migration registry, and real-runtime fixture patterns.
- Store the creator association in the household-singleton creator slot with
  the separately branded, household-scoped linkage subject. Use the distinct
  audit actor only for audit attribution. Work Item 02 may extend the
  association lifecycle, but Work Item 01 must not pre-implement invitation or
  departure policy.
- Preserve greenfield discipline: update development fixtures or reset local
  experimental data. Do not add compatibility reads, legacy adapters, or a
  generic backfill framework.

## Delivery Log

- 2026-08-30 — Corrected creator-slot presentation at the final replacement
  head test-first. The executable RED proved that an unlinked owner with only a
  dependant was falsely shown an occupied creator slot because the panel
  inferred authority from roster non-emptiness. The closed roster projection
  now carries only `available | occupied`, derived from the canonical singleton
  association without exposing its person or account identity. The UI trusts
  that authority instead of roster shape. Contract, panel, two-owner race, and
  real Better Auth/public API/private Worker/HouseholdObject/SQLite tests cover
  both an unlinked loser with an occupied slot and an unlinked owner with
  non-creator people but an available slot, including restart and
  cross-household isolation. Replacement local and hosted evidence follows on
  the immutable correction head; this correction adds no Work Item 02+ behavior.

- 2026-08-29 — Corrected the replacement-head public meaning of
  `bootstrap_conflict` test-first. The executable RED proved the two-owner loser
  was falsely described as already linked while the panel automatically retried
  the conflict and labeled it a temporary outage. The public contract and HTTP
  response now state only that the household creator slot is occupied and the
  requesting account remains unlinked, without identifying either person or
  account. The roster UI treats the result as durable, does not retry it, removes
  creator setup once the occupied slot is known, and keeps the admitted account
  on the shared roster without implementing linking or repair. Public-contract,
  HTTP-boundary, panel, and real Better Auth two-owner race tests cover the
  corrected behavior. Replacement local gates are green: 138 root architecture
  tests, 20 household-contract tests, 31 recipe-contract tests, 38 web tests,
  and 803 API tests; formatting checked 383 files, and lint, type checks,
  production builds, and clean migration regeneration passed. The unchanged
  Docker-backed physical gate passed 1/1 in 1,046.83 seconds. Hosted CI remains
  a separate gate; this correction adds no Work Item 02+ behavior.

- 2026-08-29 — Corrected the exact-head creator-singleton review finding
  test-first. The executable RED raced two distinct Better Auth owners through
  the public API and received two successful creator people. The replacement
  schema gives every household database one fixed creator slot while preserving
  unique linkage subjects and person IDs. Bootstrap now checks exact receipt
  replay first, returns the existing closed conflict before identity allocation,
  and atomically reserves the slot before any person, audit, or receipt write.
  Real Better Auth/public API/private Worker/HouseholdObject/SQLite proof now
  yields one winner and one conflict, keeps the losing owner unlinked on retry,
  and persists exactly one creator person and association. A separate real
  SQLite probe inserts distinct linkage subjects/person IDs directly and proves
  the generated migration physically rejects the second association. The
  PR-added people migration was regenerated as a greenfield replacement with a
  clean second-generation no-diff result. Local gates are green: 138 root
  architecture tests, 19 household-contract tests, 31 recipe contract tests, 36
  web tests, and 802 API tests; formatting checked 383 files, and lint, type
  checks, and production builds passed. The unchanged Docker-backed physical
  gate passed 1/1 in 1,030.06 seconds. Hosted CI and independent exact-head
  review remain separate acceptance gates; this correction adds no Work Item
  02+ behavior.

- 2026-08-29 — Superseded the initial PR head and strengthened the identity and
  bootstrap boundary test-first. The API now derives separate versioned,
  purpose/domain-separated audit and linkage digests from immutable Better Auth
  user plus household identity. The linkage subject remains stable across a new
  session, membership-row identifier rotation, and Workerd/object restart, and
  differs for the same user in another household and for another user. Better
  Auth's durable `owner` membership role is the sole creator authority. A real
  owner-versus-member race proved non-owner denial before private invocation,
  concurrent owner replay convergence, object-side closed admission, and no
  denied mutation or roster disclosure. This evidence deliberately adds no
  invitation, link-repair, departure, profile, interview, Agent, routine,
  planning, or other Work Item 02+ behavior. Replacement repository gates are
  green: 138 root architecture tests, 19 household-contract tests, 31 recipe
  contract tests, 36 web tests, and 801 API tests; formatting checked 383 files,
  and lint, type checks, and production builds passed. The unchanged
  Docker-backed physical gate passed 1/1 in 1,035.24 seconds. Replacement
  immutable head, hosted CI, and independent exact-head review remain pending.

- 2026-08-28 — Implemented the Work Item 01 vertical on
  `codex/stage1-person-registry-lifecycle`: closed public and private contracts,
  Better Auth admission, transactional household-local person authority,
  generated SQLite migration, generated same-origin client, and the minimal
  roster UI. Focused real-runtime proof passed for exact replay, mutation
  collision, bootstrap and lifecycle races, audit/receipt uniqueness, restart,
  authorization ordering, and cross-household isolation. Root format, lint,
  type, full test, production build, and unchanged-tree container gates passed;
  the full test run included 138 root tests, 18 household-contract tests, 31
  recipe-import contract tests, 35 web tests, and 798 API tests. The physical
  container test passed in 1,092.84 seconds after starting the local Docker
  daemon. The implementation was published as draft PR #198. Hosted CI and
  independent exact-head review remain open.
- 2026-08-27 — Marked `Ready` after repository, decision, authority, API, UI,
  migration, and runtime-boundary reconciliation.
