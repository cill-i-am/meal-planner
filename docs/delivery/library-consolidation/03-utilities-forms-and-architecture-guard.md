# Work Item — Library Consolidation 03: Utilities, Forms, and Architecture Guard

- Status: Proposed
- Owner: Unassigned; one implementation agent when delegated
- Stage / pull request: Library consolidation, phase 3; planning PR containing this file
- Planning date: 2026-09-16
- Reviewed baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`
- Implementation: Not started; no behavioral-equivalence proof is claimed

## Outcome and scope

Profile forms provide schema-backed validation using the libraries already installed, and genuinely generic utility/tooling code is removed only where a library preserves the application's actual behavior and reduces maintenance.

This phase has three bounded work packages:

| Package | Direction | Completion requirement |
| --- | --- | --- |
| 3A — Profile form validation | Effect Schema through Standard Schema into existing TanStack Form | Implement consistent validation while preserving explicit domain conversion and confirmation. |
| 3B — JSON structural equality | Prefer a behaviorally equivalent existing Effect facility or small established utility | Replace the handwritten recursion if equivalence is proven; otherwise record a precise no-go with counterexamples and keep the helper. |
| 3C — Architecture dependency checks | Conditional `dependency-cruiser` extraction | Implement only if existing generic import checks can be removed with equivalent protection and a measured net reduction; otherwise retain the guard and record why. |

A new dependency is not the success metric. In particular, this plan corrects the earlier audit's tentative suggestion that `fast-deep-equal` would be a straightforward drop-in: source inspection found semantic differences that must not be ignored.

Out of scope: browser runtime consolidation, private interview streaming, LiveStore, new product validation rules, broader model acceptance/repair, provider accounting redesign, database/resource changes, framework upgrades, and deployment. Do not turn a small cleanup into a new validation or architecture platform.

## Accepted direction

Use [repository workflow](../../agents/repository-workflow.md), [execution policy](../../agents/execution-policy.md), and the existing [delivery state](../current.md). The repository already documents the [TanStack Form + Effect Schema pattern](../../../.agents/skills/app-forms/references/tanstack-form-effect-schema.md): validate with `Schema.toStandardSchemaV1` and explicitly decode at submission because validation does not deliver transformed output.

Retain the profile authority and explicit confirmation behavior established by the current household/profile implementation and [private cards work item](../stages/02-private-discovery/02-progressive-cards-and-confirmation.md). Generic validation cannot decide whether a safety reduction, provisional fact, or confirmed Household command is permitted.

### Source map

- `apps/web/src/features/household-profiles/profile-fact-form.tsx`: `Fields`, `initialFields`, `decodeFact`, `commandFor`, live proposed meaning, and submit checks.
- `packages/household-api/src/profiles.ts`: shared profile fact/command schemas; reuse rather than duplicating domain constraints.
- `.agents/skills/app-forms/references/tanstack-form-effect-schema.md`: existing local validation/submission conventions.
- `apps/api/src/features/imports/import-forced-tool-response.ts`: `structurallyEqualJson` and the separate forced-tool-response acceptance policy.
- `apps/api/src/features/imports/import-provider-kernel.ts`: another equality consumer and provider execution/accounting boundary; inspect its actual accepted input domain.
- `scripts/global-d1-architecture.ts`: TypeScript/compiler-based architecture guard; distinguish dependency traversal from semantic resource/table/consumer checks before changing it.
- `package.json`, workspace manifests, `pnpm-lock.yaml`, `vitest.alchemy.config.ts`, and related tests/configuration: tools, checks, and dependency placement.

## Dependencies and coordination

This phase does not depend on phase 1 or phase 2 being implemented. It can be delegated in parallel. [Phase 1 plan #220](https://github.com/cill-i-am/meal-planner/pull/220) may change profile operation consumers; [phase 2 plan #222](https://github.com/cill-i-am/meal-planner/pull/222) may change interview/profile-refresh wiring. Keep this work confined to the form/utility/guard scope and coordinate any shared manifest or lockfile edit.

[PR #218](https://github.com/cill-i-am/meal-planner/pull/218) was open during planning and includes changes to `packages/household-api/src/profiles.ts`. Re-read its current state before implementing validation; do not restore an older shared schema or alter that PR's discovery contracts. Its separate import follow-ups are not automatically part of this utility replacement.

All three planning branches start independently from the reviewed `main`. Record the actual implementation base SHA. The plans do not replace the active product stage, and their existence is not implementation completion.

## Implementation plan

### 0. Establish a bounded baseline

- [ ] Read root/nested instructions, the current form skill, and the relevant source/callers/tests. Record the actual implementation SHA and overlap disposition.
- [ ] Run focused baseline checks for the touched areas. Preserve unrelated failures/work and record limitations.
- [ ] For each proposed replacement, name the existing generic code to delete and the product behavior to retain. Keep 3A, 3B, and 3C in separately reviewable commits or scoped implementation PRs as appropriate; this work item owns their disposition.

### 3A. Connect profile forms to Standard Schema

- [ ] Characterize the supported raw-form shapes and current behavior for new preferences, hard constraints, no-known-hard-constraints, ordinary edits, removal, and provisional facts.
- [ ] Define the smallest Effect schema/adapter for the actual form-input shape. Reuse shared `ProfileFactValue` validation after the explicit field-to-domain mapping rather than inventing a second set of domain constraints.
- [ ] Wire the schema into TanStack Form's relevant live/submit validators using the installed `Schema.toStandardSchemaV1` API, following the repository convention.
- [ ] Surface field/form issues through existing UI primitives and accessible associations. Invalid submission must explain the problem rather than merely doing nothing; avoid noisy errors before the chosen touched/submit state.
- [ ] Decode/transform explicitly in `onSubmit` before constructing the typed command. Preserve trimming and any branded/domain output; Standard Schema validation alone does not produce transformed submit values.
- [ ] Keep `decodeFact`/`commandFor` responsibilities, or an equally direct equivalent, for converting fields into variants and commands. Do not count these domain mappings as generic plumbing that must disappear.
- [ ] Preserve conditional validation across kind changes: fields irrelevant to the selected variant must not accidentally block a valid command. Preserve current removal semantics; do not silently change acceptance to simplify validation.
- [ ] Preserve explicit confirmation for safety changes and no-known-hard-constraints, provisional/confirmed distinctions, current-version guards, disabled/pending behavior, and exact-command recovery owned by the caller.
- [ ] Remove only duplicated validation/error-state plumbing. No additional schema/form library is required for this work.

### 3B. Prove equality semantics before choosing a replacement

The existing helper starts with `Object.is`, recursively compares ordered arrays, and compares record own keys independently of insertion order. It accepts `Schema.Json | undefined`; inspect actual boundary decoding and both callers rather than substituting arbitrary-object equality.

The inspected `fast-deep-equal` source starts with `===`, so `0` and `-0` compare equal there but are distinguished by the current helper, including inside arrays/objects. Its handling of `constructor`, `valueOf`, and `toString` also needs attention for valid JSON objects with those own property names. A top-level signed-zero check does not fix nested comparisons.

- [ ] Add a table-driven characterization corpus at the current helper and exercise the forced-tool and provider-kernel consumers with representative accepted inputs.
- [ ] Cover reordered object keys, changed/missing keys, nested arrays/objects, array order/length, null, strings/booleans/numbers, top-level optional `undefined`, and signed zero at top level and nested positions.
- [ ] Include valid JSON object keys named `constructor`, `valueOf`, `toString`, and `__proto__` using safe parsed fixtures. The replacement must not throw or change acceptance merely because a data key resembles an object method.
- [ ] Establish which values actually pass `Schema.Json` at the installed version. Non-finite numbers, sparse arrays, cycles, class instances, Maps, Sets, and arbitrary prototype behavior are not new feature requirements; reject or exclude them according to the existing boundary rather than broadening the helper's domain.
- [ ] First evaluate public facilities already available in the pinned Effect stack. Otherwise evaluate a small maintained equality library against the same corpus and actual bundle/runtime requirements. Record the exact package/version/source and resulting behavior, not just a benchmark or popularity claim.
- [ ] Replace the helper only when valid-domain behavior matches and meaningful custom recursion disappears. A tiny import adapter is acceptable; another recursive normalizer/comparator built around the library usually defeats the goal.
- [ ] If equivalence cannot be obtained without extra bespoke traversal or a semantic change, retain the existing helper, keep useful characterization tests, and record concrete counterexamples. Do not add an unused dependency or call a no-go a successful replacement.

Keep the surrounding forced-tool decoder intact. Unexpected tool names, conflicting mirrored results, invalid cardinality, malformed native envelopes, and competing results must retain their exact rejection meanings. Likewise, do not modify reserve/claim/settle behavior, cost limits, attempt identities, or reconciliation in the provider kernel as part of changing equality.

### 3C. Extract generic dependency rules only if it actually shrinks the guard

- [ ] Inventory the checks in `global-d1-architecture.ts` and their existing positive/negative fixtures. Classify each as module/import graph validation or semantic resource/table/allowed-consumer analysis.
- [ ] Prototype only the generic graph subset with `dependency-cruiser`, using the repo's actual TypeScript/module/path-alias configuration. Add it as a root development tool only if the prototype justifies adoption.
- [ ] Run old and proposed checks against the same disposable fixtures and actual repository graph. Include existing alias, re-export, forbidden consumer, and other supported dependency forms; do not quietly lose a check the old guard enforced.
- [ ] Retain semantic D1 resource declarations, migration roots, table identities, symbol/alias evaluation, and allowed consumer-call checks in the existing semantic guard unless separately proven equivalent. A module dependency graph is not proof of those properties.
- [ ] Compare custom analysis code/configuration, dependency overhead, command/CI maintenance, diagnostics, and test coverage before and after. Record what implementation is truly deleted, not just lines moved to a new wrapper.
- [ ] Adopt only when equivalent existing protection and a meaningful net simplification are demonstrated. Do not add cycles/architecture policies merely to manufacture a reason for another tool.
- [ ] Otherwise record a no-go and leave the guard and dependency graph unchanged. This is an explicit decision outcome, not an unresolved implementation task.

This package is conditional, not a requirement to install `dependency-cruiser`. Do not leave both generic analyzers permanently active over the same rules after an accepted cutover.

## Acceptance evidence

| Scenario | Expected evidence |
| --- | --- |
| Invalid and corrected profile fields | Component tests show relevant messages, proper field associations, blocked invalid submission, and successful correction. |
| Valid transformed submission | Whitespace/normalization is applied by explicit decoding and the resulting command matches the pre-refactor domain meaning. |
| Kind switch and irrelevant fields | Valid selected variants submit without hidden-field failures; invalid variants cannot bypass shared domain validation. |
| Safety, provisional, removal, and pending state | Existing confirmation/permission distinctions remain intact; disabled or unresolved workflows do not dispatch a new command. |
| Actual form UI | A local browser verifies representative create/edit/safety flows and accessible error presentation; no live household data or real provider action is needed. |
| Equality and decoder behavior | Characterization and consumer tests prove exact equivalence on the admitted input domain, or record the precise reason the helper remains. |
| Provider accounting | Existing relevant kernel tests remain green; no execution, budgeting, settlement, or acceptance-policy changes are hidden in the diff. |
| Architecture guard, if adopted | Actual repository graph plus positive/negative fixtures retain existing checks; semantic D1 protections still run; redundant generic analysis is removed. |
| Architecture guard, if rejected | Written scope/cost/coverage disposition explains why the original guard remains; no unused tool/configuration is left behind. |
| Overall simplicity | Inventory states deleted custom code, retained domain rules, added dependencies and their roles, and each optional package's honest disposition. |

### Verification commands

These are the reviewed manifest entry points. Inspect the current configs first and use local synthetic fixtures. Adjust only for actual implementation-checkout changes, then record exact commands/results.

```sh
pnpm install --frozen-lockfile
pnpm --filter @meal-planner/web exec vitest --config vitest.config.ts run src/features/household-profiles
pnpm --filter @meal-planner/api exec vitest run src/features/imports
pnpm --filter @meal-planner/web check
pnpm --filter @meal-planner/web build
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
```

If 3C changes the root guard/tooling, also run:

```sh
pnpm exec vitest run --config vitest.alchemy.config.ts
```

Run the actual configured dependency-cruiser rule command only if the implementation adds it; do not invent a script name in this plan. Run additional existing CI gates required for the touched files. After intentional manifest edits, regenerate the lockfile through repository conventions before final frozen install.

No tests have been run for this planning document. These commands are implementation requirements, not recorded passing results. Do not run Alchemy planning/deployment/destruction, target reconciliation, real providers, external messages, or data migrations for these cleanups.

## Implementation constraints

Pin any new dependency to a version verified against the checkout. Use a workspace runtime dependency only for a comparator actually imported at runtime; use a root development dependency for adopted architecture tooling. Do not add `fast-deep-equal` pre-emptively, add another schema library, or upgrade the broader stack to complete this phase.

Keep one writer for the lockfile and shared profile schema. Preserve existing authority, mutation IDs, stored values, error categories, and forced-tool acceptance. Roll back a failed cleanup by reverting the corresponding isolated code/dependency change, not by adding compatibility shims or altering durable data.

### Definition of done

3A is implemented and behaviorally verified. 3B has either a proven equivalent replacement with the old recursion removed, or a documented, tested no-go that preserves the helper. 3C has either equivalent, simpler adopted tooling or a recorded decision to retain the current guard. The delivery record distinguishes these outcomes explicitly; it must not claim that all suggested libraries were installed or all custom code was removed.

## Agent handoff

> Implement only Library Consolidation phase 3 from this work item. Start with the existing Effect Schema/Standard Schema/TanStack Form convention and preserve explicit domain conversion and safety confirmation. Characterize the JSON helper before replacing it; `fast-deep-equal` is not assumed equivalent, especially for signed zero and JSON method-name keys. Evaluate dependency-cruiser only for the current generic import-rule subset and adopt it only when existing protection and net simplification are proven. Keep domain validation, forced-tool acceptance, provider accounting, and semantic D1 checks intact. Record each package's implementation or tested no-go, verification commands, and final head here. Do not start phases 1/2, provider work, infrastructure changes, or deployment; follow the assigned delivery scope and repository execution policy.

## Delivery record

- 2026-09-16: Proposed using the existing work-item structure. Planning authorization covers separate documentation branches and open PRs only; application implementation has not started.
- Source basis: referenced current repository files, the form skill, [TanStack Form validation documentation](https://tanstack.com/form/latest/docs/framework/react/guides/validation), [fast-deep-equal implementation](https://github.com/epoberezkin/fast-deep-equal/blob/master/src/index.jst), and [dependency-cruiser documentation](https://github.com/sverweij/dependency-cruiser), inspected on the planning date. Mutable upstream references require exact-version verification before adoption.
- Audit refinement: `Object.is` versus `===` and object method-name handling mean the initially suggested equality package is not an unconditional replacement. The no-go branch above prevents a maintenance cleanup from silently changing accepted model output.
- Verification so far: source/planning review only. No dependency changes, executed application tests, guard-equivalence proof, implementation merge, or deployment.
