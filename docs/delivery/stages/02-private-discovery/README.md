# Stage 2 — Private discovery and repeat profile review

- Status: Work Item 01 implementation and local acceptance complete; repository
  delivery pending hosted checks (2026-09-06).
- Planning base: `28a5f3ca4aae3c8f01c56e5261439111acd9949d`.
- Next:
  [Work Item 01 — private session foundation](01-private-session-foundation.md).

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

| Work item                                                           | Observable result                                                                                                                                                                                                                                                    | Status           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [01 — Private session foundation](01-private-session-foundation.md) | An adult starts, rediscovers, resumes, and completes a private session, then reads retained history through the admitted native socket. Durable participant messages and lifecycle work without a provider; assistant output exists only in synthetic test fixtures. | Delivery pending |
| 02 — Progressive cards and confirmation                             | Proposed cards appear early and support correction, rejection, explicit confirmation, hard-constraint status, and conflict handling. Only closed facts and privacy-safe provenance enter the existing versioned Household commands.                                  | Planned          |
| 03 — Adaptive discovery and evaluation                              | A real evaluated model asks relevant follow-ups, avoids repeated/exhaustive questioning, and produces useful cards. Develop the scoped harness spike, scenarios, rubric, model comparison, and calibrated baseline alongside this capability.                        | Planned          |
| 04 — Repeat review and dependant assistance                         | A new private review focuses on changed circumstances using current confirmed facts. An adult completes a shorter dependant flow; confirmation produces profile versions/audit, and old sessions remain closed.                                                      | Planned          |
| 05 — Cumulative discovery exit                                      | Two adults independently review and correct profiles; one assists a dependant; a later review changes an ordinary preference. The real selected model, UI, admitted commands, privacy boundaries, and all eight stage-scoped scenario families meet PDR-0006.        | Planned          |

Expand each later work item when it becomes next. Work Item 01 application
implementation is authorized; model/provider execution remains later work.
Delivery follows the existing
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
provisional/confirmed standings, and `manual_ui` provenance. Work Item 02 adds a
narrow trusted interview source and its tests rather than spoofing manual input.
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
Work Item 02 must specify and prove this cross-object ordering before
implementation.

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
