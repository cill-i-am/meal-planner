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

Both coverage keys are required. `null` leaves the previous state unchanged.
Updates use `RecordAnswer` with a typed value and current evidence,
`RecordNoInformation`, or `RecordDecline`. Answer and no-information updates
include nullable evidence of permission to revisit a topic. A previously declined
topic needs explicit current permission.

The saved states are Unanswered, Answered, NoInformation, and Declined. The model
cannot remove a topic or reset it to Unanswered.

The application creates both topics before calling the model. Food restrictions
are either a nonempty typed list or an explicit NoKnownHardConstraints answer.
Ordinary meals keep a nonblank private description. A refusal or no-information
answer ends questioning on that topic; it does not establish a known answer or
clear a safety concern.

The participant's confirmed HardConstraint/NoKnownHardConstraints facts can answer
the safety question. Either existing accepted confirmation basis is recognized;
provisional facts and unfinished cards do not qualify. The application does not
invent participant evidence or a private Answer from those profile facts. If the
fresh profile no longer contains the source fact, unanswered coverage is
considered again.

Coverage, fallback, clarification, and Stop updates cite the current participant
message ID and an exact nonempty excerpt. Optional notes and profile proposals
do not have that exact-evidence field; their meaning and grounding still need
semantic evaluation.

The native child checks the cited source and allowed state changes in the same
transaction that saves the result. An exact text match identifies the source.
It does not prove that the model understood it correctly.

## Explicit session scope

`StartSession` requires the user's `InitialDiscovery` or `ProfileEdit` choice. The interface offers **Start food discovery** and **Update my food profile**. Scope is never inferred from model output, profile size or text heuristics.

The directory saves scope, the reservation, and the mutation receipt in one
transaction. An ordered local migration creates `private_discovery_session_scopes`
without editing older migrations or inventing scope for existing rows. After
authentication, admission reads the reservation's scope and initializes the child
with the same fixed choice. Participant binding is unchanged. A failed first
model response or restart must not lose the scope.

An older reservation without scope remains listed, and its history stays readable.
Reconnecting cannot assign scope to an existing child that has none. Generation
fails before a provider call. The interface hides the old response/composer
controls and directs the participant to a new session with an explicit scope.

An unreadable browser request saved before this change stays retained. After
checking sessions, the user may explicitly clear that exact raw record. Clearing
it neither proves the old request failed nor undoes changes. An old browser
instance cannot clear a newer request, and clearing does not send another request
automatically. Unreadable saved data still blocks new stored mutations even after
an existing server confirmation settles. Ordinary state reconciliation does not
clear that recovery condition.

## Questions and readiness

The application owns all question wording and chooses in this order:

1. An evidenced Stop preserves the entire snapshot. Stop has no updates or proposals and does not complete a session or its coverage.
2. A pending typed profile clarification resolves a disclosed ambiguity before other discovery questions. Coverage stays pending throughout.
3. InitialDiscovery asks about unanswered own food restrictions unless a current confirmed profile source satisfies that topic.
4. The typed fallback policy below asks an active need's unanswered reason, then option and manageable extra preparation, together when both are missing.
5. InitialDiscovery asks about unanswered ordinary meals.
6. Only when no applicable question remains does the application permit review readiness. Explicit participant completion and profile confirmation remain separate actions.

ProfileEdit does not acquire mandatory initial-discovery questions. It still submits both nullable coverage keys and can retain supported private information. Required topics, their identity, labels, ordering and completion rules are not model fields.

Optional notes have only a key, subject, and nonblank detail. They have no state
or question and cannot satisfy required topics. The application rejects arbitrary
note questions. This prevents the reproduced bug where the model asked another
generic usual-meal question after the participant had declined that topic.

The application allows one optional clarification at a time: ProfileTarget,
ProfileEffect, SafetyMeaning, or SafetyHandling. A request includes current
evidence and, where relevant, a nullable ID of a saved fact. It has no
model-written question, subject, or label, and no usual-meal or fallback-field
variant. Null keeps the existing request. A current evidenced answer,
no-information response, or refusal settles it. A pending request cannot be
silently replaced by another.

Reopening a declined clarification needs explicit permission. Safety clarification,
including a change to a saved safety fact, also needs permission when the food
restriction topic was declined. A fresh safety refusal suppresses a pending
safety clarification unless the same message explicitly permits it. If a saved
target disappears from the fresh profile, retain its source as TargetUnavailable
and stop asking. Do not retarget the request or invent an answer.

## Other decisions removed from model output

