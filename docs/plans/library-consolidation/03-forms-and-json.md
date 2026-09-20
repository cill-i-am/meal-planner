# Simplify forms and JSON comparison

Status: proposed
Owner: unassigned
Delivery: checked form changes and a tested choice to replace or keep the JSON helper

## Outcome and scope

Remove repeated validation and data-comparison code where the behavior can be
preserved. Keep profile commands, safety confirmation, provider-response checks and
conversion into domain values explicit. These are two separate tasks, not a new
form framework, JSON repair layer or provider rewrite. Dependency tooling has its
own [optional plan](04-architecture-guard.md); it is not a third requirement here.

## Approach and trade-offs

For JSON comparison, first test what each caller accepts: validated JSON and any
explicitly allowed top-level absence, not arbitrary JavaScript objects. Compare a
suitable installed Effect function and a pinned library such as fast-deep-equal.
Popularity does not prove that two comparison functions behave the same.

Replace the helper only if the tests show equivalent behavior and the custom
recursion can be deleted without building a similar compatibility layer. Otherwise,
keep the small helper and record concrete test cases showing why the alternatives
are unsuitable.

For profile forms, reuse the input rules in an appropriate raw-input Effect Schema
and validate through the installed Standard Schema adapter. Decode and transform
submitted data before `commandFor`; generic validation may not return the domain
value the command needs. Consent to reduce a safety restriction is separate from
form validity. Changing the fact kind or target clears consent for the old value.
Share validation with private card correction only where the rules mean the same
thing. Do not combine private proposals with shared writes.

## Source and coordination

Inspect `import-forced-tool-response.ts`, its tests and the
`import-provider-kernel.ts` caller in `apps/api/src/features/imports/`.
For forms, inspect `apps/web/src/features/household-profiles/profile-fact-form.tsx`,
private card correction and `packages/household-api/src/profiles.ts`.
Follow the [form rules](../../reference/forms.md) and current import and settlement rules.

Coordinate submit code and lockfile edits with [browser setup](01-browser-runtime.md)
and [private interview state](02-private-client.md). JSON comparison tests can proceed
independently. Do not restore the old #218 branch.

## Acceptance

- [ ] Check nested arrays and objects, object key order, array order, scalar types,
  null, missing versus present fields, allowed undefined values and numeric edge
  cases including signed zero. Test `constructor`, `valueOf`, `toString` and
  `__proto__` using JSON-parsed data, not JavaScript prototype syntax.
- [ ] Both callers retain the rules for forced-tool count and name, conflicting
  mirrors, malformed envelopes and unknown provider results. Do not add JSON repair,
  stringification-based comparison, a permissive parser or another paid call.
- [ ] A new runtime dependency passes the API typecheck and Worker build. Otherwise,
  retain the helper with concrete incompatible test cases and no unused dependency.
- [ ] Preference, hard-constraint and no-known-constraint forms validate correctly.
  Irrelevant fields stay out of commands. Trim and transform data before submitting
  it; server validation remains authoritative.
- [ ] Blur, change and submit timing, labels, focus, keyboard submission, errors and
  disabled or loading states work in a real browser.
- [ ] Safety-reduction consent and private or provisional meaning remain correct
  when the kind or target changes. Validation never supplies confirmation.
- [ ] Editing a draft, refreshing or receiving a late callback cannot replace an
  unresolved command, payload or ID. Revalidation cannot rewrite a dispatched request.
- [ ] Remove duplicate generic code, not domain conversion or useful behavior tests.
  Do not introduce another validation or state framework.

Use affected import, form and panel tests, a real browser, the relevant runtime
builds and required repository checks. This plan does not establish compatibility
or runtime results. No cloud, retailer or paid provider action is needed.

## Original proposals

These proposals were written against
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. The linked commits preserve that
history; they do not prove that the work or package compatibility checks are done.
Check current code and versions when starting implementation. #218 has since
merged, so do not repeat its migration or restore its old private-session design.
Historical handoff instructions do not override a new implementation assignment.

- [#223 source](https://github.com/cill-i-am/meal-planner/blob/483c853c9f4506301f45de2dbe4a9bc86bd79c60/docs/delivery/library-consolidation/03-schema-and-json-utilities.md), head `483c853c9f4506301f45de2dbe4a9bc86bd79c60`.
- [#224 source](https://github.com/cill-i-am/meal-planner/blob/133dc9ec26b40ece7de230e387308c15a76ba974/docs/delivery/library-consolidation/03-utilities-forms-and-architecture-guard.md), head `133dc9ec26b40ece7de230e387308c15a76ba974`.
