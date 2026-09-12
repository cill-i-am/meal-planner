# Stage 2 — Private discovery and repeat profile review

- Status: Work Items 01 and 02 Done (2026-09-06), delivered by
  [PR #215](https://github.com/cill-i-am/meal-planner/pull/215) and
  [PR #216](https://github.com/cill-i-am/meal-planner/pull/216).
- Planning base: `28a5f3ca4aae3c8f01c56e5261439111acd9949d`.
- Active: [Work Item 03 — adaptive discovery and evaluation](03-adaptive-discovery-and-evaluation.md), authorized on 2026-09-06.

## Accepted outcome

An adult has a private, adaptive conversation that produces useful profile cards
early, lets them correct and explicitly confirm proposed facts, and leaves
accurate household-visible profiles. A later focused review starts a new
session; completed conversations remain private read-only history. Adults can
also complete a shorter assisted review for dependants.

The product owner accepted this bounded plan and the evaluation split on
2026-09-06.
[PDR-0006](../../../decisions/product/0006-ai-evaluation-and-release-evidence.md#stage-specific-evidence-and-the-complete-beta-gate)
now places discovery/profile quality in Stage 2 and later routine, planning,
repair, feedback, and shopping evidence with their owning stages. All eight
scenario families, hard blockers, quality bands, and human calibration remain.
The complete connected journey is still required before external beta.

## Delivery sequence

The dependency upgrade and all three
[priority fixes](../../prioritized-risk-fixes.md) are merged. Consume the
selected native child and output fence from
[private-output safety](../../private-output-safety.md); do not reopen the SDK
transport selection. Target-specific D1 reconciliation remains a separate
release gate, not a prerequisite for local application implementation.

| Work item                                                           | Observable result                                                                                                                                                                                                                                                    | Status  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| [01 — Private session foundation](01-private-session-foundation.md) | An adult starts, rediscovers, resumes, and completes a private session, then reads retained history through the admitted native socket. Durable participant messages and lifecycle work without a provider; assistant output exists only in synthetic test fixtures. | Done    |
| [02 — Progressive cards and confirmation](02-progressive-cards-and-confirmation.md) | Proposed cards support correction, rejection, explicit confirmation, hard-constraint status, and conflict handling. Only closed facts and privacy-safe provenance enter the existing versioned Household commands; initial proposals remain synthetic until Work Item 03. | Done |
| [03 — Adaptive discovery and evaluation](03-adaptive-discovery-and-evaluation.md)                              | A real evaluated model asks relevant follow-ups, avoids repeated/exhaustive questioning, and produces useful cards. Develop the scoped harness spike, scenarios, rubric, model comparison, and calibrated baseline alongside this capability.                        | In progress |
| 04 — Repeat review and dependant assistance                         | A new private review focuses on changed circumstances using current confirmed facts. An adult completes a shorter dependant flow; confirmation produces profile versions/audit, and old sessions remain closed.                                                      | Planned |
| 05 — Cumulative discovery exit                                      | Two adults independently review and correct profiles; one assists a dependant; a later review changes an ordinary preference. The real selected model, UI, admitted commands, privacy boundaries, and all eight stage-scoped scenario families meet PDR-0006.        | Planned |

Work Item 01 implementation and local acceptance are complete.
[PR #215](https://github.com/cill-i-am/meal-planner/pull/215) owns its current
hosted-check and merge record. Work Item 02 merged in
[PR #216](https://github.com/cill-i-am/meal-planner/pull/216) as
`41b2a3e3f12c83edd3ddd9d184b9e138827101e6` after backend and UI approval of
`925554e1ca1927f74a30e241ab1a029ecfd18b22`, passing hosted
[run 34042894812](https://github.com/cill-i-am/meal-planner/actions/runs/34042894812),
and completed local browser acceptance. Its
[delivery record](02-progressive-cards-and-confirmation.md) owns the native
confirmation, restart, privacy, accessibility, and runtime evidence and limits.
Work Item 03 is in progress in
[draft PR #218](https://github.com/cill-i-am/meal-planner/pull/218). Native
adaptive-turn implementation and local browser acceptance are complete. The
[GPT-OSS v16 result](../../../../evals/private-discovery/prompt-v16-planning-purpose-results.md)
persisted a false completed-update claim while canonical state stayed unchanged.
The [Qwen v16 comparison](../../../../evals/private-discovery/prompt-v16-qwen-sampling-results.md)
stopped at malformed JSON after one native success and preserved prior state.
Both configured candidates remain unaccepted.

An [isolated Qwen tool diagnostic](../../../../evals/private-discovery/qwen-native-tool-serialization-diagnostic-results.md)
observed a genuine native function call with schema-valid arguments. The frozen
inspector rejected aliases and legacy-field presence before checking arguments;
separate offline continuity validation rejected its Ask decision. There was no
household/native settlement or discovery pass. Kimi's [first full request](../../../../evals/private-discovery/kimi-first-probe-results.md)
and [clean full opening](../../../../evals/private-discovery/kimi-clean-opening-probe-results.md)
both reached their deadlines with provider outcome and usage unknown. Its
[tiny baseline](../../../../evals/private-discovery/kimi-structured-output-baseline-results.md)
and [constant full-schema control](../../../../evals/private-discovery/kimi-full-schema-control-results.md)
passed their bounded checks. The [JSON-object opening](../../../../evals/private-discovery/kimi-json-object-opening-results.md)
passed source schema, continuity and manual reference checks but failed semantic
review by proposing removal while the intended change remained unclear. No
native settlement or discovery acceptance followed.

Prompt v17 prioritizes genuinely unclear intended effects or targets before
dependent drafting and downstream routine questions, preserves already-explicit
intent, and keeps the sole question in Ask.question. The [single v17 opening](../../../../evals/private-discovery/kimi-v17-json-object-opening-results.md)
met that narrow semantic prerequisite: it retained the routine, asked to clarify
the unresolved intended change and emitted no proposals. It did not exercise card
review/confirmation or establish sustained discovery quality. Kimi request
support is now selectable alongside GPT-OSS and Qwen for the approved synthetic
evaluation. It uses JSON-object output with the existing strict decoder;
configuration remains disabled by default. A [two-turn native checkpoint](../../../../evals/private-discovery/kimi-v17-native-dependency-checkpoint-results.md)
was interrupted by a local harness command error without a family verdict. The
[first v17 full-suite baseline turn](../../../../evals/private-discovery/kimi-v17-native-baseline-failure-results.md)
failed `reply_decision` because Ask referenced a missing unresolved note. The
rejection preserved private and canonical state. Prompt v18 and the shared
output-schema declaration order proposals, reply, then continuity; Ask must
reference an exact retained or newly supplied unresolved note. Ordering may help
generation, but that hypothesis is unverified. The [v18 native suite](../../../../evals/private-discovery/kimi-v18-native-suite-stop-results.md)
recorded six successful turns, then rejected seven continuity updates against
the six-update limit. The baseline lacked its original-card review receipt;
no family was accepted. Prompt v19 explicitly requires only changed notes and
card operations and prohibits repeating the question in acknowledgement text.
The [v19 run](../../../../evals/private-discovery/kimi-v19-native-suite-stop-results.md)
recorded eight native successes, then another missing-note
`reply_decision` rejection. Baseline coverage remained incomplete; adult routines
exposed a material draft selection defect. Its fixed judge scored household
specificity 4/5 and profile synthesis 3/5, with no family or human baseline
accepted. Kimi thinking at temperature 1.0 [hit the 4,096-token limit](../../../../evals/private-discovery/kimi-thinking-budget-limit-results.md)
on its first native turn without saving generated state. A
[standalone opening with larger limits](../../../../evals/private-discovery/kimi-thinking-large-completion-results.md)
passed JSON, output-schema and continuity checks using 5,537 completion tokens
in 133.577 seconds. This diagnostic did not settle a native turn or establish
family acceptance. The adapter permits Kimi up to 65,536 completion tokens,
a 900-second deadline and a 2 MiB whole response. That change retained GPT/Qwen
limits, prompt v19, schemas, policy, authority, scenarios and rubric. The
[native interview with larger limits](../../../../evals/private-discovery/kimi-thinking-large-native-dependants-results.md)
completed four successful model turns and explicitly confirmed two supported
adult facts. The native session completed without eliciting the required
dependant avoidance, exact fallback or associated workload. After two generic
questions, the model returned Review with one of five candidate slots unused;
the call ceiling did not force wrap-up. The challenge was unexercised, with zero
judge calls, human ratings or accepted families. The [v20 retest](../../../../evals/private-discovery/kimi-v20-native-dependants-results.md)
completed three native turns and discovered the dependant avoidance, but ended
before exact fallback/preparation discovery and the challenge. Five of eight
candidate slots remained unused; zero families were accepted. V21 added the
[typed fallback policy](03-typed-fallback-policy.md), but its [first attempt](../../../../evals/private-discovery/kimi-v21-first-attempt-provider-failure-results.md)
ended with provider failure and an unknown upstream outcome. The [second attempt](../../../../evals/private-discovery/kimi-v21-second-attempt-continuation-failure-results.md)
returned structured output but rejected an unmatched generic question reference
before any assistant text, card or typed need persisted. V22/policy v5 now give
each unresolved note its sole question and derive wording from reviewed profile
drafts and private typed state. The removed model text/follow-up fields reject
strictly. The [v22 native run](../../../../evals/private-discovery/kimi-v22-owned-replies-focused-results.md)
completed four successful turns, exact fallback/preparation discovery and the
fixed challenge, but missed the adult's safety question. Coverage was three of
four; no native completion, judge or family acceptance followed. Prompt v23
retains one generic own-adult safety topic until actual information or a settled
note addresses it, without inferring clearance or changing policy, wire or limits.
Fresh native semantic proof and independent review remain pending. Full native
family acceptance remains pending under the applicable user-authorized evaluation budget. Live discovery across all eight
families, the completed candidate comparison, A-to-B repeat review, judge scoring
and human calibration
remain incomplete. No baseline is accepted and the draft is not ready to merge.
The [owning work item](03-adaptive-discovery-and-evaluation.md#current-evaluation-status)
retains current scope and historical evidence. Delivery follows the existing
[execution policy](../../../agents/execution-policy.md).

## Product and technical boundaries

[PDR-0001](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
and
[PDR-0007](../../../decisions/product/0007-household-agent-conversations-and-visibility.md)
own visibility and lifecycle. Raw dialogue and unfinished proposals are private.
Confirmed facts become household-visible; explain that transition when asking
for confirmation. Safety constraints, dietary rules, and strong dislikes require
explicit confirmation, with a separate admitted confirmation for safety
reduction.

Interview hunches remain labelled tentative private cards until confirmation.
They are not the low-weight shared inference from repeated household behaviour
or feedback owned by Stage 6. Stage 3 owns persisted executable routines,
availability, cooking capacity, equipment, and fallbacks. Discovery can identify
those needs without squeezing them into food-preference labels or claiming the
eventual first-plan safety/practicality gate is satisfied.

The current
[profile contracts](../../../../packages/household-api/src/profiles.ts) support
food preferences, hard constraints, explicit no-known-hard-constraints,
provisional/confirmed standings, and `manual_ui` or `interview` provenance.
Work Item 02 delivered the narrow trusted interview confirmation boundary.
`HouseholdObject` remains the sole profile/version/audit/receipt writer. No
Agent, provider, or transport call enters its SQLite transaction.

Reuse the existing
[profile browser operations](../../../../apps/web/src/features/household-profiles/browser-operations.ts)
and receipt/version semantics. A model proposes a closed change; the participant
reviews its effect; an admitted command rechecks current authority and expected
profile version. Stale concurrent edits require refreshed review. An ambiguous
response retains the exact command and mutation ID; session completion must
resolve an already submitted confirmation before closing. Agent bookkeeping
cannot prove Household commitment or authorize new mutations after completion.
Work Item 02 specifies and proves this cross-object ordering.

[ADR-0004](../../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md)
owns runtime authority. Private state stays in plain native private children
with their physical sockets. Shared coordinators retain only
lifecycle/invalidation metadata. New private output paths must preserve the
existing final-send fence; private HTTP bodies, transcript-returning RPC, SDK
synchronization, and parent transcript reads are not enabled by this plan.

Normal completion retains private read-only transcripts. Permanent erasure and
support-access tooling remain separate lifecycles. No shared transcript memory,
dependant login, general chat platform, or retailer work belongs to this stage.

## Evaluation and completion

Use PDR-0006 as the single evaluation authority. Begin privacy-safe scenario and
rubric preparation before model selection; run the scoped custom-agent harness
spike alongside adaptive questioning. Model/provider and fixed-judge choices
follow measured evidence; no library, budget, or fixed interview length is
selected here. Fixture detail and visual layout can be resolved within the later
slices.

The stage completes when the cumulative adult/dependant/repeat journey works
with the real selected model, confirmed profile persistence and audit, actual
browser and native runtime proof, and accepted stage-scoped evaluation across
all eight families. Record exact model, prompt, tool, policy, scenario, rubric,
and judge versions. Telemetry measures quality and burden without private
transcript text.

Later dimensions must be marked **not exercised**, never passed by canned
results. Stage 3 owns routine/fallback evaluation; Stage 5 owns planning,
rationale, allocations, profile-version impact and real remaining-period repair;
Stage 6 owns feedback learning; Stage 7 owns shopping consequences. Stage 2 does
not claim to offer a working replan or silently change an approved week.

Each meaningful implementation slice needs relevant tests, real runtime/browser
evidence, and independent immutable-head review. One implementation owner
carries each slice; privacy, profile-authority, and evaluation reviewers may
independently check their bounded seams. This planning change needs document
formatting, link, and consistency checks, not application tests.
