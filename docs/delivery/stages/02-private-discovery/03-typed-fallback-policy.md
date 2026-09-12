# Typed private fallback discovery

This is the implementation design for [Work Item 03](03-adaptive-discovery-and-evaluation.md). The product owner authorized deterministic follow-up after the prompt-only experiment again ended before discovering the reported fallback and preparation constraints. Model recognition and extraction remain semantic tasks; the application owns the unanswered fields of a declared need.

## Contract and ownership

`private-discovery-needs.ts` owns a private `MealFallbackNeed`, its bounded updates and question selection. Each need has a stable app-owned ID, an attributed subject, declaration and subject evidence, active/declined/withdrawn state and three required fields: reason, reported acceptable option and extra preparation. The application initializes fields as unanswered. A field is one of:

```ts
type Field<T> =
  | { _tag: "Unanswered"; reopenedBy: Evidence | null }
  | { _tag: "Answered"; value: T; evidence: Evidence; reopenedBy: Evidence | null }
  | { _tag: "NoInformation"; evidence: Evidence; reopenedBy: Evidence | null }
  | { _tag: "Declined"; evidence: Evidence };
```

Reason and preparation retain the participant's description. An acceptable option explicitly distinguishes a generic option from an exact product and retains any stated quantity and substitution restriction. A generic option does not create a requirement for a brand or product. These values remain private context; they create no adult profile fact, dependant edit or approved fallback rule.

The model emits explicit declarations and field updates. The application derives each ID from the current participant message ID and declaration index. Updates refer to an existing ID or a declaration index from the same response; the model does not choose new IDs. Every new declaration, answer, correction, disposition, reopening or withdrawal cites the current participant message ID and an exact nonempty excerpt. The owning child verifies both against the actual current participant row before settlement. An old quote cannot replace a later correction. Retained previously validated state survives omission and the source message leaving the bounded model window. Excerpt matching establishes provenance, not semantic truth. The application rejects a literal duplicate declaration with the same subject, message and excerpt, while allowing two subjects supported by one statement. It cannot prove that a later declaration under different evidence describes a distinct real-world need; semantic identity remains a model responsibility.

Corrections retain the need key and carry new evidence. Answered and no-information fields may be reopened with new participant evidence. A declined field requires explicit participant choice to revisit it, represented separately from the answer or no-information evidence. A single `SetFieldDisposition(no_information)` can carry that fresh revisit evidence and settle the field atomically; the retained NoInformation state preserves it and does not cause another question. Missing or stale revisit evidence rejects the update. Refusal or no-information closes only the named field and does not turn it into a known answer. Whole-need refusal and withdrawal also require current participant evidence and suppress that need's follow-up without blocking other adult topics. Returning a declined or withdrawn need to active requires fresh evidence before field changes. There is no understood/irrelevant disposition. A declaration such as needing an alternative on a particular occasion does not itself answer why the alternative is needed. An exact-product correction preserves previously supported product identity, quantity and scope when the participant refers to the retained product without restating its name.

## Canonical reply policy

The model output replaces `Ask`/`Review` with `Continue { text, followUp }`, where `followUp` is either a generic question tied to an unresolved note or null. The explicit participant `Stop` response cites the current participant message and exact excerpt. It permits no continuity update or new proposal and preserves the existing snapshot exactly. There is no model-owned Review response to repair after validation.

After applying valid updates, the application selects the reply in this order:

1. A valid explicit Stop bypasses further questions while retaining private state.
2. For the first active need with unanswered fields, ask why an alternative is needed if the reason is unknown. Otherwise ask the acceptable option and extra preparation together when both are unanswered, or ask only the remaining field.
3. Once typed fields are addressed, use the model's valid generic follow-up. Every emitted generic reference is validated even when a typed question takes priority. Its topic must remain unresolved. With no generic question, unresolved generic notes still prevent review readiness.
4. When neither typed fields nor generic notes remain unresolved, the application permits review readiness. Answered circumstances and field-scoped refusal/no-information do not cause repeat questions.

The app's fixed questions refer to the attributed need, not fixture answers or product names. Model text acknowledges actual disclosures and card state; it must not claim that the conversation is complete.

## Persistence, bounds and failures

The existing continuity snapshot becomes one strict object, `{ notes, mealFallbackNeeds }`, stored in the same successful-turn `summary` TEXT column. It retains at most twelve notes and three needs within 8,192 UTF-8 bytes. Note updates retain their six-update bound; typed updates have a separate six-operation bound. The existing 24,576-byte context and 32,768-byte serialized request limits still apply. Oversize input fails; there is no eviction, fallback decoder, database migration or backfill. New evaluations use fresh sessions.

`private-assistant-turns.ts` validates new evidence, applies notes and need updates, derives the reply, then commits the assistant message, proposed cards and full snapshot in its existing transaction. Duplicate operations, unknown need keys, incorrect message references/excerpts, invalid generic follow-ups and state overflow reject the entire generated turn before any of those writes. Omitted values and restart retain the last valid snapshot.

The new model/state contract advances the prompt to v21 and policy to v4. Shared evidence, need references, profile-card changes and the canonical food-preference/profile-fact schemas use standard JSON Schema definitions without changing accepted values or validation to keep all three provider request shapes within their existing input bounds. The prompt assigns typed reason/option/preparation questions only to the typed need, avoiding duplicate generic unresolved notes for the same fields. Kimi thinking, sampling, completion allowance, deadline and whole-response limit remain fixed. The strict provider envelope, profile proposal review, participant authority and canonical confirmation path are unchanged.

## Verification

Pure cases cover declaration with no, partial or complete answers; unrelated safety updates; combined and single-field questions; omission; generic/exact option scope; correction; field-scoped refusal/no-information/revisit; Stop; unknown keys, stale evidence and limits. Native tests reuse the real child and existing atomic-settlement/restart fixtures, including a valid card combined with an invalid need update. The household-boundary proof exercises the authenticated turn endpoint and verifies that typed private context alone creates no canonical facts. The initial local native runs were setup-blocked by sandbox loopback denial and missing pinned dependency artifacts; they establish no acceptance. After exact dependency restoration, two native restart cases exposed request-size rejection when a proposed card was retained. Shared canonical fact-schema definitions removed duplication without widening input limits or changing accepted values. Both exact failures then passed.

Initial local verification on `92c3f53` passed 109 adapter/continuity/typed-policy tests, all 169 native private-output and household-boundary cases, 24 household API tests and 10 private-interview API tests. API and household API type checks, scoped lint/formatting and evaluation-asset validation passed. The native tests use local synthetic provider responses. A live native interview and independent immutable-head review remain required for model-quality acceptance.

Independent review found that a declined field could not atomically settle an explicit revisit with no information. The scoped correction adds current revisit evidence to `SetFieldDisposition(no_information)` and retains it in NoInformation; it preserves the need ID and other fields. Positive and absent/stale/mismatched-evidence tests pass, including a native restart and omitted-update check plus atomic rejection with a valid proposed card. The corrected scope passed 113 focused tests, all 87 private-output native tests, API types and scoped lint/formatting. Prompt and policy versions remain v21/v4; existing input/provider limits are unchanged.
