# Application-owned discovery coverage

This is the current implementation contract for [Work Item 03](03-adaptive-discovery-and-evaluation.md). It supersedes the generic question and model-output portions of the [earlier typed fallback design](03-typed-fallback-policy.md). The product owner authorized this change after the v24 response omitted `continuity.notes[2].subject`. The [failed evaluation](../../../../evals/private-discovery/kimi-v24-native-output-failure-results.md) remains unchanged. The subsequently accepted [base Agent and TanStack migration](../../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md#base-agent-and-tanstack-chat--accepted-2026-09-13) is in progress; its implementation and acceptance status is separate from the historical checks below.

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
4. The existing typed fallback policy asks an active need's unanswered reason, then option and manageable extra preparation, together when both are missing.
5. InitialDiscovery asks about unanswered ordinary meals.
6. Only when no applicable question remains does the application permit review readiness. Explicit participant completion and profile confirmation remain separate actions.

ProfileEdit does not acquire mandatory initial-discovery questions. It still submits both nullable coverage keys and can retain supported private information. Required topics, their identity, labels, ordering and completion rules are not model fields.

Optional context notes now contain only key, subject and nonblank detail. They have no state or question and cannot satisfy required coverage. Arbitrary note questions are rejected. This closes the reproduced route in which a model appended a new generic usual-meal question after that required topic had been declined.

One bounded optional clarification slot supports ProfileTarget, ProfileEffect, SafetyMeaning and SafetyHandling. Requests contain current evidence and, where relevant, a nullable current saved fact ID. There is no model-authored question, subject or label, and no usual-meals or fallback-field variant. Null retains the slot; current evidenced answer, no-information or refusal settles it. A pending request cannot silently be replaced with a different request. Reopening a declined clarification requires explicit permission. A safety request, including an effect on a saved safety fact, additionally requires permission if food-restriction coverage was declined. A fresh safety decline suppresses a pending safety clarification unless the current message explicitly permits it. If a pending saved target disappears from the fresh profile, the application retains its provenance as TargetUnavailable and stops asking; it never retargets the request or fabricates an answer.

## Other decisions removed from model output

The model chooses semantic AddFact, ConfirmFact, RemoveFact or ReplaceFact intent. The application resolves the actual current fact and derives the canonical ordinary or safety proposal path. Removing or replacing a safety fact always produces the separate safety-confirmation operation. An ordinary preference cannot be replaced with a safety fact through the ordinary path. These remain unconfirmed proposals; only the existing explicit native confirmation route mutates household state.

For an existing proposed card, the model supplies its ID and new semantic change. The application binds its expected revision from the generation snapshot, then compares the stored card status/revision against that snapshot before settlement. It never substitutes the latest stored revision. Card identity, revision, reviewed before-value, person, actor, profile version and confirmation basis are application-owned.

The adapter admits GPT-OSS 120B and Kimi K2.6 through this single forced-tool contract. Qwen's previous experimental request path is removed because the installed Workers binding does not express the required forced choice and full tool-schema contract. This is a limitation of that integration, not a claim that Qwen cannot call tools; its historical diagnostic remains preserved. The adapter requires one correctly named function call and complete, valid arguments. Missing provider terminal markers alone do not reject a contract-valid proposal. Known errors, cancellation and invalid arguments still prevent acceptance. Wrong functions, multiple calls, prose alongside a call, malformed JSON and omitted keys reject. Native settlement decodes the same submission again before reviewing proposals or writing generated state. The application adds no JSON-output fallback, repair, automatic turn retry or embedded provider tool execution. The published SDK can retry transient provider failures within the same admitted turn.

The unmodified published TanStack adapter owns streamed response parsing for both admitted models. The application preserves the forced Effect tool schema, Kimi thinking and sampling settings, configured token allowance and acceptance deadline, and one admitted application dispatch. The SDK defaults to two transient-error retries, allowing three binding attempts. Supported gateway options set one gateway attempt per binding invocation, no payload logging and no response caching. Normal library diagnostics remain enabled. It accepts at most 64 KiB of submitted tool arguments; the removed custom parser's framing and wire counters are not part of the new implementation. Streamed usage remains unknown and cannot reduce a budget reservation. Schema strictness cannot guarantee provider success or semantic truth; invalid output stays failed with the previous snapshot intact.

The adapter explicitly passes `gateway.requestTimeoutMs = config.timeoutMs` through the installed Workers binding. [AI Gateway's request timeout](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/) measures the wait for the first part of the response; the application retains its separate whole-operation deadline, capped at 900,000 ms for Kimi. This supported option is separate from the SDK request timeout and does not guarantee upstream cancellation. The application rejects results after its own deadline or cancellation. Live evaluation reserves three full provider attempts per turn; unknown usage never reduces this reserve. The cause of the historical v25 HTTP 408 remains unproven; this correction does not regrade that result.

## Superseded custom transport investigation

The following parser design and its results describe the implementation before the accepted TanStack migration. These parser-specific requirements and resource measurements do not apply to the replacement. Historical failures remain unchanged.

Kimi uses the [documented SSE response](https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/) with `stream: true` and `stream_options.include_usage: true`; GPT retains its JSON response. One ordered reader incrementally decodes UTF-8 and complete SSE frames. It retains the single tool call, counts and discards reasoning, and requires a terminal finish, `[DONE]` and actual response EOF before the existing tool/schema validation and native transaction. No partial message, card or continuity is published. ID, name and argument fragments follow [Moonshot's streaming tool guidance](https://github.com/MoonshotAI/Kimi-K2/blob/main/docs/tool_call_guidance.md#tool-calling-in-streaming-mode); the final function name must still match exactly. Consistent completed usage may arrive on the terminal choice or final usage event; missing or incomplete usage remains unknown. Nonterminal chunks may carry valid interim usage counters, as observed in the sixth controlled Workers AI attempt. The parser validates and discards those snapshots; it never sums them or promotes an initial zero to final usage. Only terminal totals become accounting input after successful EOF, consistent with [Kimi’s documented final usage](https://platform.kimi.ai/docs/api/chat). Malformed, truncated, conflicting or extra terminal data rejects without a JSON fallback, repair or another call.

Kimi has separate finite resource budgets: 2 MiB aggregate logical UTF-8 text, a 64 KiB decoded line, a 256 KiB SSE frame, 64 MiB total wire bytes and 131,072 data events, with 16 KiB decode slices. Logical text includes both reasoning fields, content, refusal and every tool ID, name and argument fragment; surrogate pairs split across deltas count as the assembled text. Framing budgets include comments and ignored metadata; data-event counts include usage and `[DONE]`. These are independent limits, not a promise that every 65,536-token provider response fits. An individual oversized event rejects even if its logical text would fit.

The parser never retains the whole wire body or previous events. Owned state consists of bounded current line/frame text, at most 2 MiB aggregate retained text, finite metadata and counters. The reader's current transport chunk can exceed the decode-slice size; its backing allocation is outside that parser-owned storage bound. Total wire overflow rejects before decoding the offending incoming chunk. A failure latches permanently and releases retained text; diagnostics contain only fixed check names and numeric counters/limits. Body cancellation starts promptly without waiting for provider cleanup. The existing whole-operation deadline, one-dispatch policy and configured token ceiling remain unchanged.

Demand-generated tests reach every admitted resource maximum together and separately exercise maximal retained tool arguments, exact/+1 boundaries, fragmented Unicode, failure latching and cancellation after a valid partial tool call. Native tests also hold a complete `[DONE]` response open to prove that EOF still gates settlement. Structural storage bounds and local Node memory measurements support resource review; Node heap samples are not a Worker heap guarantee. The fifth controlled live attempt exhausted the old 2 MiB whole-wire cap. A separate synthetic adapter test proves SSE framing can exceed that cap while logical text remains within budget. Earlier incomplete-stream and envelope failures retain their unknown causes; this resource fix does not establish hosted protocol or semantic acceptance.

## Retained domain limits

The complete snapshot remains bounded to 8,192 UTF-8 bytes in the existing private turn summary column, and the rendered message to 2,000 characters. Context/request/response limits remain enforced without clipping, eviction of useful continuity, or historical-state conversion. Fresh scoped sessions use the new contract.

## Verification and remaining acceptance

Before the TanStack migration, local verification passed 146 focused contract/policy/adapter tests, 91 private-output native cases, 85 household-boundary cases (84 in the full run and the corrected snapshot assertion in a targeted rerun), 55 web panel/client tests and 11 private protocol tests. Those checks also passed the full workspace typecheck, scoped lint/format and evaluation-asset validation. They do not establish acceptance of the in-progress runtime replacement. Earlier setup/assertion failures remain recorded separately and are not live-model failures.

The deterministic cases cover required-key omission, null retention, refusal/revisit, current evidence, confirmed-profile source changes, mandatory question ordering, clarification bypass/retirement, snapshot revisions and canonical safety mapping. Native tests cover atomic rejection with proposed cards, scope selection and mutation collision, first-response failure plus restart, legacy history without dispatch, and the existing confirmation, isolation and revocation fences.

Immutable source `29870891f6cf92d4a30c4a33e79071eba7b25a18` passed independent contract and scope/recovery review. Its [hosted CI](https://github.com/cill-i-am/meal-planner/actions/runs/34759048566) passed 1,512 Quality tests and 2 Synthetic media container tests, including all 91 private-output and 85 household native cases.

The real Chromium panel/client/CSS proof used synthetic sockets and actual browser storage. Both explicit scope actions, exact mutation-ID/scope replay after a lost reply and reload, unreadable-request recovery and legacy read-only rendering passed. Confirmation reconciliation preserved the unrelated unreadable raw request and blocked new writes until explicit clear. All 31 consumed source files matched that commit. This establishes browser behavior, not authenticated native routing or provider quality.

The [first v25 live request](../../../../evals/private-discovery/kimi-v25-native-provider-failure-results.md) returned complete HTTP 408 before tool arguments or usage were available. Native settlement reported `provider_unavailable`; substantive interview/profile state stayed unchanged while authorization metadata became invalidated. The suite stopped without retry and closed gracefully. The raw error body was not retained, so the upstream cause and forced-tool compatibility remain undetermined. No output-schema or semantic acceptance was reached.

No previous failed report is upgraded to a pass. Fresh successful native forced-tool evidence, the full family suite, candidate comparison, A-to-B review, fixed-judge evidence and actual human ratings remain the owning work item's acceptance gates. The report records the future bounded error-metadata follow-up without changing the harness or starting another phase.

## Adjacent audit follow-ups

Two concrete import issues are outside this discovery implementation:

- Visual confidence normalization strips `%` before the adapter divides values only when greater than one. Thus `1%` becomes 1 and `0.9%` becomes 0.9, incorrectly crossing the 0.8 threshold. A follow-up should use one numeric 0–1 contract, or normalize explicit units if a real retained contract requires percentage input. Low percentages must remain low and malformed/missing confidence must never become high confidence.
- The visual provider converts unknown token usage into known actual spend equal to the reservation maximum. A follow-up should use the recipe adapter's Conservative settlement, retaining the conservative charge while actual spend remains unknown, with bounded replay that never repeats a paid invocation after restart.

The same audit found existing application ownership in recipe provenance and unresolved coverage, acquisition limits/media identity, and deterministic meal-plan eligibility and candidate selection. No unrelated import, accounting or planner implementation is changed here.
