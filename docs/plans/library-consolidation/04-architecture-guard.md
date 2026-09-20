# Assess a library for dependency checks

Status: proposed
Owner: unassigned
Delivery: a tested decision to adopt the library or keep the existing checks

## Outcome and scope

Find out whether a pinned dependency-cruiser release can replace a useful part of
our custom dependency analysis without weakening D1 protections. Keeping the current
checks is a valid result when the evidence supports it. Do not add another CI tool
while retaining almost all the custom analysis. This work is optional and lower
priority than the browser cleanup.

## Approach and adoption gate

Separate three jobs the current code does: checking general imports and dependency
relationships; checking which D1 resources, tables, migrations and callers are
allowed; and finding tracked and untracked production source files. A generic
dependency tool does not automatically replace all three.

Try the candidate with the current Node and TypeScript versions, aliases,
ESM/CommonJS and tsconfig behavior. Use minimal configuration, not another project
model or a custom parser wrapper.

Adopt it only if it preserves existing generic test results, still catches attempts
to bypass D1 rules, and removes a useful maintenance responsibility. Include the
new configuration, dependencies and extra parsing pass in the comparison. If the
D1 analysis still needs most of the compiler traversal, delete the experiment and
keep the current guard. The before/after comparison is a temporary check, not a
reason to run two permanent systems.

## Source and coordination

Inspect `scripts/global-d1-architecture.ts`, its tests,
`scripts/owned-source-files.ts`, root structural tests, API/root tsconfigs and CI.
Preserve the accepted D1 resources, migration roots, table identities, allowed
callers, expression forms and aliases.

Coordinate root scripts, manifests and the lockfile. This investigation must not
block unrelated browser work. It does not move source files, add a lint engine or
ts-morph wrapper, rewrite providers or migrate a database.

## Acceptance

- [ ] Check that the captured source snapshot and existing guard tests agree.
- [ ] Forbidden dependencies, unresolved imports and cycles fail with useful file
  locations. Do not suppress peer or resolution errors to make the tool work.
- [ ] Resource, table, migration and call violations still fail, including aliases,
  re-exports, supported expressions and new callers.
- [ ] Tracked and untracked production-file checks cover the files the compiler
  actually sees. The new tool neither omits source nor loosens an allowlist.
- [ ] List exactly which helpers or responsibilities disappear and which remain.
  Show lower total maintenance, not just a shorter file.
- [ ] Either replace the applicable generic checks and pass all relevant tests, or
  record the concrete reason to keep the current guard and remove unused prototype
  dependencies and configuration.

Use the affected architecture test cases and required repository checks. Broaden
verification only for actual dependency or execution changes. An assessment that
does not change runtime behavior needs no browser, provider or cloud run. Keep
unrelated findings out of this task. This plan is not compatibility evidence.

## Original proposals

These proposals were written against
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. The linked commits preserve that
history; they do not prove that the work or package compatibility checks are done.
Check current code and versions when starting implementation. #218 has since
merged, so do not repeat its migration or restore its old private-session design.
Historical handoff instructions do not override a new implementation assignment.

- [#224 source](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md), head `133dc9ec26b40ece7de230e387308c15a76ba974`.
- [#225 source](https://github.com/cill-i-am/meal-planner/blob/fb325789506471d8d4a43959f85c9d625351a970/docs/delivery/library-consolidation/04-architecture-guard-assessment.md), head `fb325789506471d8d4a43959f85c9d625351a970`.
