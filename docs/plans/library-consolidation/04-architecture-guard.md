# Assess a library for dependency checks

Status: proposed
Owner: unassigned
Delivery: a tested replacement for some guard code, or evidence for keeping it

## Outcome and context

Find out whether a pinned dependency-analysis tool can replace a useful part of
the architecture guard without losing its D1 protections. Keeping the current
guard is a valid result when tests show why. Adding another analyzer alone is not.

This is the optional work previously described in both #224 and #225. It is lower
priority than browser and form cleanup. The [review sequence](README.md) describes
the documentation order; browser implementation does not depend on this assessment.

## Scope

Assess `dependency-cruiser` for the general dependency-graph checks already in
`scripts/global-d1-architecture.ts`. Change only the configuration and invocation
needed, and only if the replacement preserves protection and reduces maintenance.

Keep the same D1 resources, migration roots, table identities, allowed callers and
calls, symbol/alias handling, and source-file coverage. Do not move application
source, migrate databases, rewrite providers, add a lint platform or ts-morph
wrapper, invent architecture rules, or replace the build system. The
[household reference](../../reference/household.md), not a new tool, defines who
can read and write household data.

## Approach and trade-offs

### Establish what the guard does

Read the guard, fixtures, callers, TypeScript configuration, and CI. Run the existing
local checks and separate pre-existing failures from failures caused by the trial.
Keep a short list of responsibilities here. Leave exact rules and allowed callers
in source and tests, rather than copying another list into the plan.

Separate these three responsibilities:

| Responsibility | What to do |
| --- | --- |
| Existing module resolution, forbidden imports, and cycle checks | Consider these for the library, only where already enforced |
| D1 resources, tables, migrations, callers, and supported expression forms | Preserve the checks that understand their meaning |
| Tracked/untracked production files and compiler input | Preserve complete source coverage |

Trace helpers such as `scripts/owned-source-files.ts` before adding another way to
identify source files. Use the post-#218 code, not a frozen September 16 list.
An import graph cannot by itself identify D1 resources, permitted calls, or all
production source files.

### Try the smallest useful replacement

Test one pinned candidate against the actual Node/TypeScript versions, workspace
aliases, ESM/CommonJS, and tsconfig settings. Compare the old and new tools on the
same snapshot and fixtures with minimal configuration. Do not rebuild most of the
old parser or resolver in a wrapper around the new tool.

Before permanent adoption, name the helpers, compiler traversals, and responsibilities
that would disappear. Compare configuration, dependencies, commands, diagnostics,
tests, and extra parsing passes, not just line count. If the D1 checks still need
the compiler and almost all the old helpers, that is a reason to keep the guard,
not to weaken its checks.

### Choose based on the results

Adopt only if existing dependency decisions and useful diagnostics stay the same,
D1 and source-coverage checks still catch violations, meaningful old code can be
removed, and total maintenance falls without compatibility suppression. Add the
smallest passing replacement to the existing check entrypoint and delete the old
generic implementation.

Otherwise keep the guard, useful regression fixtures, and the concrete failing
case or unavoidable overlap. Remove unused trial packages and configuration.
Comparing both tools is a temporary test, not a reason to run both permanently.
Do not invent cycle/import rules or relax allowed-call lists to make the trial
look successful. Record the tooling decision here. Changing data ownership would
need a separate decision and is outside this work.

## Source and coordination

Read `scripts/global-d1-architecture.ts`,
`scripts/global-d1-architecture.test.ts`, `scripts/owned-source-files.ts`, root
structural tests, API/root tsconfigs, and workflows. Use manifests and the lockfile
for versions. An adopted analyzer is a development tool, not an unused production
dependency.

Coordinate shared scripts, configuration, and lockfile edits with other work.
The [runtime](01-browser-runtime.md), [private-client](02-private-client.md), and
[forms/JSON](03-forms-and-json.md) changes are not prerequisites. Leave unrelated
findings outside this plan.

## Acceptance

- [ ] Record one starting guard/source/fixture snapshot. Distinguish existing
  failures from changes caused by the candidate.
- [ ] Existing forbidden imports, resolution failures, and cycle rules give the
  same decisions and useful source locations on the real toolchain. Do not force
  peer dependencies, suppress resolution errors, or add new rules.
- [ ] Resource, table, migration, and caller violations still fail, including
  aliases, re-exports, supported expressions, and new consumers.
- [ ] Tracked/untracked production checks cover the compiler's actual source files.
  Omit no source and weaken no allowed-access list.
- [ ] Name the removed helpers and responsibilities and the D1-specific checks
  retained. Include configuration, dependency, CI, and extra parsing costs. Moving
  code or keeping both analyzers is not a reduction in maintenance.
- [ ] Either adopt the passing checks and remove the old generic code, or retain
  the guard based on concrete fixture/overlap evidence. Remove unused trial
  packages and configuration. An unfinished experiment is not a completed decision.

## Delivery and open questions

Run the current guard, list its responsibilities, and test the candidate. Then
finish either the replacement and its checks or the evidence for keeping the guard,
including cleanup. Whether `dependency-cruiser` reduces useful maintenance remains
an open question.

Use affected architecture fixtures and required repository checks. Broaden testing
when dependencies, commands, or CI change. An assessment that leaves the app
runtime unchanged needs no browser, provider, or cloud execution by itself.
Record starting and candidate commits, versions, commands, fixture results,
removed/retained code, and the decision here. Roll back a failed tooling change
without changing accepted resource ownership. No compatibility or execution results
are claimed by this proposed plan.

## Original proposals

This combines the architecture work from two proposals originally based on
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. Their separate workflow, permission,
and handoff text is historical. The [forms/JSON plan](03-forms-and-json.md) links
here rather than repeating this assessment as another completion requirement.

- [Original #224 proposal](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md).
- [Original #225 proposal](https://github.com/cill-i-am/meal-planner/blob/fb325789506471d8d4a43959f85c9d625351a970/docs/delivery/library-consolidation/04-architecture-guard-assessment.md).
