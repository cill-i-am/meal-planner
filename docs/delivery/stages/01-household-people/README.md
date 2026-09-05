# Stage 1 — Household People, Profiles, And Permissions

- Status: Active
- Immediate work item:
  [`03-profile-authority-versioning-and-audit.md`](03-profile-authority-versioning-and-audit.md)
  (`In progress`)
- Started: 2026-08-27

## Household Outcome

A household represents the people who eat, not merely the authenticated users
who administer an organization. Adults can maintain a stable roster containing
themselves, another adult, and dependants; an invited adult can join later
without becoming a duplicate person; and household-visible profile facts retain
stable identity, versions, provenance, and audit history.

## Implemented Starting Point

The live repository establishes these boundaries:

- Better Auth D1 owns users, accounts, sessions, organizations, memberships,
  invitations, and roles. Membership is verified before household routing.
- One canonical `HouseholdObject` is addressed by immutable Better Auth
  organization ID. Its Drizzle-managed SQLite database owns household product
  state and mutations.
- Private household commands use closed Effect Schemas, exact-purpose admission,
  opaque object routing, object-side authorization, local transactions, and
  mutation receipts.
- Public household contracts expose status, meal-plan, and the closed person
  registry lifecycle operations. Profile, general account-link, and interview
  session APIs remain absent.
- The web application can create and select Better Auth organizations and now
  presents explicit creator bootstrap plus roster create/archive/restore. It
  never creates a person as an implicit read side effect.
- Real Workerd and Miniflare fixtures already prove Better Auth membership,
  private Worker-to-object routing, restart durability, and physical
  cross-household isolation.

Stage 1 extends those seams. It does not introduce a shared household D1,
another canonical writer, or a direct Better Auth dependency inside
`HouseholdObject`.

Work Item 01 is complete through
[PR #198](https://github.com/cill-i-am/meal-planner/pull/198), merged as
`9666a8bdae97bd9d6bf4efd98e30d03d617ccb31`. Its stable person registry,
creator association, lifecycle, audit, receipt, public API/UI, and real-runtime
evidence are the implemented base for Work Item 02.

## Accepted Direction

### Product decisions

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0005 — MVP scope and deferrals](../../../decisions/product/0005-mvp-scope-and-deferrals.md)
- [PDR 0007 — Household agent conversations and visibility](../../../decisions/product/0007-household-agent-conversations-and-visibility.md)
- [PDR 0008 — Temporary context, visitors, and planning suspensions](../../../decisions/product/0008-temporary-context-visitors-and-planning-suspensions.md)
- [PDR 0016 — Beta support, incidents, and operator repair](../../../decisions/product/0016-beta-support-incidents-and-operator-repair.md)

### Architecture decisions

- [ADR 0001 — Separate household people from auth members](../../../architecture/decisions/0001-separate-household-people-from-auth-members.md)
- [ADR 0004 — Household agent coordinator and isolated chat agents](../../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md)
- [ADR 0010 — Coordinate membership departure before person archival](../../../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md)
- [Household domain](../../../architecture/household-domain.md)
- [Completed household capability migration](../../../architecture/household-capability-migration-plan.md)

## Work Items And Sequence

| Order | Work item | Status | Dependency |
| --- | --- | --- | --- |
| 01 | [Person registry and lifecycle](01-person-registry-and-lifecycle.md) | Done | Stage 0 and accepted people/auth separation |
| 02 | [Account linking, invitations, and departure](02-account-linking-invitations-and-departure.md) | In progress | Work Item 01 merged; ADR-0010 accepted |
| 03 | [Profile authority, versioning, and audit](03-profile-authority-versioning-and-audit.md) | In progress | Work Items 01–02 merged; draft PR #202 |
| 04 | [Private interview-session boundary](04-private-interview-session-boundary.md) | Proposed | Work Item 03 and the accepted exact-version Agents SDK spike |

The four-part split remains a delivery hypothesis. Inspection of the live code
caused three refinements:

1. `invited-adult` is not a permanent third person kind. The durable kinds are
   `adult` and `dependant`; an invited adult is an adult person with a pending
   invitation association and no active account link.
2. Membership departure crosses Better Auth and household authority and cannot
   be made atomic. ADR-0010 now accepts the access-first durable coordination
   protocol, so Work Item 02 is ready for one bounded implementation owner.
