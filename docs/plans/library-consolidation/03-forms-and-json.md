# Simplify forms and JSON comparison

Status: proposed
Owner: unassigned
Delivery: working form validation and a tested decision to replace or keep the JSON helper

## Outcome and context

Reuse the existing schema/form integration in profile forms. Replace custom JSON
comparison only if it preserves the import code's behavior. Fewer lines or a new
dependency is not the goal. Keep domain conversion, safety confirmation, and the
provider acceptance and accounting rules.

This plan owns both changes. The [review sequence](README.md) separates the JSON
and form details, but the implementations can proceed independently when they do
not edit the same files. Architecture tooling belongs in the separate
[optional guard plan](04-architecture-guard.md), not a third requirement here.

## Scope

Assess a replacement for JSON comparison where the import code actually calls it.
Use Effect Schema through Standard Schema in the existing TanStack profile form.
Share private-card correction validation only when it means the same thing.

Do not repair or coerce JSON, compare arbitrary JavaScript objects, rewrite
providers or models, add product validation rules, change storage, roll out
LiveStore, add a form/schema framework, or upgrade the whole dependency stack.
Preserve the [form](../../reference/forms.md),
[household](../../reference/household.md), and
[import](../../reference/recipe-import.md) contracts.

## Approach and trade-offs

### Test the JSON behavior before choosing a replacement

Inspect every caller and the values its decoder permits. Cover validated JSON and
any explicitly permitted top-level absence, not arbitrary JavaScript objects.
Run the existing helper and each candidate on the same examples, including nested
numbers and unusual but valid JSON property names.

Prefer an equivalent public function already in the installed Effect packages.
Otherwise assess a pinned small library such as `fast-deep-equal`. Check exports,
resolved version, runtime dependency placement, and the production Worker bundle.
Popularity or a generic benchmark does not prove that its answers match ours.

Adopt only when all allowed inputs and both callers behave the same, and the
custom recursion disappears without equally complicated normalization or adapter
code. Otherwise keep the small helper, record examples that show why the
replacement fails, and retain useful regression tests. Remove unused trial
packages and configuration. Finishing this decision does not finish the form work.

Keep the forced-tool count and name checks, conflicting response copies, malformed
response handling, and provider-kernel interpretation. Reservation, claim,
settlement, cost limits, attempt IDs, and conservative handling of unknown results
are not part of the comparison helper. Do not compare stringified JSON, repair
parser output, or make an extra provider call to accommodate a library.

Record an ordinary replace-or-keep decision here. A consequential change to policy
needs a decision record, not a hidden change in a utility refactor.

### Share validation, but keep conversion into domain values

Follow the [form procedure](../../how-to/build-a-form.md) and reference. Compile
the installed Effect `Schema.toStandardSchemaV1` adapter against TanStack Form's
actual validation interface. Define only the raw fields this form needs. Reuse
constraints rather than copying enums or forcing a command schema onto unrelated
screen fields.

Validate at the appropriate existing field/form events. Keep touched, blur,
change, and submit timing. Show useful field and form errors with accessible
associations; do not ignore submission silently or show errors before interaction.
Validate conditional fields for the selected variant. Hidden irrelevant fields
must neither block a valid command nor enter it.

Decode and transform on submission. Successful Standard Schema validation does
not prove that `onSubmit` receives the transformed domain value. Keep
`decodeFact`/`commandFor`, or an equally direct conversion from fields to variant
to command. Preserve trimming and validated branded/transformed values, and keep
server validation. These conversions are not redundant plumbing.

Keep safety consent, provisional facts, and current-version checks separate from
field validity. Changes to kind, target, or proposed meaning clear outdated consent.
No-known-constraints and reductions in safety constraints still need explicit
confirmation. Keep ordinary edits and removals. Share private-card validation only
when the meaning matches and shared-file ownership permits it. Private proposals
and Household writes keep their own commands and confirmation rules.

The visible draft may change while an earlier command is unresolved. Revalidation
must not replace that command's original payload, mutation ID, versions, or binding.
Keep pending/disabled behavior and the caller's recovery path. Remove only repeated
validation and error-state code; do not add another schema/form library or generic
form generator.

## Source and coordination

