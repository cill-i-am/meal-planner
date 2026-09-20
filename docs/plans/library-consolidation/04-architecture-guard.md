# Assess generic dependency tooling

Status: proposed
Owner: unassigned

Delivery: a separately assigned, verified implementation or bounded no-adoption result

## Outcome and scope

Determine whether a pinned dependency-cruiser can remove a meaningful generic
parser/resolver/traversal responsibility while preserving semantic D1 protections.
A documented no-adoption result is a successful bounded assessment. Do not add
another CI tool merely to retain almost all custom analysis or weaken ownership
checks. This is independent and lower-priority than browser consolidation.

## Approach and adoption gate

Classify the actual rules into generic dependency graph checks, semantic D1
resource/table/migration/consumer identity checks, and tracked/untracked source
inventory. A generic graph tool does not automatically replace the latter two.
Probe current Node/TypeScript, aliases, ESM/CommonJS and tsconfig behavior using
minimal configuration, not a second project model or custom parser wrapper.

Adopt only if existing generic fixture decisions remain, semantic D1 fixtures still
reject bypasses, a meaningful maintained responsibility disappears and added
configuration/dependencies do not outweigh the reduction. Compare the same baseline
and prototype, including an extra parsing pass. If semantic analysis still needs
most of the compiler traversal, remove the disposable probe and retain the guard.
A before/after comparison is evidence, not permanent dual enforcement.

## Source and coordination

Inspect `scripts/global-d1-architecture.ts`, its tests, `scripts/owned-source-files.ts`,
root structural tests, API/root tsconfigs and current CI. Preserve actual accepted
D1 resources, migration roots, table identity, allowed consumers and supported
expression/alias semantics. Coordinate root scripts, manifests and lockfile, but
this assessment must not block unrelated browser outcomes. No source relocation,
new lint engine, ts-morph wrapper, provider rewrite or database migration.

## Acceptance

- [ ] Current source and existing guard/tests agree on the captured baseline.
- [ ] Applicable forbidden edges, resolution failures and cycles fail with useful
  locations; toolchain compatibility has no peer/resolution suppression.
- [ ] Resource/table/migration/call violations still fail, including aliases,
  re-exports, supported expression forms and newly introduced consumers.
- [ ] Tracked/untracked production source rules cover the actual compiler inventory;
  the new tool does not omit a source or loosen an allowlist.
- [ ] Exact removed helpers/responsibilities and remaining ownership demonstrate
  a net maintenance benefit, not just a line-count change.
- [ ] Either qualifying generic checks replace their old owner and all relevant
  fixtures pass, or no-adoption evidence explains the concrete overlap/failure and
  leaves no unused prototype dependency/configuration.

Use affected root architecture fixtures and required checks. Broaden tests for
actual dependency/execution changes; no browser/provider/cloud run is necessary
for an unchanged runtime with assessment-only findings. Keep unrelated findings
outside this bounded outcome. No compatibility proof is claimed by this record.


## Proposal provenance

Consolidated from the overlapping planning PRs below. Those PRs remain open and
unchanged; this is the owning proposed scope on the refactor branch, not evidence
of implementation or dependency compatibility. The original planning baseline was
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`; recheck actual source/versions when
assigned. #218 has since merged. Old first-pass/handoff instructions and the
then-current plain-session runtime assumption are not new implementation rules.

- [#224 source](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md), head `133dc9ec26b40ece7de230e387308c15a76ba974`.
- [#225 source](https://github.com/cill-i-am/meal-planner/blob/fb325789506471d8d4a43959f85c9d625351a970/docs/delivery/library-consolidation/04-architecture-guard-assessment.md), head `fb325789506471d8d4a43959f85c9d625351a970`.