The model proposes AddFact, ConfirmFact, RemoveFact, or ReplaceFact. The application
finds the current fact and chooses the ordinary or safety proposal path. Removing
or replacing a safety fact always requires the separate safety-confirmation
operation. The ordinary path cannot replace a preference with a safety fact.
These are still unconfirmed proposals. Only the explicit native confirmation
flow writes household state.

To change an existing proposed card, the model supplies its ID and the intended
change. The application takes the expected revision from the snapshot used for
generation. Before saving, it checks the stored status and revision against that
snapshot; it must not substitute a newer revision. The application owns card
identity, revision, the reviewed previous value, person, actor, profile version,
and confirmation basis.

The adapter accepts GPT-OSS 120B and Kimi K2.6 through one forced-tool contract.
The experimental Qwen path was removed because the installed Workers binding
cannot express the required forced choice and complete tool schema. This limits
that integration; it does not mean Qwen cannot call tools. Its diagnostic is in
the [evaluation history](../../evals/private-discovery/README.md#historical-findings).

Require one correctly named function call with complete, valid arguments. Missing
provider terminal markers alone do not reject an otherwise valid proposal. Known
errors, cancellation, invalid arguments, wrong functions, multiple calls, prose
beside a call, malformed JSON, and missing keys do reject it. The native child
decodes the submission again before reviewing proposals or saving generated data.
The application adds no JSON-output fallback, repair, automatic turn retry, or
embedded provider tool execution. The published SDK may retry transient provider
failures within the same admitted turn.

The unmodified TanStack adapter parses streamed responses for both accepted
models. Keep the forced Effect tool schema, Kimi thinking and sampling settings,
configured token limit and acceptance deadline, and one application dispatch.
The SDK defaults to two transient-error retries, so a turn can make three binding
attempts. Supported gateway options allow one gateway attempt per binding call,
with no payload logging or response caching. Normal library diagnostics stay on.

Tool arguments may be at most 64 KiB. The removed custom parser's framing and wire
counters no longer apply. Streamed usage stays unknown and cannot reduce a budget
reservation. Strict schemas do not prove provider success or truthful meaning.
Invalid output stays failed, with the previous snapshot unchanged.

The adapter passes `gateway.requestTimeoutMs = config.timeoutMs` through the
installed Workers binding. [AI Gateway's request timeout](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/)
measures the wait for the first response data. The application has a separate
deadline for the whole operation, capped at 900,000 ms for Kimi. This gateway
option differs from the SDK request timeout and does not prove upstream work stops.

At its own deadline or cancellation, the shared application signal settles the
turn and releases resources without waiting for the provider. Late results cannot
commit. Live evaluation reserves three full provider attempts per turn. Unknown
usage never reduces that reservation.

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

The model declares needs and updates fields. The application derives each new ID
from the current participant message ID and declaration index. An update names
an existing ID or a declaration index in that response; the model cannot choose
new IDs.

Every declaration, answer, correction, disposition, reopening, or withdrawal
cites the current participant message ID and an exact nonempty excerpt. Before
saving, the child checks both against that actual message. An old quote cannot
overwrite a later correction. Previously validated state survives omission and
its source message leaving the bounded model context.

Excerpt matching identifies the source, not whether the interpretation is true.
Reject an identical declaration with the same subject, message, and excerpt.
Allow two subjects supported by one statement. A later declaration with different
evidence might still describe the same real need; recognizing that remains the
model's responsibility.

Corrections keep the need ID and add current evidence. Answered and
no-information fields can reopen with new participant evidence. A declined field
needs explicit permission to revisit it, recorded separately from the answer or
no-information evidence.

One `SetFieldDisposition(no_information)` can include that fresh permission and
settle the field atomically. The saved NoInformation state keeps the permission
and prompts no further question. Missing or stale permission rejects the update.
Refusal or no-information closes only the named field; neither is a known answer.

Refusing or withdrawing a whole need also requires current evidence. It stops that
need's questions without blocking other adult topics. Reactivating a declined or
withdrawn need requires fresh evidence before its fields change. There is no
understood/irrelevant disposition. Saying an alternative is needed does not itself
explain why. If a product correction refers to a saved product without repeating
its name, preserve the previously supported identity, quantity, and scope.

The interface distinguishes a new draft from a change to an existing draft. It
describes the reviewed change as an unconfirmed profile proposal. Only profile
proposals get an invitation to review them in the interface.

For a changed typed need, show a short summary explicitly labelled as private
context. Keep attribution, generic versus exact product, quantity, substitution
rules, and manageable preparation where present. Do not invent unanswered values.
Refusal, no-information, and withdrawal keep distinct meanings.

An explicit correction or reaffirmation updates the field's evidence even if its
value is unchanged. Acknowledge it without repeating unrelated needs. Do not
summarize omitted, unchanged needs again.

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
