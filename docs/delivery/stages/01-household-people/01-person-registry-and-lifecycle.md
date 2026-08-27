# Work Item 01 — Person Registry And Lifecycle

- Status: Ready
- Stage: [Stage 1 — Household people, profiles, and permissions](README.md)
- Owner: Unassigned implementation lane
- Pull request: Not opened
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

After creating or entering an empty Better Auth organization, an adult completes
one explicit setup action that creates and links their adult person. They can
then list the roster, add another adult or dependant, archive a person, include
archived people in the roster, and restore the same person. The UI keeps the
same person identity and shows an actionable stale/conflict error rather than
silently overwriting concurrent changes.

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
  one active association for the admitted creator. The association uses the
  already-derived private actor identity, not raw Better Auth user/member/email.
- `CreateHouseholdPerson(mutationId, kind, displayName)` creates an unlinked
  adult or a dependant.
- `ArchiveHouseholdPerson(mutationId, personId, expectedVersion)` changes an
  active person to archived.
- `RestoreHouseholdPerson(mutationId, personId, expectedVersion)` changes an
  archived person to active without changing `personId`.

`displayName` is a bounded household-visible label. This slice does not infer a
kind, link, or identity from it.

### Queries

- `ListHouseholdPeople(includeArchived)` returns the household roster and the
  current member's linked person, if any.
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
- One admitted actor identity has at most one active person association in the
  household. General account-link lifecycle is deferred to Work Item 02.
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
must not expose actor digests, mutation IDs, receipt digests, raw Better Auth
identifiers, sessions, roles, emails, or invitation data.

Whether the list also carries a roster-wide revision is a local implementation
choice; it may not replace per-person optimistic concurrency.

## Authority, Transaction, And Privacy

- **Canonical writer and store:** the routed `HouseholdObject`, using Drizzle
  against its local SQLite database.
- **Transaction boundary:** a person transition, version update, audit append,
  account-association update where applicable, and mutation receipt commit
  atomically in one local SQLite transaction.
- **Authorization:** Better Auth resolves the session and explicit organization
  membership before private Worker routing. The private Worker admits the exact
  member command purpose before locating the object; the object repeats exact
  admission before mutation.
- **Privacy:** the roster is household-visible to admitted members. The object
  receives a purpose-bound, one-way actor identity and never imports Better Auth
  or stores raw user, member, session, invitation, or email values.
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
  Conflicting bootstrap requests produce one winner and one explicit conflict.
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
- An existing admitted organization with no creator link shows a one-time
  “Set up this household” action backed by the same command.
- A roster view lists active adults and dependants, can reveal archived people,
  and identifies the current adult.
- An adult can add an adult or dependant, archive a person with confirmation,
  and restore the same person.
- Pending, conflict, retry, stale-version, unauthorized, and unavailable states
  are explicit. The UI must not manufacture optimistic person IDs or hide a
  rejected transition.

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

## Acceptance Evidence

### Focused domain and contract tests

- [ ] Closed schemas reject excess keys, malformed IDs, invalid versions,
  unsupported kinds/lifecycles, and unbounded display names.
- [ ] Bootstrap, create, list, archive, and restore transitions satisfy every
  invariant above.
- [ ] Audit entries record actor, command, person, before/after lifecycle,
  versions, and time without raw auth or request secrets.
- [ ] Identical replay, mutation collision, stale version, wrong lifecycle,
  and concurrent bootstrap/archive/restore races are deterministic.
- [ ] Public API and generated client contracts preserve closed error and result
  types.
- [ ] UI tests cover empty-household bootstrap, roster operations, pending,
  retry, stale, unauthorized, and unavailable states.

### Real runtime and persistence proof

- [ ] A real Workerd or Miniflare test runs Better Auth session/membership,
  public API, private Worker routing, `HouseholdObject`, and actual SQLite
  migrations.
- [ ] The cumulative tracer for this work item survives object/runtime restart
  and reads the committed SQLite state rather than a fixture-only cache.
- [ ] Wrong-purpose and unauthenticated commands do not locate or invoke a
  household object.
- [ ] A non-member is rejected before routing; a member of another household
  cannot read or mutate state and cannot infer whether a person or receipt
  exists.
- [ ] Fresh migration composition and regeneration prove one household-local
  people authority and no shared household D1 table or fallback.

### Repository and review gates

- [ ] Root formatting, lint with warnings denied, type checks, full tests, and
  all production builds pass.
- [ ] Applicable container and hosted CI gates pass on the frozen head.
- [ ] Public API documentation, household-domain architecture,
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
- Store the creator association under the admitted one-way actor identity. Work
  Item 02 may extend the association lifecycle, but Work Item 01 must not
  pre-implement invitation or departure policy.
- Preserve greenfield discipline: update development fixtures or reset local
  experimental data. Do not add compatibility reads, legacy adapters, or a
  generic backfill framework.

## Delivery Log

- 2026-08-27 — Marked `Ready` after repository, decision, authority, API, UI,
  migration, and runtime-boundary reconciliation.
