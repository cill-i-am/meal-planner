# Application-owned discovery coverage

This is the implementation contract delivered by [PR #218](https://github.com/cill-i-am/meal-planner/pull/218). [Work Item 03](../plans/private-discovery/03-adaptive-discovery-and-evaluation.md) owns verification and remaining evaluation work. The runtime uses [Cloudflare base Agent and published TanStack packages](../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md#base-agent-and-tanstack-chat--accepted-2026-09-13).

## Typed submission and ownership

Prompt v25, policy v6 and tool `submit-discovery-turn-v2` use one forced `submitDiscoveryTurn` function call. Its schema is derived from the owning Effect Schema:

```ts
type SubmitDiscoveryTurn = {
  intent:
    | { _tag: "Stop"; evidence: Evidence }
    | {
        _tag: "Continue";
        proposals: readonly ProfileProposalIntent[];
        updates: {
          coverage: {
            foodRestrictions: TopicUpdate<FoodRestrictionsAnswer> | null;
            usualMeals: TopicUpdate<UsualMealsAnswer> | null;
          };
          clarification: ProfileClarificationUpdate | null;
          notes: readonly PrivateContextNote[];
          mealFallbackNeeds: MealFallbackNeedUpdates;
        };
      };
};
```

Both coverage keys are required. `null` preserves the previous state. A topic update is `RecordAnswer` with a typed value and current evidence, `RecordNoInformation`, or `RecordDecline`. Answers and no-information updates carry nullable revisit evidence; changing a previously declined topic requires explicit current permission. Stored states are separate: Unanswered, Answered, NoInformation and Declined. No model intent can reset a topic to Unanswered or remove it.

The application creates both topics before generation. Food restrictions distinguish a nonempty typed restriction list from an explicit NoKnownHardConstraints answer. Ordinary meals retain a nonblank private description. Explicit no-information/refusal settles conversational coverage without establishing a known answer or safety clearance. The current participant's confirmed canonical HardConstraint/NoKnownHardConstraints facts can satisfy the safety question; provisional facts and unfinished cards cannot. Either existing accepted confirmation basis is recognized. The application does not manufacture current participant evidence or a private Answer from that canonical source. Removing that source from the fresh profile causes unanswered coverage to be considered again.

Coverage, fallback and clarification updates, plus Stop, cite the actual current participant message ID and an exact nonempty excerpt. Optional context notes and semantic profile proposals do not carry that exact-evidence field; their interpretation and grounding remain semantic evaluation obligations. The native child checks provenance and transitions inside its atomic settlement transaction. Exact matching proves the source of an extraction; it does not prove that the model interpreted the participant correctly.

## Explicit session scope

`StartSession` requires the user's `InitialDiscovery` or `ProfileEdit` choice. The interface offers **Start food discovery** and **Update my food profile**. Scope is never inferred from model output, profile size or text heuristics.

The directory atomically stores scope alongside its reservation and mutation receipt. An ordered local migration creates `private_discovery_session_scopes`; it changes no historical migration and assigns no invented scope to existing rows. Admission reads scope from the authenticated directory reservation and initializes the child with that same immutable choice. Participant identity binding remains unchanged. A failed first model response and restart cannot lose the chosen scope.

An older reservation without scope remains listable and its history remains readable. An existing child with no scope cannot acquire one through reconnect. Generation fails before provider dispatch; the interface directs the participant to a fresh scoped session and hides old response/composer controls. A pre-change unreadable saved browser request remains retained until the user explicitly clears that exact raw record after checking sessions. Clearing does not claim the earlier request failed or undo any changes. A stale browser instance cannot clear a newer retained request, and no new request is issued automatically. Unreadable retained data independently blocks new stored mutations even after an existing server-side confirmation settles; ordinary reconciliation cannot clear that recovery state.

## Questions and readiness

The application owns all question wording and chooses in this order:

1. An evidenced Stop preserves the entire snapshot. Stop has no updates or proposals and does not complete a session or its coverage.
2. A pending typed profile clarification resolves a disclosed ambiguity before other discovery questions. Coverage stays pending throughout.
3. InitialDiscovery asks about unanswered own food restrictions unless a current confirmed profile source satisfies that topic.
4. The typed fallback policy below asks an active need's unanswered reason, then option and manageable extra preparation, together when both are missing.
5. InitialDiscovery asks about unanswered ordinary meals.
6. Only when no applicable question remains does the application permit review readiness. Explicit participant completion and profile confirmation remain separate actions.

ProfileEdit does not acquire mandatory initial-discovery questions. It still submits both nullable coverage keys and can retain supported private information. Required topics, their identity, labels, ordering and completion rules are not model fields.

Optional context notes now contain only key, subject and nonblank detail. They have no state or question and cannot satisfy required coverage. Arbitrary note questions are rejected. This closes the reproduced route in which a model appended a new generic usual-meal question after that required topic had been declined.

One bounded optional clarification slot supports ProfileTarget, ProfileEffect, SafetyMeaning and SafetyHandling. Requests contain current evidence and, where relevant, a nullable current saved fact ID. There is no model-authored question, subject or label, and no usual-meals or fallback-field variant. Null retains the slot; current evidenced answer, no-information or refusal settles it. A pending request cannot silently be replaced with a different request. Reopening a declined clarification requires explicit permission. A safety request, including an effect on a saved safety fact, additionally requires permission if food-restriction coverage was declined. A fresh safety decline suppresses a pending safety clarification unless the current message explicitly permits it. If a pending saved target disappears from the fresh profile, the application retains its provenance as TargetUnavailable and stops asking; it never retargets the request or fabricates an answer.

## Other decisions removed from model output

The model chooses semantic AddFact, ConfirmFact, RemoveFact or ReplaceFact intent. The application resolves the actual current fact and derives the canonical ordinary or safety proposal path. Removing or replacing a safety fact always produces the separate safety-confirmation operation. An ordinary preference cannot be replaced with a safety fact through the ordinary path. These remain unconfirmed proposals; only the existing explicit native confirmation route mutates household state.

For an existing proposed card, the model supplies its ID and new semantic change. The application binds its expected revision from the generation snapshot, then compares the stored card status/revision against that snapshot before settlement. It never substitutes the latest stored revision. Card identity, revision, reviewed before-value, person, actor, profile version and confirmation basis are application-owned.

The adapter admits GPT-OSS 120B and Kimi K2.6 through this single forced-tool contract. Qwen's previous experimental request path is removed because the installed Workers binding does not express the required forced choice and full tool-schema contract. This is a limitation of that integration, not a claim that Qwen cannot call tools; its historical diagnostic remains available in the [evaluation history](../../evals/private-discovery/README.md#historical-findings). The adapter requires one correctly named function call and complete, valid arguments. Missing provider terminal markers alone do not reject a contract-valid proposal. Known errors, cancellation and invalid arguments still prevent acceptance. Wrong functions, multiple calls, prose alongside a call, malformed JSON and omitted keys reject. Native settlement decodes the same submission again before reviewing proposals or writing generated state. The application adds no JSON-output fallback, repair, automatic turn retry or embedded provider tool execution. The published SDK can retry transient provider failures within the same admitted turn.

The unmodified published TanStack adapter owns streamed response parsing for both admitted models. The application preserves the forced Effect tool schema, Kimi thinking and sampling settings, configured token allowance and acceptance deadline, and one admitted application dispatch. The SDK defaults to two transient-error retries, allowing three binding attempts. Supported gateway options set one gateway attempt per binding invocation, no payload logging and no response caching. Normal library diagnostics remain enabled. It accepts at most 64 KiB of submitted tool arguments; the removed custom parser's framing and wire counters are not part of the new implementation. Streamed usage remains unknown and cannot reduce a budget reservation. Schema strictness cannot guarantee provider success or semantic truth; invalid output stays failed with the previous snapshot intact.

The adapter explicitly passes `gateway.requestTimeoutMs = config.timeoutMs` through the installed Workers binding. [AI Gateway's request timeout](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/) measures the wait for the first part of the response; the application retains its separate whole-operation deadline, capped at 900,000 ms for Kimi. This supported option is separate from the SDK request timeout and does not guarantee upstream cancellation. The shared application signal settles and releases the turn at its own deadline or cancellation without waiting for the provider, and late results cannot commit. Live evaluation reserves three full provider attempts per turn; unknown usage never reduces this reserve.

## Typed fallback discovery

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


Application wording distinguishes an actual new draft from revision of an existing draft and describes its reviewed encoded effect as an unconfirmed profile proposal. Only those profile proposals receive an interface review invitation. A changed typed need receives a short, explicitly private-context summary preserving attribution, generic/exact option, quantity, substitution scope and manageable preparation when present; unanswered or unspecified values are not invented. Refusal, no-information and withdrawal retain their separate meanings. A current explicit correction or reaffirmation updates the affected field's evidence even when its interpreted value is unchanged, so it receives an acknowledgement without replaying unrelated needs. Omitted unchanged needs are not summarized again.

Typed extraction remains a semantic evaluation obligation. Exact excerpts prove
provenance; templated questions and status wording do not prove that an extracted
value is true. The question ordering in this document supersedes the former
generic-note question policy.

## Persistence and bounds

The strict private snapshot is `{ coverage, clarification, notes, mealFallbackNeeds }`,
stored in the successful turn's summary column. It is bounded to 8,192 UTF-8 bytes,
twelve notes and three needs. A submission allows at most six note updates and
six typed-need operations. Duplicate operations, unknown targets, stale evidence
or state overflow reject the entire generated turn before any assistant reply,
card, session-version or snapshot write. Omission and restart retain the last
valid snapshot.

The fully rendered message must fit 2,000 characters. Model context is bounded to
24,576 UTF-8 bytes and the serialized provider body to 32,768 bytes. Context
preparation can trim older messages and cards, but never canonical facts or
continuity; oversized input fails before dispatch. There is no output clipping,
continuity eviction or historical-state conversion. Individual bounds do not
guarantee that every maximum-sized combination fits the request body. The old
custom parser's wire/framing limits are not part of the published SDK path.

## Configuration

`PrivateOutputWorker` receives the native `PrivateDiscoveryAI` binding.
Deployment-time `MEAL_PLANNER_PRIVATE_DISCOVERY_CONFIG` becomes the
`PRIVATE_DISCOVERY_CONFIG` JSON binding. It requires `gatewayId`, an admitted
`model`, `maxOutputTokens`, `timeoutMs`, `inputUsdPerMillionTokens` and
`outputUsdPerMillionTokens`. Kimi permits 1–65,536 output tokens and a
1,000–900,000 ms deadline; GPT-OSS permits 1–4,096 tokens and 1,000–120,000 ms.
Token prices must be nonnegative. Empty configuration is unavailable, not an
implicitly selected model; `.env.example` leaves it empty. Functional deployment
requires the explicit model/gateway/price configuration and applicable deployment
authorization.

## Verification and remaining acceptance

Contract tests cover required-key omission, null retention, refusal/revisit,
current evidence, confirmed-profile source changes, mandatory question ordering,
clarification bypass/retirement, snapshot revisions and canonical safety mapping.
Native tests cover atomic rejection, scope retention across failure and restart,
legacy history without dispatch, confirmation, isolation, revocation and late
results. The [work item](../plans/private-discovery/03-adaptive-discovery-and-evaluation.md#current-evaluation-status)
records passing review, CI and the successful live opening. Broader model-quality
evaluation and human ratings remain explicitly deferred follow-up work.

[Import audit follow-ups](../plans/import-confidence-and-accounting.md) own the
separately recorded confidence and unknown-usage issues.
