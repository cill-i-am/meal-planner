# Library consolidation

Each outcome below owns one proposed scope and acceptance list. Start with the
actual implementation, not an old planning snapshot. A merged plan is not a
completed implementation dependency. Historical proposals remain available through
immutable links in the owning records; they are not additional active plans.

1. [One browser Effect runtime](01-browser-runtime.md) supplies the shared lifecycle.
2. [Remaining private-client state](02-private-client.md) reuses that delivered pattern.
   TanStack/base Agent adoption already landed in #218; do not repeat it.
3. [Form validation and JSON equality](03-forms-and-json.md) can proceed independently
   where file ownership permits; equality adoption is conditional on equivalence.
4. [Optional dependency-guard assessment](04-architecture-guard.md) must prove a net
   reduction or explicitly retain the current guard. It does not block browser work.

Coordinate shared profile schemas, submission adapters, manifests and lockfile.
No LiveStore rollout, product-model replacement, provider evaluation, persistence
migration, cloud operation or deployment is included simply by accepting this index.

## Documentation review sequence

[Framework PR #234](https://github.com/cill-i-am/meal-planner/pull/234) is the
prerequisite for all seven planning PRs below. They update these four canonical
records instead of introducing competing work items under `docs/delivery/`.
Companion PRs are stacked so their diffs extend the same record rather than
repeating its proposal, status or acceptance in another document.

| Owning outcome | Planning PRs, in review order |
| --- | --- |
| [Browser runtime](01-browser-runtime.md) | [#219: outcome and runtime design](https://github.com/cill-i-am/meal-planner/pull/219), then [#220: failure and cutover verification](https://github.com/cill-i-am/meal-planner/pull/220) |
| [Private client](02-private-client.md) | [#221: remaining state ownership](https://github.com/cill-i-am/meal-planner/pull/221), then [#222: native privacy and recovery verification](https://github.com/cill-i-am/meal-planner/pull/222) |
| [Forms and JSON](03-forms-and-json.md) | [#223: equality disposition and shared outcome](https://github.com/cill-i-am/meal-planner/pull/223), then [#224: form validation and confirmation](https://github.com/cill-i-am/meal-planner/pull/224) |
| [Architecture assessment](04-architecture-guard.md) | [#225: optional adopt-or-retain assessment](https://github.com/cill-i-am/meal-planner/pull/225) |

Land #234 before its dependants. After each prerequisite merges, retarget its
children to the surviving base and rerun the relevant checks; keep only each
child's own changes in its diff. Merging a child into an unmerged prerequisite
would change that prerequisite's scope, not deliver an independent follow-up.
The runtime dependency between outcomes 1 and 2 still requires a delivered,
verified implementation; merging these documentation PRs does not satisfy it.