Read `apps/api/src/features/imports/import-forced-tool-response.ts`, its tests,
`import-provider-kernel.ts`, and all current comparator callers. For forms, read
`apps/web/src/features/household-profiles/profile-fact-form.tsx`, its tests,
private-card correction, and `packages/household-api/src/profiles.ts`.

Use manifests and the lockfile for package versions and dependency placement.
Coordinate profile submission, shared schemas, and lockfile edits with
[browser runtime](01-browser-runtime.md) and [private client](02-private-client.md).
#218 is merged. Keep its current interfaces and leave its evaluation work separate.
September 16 observations are not instructions to restore old code or pin an
obsolete package.

## Acceptance

### JSON equality

- [ ] Record the inputs both callers permit and the old results, including allowed
  top-level absence. The replacement must not make the decoder accept more inputs.
- [ ] Match nested arrays/objects, reordered keys, changed/missing/present properties,
  array order and length, scalar type differences, null, and permitted undefined.
  Test signed zero at the top level and within arrays and objects.
- [ ] JSON-parsed data keys `constructor`, `valueOf`, `toString`, and `__proto__`
  neither throw nor change acceptance. Include or exclude sparse arrays, non-finite
  values, cycles, class instances, Maps/Sets, and prototype behavior according to
  the existing decoder. Do not invent broader utility requirements.
- [ ] Both callers keep forced-tool count/name checks, response-copy conflicts,
  malformed-envelope handling, and unknown provider results. Keep accounting,
  settlement, and attempt identities unchanged.
- [ ] Either an equivalent comparator removes custom recursion and passes API
  typechecking and Worker bundling, or concrete failing examples justify keeping
  the helper. Leave no unused dependency or compatibility traversal.

### Form validation

- [ ] New preferences, hard constraints, no-known-constraints, ordinary edits, and
  removals keep their domain results. Changing kind cannot let hidden fields evade
  validation, block a valid variant, or enter its command.
- [ ] Invalid input followed by a correction shows useful errors at the expected
  touched/blur/change/submit times. Test labels, error associations, focus, keyboard
  submission, and disabled/loading controls in a real browser with synthetic profiles.
- [ ] Decode whitespace, normalization, and branded/transformed values before
  building the command. Submission keeps its old meaning. Validation success alone
  is not treated as the converted domain value.
- [ ] Safety reduction and no-known-constraint confirmation remain explicit.
  Changes to kind, target, or proposed meaning cannot reuse old consent. Keep
  provisional facts, current review/version checks, and private-card boundaries.
- [ ] While a command is unresolved, draft edits, refresh, and revalidation cannot
  replace its payload, ID, or versions, or send a forbidden related action. Late
  callbacks cannot clear a newer pending request or imply an unproved result.
- [ ] The installed schema/form integration passes relevant form/panel tests and
  the production web build. Test shared correction validation at both callers.
  Keep server checks and explicit conversion into domain values.
- [ ] List the repeated validation/error-state code removed, not merely renamed
  domain functions. Leave no extra form/schema framework, unused dependency, or
  second status record. Keep architecture assessment separate.

## Delivery and open questions

Start with the JSON examples both callers permit and compile the actual form
adapter against the installed packages. Complete each change through tests,
implementation or justified retention, cleanup, and verification. Package fit and
matching behavior are questions to prove, not assumptions.

Use import decoder/kernel tests, form/panel tests, a browser for UI behavior, the
Worker build for runtime dependencies, and required repository checks. Record
commits, package versions, examples and results, removed/retained code, and limits.
Both the form work and the comparator decision must be accounted for. An unfinished
trial is not evidence that the helper should stay.

Put reusable form guidance in the existing reference and procedure. Rollback
reverts these code/dependency changes, not saved data. These checks need no paid
provider calls or cloud actions.

## Original proposals

This plan replaces the overlapping form and utility proposals, originally based
on `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. Their old workflow and permission
links are historical. The architecture work previously in #224 belongs only in
the [guard plan](04-architecture-guard.md) and #225. Comparison and form checks
remain unverified work, not results claimed by this document.

- [Original #223 proposal](https://github.com/cill-i-am/meal-planner/blob/483c853c9f4506301f45de2dbe4a9bc86bd79c60/docs/delivery/library-consolidation/03-schema-and-json-utilities.md).
- [Original #224 proposal](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md).
