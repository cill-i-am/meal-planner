# Current Delivery State

- Last updated: 2026-09-03
- Delivery source of truth: this repository

## Active Stage

### Stage 1 — Household people, profiles, and permissions

- Stage record:
  [`stages/01-household-people/README.md`](stages/01-household-people/README.md)
- Status: Active
- Immediate delivery target:
  [`02-account-linking-invitations-and-departure.md`](stages/01-household-people/02-account-linking-invitations-and-departure.md)
  (`In progress`)

Work Item 01 is complete. [PR #198](https://github.com/cill-i-am/meal-planner/pull/198)
merged its accepted person-registry implementation as
`9666a8bdae97bd9d6bf4efd98e30d03d617ccb31` on 2026-09-01 after its recorded
runtime, hosted-CI, and exact-head review gates. The merged stable person,
creator link, audit, receipt, API/UI, and isolation evidence is now the base for
Work Item 02.

The Work Item 01 identity boundary derives a stable household-scoped linkage
subject from immutable Better Auth user plus organization identity, separately
from its audit actor. Better Auth's actual `owner` membership role is the only
creator-bootstrap authority; other admitted members are denied before private
household routing. The roster carries canonical creator-slot availability
independently from both roster size and the requesting account link.
Deterministic domain failures are single-attempt. A pending or outcome-ambiguous
person mutation is the sole admitted roster command: the UI freezes sibling
actions and preserves the exact submitted payload and mutation ID until the
same command obtains a definitive result. The forms validate names before
submission and treat malformed generated-client responses as ambiguous rather
than deterministic domain failures. The public roster query rejects unknown
options. The cumulative runtime proof now covers the full Work Item 01 roster,
restart/restore history, owner/member bootstrap concurrency, and denied
cross-household mutation collisions.

[ADR-0010](../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md)
now fixes the missing cross-authority departure contract: `MealPlannerApi`
durably creates one deterministic native Cloudflare Workflow before the
authenticated Better Auth removal, the Workflow waits for an outcome signal
and reconciles a missing removal or lost signal by canonical membership read,
and only proven membership absence permits exact-purpose household
finalization. Every partial state remains durable, visible, bounded, and
repairable. Work Item 02 must also configure
`organization({ disableOrganizationDeletion: true })` so neither the public nor
typed Better Auth deletion operation can erase the organization and its
memberships before the separate household deletion lifecycle exists. That
accepted prerequisite promoted Work Item 02 to implementation. Draft
[PR #201](https://github.com/cill-i-am/meal-planner/pull/201) now has the working
Better Auth invitation-to-existing-person link, explicit repair and same-person
return, and the native access-first departure Workflow with both crash-window
reconciliation paths. Its focused recovery correction is frozen at
`accc194dc61cd19ab6fb796680fb4d1e5255052d`: after either household
association failure or an ambiguous Better Auth create response, the browser
surface preserves the original person, payload, and mutation ID and lets the
organizer explicitly select and associate an exact privacy-safe pending
invitation ID. It never replays invitation creation or matches by email or
name. The same surface retains the exact departure operation ID and exposes
only admitted status, retry, and cancellation actions for durable pending and
repair states. Full local repository, real Better Auth D1 plus routed-object,
twice/no-diff generation, and container evidence is green. Hosted CI and a
fresh independent exact-head review remain pending, so Work Item 02 stays `In
progress` and PR #201 stays draft. Organization-deletion behavior remains out
of scope, and Work Items 03 and 04 remain `Proposed`.

## Completed Foundation

- [PR #198 — person registry and lifecycle](https://github.com/cill-i-am/meal-planner/pull/198)
  merged on 2026-09-01 as
  `9666a8bdae97bd9d6bf4efd98e30d03d617ccb31`. Work Item 01 is `Done`.
- [PR #189 — household product blueprint](https://github.com/cill-i-am/meal-planner/pull/189)
  merged on 2026-08-27. Its product decisions, ADRs, and repository-owned
  delivery model are accepted direction.
- Stage 0 is complete. The household-authority foundation and cutover landed
  through [PR #182](https://github.com/cill-i-am/meal-planner/pull/182),
  [PR #183](https://github.com/cill-i-am/meal-planner/pull/183),
  [PR #186](https://github.com/cill-i-am/meal-planner/pull/186),
  [PR #187](https://github.com/cill-i-am/meal-planner/pull/187),
  [PR #188](https://github.com/cill-i-am/meal-planner/pull/188),
  [PR #190](https://github.com/cill-i-am/meal-planner/pull/190),
  [PR #191](https://github.com/cill-i-am/meal-planner/pull/191), and
  [PR #192](https://github.com/cill-i-am/meal-planner/pull/192).
- One `HouseholdObject` per Better Auth organization is the canonical writer for
  household product state. Better Auth D1 remains the identity, organization,
  membership, invitation, and role control plane. The remaining shared D1 owns
  only global provider accounting.

## Immediate Next Steps

1. Publish the single corrected Work Item 02 evidence head and own its hosted
   CI without changing its draft status.
2. Run a completely fresh independent exact-head review after hosted CI passes;
   do not make a merge decision from green CI alone.

## Deliberate Non-Work

Do not start Work Items 03 or 04, retailer integration, full pantry inventory,
calories/macros, medical goal systems, MCP delivery, embedded channels, or
generic organization support while Work Item 02 remains the immediate target.
Do not implement organization deletion; keep it disabled until its accepted
household cleanup and tombstone lifecycle is separately authorized and ready.
