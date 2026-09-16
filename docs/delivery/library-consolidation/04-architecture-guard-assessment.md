# Phase 4 — Assess library-backed dependency rules

- Status: Proposed; optional assessment, not an approved unconditional rewrite.
- Owner: Next assigned implementation agent.
- Planned: 2026-09-16.
- Planning baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`.
- Track: Library consolidation; lower priority than Phases 1–3.
- Delivery authority: This PR is planning-only. Execute the assessment and any
  qualifying bounded change when assigned under the existing
  [execution policy](../../agents/execution-policy.md).

## Outcome and scope

Determine whether an established dependency-analysis library can remove a
meaningful portion of custom architecture tooling while retaining the current
D1 authority checks. Prefer `dependency-cruiser` for generic dependency graph
rules only when it actually simplifies the maintained implementation.

A documented no-adoption result is a successful assessment. Do not add another
CI tool merely to keep almost all the custom analysis alongside it. Do not
weaken symbol-level, resource, migration, or allowed-consumer checks in order to
make a generic graph validator appear sufficient.

The scope is the generic dependency-analysis portion of
`scripts/global-d1-architecture.ts`, its tests, and a minimal configuration/CI
entry only if adoption passes the gate. This does not authorize a broader lint
replacement, build-system migration, source move, database migration, deployment,
or rewrite of Alchemy providers.

## Accepted direction

- [Household authority](../../architecture/household-domain.md) and the current
  D1 resource/consumer contracts remain unchanged.
- [Repository workflow](../../agents/repository-workflow.md) owns delivery;
  required review and merge checks come from the execution policy.
- The proposed library choice is a technique, not a new source of architectural
  authority or permission to change the accepted resource inventory.

### Source map

- `scripts/global-d1-architecture.ts`: tracked-source inventory, TypeScript
  compiler program, module resolution, symbol/alias handling, expression
  interpretation, D1 resource and consumer assertions.
- `scripts/global-d1-architecture.test.ts`: existing adversarial fixtures and
  expected outcomes.
- `scripts/owned-source-files.ts` and architecture-related root tests: inspect
  whether source inventory is already shared before adding another abstraction.
- `apps/api/tsconfig.build.json`, `tsconfig.base.json`, root package/configuration,
  and GitHub workflows: current resolution, invocation, and CI semantics.

## Dependencies and coordination

This assessment has no runtime dependency on Phases 1–3. It can run independently
in an isolated worktree, but must coordinate changes to root scripts, manifests,
and `pnpm-lock.yaml` with other agents. It must not block delivery of the higher
value browser work.

Related planning PRs: [Phase 1 #219](https://github.com/cill-i-am/meal-planner/pull/219),
[Phase 2 #221](https://github.com/cill-i-am/meal-planner/pull/221), and
[Phase 3 #223](https://github.com/cill-i-am/meal-planner/pull/223).
Recheck active work, including [discovery #218](https://github.com/cill-i-am/meal-planner/pull/218),
before changing tracked-source expectations; do not freeze the old main's
inventory or overwrite another branch's valid changes.

## Implementation sequence

### 1. Classify the existing checks

Run the current local guard and tests after inspecting their scripts. Record
the actual implementation head and baseline results. Create a compact rule
inventory separating:

- Generic graph checks: module resolution, forbidden dependency directions,
  cycles, and ordinary allowed/forbidden imports where those are current rules.
- Semantic checks: exact D1 resources and migration roots, table identity,
  allowed API consumers/calls, aliases/re-exports, and the existing supported
  expression forms used to establish resource identity.
- Repository policy: tracked/untracked production sources and the compiler's
  authoritative source inventory.

Do not assume dependency-cruiser replaces the last two groups. Preserve their
existing acceptance meaning even if their implementation is reorganized.

### 2. Make one bounded compatibility and reduction probe

Evaluate a pinned dependency-cruiser version against the actual Node,
TypeScript, workspace aliases, ESM/CommonJS, and tsconfig settings. Use a
minimal configuration for the generic rules, not a second project description.
Do not reimplement the library's parser/resolver in a custom wrapper.

Before any permanent integration, list the exact helpers, code paths, and tests
that would disappear. Measure maintained production/configuration code and
review the remaining responsibilities; a line count alone is not proof of lower
complexity. Compare baseline/prototype checks on the same source and record
whether CI needs an additional parsing pass.

### 3. Apply the adoption gate

Adopt only when all of the following hold:

1. The generic rule fixtures pass with the same decisions and actionable errors.
2. Existing semantic D1 fixtures remain enforced without a bypass or weaker
   approximation.
3. A meaningful generic parser/resolver/traversal responsibility is deleted,
   rather than hidden behind a wrapper while the same engine remains necessary.
4. Configuration and one new dependency do not create more maintenance than
   the removed code; the supported runtime/toolchain remains intact.

If the current semantic guard still needs the compiler and most generic helper
code, stop the replacement. Remove disposable prototype dependencies/config,
record the measured overlap and concrete reason to retain the current tool, and
finish the assessment without a gratuitous runtime or CI change.

### 4. Integrate only the qualifying generic checks

If the gate passes, wire the minimal graph checks into the existing validation
entry point, preserve a small clearly owned semantic D1 guard, and delete the
now-unused generic paths. Do not leave two permanent authorities enforcing the
same generic rule. A before/after comparison is a verification technique, not a
new production dual-run architecture.

Keep fixtures that detect bypasses via aliases, re-exports, permitted expression
forms, untracked source, and newly added consumers. Test actual failures, not
snapshots of wording or a list of the current implementation's filenames.

## Acceptance evidence

| Scenario | Required evidence |
| --- | --- |
| Valid current source | Existing guard/tests pass and a qualifying replacement accepts the same source. |
| Generic violations | Actual fixtures for applicable forbidden edges, resolution failures, and cycles are detected with useful locations. |
| D1 identity and consumer violations | Existing resource/table/migration/call fixtures still reject, including alias/re-export bypass cases. |
| Source inventory | Required tracked-source/untracked-production checks survive; a second tool does not omit relevant compiler sources. |
| Toolchain compatibility | Chosen version works with the actual Node/TypeScript/workspace configuration without peer or resolution suppression. |
| Maintenance benefit | Specific responsibilities and helpers are removed; remaining semantic checks and configuration ownership are explicit. |
| No-adoption result | Bounded prototype, fixture findings, and overlap evidence justify retaining the current tool; no unused dependency/config remains. |

Run the affected root architecture tests and validation entry point, then
required `pnpm check`, `pnpm lint`, and `pnpm format:check`. Inspect unfamiliar
scripts before execution. Run broader build/test/CI gates when dependencies or
execution configuration change. No browser, provider, database, or cloud test is
required solely for an unchanged runtime with documentation-only findings.
Any actual workflow change needs the existing independent immutable-head review
before an authorized merge.

## Implementation constraints

Use the outcome inventory to bound the change. Do not add ts-morph, a second
lint engine, or another abstraction simply to make an AST implementation read
differently. Do not rewrite product boundaries or update allowlists to suppress
a real violation. Findings outside this scope belong in an explicit follow-up,
not an enlarged tooling migration.

Reference checked on 2026-09-16; installed compatibility remains to be proved:
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser).

## Agent handoff

When assigned, classify the guard, run the baseline, and perform one minimal
library probe. Report adopt or retain with concrete evidence. Only an adoption
that passes the gate proceeds to deleting code and changing CI. Update this
record with the actual head, checks, result, reviewed implementation head if
applicable, and any authorized merge. Do not turn an optional assessment into
an open-ended framework migration.

## Delivery record

- 2026-09-16: Planning-only assessment created using the repository work-item
  format. No prototype, dependency installation, guard change, test execution,
  CI modification, or deployment has been performed by this planning PR.
