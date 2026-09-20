# Assess generic dependency tooling

Status: proposed
Owner: unassigned
Delivery: a verified bounded adoption or an evidence-backed decision to retain the current guard

## Outcome and context

Determine whether a pinned dependency-analysis tool can remove a meaningful
maintained responsibility from the architecture guard while preserving its actual
D1 authority protections. A tested decision to retain the current guard is a
successful assessment; merely adding another analyzer is not.

This is the single optional outcome formerly described both in #224's third work
package and in #225. It is independent and lower-priority than browser and form
consolidation. The [review sequence](README.md) owns documentation dependencies;
no browser implementation depends on this assessment succeeding.

## Scope

Assess `dependency-cruiser` for the existing generic graph subset of
`scripts/global-d1-architecture.ts`. Change the minimal configuration/invocation only
if equivalent protection and a net maintenance reduction are demonstrated.

Keep exact D1 resources, migration roots, table identity, allowed consumers/calls,
symbol/alias interpretation and source-inventory policy intact. Exclude source
relocation, database migration, provider rewrites, a new lint platform, a ts-morph
wrapper, new architecture policies and broader build-system replacement.
[Household reference](../../reference/household.md) owns authority, not a new tool.

## Approach and trade-offs

### Establish the real baseline

Inspect the current guard, fixtures, callers, tsconfigs and CI. Run the existing
local checks and separate baseline failures from assessment failures. Capture a
small responsibility inventory in this plan; exact rules remain owned by source
and tests, not a copied mutable allowlist.

| Responsibility | Treatment in the assessment |
| --- | --- |
| Existing module resolution, forbidden edges or cycle rules | Candidate generic graph work, only where already enforced |
| D1 resource/table/migration/consumer identity and supported expression forms | Semantic guarantees retained by their actual owner |
| Tracked/untracked production sources and compiler inventory | Repository policy retained without omissions |

Trace shared helpers such as `scripts/owned-source-files.ts` before adding a second
source model. Use the current post-#218 inventory, not a frozen list from the
September 16 proposal. A module dependency graph does not by itself establish
resource identity, allowed D1 calls or complete production-source coverage.

### Probe the smallest useful replacement

Evaluate one pinned candidate against the actual Node/TypeScript, workspace aliases,
ESM/CommonJS and tsconfig settings. Use minimal configuration and the same repository
snapshot/fixtures for baseline and candidate. Do not implement another parser or
resolver wrapper to bridge most of the old guard back into the new tool.

Before permanent integration, identify exactly which helpers, compiler traversals
and maintained responsibilities would disappear. Compare configuration, dependencies,
invocation, diagnostics, test coverage and any extra parsing pass, not line count
alone. If semantic checks still require the compiler and almost all generic helpers,
that overlap is evidence against adoption rather than a reason to weaken them.

### Apply one explicit adoption test

Adopt only when the existing generic decisions and useful diagnostics are preserved,
semantic and source-inventory protections still detect bypasses, a meaningful old
responsibility disappears, and total maintenance is lower without compatibility
suppression. Then wire the smallest qualifying checks into the existing validation
entry point and remove their superseded generic owner.

Otherwise retain the guard, preserve useful characterization fixtures and record
the concrete incompatible case or unavoidable overlap. Remove unused probe packages
and configuration. A before/after comparison is a verification technique, not
permanent dual enforcement. Do not create new cycles/import policies or loosen an
allowlist to manufacture a success. A local tooling disposition belongs here;
changing consequential authority would require its own decision and is out of scope.

## Source and coordination

Inspect `scripts/global-d1-architecture.ts`,
`scripts/global-d1-architecture.test.ts`, `scripts/owned-source-files.ts`, root
structural tests, API/root tsconfigs and current workflows. Manifests and lockfile
own exact tooling versions; an adopted analyzer belongs with development tooling,
not an unused production dependency.

Coordinate root scripts, shared configuration and lockfile ownership with other
work, without treating [runtime](01-browser-runtime.md),
[private client](02-private-client.md) or [forms/JSON](03-forms-and-json.md) as
prerequisite implementation phases. Unrelated findings stay outside this outcome.

## Acceptance

- [ ] The current guard/source/fixtures establish one captured baseline, with any
  pre-existing failure distinguished from candidate behavior.
- [ ] Applicable existing forbidden edges, resolution failures and cycles retain
  their decisions and useful locations under the actual toolchain, without forced
  peers, resolution suppression or newly invented policies.
- [ ] Resource, table, migration and consumer-call violations still fail, including
  aliases, re-exports, supported expression forms and newly introduced consumers.
- [ ] Tracked/untracked production-source checks cover the actual compiler inventory;
  the replacement neither omits a source nor weakens an authority allowlist.
- [ ] The comparison names exact removed helpers/responsibilities and retained
  semantic ownership, including configuration/dependency/CI cost and extra parsing.
  Moving code or retaining both generic analyzers is not a maintenance reduction.
- [ ] Either all qualifying checks are adopted with equivalent fixtures and the old
  generic owner removed, or concrete fixture/overlap evidence justifies retention
  and leaves no unused prototype dependency/configuration. An unfinished probe is
  not recorded as a completed no-adoption result.

## Delivery and open questions

Next action: run the current guard and classify its actual responsibilities, then
perform the bounded compatibility/reduction probe. Continue to qualifying adoption
and verification, or finish with a supported retain result and cleanup. Whether a
generic tool removes meaningful maintenance is the open question, not an assumed
benefit of `dependency-cruiser`.

Use affected architecture fixtures and current repository checks; broaden validation
when dependencies or invocation/CI configuration actually change. No browser,
provider or cloud execution is necessary solely for assessment-only findings with
an unchanged application runtime. Record the baseline/candidate heads and versions,
exact commands, fixture outcomes, deleted/retained responsibilities and final result
here. Revert a failed tooling cutover without changing accepted resource ownership.
This plan currently records proposed work, not compatibility or execution evidence.

## Proposal provenance

This record consolidates the architecture scope from both original proposals.
Their baseline `c07e48c6f6709f02c054e5110cb7178a9e5d1b93` and separate permission,
workflow and handoff wrappers are historical; the current plan owns disposition.
The [forms/JSON plan](03-forms-and-json.md) links here rather than duplicating this
assessment as another completion requirement.

- [Original #224 proposal](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md).
- [Original #225 proposal](https://github.com/cill-i-am/meal-planner/blob/fb325789506471d8d4a43959f85c9d625351a970/docs/delivery/library-consolidation/04-architecture-guard-assessment.md).
