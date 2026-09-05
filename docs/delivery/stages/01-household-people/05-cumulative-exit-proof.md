# Work Item 05 — Prove Stable People And Profiles Across Membership Changes

- Status: Active
- Stage: [Stage 1 — Household People](README.md)
- Owner: `codex/stage1-exit-proof`
- Pull request: [#205](https://github.com/cill-i-am/meal-planner/pull/205) (draft)
- Completed by: Not completed

## Household Outcome

An adult's profile belongs to their stable household person, not to a particular
invitation or membership. Information recorded before they join survives account
linking. Departure and return preserve the same person, facts, immutable profile
versions, and audit history, while current membership and linkage determine
whether that adult may read or confirm the profile.

## Accepted Direction

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0005 — MVP scope and deferrals](../../../decisions/product/0005-mvp-scope-and-deferrals.md)
- [ADR 0001 — Separate household people from auth members](../../../architecture/decisions/0001-separate-household-people-from-auth-members.md)
- [ADR 0010 — Coordinate membership departure before person archival](../../../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md)
- Work Items [01](01-person-registry-and-lifecycle.md),
  [02](02-account-linking-invitations-and-departure.md), and
  [03](03-profile-authority-versioning-and-audit.md).

## Scope

### In scope

Extend two existing authenticated runtime tracers to prove the joins between
person lifecycle, account linking, and immutable profile history. Reuse the
existing Website Worker, API, Better Auth D1, private Worker, HouseholdObject,
and native departure Workflow composition. Record fresh cumulative evidence.

### Out of scope

No new product functionality, command, endpoint, UI, schema, dependency,
infrastructure, authority, compatibility path, or migration. No interview,
transcript, Agents SDK, model, routine, planning, or Stage 2 implementation.
This record does not mark Stage 1 complete or authorize Stage 2.

## Product Semantics And Authority

Existing commands retain their implemented semantics. Better Auth owns immutable
user identity, invitations, and current membership. HouseholdObject owns person
and account-link facts, profile versions, audit entries, and mutation receipts
in household-local SQLite through Drizzle. Membership admission precedes private
routing; self confirmation additionally requires the caller's current account
link to the target adult. Another adult may enter provisional information but
cannot claim to be the subject confirming it.

Profile history is household-visible to admitted adults, including while its
subject is archived. Departure revokes access before product-state archival;
return re-establishes authority for the same person rather than creating a new
profile. Existing local transaction, privacy-safe projection, replay, collision,
stale-version, and safety-confirmation rules remain unchanged. No external
operation moves inside a household transaction.

## Vertical Tracers

1. A creator bootstraps their person and creates an unlinked adult. They record a
   provisional food preference before inviting that adult. Real Better Auth
   acceptance and household linking resolve to the existing person. After a
   runtime restart, the linked adult reads the byte-identical original profile
   and audit and confirms the same fact as themselves. The original version
   remains unchanged and available to the creator.
2. A linked adult has a household profile. The real departure protocol removes
   membership and archives their person. After restart, another admitted adult
   reads the unchanged profile, version, and audit; the departed account cannot
   read it. Re-invitation and acceptance restore the same historical person.
   The returned adult reads unchanged history and successfully self-confirms the
   same fact without replacing its identity or original version.

These focused extensions compose with existing tests for creator/non-creator
races, dependants, exact mutation replay and collision, stale profile versions,
safety reduction, concurrent adult edits, and outsider denial. They do not
replace those tests with one oversized scenario or assert authority through a
mock session.

## Acceptance Evidence

- [x] Both extended real-runtime tracers pass locally; exact-head review remains pending.
- [x] Existing household boundary suite passes, including outsider profile read,
      history, audit, and mutation denial.
- [x] Existing browser-operation and panel tests pass for roster/link/departure
      and profile edits, safety confirmation, unresolved commands, and reauth.
- [x] Root check, lint, formatting, tests, build, and diff check pass locally.
- [ ] Hosted CI passes on the frozen head.
- [ ] Independent exact-head review is accepted by the orchestrator.

Browser tests prove the shipped interaction contracts; the real runtime suite
proves authenticated authority and persistence. No new full-browser authenticated
journey or live-cloud test is claimed. No cloud, provider, deployment, retailer,
or real-email operation is authorized or required here.

## Review Risk

The principal risk is overstating composition: an unchanged person ID alone does
not prove profile or audit continuity, and a fake account association does not
prove renewed self authority. Assertions must compare committed history and
exercise real invitation, membership, linkage, departure, and return paths.
Independent exact-head review is required. Any production failure discovered by
these tests must be reproduced and reviewed as a bounded correction, not used
to justify a speculative refactor.

## Delivery Log

- 2026-09-05: Started from freshly fetched main
  `2fb37db0baa0c50f31afe658da9303c7a13bcd4c`; HEAD, remote main, and merge-base
  were identical and the new worktree was clean. The initial sandboxed pinned
  pnpm run stopped at registry signature verification before executing tests.
  The permitted retry verified the pinned pnpm release. No gate was weakened.
- 2026-09-05: The first executed focused run passed both extended tests
  (2 passed, 51 skipped). No production defect or production change was needed.
  Fast-forwarded the owned branch to merged PR #204/main
  `5d629f0f3e1e9e7c2006d2b7a0c14fd235015013`, preserving the test changes.
  WI04 is accepted as boundary evidence only. Stage 1 remains Active.
- 2026-09-05: Local final verification passed: `pnpm check`, `pnpm lint`,
  `pnpm format:check`, `pnpm test`, `pnpm build`, and `git diff --check`.
  Full tests: 1,068 (128 root/Alchemy, 24 household contract, 31 import contract,
  95 web, 790 API). The API run includes all 53 household boundary tests;
  the web run includes roster/profile browser-operation and panel coverage.
  Explicit pinned-formatter stdin verification covers delivery Markdown because
  the checkout's local Git exclude hides docs from ordinary discovery.
  No schema, migration, production, or container code changed; no redundant
  local synthetic-container build was run. Hosted CI retains that required gate.
  PR #205 owns the frozen-head CI and independent-review evidence; neither is
  replaced by these local results.