3. Work Item 04 defines only the prerequisite boundary. Agent Durable Object
   conversation storage and runtime implementation remain Stage 2 unless the
   exact-version spike proves that a minimal prerequisite must land sooner.

## Canonical Authority And Privacy

| Fact | Canonical authority | Privacy boundary |
| --- | --- | --- |
| User, account, session, organization, member, invitation, role | Better Auth D1 through its Drizzle adapter | Identity control plane; raw invitation email stays here |
| Person, lifecycle, account-link fact, profile version, household audit, mutation receipt | The routed `HouseholdObject` SQLite database through Drizzle | Household-visible projections only after admitted membership |
| Current authenticated actor and role | Better Auth, resolved before object routing | Passed as a validated, one-way actor identity; no raw session or email enters the object |
| Conversation messages, transcripts, streaming and runtime lifecycle | A future isolated Agent Durable Object | Private to admitted participants; not ordinary household-visible data |
| Confirmed profile commands proposed by a conversation | `HouseholdObject` after normal authorization and validation | Only the resulting typed fact and provenance become household-visible |

Every household mutation is a local SQLite transaction. Better Auth mutations,
Workflow starts, Agent calls, Queue operations, R2 access, or network I/O must
not occur inside it. Cross-control-plane work uses explicit, retryable state and
reconciliation rather than an impossible transaction.

## Resolved Implementation Questions

### Creator-person bootstrap

Create the Better Auth organization first, then immediately issue an
authenticated, idempotent `BootstrapCreatorPerson` household command. In one
household transaction it creates one adult person, links the admitted creator,
writes its audit entry, and stores the mutation receipt. An identical retry
returns the same identities; a different bootstrap intent conflicts once a
creator link exists.

This is lower friction than asking the creator to add themselves, while keeping
the authority transition explicit and replayable. Existing development or
dogfood organizations with an empty roster use a visible one-time “Set up this
household” action backed by the same command. Implementation needs the normal
greenfield Drizzle migration and fixture updates, not a compatibility adapter,
dual write, generic backfill framework, or read-triggered mutation.

### Invitation association

An organizer first chooses an existing unlinked adult person and creates a
Better Auth invitation. Household authority records a purpose-bound one-way
digest of the invitation ID against that person; it does not store or expose the
invitee email. After acceptance, the admitted member presents the invitation ID
at the API boundary. The API derives the same digest and asks
`HouseholdObject` to link that member to the already-associated person.

No email matching, display-name matching, or automatic merge is allowed. A
missing association, multiple candidates, a link already owned by another
member, or a reused invitation is an explicit conflict. An organizer can use an
audited repair command to select an unlinked adult person; repair never creates,
merges, or silently deletes a person.

### Departure coordination

ADR-0010 fixes an access-first, visible, repairable protocol:

1. `HouseholdObject` records an idempotent departure operation for the exact
   account link and person, marks the association `departure_pending`, and
   closes cancellation through a versioned start transition before external
   mutation.
2. `MealPlannerApi` durably creates or reconciles a deterministic dedicated
   native `Cloudflare.Workflow` after those commits and before any Better Auth
   mutation. The Workflow initially waits for a privacy-safe outcome signal.
3. The authenticated API performs one typed Better Auth membership removal
   with live caller credentials, then signals the Workflow. A missing signal
   or removal result is reconciled by reading canonical membership.
4. The coordinator confirms membership absence, then uses the exact
   `member_departure_finalize` system purpose to record access revocation and
   atomically detach the link, archive the same person, audit, receipt, and
   complete.
5. Unknown removal outcomes are read from Better Auth before any new removal.
   Bounded exhaustion and finalization failure remain durable household-visible
   repair states; neither authority is silently described as complete.

The complete closed states, authorization, replay, collision, timeout, restart,
privacy, race, and repair rules are owned by
[ADR-0010](../../../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md).
The same decision also closes the destructive control-plane bypass: Work Item
02 must retain the exact public remove-member/leave route fence and configure
`organization({ disableOrganizationDeletion: true })`, disabling both HTTP and
typed organization deletion until the separate household deletion lifecycle
exists. Organization-deletion behavior is not part of this stage slice.

### Initial profile representation

Use a small closed union rather than a future-complete taxonomy or arbitrary
key/value bag:

