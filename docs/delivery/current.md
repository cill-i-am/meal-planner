# Current Delivery State

- Last updated: 2026-09-06
- Delivery source of truth: this repository

## Latest Completed Stage

### Stage 1 — Household people, profiles, and permissions

- Stage record:
  [`stages/01-household-people/README.md`](stages/01-household-people/README.md)
- Status: Done (2026-09-05)
- Completed by:
  [`05-cumulative-exit-proof.md`](stages/01-household-people/05-cumulative-exit-proof.md)
  ([PR #205](https://github.com/cill-i-am/meal-planner/pull/205), merge
  `e77f2cf2a2e634fd43cab588980a73ee7ae9b6d2`)
- Active implementation: three prioritized risk fixes with independent owners; merge order is private output, D1 release safety, then media lifetime. Broader Stage 2 remains paused.

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
Work Items 02 and 03 are `Done`.
[PR #202](https://github.com/cill-i-am/meal-planner/pull/202) merged on 2026-09-05
as `b509ba53ce1ac1326e86a9e826bdf58cbb0e7856` from final head
`44ffffc889a8b1893229906fe64c82fcf76c1bf3` after user approval and green hosted
[run 33951078370](https://github.com/cill-i-am/meal-planner/actions/runs/33951078370).
Focused proof covers profile persistence, immutable history and audit, exact
replay, safety confirmation, adult-edit races, archival/restoration, restart,
cross-household denial, dependant confirmation, and retained ambiguous UI
commands. Local repository tests, static checks, builds, and twice/no-diff
Household and D1 generation passed for the merged profile implementation.

The final UI correction additionally proves that delayed callbacks from an older
command cannot clear a newer unresolved command, and that authentication expiry
preserves the exact command through sign-in and explicit retry. Its affected web
suite passes 95 tests; root static checks and the web production build pass.
These corrections are included in the merged PR #202 head.

[PR #203](https://github.com/cill-i-am/meal-planner/pull/203) merged the seven-pass
cleanup on 2026-09-05 as `2fb37db0baa0c50f31afe658da9303c7a13bcd4c`.
It includes #202 unchanged at the profile feature and migration boundaries.
The combined branch passed all 1,068 repository tests and static/build checks;
the independent implementation review found no unresolved issues. Native
upgrade tests preserve completed provider settlements, including expired replay,
under the explicitly approved
[ADR-0011](../architecture/decisions/0011-canonicalize-completed-conservative-settlements.md).
[The cleanup delivery record](anti-slop-cleanup.md) owns its detailed evidence.

Work Item 04 now has a
[provider-free SDK boundary record](stages/01-household-people/04-agents-boundary-evidence.md).
Actual `agents@0.22.0` sub-agents run on the pinned local Miniflare/workerd
runtime, retain metadata across restart, and admit synthetic participant-only
access without a Household grant. The recommendation is to defer interview
implementation intact to Stage 2. That historical probe left production auth/link composition, the Alchemy bundle,
and passive/in-flight revocation as integration gates. The bounded
[private-output safety fix](private-output-safety.md) now implements and locally
exercises those boundaries; independent review and merge remain pending.
Stage 1's cumulative exit evidence is accepted through merged PR #205.
Organization deletion and conversation implementation remain out of scope.

[PR #204](https://github.com/cill-i-am/meal-planner/pull/204) merged the accepted
Work Item 04 boundary disposition on 2026-09-05 as
`5d629f0f3e1e9e7c2006d2b7a0c14fd235015013`, after independent review of
`2d607a77a509fec64047678add31fdab02053eea` and green hosted
[run 33974785385](https://github.com/cill-i-am/meal-planner/actions/runs/33974785385).
Work Item 04 is Done as boundary evidence, not conversation implementation.
No Stage 1 grant was implemented. The bounded Stage 2 handoff remains Proposed;
Stage 1 completion does not authorize starting it.

PR #205 merged on 2026-09-05 as `e77f2cf2a2e634fd43cab588980a73ee7ae9b6d2`
after independent review of `1b625121e835bc531fe7f5b6cd17bd04949c361e`
found no issues. All 1,068 local tests and both hosted checks in
[run 33975759741](https://github.com/cill-i-am/meal-planner/actions/runs/33975759741)
passed. The cumulative proof preserves profile, version, audit, and person
identity through invitation/linking and departure/return, including renewed
self-confirmation and departed-account denial. No production change was needed.

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

The dependency upgrade merged in PR 209 as
`4b4e7fd651d66c2a03805eb00209c40fe3eb3240`. The
[prioritized risk fixes](prioritized-risk-fixes.md) record owns the
user's next-fix order: private output after authority changes, D1 release-ledger
safety, then media-container lifetime. All three fixes have independently owned implementation lanes under standing
repository delivery authority. Their merge order remains 1, then 2, then 3. This bounded queue
does not promote the broader Stage 2, UI, model/provider, or cost-tuning roadmap.

## Deliberate Non-Work

Beyond the explicitly authorized private-output safety boundary, do not start
interview/chat runtime, model/provider work, retailer integration, full pantry inventory,
calories/macros, medical goal systems, MCP delivery, embedded channels, or
generic organization support as part of this boundary investigation.
Do not implement organization deletion; keep it disabled until its accepted
household cleanup and tombstone lifecycle is separately authorized and ready.
