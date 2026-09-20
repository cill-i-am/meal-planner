# Consolidate form validation and JSON equality

Status: proposed
Owner: unassigned
Delivery: verified form validation and an evidence-backed comparator replacement or retention result

## Outcome and context

Profile forms reuse the existing schema/form integration, and import response
validation carries less generic machinery only where a replacement preserves
accepted behavior. A new dependency or a deletion count is not success: retain
explicit domain conversion, safety confirmation and provider acceptance/accounting.

This record owns both bounded changes and their acceptance. The
[review sequence](README.md) separates the JSON/proposal and form-validation edits
without creating another plan. The form and equality implementations can proceed
independently where file ownership permits. Architecture tooling has its own
[optional outcome](04-architecture-guard.md), not a hidden third completion gate.

## Scope

Evaluate replacement of JSON structural comparison at its actual import callers,
and reuse Effect Schema through Standard Schema in the existing TanStack profile
form. Share private-card correction validation only where its meaning truly matches.

Exclude JSON repair/coercion, broader object comparison, provider/model rewrites,
new product validation rules, another form/schema framework, persistence changes,
LiveStore and a broad dependency upgrade. [Form contracts](../../reference/forms.md),
[Household authority](../../reference/household.md) and the
[import contract](../../reference/recipe-import.md) remain the semantic owners.

## Approach and trade-offs

### JSON equality: characterize, compare, then adopt or retain

Inspect every caller and its admitted inputs before choosing a comparator. Capture
validated JSON and explicitly permitted top-level absence, not arbitrary JavaScript
objects. Run the existing comparator and each candidate against the same corpus,
including nested numeric values and unusual but valid JSON property names.

Prefer an equivalent public facility already present in the installed Effect stack,
or evaluate a pinned small library such as `fast-deep-equal`. Verify actual exports,
resolved version, runtime dependency placement and the production Worker bundle.
Popularity and a passing generic benchmark do not establish application equivalence.

Adopt only if the complete admitted-domain corpus and both consumer contracts agree,
and custom recursion disappears without similarly complex normalization/comparison
scaffolding. Otherwise retain the existing small helper with concrete counterexamples
and useful characterization tests; remove unused probe dependencies/configuration.
This is a valid comparator disposition, not proof that form work is complete.

Keep forced-tool cardinality/name, conflicting mirrors, malformed-envelope outcomes
and provider-kernel interpretation unchanged. Reserve/claim/settle behavior, cost
limits, attempt IDs and conservative unknown outcomes are not comparator mechanics.
No stringification equivalence, parser repair or additional provider attempt may be
introduced to make a library appear compatible. An ordinary local adopt/retain result
belongs here; a real consequential policy reversal belongs in the decision register.

### Form validation: reuse constraints without erasing domain conversion

Use the installed Standard Schema adapter with the existing TanStack Form boundary.
Reuse canonical constraints in the smallest suitable raw-input Effect Schema;
form fields and an admitted domain command are different values. Preserve an
explicit submission decode/transform before `commandFor` constructs the command.

Keep consent and authority separate from generic validity. Kind/target changes
retire obsolete confirmation; provisional information does not become confirmed.
Private correction may reuse genuinely common validation, but a private proposal
and a shared Household mutation keep their distinct command boundaries. Retained
ambiguous intent keeps its original payload/ID even when the visible form changes.

## Source and coordination

Inspect `apps/api/src/features/imports/import-forced-tool-response.ts`, its tests
and `import-provider-kernel.ts`; then trace every current comparator call. For forms,
inspect `apps/web/src/features/household-profiles/profile-fact-form.tsx`, its tests,
private-card correction and `packages/household-api/src/profiles.ts`.

Manifests/lockfile own actual versions and dependency placement. Coordinate profile
submit, shared schemas and lockfile changes with [runtime](01-browser-runtime.md)
and [private client](02-private-client.md). #218 is merged: preserve its current
profile/discovery interfaces and keep its evaluation obligations out of this cleanup.
The original September 16 source/package observations are not instructions to
restore an older checkout or freeze an obsolete dependency version.

## Acceptance

### JSON equality

- [ ] Both callers' actual admitted domains and baseline outcomes are characterized,
  including top-level permitted absence; the replacement does not widen decoding.
- [ ] Nested arrays/objects, key permutations, changed/missing/present properties,
  array order/length, scalar type differences, null and permitted undefined behavior
  match. Signed zero is exercised at top level and within arrays and objects.
- [ ] JSON-parsed fixtures with `constructor`, `valueOf`, `toString` and `__proto__`
  data keys neither throw nor change acceptance. Sparse arrays, non-finite values,
  cycles, class instances, Maps/Sets and prototype behavior are included or excluded
  according to the owning decoder, not invented as new utility requirements.
- [ ] Forced-tool cardinality/name, mirror conflicts, malformed envelopes and unknown
  provider outcomes retain their meaning at both consumer seams; accounting,
  settlement and attempt-identity behavior are unchanged.
- [ ] Either a proven equivalent comparator removes custom recursion and passes
  actual API typecheck/Worker bundling, or counterexamples justify retaining the
  helper with no unused dependency or compatibility traversal left behind.

### Form validation

- [ ] Preference, hard-constraint and no-known-constraint variants validate correctly;
  irrelevant fields do not enter commands and explicit decoding earns transformed
  domain values before submission. Authoritative server validation remains.
- [ ] Live/submit errors, labels, focus, keyboard operation and disabled/loading
  behavior work in a real browser, not only schema tests.
- [ ] Safety-reduction consent, kind/target changes, provisional meaning and current
  review/version checks survive; generic validation never manufactures confirmation.
- [ ] Editing, refresh or late callbacks cannot replace an unresolved submitted
  payload or mutation ID. Only redundant mechanics, not domain conversion, disappear.

## Delivery and open questions

Next actions: establish equality's admitted-domain corpus and compile the actual
form adapter against the installed stack. Continue each bounded change through
its characterization, implementation or justified retention, cleanup and relevant
verification. Package fit and behavioral equivalence remain questions for evidence,
not assumed compatibility.

Use import decoder/kernel tests, form/panel tests, the real browser for UI behavior,
actual Worker build seams for runtime dependencies and current repository checks.
Record exact tested heads, versions, fixture outcomes, removed/retained code and
remaining limitations here. At completion both form acceptance and the comparator
disposition must be accounted for; an unfinished probe is not a successful no-go.
Promote reusable form knowledge to the existing reference/procedure, not a parallel
skill, handoff or status record. Revert isolated code/dependency changes rather than
altering durable data. No paid provider or cloud action is needed for these checks.

## Proposal provenance

This is the single successor to the overlapping utility/form proposals, originally
based on `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. Their permission/workflow pointers
and separate delivery wrappers are historical. The architecture portion of #224 is
owned by the [guard plan](04-architecture-guard.md) and #225, not duplicated here.
This planning edit does not claim comparator equivalence or executed form acceptance.

- [Original #223 proposal](https://github.com/cill-i-am/meal-planner/blob/483c853c9f4506301f45de2dbe4a9bc86bd79c60/docs/delivery/library-consolidation/03-schema-and-json-utilities.md).
- [Original #224 proposal](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md).