- `NoKnownHardConstraints`;
- `HardConstraint` with a bounded label, category
  (`allergen`, `dietary_rule`, `ingredient_avoidance`, or `other_safety`) and
  handling (`exclude` or `requires_adaptation`); and
- `FoodPreference` with a bounded target label, target kind
  (`ingredient`, `dish`, or `cuisine`) and sentiment
  (`like`, `dislike`, or `strong_dislike`).

Each fact has stable identity, standing (`provisional` or `confirmed`), actor,
time, source, and immutable version provenance. Safety weakening uses a separate
explicit command. Adding new semantic fact families or changing visibility or
permission policy requires a product decision; table, index, and endpoint shape
remain local implementation choices.

### Interview ownership

`HouseholdObject` owns confirmed product state. A future Agent Durable Object
owns private messages, transcripts, streaming, and conversation lifecycle. A
session may propose typed profile commands but cannot become profile authority,
and raw transcript text must never be stored as household-visible profile or
audit data. Work Item 04 remains proposed until the accepted exact-version
Cloudflare Agents SDK spike resolves the minimum grant/reference contract.

## Cumulative Stage 1 Vertical Tracer

One adult creates or enters a household and obtains one stable linked adult
person. The roster gains another adult and dependants before the second adult
has an account. An invitation is associated with that existing adult; after
acceptance, the admitted member links to the same person without duplication.
Both adults perform authorized profile operations. Account, person, profile,
and audit identities remain stable across retries, restart, archive, departure,
return, and restoration. A separately authenticated household cannot read,
infer, link, archive, restore, or mutate any of that state.

## Explicit Stage Exclusions

- AI model or provider selection, interview implementation, Cloudflare Agent
  runtime implementation, streaming, transcripts, and the agent-evaluation
  harness;
- routines, fallbacks, planning, recipes, shopping, retailers, pantry, or
  nutrition goals;
- dependant accounts, visitors as people by default, granular guardianship,
  consensus permissions, or generic organization administration;
- a complete future profile taxonomy or opaque arbitrary profile facts;
- shared household D1, compatibility storage, dual writes, backfills, or legacy
  migration paths; and
- MCP, embedded distribution, deployment, or provider/cloud changes.

## Stage Exit Evidence

- The cumulative tracer passes through the production API, web surface, Better
  Auth control plane, private Worker boundary, and real `HouseholdObject`.
- Fresh and restarted Workerd or Miniflare compositions prove household-local
  persistence, mutation replay, collision handling, stale-version rejection,
  relevant races, and physical cross-household isolation.
- Better Auth invitations and memberships remain identity authority; household
  people, links, profile versions, and audit history have one canonical writer.
- Raw emails, sessions, invitation secrets, and private transcript content do
  not appear in household storage or household-visible projections.
- Archive, departure, return, and restore retain stable person and history
  identities without silent merging or deletion.
- Public contracts, UI behaviour, current architecture docs, and delivery state
  match the shipped composition.
- Required repository checks, lint, formatting, tests, builds, hosted CI, and
  independent exact-head reviews are green for every work item that requires
  them.

## Decision Boundary

### Local implementation choices

- table and index names, opaque ID encoding, module layout, endpoint naming, and
  UI composition;
- whether a roster response carries a roster revision in addition to per-person
  versions;
- internal receipt retention and pagination shape within existing retention and
  privacy decisions; and
- exact closed error tags, provided they preserve the specified visible
  distinctions.

### Requires a new product decision or ADR

- changing account-to-person cardinality, adding heuristic matching or merge,
  storing invitation emails in household state, or changing household-visible
  permissions;
- weakening explicit confirmation for safety constraints;
- a new canonical or shared store, dual writes, compatibility behaviour, or
  transcripts inside `HouseholdObject`;
- changing ADR-0010's departure coordinator, ordering, authority, durable
  states, or repair semantics;
- implementing organization/household deletion, cleanup, tombstones, retention,
  or any partial deletion lifecycle; and
- any Agent SDK topology that materially changes ADR 0004, participant privacy,
  or the separation between conversation and product authority.

## Next Implementation Assignment

Use the one exact bounded assignment in
[Work Item 02](02-account-linking-invitations-and-departure.md#first-implementation-agent-assignment).
Work Items 03 and 04 remain `Proposed` and must not be combined with it.
