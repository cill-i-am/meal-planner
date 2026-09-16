# Phase 3 — Consolidate form validation and JSON equality

- Status: Proposed; implementation not started.
- Owner: Next assigned implementation agent.
- Planned: 2026-09-16.
- Planning baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`.
- Track: Library consolidation, not a product-stage promotion.
- Delivery authority: This PR contains plans only. Implement when assigned under
  the [execution policy](../../agents/execution-policy.md); do not merge the
  planning PR or perform application changes as part of preparing it.

## Outcome and scope

Remove small general-purpose mechanisms where a supported library preserves
behaviour: JSON structural equality in import response validation and validation
plumbing in the existing TanStack profile form. Keep business interpretation,
profile command construction, output acceptance, and safety confirmation custom.

Deliver two separately reviewable changes. Equality is a candidate replacement,
not a requirement to adopt a dependency even when its semantics are wrong.
Form validation should reuse Effect Schema through Standard Schema; do not add
a second validation library or replace TanStack Form.

No provider adapter rewrite, permissive JSON repair, model-output coercion,
new form framework, persistence migration, feature redesign, or deployment.

## Accepted direction

Preserve the existing authorities and command boundaries:

- [Household people/profile API](../../architecture/household-people-api.md).
- [Cards and safety confirmation](../stages/02-private-discovery/02-progressive-cards-and-confirmation.md).
- [Specialized import adapters](../../architecture/decisions/0007-route-recipe-sources-through-specialized-adapters.md).
- [Canonical conservative settlements](../../architecture/decisions/0011-canonicalize-completed-conservative-settlements.md).
- [Repository workflow](../../agents/repository-workflow.md).

### Source map

- `apps/api/src/features/imports/import-forced-tool-response.ts` and tests:
  `structurallyEqualJson` and its surrounding forced-tool acceptance rules.
- `apps/api/src/features/imports/import-provider-kernel.ts`: additional equality
  call site; preserve normalization and accounting semantics.
- `apps/web/src/features/household-profiles/profile-fact-form.tsx` and tests:
  TanStack Form fields, conditional variants, `decodeFact`, and `commandFor`.
- `apps/web/src/features/private-interviews/private-card-correction.tsx` and
  associated panel tests: inspect for truly shared validation, without widening
  this slice into the private-client migration.
- `packages/household-api/src/profiles.ts`: owning profile-fact schema.
- Affected manifests and `pnpm-lock.yaml`: installed versions and dependency
  placement; production API utilities belong to the API package, not root dev.

## Dependencies and coordination

[Phase 1, PR #219](https://github.com/cill-i-am/meal-planner/pull/219), and
[Phase 2, PR #221](https://github.com/cill-i-am/meal-planner/pull/221), may alter
the profile submit boundary, private correction consumer, and lockfile. Use their
actual merged interfaces or agree file ownership before editing shared paths.
The equality investigation can proceed independently on a separate worktree.

Recheck [active discovery PR #218](https://github.com/cill-i-am/meal-planner/pull/218)
and any import follow-ups before touching provider normalization. At planning,
#218 is unmerged; do not bundle its unresolved model-output issues into this
cleanup or assume the audit of main covers its newer implementation.

## Implementation sequence

### A. Replace equality only after proving the admitted semantics

1. Identify every current caller and the actual admitted input domain. Preserve
   the existing equality behaviour over validated JSON plus permitted top-level
   absence. Do not silently widen support to arbitrary JavaScript objects.
2. Add table-driven characterization tests before changing the comparator:
   nested arrays/objects, object-key permutations, array order, scalar type
   differences, null, missing versus present keys, permitted undefined values,
   and numeric edge cases including negative zero where admitted. Include valid
   JSON object keys such as `constructor`, `valueOf`, `toString`, and `__proto__`;
   construct those fixtures through JSON parsing rather than prototype syntax.
3. Evaluate `fast-deep-equal` against these tests and the installed Effect
   schema-derived equivalence facility, if available. Some generic JavaScript
   equality semantics may differ from JSON semantics; the package's popularity
   is not evidence of equivalence. Record the chosen version and import/build
   behaviour, including compatibility with the actual Worker bundle.
4. Adopt a comparator only if the whole admitted-domain suite passes and the
   custom recursion disappears without replacement shims of comparable size.
   Prefer an already-installed compatible facility when it is simpler. If no
   candidate preserves the contract, retain the current small helper and record
   a no-adoption decision with the failing fixtures; this is a valid bounded
   outcome, not an excuse to change model acceptance rules.
5. Keep forced-tool cardinality, expected tool name, conflicting mirror checks,
   malformed-envelope rejection, and unknown provider outcomes unchanged. No
   JSON repair, stringification-based equality, permissive parsing, or second
   live provider call is part of this refactor.
6. Remove only the superseded comparator and redundant mechanics. Preserve
   behavioural decoder tests and both call sites' interpretation of results.

### B. Use Standard Schema at the existing form boundary

1. Verify the installed Effect v4 Standard Schema adapter and TanStack Form
   versions. The intended API is `Schema.toStandardSchemaV1`; compile it against
   the current lockfile rather than copying a rolling example blindly.
2. Define the smallest form-input schema needed for the raw field shape, reusing
   canonical field constraints where practical. A raw form input and a domain
   command are different types; do not force the canonical command schema onto
   unrelated UI fields or duplicate its enumerations in another library.
3. Attach the adapter to the appropriate form/field validation events and render
   accessible field or form errors. Preserve conditional variant behaviour,
   relevant blur/change timing, disabled submission, and existing labels.
4. Keep an explicit decode/transform in submission. TanStack Form validation
   does not imply `onSubmit` receives transformed output. Preserve trimming,
   conditional field mapping, and a final decode into the domain value before
   `commandFor` constructs the admitted command.
5. Keep safety consent separate from generic validity. Switching fact kind or
   target must not reuse obsolete confirmation. Provisional information must
   not become confirmed, and reducing a safety constraint still requires the
   existing explicit confirmation command and current review/version.
6. Share validation with private-card correction only where the rules genuinely
   match and Phase 2 file ownership is resolved. Do not unify away intentional
   differences between proposing a private card and mutating a shared profile.
7. Remove duplicate validation plumbing, not domain conversion or authoritative
   server validation. Retained ambiguous commands keep their original payload;
   revalidation of a changed form cannot overwrite the already-submitted intent.

## Acceptance evidence

| Scenario | Required evidence |
| --- | --- |
| Equality replacement | Characterization suite passes for the admitted domain, or a documented no-adoption result identifies concrete incompatibilities. |
| Model envelope semantics | Existing forced-tool tests still reject cardinality/name/mirror conflicts; both comparator call sites retain their outcomes. |
| Worker compatibility | Affected API typecheck and real production bundle path accept any new runtime dependency. |
| Conditional form values | Food preference, hard constraint, and explicit no-known-constraints cases validate correctly; irrelevant fields cannot leak into commands. |
| Transformation | Whitespace/invalid inputs produce expected errors; the submitted domain value is explicitly decoded and correctly trimmed. |
| Safety and provisional facts | Missing consent blocks submission; kind/target changes cannot carry stale consent or promote provisional meaning. |
| Unresolved mutation | An edited form, refresh, or late callback cannot replace the original submitted payload or mutation ID. |
| Accessibility | Keyboard submission, focus, labels, errors, and disabled controls work in the real browser. |
| Scope reduction | Superseded mechanics are removed without introducing a new validation/state framework. |

Use the affected import decoder/kernel tests and profile-form/panel tests, then
required `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and broader
CI gates for dependency changes. Inspect unfamiliar scripts first. Run the real
local browser for changed form behaviour and the native build/test seam for a
Worker dependency. Keep unit-contract evidence separate from provider-quality
claims. Follow immutable-head review requirements for behavioural changes.

No real provider calls, cloud operations, Alchemy plan/deploy/destroy, retailer
activity, or production data changes are necessary.

## Implementation constraints

The success criterion is less generic maintenance with the same admitted
behaviour, not maximum lines deleted. Do not expand into generic object
comparison, form generation, or redesign of recipe validation. Keep proposed
library versions explicit and record compatibility rather than bypassing peers.

Upstream references checked on 2026-09-16; compatibility remains to be proved:

- [fast-deep-equal](https://github.com/epoberezkin/fast-deep-equal).
- [Effect v4 Standard Schema adapter](https://effect.website/docs/v4/schema/standard-schema).
- [TanStack Form validation](https://tanstack.com/form/latest/docs/framework/react/guides/validation).

## Agent handoff

When assigned, inspect current main and overlapping PRs. Start with equality
characterization and a form adapter compile probe. Deliver the two changes
separately enough to review their semantics, record any no-adoption decision,
and update this work item with actual commands/results, reviewed heads,
remaining limitations, and merge references when authorized.

## Delivery record

- 2026-09-16: Planning-only work item created. No dependency installed, source
  changed, comparator equivalence proved, form test executed, or deployment
  performed as part of this planning PR.
