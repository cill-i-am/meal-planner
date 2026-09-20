# Reduce custom library plumbing

These four plans cover code we may be able to replace with supported libraries.
Each plan has one scope and acceptance checklist. Read the current code before
implementing it; a merged planning PR does not mean the work has been done.

1. [Share the browser's Effect setup](01-browser-runtime.md) across people and profile screens.
2. [Simplify private interview state](02-private-client.md) using that completed setup.
   TanStack and base Agent adoption already landed in #218; do not repeat it.
3. [Simplify forms and compare JSON data](03-forms-and-json.md). These two tasks can
   proceed independently where they do not change the same files. A replacement
   JSON helper must behave the same as the current one.
4. [Assess dependency-checking tools](04-architecture-guard.md). This is optional.
   Keep the current checks if a replacement would not reduce maintenance.

Coordinate edits to profile schemas, submit code, package manifests and the
lockfile. These plans do not include LiveStore rollout, a different product model,
provider evaluation, storage migration, cloud changes or deployment.

## Documentation review sequence

[Framework PR #234](https://github.com/cill-i-am/meal-planner/pull/234) merged on
2026-09-20. The seven planning PRs below update these same four files.
Each companion adds detail to its preceding PR instead of creating a second plan.

| Plan | PRs, in review order |
| --- | --- |
| [Browser setup](01-browser-runtime.md) | [#219: approach](https://github.com/cill-i-am/meal-planner/pull/219), then [#220: failure and switch-over checks](https://github.com/cill-i-am/meal-planner/pull/220) |
| [Private interview state](02-private-client.md) | [#221: remaining cleanup](https://github.com/cill-i-am/meal-planner/pull/221), then [#222: privacy and recovery checks](https://github.com/cill-i-am/meal-planner/pull/222) |
| [Forms and JSON](03-forms-and-json.md) | [#223: comparison helper and shared plan](https://github.com/cill-i-am/meal-planner/pull/223), then [#224: form behavior and checks](https://github.com/cill-i-am/meal-planner/pull/224) |
| [Dependency checks](04-architecture-guard.md) | [#225: assess a replacement](https://github.com/cill-i-am/meal-planner/pull/225) |

After a parent PR merges, retarget its children to the surviving base and check
their diffs. Each diff should show only that PR's changes. Do not merge a child
into an open parent just to clear the queue. Follow the live PR descriptions for
the writing cleanup's merge order.

The interview implementation needs the completed browser setup. Merging the two
plans alone does not satisfy that dependency.
