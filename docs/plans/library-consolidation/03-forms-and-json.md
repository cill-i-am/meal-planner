# Consolidate form validation and JSON equality

Status: proposed
Owner: unassigned

Delivery: a separately assigned, verified implementation or bounded no-adoption result

## Outcome and scope

Remove redundant generic validation/equality machinery only where behavior is
preserved. Keep profile commands, safety meaning, provider acceptance and domain
conversion explicit. These are two bounded changes, not a new form framework,
JSON repair layer or provider rewrite. Generic architecture assessment has its
own [optional plan](04-architecture-guard.md), not a hidden third requirement here.

## Approach and trade-offs

For JSON equality, characterize every caller's admitted domain: validated JSON
and explicitly permitted top-level absence, not arbitrary JavaScript values.
Compare the installed Effect facility and a pinned library such as fast-deep-equal.
Popularity does not prove equality semantics. Adopt only if equivalent tests pass
and custom recursion disappears without comparable compatibility scaffolding;
otherwise retain the small helper with concrete no-adoption fixtures.

For the profile form, reuse canonical constraints in an appropriate raw-input
Effect Schema, validated through the installed Standard Schema adapter. Preserve
explicit decoding/transformation at submission before `commandFor`, since generic
validation does not return an earned domain value. Safety consent remains separate
from validity. Changed fact kind/target must retire obsolete consent. Share private
card-correction validation only where its meaning actually matches, not by merging
private proposals with shared writes.

## Source and coordination

Inspect `import-forced-tool-response.ts`, its tests and the
`import-provider-kernel.ts` caller under `apps/api/src/features/imports/`;
`apps/web/src/features/household-profiles/profile-fact-form.tsx`, private card
correction and `packages/household-api/src/profiles.ts`. Use [form contracts](../../reference/forms.md)
and the current import/settlement rules. Coordinate profile submit/lockfile ownership
with [runtime](01-browser-runtime.md) and [private client](02-private-client.md).
Equality characterization is independent; no stale #218 branch may be restored.

## Acceptance

- [ ] Equality covers nested arrays/objects, key permutations, array order, scalar
  types, null, missing/present fields and admitted undefined/numeric edge cases,
  including signed zero. Test `constructor`, `valueOf`, `toString` and `__proto__`
  keys using JSON-parsed fixtures, not JavaScript prototype syntax.
- [ ] Both callers preserve forced-tool cardinality/name, mirror-conflict,
  malformed-envelope and unknown-provider outcomes; no JSON repair, stringification
  equivalence, permissive parser or second paid invocation appears.
- [ ] Selected runtime dependency works in actual API typecheck/Worker bundle, or
  concrete incompatible fixtures justify no adoption with no unused dependency.
- [ ] Preference, hard-constraint and no-known-constraint variants validate correctly;
  irrelevant fields do not enter commands. Trimming/transforms earn the domain
  value before submission; authoritative server validation remains.
- [ ] Blur/change/submit timing, labels, focus, keyboard submission, errors and
  disabled/loading behavior work in the real browser.
- [ ] Safety-reduction consent and provisional meaning survive kind/target changes;
  validation never manufactures confirmation.
- [ ] Editing a draft, refresh or late callback cannot replace the original unresolved
  command/payload/ID. Revalidation does not overwrite an already dispatched intent.
- [ ] Duplicate generic plumbing is removed, not domain conversion or meaningful
  behavioral tests; no competing validation/state framework is introduced.

Use the affected import/form/panel suites, real browser, native build seams and
repository-required checks. Compatibility and runtime results are not established
by this plan. No cloud, retailer or paid provider action is required.


## Proposal provenance

Consolidated from the overlapping planning PRs below. Those PRs remain open and
unchanged; this is the owning proposed scope on the refactor branch, not evidence
of implementation or dependency compatibility. The original planning baseline was
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`; recheck actual source/versions when
assigned. #218 has since merged. Old first-pass/handoff instructions and the
then-current plain-session runtime assumption are not new implementation rules.

- [#223 source](https://github.com/cill-i-am/meal-planner/blob/483c853c9f4506301f45de2dbe4a9bc86bd79c60/docs/delivery/library-consolidation/03-schema-and-json-utilities.md), head `483c853c9f4506301f45de2dbe4a9bc86bd79c60`.
- [#224 source](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md), head `133dc9ec26b40ece7de230e387308c15a76ba974`.
