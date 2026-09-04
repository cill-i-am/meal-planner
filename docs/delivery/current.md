# Current Delivery State

- Last updated: 2026-09-04
- Delivery source of truth: this repository

## Active Stage

### Stage 1 — Household people, profiles, and permissions

- Stage record:
  [`stages/01-household-people/README.md`](stages/01-household-people/README.md)
- Status: Active
- Immediate delivery target:
  [`03-profile-authority-versioning-and-audit.md`](stages/01-household-people/03-profile-authority-versioning-and-audit.md)
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
repairable. Work Item 02 also configures
`organization({ disableOrganizationDeletion: true })` so neither the public nor
typed Better Auth deletion operation can erase the organization and its
memberships before the separate household deletion lifecycle exists. That
accepted prerequisite promoted Work Item 02 to implementation.
[PR #201](https://github.com/cill-i-am/meal-planner/pull/201) delivered the
Better Auth invitation-to-existing-person link, explicit repair and same-person
return, and the native access-first departure Workflow with both crash-window
reconciliation paths. Before contacting Better Auth,
the API durably binds the original person, payload digest, and mutation to a
deterministic provider invitation ID. After an ambiguous response or refresh,
the browser replays the exact retained invitation command with its original
person, intended email, payload, and mutation. If Better Auth was not reached,
that replay creates the missing original deterministic invitation; if Better
Auth committed but its response was lost, it reads and reuses that same
invitation. The separate association operation remains read-only with respect
to provider creation. No path lists opaque candidates, guesses among
same-household invitations, matches by email or name, or mints a replacement
person, invitation, or mutation. The browser also retains the original
departure request before submission and rediscovers its durable operation by
that exact preparation mutation after a lost response or refresh. Its status,
retry, and cancellation actions continue against the same operation through
pending, revocation-repair, finalization-repair, and terminal states. Full local
repository, real Better Auth D1 plus routed-object, twice/no-diff generation,
and container evidence passed for the corrected implementation. PR #201 merged
on 2026-09-04 as `9a59f85170f379e065920eadaaf69593d90c2c40`, following final
review of `34a376cb9a35fd6f177a0bf8b40e5c1dee938bd9` and green hosted
[run 33910287961](https://github.com/cill-i-am/meal-planner/actions/runs/33910287961).
Work Item 02 is `Done`. Work Item 03 is `In progress` on this merged foundation;
its first profile persistence, history, audit, and exact replay tracer passes.
The remaining safety, authorization, concurrency, restart, and UI proof is not
yet completion evidence.

Organization-deletion behavior remains out of scope. Work Item 04 remains
`Proposed`.

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

1. Verify the docs-only replacement head and its hosted CI exactly, then make
   the authorized final disposition for Work Item 02 and PR #201.

## Deliberate Non-Work

Do not start Work Items 03 or 04, retailer integration, full pantry inventory,
calories/macros, medical goal systems, MCP delivery, embedded channels, or
generic organization support while Work Item 02 remains the immediate target.
Do not implement organization deletion; keep it disabled until its accepted
household cleanup and tombstone lifecycle is separately authorized and ready.
